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

const FORCE_AUDIO_BITRATE = "320k"; // final mp4 audio bitrate (AAC)
const COOKIES_FILE = path.join(__dirname, "../cookies/xhamster.txt");

// Better headers (helps blocks + thumbnail hotlink)
const UA =
  process.env.XH_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Auto update yt-dlp only when needed
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
// Prefer node_modules binary if exists (Actions PATH often old)
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
  if (t.includes("ffmpeg") && t.includes("postprocessing")) return "FFmpeg merge failed";
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
  const needsUpdate = t.includes("videomodel") || t.includes("extractor error") || t.includes("keyerror");
  if (!needsUpdate) return false;

  DID_UPDATE_YTDLP = true;

  try {
    await execYtDlp(["--update-to", "nightly"], "yt-dlp UPDATE (nightly)");
    return true;
  } catch {
    try {
      await execYtDlp(["-U"], "yt-dlp UPDATE (-U)");
      return true;
    } catch {
      console.log("⚠️ yt-dlp update failed (no permission / blocked).");
      return false;
    }
  }
}

/* ================= QUALITY PICKER ================= */
/**
 * Only count MP4 formats that are likely WhatsApp-playable (H.264/avc1).
 * Avoids “requested 1080 but only webm exists” problems.
 */
function getPlayableMp4Heights(info) {
  const fmts = Array.isArray(info?.formats) ? info.formats : [];
  const heights = fmts
    .filter((f) => f && f.height && String(f.ext || "").toLowerCase() === "mp4")
    .filter((f) => {
      const vc = String(f.vcodec || "").toLowerCase();
      return vc.includes("avc1") || vc.includes("h264");
    })
    .map((f) => f.height);

  return [...new Set(heights)].sort((a, b) => a - b);
}

/* ================= THUMBNAIL FIX (WHATSAPP MOBILE) ================= */
/**
 * Baileys can't fetch xhamster thumbnails (403/hotlink).
 * So we download thumbnail with yt-dlp using cookies+headers,
 * convert to JPG, then send local file.
 */
async function downloadThumbJpg({ url, tempDir }) {
  const outTpl = path.join(tempDir, "thumb.%(ext)s");

  const args = [
    "--skip-download",
    "--write-thumbnail",
    "--convert-thumbnails",
    "jpg",
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

    "-o",
    outTpl,
    url,
  ];

  try {
    await execYtDlp(args, "XHamster THUMB");
  } catch {
    return null;
  }

  const f = fs
    .readdirSync(tempDir)
    .find(
      (x) =>
        x.startsWith("thumb.") &&
        (x.endsWith(".jpg") || x.endsWith(".jpeg") || x.endsWith(".png"))
    );

  return f ? path.join(tempDir, f) : null;
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "xhamster",
    ownerOnly: true,
    react: "🍑",
    desc: "Download XHamster (Default 720p + AAC 320kbps) [GitHub Actions safe + thumb fixed]",
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
        const maybe = parseInt(first, 10);
        if (ALLOWED_QUALITIES.includes(maybe)) {
          quality = maybe;
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

        try {
          const { stdout } = await execYtDlp(metaArgs, "XHamster META (retry)");
          info = JSON.parse(stdout);
        } catch (e2) {
          const reason = detectReason(e2);
          const snippet = tailLines(e2?._stderr || e2?._stdout || "", 10);
          return reply(
            `❌ Metadata failed.\n🧠 Reason: *${reason}*\n\n` +
              `📌 Details:\n\`\`\`\n${snippet || "No output"}\n\`\`\``
          );
        }
      }

      /* -------- Pick best available (MP4/H264 only) -------- */
      const playableHeights = getPlayableMp4Heights(info);
      let maxAvailable = playableHeights.length ? Math.max(...playableHeights) : quality;
      maxAvailable = Math.min(maxAvailable, MAX_CAP_QUALITY);

      if (quality > maxAvailable) {
        await reply(
          `⚠ Requested ${quality}p not available (MP4/H264). Downloading ${maxAvailable}p instead.`
        );
        quality = maxAvailable;
      }

      /* -------- Metadata values -------- */
      const title = info.title || "XHamster Video";
      const uploader = info.uploader || "XHamster";
      const views = info.view_count ? info.view_count.toLocaleString() : "Unknown";
      const duration = formatDuration(info.duration);

      /* =====================================================
         ✅ THUMBNAIL FIX (download locally so WhatsApp can open)
      ===================================================== */
      const thumbPath = await downloadThumbJpg({ url, tempDir });

      const caption =
        `👻 *GHOST XHAMSTER DOWNLOADER*\n\n` +
        `🎥 *Title:* ${title}\n` +
        `🕒 *Duration:* ${duration}\n` +
        `👤 *Uploader:* ${uploader}\n` +
        `👁 *Views:* ${views}\n` +
        `📦 *Selected:* ${quality}p\n` +
        `🎧 *Audio Final:* AAC ${FORCE_AUDIO_BITRATE}\n\n` +
        `📥 *Downloading…*`;

      if (thumbPath && fs.existsSync(thumbPath)) {
        await robin.sendMessage(
          from,
          { image: { url: thumbPath }, caption },
          { quoted: mek }
        );
      } else {
        await robin.sendMessage(from, { text: caption }, { quoted: mek });
      }

      /* =====================================================
         2️⃣ DOWNLOAD (Prefer MP4 + H264 + M4A)
      ===================================================== */
      const formatRule =
        `bv*[ext=mp4][vcodec^=avc1][height<=${quality}]+ba[ext=m4a]/` +
        `b[ext=mp4][vcodec^=avc1][height<=${quality}]/` +
        `bv*[ext=mp4][height<=${quality}]+ba[ext=m4a]/` +
        `b[ext=mp4][height<=${quality}]/best[height<=${quality}]`;

      const baseArgs = [
        "--no-warnings",
        "--no-playlist",
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
          const snippet = tailLines(e?._stderr || e?._stdout || "", 10);
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
         3️⃣ FORCE AUDIO AAC 320k (keep video copy)
      ===================================================== */
      const finalPath = path.join(tempDir, `final_${quality}p.mp4`);

      try {
        await execBin(
          ffmpegPath,
          [
            "-y",
            "-i",
            mp4Path,

            // map safely (won't crash if audio missing)
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",

            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            FORCE_AUDIO_BITRATE,
            "-ac",
            "2",
            "-ar",
            "44100",

            "-movflags",
            "+faststart",
            "-shortest",

            finalPath,
          ],
          "FFmpeg AUDIO 320K"
        );
      } catch {
        console.log("⚠ FFmpeg audio re-encode failed, sending original file...");
      }

      const sendPath = fs.existsSync(finalPath) ? finalPath : mp4Path;

      /* =====================================================
         ✅ SEND WITHOUT LOADING WHOLE FILE INTO RAM (Actions safe)
      ===================================================== */
      await robin.sendMessage(
        from,
        {
          document: { url: sendPath },
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
