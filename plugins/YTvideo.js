const { cmd } = require("../command");
const ytdlp = require("yt-dlp-exec");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { isOwner } = require("../lib/auth");

ffmpeg.setFfmpegPath(ffmpegPath);

const cookiesPath = path.resolve(process.cwd(), "cookies/youtube_cookies.txt");

cmd(
  {
    pattern: "video",
    ownerOnly: true,
    react: "🎥",
    desc: "YouTube downloader (WhatsApp playable)",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    if (!q || !q.startsWith("http"))
      return reply("❌ Please provide a valid YouTube URL.");

    if (!fs.existsSync(cookiesPath))
      return reply("⚠️ youtube_cookies.txt not found.");

    const rawFile = path.join(os.tmpdir(), `yt_raw_${Date.now()}.mp4`);
    const finalFile = path.join(os.tmpdir(), `yt_fixed_${Date.now()}.mp4`);

    try {
      /* ---------- FETCH INFO FIRST ---------- */
      const info = await ytdlp(q, {
        dumpSingleJson: true,
        quiet: true,
        cookies: cookiesPath,
      });

      const duration = info.duration
        ? new Date(info.duration * 1000).toISOString().substr(11, 8)
        : "Unknown";

      const views = info.view_count?.toLocaleString() || "Unknown";

      const uploadDate = info.upload_date
        ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
        : "Unknown";

      /* ---------- SEND THUMBNAIL FIRST ---------- */
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
            `📦 *Quality:* 720p\n` +
            `🔗 ${q}\n\n` +
            `⏳ Downloading…`,
        },
        { quoted: mek }
      );

      /* ---------- DOWNLOAD ---------- */
      await ytdlp(q, {
        format: "bestvideo[height<=720]+bestaudio/best",
        mergeOutputFormat: "mp4",
        output: rawFile,
        cookies: cookiesPath,
        quiet: true,
      });

      /* ---------- WHATSAPP FIX (CRITICAL) ---------- */
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
          .audioBitrate("128k")
          .on("end", resolve)
          .on("error", reject)
          .save(finalFile);
      });

      const sizeMB =
        (fs.statSync(finalFile).size / 1048576).toFixed(2) + " MB";

      /* ---------- SEND PLAYABLE VIDEO ---------- */
      await robin.sendMessage(
        from,
        {
          video: fs.readFileSync(finalFile),
          mimetype: "video/mp4",
          caption:
            `🎬 *${info.title}*\n` +
            `📦 720p WhatsApp Compatible\n` +
            `📁 ${sizeMB}`,
        },
        { quoted: mek }
      );

      fs.unlinkSync(rawFile);
      fs.unlinkSync(finalFile);

    } catch (err) {
      console.error("Video Error:", err);
      reply("❌ Failed to process video.");
      if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile);
      if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
    }
  }
);
