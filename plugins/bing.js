const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");
const { isOwner } = require("../lib/auth");

cmd(
  {
    pattern: "bing",
    ownerOnly: true,
    react: "🔍",
    desc: "Search Bing and return top 3 actual result links",
    category: "tools",
    filename: __filename,
  },
  async (robin, mek, m, { q, reply, from }) => {
    try {
      if (!q) return reply("❗ Provide a search query.");
      reply(`🔍 Searching Bing for: *${q}* ...`);

      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(q)}`;

      const res = await axios.get(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0.0.0 Safari/537.36",
        },
      });

      const $ = cheerio.load(res.data);
      const results = [];

      $(".b_algo").each((i, el) => {
        if (i >= 3) return false;
        const title = $(el).find("h2").text();
        const link = $(el).find("h2 a").attr("href");
        const snippet = $(el).find(".b_caption p").text();
        if (title && link) results.push(`*${title}*\n${snippet}\n🔗 ${link}`);
      });

      if (!results.length) return reply("❌ No results found.");

      reply(results.join("\n\n"));
    } catch (e) {
      console.error("Bing scraping error:", e.message);
      reply("❌ Failed to search Bing.");
    }
  }
);
