const { cmd } = require("../command");
const { isOwner } = require("../lib/auth");

const MAX_WORDS = 50000; // 🔒 HARD FIXED

cmd(
  {
    pattern: "wordlist",
    ownerOnly: true,
    react: "📄",
    desc: "Generate 50,000-word wordlist (direct join only)",
    category: "tools",
    filename: __filename,
  },
  async (robin, mek, m, { q, from, reply }) => {
    try {
      if (!q) {
        return reply("❌ Usage: `.wordlist word1 , word2`");
      }

      // 🔹 Split strictly by comma
      const parts = q
        .split(",")
        .map(w => w.trim())
        .filter(Boolean);

      if (parts.length !== 2) {
        return reply("❌ Please provide exactly TWO words separated by a comma.");
      }

      const [a, b] = parts;

      // 🔹 Case variants
      const variantsA = [
        a.toLowerCase(),
        a.charAt(0).toUpperCase() + a.slice(1).toLowerCase(),
        a.toUpperCase(),
      ];

      const variantsB = [
        b.toLowerCase(),
        b.charAt(0).toUpperCase() + b.slice(1).toLowerCase(),
        b.toUpperCase(),
      ];

      const results = [];
      let count = 0;

      // 🔹 Generate until EXACTLY 50,000
      for (let i = 0; count < MAX_WORDS; i++) {
        for (const x of variantsA) {
          for (const y of variantsB) {
            if (count < MAX_WORDS) results.push(`${x}${y}${i || ""}`), count++;
            if (count < MAX_WORDS) results.push(`${y}${x}${i || ""}`), count++;
            if (count >= MAX_WORDS) break;
          }
          if (count >= MAX_WORDS) break;
        }
      }

      const text = results.join("\n");

      await robin.sendMessage(
        from,
        {
          document: Buffer.from(text),
          mimetype: "text/plain",
          fileName: `wordlist_${a}_${b}_50000.txt`,
          caption:
            `📄 *Wordlist Generated*\n` +
            `🔢 Words: ${MAX_WORDS}\n` +
            `🔒 Mode: Direct join only\n` +
            `🚫 No separators`,
        },
        { quoted: mek }
      );

    } catch (err) {
      console.error("Wordlist error:", err);
      reply("❌ Failed to generate wordlist.");
    }
  }
);

