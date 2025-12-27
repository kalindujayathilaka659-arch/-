const { cmd } = require("../command");
const gis = require("g-i-s");
const { isOwner } = require("../lib/auth");

// Promise wrapper
function gisAsync(query) {
  return new Promise((resolve, reject) => {
    gis(query, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

cmd(
  {
    pattern: "img",
    alias: ["googleimg"],
    ownerOnly: true,
    react: "🔍",
    desc: "Google Image Search (HD, stable, 3 images)",
    category: "search",
    filename: __filename,
  },
  async (bot, mek, m, { q, from, reply }) => {
    try {
      const query = typeof q === "string" ? q.trim() : "";
      if (!query) return reply("❌ Please provide a search query.");

      // ❌ SafeSearch disabled by default in g-i-s
      const results = await gisAsync(query);

      if (!Array.isArray(results) || results.length === 0) {
        return reply("❌ No images found.");
      }

      /* 🧹 FILTER: LARGE IMAGES ONLY */
      const filtered = results.filter(img => {
        return (
          img.url &&
          img.width >= 800 &&
          img.height >= 800 &&
          !img.url.includes("thumbnail") &&
          !img.url.includes("encrypted-tbn")
        );
      });

      if (!filtered.length) {
        return reply("❌ No high-quality images found.");
      }

      /* 🎲 SHUFFLE */
      filtered.sort(() => Math.random() - 0.5);

      const sentUrls = new Set();
      let sent = 0;

      for (const img of filtered) {
        if (sent >= 3) break;
        if (sentUrls.has(img.url)) continue;

        try {
          await bot.sendMessage(
            from,
            { image: { url: img.url } },
            { quoted: mek }
          );
          sentUrls.add(img.url);
          sent++;
        } catch (err) {
          console.log("⚠️ Skipped bad image:", img.url);
          continue;
        }
      }

      if (sent < 3) {
        reply(`⚠️ Sent ${sent}/3 images (others were blocked).`);
      }

    } catch (err) {
      console.error("[IMG SEARCH ERROR]", err);
      reply("❌ Image search failed.");
    }
  }
);
