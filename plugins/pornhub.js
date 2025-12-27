const { cmd } = require("../command");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const { isOwner } = require("../lib/auth");

const cookiesPath = path.resolve(__dirname, "../cookies/pornhubcookies.txt");
const tempDir = path.resolve(__dirname, "../temp");

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

/* ---------- helpers ---------- */
function findFile(dir, ext) {
  return fs.readdirSync(dir).find(f => f.endsWith(ext));
}

function safeName(name, max = 60) {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .slice(0, max);
}

cmd(
  {
    pattern: "pornhub",
    alias: ["ph", "pornhubdl"],
    ownerOnly: true,
    react: "💦",
    desc: "Pornhub downloader (thumbnail first, then video)",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    try {
      /* ---------- SAFE INPUT ---------- */
      const query = typeof q === "string" ? q.trim() : "";

      if (!query)
        return reply("❌ Please send a Pornhub video link.");

      if (!query.includes("pornhub.com"))
        return reply("❌ Invalid Pornhub URL.");

      if (!fs.existsSync(cookiesPath))
        return reply("⚠️ Pornhub cookies not found in /cookies.");

      const outputTemplate = path.join(tempDir, "pornhub_%(id)s.%(ext)s");

      /* ==================================================
         🔹 PHASE 1: METADATA + THUMBNAIL (NO VIDEO)
         ================================================== */
      const metaArgs = [
        "--skip-download",
        "--no-warnings",
        "--cookies", cookiesPath,
        "--ffmpeg-location", ffmpegPath,

        "--write-thumbnail",
        "--convert-thumbnails", "jpg",
        "--write-info-json",

        "-o", outputTemplate,
        query
      ];

      await new Promise((res, rej) =>
        execFile("yt-dlp", metaArgs, err => err ? rej(err) : res())
      );

      const infoFile  = findFile(tempDir, ".info.json");
      const thumbFile = findFile(tempDir, ".jpg");

      if (!infoFile)
        throw new Error("Failed to fetch metadata.");

      const info = JSON.parse(
        fs.readFileSync(path.join(tempDir, infoFile), "utf8")
      );

      /* ---------- METADATA ---------- */
      const title = info.title || "Pornhub Video";
      const duration = info.duration
        ? new Date(info.duration * 1000).toISOString().substr(11, 8)
        : "Unknown";

      const views = info.view_count
        ? info.view_count.toLocaleString()
        : "Unknown";

      const quality = info.height ? `${info.height}p` : "720p";

      const stars =
        Array.isArray(info.cast) && info.cast.length
          ? info.cast.join(", ")
          : "Unknown";

      /* ---------- SEND THUMB + METADATA FIRST ---------- */
      if (thumbFile) {
        await robin.sendMessage(
          from,
          {
            image: fs.readFileSync(path.join(tempDir, thumbFile)),
            mimetype: "image/jpeg",
            caption:
              `👻 *GHOST PORNHUB DOWNLOADER*\n\n` +
              `🎥 *Title:* ${title}\n` +
              `⭐ *Stars:* ${stars}\n` +
              `🕒 *Duration:* ${duration}\n` +
              `👁 *Views:* ${views}\n` +
              `📦 *Quality:* ${quality}\n` +
              `🔗 *URL:* ${query}\n\n` +
              `⏬ *Downloading video…*`,
          },
          { quoted: mek }
        );
      }

      /* ==================================================
         🔹 PHASE 2: VIDEO DOWNLOAD
         ================================================== */
      const videoArgs = [
        "--no-warnings",
        "--cookies", cookiesPath,
        "--ffmpeg-location", ffmpegPath,

        "-f", "bv*[height<=720]+ba/best[height<=720]/best",
        "--merge-output-format", "mp4",

        "--concurrent-fragments", "8",
        "--downloader", "aria2c",
        "--downloader-args", "aria2c:-x 8 -s 8 -k 1M",

        "-o", outputTemplate,
        query
      ];

      await new Promise((res, rej) =>
        execFile("yt-dlp", videoArgs, err => err ? rej(err) : res())
      );

      const videoFile = findFile(tempDir, ".mp4");
      if (!videoFile) throw new Error("Video download failed.");

      const videoPath = path.join(tempDir, videoFile);

      /* ---------- SEND VIDEO ---------- */
      await robin.sendMessage(
        from,
        {
          document: fs.readFileSync(videoPath),
          mimetype: "video/mp4",
          fileName: `${safeName(title)}.mp4`,
        },
        { quoted: mek }
      );

      /* ---------- CLEANUP ---------- */
      fs.readdirSync(tempDir).forEach(f => {
        if (f.startsWith("pornhub_")) {
          fs.unlink(path.join(tempDir, f), () => {});
        }
      });

    } catch (err) {
      console.error("Pornhub Error:", err);
      reply(`❌ Error: ${err.message || "Unknown error"}`);
    }
  }
);


