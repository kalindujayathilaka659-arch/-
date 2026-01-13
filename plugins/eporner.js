const { cmd } = require("../command");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { spawn, execSync } = require("child_process");

const TEMP_DIR = path.join(__dirname, "../temp");
const COOKIE_FILE = path.join(__dirname, "../cookies/eporner.txt");

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

cmd({
  pattern: "eporner",
  ownerOnly: true,
  react: "💋",
  desc: "Eporner downloader (360p/480p/720p, cookie + CF bypass)",
  category: "download",
  filename: __filename,
}, async (bot, msg, m, { from, q, reply }) => {

  if (!q || !q.includes("eporner.com")) {
    return reply(
      "⚠️ *Usage:*\n" +
      "`.eporner <url>`\n" +
      "`.eporner 360 <url>`\n" +
      "`.eporner 480 <url>`\n" +
      "`.eporner 720 <url>`"
    );
  }

  if (!fs.existsSync(COOKIE_FILE)) {
    return reply("❌ *Cookie file missing*\nAdd: `/cookies/eporner.txt`");
  }

  // ================= QUALITY PARSER ================= //
  let quality = 720;
  let url = q;

  const parts = q.split(" ");
  if (parts.length > 1 && ["360", "480", "720"].includes(parts[0])) {
    quality = parseInt(parts[0]);
    url = parts.slice(1).join(" ");
  }

  const outputFile = path.join(TEMP_DIR, `ep_${Date.now()}.mp4`);
  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

  try {
    // ================= METADATA ================= //
    let info;
    try {
      info = JSON.parse(
        execSync(
          `yt-dlp --cookies "${COOKIE_FILE}" --user-agent "${UA}" --dump-json "${url}"`
        ).toString()
      );
    } catch {
      info = JSON.parse(execSync(`yt-dlp --dump-json "${url}"`).toString());
    }

    const {
      title,
      uploader,
      view_count,
      like_count,
      average_rating,
      duration_string,
      thumbnail,
    } = info;

    const caption = `🎬 *${title || "Unknown"}*
👤 Uploader: ${uploader || "N/A"}
📊 Views: ${view_count?.toLocaleString() || "N/A"}
👍 Likes: ${like_count?.toLocaleString() || "N/A"}
⭐ Rating: ${average_rating || "N/A"}
⏳ Duration: ${duration_string || "N/A"}
🎥 Quality: *≤${quality}p*

📥 *Starting download…*`;

    // ================= SEND METADATA ================= //
    if (thumbnail) {
      try {
        const res = await axios.get(thumbnail, { responseType: "arraybuffer" });
        await bot.sendMessage(
          from,
          { image: Buffer.from(res.data), caption },
          { quoted: msg }
        );
      } catch {
        await bot.sendMessage(from, { text: caption }, { quoted: msg });
      }
    } else {
      await bot.sendMessage(from, { text: caption }, { quoted: msg });
    }

    // ================= DOWNLOAD ================= //
    const ytdlp = spawn("yt-dlp", [
      "--cookies", COOKIE_FILE,
      "--user-agent", UA,
      "--referer", "https://www.eporner.com/",
      "-f",
      `bestvideo[ext=mp4][height<=${quality}]+bestaudio[ext=m4a]/best[ext=mp4][height<=${quality}]`,
      "--merge-output-format", "mp4",
      "--concurrent-fragments", "16",
      "--http-chunk-size", "20M",
      "--retries", "infinite",
      "--fragment-retries", "infinite",
      "--no-continue",
      "-o", outputFile,
      url
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
          await bot.sendMessage(
            from,
            { text: `📥 *Downloading…*\n⏳ Progress: *${match[1]}%*`, edit: msg.key },
            { quoted: msg }
          );
        }
      }
    });

    // ================= DONE ================= //
    ytdlp.on("close", async (code) => {
      if (code !== 0 || !fs.existsSync(outputFile)) {
        return reply("❌ *Download failed*");
      }

      const sizeMB = (fs.statSync(outputFile).size / 1048576).toFixed(2);

      await bot.sendMessage(
        from,
        {
          document: fs.readFileSync(outputFile),
          fileName: `${title || "eporner"}_${quality}p.mp4`,
          mimetype: "application/octet-stream",
          caption: `✅ *Download complete*\n🎥 Quality: *${quality}p*\n💾 Size: *${sizeMB} MB*`,
        },
        { quoted: msg }
      );

      fs.unlinkSync(outputFile);
    });

  } catch (err) {
    console.error("EPORNER ERROR:", err);
    reply("❌ Error: " + err.message);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
  }
});
