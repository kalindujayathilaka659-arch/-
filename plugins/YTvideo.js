const { cmd } = require("../command");
const ytdlp = require("yt-dlp-exec");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");
const { isOwner } = require("../lib/auth");

ffmpeg.setFfmpegPath(ffmpegPath);

const cookiesPath = path.resolve(process.cwd(), "cookies/youtube_cookies.txt");
const tempDir = path.resolve(__dirname, "../temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function stripPlaylistParams(u) {
  try {
    const urlObj = new URL(u);

    // youtu.be/<id> => watch?v=<id>
    if (urlObj.hostname.includes("youtu.be")) {
      const id = urlObj.pathname.replace("/", "");
      return `https://www.youtube.com/watch?v=${id}`;
    }

    // /watch?v=...
    if (urlObj.pathname === "/watch") {
      const v = urlObj.searchParams.get("v");
      return v ? `https://www.youtube.com/watch?v=${v}` : u;
    }

    return u;
  } catch {
    return u;
  }
}

function looksLike429(err) {
  const s = (err && (err.stderr || err.shortMessage || err.message)) || "";
  return s.includes("HTTP Error 429") || s.includes("Too Many Requests");
}

function looksLikeInvalidCookies(err) {
  const s = (err && (err.stderr || err.shortMessage || err.message)) || "";
  return (
    s.includes("cookies are no longer valid") ||
    s.includes("does not look like a Netscape format cookies file")
  );
}

function looksLikeBotCheck(err) {
  const s = (err && (err.stderr || err.shortMessage || err.message)) || "";
  return (
    s.includes("Sign in to confirm you’re not a bot") ||
    s.includes("Sign in to confirm you're not a bot")
  );
}

async function ytdlpWithRetries(url, opts, maxAttempts = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await ytdlp(url, opts);
    } catch (e) {
      lastErr = e;
      if (looksLike429(e) && attempt < maxAttempts) {
        const backoff = 2000 * attempt * attempt; // 2s, 8s, 18s...
        await sleep(backoff);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

cmd(
  {
    pattern: "video",
    ownerOnly: true,
    react: "🎥",
    desc: "YouTube downloader (WhatsApp playable) with quality selector",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    let rawFile, finalFile;

    try {
      if (!q) return reply("❌ Usage: .video [360|480|720|1080] <YouTube URL>");

      // ---------- PARSE QUALITY SELECTOR ----------
      let quality = 720;
      let input = q.trim();
      const parts = input.split(/\s+/);

      if (parts.length > 1) {
        const first = parts[0].toLowerCase().replace("p", "");
        if (["360", "480", "720", "1080"].includes(first)) {
          quality = parseInt(first, 10);
          input = parts.slice(1).join(" ");
        }
      }

      if (!input.startsWith("http"))
        return reply("❌ Please provide a valid YouTube URL.");

      // ---------- FORCE DIRECT VIDEO URL ----------
      const url = stripPlaylistParams(input);

      rawFile = path.join(tempDir, `yt_raw_${Date.now()}.mp4`);
      finalFile = path.join(tempDir, `yt_fixed_${Date.now()}.mp4`);

      const baseInfoOpts = {
        dumpSingleJson: true,
        quiet: true,
        sleepInterval: 2,
        maxSleepInterval: 5,
        retries: 5,
      };

      // ---------- FETCH INFO (TRY WITHOUT COOKIES FIRST) ----------
      let info;
      try {
        info = await ytdlpWithRetries(url, { ...baseInfoOpts }, 4);
      } catch (e1) {
        if (fs.existsSync(cookiesPath)) {
          try {
            info = await ytdlpWithRetries(
              url,
              { ...baseInfoOpts, cookies: cookiesPath },
              4
            );
          } catch (e2) {
            if (looksLikeInvalidCookies(e2))
              return reply(
                "⚠️ Your YouTube cookies are invalid/expired. Export fresh Netscape cookies and replace cookies/youtube_cookies.txt"
              );
            if (looksLikeBotCheck(e2))
              return reply(
                "⚠️ YouTube bot-check triggered. Export fresh cookies and try again later (HTTP 429)."
              );
            if (looksLike429(e2))
              return reply("⚠️ YouTube rate-limited (HTTP 429). Wait a bit and retry.");
            throw e2;
          }
        } else {
          if (looksLikeBotCheck(e1))
            return reply(
              "⚠️ YouTube requires sign-in/bot-check. Add cookies/youtube_cookies.txt (Netscape format)."
            );
          if (looksLike429(e1))
            return reply("⚠️ YouTube rate-limited (HTTP 429). Wait a bit and retry.");
          throw e1;
        }
      }

      const duration = info.duration
        ? new Date(info.duration * 1000).toISOString().substr(11, 8)
        : "Unknown";
      const views = info.view_count?.toLocaleString() || "Unknown";
      const uploadDate = info.upload_date
        ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
        : "Unknown";

      // ---------- SEND THUMB + METADATA ----------
      await robin.sendMessage(
        from,
        {
          image: { url: info.thumbnail },
          caption:
            `🎥 *${info.title}*\n` +
            `📺 *Channel:* ${info.uploader}\n` +
            `🕒 *Duration:* ${duration}\n` +
            `👁 *Views:* ${views}\n` +
            `📅 *Uploaded:* ${uploadDate}\n` +
            `📦 *Quality:* ${quality}p\n` +
            `🔗 ${url}\n\n` +
            `⏳ Downloading…`,
        },
        { quoted: mek }
      );

      // ---------- DOWNLOAD ----------
      const baseDlOpts = {
        format: `bestvideo[height<=${quality}]+bestaudio/best`,
        mergeOutputFormat: "mp4",
        output: rawFile,
        quiet: true,
        sleepInterval: 2,
        maxSleepInterval: 5,
        retries: 5,
        downloader: "aria2c",
        downloaderArgs: ["-x", "8", "-s", "8", "-k", "1M"],
        concurrentFragments: 8,
      };

      try {
        await ytdlpWithRetries(url, { ...baseDlOpts }, 4);
      } catch (d1) {
        if (fs.existsSync(cookiesPath)) {
          try {
            await ytdlpWithRetries(
              url,
              { ...baseDlOpts, cookies: cookiesPath },
              4
            );
          } catch (d2) {
            if (looksLikeInvalidCookies(d2))
              return reply(
                "⚠️ Your YouTube cookies are invalid/expired. Export fresh cookies (Netscape) and replace youtube_cookies.txt"
              );
            if (looksLikeBotCheck(d2))
              return reply(
                "⚠️ YouTube bot-check triggered. Use fresh cookies and try again later."
              );
            if (looksLike429(d2))
              return reply("⚠️ YouTube rate-limited (HTTP 429). Wait a bit and retry.");
            throw d2;
          }
        } else {
          if (looksLikeBotCheck(d1))
            return reply(
              "⚠️ YouTube requires sign-in/bot-check. Add cookies/youtube_cookies.txt (Netscape format)."
            );
          if (looksLike429(d1))
            return reply("⚠️ YouTube rate-limited (HTTP 429). Wait a bit and retry.");
          throw d1;
        }
      }

      // ---------- WHATSAPP FIX (RE-ENCODE) ----------
      await new Promise((resolve, reject) => {
        ffmpeg(rawFile)
          .outputOptions([
            "-movflags +faststart",
            "-pix_fmt yuv420p",
            "-profile:v baseline",
            "-level 3.1",
          ])
          .videoCodec("libx264")
          .audioCodec("aac")
          .audioBitrate("320k")
          .on("end", resolve)
          .on("error", reject)
          .save(finalFile);
      });

      const sizeMB = (fs.statSync(finalFile).size / 1048576).toFixed(2);

      // ✅ STREAM VIDEO (FIX SLOW SEND / NO RAM FREEZE)
      await robin.sendMessage(
        from,
        {
          video: fs.createReadStream(finalFile),
          mimetype: "video/mp4",
          caption:
            `🎬 *${info.title}*\n` +
            `📦 ${quality}p WhatsApp Compatible\n` +
            `📁 ${sizeMB} MB`,
        },
        { quoted: mek }
      );

      // cleanup
      if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile);
      if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);

    } catch (err) {
      console.error("Video Error:", err);
      reply("❌ Failed. If you see HTTP 429, wait and export fresh YouTube cookies.");
      if (rawFile && fs.existsSync(rawFile)) fs.unlinkSync(rawFile);
      if (finalFile && fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
    }
  }
);
