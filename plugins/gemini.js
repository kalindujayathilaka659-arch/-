const { cmd } = require("../command");
const axios = require("axios");
const config = require("../config");
const { isOwner } = require("../lib/auth");

/* ---------- GEMINI CONFIG ---------- */
if (!config.GEMINI_API_KEY) {
  throw new Error("❌ GEMINI_API_KEY is missing in config.js");
}

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" +
  config.GEMINI_API_KEY;

/* ---------- COMMAND ---------- */
cmd(
  {
    pattern: "ai",
    alias: ["gemini", "gpt", "chatgpt"],
    ownerOnly: true,
    react: "🤖",
    desc: "Ask anything to Google Gemini AI",
    category: "ai",
    use: ".ai <question>",
    filename: __filename,
  },
  async (conn, m, msg, { args, pushname, reply }) => {
    try {
      const text = args.join(" ");
      if (!text) {
        return reply("❗ Please ask me something.\nExample: `.ai What is AI?`");
      }

      /* ---------- PROMPT ---------- */
      const prompt = `
I'm **Ghost**, a friendly WhatsApp AI assistant created by Nadeela Chamath.
- Always reply in the SAME language as the user
- Be helpful, natural, and friendly
- Use emojis where suitable

User (${pushname}) asks:
${text}
      `.trim();

      /* ---------- REQUEST ---------- */
      const payload = {
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      };

      const response = await axios.post(GEMINI_API_URL, payload, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 20000,
      });

      /* ---------- RESPONSE ---------- */
      const result =
        response?.data?.candidates?.[0]?.content?.parts
          ?.map(p => p.text)
          ?.join("\n");

      if (!result) {
        return reply("❌ Gemini did not return a valid response.");
      }

      return reply(result.trim());

    } catch (err) {
      console.error(
        "Gemini Error:",
        err.response?.status,
        err.response?.data || err.message
      );

      return reply("❌ Gemini API error. Please try again later.");
    }
  }
);
