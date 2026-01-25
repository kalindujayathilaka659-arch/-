const { cmd } = require("../command");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const FileType = require("file-type");

// ===== SETTINGS =====
const MAX_PART_SIZE = 1.95 * 1024 * 1024 * 1024; // 1.95GB safe under 2GB
const TEMP_DIR = path.join(process.cwd(), "temp");

// ===== HELPERS =====
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeName(name = "file") {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120);
}

function getFileNameFromUrl(url) {
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").pop() || "file_from_link";
    return safeName(base.split("?")[0] || "file_from_link");
  } catch {
    return "file_from_link";
  }
}

async function downloadToDisk(url, outPath) {
  const res = await axios({
    method: "GET",
    url,
    responseType: "stream",
    maxRedirects: 10,
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: { "User-Agent": "GHOST-MD" },
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outPath);
    res.data.pipe(writer);
    res.data.on("error", reject);
    writer.on("error", reject);
    writer.on("finish", resolve);
  });

  return outPath;
}

async function zipOneFile(srcPath, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    archive.file(srcPath, { name: path.basename(srcPath) });
    archive.finalize();
  });
}

// Split into zip parts like: filename.zip.001, filename.zip.002 ...
async function splitFileToParts(srcPath, destBasePath, partSizeBytes) {
  const { once } = require("events");

  const parts = [];
  let partIndex = 1;
  let bytesWritten = 0;

  const pad = (n) => String(n).padStart(3, "0");
  const makePartPath = (i) => `${destBasePath}.${pad(i)}`;

  let partPath = makePartPath(partIndex);
  let ws = fs.createWriteStream(partPath);
  parts.push(partPath);

  const rs = fs.createReadStream(srcPath, { highWaterMark: 16 * 1024 * 1024 });

  try {
    for await (const chunk of rs) {
      let offset = 0;

      while (offset < chunk.length) {
        const remaining = partSizeBytes - bytesWritten;
        const slice = chunk.subarray(offset, offset + remaining);

        if (!ws.write(slice)) {
          await once(ws, "drain");
        }

        offset += slice.length;
        bytesWritten += slice.length;

        if (bytesWritten >= partSizeBytes) {
          await new Promise((r) => ws.end(r));

          partIndex++;
          bytesWritten = 0;

          partPath = makePartPath(partIndex);
          ws = fs.createWriteStream(partPath);
          parts.push(partPath);
        }
      }
    }

    await new Promise((r) => ws.end(r));
    return parts;
  } catch (e) {
    try { ws.destroy(); } catch {}
    throw e;
  }
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true, recursive: true });
  } catch {}
}

// ===== COMMAND =====
cmd(
  {
    pattern: "largefile",
    ownerOnly: true,
    react: "📦",
    desc: "Download huge files (auto zip + split under 2GB)",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    ensureDirSync(TEMP_DIR);

    if (!q || !q.startsWith("http")) {
      return reply("❌ Please provide a valid direct download link.\nExample: .largefile https://site.com/bigfile.mp4");
    }

    const baseName = getFileNameFromUrl(q);
    const tempFilePath = path.join(TEMP_DIR, `${Date.now()}_${baseName}`);

    let downloadedPath = tempFilePath;
    let zipPath = null;
    let parts = [];

    try {
      await reply("⬇️ Downloading big file...");

      // 1) Download stream to disk
      await downloadToDisk(q, tempFilePath);

      const fileStat = fs.statSync(tempFilePath);
      const sizeBytes = fileStat.size;

      // detect file type without loading into RAM
      const ft = await FileType.fromFile(tempFilePath).catch(() => null);
      const mimeType = ft?.mime || "application/octet-stream";

      // 2) If <= 2GB, send directly
      if (sizeBytes <= 2 * 1024 * 1024 * 1024) {
        await reply("📤 Uploading file...");
        await robin.sendMessage(
          from,
          {
            document: { url: tempFilePath },
            fileName: baseName,
            mimetype: mimeType,
            caption: `📎 *Downloaded from:* ${q}`,
          },
          { quoted: mek }
        );

        await reply("✅ File sent successfully.");
        return;
      }

      // 3) If > 2GB, ZIP it
      await reply("📦 File is bigger than 2GB... Creating ZIP...");
      zipPath = path.join(TEMP_DIR, `${Date.now()}_${safeName(baseName)}.zip`);

      await zipOneFile(tempFilePath, zipPath);

      const zipSize = fs.statSync(zipPath).size;

      // 4) If ZIP <= 2GB, send ZIP
      if (zipSize <= 2 * 1024 * 1024 * 1024) {
        await reply("📤 Uploading ZIP file...");
        await robin.sendMessage(
          from,
          {
            document: { url: zipPath },
            fileName: path.basename(zipPath),
            mimetype: "application/zip",
            caption: `📦 *Zipped & sent*\n🔗 ${q}`,
          },
          { quoted: mek }
        );

        await reply("✅ ZIP sent successfully.");
        return;
      }

      // 5) ZIP still > 2GB → split ZIP into parts under 2GB
      await reply("🧩 ZIP still too large... Splitting into parts under 2GB...");

      const destBase = zipPath; // parts become zipPath.001 .002 ...
      parts = await splitFileToParts(zipPath, destBase, MAX_PART_SIZE);

      // Send parts
      await reply(`📤 Uploading ${parts.length} parts...`);

      for (let i = 0; i < parts.length; i++) {
        const partFile = parts[i];
        const partName = path.basename(partFile);

        await robin.sendMessage(
          from,
          {
            document: { url: partFile },
            fileName: partName,
            mimetype: "application/octet-stream",
            caption: `📦 *Part ${i + 1}/${parts.length}*\n🔗 ${q}\n\n✅ After download, join parts on PC with 7-Zip / WinRAR`,
          },
          { quoted: mek }
        );
      }

      await reply(
        `✅ Done!\n\n📌 *How to extract:*\n1) Download all parts\n2) Keep them in ONE folder\n3) Open the first one: *.zip.001* with 7-Zip / WinRAR\n4) Extract ✅`
      );
    } catch (err) {
      console.error(err);
      reply("❌ Failed:\n" + (err.message || err));
    } finally {
      // cleanup temp
      safeUnlink(downloadedPath);
      safeUnlink(zipPath);
      if (parts.length) {
        for (const p of parts) safeUnlink(p);
      }
    }
  }
);
