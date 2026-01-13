// plugins/aichat.js
// Usage:
//  .ai               -> shows welcome / help
//  .ai <message>     -> chats with AI
//  .ai reset         -> clears memory for this chat

const { cmd } = require("../command");
const config = require("../config");

// OpenAI SDK (CommonJS compatible)
let OpenAI = require("openai");
OpenAI = OpenAI.default || OpenAI;

// In-memory chat history (per chat id). Resets when bot restarts.
const memory = new Map(); // key: chat id (from), value: [{ role, content }, ...]

function getText(m) {
  return (
    m?.text ||
    m?.body ||
    m?.message?.conversation ||
    m?.message?.extendedTextMessage?.text ||
    ""
  );
}

function getArgs(fullText, prefix = ".ai") {
  const t = (fullText || "").trim();
  if (!t.toLowerCase().startsWith(prefix)) return "";
  return t.slice(prefix.length).trim();
}

function addMemory(chatId, role, content, maxItems = 12) {
  const arr = memory.get(chatId) || [];
  arr.push({ role, content });

  // keep last N messages
  while (arr.length > maxItems) arr.shift();
  memory.set(chatId, arr);
}

function welcomeMessage() {
  return (
    "👻 *GHOST AI*\n" +
    "━━━━━━━━━━━━━━\n" +
    "🤖 *HELLO! I'M GHOST AI*\n\n" +
    "🧠 *How to use:*\n" +
    "• `.ai hello`  → chat with me\n" +
    "• `.ai reset`  → clear memory\n\n" +
    "✨ *Tip:* Ask anything. Keep it simple!\n" +
    "━━━━━━━━━━━━━━"
  );
}

cmd(
  {
    pattern: "ai",
    ownerOnly: false,
    react: "👻",
    desc: "GHOST AI chat (usage: .ai <message> | .ai reset)",
    category: "ai",
    filename: __filename,
  },
  async (robin, mek, m, { from, reply }) => {
    try {
      const fullText = getText(m);
      const q = getArgs(fullText, ".ai");

      // If user typed only ".ai"
      if (!q) {
        return reply(welcomeMessage());
      }

      // Reset memory
      if (q.toLowerCase() === "reset") {
        memory.delete(from);
        return reply("✅ *GHOST AI* memory cleared for this chat.");
      }

      // Key check
      if (!config.OPENAI_API_KEY) {
        return reply(
          "❌ *OPENAI_API_KEY not found!*\n\n" +
            "Add it to your `config.js` or set it as an environment variable:\n" +
            "• `OPENAI_API_KEY=your_key_here`"
        );
      }

      const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

      const past = memory.get(from) || [];

      const input = [
        {
          role: "developer",
          content:
            "You are GHOST AI, a helpful WhatsApp assistant. Keep replies short, clear, and friendly. Avoid long walls of text. Use simple language. If user asks for illegal/harmful instructions, refuse politely.",
        },
        ...past,
        { role: "user", content: q },
      ];

      const res = await client.responses.create({
        model: config.AI_MODEL || "gpt-5.2",
        reasoning: { effort: "low" },
        max_output_tokens: 450,
        input,
      });

      const out = (res.output_text || "").trim() || "…";

      // Save memory
      addMemory(from, "user", q);
      addMemory(from, "assistant", out);

      return reply(out);
    } catch (err) {
      console.error("AI plugin error:", err);

      // Common helpful hint
      const msg =
        "❌ *GHOST AI Error*\n" +
        "━━━━━━━━━━━━━━\n" +
        "Something went wrong.\n\n" +
        "✅ Check:\n" +
        "• API key is correct\n" +
        "• Billing/credits enabled\n" +
        "• Internet connection\n\n" +
        "Try again: `.ai hello`\n" +
        "━━━━━━━━━━━━━━";

      return reply(msg);
    }
  }
);
