const { cmd } = require("../command");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { spawn, execSync } = require("child_process");

const TEMP_DIR = path.join(__dirname, "../temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

cmd({
  pattern: "eporner",
  ownerOnly: true,
  react: "💋",
  desc: "Eporner downloader (fast ≤480p, sends as document with metadata)",
  category: "download",
  filename: __filename,
}, async (bot, msg, m, { from, q, reply }) => {

  if (!q || !q.includes("eporner.com")) {
    return reply(
      "⚠️ *Send a valid Eporner video link*\n\nExample:\n`.eporner https://www.eporner.com/...`"
    );
  }

  const outputFile = path.join(TEMP_DIR, `ep_${Date.now()}.mp4`);

  try {
    // ================= METADATA ================= //
    const infoRaw = execSync(`yt-dlp --dump-json "${q}"`).toString();
    const info = JSON.parse(infoRaw);

    const {
      title,
      uploader,
      view_count,
      like_count,
      average_rating,
      duration_string,
      categories,
      thumbnail
    } = info;

    // ================= SEND METADATA ================= //
    let caption =
`🎬 *${title || "Unknown Title"}*
👤 Uploader: ${uploader || "Unknown"}
📊 Views: ${view_count?.toLocaleString() || "N/A"}
👍 Likes: ${like_count?.toLocaleString() || "N/A"}
⭐ Rating: ${average_rating || "N/A"}
⏳ Duration: ${duration_string || "N/A"}
🎥 Quality: *≤480p*
⚡ Downloader: *Fast default*

📥 *Starting download…*`;

    // Send metadata as image if thumbnail exists, else as text
    if (thumbnail) {
      try {
        const res = await axios.get(thumbnail, { responseType: "arraybuffer" });
        const thumbBuffer = Buffer.from(res.data);
        await bot.sendMessage(from, { image: thumbBuffer, caption }, { quoted: msg });
      } catch {
        await bot.sendMessage(from, { text: caption }, { quoted: msg });
      }
    } else {
      await bot.sendMessage(from, { text: caption }, { quoted: msg });
    }

    // ================= SPAWN YT-DLP ================= //
    const ytdlp = spawn("yt-dlp", [
      "-f", "best[ext=mp4][height<=480]/bestvideo[ext=mp4][height<=480]+bestaudio[ext=m4a]",
      "--merge-output-format", "mp4",
      "--concurrent-fragments", "6",
      "--http-chunk-size", "10M",
      "--retries", "infinite",
      "--fragment-retries", "infinite",
      "--newline",
      "--no-continue",
      "-o", outputFile,
      q
    ]);

    let lastUpdate = 0;

    // ================= PROGRESS ================= //
    ytdlp.stderr.on("data", async (data) => {
      const text = data.toString();
      const match = text.match(/(\d{1,3}\.\d)%/);
      if (match) {
        const now = Date.now();
        if (now - lastUpdate > 3000) {
          lastUpdate = now;
          await bot.sendMessage(from, {
            text: `📥 *Downloading…*\n⏳ Progress: *${match[1]}%*`,
            edit: msg.key
          }, { quoted: msg });
        }
      }
    });

    // ================= DONE ================= //
    ytdlp.on("close", async (code) => {
      if (code !== 0 || !fs.existsSync(outputFile)) {
        return reply("❌ *Download failed.*");
      }

      const sizeMB = (fs.statSync(outputFile).size / 1048576).toFixed(2);

      // ================= SEND VIDEO AS DOCUMENT ================= //
      await bot.sendMessage(from, {
        document: fs.readFileSync(outputFile),
        fileName: `${title || "eporner_video"}.mp4`,
        mimetype: "application/octet-stream", // ensures document
        caption: `🎉 *Download complete!*\n💾 Size: *${sizeMB} MB*`
      }, { quoted: msg });

      fs.unlinkSync(outputFile);
      await reply("✅ *Video sent successfully as document!*");
    });

  } catch (err) {
    console.error("❌ EPORNER ERROR:", err);
    reply("❌ *Error:* " + err.message);
  }
});
