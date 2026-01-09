const { cmd } = require("../command");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { spawn, execSync } = require("child_process");
const { isOwner } = require("../lib/auth");

const TEMP_DIR = path.join(__dirname, "../temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

cmd({
  pattern: "eporner",
  ownerOnly: true,
  react: "💋",
  desc: "Eporner downloader with metadata & thumbnail",
  category: "download",
  filename: __filename,
},
async (bot, msg, m, { from, q, reply }) => {

  if (!q || !q.includes("eporner.com"))
    return reply("⚠️ *Send a valid Eporner video link*\nExample:\n`.eporner https://www.eporner.com/...`");

  const outputFile = path.join(TEMP_DIR, `ep_${Date.now()}.mp4`);
  let progressMsg = await reply("📥 *Fetching video info...*");

  try {
    // === GET METADATA === //
    const infoRaw = execSync(`yt-dlp --dump-json "${q}"`).toString();
    const info = JSON.parse(infoRaw);

    const {
      title, uploader, view_count, like_count,
      average_rating, duration_string, categories,
      thumbnail
    } = info;

    // === DOWNLOAD THUMBNAIL BUFFER (SAFE) === //
    let thumbBuffer = null;
    if (thumbnail) {
      try {
        const res = await axios.get(thumbnail, { responseType: "arraybuffer" });
        thumbBuffer = Buffer.from(res.data);
      } catch {
        thumbBuffer = null;
      }
    }

    // === SEND METADATA FIRST === //
    let caption =
`🎬 *${title}*
👤 Uploader: ${uploader || "Unknown"}
📊 Views: ${view_count?.toLocaleString() || "N/A"}
👍 Likes: ${like_count?.toLocaleString() || "N/A"}
⭐ Rating: ${average_rating || "N/A"}
⏳ Duration: ${duration_string || "N/A"}
🏷️ Category: ${categories?.join(", ") || "N/A"}

📥 *Downloading video... please wait...*`;

    if (thumbBuffer) {
      await bot.sendMessage(from, {
        image: thumbBuffer,
        caption
      }, { quoted: msg });
    } else {
      await bot.sendMessage(from, { text: caption }, { quoted: msg });
    }

    // === START DOWNLOAD === //
    await bot.sendMessage(from, {
      text: "📥 *Starting download...*",
      edit: progressMsg.key
    }, { quoted: msg });

    const ytdlp = spawn("yt-dlp", [
      "-o", outputFile,
      "-f", "mp4",
      "--no-continue",
      q
    ]);

    let lastUpdate = Date.now();

    // === PROGRESS INFO === //
    ytdlp.stderr.on("data", async (data) => {
      const text = data.toString();
      const percent = text.match(/(\d+\.\d)%/);

      if (percent) {
        const now = Date.now();
        if (now - lastUpdate >= 5000) {
          await bot.sendMessage(from, {
            text: `📥 *Downloading...*\n⏳ Progress: *${percent[1]}%*`,
            edit: progressMsg.key
          }, { quoted: msg });
          lastUpdate = now;
        }
      }
    });

    // === WHEN DONE === //
    ytdlp.on("close", async () => {
      if (!fs.existsSync(outputFile))
        return reply("❌ *Download failed.*");

      const fileSize = fs.statSync(outputFile).size;
      const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);

      let finalCaption = `🎉 *Download complete!*\n💾 *Size:* ${sizeMB} MB`;

      await bot.sendMessage(from, {
        document: fs.readFileSync(outputFile),
        fileName: `${title}.mp4`,
        mimetype: "video/mp4",
        caption: finalCaption
      }, { quoted: msg });

      fs.unlinkSync(outputFile);
      await reply("✅ *Video sent successfully!*");
    });

  } catch (err) {
    console.log("❌ Command error:", err);
    reply("❌ *Error:* " + err.message);
  }
});
