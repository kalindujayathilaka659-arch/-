const { cmd } = require("../command");
const getFbVideoInfo = require("@xaviabot/fb-downloader");
const { isOwner } = require("../lib/auth");

cmd(
  {
    pattern: "fb",
    alias: ["facebook"],
    ownerOnly: true,
    react: "💙",
    desc: "Download Facebook Video (1080p preferred, fallback to SD)",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    try {
      if (!q) return reply("*Please provide a valid Facebook video URL!* 🌚❤️");

      // Add https:// if missing
      if (!q.startsWith("http")) q = "https://" + q;

      // Basic Facebook video URL check
      const fbRegex = /facebook\.com\/(watch\/?\?v=\d+|.*\/videos\/\d+|reel\/\d+)/i;
      if (!fbRegex.test(q)) {
        return reply("*❌ Invalid Facebook video URL. Please use a proper video, watch, or reel link.*");
      }

      reply("🔄 *Fetching your Facebook video... Please wait!*");

      const result = await getFbVideoInfo(q);
      if (!result || (!result.sd && !result.hd)) {
        return reply("*❌ Couldn't fetch video. It may be private or unavailable.*");
      }

      const { title, sd, hd } = result;
      const videoUrl = hd || sd;
      const qualityLabel = hd ? "1080p (HD)" : "SD";

      const previewCaption = `
*📥 GHOST FB VIDEO DOWNLOADER 📥*

🎬 *Title:* ${title || "Unknown"}
📺 *Quality:* ${qualityLabel}
🌐 *Source:* Facebook

𝐌𝐚𝐝𝐞 𝐛𝐲 🗿 Nadeela Chamath 🗿
      `.trim();

      const quote = mek && typeof mek === "object" ? { quoted: mek } : {};

      // Send preview image
      await robin.sendMessage(
        from,
        {
          image: {
            url: "https://thumbs.dreamstime.com/b/halloween-ghost-clipart-background-ghost-silhouette-halloween-ghost-logo-isolated-white-background-vector-template-halloween-330896848.jpg",
          },
          caption: previewCaption,
        },
        quote
      );

      // Send the video
      await robin.sendMessage(
        from,
        {
          video: { url: videoUrl },
          caption: `🎥 *${qualityLabel}*\n🔗 *Source:* Facebook`,
        },
        quote
      );

      return reply("✅ *Done! Enjoy your video.* 👻");
    } catch (e) {
      console.error("❌ Facebook Download Error:", e);
      return reply(`❌ *Error:* ${e.message || e}`);
    }
  }
);
