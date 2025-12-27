const { cmd } = require("../command");
const axios = require("axios");
const { isOwner } = require("../lib/auth");

cmd(
  {
    pattern: "tiktok",
    ownerOnly: true,
    react: "🎶",
    desc: "Download TikTok video without watermark",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { q, reply, from }) => {
    try {
      if (!q || !q.includes("tiktok.com")) {
        return reply("❗ Please provide a valid TikTok video link.");
      }

      reply("🔍 Fetching TikTok video...");

      const apiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(q)}`;
      const res = await axios.get(apiUrl);
      const data = res.data?.data;

      if (!data || !data.play) {
        return reply("❌ Failed to extract video. Try a different link.");
      }

      const videoUrl = data.play;
      const title = data.title || "TikTok Video";
      const author = data.author?.unique_id || "@user";

      const videoRes = await axios.get(videoUrl, {
        responseType: "arraybuffer",
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });

      await robin.sendMessage(
        from,
        {
          video: videoRes.data,
          caption: `🎵 *TikTok Downloaded*\n👤 User: ${author}\n📝 Title: ${title}`,
          mimetype: "video/mp4",
        },
        { quoted: mek }
      );

      reply("✅ Video sent!");
    } catch (e) {
      console.error("TikTok error:", e.message);
      reply(`❌ Error: ${e?.response?.status || e.message}`);
    }
  }
);
