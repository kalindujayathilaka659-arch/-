const { cmd } = require("../command");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

/* ================= CONFIG ================= */
const COOKIE_FILE = path.join(__dirname, "../cookies/eporner.txt");

const UA =
  process.env.EP_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FORCE_AUDIO_BITRATE = "320k"; // AAC 320kbps

// Quality selector
const ALLOWED_QUALITIES = [360, 480, 720, 1080];
const DEFAULT_QUALITY = 720;
const MAX_CAP_QUALITY = 1080;

// GitHub runners => python3
const PYTHON_BIN =
  process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

// SPEED TUNING (env overridable)
const USE_ARIA2C = String(process.env.EP_USE_ARIA2C || "1") !== "0"; // default ON
const ARIA_CONN = String(process.env.EP_ARIA_CONN || "16"); // 8-16 recommended
const CONCURRENT_FRAGMENTS = String(process.env.EP_FRAGMENTS || "32"); // 20-32 good
const HTTP_CHUNK = String(process.env.EP_HTTP_CHUNK || "20M"); // helps some servers

// Optional speed toggles
const SEND_THUMB = String(process.env.EP_THUMB || "1") !== "0"; // set 0 to skip thumb
const DO_AUDIO_FIX = String(process.env.EP_AUDIO_FIX || "1") !== "0"; // set 0 to skip AAC fix

// Auto update yt-dlp (can disable with AUTO_UPDATE_YTDLP=0)
let YTDLP_UPDATED = false;

/* ================= HELPERS ================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeFileName(name, max = 80) {
  return (name || "eporner")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function isValidEpornerUrl(url) {
  const s = String(url || "");
  return s.includes("eporner.com");
}

function tailLines(text = "", maxLines = 10) {
  const lines = String(text).split("\n").filter(Boolean);
  return lines.slice(-maxLines).join("\n");
}

function execBin(bin, args, label = "EXEC") {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { maxBuffer: 1024 * 1024 * 50, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          err._stdout = stdout || "";
          err._stderr = stderr || "";
          console.error(`\n❌ ${label} FAILED`);
          console.error("Exit:", err.code);
          console.error("STDERR:\n", err._stderr || "(empty)");
          console.error("STDOUT:\n", err._stdout || "(empty)");
          return reject(err);
        }
        resolve({ stdout: stdout || "", stderr: stderr || "" });
      }
    );
  });
}

// Run yt-dlp using python module (Actions safe)
function runYtDlpPy(args, label = "yt-dlp(py)") {
  return execBin(PYTHON_BIN, ["-m", "yt_dlp", ...args], label);
}

// Spawn yt-dlp python (silent, no WhatsApp progress)
function spawnYtDlpPy(args) {
  return spawn(PYTHON_BIN, ["-m", "yt_dlp", ...args], { windowsHide: true });
}

// Reason detector
function detectReasonFromText(text = "") {
  const t = String(text).toLowerCase();

  if (t.includes("keyerror") || t.includes("extractor error"))
    return "yt-dlp extractor outdated (update yt-dlp)";

  if (t.includes("cookie")) return "Cookies expired / invalid";
  if (t.includes("403") || t.includes("forbidden")) return "403 Forbidden (blocked)";
  if (t.includes("404") || t.includes("not found")) return "404 Not Found (removed)";
  if (t.includes("429") || t.includes("too many requests")) return "429 Rate limited";
  if (t.includes("cloudflare") || t.includes("captcha")) return "Cloudflare / Captcha blocked";

  if (t.includes("unable to download webpage")) return "Blocked / site changed / network issue";
  if (t.includes("name resolution") || t.includes("enotfound")) return "DNS error / No internet";
  if (t.includes("timed out") || t.includes("timeout")) return "Timeout / Slow network";
  if (t.includes("connection refused") || t.includes("econnrefused")) return "Connection refused";
  if (t.includes("connection reset") || t.includes("econnreset")) return "Connection reset";

  if (t.includes("tls") || t.includes("ssl")) return "SSL/TLS handshake error";
  if (t.includes("private") || t.includes("login") || t.includes("sign in"))
    return "Login required / restricted";

  if (t.includes("requested format is not available") || t.includes("no video formats"))
    return "Requested quality not available";

  if (t.includes("not available") || t.includes("removed") || t.includes("this video is not"))
    return "Video removed / unavailable";

  if (t.includes("ffmpeg")) return "FFmpeg merge error";

  return "Unknown";
}

function detectReason(err) {
  const t = (err?._stderr || "") + "\n" + (err?._stdout || "");
  return detectReasonFromText(t);
}

/* ================= AUTO UPDATE yt-dlp ================= */
async function ensureLatestYtDlp() {
  if (YTDLP_UPDATED) return;
  YTDLP_UPDATED = true;

  if (String(process.env.AUTO_UPDATE_YTDLP || "1") === "0") return;

  try {
    // Nightly via pip --pre (good for broken extractors)
    await execBin(
      PYTHON_BIN,
      ["-m", "pip", "install", "-U", "--pre", "yt-dlp[default]"],
      "pip yt-dlp update"
    );
  } catch (e) {
    console.log("⚠ yt-dlp update skipped:", e?.message || e);
  }
}

/* ================= QUALITY PARSER ================= */
function parseQualityAndUrl(q = "") {
  const parts = String(q).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { quality: DEFAULT_QUALITY, url: "" };

  let quality = DEFAULT_QUALITY;
  let url = String(q).trim();

  if (parts.length > 1) {
    const first = parts[0].toLowerCase().replace("p", "");
    const maybe = parseInt(first, 10);
    if (ALLOWED_QUALITIES.includes(maybe)) {
      quality = maybe;
      url = parts.slice(1).join(" ");
    }
  }

  if (quality > MAX_CAP_QUALITY) quality = MAX_CAP_QUALITY;
  return { quality, url: String(url || "").trim() };
}

/* ================= METADATA GETTER (RETRY) ================= */
async function getMetadata(url) {
  const attempts = [
    {
      label: "EPORNER META (cookie)",
      args: [
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--cookies",
        COOKIE_FILE,
        "--user-agent",
        UA,
        "--referer",
        "https://www.eporner.com/",
        url,
      ],
    },
    {
      label: "EPORNER META (no-cookie)",
      args: ["--dump-single-json", "--no-warnings", "--no-playlist", url],
    },
  ];

  let lastErr = null;

  for (const item of attempts) {
    for (let i = 0; i < 2; i++) {
      try {
        const { stdout } = await runYtDlpPy(item.args, `${item.label} try#${i + 1}`);
        return JSON.parse(stdout);
      } catch (e) {
        lastErr = e;
        await sleep(600);
      }
    }
  }

  throw lastErr || new Error("Metadata failed");
}

/* ================= MP4/H264 HEIGHT PICKER ================= */
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

/* ================= THUMB FIX (WHATSAPP MOBILE) ================= */
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
    COOKIE_FILE,
    "--user-agent",
    UA,
    "--referer",
    "https://www.eporner.com/",

    "--ffmpeg-location",
    ffmpegPath,

    "-o",
    outTpl,
    url,
  ];

  try {
    await runYtDlpPy(args, "EPORNER THUMB");
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

/* ================= FIND DOWNLOADED MP4 ================= */
function findMp4InDir(tempDir) {
  const files = fs.readdirSync(tempDir);
  const mp4 = files.find(
    (f) => f.endsWith(".mp4") && !f.includes(".part") && !f.includes(".ytdl")
  );
  return mp4 ? path.join(tempDir, mp4) : null;
}

/* ================= SPEED DOWNLOAD (aria2c + fallback) ================= */
function ariaMissingReason(text = "") {
  const t = String(text).toLowerCase();
  return (
    t.includes("aria2c") &&
    (t.includes("not found") ||
      t.includes("no such file") ||
      t.includes("is not recognized") ||
      t.includes("could not run"))
  );
}

async function runDownloadWithFallback({ url, outputTemplate, formatRule }) {
  const baseArgs = [
    "--no-warnings",
    "--no-playlist",

    "--cookies",
    COOKIE_FILE,
    "--user-agent",
    UA,
    "--referer",
    "https://www.eporner.com/",

    "--retries",
    "10",
    "--fragment-retries",
    "10",
    "--socket-timeout",
    "20",

    "--concurrent-fragments",
    CONCURRENT_FRAGMENTS,
    "--http-chunk-size",
    HTTP_CHUNK,

    "--ffmpeg-location",
    ffmpegPath,

    "-f",
    formatRule,
    "--merge-output-format",
    "mp4",

    "-o",
    outputTemplate,
    url,
  ];

  // try aria2c first
  if (USE_ARIA2C) {
    const ariaArgs = [
      ...baseArgs,
      "--downloader",
      "aria2c",
      "--downloader-args",
      `aria2c:-x ${ARIA_CONN} -s ${ARIA_CONN} -k 1M --file-allocation=none --summary-interval=0`,
    ];

    let logText = "";
    const p = spawnYtDlpPy(ariaArgs);

    p.stderr.on("data", (d) => {
      logText += d.toString();
      if (logText.length > 40000) logText = logText.slice(-40000);
    });
    p.stdout.on("data", (d) => {
      logText += d.toString();
      if (logText.length > 40000) logText = logText.slice(-40000);
    });

    const code = await new Promise((r) => p.on("close", r));
    if (code === 0) return { ok: true, used: "aria2c", logText };

    // aria missing -> fallback to native
    if (!ariaMissingReason(logText)) {
      return { ok: false, used: "aria2c", logText };
    }
    console.log("⚠ aria2c missing -> fallback to native downloader");
  }

  // fallback native
  let logText = "";
  const p2 = spawnYtDlpPy(baseArgs);

  p2.stderr.on("data", (d) => {
    logText += d.toString();
    if (logText.length > 40000) logText = logText.slice(-40000);
  });
  p2.stdout.on("data", (d) => {
    logText += d.toString();
    if (logText.length > 40000) logText = logText.slice(-40000);
  });

  const code2 = await new Promise((r) => p2.on("close", r));
  if (code2 === 0) return { ok: true, used: "native", logText };
  return { ok: false, used: "native", logText };
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "eporner",
    ownerOnly: true,
    react: "💋",
    desc: "Eporner downloader (fast aria2c + silent, thumb fixed, H264 MP4 + AAC 320k)",
    category: "download",
    filename: __filename,
  },
  async (bot, msg, m, { from, q, reply }) => {
    let tempDir = null;

    try {
      if (!q) {
        return reply(
          "⚠️ *Usage:*\n" +
            "`.eporner <url>`\n" +
            "`.eporner 360 <url>`\n" +
            "`.eporner 480 <url>`\n" +
            "`.eporner 720 <url>`\n" +
            "`.eporner 1080 <url>`"
        );
      }

      if (!ffmpegPath) {
        return reply("❌ ffmpeg-static missing (needed for thumb convert + AAC fix)");
      }

      if (!fs.existsSync(COOKIE_FILE)) {
        return reply("❌ *Cookie file missing*\nAdd: `/cookies/eporner.txt`");
      }

      await ensureLatestYtDlp();

      const parsed = parseQualityAndUrl(q);
      let quality = parsed.quality;
      const url = parsed.url;

      if (!isValidEpornerUrl(url)) {
        return reply("❌ Invalid URL. Please provide an eporner.com link.");
      }

      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eporner-"));

      /* ================= METADATA ================= */
      let info = null;
      try {
        info = await getMetadata(url);
      } catch (e) {
        const reason = detectReason(e);
        const snippet = tailLines(e?._stderr || e?._stdout || "", 10);
        return reply(
          `❌ Metadata failed.\n🧠 Reason: *${reason}*\n\n` +
            `📌 Details:\n\`\`\`\n${snippet || "No output"}\n\`\`\``
        );
      }

      const title = info.title || "Eporner Video";
      const uploader = info.uploader || "N/A";
      const views = info.view_count ? info.view_count.toLocaleString() : "N/A";
      const likes = info.like_count ? info.like_count.toLocaleString() : "N/A";
      const rating = info.average_rating || "N/A";
      const duration = info.duration_string || "N/A";

      // choose max available mp4/h264 <= requested
      const playableHeights = getPlayableMp4Heights(info);
      const maxAvailable = playableHeights.length
        ? Math.min(Math.max(...playableHeights), MAX_CAP_QUALITY)
        : quality;

      if (quality > maxAvailable) {
        await reply(
          `⚠ Requested ${quality}p not available (MP4/H.264). Downloading ${maxAvailable}p instead.`
        );
        quality = maxAvailable;
      }

      const caption =
        `🎬 *${title}*\n` +
        `👤 Uploader: ${uploader}\n` +
        `📊 Views: ${views}\n` +
        `👍 Likes: ${likes}\n` +
        `⭐ Rating: ${rating}\n` +
        `⏳ Duration: ${duration}\n` +
        `🎥 Quality: *≤${quality}p*\n` +
        `🎞 Video: *H.264 (prefer avc1)*\n` +
        `🎧 Audio Final: *AAC ${FORCE_AUDIO_BITRATE}*\n\n` +
        `📥 *Downloading…*`;

      // ✅ send thumb (local) OR text (no progress spam)
      if (SEND_THUMB) {
        const thumbPath = await downloadThumbJpg({ url, tempDir });
        if (thumbPath && fs.existsSync(thumbPath)) {
          await bot.sendMessage(from, { image: { url: thumbPath }, caption }, { quoted: msg });
        } else {
          await bot.sendMessage(from, { text: caption }, { quoted: msg });
        }
      } else {
        await bot.sendMessage(from, { text: caption }, { quoted: msg });
      }

      /* ================= DOWNLOAD FAST (aria2c) ================= */
      const formatRule =
        `bv*[ext=mp4][vcodec^=avc1][height<=${quality}]+ba[ext=m4a][acodec^=mp4a]/` +
        `bv*[ext=mp4][height<=${quality}]+ba[ext=m4a]/` +
        `b[ext=mp4][vcodec^=avc1][height<=${quality}]/` +
        `b[ext=mp4][height<=${quality}]/` +
        `best[ext=mp4][height<=${quality}]`;

      const outputTemplate = path.join(tempDir, `ep_%(id)s.%(ext)s`);

      const dl = await runDownloadWithFallback({
        url,
        outputTemplate,
        formatRule,
      });

      const downloadedMp4 = findMp4InDir(tempDir);

      if (!dl.ok || !downloadedMp4 || !fs.existsSync(downloadedMp4)) {
        const reason = detectReasonFromText(dl.logText || "");
        const snippet = tailLines(dl.logText || "", 12);
        return reply(
          `❌ *Download failed* (${dl.used})\n🧠 Reason: *${reason}*\n\n` +
            `📌 Details:\n\`\`\`\n${snippet || "No output"}\n\`\`\``
        );
      }

      const sizeBytes = fs.statSync(downloadedMp4).size;
      if (sizeBytes < 300 * 1024) {
        const reason = detectReasonFromText(dl.logText || "");
        const snippet = tailLines(dl.logText || "", 12);
        return reply(
          `❌ *Download failed (empty file)*\n🧠 Reason: *${reason}*\n\n` +
            `📌 Details:\n\`\`\`\n${snippet || "No output"}\n\`\`\``
        );
      }

      /* ================= AUDIO FIX (optional for speed) ================= */
      let sendPath = downloadedMp4;

      if (DO_AUDIO_FIX) {
        const fixedFile = path.join(tempDir, `fixed_${Date.now()}.mp4`);
        try {
          await execBin(
            ffmpegPath,
            [
              "-y",
              "-i",
              downloadedMp4,

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

              fixedFile,
            ],
            "FFmpeg AUDIO 320K"
          );

          if (fs.existsSync(fixedFile) && fs.statSync(fixedFile).size > 300 * 1024) {
            sendPath = fixedFile;
          }
        } catch {
          console.log("⚠ FFmpeg audio fix failed, sending original...");
        }
      }

      const sizeMB = (fs.statSync(sendPath).size / 1048576).toFixed(2);

      /* ================= SEND (Actions safe: NO readFileSync) ================= */
      await bot.sendMessage(
        from,
        {
          document: { url: sendPath },
          fileName: `${safeFileName(title)}_${quality}p.mp4`,
          mimetype: "video/mp4",
          caption:
            `✅ *Download complete*\n` +
            `🎥 Quality: *${quality}p*\n` +
            `🎞 Video: *H.264*\n` +
            `🎧 Audio: *AAC ${FORCE_AUDIO_BITRATE}*\n` +
            `💾 Size: *${sizeMB} MB*`,
        },
        { quoted: msg }
      );
    } catch (err) {
      console.error("EPORNER ERROR:", err);
      reply("❌ Error: " + (err.message || "unknown"));
    } finally {
      try {
        if (tempDir && fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {}
    }
  }
);
