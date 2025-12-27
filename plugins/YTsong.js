const { cmd } = require("../command");
const ytsr = require("yt-search");
const ytdlp = require("yt-dlp-exec");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs-extra");
const path = require("path");
const { isOwner } = require("../lib/auth");

// Optional: Set ffmpeg path if not in system PATH
// ffmpeg.setFfmpegPath("./bin/ffmpeg");

const COOKIES_PATH = "cookies/yt.txt";

cmd(
  {
    pattern: "song",
    ownerOnly: true,
    react: "🎵",
    desc: "Download Song using yt-dlp",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    const id = Date.now();
    const tempDir = `./temp/${id}`;
    try {
      if (!q) return reply("*Please provide a song name or YouTube URL.*");

      // 🔍 Search for the video
      const search = await ytsr(q);
      const data = search.videos[0];
      if (!data) return reply("❌ Song not found.");

      await fs.ensureDir(tempDir);
      const webmPath = path.join(tempDir, "audio.webm");
      const mp3Path = path.join(tempDir, "audio.mp3");

      // 🎵 Song description
      const desc = `
*🎵 GHOST SONG DOWNLOADER 👻*

👻 *Title:* ${data.title}
👻 *Description:* ${data.description || "N/A"}
👻 *Duration:* ${data.timestamp || "Unknown"}
👻 *Uploaded:* ${data.ago}
👻 *Views:* ${data.views}
👻 *URL:* ${data.url}

𝐌𝐚𝐝𝐞 𝐛𝐲 Nadeela Chamath 🗿
`;

      await robin.sendMessage(
        from,
        { image: { url: data.thumbnail }, caption: desc },
        { quoted: mek }
      );

      // 🔄 Auto-update yt-dlp to latest version
      await ytdlp([], { update: true }).catch(() => {
        console.log("⚠️ yt-dlp update skipped or failed (network issue)");
      });

      // 🎧 Download best available audio format
      await ytdlp(data.url, {
        output: webmPath,
        format: "bestaudio/best", // ✅ dynamic format
        cookies: COOKIES_PATH,
        quiet: true,
      });

      // 🎶 Convert webm → mp3
      await new Promise((resolve, reject) => {
        ffmpeg(webmPath)
          .audioCodec("libmp3lame")
          .audioBitrate(320)
          .on("end", resolve)
          .on("error", (err) => {
            console.error("❌ FFmpeg error:", err);
            reject(err);
          })
          .save(mp3Path);
      });

      // ⏱️ Duration limit (max 30 minutes)
      let totalSeconds = 0;
      if (data.timestamp) {
        const parts = data.timestamp.split(":").map(Number);
        totalSeconds =
          parts.length === 3
            ? parts[0] * 3600 + parts[1] * 60 + parts[2]
            : parts[0] * 60 + parts[1];
      }

      if (totalSeconds > 1800) {
        await fs.remove(tempDir);
        return reply("⏱️ Audio limit is 30 minutes.");
      }

      // 🎤 Send MP3 as audio + document
      await robin.sendMessage(
        from,
        {
          audio: { url: mp3Path },
          mimetype: "audio/mpeg",
          ptt: false,
        },
        { quoted: mek }
      );

      await robin.sendMessage(
        from,
        {
          document: { url: mp3Path },
          mimetype: "audio/mpeg",
          fileName: `${data.title}.mp3`,
          caption: "𝐌𝐚𝐝𝐞 𝐛𝐲 Nadeela Chamath 🗿",
        },
        { quoted: mek }
      );

      await fs.remove(tempDir);
      reply("*✅ Song downloaded successfully!* 👻");
    } catch (e) {
      console.error("❌ Error:", e);
      reply(`❌ Error: ${e.message}`);
      await fs.remove(tempDir).catch(() => {});
    }
  }
);
