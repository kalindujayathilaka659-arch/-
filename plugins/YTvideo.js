const { cmd } = require("../command");
const ytsr = require("yt-search");
const fs = require("fs-extra");
const path = require("path");
const { execFile } = require("child_process");

const COOKIES_PATH = "cookies/youtube_cookies.txt";
const PYTHON_BIN = process.env.PYTHON_BIN || "python"; // use "python3" if needed

// ---------- npm ffmpeg (no system install needed) ----------
let FFMPEG_BIN = process.env.FFMPEG_BIN;

if (!FFMPEG_BIN) {
  try {
    // ffmpeg-static returns full path or null
    FFMPEG_BIN = require("ffmpeg-static");
  } catch {}
}

if (!FFMPEG_BIN) {
  try {
    // @ffmpeg-installer/ffmpeg returns { path }
    FFMPEG_BIN = require("@ffmpeg-installer/ffmpeg").path;
  } catch {}
}

if (!FFMPEG_BIN) {
  // last fallback (system ffmpeg)
  FFMPEG_BIN = "ffmpeg";
}
// ----------------------------------------------------------

const MAX_DURATION_SECONDS = 1800; // 30 min
const MAX_FILE_MB = 95;

const DEFAULT_QUALITY = 720;
const ALLOWED_QUALITIES = new Set([144, 240, 360, 480, 720, 1080]);

const s = (v) => (v == null ? "" : String(v));

function waSafe(text, maxLen = 900) {
  let t = s(text);
  try { t = t.normalize("NFKC"); } catch {}
  t = t.replace(/[\u0000-\u001F\u007F]/g, ""); // remove control chars
  // break WA markdown chars
  t = t.replace(/\*/g, "✱").replace(/_/g, "ˍ").replace(/~/g, "˷").replace(/`/g, "ˋ");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > maxLen) t = t.slice(0, maxLen - 1) + "…";
  return t;
}

function run(bin, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function ffmpegOk() {
  try {
    if (FFMPEG_BIN && FFMPEG_BIN !== "ffmpeg") {
      const exists = await fs.pathExists(FFMPEG_BIN);
      if (!exists) return false;
    }
    await run(FFMPEG_BIN, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

function isYoutubeUrl(str) {
  return /(?:youtube\.com|youtu\.be)/i.test(s(str));
}

function getArgsText(m, q) {
  const qStr = s(q);
  if (qStr) return qStr;

  const body =
    s(m?.body) ||
    s(m?.text) ||
    s(m?.message?.conversation) ||
    s(m?.message?.extendedTextMessage?.text) ||
    "";

  return body.replace(/^[.!/#]?\s*video\b/i, "").trim();
}

// ".video 480 <query>" OR ".video <query>" (default 720)
function parseQualityFirst(argsText) {
  const text = s(argsText).trim();
  if (!text) return { quality: DEFAULT_QUALITY, query: "" };

  const parts = text.split(/\s+/).filter(Boolean);
  const first = s(parts[0]).toLowerCase();
  const m = first.match(/^(\d{3,4})p?$/);

  if (m) {
    const qNum = Number(m[1]);
    if (ALLOWED_QUALITIES.has(qNum)) {
      parts.shift();
      return { quality: qNum, query: parts.join(" ").trim() };
    }
  }

  return { quality: DEFAULT_QUALITY, query: text };
}

function parseDurationToSeconds(timestamp) {
  if (!timestamp) return 0;
  const parts = String(timestamp).split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function formatViews(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return waSafe(v || "Unknown");
  try {
    return new Intl.NumberFormat("en", { notation: "compact" }).format(n);
  } catch {
    return String(n);
  }
}

async function findDownloadedFile(dir) {
  const files = await fs.readdir(dir);
  const candidates = [];
  for (const f of files) {
    if (f.endsWith(".part")) continue;
    const full = path.join(dir, f);
    const st = await fs.stat(full);
    if (st.isFile()) candidates.push({ full, size: st.size });
  }
  candidates.sort((a, b) => b.size - a.size);
  return candidates[0]?.full || null;
}

cmd(
  {
    pattern: "video",
    ownerOnly: true,
    react: "🎬",
    desc: "WhatsApp playable video | .video 480 <name/url> (default 720)",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    const id = Date.now();
    const tempDir = `./temp/${id}`;

    try {
      const argsText = getArgsText(m, q);
      const { quality, query } = parseQualityFirst(argsText);

      if (!query) {
        return reply(
          "*Usage:*\n.video 480 <name/url>\n\n*Examples:*\n.video 480 despacito\n.video 720 https://youtube.com/shorts/xxxxx"
        );
      }

      if (!(await ffmpegOk())) {
        return reply("❌ FFmpeg (npm) not found. Install: `npm i ffmpeg-static` (or `npm i @ffmpeg-installer/ffmpeg`).");
      }

      await fs.ensureDir(tempDir);

      // Meta for thumbnail
      const search = await ytsr(query);
      const info = search?.videos?.[0] || null;

      if (!isYoutubeUrl(query) && !info?.videoId) {
        await fs.remove(tempDir);
        return reply("❌ Video not found.");
      }

      const videoUrl = isYoutubeUrl(query)
        ? s(query).trim()
        : `https://www.youtube.com/watch?v=${s(info.videoId)}`;

      // Duration limit
      const totalSeconds = parseDurationToSeconds(info?.timestamp);
      if (totalSeconds && totalSeconds > MAX_DURATION_SECONDS) {
        await fs.remove(tempDir);
        return reply("⏱️ Video limit is 30 minutes.");
      }

      // Send thumbnail + meta
      if (info?.thumbnail) {
        const caption =
          `🎥 *${waSafe(info?.title || "YouTube Video")}*\n` +
          `📺 *Channel:* ${waSafe(info?.author?.name || info?.author || "Unknown")}\n` +
          `🕒 *Duration:* ${waSafe(info?.timestamp || "Unknown")}\n` +
          `👁 *Views:* ${formatViews(info?.views)}\n` +
          `📅 *Uploaded:* ${waSafe(info?.ago || "Unknown")}\n` +
          `📦 *Quality:* ${quality}p\n` +
          `🔗 ${waSafe(videoUrl, 400)}\n\n` +
          `⏳ Downloading…`;

        await robin.sendMessage(from, { image: { url: info.thumbnail }, caption }, { quoted: mek });
      }

      // 1) Download with pip yt-dlp
      const outTpl = path.join(tempDir, "input.%(ext)s");
      const ytdlpArgs = [
        videoUrl,
        "--no-playlist",
        "--match-filter",
        `duration <= ${MAX_DURATION_SECONDS}`,
        "--max-filesize",
        `${MAX_FILE_MB}M`,
        "-o",
        outTpl,
        "--no-warnings",
        "--quiet",
        "-f",
        `bv*[height<=${quality}]+ba/b[height<=${quality}]/best[height<=${quality}]`,
      ];

      if (await fs.pathExists(COOKIES_PATH)) {
        ytdlpArgs.push("--cookies", COOKIES_PATH);
      }

      await run(PYTHON_BIN, ["-m", "yt_dlp", ...ytdlpArgs], process.cwd());

      const inputFile = await findDownloadedFile(tempDir);
      if (!inputFile) {
        await fs.remove(tempDir);
        return reply("❌ Download failed (no file created).");
      }

      // 2) Re-encode to WhatsApp-playable MP4 (H.264 baseline + AAC + faststart)
      const waMp4 = path.join(tempDir, "wa.mp4");
      const vf = `scale=-2:'min(${quality},ih)'`;

      const ffArgs = [
        "-y",
        "-i", inputFile,

        // map video + (optional) audio, avoids errors if no audio
        "-map", "0:v:0",
        "-map", "0:a:0?",

        "-vf", vf,
        "-r", "60",

        "-c:v", "libx264",
        "-profile:v", "baseline",
        "-level", "3.1",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "20",

        "-c:a", "aac",
        "-b:a", "320k",
        "-ac", "2",
        "-ar", "44100",

        "-movflags", "+faststart",
        waMp4,
      ];

      await run(FFMPEG_BIN, ffArgs, process.cwd());

      // Size check
      const st = await fs.stat(waMp4);
      const sizeMB = st.size / (1024 * 1024);
      if (sizeMB > MAX_FILE_MB) {
        await fs.remove(tempDir);
        return reply(`📦 Video too large (${sizeMB.toFixed(1)}MB). Try lower quality: .video 480 <name/url>`);
      }

      // Send playable video
      await robin.sendMessage(from, { video: { url: waMp4 }, mimetype: "video/mp4" }, { quoted: mek });

      await fs.remove(tempDir);
      return;
    } catch (e) {
      console.error("❌ Error:", e?.stderr || e);
      await fs.remove(tempDir).catch(() => {});
      return reply(`❌ Error: ${e.message}`);
    }
  }
);
