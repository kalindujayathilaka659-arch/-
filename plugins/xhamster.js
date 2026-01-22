const { cmd } = require("../command");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ffmpegPath = require("ffmpeg-static");

/* ================= CONFIG ================= */
const ALLOWED_QUALITIES = [360, 480, 720, 1080];
const DEFAULT_QUALITY = 720;
const MAX_CAP_QUALITY = 1080;

// ✅ FORCE FINAL MP4 AUDIO BITRATE
const FORCE_AUDIO_BITRATE = "320k"; // ✅ 320kbps AAC

/* ================= HELPERS ================= */
function safeFileName(name, max = 80) {
  return (name || "video")
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

function tailLines(text = "", maxLines = 10) {
  const lines = String(text).split("\n").filter(Boolean);
  return lines.slice(-maxLines).join("\n");
}

// ✅ Universal exec wrapper (captures stderr/stdout)
function execBin(bin, args, label = "EXEC") {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { maxBuffer: 1024 * 1024 * 50 },
      (error, stdout, stderr) => {
        if (error) {
          error._stderr = stderr || "";
          error._stdout = stdout || "";
          console.error(`\n❌ ${label} FAILED`);
          console.error("Exit code:", error.code);
          console.error("STDERR:\n", error._stderr || "(empty)");
          console.error("STDOUT:\n", error._stdout || "(empty)");
          return reject(error);
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

// ✅ yt-dlp wrapper
function execYtDlp(args, label = "yt-dlp") {
  return execBin("yt-dlp", args, label);
}

// ✅ Better reason detector
function detectReason(err) {
  const t = ((err?._stderr || "") + "\n" + (err?._stdout || "")).toLowerCase();

  if (t.includes("cookies") || t.includes("cookie")) return "Cookies expired / invalid";
  if (t.includes("sign in") || t.includes("login")) return "Login required / blocked";
  if (t.includes("private")) return "Private video / restricted";
  if (t.includes("403") || t.includes("forbidden")) return "403 Forbidden (blocked)";
  if (t.includes("404") || t.includes("not found")) return "404 Not Found (removed)";
  if (t.includes("429") || t.includes("too many requests")) return "Rate limited (429)";
  if (t.includes("cloudflare") || t.includes("captcha")) return "Cloudflare / Captcha blocked";
  if (t.includes("unable to download webpage")) return "Blocked / site changed / network issue";
  if (t.includes("name resolution") || t.includes("enotfound")) return "DNS error / no internet";
  if (t.includes("timed out") || t.includes("timeout")) return "Timeout (slow network / blocked)";
  if (t.includes("tls") || t.includes("ssl")) return "SSL/TLS handshake failed";
  if (t.includes("ffmpeg")) return "FFmpeg merge failed";
  if (t.includes("aria2c") && (t.includes("not found") || t.includes("no such file")))
    return "aria2c not installed / missing";
  if (t.includes("requested format is not available") || t.includes("no video formats"))
    return "Requested quality not available";

  return "Unknown";
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "xhamster",
    ownerOnly: true,
    react: "🍑",
    desc: "Download XHamster video with quality selector (Default 720p + 320kbps audio)",
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
        const first = parts[0].toLowerCase().replace("p", "");
        if (ALLOWED_QUALITIES.includes(parseInt(first, 10))) {
          quality = parseInt(first, 10);
          url = parts.slice(1).join(" ");
        }
      }

      if (quality > MAX_CAP_QUALITY) quality = MAX_CAP_QUALITY;

      if (!isValidXHamsterVideo(url)) {
        return reply(
          "❌ Unsupported XHamster URL\n\n" +
            "✅ Example:\nhttps://xhamster.com/videos/video-name-1234567"
        );
      }

      /* -------- Paths -------- */
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhamster-"));
      const cookiesFile = path.join(__dirname, "../cookies/xhamster.txt");

      if (!fs.existsSync(cookiesFile)) {
        return reply("❌ Cookies file not found: ../cookies/xhamster.txt");
      }

      const outputTemplate = path.join(tempDir, "xhamster_%(id)s.%(ext)s");

      // ✅ Browser headers help with blocks
      const UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

      /* =====================================================
         1️⃣ METADATA (JSON)
      ===================================================== */
      const metaArgs = [
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--cookies",
        cookiesFile,
        "--ffmpeg-location",
        ffmpegPath,

        "--add-header",
        `User-Agent:${UA}`,
        "--add-header",
        "Accept-Language:en-US,en;q=0.9",
        "--add-header",
        "Referer:https://xhamster.com/",

        url,
      ];

      let info;

      try {
        const { stdout } = await execYtDlp(metaArgs, "XHamster META");
        info = JSON.parse(stdout);
      } catch (e) {
        const reason = detectReason(e);
        const snippet = tailLines(e?._stderr || e?._stdout || "", 8);

        return reply(
          `❌ Metadata failed.\n🧠 Reason: *${reason}*\n\n` +
            `📌 Details:\n\`\`\`\n${snippet || "No output"}\n\`\`\``
        );
      }

      /* -------- Quality availability -------- */
      const heights = info.formats?.filter((f) => f.height).map((f) => f.height) || [];
      const uniqueHeights = [...new Set(heights)].sort((a, b) => a - b);

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
      const stars =
        Array.isArray(info.cast) && info.cast.length ? info.cast.join(", ") : "Unknown";
      const duration = formatDuration(info.duration);
      const thumbUrl = info.thumbnail;

      if (thumbUrl) {
        await robin.sendMessage(
          from,
          {
            image: { url: thumbUrl },
            caption:
              `👻 *GHOST XHAMSTER DOWNLOADER*\n\n` +
              `🎥 *Title:* ${title}\n` +
              `🕒 *Duration:* ${duration}\n` +
              `👤 *Channel:* ${channel}\n` +
              `⭐ *Stars:* ${stars}\n` +
              `👁 *Views:* ${views}\n` +
              `📺 *Available:* ${availableQualities || "Unknown"}\n` +
              `📦 *Selected:* ${quality}p (Default 720p)\n` +
              `🎧 *Audio:* ${FORCE_AUDIO_BITRATE} (AAC)\n\n` +
              `📥 *Downloading video…*`,
          },
          { quoted: mek }
        );
      }

      /* =====================================================
         2️⃣ VIDEO DOWNLOAD
      ===================================================== */

      const formatRule =
        `bv*[ext=mp4][height<=${quality}]+ba[ext=m4a]/` +
        `b[ext=mp4][height<=${quality}]/best[height<=${quality}]`;

      const baseVideoArgs = [
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
        "--cookies",
        cookiesFile,

        "--add-header",
        `User-Agent:${UA}`,
        "--add-header",
        "Accept-Language:en-US,en;q=0.9",
        "--add-header",
        "Referer:https://xhamster.com/",

        "-f",
        formatRule,
        "--merge-output-format",
        "mp4",

        "-o",
        outputTemplate,
        url,
      ];

      // aria2c boost
      const videoArgsAria2 = [
        ...baseVideoArgs,
        "--concurrent-fragments",
        "16",
        "--downloader",
        "aria2c",
        "--downloader-args",
        "aria2c:-x 8 -s 8 -k 1M",
      ];

      // Try aria2c first
      try {
        await execYtDlp(videoArgsAria2, "XHamster VIDEO (aria2c)");
      } catch (e) {
        const reason = detectReason(e);

        if (reason.includes("aria2c")) {
          console.log("⚠ aria2c missing -> retrying without aria2c...");
          try {
            await execYtDlp(baseVideoArgs, "XHamster VIDEO (fallback)");
          } catch (e2) {
            const reason2 = detectReason(e2);
            const snippet2 = tailLines(e2?._stderr || e2?._stdout || "", 8);

            return reply(
              `❌ Download failed.\n🧠 Reason: *${reason2}*\n\n` +
                `📌 Details:\n\`\`\`\n${snippet2 || "No output"}\n\`\`\``
            );
          }
        } else {
          const snippet = tailLines(e?._stderr || e?._stdout || "", 8);
          return reply(
            `❌ Download failed.\n🧠 Reason: *${reason}*\n\n` +
              `📌 Details:\n\`\`\`\n${snippet || "No output"}\n\`\`\``
          );
        }
      }

      /* -------- Find mp4 -------- */
      const downloadedMp4 = fs
        .readdirSync(tempDir)
        .find((f) => f.endsWith(".mp4") && !f.includes(".part"));

      if (!downloadedMp4) throw new Error("Video missing");

      const downloadedPath = path.join(tempDir, downloadedMp4);
      if (fs.statSync(downloadedPath).size < 300 * 1024) throw new Error("Corrupted video");

      /* =====================================================
         3️⃣ FORCE AUDIO BITRATE 320k (AAC)
      ===================================================== */
      const finalPath = path.join(tempDir, `final_${quality}p.mp4`);

      try {
        await execBin(
          ffmpegPath,
          [
            "-y",
            "-i",
            downloadedPath,
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            FORCE_AUDIO_BITRATE,
            "-movflags",
            "+faststart",
            finalPath,
          ],
          "FFmpeg AUDIO 320K"
        );
      } catch (e) {
        console.log("⚠ FFmpeg audio re-encode failed, sending original file...");
      }

      const sendPath = fs.existsSync(finalPath) ? finalPath : downloadedPath;

      /* -------- Send video -------- */
      await robin.sendMessage(
        from,
        {
          document: fs.readFileSync(sendPath),
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
