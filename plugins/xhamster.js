const { cmd } = require("../command");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const { isOwner } = require("../lib/auth");

/* ---------- helpers ---------- */
function findFile(dir, ext) {
  return fs.readdirSync(dir).find(f => f.endsWith(ext));
}

function safeFileName(name, max = 80) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function formatDuration(sec) {
  if (!sec) return "Unknown";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
}

cmd(
  {
    pattern: "xhamster",
    ownerOnly: true,
    react: "🎥",
    desc: "Download XHamster video (thumbnail + metadata first)",
    category: "nsfw",
    filename: __filename,
  },
  async (robin, mek, m, { q, from, reply }) => {
    try {
      if (!q) return reply("❌ Provide XHamster URL");
      if (!ffmpegPath) throw new Error("ffmpeg-static missing");

      /* ---------- parse input ---------- */
      const args = q.trim().split(/\s+/);
      let quality = "720";
      let url = "";

      if (/^\d{3,4}p$/i.test(args[0])) {
        quality = args[0].replace("p", "");
        url = args[1];
      } else {
        url = args[0];
      }

      if (!url.includes("xhamster.com"))
        return reply("❌ Invalid XHamster URL");

      /* ---------- paths ---------- */
      const tempDir = path.join(__dirname, "../temp");
      fs.mkdirSync(tempDir, { recursive: true });

      const cookiesFile = path.join(__dirname, "../cookies/xhamster.txt");
      const outputTemplate = path.join(tempDir, "xhamster_%(id)s.%(ext)s");

      /* =====================================================
         1️⃣ METADATA + THUMBNAIL (NO VIDEO DOWNLOAD)
      ===================================================== */
      const metaArgs = [
        "--skip-download",

        "--write-thumbnail",
        "--convert-thumbnails", "jpg",

        "--write-info-json",

        "--ffmpeg-location", ffmpegPath, // ✅ FIX (CRITICAL)

        "--cookies", cookiesFile,
        "-o", outputTemplate,
        url
      ];

      await new Promise((res, rej) =>
        execFile("yt-dlp", metaArgs, err => err ? rej(err) : res())
      );

      const infoFile = findFile(tempDir, ".info.json");
      const thumbFile = findFile(tempDir, ".jpg");

      if (!infoFile) throw new Error("Metadata not found");

      const info = JSON.parse(
        fs.readFileSync(path.join(tempDir, infoFile), "utf8")
      );

      const title    = info.title || "XHamster Video";
      const channel  = info.uploader || "XHamster";
      const views    = info.view_count ? info.view_count.toLocaleString() : "Unknown";
      const stars    = Array.isArray(info.cast) && info.cast.length ? info.cast.join(", ") : "Unknown";
      const duration = formatDuration(info.duration);
      const sizeMB   = info.filesize_approx
        ? (info.filesize_approx / 1048576).toFixed(2) + " MB"
        : "Unknown";

      /* ---------- SEND THUMB + METADATA FIRST ---------- */
      if (thumbFile) {
        await robin.sendMessage(
          from,
          {
            image: fs.readFileSync(path.join(tempDir, thumbFile)),
            mimetype: "image/jpeg",
            caption:
              `👻 *GHOST XHAMSTER DOWNLOADER*\n\n` +
              `🎥 *Title:* ${title}\n` +
              `🕒 *Duration:* ${duration}\n` +
              `👤 *Channel:* ${channel}\n` +
              `⭐ *Stars:* ${stars}\n` +
              `👁 *Views:* ${views}\n` +
              `📦 *Quality:* ${quality}p\n` +
              `📁 *Size:* ${sizeMB}\n` +
              `🔗 *URL:* ${url}\n\n` +
              `⬇️ *Downloading video…*`,
          },
          { quoted: mek }
        );
      }

      /* =====================================================
         2️⃣ VIDEO DOWNLOAD
      ===================================================== */
      const videoArgs = [
        "--no-warnings",
        "--continue",
        "--retries", "infinite",

        "--ffmpeg-location", ffmpegPath,

        "-f", `bv*[height<=${quality}]+ba/best[height<=${quality}]`,
        "--merge-output-format", "mp4",

        "--concurrent-fragments", "8",
        "--downloader", "aria2c",
        "--downloader-args", "aria2c:-x 8 -s 8 -k 1M",

        "--cookies", cookiesFile,
        "-o", outputTemplate,
        url
      ];

      await new Promise((res, rej) =>
        execFile("yt-dlp", videoArgs, err => err ? rej(err) : res())
      );

      const videoFile = findFile(tempDir, ".mp4");
      if (!videoFile) throw new Error("Video missing");

      const videoPath = path.join(tempDir, videoFile);
      if (fs.statSync(videoPath).size < 300 * 1024)
        throw new Error("Corrupted video");

      /* ---------- SEND VIDEO ---------- */
      await robin.sendMessage(
        from,
        {
          document: fs.readFileSync(videoPath),
          mimetype: "video/mp4",
          fileName: `${safeFileName(title)}.mp4`,
        },
        { quoted: mek }
      );

      /* ---------- CLEANUP ---------- */
      fs.readdirSync(tempDir).forEach(f => {
        if (f.startsWith("xhamster_")) {
          fs.unlink(path.join(tempDir, f), () => {});
        }
      });

    } catch (err) {
      console.error("XHamster Error:", err);
      reply("❌ Download failed.");
    }
  }
);
