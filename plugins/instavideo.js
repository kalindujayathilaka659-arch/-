const { cmd } = require("../command");
const ytdlp = require("yt-dlp-exec");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { isOwner } = require("../lib/auth");

const cookiesPath = path.join(__dirname, "../cookies/instacookies.txt");
const tempFolder = path.join(__dirname, "../temp");

// Ensure temp folder exists
if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });

cmd(
  {
    pattern: "ig",
    alias: ["instagram", "igdl"],
    ownerOnly: true,
    desc: "Download Instagram video using yt-dlp + cookies",
    category: "downloader",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    try {
      const text = q || m.text?.split(" ")?.slice(1)?.join(" ") || "";
      if (!text.includes("instagram.com")) {
        return reply("❌ Send a valid Instagram post/reel/video URL.");
      }

      await reply("📥 Fetching Instagram video...");

      const info = await ytdlp(text, {
        dumpSingleJson: true,
        cookies: cookiesPath,
        noCheckCertificate: true,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/115.0.0.0 Safari/537.36",
      });

      const format =
        info.formats.find(
          (f) => f.ext === "mp4" && f.vcodec !== "none" && f.acodec !== "none"
        ) ||
        info.formats.find((f) => f.ext === "mp4" && f.vcodec !== "none");

      if (!format || !format.url) {
        return reply("❌ No valid video format found.");
      }

      const filename = `${uuidv4()}.mp4`;
      const tempPath = path.join(tempFolder, filename);

      const response = await axios.get(format.url, {
        responseType: "stream",
        headers: {
          Referer: "https://www.instagram.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/115.0.0.0 Safari/537.36",
        },
        timeout: 60000,
      });

      const writer = fs.createWriteStream(tempPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      console.log("📥 Video downloaded to:", tempPath);

      await robin.sendMessage(
        from,
        {
          video: { url: tempPath },
          mimetype: "video/mp4",
          caption: `🎥 Instagram video\n🔗 ${text}`,
        },
        { quoted: mek }
      );

      console.log("✅ Sent video via WhatsApp");

      fs.unlinkSync(tempPath);
    } catch (err) {
      console.error("❌ IG Downloader Error:", err);
      reply(`❌ Error: ${err.message || err.stderr || "Unknown error"}`);
    }
  }
);
