const { cmd } = require("../command");
const axios = require("axios");
const { isOwner } = require("../lib/auth");

cmd(
  {
    pattern: "nsfwimg",
    ownerOnly: true,
    react: "🍑",
    desc: "Get 3 NSFW images (Danbooru – stable)",
    category: "nsfw",
    filename: __filename,
  },
  async (robin, mek, m, { q, from, reply }) => {
    try {
      // 🔥 Auto convert spaces to underscores
      const tag = q
        ? q.trim().toLowerCase().replace(/\s+/g, "_")
        : "futanari";

      const limit = 30;

      const apiUrl =
        "https://danbooru.donmai.us/posts.json" +
        `?limit=${limit}&tags=${encodeURIComponent(
          `${tag} rating:explicit`
        )}`;

      const res = await axios.get(apiUrl, {
        headers: {
          // 🔥 REQUIRED by Danbooru
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
          "Accept": "application/json",
        },
        timeout: 20000,
      });

      if (!Array.isArray(res.data)) {
        return reply("❌ Danbooru blocked the request.");
      }

      const validPosts = res.data.filter(
        p => p.file_url && p.file_url.startsWith("http")
      );

      if (validPosts.length === 0) {
        return reply(`❌ No images found for: ${tag}`);
      }

      const selected = validPosts
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);

      for (const post of selected) {
        await robin.sendMessage(
          from,
          {
            image: { url: post.file_url },
            caption:
              `🍑 *NSFW Image*\n` +
              `🔍 *Tag:* ${tag}\n` +
              `🔞 *Rating:* ${post.rating.toUpperCase()}\n` +
              `🆔 *ID:* ${post.id}`,
          },
          { quoted: mek }
        );
      }

    } catch (err) {
      console.error("Danbooru error:", err.response?.status, err.message);
      reply("❌ Failed to fetch images (Danbooru blocked or rate-limited).");
    }
  }
);
