const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");

cmd(
  {
    pattern: "pornpic",
    ownerOnly: true,
    react: "🍑",
    desc: "Get 3 NSFW images (Pornpics)",
    category: "nsfw",
    filename: __filename,
  },
  async (robin, mek, m, { q, from, reply }) => {
    try {
      // ✅ TAG NORMALIZER (space -> dash)
      const tag = q
        ? q
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s-]/g, "") // remove symbols
            .replace(/\s+/g, "-")         // spaces -> "-"
            .replace(/-+/g, "-")          // collapse multiple "-"
        : "hentai";

      if (!tag) return reply("❌ Invalid tag.");

      const base = "https://www.pornpics.com";

      // ✅ Pornpics has TWO URL TYPES => try both
      const urlsToTry = [
        `${base}/tags/${encodeURIComponent(tag)}/`, // ✅ tags url
        `${base}/${encodeURIComponent(tag)}/`,      // ✅ normal url
      ];

      // ✅ Cloudflare-safe headers
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": base + "/",
        "Connection": "keep-alive",
      };

      let res = null;
      let usedUrl = null;

      // 🌐 TRY BOTH URL TYPES
      for (const tryUrl of urlsToTry) {
        try {
          const r = await axios.get(tryUrl, {
            headers,
            timeout: 20000,
            maxRedirects: 5,
          });

          // if ok
          res = r;
          usedUrl = tryUrl;
          break;
        } catch (e) {
          // only continue if 404, otherwise stop
          if (e.response?.status === 404) continue;
          throw e;
        }
      }

      // ❌ if both failed
      if (!res) {
        return reply(
          `❌ Tag not found on Pornpics.\n\n` +
            `🔍 Tried:\n` +
            `• /tags/${tag}/\n` +
            `• /${tag}/\n\n` +
            `💡 Example:\n` +
            `pornpic oiled ass\n` +
            `pornpic ass`,`pornpic big ass`,`pornpic latina`

        );
      }

      const $ = cheerio.load(res.data);

      // 🔎 Collect image URLs
      const images = [];

      $("img").each((_, el) => {
        let src =
          $(el).attr("data-src") ||
          $(el).attr("data-original") ||
          $(el).attr("src");

        if (!src) return;

        // ✅ Fix protocol-relative links like //site.com/img.jpg
        if (src.startsWith("//")) src = "https:" + src;

        // ✅ Fix relative image URLs (rare)
        if (src.startsWith("/")) src = base + src;

        // ✅ Filter junk images
        if (
          src.startsWith("http") &&
          !/(logo|icon|thumb|sprite|ads)/i.test(src)
        ) {
          images.push(src);
        }
      });

      if (images.length === 0) {
        return reply(`❌ No images found for: ${tag}`);
      }

      // ✅ Remove duplicates
      const uniqueImages = [...new Set(images)];

      // ✅ Pick up to 5 images
      const selected = uniqueImages
        .sort(() => 0.5 - Math.random())
        .slice(0, Math.min(5, uniqueImages.length));

      for (const img of selected) {
        await robin.sendMessage(
          from,
          {
            image: { url: img },
caption:
  `🍑 *NSFW Image*\n` +
  `🔍 *Tag:* ${tag}\n` +
  `🖼️ *Gallery:*\n${usedUrl}\n` +
  `🌐 *Source:* pornpics.com`,
          },
          { quoted: mek }
        );
      }
    } catch (err) {
      console.error(
        "Pornpics error:",
        err.response?.status,
        err.response?.statusText || err.message
      );
      reply("❌ Failed to fetch images (blocked or layout changed).");
    }
  }
);
