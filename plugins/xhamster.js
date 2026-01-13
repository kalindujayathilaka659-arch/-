const { cmd } = require("../command");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");

/* ================= CONFIG ================= */
const ALLOWED_QUALITIES = [360, 480, 720, 1080];
const DEFAULT_QUALITY = 720;

/* ================= HELPERS ================= */
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

// yt-dlp-friendly video URL validation
function isValidXHamsterVideo(url) {
  return typeof url === "string" && url.includes("xhamster.com/videos/");
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "xhamster",
    ownerOnly: true,
    react: "🍑",
    desc: "Download XHamster video with quality selector",
    category: "nsfw",
    filename: __filename,
  },
  async (robin, mek, m, { q, from, reply }) => {
    try {
      if (!q) return reply("❌ Usage: .xhamster [360|480|720|1080] <video-url>");
      if (!ffmpegPath) throw new Error("ffmpeg-static missing");

      /* -------- Parse quality selector -------- */
      let quality = DEFAULT_QUALITY;
      let url = q;

      const parts = q.trim().split(/\s+/);
      if (parts.length > 1) {
        let first = parts[0].toLowerCase().replace("p", ""); // remove optional "p"
        if (ALLOWED_QUALITIES.includes(parseInt(first))) {
          quality = parseInt(first);
          url = parts.slice(1).join(" "); // rest is URL
        }
      }

      if (!isValidXHamsterVideo(url)) {
        return reply(
          "❌ Unsupported XHamster URL\n\n" +
          "✅ Use a *direct video link*, example:\n" +
          "https://xhamster.com/videos/video-name-1234567"
        );
      }

      /* -------- Paths -------- */
      const tempDir = path.join(__dirname, "../temp");
      fs.mkdirSync(tempDir, { recursive: true });

      const cookiesFile = path.join(__dirname, "../cookies/xhamster.txt");
      const outputTemplate = path.join(tempDir, "xhamster_%(id)s.%(ext)s");

      /* =====================================================
         1️⃣ METADATA + THUMBNAIL (NO VIDEO)
      ===================================================== */
      const metaArgs = [
        "--skip-download",
        "--write-thumbnail",
        "--convert-thumbnails", "jpg",
        "--write-info-json",
        "--ffmpeg-location", ffmpegPath,
        "--cookies", cookiesFile,
        "-o", outputTemplate,
        url
      ];

      await new Promise((res, rej) =>
        execFile("yt-dlp", metaArgs, err => err ? rej(err) : res())
      );

      const infoFile = findFile(tempDir, ".info.json");
      const thumbFile = findFile(tempDir, ".jpg");
      if (!infoFile) throw new Error("Metadata missing");

      const info = JSON.parse(
        fs.readFileSync(path.join(tempDir, infoFile), "utf8")
      );

      /* -------- Quality availability -------- */
      const heights = info.formats
        ?.filter(f => f.height)
        .map(f => f.height);

      const maxAvailable = heights?.length ? Math.max(...heights) : quality;

      if (quality > maxAvailable) {
        reply(`⚠ Requested ${quality}p not available. Downloading ${maxAvailable}p instead.`);
        quality = maxAvailable;
      }

      const availableQualities = [...new Set(heights || [])]
        .sort((a, b) => a - b)
        .map(q => `${q}p`)
        .join(", ");

      /* -------- Metadata -------- */
      const title = info.title || "XHamster Video";
      const channel = info.uploader || "XHamster";
      const views = info.view_count ? info.view_count.toLocaleString() : "Unknown";
      const stars = Array.isArray(info.cast) && info.cast.length
        ? info.cast.join(", ")
        : "Unknown";
      const duration = formatDuration(info.duration);

      /* -------- Send thumbnail + info -------- */
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
              `📺 *Available:* ${availableQualities || "Unknown"}\n` +
              `📦 *Selected:* ${quality}p\n\n` +
              `📥 *Downloading video…*`,
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

        "-f",
        `bv*[ext=mp4][height<=${quality}]/bv*[height<=${quality}]+ba/best[height<=${quality}]`,

        "--merge-output-format", "mp4",
        "--concurrent-fragments", "16",
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

      /* -------- Send video -------- */
      await robin.sendMessage(
        from,
        {
          document: fs.readFileSync(videoPath),
          mimetype: "video/mp4",
          fileName: `${safeFileName(title)}_${quality}p.mp4`,
        },
        { quoted: mek }
      );

      /* -------- Cleanup -------- */
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
