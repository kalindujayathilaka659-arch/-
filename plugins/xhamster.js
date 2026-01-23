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

const FORCE_AUDIO_BITRATE = "320k"; // ✅ final mp4 audio bitrate (AAC)

const COOKIES_FILE = path.join(__dirname, "../cookies/xhamster.txt");

// ✅ better headers (helps against blocks)
const UA =
  process.env.XH_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ✅ auto update yt-dlp only when needed
const AUTO_UPDATE_YTDLP = process.env.AUTO_UPDATE_YTDLP !== "false";

let DID_UPDATE_YTDLP = false;

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

/* ================= yt-dlp binary picker ================= */
// ✅ On GitHub Actions your PATH yt-dlp is usually OLD.
// So we prefer the node_modules binary if it exists.
function getYtDlpBin() {
  const candidates = [
    process.env.YTDLP_BIN,
    path.join(process.cwd(), "node_modules", "yt-dlp-exec", "bin", "yt-dlp"),
    path.join(process.cwd(), "node_modules", "yt-dlp-exec", "bin", "yt-dlp.exe"),
    "yt-dlp",
  ].filter(Boolean);

  for (const c of candidates) {
    if (c === "yt-dlp") return c; // allow PATH
    if (fs.existsSync(c)) return c;
  }

  return "yt-dlp";
}

const YTDLP_BIN = getYtDlpBin();

/* ================= EXEC WRAPPERS ================= */
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
          console.error("BIN:", bin);
          console.error("Exit code:", error.code);
          console.error("STDERR:\n", error._stderr || "(empty)");
          console.error("STDOUT:\n", error._stdout || "(empty)");
          return reject(error);
        }
        resolve({ stdout: stdout || "", stderr: stderr || "" });
      }
    );
  });
}

function execYtDlp(args, label = "yt-dlp") {
  return execBin(YTDLP_BIN, args, label);
}

/* ================= REASON DETECTOR ================= */
function detectReason(err) {
  const t = ((err?._stderr || "") + "\n" + (err?._stdout || "")).toLowerCase();

  // ✅ main bug you faced
  if (t.includes("keyerror") && t.includes("videomodel"))
    return "yt-dlp is outdated / extractor bug (update yt-dlp)";

  if (t.includes("cookies") || t.includes("cookie")) return "Cookies expired / invalid";
  if (t.includes("sign in") || t.includes("login")) return "Login required / blocked";
  if (t.includes("private")) return "Private video / restricted";
  if (t.includes("403") || t.includes("forbidden")) return "403 Forbidden (blocked)";
  if (t.includes("404") || t.includes("not found")) return "404 Not Found (removed)";
  if (t.includes("429") || t.includes("too many requests")) return "Rate limited (429)";
  if (t.includes("cloudflare") || t.includes("captcha")) return "Cloudflare / Captcha blocked";
  if (t.includes("timeout") || t.includes("timed out")) return "Timeout (slow network / blocked)";
  if (t.includes("ffmpeg")) return "FFmpeg merge failed";
  if (t.includes("aria2c") && (t.includes("not found") || t.includes("no such file")))
    return "aria2c not installed / missing";
  if (t.includes("requested format is not available") || t.includes("no video formats"))
    return "Requested quality not available";

  return "Unknown";
}

/* ================= AUTO UPDATE yt-dlp ================= */
async function ensureYtDlpUpdatedIfNeeded(errText = "") {
  if (!AUTO_UPDATE_YTDLP) return false;
  if (DID_UPDATE_YTDLP) return false;

  const t = String(errText).toLowerCase();
  const needsUpdate = t.includes("videomodel") || t.includes("extractor error");

  if (!needsUpdate) return false;

  DID_UPDATE_YTDLP = true;

  try {
    // ✅ try nightly first
    await execYtDlp(["--update-to", "nightly"], "yt-dlp UPDATE (nightly)");
    return true;
  } catch {
    try {
      // ✅ fallback stable update
      await execYtDlp(["-U"], "yt-dlp UPDATE (-U)");
      return true;
    } catch {
      console.log("⚠️ yt-dlp update failed (no permission / blocked).");
      return false;
    }
  }
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "xhamster",
    ownerOnly: true,
    react: "🍑",
    desc: "Download XHamster (Default 720p + AAC 320kbps) [GitHub Actions safe]",
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
          "❌ Unsupported XHamster URL\n\n✅ Example:\nhttps://xhamster.com/videos/video-name-1234567"
        );
      }

      if (!fs.existsSync(COOKIES_FILE)) {
        return reply("❌ Cookies file not found: ../cookies/xhamster.txt");
      }

      /* -------- Temp dir -------- */
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhamster-"));
      const outputTemplate = path.join(tempDir, "xhamster_%(id)s.%(ext)s");

      /* =====================================================
         1️⃣ METADATA (JSON)
      ===================================================== */
      const metaArgs = [
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",

        "--cookies",
        COOKIES_FILE,
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

      let info = null;

      try {
        const { stdout } = await execYtDlp(metaArgs, "XHamster META");
        info = JSON.parse(stdout);
      } catch (e) {
        const errText = (e?._stderr || "") + "\n" + (e?._stdout || "");
        await ensureYtDlpUpdatedIfNeeded(errText);

        // ✅ retry once after update
        try {
          const { stdout } = await execYtDlp(metaArgs, "XHamster META (retry)");
          info = JSON.parse(stdout);
        } catch (e2) {
          const reason = detectReason(e2);
          const snippet = tailLines(e2?._stderr || e2?._stdout || "", 8);
          return reply(
            `❌ Metadata failed.\n🧠 Reason: *${reason}*\n\n` +
              `📌 Details:\n\`\`\`\n${snippet || "No output"}\n\`\`\``
          );
        }
      }

      /* -------- Quality availability -------- */
      const heights = info.formats?.filter((f) => f.height).map((f) => f.height) || [];
      const uniqueHeights = [...new Set(heights)].sort((a, b) => a - b);

      let maxAvailable = uniqueHeights.length ? Math.max(...uniqueHeights) : quality;
      maxAvailable = Math.min(maxAvailable, MAX_CAP_QUALITY);

      if (quality > maxAvailable) {
        await reply(`⚠ Requested ${quality}p not available. Downloading ${maxAvailable}p instead.`);
        quality = maxAvailable;
      }

      /* -------- Metadata message -------- */
      const title = info.title || "XHamster Video";
      const uploader = info.uploader || "XHamster";
      const views = info.view_count ? info.view_count.toLocaleString() : "Unknown";
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
              `👤 *Uploader:* ${uploader}\n` +
              `👁 *Views:* ${views}\n` +
              `📦 *Selected:* ${quality}p\n` +
              `🎧 *Audio Final:* AAC ${FORCE_AUDIO_BITRATE}\n\n` +
              `📥 *Downloading…*`,
          },
          { quoted: mek }
        );
      }

      /* =====================================================
         2️⃣ DOWNLOAD VIDEO (MP4)
      ===================================================== */
      const formatRule =
        `bv*[ext=mp4][height<=${quality}]+ba[ext=m4a]/` +
        `b[ext=mp4][height<=${quality}]/best[height<=${quality}]`;

      const baseArgs = [
        "--no-warnings",
        "--continue",
        "--retries",
        "infinite",
        "--fragment-retries",
        "infinite",
        "--socket-timeout",
        "20",

        "--cookies",
        COOKIES_FILE,
        "--ffmpeg-location",
        ffmpegPath,

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

      const ariaArgs = [
        ...baseArgs,
        "--concurrent-fragments",
        "20",
        "--downloader",
        "aria2c",
        "--downloader-args",
        "aria2c:-x 8 -s 8 -k 1M",
      ];

      try {
        await execYtDlp(ariaArgs, "XHamster VIDEO (aria2c)");
      } catch (e) {
        const reason = detectReason(e);

        if (reason.includes("aria2c")) {
          console.log("⚠ aria2c missing -> retry without aria2c...");
          await execYtDlp(baseArgs, "XHamster VIDEO (fallback)");
        } else {
          const snippet = tailLines(e?._stderr || e?._stdout || "", 8);
          return reply(
            `❌ Download failed.\n🧠 Reason: *${reason}*\n\n` +
              `📌 Details:\n\`\`\`\n${snippet || "No output"}\n\`\`\``
          );
        }
      }

      const mp4File = fs
        .readdirSync(tempDir)
        .find((f) => f.endsWith(".mp4") && !f.includes(".part"));

      if (!mp4File) throw new Error("Video missing");
      const mp4Path = path.join(tempDir, mp4File);

      if (fs.statSync(mp4Path).size < 300 * 1024) throw new Error("Corrupted video");

      /* =====================================================
         3️⃣ FORCE AUDIO BITRATE 320K (AAC)
      ===================================================== */
      const finalPath = path.join(tempDir, `final_${quality}p.mp4`);

      try {
        await execBin(
          ffmpegPath,
          [
            "-y",
            "-i",
            mp4Path,
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
      } catch {
        console.log("⚠ FFmpeg audio re-encode failed, sending original file...");
      }

      const sendPath = fs.existsSync(finalPath) ? finalPath : mp4Path;

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
