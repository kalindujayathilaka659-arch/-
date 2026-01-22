const { cmd } = require("../command");
const ytsr = require("yt-search");
const fs = require("fs-extra");
const path = require("path");
const { execFile } = require("child_process");

const PYTHON_BIN = process.env.PYTHON_BIN || "python"; // use "python3" if needed

// ---------- npm ffmpeg (no system install needed) ----------
let FFMPEG_BIN = process.env.FFMPEG_BIN;

if (!FFMPEG_BIN) {
  try {
    FFMPEG_BIN = require("ffmpeg-static");
  } catch {}
}

if (!FFMPEG_BIN) {
  try {
    FFMPEG_BIN = require("@ffmpeg-installer/ffmpeg").path;
  } catch {}
}

if (!FFMPEG_BIN) {
  FFMPEG_BIN = "ffmpeg";
}
// ----------------------------------------------------------

/* ================= CONFIG ================= */
const MAX_DURATION_SECONDS = 1800; // 30 min
const MAX_FILE_MB = 95;

const DEFAULT_QUALITY = 720;
const ALLOWED_QUALITIES = new Set([144, 240, 360, 480, 720, 1080]);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/* ================= COOKIES AUTO FIND ================= */
const COOKIE_CANDIDATES = [
  path.join(process.cwd(), "cookies/youtube_cookies.txt"),
  path.join(__dirname, "../cookies/youtube_cookies.txt"),
  // ✅ your workspace path
  "/workspaces/-/cookies/youtube_cookies.txt",
];

function findCookiesFile() {
  return COOKIE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

/* ================= HELPERS ================= */
const s = (v) => (v == null ? "" : String(v));

function waSafe(text, maxLen = 900) {
  let t = s(text);
  try {
    t = t.normalize("NFKC");
  } catch {}
  t = t.replace(/[\u0000-\u001F\u007F]/g, ""); // remove control chars
  t = t.replace(/\*/g, "✱").replace(/_/g, "ˍ").replace(/~/g, "˷").replace(/`/g, "ˋ");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > maxLen) t = t.slice(0, maxLen - 1) + "…";
  return t;
}

function tailLines(text = "", n = 14) {
  return String(text).split("\n").filter(Boolean).slice(-n).join("\n");
}

function detectReasonFromText(text = "") {
  const t = String(text).toLowerCase();

  if (t.includes("sign in to confirm") || t.includes("not a bot"))
    return "YouTube bot-check (cookies expired / not accepted)";
  if (t.includes("signature solving failed") || t.includes("challenge solving failed"))
    return "EJS signature solver failed (JS runtime missing)";
  if (t.includes("private video") || t.includes("login required"))
    return "Login required / Private video";
  if (t.includes("429") || t.includes("too many requests"))
    return "429 Rate limited";
  if (t.includes("403") || t.includes("forbidden"))
    return "403 Forbidden (blocked)";
  if (t.includes("video unavailable") || t.includes("not available"))
    return "Video unavailable / removed";
  if (t.includes("downloaded file is empty"))
    return "Downloaded file empty (blocked / cookies issue)";
  if (t.includes("ffmpeg"))
    return "FFmpeg conversion error";

  return "Unknown";
}

function run(bin, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 50 }, // 50MB buffer
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout || "";
          err.stderr = stderr || "";
          return reject(err);
        }
        resolve({ stdout: stdout || "", stderr: stderr || "" });
      }
    );
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

/* ================= YT-DLP DOWNLOAD WITH RETRY ================= */
async function ytdlpDownload(videoUrl, outTpl, quality, cookiesPath) {
  // ✅ try different clients (helps bot-check sometimes)
  const clients = ["android", "web", "tv"];

  // ✅ format: prefer mp4 when possible, fallback to best
  const formatRule =
    `bv*[height<=${quality}][ext=mp4]+ba[ext=m4a]/` +
    `bv*[height<=${quality}]+ba/` +
    `b[height<=${quality}]/best[height<=${quality}]`;

  let lastErr = null;

  for (const client of clients) {
    try {
      const args = [
        videoUrl,
        "--no-playlist",
        "--no-warnings",
        "--quiet",

        "--retries", "5",
        "--fragment-retries", "5",
        "--socket-timeout", "20",

        "--user-agent", UA,
        "--referer", "https://www.youtube.com/",

        // ✅ EJS signature solver
        "--remote-components", "ejs:github",
        "--js-runtimes", "node",

        // ✅ client
        "--extractor-args", `youtube:player_client=${client}`,

        // limits
        "--match-filter", `duration <= ${MAX_DURATION_SECONDS}`,
        "--max-filesize", `${MAX_FILE_MB}M`,

        "-o", outTpl,
        "-f", formatRule,
      ];

      if (cookiesPath && (await fs.pathExists(cookiesPath))) {
        args.push("--cookies", cookiesPath);
      }

      await run(PYTHON_BIN, ["-m", "yt_dlp", ...args], process.cwd());
      return { clientUsed: client }; // success
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  throw lastErr || new Error("yt-dlp failed");
}

/* ================= COMMAND ================= */
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
          "*Usage:*\n.video 480 <name/url>\n\n*Examples:*\n.video 480 despacito\n.video 720 https://youtube.com/watch?v=xxxxx"
        );
      }

      if (!(await ffmpegOk())) {
        return reply(
          "❌ FFmpeg (npm) not found.\nInstall:\n`npm i ffmpeg-static`\n(or `npm i @ffmpeg-installer/ffmpeg`)"
        );
      }

      await fs.ensureDir(tempDir);

      // ✅ cookies file
      const COOKIES_PATH = findCookiesFile();
      if (!COOKIES_PATH) {
        await fs.remove(tempDir);
        return reply(
          "❌ YouTube cookies not found!\n\n✅ Put cookies in:\n" +
            "• /cookies/youtube_cookies.txt\nor\n• /cookies/yt.txt"
        );
      }

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
          `🍪 Cookies: ✅ Loaded\n\n` +
          `⏳ Downloading…`;

        await robin.sendMessage(from, { image: { url: info.thumbnail }, caption }, { quoted: mek });
      }

      // 1) Download with yt-dlp (python) + EJS + cookies
      const outTpl = path.join(tempDir, "input.%(ext)s");

      let clientUsed = "unknown";
      try {
        const r = await ytdlpDownload(videoUrl, outTpl, quality, COOKIES_PATH);
        clientUsed = r.clientUsed;
      } catch (e) {
        const out = (e?.stderr || "") + "\n" + (e?.stdout || "") + "\n" + (e?.message || "");
        const reason = detectReasonFromText(out);

        await fs.remove(tempDir);
        return reply(
          `❌ Download failed.\n🧠 Reason: *${reason}*\n` +
            `📌 yt-dlp output:\n\`\`\`\n${tailLines(out, 18)}\n\`\`\``
        );
      }

      const inputFile = await findDownloadedFile(tempDir);
      if (!inputFile) {
        await fs.remove(tempDir);
        return reply("❌ Download failed (no file created).");
      }

      // 2) Convert to WhatsApp-playable MP4 (H.264 baseline + AAC 320k + faststart)
      const waMp4 = path.join(tempDir, "wa.mp4");

      const vf = `scale=-2:'min(${quality},ih)'`;

      const ffArgs = [
        "-y",
        "-i", inputFile,

        "-map", "0:v:0",
        "-map", "0:a:0?",

        "-vf", vf,
        "-r", "30", // ✅ smaller than 60, still smooth

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
        return reply(
          `📦 Video too large (${sizeMB.toFixed(1)}MB).\nTry lower quality:\n.video 480 <name/url>`
        );
      }

      // ✅ Send playable video
      await robin.sendMessage(
        from,
        {
          video: { url: waMp4 },
          mimetype: "video/mp4",
          caption: `✅ Done (${quality}p)\n🎯 Client: ${clientUsed}`,
        },
        { quoted: mek }
      );

      await fs.remove(tempDir);
      return;
    } catch (e) {
      console.error("❌ Error:", e?.stderr || e);
      await fs.remove(tempDir).catch(() => {});
      return reply(`❌ Error: ${e.message}`);
    }
  }
);
