const { cmd } = require("../command");
const ytsr = require("yt-search");
const fs = require("fs-extra");
const path = require("path");
const { execFile } = require("child_process");

/* ================= CONFIG ================= */
const PYTHON_BIN = process.env.PYTHON_BIN || "python"; // use python3 if needed

const MAX_DURATION_SECONDS = 1800; // 30 min
const MAX_FILE_MB = 95;

const DEFAULT_QUALITY = 720;
const ALLOWED_QUALITIES = new Set([144, 240, 360, 480, 720, 1080]);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/* ================= FFMPEG PATH (npm) ================= */
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
if (!FFMPEG_BIN) FFMPEG_BIN = "ffmpeg";

/* ================= COOKIES AUTO FIND ================= */
const COOKIE_CANDIDATES = [
  path.join(process.cwd(), "cookies/youtube_cookies.txt"),
  path.join(__dirname, "../cookies/youtube_cookies.txt"),
  "/workspaces/-/cookies/youtube_cookies.txt",
];

function findCookiesFile() {
  return COOKIE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

/* ================= HELPERS ================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = (v) => (v == null ? "" : String(v));

function waSafe(text, maxLen = 900) {
  let t = s(text);
  try {
    t = t.normalize("NFKC");
  } catch {}
  t = t.replace(/[\u0000-\u001F\u007F]/g, "");
  t = t.replace(/\*/g, "✱").replace(/_/g, "ˍ").replace(/~/g, "˷").replace(/`/g, "ˋ");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > maxLen) t = t.slice(0, maxLen - 1) + "…";
  return t;
}

function tailLines(text = "", n = 16) {
  return String(text).split("\n").filter(Boolean).slice(-n).join("\n");
}

function run(bin, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 80 }, // 80MB buffer
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
  if (q) return s(q);

  const body =
    s(m?.body) ||
    s(m?.text) ||
    s(m?.message?.conversation) ||
    s(m?.message?.extendedTextMessage?.text) ||
    "";

  return body.replace(/^[.!/#]?\s*video\b/i, "").trim();
}

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

/* ================= ERROR REASON ================= */
function detectReasonFromText(text = "") {
  const t = String(text).toLowerCase();

  if (t.includes("sign in to confirm") || t.includes("not a bot"))
    return "YouTube bot-check (cookies expired / not accepted)";
  if (t.includes("signature solving failed") || t.includes("challenge solving failed"))
    return "Signature solver failed (EJS / JS runtime issue)";
  if (t.includes("private video") || t.includes("login required"))
    return "Login required / Private video";
  if (t.includes("429") || t.includes("too many requests"))
    return "429 Rate limited";
  if (t.includes("403") || t.includes("forbidden"))
    return "403 Forbidden (blocked)";
  if (t.includes("video unavailable") || t.includes("not available"))
    return "Video unavailable / removed";
  if (t.includes("downloaded file is empty"))
    return "Downloaded file empty (blocked / cookie issue)";
  if (t.includes("ffmpeg"))
    return "FFmpeg conversion error";

  return "Unknown";
}

/* ================= yt-dlp DOWNLOAD (BEST QUALITY) ================= */
async function ytdlpDownload(videoUrl, outTpl, quality, cookiesPath) {
  const clients = ["android", "web", "tv"];
  const formatRule =
    `bv*[height<=${quality}]+ba/best[height<=${quality}]/best`; // ✅ best possible (vp9 ok)

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

        "--remote-components", "ejs:github",
        "--js-runtimes", "node",

        "--extractor-args", `youtube:player_client=${client}`,

        "--match-filter", `duration <= ${MAX_DURATION_SECONDS}`,
        "--max-filesize", `${MAX_FILE_MB}M`,

        "-o", outTpl,
        "-f", formatRule,
      ];

      if (cookiesPath && (await fs.pathExists(cookiesPath))) {
        args.push("--cookies", cookiesPath);
      }

      await run(PYTHON_BIN, ["-m", "yt_dlp", ...args], process.cwd());
      return client;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  throw lastErr || new Error("yt-dlp failed");
}

/* ================= COMPRESS TO FIT (KEEP QUALITY) ================= */
async function compressToFit(inputFile, outFile, quality, maxMb) {
  const CRF_TRIES = [18, 19, 20, 21, 22, 24, 26, 28];
  const AUDIO_K = 160; // ✅ better than 128 but still small

  // ✅ FIXED FILTER (escape comma)
  const vf = `scale=-2:min(${quality}\\,ih)`;

  for (const crf of CRF_TRIES) {
    const args = [
      "-y",
      "-i", inputFile,

      "-map", "0:v:0",
      "-map", "0:a:0?",

      "-vf", vf,
      "-r", "30",

      "-c:v", "libx264",
      "-preset", "slow",
      "-crf", String(crf),
      "-profile:v", "main",
      "-pix_fmt", "yuv420p",

      "-c:a", "aac",
      "-b:a", `${AUDIO_K}k`,
      "-ac", "2",
      "-ar", "44100",

      "-movflags", "+faststart",
      outFile,
    ];

    await run(FFMPEG_BIN, args, process.cwd());

    const st = await fs.stat(outFile);
    const sizeMB = st.size / (1024 * 1024);

    if (sizeMB <= maxMb) {
      return { crfUsed: crf, sizeMB };
    }

    await sleep(200);
  }

  const st = await fs.stat(outFile);
  return { crfUsed: CRF_TRIES[CRF_TRIES.length - 1], sizeMB: st.size / (1024 * 1024) };
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
          "❌ FFmpeg not found.\nInstall:\n`npm i ffmpeg-static`\n(or `npm i @ffmpeg-installer/ffmpeg`)"
        );
      }

      await fs.ensureDir(tempDir);

      const COOKIES_PATH = findCookiesFile();
      if (!COOKIES_PATH) {
        await fs.remove(tempDir);
        return reply(
          "❌ YouTube cookies not found!\n\nPut cookies in:\n• /cookies/youtube_cookies.txt"
        );
      }

      const search = await ytsr(query);
      const info = search?.videos?.[0] || null;

      if (!isYoutubeUrl(query) && !info?.videoId) {
        await fs.remove(tempDir);
        return reply("❌ Video not found.");
      }

      const videoUrl = isYoutubeUrl(query)
        ? s(query).trim()
        : `https://www.youtube.com/watch?v=${s(info.videoId)}`;

      const totalSeconds = parseDurationToSeconds(info?.timestamp);
      if (totalSeconds && totalSeconds > MAX_DURATION_SECONDS) {
        await fs.remove(tempDir);
        return reply("⏱️ Video limit is 30 minutes.");
      }

      if (info?.thumbnail) {
        const caption =
          `🎥 *${waSafe(info?.title || "YouTube Video")}*\n` +
          `📺 *Channel:* ${waSafe(info?.author?.name || info?.author || "Unknown")}\n` +
          `🕒 *Duration:* ${waSafe(info?.timestamp || "Unknown")}\n` +
          `👁 *Views:* ${formatViews(info?.views)}\n` +
          `📦 *Quality:* ${quality}p\n` +
          `🍪 Cookies: ✅ Loaded\n\n` +
          `⏳ Downloading best quality…`;

        await robin.sendMessage(from, { image: { url: info.thumbnail }, caption }, { quoted: mek });
      }

      // ✅ Download best quality first
      const outTpl = path.join(tempDir, "input.%(ext)s");

      let clientUsed = "unknown";
      try {
        clientUsed = await ytdlpDownload(videoUrl, outTpl, quality, COOKIES_PATH);
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

      // ✅ Compress to WhatsApp MP4 (keep quality, fit size)
      const waMp4 = path.join(tempDir, "wa.mp4");

      const { crfUsed, sizeMB } = await compressToFit(inputFile, waMp4, quality, MAX_FILE_MB);

      if (!(await fs.pathExists(waMp4))) {
        await fs.remove(tempDir);
        return reply("❌ FFmpeg failed to create output.");
      }

      if (sizeMB > MAX_FILE_MB) {
        await fs.remove(tempDir);
        return reply(
          `📦 Video still too big (${sizeMB.toFixed(1)}MB).\nTry lower quality:\n.video 480 <name/url>`
        );
      }

      // ✅ Send as NORMAL VIDEO (not document)
      await robin.sendMessage(
        from,
        {
          video: { url: waMp4 },
          mimetype: "video/mp4",
          caption:
            `✅ Done!\n` +
            `🎥 Quality: ${quality}p\n` +
            `⚙️ CRF: ${crfUsed}\n` +
            `📦 Size: ${sizeMB.toFixed(1)}MB\n` +
            `🎯 Client: ${clientUsed}`,
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
