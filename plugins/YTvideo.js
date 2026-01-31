const { cmd } = require("../command");
const ytsr = require("yt-search");
const ytdlp = require("yt-dlp-exec");

// ✅ ffmpeg + ffprobe installers
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const fs = require("fs-extra");
const path = require("path");

/* ================= SETTINGS ================= */
const MAX_VIDEO_BYTES = 90 * 1024 * 1024; // WhatsApp "video" safe
const DEFAULT_MAX_HEIGHT = 720;           // .video <q>  => 720p default
const AUDIO_KBPS = 160;                   // AAC audio bitrate (encode)
const X264_PRESET = "slow";               // better quality per bitrate
const SAFETY = 0.94;                      // keep under limit
const ALLOWED_QUALITIES = new Set([144, 240, 360, 480, 720, 1080]);

/* ================= COOKIES (AUTO FIND) ================= */
const COOKIE_CANDIDATES = [
  path.join(__dirname, "../cookies/youtube_cookies.txt"),
  path.join(process.cwd(), "cookies/youtube_cookies.txt"),
];

function findCookiesFile() {
  return COOKIE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

/* ================= HELPERS ================= */
function tailLines(text = "", n = 18) {
  return String(text).split("\n").filter(Boolean).slice(-n).join("\n");
}

function getYtDlpText(err) {
  return (err?.stderr || "") + "\n" + (err?.stdout || "") + "\n" + (err?.message || "");
}

function detectReason(text = "") {
  const t = String(text).toLowerCase();

  if (t.includes("postprocessing") && t.includes("stream #1:0 -> #0:1"))
    return "FFmpeg merge/remux failed (audio codec not MP4-safe). Using fallback merge.";

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

function parseQualityAndQuery(input = "") {
  const parts = String(input).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { maxHeight: DEFAULT_MAX_HEIGHT, query: "" };

  const maybeNum = Number(parts[0]);
  if (Number.isFinite(maybeNum) && ALLOWED_QUALITIES.has(maybeNum)) {
    return { maxHeight: maybeNum, query: parts.slice(1).join(" ").trim() };
  }
  return { maxHeight: DEFAULT_MAX_HEIGHT, query: String(input).trim() };
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

async function hasAudioStream(filePath) {
  try {
    const meta = await ffprobeAsync(filePath);
    return (meta.streams || []).some((s) => s.codec_type === "audio");
  } catch {
    return false;
  }
}

async function cleanupVideoOutputs(tempDir) {
  const files = await fs.readdir(tempDir).catch(() => []);
  for (const f of files) {
    if (
      /^video\./i.test(f) ||
      /^final_/i.test(f) ||
      /^pass1/i.test(f) ||
      f.includes("x264_passlog") ||
      /^v\./i.test(f) ||
      /^a\./i.test(f)
    ) {
      await fs.remove(path.join(tempDir, f)).catch(() => {});
    }
  }
}

/* ================= DOWNLOAD (MERGE SAFE + FALLBACK) ================= */
async function findByPrefix(tempDir, prefix) {
  const files = await fs.readdir(tempDir).catch(() => []);
  const f = files.find((x) => x.startsWith(prefix + "."));
  return f ? path.join(tempDir, f) : null;
}

async function downloadPart({ url, cookiesPath, tempDir, outPrefix, format, maxHeight }) {
  const cap = maxHeight && Number(maxHeight) > 0 ? `[height<=${maxHeight}]` : "";
  const outTpl = path.join(tempDir, `${outPrefix}.%(ext)s`);

  await ytdlp(url, {
    output: outTpl,
    format: format.replaceAll("{cap}", cap),
    cookies: cookiesPath,

    // ✅ IMPORTANT: directory, not the binary path
    ffmpegLocation: path.dirname(ffmpegInstaller.path),

    remoteComponents: "ejs:github",
    jsRuntimes: "node",

    noWarnings: true,
    noPlaylist: true,
    quiet: true,
  });

  return await findByPrefix(tempDir, outPrefix);
}

async function mergeToMkv(videoPath, audioPath, outPath) {
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        "-map 0:v:0",
        "-map 1:a:0",
        "-c copy",
        "-shortest",
        "-sn",
        "-dn",
      ])
      .on("end", resolve)
      .on("error", reject)
      .save(outPath);
  });
}

/**
 * Tries:
 * 1) yt-dlp merge mp4(h264)+m4a(aac) => mp4 (no audio issues)
 * 2) fallback: download video-only + audio-only then merge -> MKV (copy-safe)
 */
async function downloadVideo({ url, cookiesPath, tempDir, maxHeight }) {
  const outTpl = path.join(tempDir, "video.%(ext)s");
  const cap = maxHeight && Number(maxHeight) > 0 ? `[height<=${maxHeight}]` : "";

  // ✅ Force safe AAC audio first to avoid "copy opus into mp4" crash
  const fmtSafe =
    `bv*[ext=mp4][vcodec^=avc1]${cap}+ba[ext=m4a]/` +
    `bv*[ext=mp4]${cap}+ba[ext=m4a]/` +
    `b[ext=mp4]${cap}/` +
    `best[ext=mp4]${cap}`;

  try {
    await ytdlp(url, {
      output: outTpl,
      format: fmtSafe,
      cookies: cookiesPath,

      ffmpegLocation: path.dirname(ffmpegInstaller.path),

      remoteComponents: "ejs:github",
      jsRuntimes: "node",

      mergeOutputFormat: "mp4",
      // ❌ don't force remuxVideo here (can trigger extra copy issues)
      // remuxVideo: "mp4",

      noWarnings: true,
      noPlaylist: true,
      quiet: true,
    });

    const merged = await findDownloadedVideoFile(tempDir);
    if (merged && (await hasAudioStream(merged))) return merged;
  } catch {
    // fall through to fallback
  }

  // Fallback: manual parts merge (always audio)
  await cleanupVideoOutputs(tempDir);

  const vPath = await downloadPart({
    url,
    cookiesPath,
    tempDir,
    outPrefix: "v",
    maxHeight,
    format:
      "bv*[ext=mp4][vcodec^=avc1]{cap}/" +
      "bv*[ext=mp4]{cap}/" +
      "bv*{cap}/bestvideo{cap}",
  });

  const aPath = await downloadPart({
    url,
    cookiesPath,
    tempDir,
    outPrefix: "a",
    maxHeight,
    format:
      "ba[ext=m4a]/" +
      "ba[acodec^=mp4a]/" +
      "bestaudio",
  });

  if (!vPath || !aPath) return null;

  const mkvOut = path.join(tempDir, "video.mkv");
  await mergeToMkv(vPath, aPath, mkvOut);

  if (!(await hasAudioStream(mkvOut))) return null;
  return mkvOut;
}

/* ================= FINALIZE FOR WHATSAPP ================= */
function pickBestHeight(sourceHeight, videoKbps, userMaxHeight) {
  const srcH = Number(sourceHeight) || 720;
  const capH = Number(userMaxHeight) || DEFAULT_MAX_HEIGHT;

  let best;
  if (videoKbps >= 2500) best = Math.min(srcH, 1080);
  else if (videoKbps >= 1400) best = Math.min(srcH, 720);
  else if (videoKbps >= 900) best = Math.min(srcH, 480);
  else best = Math.min(srcH, 360);

  return Math.min(best, capH);
}

async function tryCopyFaststart(inputPath, outputPath) {
  const meta = await ffprobeAsync(inputPath);
  const v = (meta.streams || []).find((s) => s.codec_type === "video");
  const a = (meta.streams || []).find((s) => s.codec_type === "audio");

  const vCodec = (v?.codec_name || "").toLowerCase(); // h264/vp9/av1
  const aCodec = (a?.codec_name || "").toLowerCase(); // aac/opus
  const pixFmt = (v?.pix_fmt || "").toLowerCase();

  const isH264 = vCodec === "h264";
  const isAAC = !!a && aCodec === "aac";
  const isYuv420 = !pixFmt || pixFmt.includes("yuv420");

  if (!isH264 || !isAAC || !isYuv420) return { ok: false };

  const sizeOk = (await fs.stat(inputPath)).size <= MAX_VIDEO_BYTES;
  if (!sizeOk) return { ok: false };

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-map 0:v:0",
        "-map 0:a:0",
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

async function encodeToTargetSize({ inputPath, outputPath, tempDir, targetBytes, userMaxHeight }) {
  const meta = await ffprobeAsync(inputPath);
  const v = (meta.streams || []).find((s) => s.codec_type === "video");
  const hasAudio = (meta.streams || []).some((s) => s.codec_type === "audio");
  if (!hasAudio) throw new Error("Input has no audio stream.");

  const duration = Number(meta.format?.duration) || Number(v?.duration) || 0;

  if (!duration || duration < 1) {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          "-map 0:v:0",
          "-map 0:a:0",
          "-preset " + X264_PRESET,
          "-crf 20",
          "-pix_fmt yuv420p",
          "-movflags +faststart",
          "-vf scale=-2:" + (userMaxHeight || DEFAULT_MAX_HEIGHT),
          "-profile:v high",
          "-level 4.1",
          "-ac 2",
          "-ar 44100",
          "-sn",
          "-dn",
        ])
        .videoCodec("libx264")
        .audioCodec("aac")
        .audioBitrate(`${AUDIO_KBPS}k`)
        .on("end", resolve)
        .on("error", reject)
        .save(outputPath);
    });
    return { mode: "reencode_1pass", height: userMaxHeight || DEFAULT_MAX_HEIGHT };
  }

  const totalKbps = Math.floor(((targetBytes * 8) / duration) / 1000 * SAFETY);
  const videoKbps = Math.max(300, totalKbps - AUDIO_KBPS);

  const srcH = Number(v?.height) || 720;
  const bestH = pickBestHeight(srcH, videoKbps, userMaxHeight);

  const passlog = path.join(tempDir, "x264_passlog");
  const pass1Path = path.join(tempDir, "pass1.mp4");

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-map 0:v:0",
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
      .videoCodec("libx264")
      .on("end", resolve)
      .on("error", reject)
      .save(pass1Path);
  });

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-map 0:v:0",
        "-map 0:a:0",
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
      .videoCodec("libx264")
      .audioCodec("aac")
      .audioBitrate(`${AUDIO_KBPS}k`)
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });

  await fs.remove(pass1Path).catch(() => {});
  await fs.remove(passlog + "-0.log").catch(() => {});
  await fs.remove(passlog + "-0.log.mbtree").catch(() => {});

  return { mode: "reencode_2pass", height: bestH, videoKbps };
}

async function makeWhatsAppBest({ inputPath, tempDir, targetBytes, userMaxHeight }) {
  const copyPath = path.join(tempDir, "final_copy.mp4");
  const copyTry = await tryCopyFaststart(inputPath, copyPath);

  if (copyTry.ok) {
    return { path: copyPath, mode: "copy" };
  }

  const encodePath = path.join(tempDir, "final_encode.mp4");
  const enc = await encodeToTargetSize({
    inputPath,
    outputPath: encodePath,
    tempDir,
    targetBytes,
    userMaxHeight,
  });

  return { path: encodePath, mode: enc.mode, details: enc };
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "video",
    ownerOnly: true,
    react: "🎬",
    desc: "Usage: .video [144|240|360|480|720|1080] <url/name> (default 720)",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    const id = Date.now();
    const tempDir = path.join("./temp", String(id));

    try {
      if (!q) {
        return reply(
          "❌ Usage:\n" +
            "• .video <url/name>  (default 720)\n" +
            "• .video 1080 <url/name>\n" +
            "• .video 720 <url/name>\n" +
            "• .video 480 <url/name>"
        );
      }

      const { maxHeight, query } = parseQualityAndQuery(q);
      if (!query) return reply("❌ Add URL/search after quality.\nExample: .video 1080 https://youtu.be/xxxx");

      const COOKIES_PATH = findCookiesFile();
      if (!COOKIES_PATH) {
        return reply("❌ YouTube cookies file not found!\n✅ Put it in: /cookies/youtube_cookies.txt");
      }

      // 🔍 Video info (URL or search)
      let data = null;

      if (isUrl(query)) {
        const vid = extractVideoId(query);
        if (vid) data = (await ytsr({ videoId: vid }).catch(() => null)) || null;

        if (!data) {
          data = {
            title: "YouTube Video",
            url: query.trim(),
            thumbnail: "https://i.imgur.com/8fK4h6G.jpeg",
            timestamp: "Unknown",
            ago: "Unknown",
            views: "Unknown",
          };
        }
      } else {
        const search = await ytsr(query);
        data = search.videos?.[0];
        if (!data) return reply("❌ Video not found.");
      }

      await fs.ensureDir(tempDir);

      await robin.sendMessage(
        from,
        {
          image: { url: data.thumbnail },
          caption:
            `*🎬 GHOST VIDEO DOWNLOADER 👻*\n\n` +
            `👻 *Title:* ${data.title}\n` +
            `👻 *Requested:* ${maxHeight}p\n` +
            `👻 *Duration:* ${data.timestamp || "Unknown"}\n` +
            `👻 *URL:* ${data.url}\n\n` +
            `🍪 Cookies: ✅ Loaded\n\n` +
            `📥 *Downloading…*`,
        },
        { quoted: mek }
      );

      // ✅ Download (merge-safe + fallback)
      let rawPath = null;
      try {
        rawPath = await downloadVideo({
          url: data.url,
          cookiesPath: COOKIES_PATH,
          tempDir,
          maxHeight,
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
        return reply("❌ Downloaded file is empty/missing.\n✅ Export cookies again.");
      }

      // Ensure audio exists (don’t send silent)
      if (!(await hasAudioStream(rawPath))) {
        await fs.remove(tempDir).catch(() => {});
        return reply("❌ Downloaded video has no audio.\n✅ Try lower quality or update yt-dlp.");
      }

      // ✅ Make WhatsApp best possible under size limit
      let final;
      try {
        final = await makeWhatsAppBest({
          inputPath: rawPath,
          tempDir,
          targetBytes: MAX_VIDEO_BYTES,
          userMaxHeight: maxHeight,
        });
      } catch (e) {
        await fs.remove(tempDir).catch(() => {});
        return reply("❌ Encode error: " + (e.message || "unknown"));
      }

      const sendPath = final.path;
      const size = (await fs.stat(sendPath)).size;

      if (size > MAX_VIDEO_BYTES) {
        await fs.remove(tempDir).catch(() => {});
        return reply(
          `⚠️ Still too big for WhatsApp video: ${humanBytes(size)}\n` +
            `Try lower: .video 720 / .video 480`
        );
      }

      // sanity: ensure final output has audio
      if (!(await hasAudioStream(sendPath))) {
        await fs.remove(tempDir).catch(() => {});
        return reply("❌ Final output has no audio (unexpected).");
      }

      const modeLine =
        final.mode === "copy"
          ? "✅ Mode: 0-loss (copy/remux)"
          : `✅ Mode: re-encoded (best under limit) • out: ${final.details?.height || maxHeight}p`;

      // ✅ Send ONLY as VIDEO
      await robin.sendMessage(
        from,
        {
          video: { url: sendPath },
          mimetype: "video/mp4",
          caption: `👻 *${data.title}*\n🎞️ Requested: ${maxHeight}p\n📦 Size: ${humanBytes(size)}\n${modeLine}`,
        },
        { quoted: mek }
      );

      await fs.remove(tempDir).catch(() => {});
      reply("*✅ successfully downloaded...* 👻");
    } catch (err) {
      console.error("❌ Video Error:", err);
      reply("❌ Error: " + (err.message || "unknown"));
      await fs.remove(tempDir).catch(() => {});
    }
  }
);
