const { cmd } = require("../command");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ffmpegPath = require("ffmpeg-static");

/* ================= CONFIG ================= */
const ALLOWED_QUALITIES = [360, 480, 720, 1080];
const DEFAULT_QUALITY = 720;       // ✅ default 720p
const MAX_CAP_QUALITY = 1080;      // ✅ allow up to 1080p

/* ================= HELPERS ================= */
function findFile(dir, ext) {
  return fs.readdirSync(dir).find((f) => f.endsWith(ext));
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
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function isValidXHamsterVideo(url) {
  return typeof url === "string" && url.includes("xhamster.com/videos/");
}

// ✅ exec wrapper (SHOW REAL ERRORS)
function execYtDlp(args, label = "yt-dlp") {
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      args,
      { maxBuffer: 1024 * 1024 * 50 }, // 50MB output buffer
      (error, stdout, stderr) => {
        if (error) {
          console.error(`\n❌ ${label} FAILED`);
          console.error("Exit code:", error.code);
          console.error("Signal:", error.signal);
          console.error("STDERR:\n", stderr || "(empty)");
          console.error("STDOUT:\n", stdout || "(empty)");

          error._stderr = stderr;
          error._stdout = stdout;
          return reject(error);
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

function detectReason(err) {
  const text = ((err?._stderr || "") + "\n" + (err?._stdout || "")).toLowerCase();

  if (text.includes("cookie") || text.includes("cookies")) return "Cookies expired / invalid";
  if (text.includes("403")) return "403 Forbidden (blocked)";
  if (text.includes("429")) return "Rate-limited (429) — try later";
  if (text.includes("ffmpeg")) return "FFmpeg merge failed";
  if (text.includes("aria2c") && (text.includes("not found") || text.includes("no such file")))
    return "aria2c not installed / not found";
  if (text.includes("requested format is not available") || text.includes("no video formats"))
    return "Requested quality not available";
  if (text.includes("private") || text.includes("login"))
    return "Private / login required";
  if (text.includes("not available") || text.includes("removed"))
    return "Video removed / unavailable";

  return "Unknown";
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "xhamster",
    ownerOnly: true,
    react: "🍑",
    desc: "Download XHamster video with quality selector (default 720p)",
    category: "nsfw",
    filename: __filename,
  },
  async (robin, mek, m, { q, from, reply }) => {
    let tempDir = null;

    try {
      if (!q) return reply("❌ Usage: .xhamster [360|480|720|1080] <video-url>");
      if (!ffmpegPath) throw new Error("ffmpeg-static missing");

      /* -------- Parse quality selector -------- */
      let quality = DEFAULT_QUALITY;
      let url = q;

      const parts = q.trim().split(/\s+/);
      if (parts.length > 1) {
        let first = parts[0].toLowerCase().replace("p", ""); // allow 1080p
        if (ALLOWED_QUALITIES.includes(parseInt(first))) {
          quality = parseInt(first);
          url = parts.slice(1).join(" ");
        }
      }

      // ✅ HARD CAP (max 1080)
      if (quality > MAX_CAP_QUALITY) quality = MAX_CAP_QUALITY;

      if (!isValidXHamsterVideo(url)) {
        return reply(
          "❌ Unsupported XHamster URL\n\n" +
            "✅ Use a *direct video link*, example:\n" +
            "https://xhamster.com/videos/video-name-1234567"
        );
      }

      /* -------- Paths -------- */
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhamster-")); // ✅ unique temp dir
      const cookiesFile = path.join(__dirname, "../cookies/xhamster.txt");

      if (!fs.existsSync(cookiesFile)) {
        return reply("❌ Cookies file not found: ../cookies/xhamster.txt");
      }

      const outputTemplate = path.join(tempDir, "xhamster_%(id)s.%(ext)s");

      /* =====================================================
         1️⃣ METADATA + THUMBNAIL (NO VIDEO)
      ===================================================== */
      const metaArgs = [
        "--skip-download",
        "--write-thumbnail",
        "--convert-thumbnails",
        "jpg",
        "--write-info-json",
        "--ffmpeg-location",
        ffmpegPath,
        "--cookies",
        cookiesFile,
        "-o",
        outputTemplate,
        url,
      ];

      try {
        await execYtDlp(metaArgs, "XHamster META");
      } catch (e) {
        const reason = detectReason(e);
        return reply(`❌ Metadata failed.\n🧠 Reason: *${reason}*`);
      }

      const infoFile = findFile(tempDir, ".info.json");
      const thumbFile = findFile(tempDir, ".jpg");
      if (!infoFile) throw new Error("Metadata missing");

      const info = JSON.parse(fs.readFileSync(path.join(tempDir, infoFile), "utf8"));

      /* -------- Quality availability -------- */
      const heights =
        info.formats?.filter((f) => f.height).map((f) => f.height) || [];

      const uniqueHeights = [...new Set(heights)].sort((a, b) => a - b);

      // ✅ maximum available but capped at 1080
      let maxAvailable = uniqueHeights.length ? Math.max(...uniqueHeights) : quality;
      maxAvailable = Math.min(maxAvailable, MAX_CAP_QUALITY);

      if (quality > maxAvailable) {
        reply(`⚠ Requested ${quality}p not available. Downloading ${maxAvailable}p instead.`);
        quality = maxAvailable;
      }

      const availableQualities = uniqueHeights
        .filter((h) => h <= MAX_CAP_QUALITY)
        .map((h) => `${h}p`)
        .join(", ");

      /* -------- Metadata -------- */
      const title = info.title || "XHamster Video";
      const channel = info.uploader || "XHamster";
      const views = info.view_count ? info.view_count.toLocaleString() : "Unknown";
      const stars = Array.isArray(info.cast) && info.cast.length ? info.cast.join(", ") : "Unknown";
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
              `📦 *Selected:* ${quality}p (Default 720p)\n\n` +
              `📥 *Downloading video…*`,
          },
          { quoted: mek }
        );
      }

      /* =====================================================
         2️⃣ VIDEO DOWNLOAD (<= 1080p)
      ===================================================== */

      // ✅ format rule
      const formatRule = `bv*[ext=mp4][height<=${quality}]+ba/best[height<=${quality}]`;

      const videoArgsAria2 = [
        "--no-warnings",
        "--continue",
        "--retries",
        "infinite",
        "--fragment-retries",
        "infinite",
        "--socket-timeout",
        "20",
        "--ffmpeg-location",
        ffmpegPath,

        "-f",
        formatRule,

        "--merge-output-format",
        "mp4",
        "--concurrent-fragments",
        "16",
        "--downloader",
        "aria2c",
        "--downloader-args",
        "aria2c:-x 8 -s 8 -k 1M",

        "--cookies",
        cookiesFile,
        "-o",
        outputTemplate,
        url,
      ];

      const videoArgsNormal = [
        "--no-warnings",
        "--continue",
        "--retries",
        "infinite",
        "--fragment-retries",
        "infinite",
        "--socket-timeout",
        "20",
        "--ffmpeg-location",
        ffmpegPath,

        "-f",
        formatRule,

        "--merge-output-format",
        "mp4",

        "--cookies",
        cookiesFile,
        "-o",
        outputTemplate,
        url,
      ];

      // Try aria2c first, fallback if missing
      try {
        await execYtDlp(videoArgsAria2, "XHamster VIDEO (aria2c)");
      } catch (e) {
        const reason = detectReason(e);

        if (reason.includes("aria2c")) {
          console.log("⚠ aria2c missing -> retrying without aria2c...");
          try {
            await execYtDlp(videoArgsNormal, "XHamster VIDEO (fallback)");
          } catch (e2) {
            const reason2 = detectReason(e2);
            return reply(`❌ Download failed.\n🧠 Reason: *${reason2}*`);
          }
        } else {
          return reply(`❌ Download failed.\n🧠 Reason: *${reason}*`);
        }
      }

      const videoFile = fs
        .readdirSync(tempDir)
        .find((f) => f.endsWith(".mp4") && !f.includes(".part"));

      if (!videoFile) throw new Error("Video missing");

      const videoPath = path.join(tempDir, videoFile);

      if (!fs.existsSync(videoPath)) throw new Error("Video file not found");
      if (fs.statSync(videoPath).size < 300 * 1024) throw new Error("Corrupted video");

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
    } catch (err) {
      console.error("XHamster Error:", err);
      reply("❌ Download failed. (Check console for full error)");
    } finally {
      try {
        if (tempDir && fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {}
    }
  }
);
