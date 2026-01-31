const { cmd } = require("../command");
const ytsr = require("yt-search");
const ytdlp = require("yt-dlp-exec");

// ✅ ffmpeg + ffprobe installers (FIX: Cannot find ffprobe)
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const fs = require("fs-extra");
const path = require("path");

/* ================= SETTINGS ================= */
const MAX_VIDEO_BYTES = 90 * 1024 * 1024; // WhatsApp "video" safe
const DOWNLOAD_CAP_HEIGHT = 1080;         // try best up to 1080p for WhatsApp
const AUDIO_KBPS = 160;                   // AAC audio bitrate for encode
const X264_PRESET = "slow";               // better quality per bitrate
const SAFETY = 0.94;                      // keep a bit under limit (mux overhead)

/* ================= COOKIES (AUTO FIND) ================= */
const COOKIE_CANDIDATES = [
  path.join(__dirname, "../cookies/youtube_cookies.txt"),
  path.join(process.cwd(), "cookies/youtube_cookies.txt"),
];

function findCookiesFile() {
  return COOKIE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

/* ================= HELPERS ================= */
function tailLines(text = "", n = 15) {
  return String(text).split("\n").filter(Boolean).slice(-n).join("\n");
}

function getYtDlpText(err) {
  return (
    (err?.stderr || "") +
    "\n" +
    (err?.stdout || "") +
    "\n" +
    (err?.message || "")
  );
}

function detectReason(text = "") {
  const t = String(text).toLowerCase();

  if (t.includes("sign in to confirm") || t.includes("not a bot"))
    return "YouTube bot-check (cookies not working / not loaded)";
  if (t.includes("private video") || t.includes("login required"))
    return "Private / Login required";
  if (t.includes("signature solving failed") || t.includes("challenge solving failed"))
    return "EJS solver missing (install Node20/Deno + remote-components)";
  if (t.includes("429") || t.includes("too many requests"))
    return "Rate limited (429)";
  if (t.includes("403") || t.includes("forbidden"))
    return "403 Forbidden (blocked)";
  if (t.includes("unavailable") || t.includes("not available"))
    return "Video unavailable / removed";
  if (t.includes("requested format is not available"))
    return "Requested quality/codec not available";
  if (t.includes("downloaded file is empty"))
    return "Downloaded file is empty (blocked / cookies issue)";

  return "Unknown";
}

function humanBytes(bytes = 0) {
  const units = ["B", "KB", "MB", "GB"];
  let b = Number(bytes) || 0;
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function isUrl(str = "") {
  return /^https?:\/\//i.test(String(str).trim());
}

function extractVideoId(input = "") {
  const s = String(input);
  let m = s.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
  if (m) return m[1];
  m = s.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
  if (m) return m[1];
  m = s.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/);
  if (m) return m[1];
  return null;
}

async function findDownloadedVideoFile(tempDir) {
  const files = await fs.readdir(tempDir).catch(() => []);
  const video = files.find(
    (f) =>
      /^video\./i.test(f) &&
      (f.endsWith(".mp4") || f.endsWith(".mkv") || f.endsWith(".webm"))
  );
  return video ? path.join(tempDir, video) : null;
}

async function ffprobeAsync(filePath) {
  return await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

/* ================= DOWNLOAD ================= */
async function downloadVideo({ url, cookiesPath, tempDir, maxHeight = DOWNLOAD_CAP_HEIGHT }) {
  const outTpl = path.join(tempDir, "video.%(ext)s");
  const cap = maxHeight && Number(maxHeight) > 0 ? `[height<=${maxHeight}]` : "";

  const fmt =
    `bv*[ext=mp4][vcodec^=avc1]${cap}+ba[ext=m4a]/` +
    `b[ext=mp4][vcodec^=avc1]${cap}/` +
    `bv*${cap}+ba/b${cap}/best${cap}`;

  await ytdlp(url, {
    output: outTpl,
    format: fmt,
    cookies: cookiesPath,

    remoteComponents: "ejs:github",
    jsRuntimes: "node",

    mergeOutputFormat: "mp4",
    remuxVideo: "mp4",

    noWarnings: true,
    noPlaylist: true,
    quiet: true,
  });

  return await findDownloadedVideoFile(tempDir);
}

/* ================= QUALITY/RESOLUTION DECIDER ================= */
function pickBestHeight(sourceHeight, videoKbps) {
  const h = Number(sourceHeight) || 720;
  if (videoKbps >= 2500) return Math.min(h, 1080);
  if (videoKbps >= 1400) return Math.min(h, 720);
  if (videoKbps >= 900) return Math.min(h, 480);
  return Math.min(h, 360);
}

/* ================= 0-LOSS COPY REMUX ================= */
async function tryCopyFaststart(inputPath, outputPath) {
  const meta = await ffprobeAsync(inputPath);
  const v = (meta.streams || []).find((s) => s.codec_type === "video");
  const a = (meta.streams || []).find((s) => s.codec_type === "audio");

  const vCodec = (v?.codec_name || "").toLowerCase();
  const aCodec = (a?.codec_name || "").toLowerCase();
  const pixFmt = (v?.pix_fmt || "").toLowerCase();

  const isH264 = vCodec === "h264";
  const isAAC = !a ? true : aCodec === "aac";
  const isYuv420 = !pixFmt || pixFmt.includes("yuv420");

  if (!isH264 || !isAAC || !isYuv420) return { ok: false };

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-map 0:v:0",
        "-map 0:a:0?",
        "-c copy",
        "-movflags +faststart",
        "-sn",
        "-dn",
      ])
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });

  return { ok: true, mode: "copy" };
}

/* ================= 2-PASS TARGET SIZE ENCODE ================= */
async function encodeToTargetSize({ inputPath, outputPath, tempDir, targetBytes }) {
  const meta = await ffprobeAsync(inputPath);
  const v = (meta.streams || []).find((s) => s.codec_type === "video");

  const duration = Number(meta.format?.duration) || Number(v?.duration) || 0;

  if (!duration || duration < 1) {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec("libx264")
        .audioCodec("aac")
        .audioBitrate(`${AUDIO_KBPS}k`)
        .outputOptions([
          "-preset " + X264_PRESET,
          "-crf 20",
          "-pix_fmt yuv420p",
          "-movflags +faststart",
          "-vf scale=trunc(iw/2)*2:trunc(ih/2)*2",
          "-profile:v high",
          "-level 4.1",
          "-ac 2",
          "-ar 44100",
          "-sn",
          "-dn",
        ])
        .on("end", resolve)
        .on("error", reject)
        .save(outputPath);
    });
    return { mode: "reencode_1pass" };
  }

  const totalKbps = Math.floor(((targetBytes * 8) / duration) / 1000 * SAFETY);
  const videoKbps = Math.max(300, totalKbps - AUDIO_KBPS);

  const srcH = Number(v?.height) || 720;
  const bestH = pickBestHeight(srcH, videoKbps);

  const passlog = path.join(tempDir, "x264_passlog");
  const pass1Path = path.join(tempDir, "pass1.mp4");

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec("libx264")
      .outputOptions([
        "-preset " + X264_PRESET,
        "-b:v " + videoKbps + "k",
        "-maxrate " + Math.floor(videoKbps * 1.1) + "k",
        "-bufsize " + Math.floor(videoKbps * 2) + "k",
        "-pix_fmt yuv420p",
        "-vf scale=-2:" + bestH,
        "-profile:v high",
        "-level 4.1",
        "-pass 1",
        "-passlogfile " + passlog,
        "-an",
        "-f mp4",
        "-movflags +faststart",
        "-sn",
        "-dn",
      ])
      .on("end", resolve)
      .on("error", reject)
      .save(pass1Path);
  });

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .audioBitrate(`${AUDIO_KBPS}k`)
      .outputOptions([
        "-preset " + X264_PRESET,
        "-b:v " + videoKbps + "k",
        "-maxrate " + Math.floor(videoKbps * 1.1) + "k",
        "-bufsize " + Math.floor(videoKbps * 2) + "k",
        "-pix_fmt yuv420p",
        "-vf scale=-2:" + bestH,
        "-profile:v high",
        "-level 4.1",
        "-pass 2",
        "-passlogfile " + passlog,
        "-movflags +faststart",
        "-ac 2",
        "-ar 44100",
        "-sn",
        "-dn",
      ])
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });

  await fs.remove(pass1Path).catch(() => {});
  await fs.remove(passlog + "-0.log").catch(() => {});
  await fs.remove(passlog + "-0.log.mbtree").catch(() => {});

  return { mode: "reencode_2pass", height: bestH, videoKbps };
}

/* ================= FINALIZE SMART ================= */
async function makeWhatsAppBest({ inputPath, tempDir, targetBytes }) {
  const copyPath = path.join(tempDir, "final_copy.mp4");
  const copyTry = await tryCopyFaststart(inputPath, copyPath);

  if (copyTry.ok) {
    const s = (await fs.stat(copyPath)).size;
    if (s <= targetBytes) return { path: copyPath, mode: "copy" };
  }

  const encodePath = path.join(tempDir, "final_encode.mp4");
  const enc = await encodeToTargetSize({
    inputPath,
    outputPath: encodePath,
    tempDir,
    targetBytes,
  });

  return { path: encodePath, mode: enc.mode };
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "video",
    ownerOnly: true,
    react: "🎬",
    desc: "Download best WhatsApp-playable quality (video only)",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    const id = Date.now();
    const tempDir = path.join("./temp", String(id));

    try {
      if (!q) return reply("*Please provide a video name or YouTube URL.*");

      const COOKIES_PATH = findCookiesFile();
      if (!COOKIES_PATH) {
        return reply(
          "❌ YouTube cookies file not found!\n\n✅ Put your cookies file in:\n• /cookies/youtube_cookies.txt"
        );
      }

      // 🔍 Get video info (URL or search)
      let data = null;

      if (isUrl(q)) {
        const vid = extractVideoId(q);
        if (vid) data = (await ytsr({ videoId: vid }).catch(() => null)) || null;

        if (!data) {
          data = {
            title: "YouTube Video",
            url: q.trim(),
            thumbnail: "https://i.imgur.com/8fK4h6G.jpeg",
            timestamp: "Unknown",
            ago: "Unknown",
            views: "Unknown",
          };
        }
      } else {
        const search = await ytsr(q);
        data = search.videos?.[0];
        if (!data) return reply("❌ Video not found.");
      }

      await fs.ensureDir(tempDir);

      const caption =
        `*🎬 GHOST VIDEO DOWNLOADER 👻*\n\n` +
        `👻 *Title:* ${data.title}\n` +
        `👻 *Duration:* ${data.timestamp || "Unknown"}\n` +
        `👻 *Uploaded:* ${data.ago || "Unknown"}\n` +
        `👻 *Views:* ${data.views || "Unknown"}\n` +
        `👻 *URL:* ${data.url}\n\n` +
        `🍪 Cookies: ✅ Loaded\n\n` +
        `📥 *Downloading video…*`;

      await robin.sendMessage(from, { image: { url: data.thumbnail }, caption }, { quoted: mek });

      // ✅ Download
      let rawPath = null;
      try {
        rawPath = await downloadVideo({
          url: data.url,
          cookiesPath: COOKIES_PATH,
          tempDir,
          maxHeight: DOWNLOAD_CAP_HEIGHT,
        });
      } catch (e) {
        const out = getYtDlpText(e);
        const reason = detectReason(out);
        await fs.remove(tempDir).catch(() => {});
        return reply(
          `❌ Download failed.\n🧠 Reason: *${reason}*\n\n📌 yt-dlp output:\n\`\`\`\n${tailLines(out, 18)}\n\`\`\``
        );
      }

      if (!rawPath || !fs.existsSync(rawPath) || (await fs.stat(rawPath)).size < 200 * 1024) {
        await fs.remove(tempDir).catch(() => {});
        return reply("❌ Downloaded file is empty / missing.\n✅ Export cookies again.");
      }

      // ✅ Finalize best possible under WhatsApp video limit
      const final = await makeWhatsAppBest({
        inputPath: rawPath,
        tempDir,
        targetBytes: MAX_VIDEO_BYTES,
      });

      const sendPath = final.path;
      const size = (await fs.stat(sendPath)).size;

      if (size > MAX_VIDEO_BYTES) {
        await fs.remove(tempDir).catch(() => {});
        return reply(
          `⚠️ Video is still too big to send as WhatsApp *video*: ${humanBytes(size)}\n` +
          `Try a shorter video or reduce MAX_VIDEO_BYTES.`
        );
      }

      const modeLine =
        final.mode === "copy"
          ? "✅ Mode: 0-loss (copy/remux)"
          : "✅ Mode: re-encoded (max quality under WhatsApp limit)";

      // ✅ Send ONLY as VIDEO
      await robin.sendMessage(
        from,
        {
          video: { url: sendPath },
          mimetype: "video/mp4",
          caption: `👻 *${data.title}*\n📦 Size: ${humanBytes(size)}\n${modeLine}`,
        },
        { quoted: mek }
      );

      await fs.remove(tempDir).catch(() => {});
      reply("*✅ Sent best quality possible as WhatsApp video!* 👻");
    } catch (err) {
      console.error("❌ Video Error:", err);
      reply("❌ Error: " + (err.message || "unknown"));
      await fs.remove(tempDir).catch(() => {});
    }
  }
);
