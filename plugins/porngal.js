const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const os = require("os");
const archiver = require("archiver");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeTag(q) {
  return q
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function sanitizeFileName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/pornpics\.com/gi, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "gallery";
}

// ✅ Get REAL gallery name from HTML
function extractGalleryName(html) {
  const $ = cheerio.load(html);

  let name = $("h1").first().text().trim();
  if (!name) name = $("title").text().trim();

  name = name
    .replace(/\s*-\s*pornpics.*$/i, "")
    .replace(/\s*\|\s*pornpics.*$/i, "")
    .replace(/pornpics\.com/gi, "")
    .trim();

  return sanitizeFileName(name);
}

// pick best (largest) from srcset
function pickFromSrcset(srcset = "") {
  const parts = srcset.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  return last.split(" ")[0];
}

function fixUrl(src, base) {
  if (!src) return null;
  if (src.startsWith("//")) return "https:" + src;
  if (src.startsWith("/")) return base + src;
  return src;
}

async function fetchHtml(url, headers) {
  const res = await axios.get(url, {
    headers,
    timeout: 20000,
    maxRedirects: 5,
  });
  return res.data;
}

function extractImagesFromHtml(html, base) {
  const $ = cheerio.load(html);
  const images = [];

  $("img").each((_, el) => {
    let src =
      $(el).attr("data-src") ||
      $(el).attr("data-original") ||
      $(el).attr("src");

    const srcset = $(el).attr("srcset");
    const bestFromSrcset = pickFromSrcset(srcset);
    if (bestFromSrcset) src = bestFromSrcset;

    src = fixUrl(src, base);
    if (!src) return;

    if (
      src.startsWith("http") &&
      !/(logo|icon|thumb|sprite|ads|placeholder)/i.test(src)
    ) {
      images.push(src);
    }
  });

  // Sometimes images are in <a href="...jpg">
  $("a").each((_, el) => {
    let href = $(el).attr("href");
    href = fixUrl(href, base);
    if (!href) return;

    if (
      href.startsWith("http") &&
      /\.(jpg|jpeg|png|webp)(\?|$)/i.test(href) &&
      !/(thumb|sprite|ads)/i.test(href)
    ) {
      images.push(href);
    }
  });

  return [...new Set(images)];
}

function findNextPageUrl(html, currentUrl, base) {
  const $ = cheerio.load(html);

  let next =
    $('a[rel="next"]').attr("href") ||
    $("a.next").attr("href") ||
    $('a:contains("Next")').attr("href");

  next = fixUrl(next, base);

  if (!next) return null;
  if (next === currentUrl) return null;

  return next;
}

async function findGalleryFromTag(tagUrl, base, headers) {
  const html = await fetchHtml(tagUrl, headers);
  const $ = cheerio.load(html);

  const links = new Set();
  $("a").each((_, el) => {
    let href = $(el).attr("href");
    href = fixUrl(href, base);
    if (!href) return;

    if (href.includes("/galleries/")) links.add(href);
  });

  return links.size ? [...links][0] : null;
}

function guessExt(url, contentType = "") {
  const clean = url.split("?")[0].toLowerCase();
  const ext = path.extname(clean);
  if (ext && ext.length <= 5) return ext;

  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

async function downloadImage(url, outPath, headers) {
  const res = await axios.get(url, {
    headers,
    responseType: "arraybuffer",
    timeout: 25000,
    maxRedirects: 5,
  });
  fs.writeFileSync(outPath, Buffer.from(res.data));
  return res.headers["content-type"] || "";
}

async function makeCbzFromFolder(folderPath, outCbzPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outCbzPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(true));
    archive.on("error", (err) => reject(err));

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });
}

// ✅ Progress message editor
async function editProgress(sock, jid, key, text) {
  try {
    await sock.sendMessage(jid, { text, edit: key });
  } catch {
    // if edit not supported, ignore (no spam)
  }
}

cmd(
  {
    pattern: "porngal",
    ownerOnly: true,
    react: "🍑",
    desc: "Scrape full Pornpics gallery & send as CBZ",
    category: "nsfw",
    filename: __filename,
  },
  async (robin, mek, m, { q, from, reply }) => {
    try {
      if (!q) {
        return reply(
          "❌ Use:\n" +
            "• porngal bun\n" +
            "• porngal oiled bun\n" +
            "• porngal https://www.pornpics.com/galleries/xxxx/\n" +
            "• porngal bun | 80"
        );
      }

      // ✅ ONE PROGRESS MESSAGE (we will edit this)
      const progressMsg = await robin.sendMessage(
        from,
        { text: "🍑 Starting..." },
        { quoted: mek }
      );

      // Parse: "query | max"
      const parts = q.split("|").map((x) => x.trim());
      const query = parts[0];
      const maxSend = Math.max(
        1,
        Math.min(parseInt(parts[1] || "80", 10), 200)
      );

      const base = "https://www.pornpics.com";

      // Cloudflare-safe headers
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": base + "/",
        "Connection": "keep-alive",
      };

      let galleryUrl = null;
      let displayName = "gallery";

      // ✅ If direct URL
      if (/^https?:\/\//i.test(query)) {
        galleryUrl = query.trim();
      } else {
        // ✅ tag mode
        const tag = normalizeTag(query);
        if (!tag) return reply("❌ Invalid tag.");

        const tryTagUrls = [
          `${base}/tags/${encodeURIComponent(tag)}/`,
          `${base}/${encodeURIComponent(tag)}/`,
        ];

        let found = null;

        for (const u of tryTagUrls) {
          try {
            found = await findGalleryFromTag(u, base, headers);
            if (found) break;
          } catch (e) {
            if (e.response?.status === 404) continue;
            throw e;
          }
        }

        if (!found) {
          await editProgress(
            robin,
            from,
            progressMsg.key,
            `❌ No gallery found for: *${tag}*`
          );
          return;
        }

        galleryUrl = found;
      }

      await editProgress(
        robin,
        from,
        progressMsg.key,
        `🍑 Scraping pages...\n🔗 ${galleryUrl}`
      );

      // ✅ scrape gallery pages (pagination)
      const visited = new Set();
      let pageUrl = galleryUrl;
      let allImages = [];
      let pages = 0;

      let firstGalleryHtml = null;

      while (pageUrl && !visited.has(pageUrl) && pages < 30) {
        visited.add(pageUrl);
        pages++;

        const html = await fetchHtml(pageUrl, headers);

        if (!firstGalleryHtml) {
          firstGalleryHtml = html;
          displayName = extractGalleryName(firstGalleryHtml); // ✅ REAL NAME
        }

        const imgs = extractImagesFromHtml(html, base);
        allImages.push(...imgs);

        pageUrl = findNextPageUrl(html, pageUrl, base);
      }

      allImages = [...new Set(allImages)];

      if (allImages.length === 0) {
        await editProgress(
          robin,
          from,
          progressMsg.key,
          "❌ No images found in that gallery."
        );
        return;
      }

      // limit for cbz
      const sendList = allImages.slice(0, Math.min(maxSend, allImages.length));
      const total = sendList.length;

      await editProgress(
        robin,
        from,
        progressMsg.key,
        `🍑 *Pornpics → CBZ*\n✅ Gallery: *${displayName}*\n📦 Images: *${total}*\n📄 Pages: *${pages}*\n\n📥 Downloading 0/${total} (0%)`
      );

      // ✅ temp folder
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porngal-"));
      const imgDir = path.join(tmpDir, "images");
      fs.mkdirSync(imgDir, { recursive: true });

      // ✅ download images into folder + update progress (EDIT 1 MESSAGE)
      let saved = 0;
      let lastEdit = 0;
      const EDIT_INTERVAL = 1200;

      for (let i = 0; i < sendList.length; i++) {
        const imgUrl = sendList[i];

        try {
          const imgHeaders = {
            ...headers,
            Referer: galleryUrl,
            Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          };

          // temp download
          const tmpPath = path.join(imgDir, `tmp_${Date.now()}.tmp`);
          const contentType = await downloadImage(imgUrl, tmpPath, imgHeaders);

          // ✅ success count (REAL)
          saved++;
          const indexName = String(saved).padStart(4, "0");

          // rename to real extension
          const ext = guessExt(imgUrl, contentType);
          const finalPath = path.join(imgDir, `${indexName}${ext}`);
          fs.renameSync(tmpPath, finalPath);

          // ✅ edit message progress (throttle)
          const now = Date.now();
          if (now - lastEdit > EDIT_INTERVAL || saved === total) {
            lastEdit = now;
            const percent = Math.floor((saved / total) * 100);
            await editProgress(
              robin,
              from,
              progressMsg.key,
              `🍑 *Pornpics → CBZ*\n✅ Gallery: *${displayName}*\n📦 Images: *${total}*\n\n📥 Downloading ${saved}/${total} (${percent}%)`
            );
          }

          await sleep(350 + Math.random() * 450);
        } catch {
          continue;
        }
      }

      if (saved === 0) {
        await editProgress(
          robin,
          from,
          progressMsg.key,
          "❌ Could not download any images."
        );
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return;
      }

      // ✅ create cbz with REAL name
      const cbzPath = path.join(tmpDir, `${displayName}.cbz`);

      await editProgress(
        robin,
        from,
        progressMsg.key,
        `🍑 *Pornpics → CBZ*\n✅ Gallery: *${displayName}*\n📦 Downloaded: *${saved}*\n\n📦 Packing CBZ...`
      );

      await makeCbzFromFolder(imgDir, cbzPath);

      await editProgress(
        robin,
        from,
        progressMsg.key,
        `🍑 *Pornpics → CBZ*\n✅ Gallery: *${displayName}*\n📦 Images: *${saved}*\n\n📤 Uploading CBZ...`
      );

      // ✅ send as CBZ document
      await robin.sendMessage(
        from,
        {
          document: fs.readFileSync(cbzPath),
          mimetype: "application/x-cbz",
          fileName: `${displayName}.cbz`,
          caption: `🍑 *CBZ Ready*\n📦 Images: ${saved}\n🌐 pornpics.com`,
        },
        { quoted: mek }
      );

      await editProgress(
        robin,
        from,
        progressMsg.key,
        `✅ Done!\n📦 *${displayName}.cbz*\nImages: *${saved}*`
      );

      // ✅ cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });

    } catch (err) {
      console.error(
        "Pornpics CBZ error:",
        err.response?.status,
        err.response?.statusText || err.message
      );
      reply("❌ Failed to create CBZ (blocked / layout changed / download error).");
    }
  }
);
