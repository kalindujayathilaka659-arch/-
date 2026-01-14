// plugins/sendmsg.js
const { cmd } = require("../command");
const { isOwner } = require("../lib/auth");

let lastSendAt = 0;

function normalizeNumberToJid(input) {
  // Keep digits only (accepts +94..., 94..., 0..., etc.)
  let num = String(input || "").replace(/\D/g, "");

  // Optional convenience: if user typed local "0XXXXXXXXX" (10 digits), convert to Sri Lanka +94
  // You can REMOVE this block if you want fully manual E.164 only.
  if (num.length === 10 && num.startsWith("0")) {
    num = "94" + num.slice(1);
  }

  if (num.length < 8) return null; // basic sanity
  return `${num}@s.whatsapp.net`;
}

cmd(
  {
    pattern: "sendmsg",
    ownerOnly: true,
    react: "📨",
    desc: "Owner: send a message to any number",
    category: "owner",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    try {
      // Extra safety (if your framework already enforces ownerOnly, this is still fine)
      if (!isOwner(m.sender)) return reply("❌ Owner only.");

      const text = (q || "").trim();
      if (!text) return reply("❌ Usage: .sendmsg <number> <message>");

      const [numRaw, ...msgParts] = text.split(/\s+/);
      const message = msgParts.join(" ").trim();

      if (!numRaw || !message) {
        return reply("❌ Usage: .sendmsg <number> <message>");
      }

      // Basic anti-spam rate limit (5 seconds)
      const now = Date.now();
      if (now - lastSendAt < 5000) {
        return reply("⏳ Wait 5 seconds between sendmsg uses.");
      }
      lastSendAt = now;

      const jid = normalizeNumberToJid(numRaw);
      if (!jid) return reply("❌ Invalid number. Example: 94769296124");

      // Optional: limit message length
      if (message.length > 3000) {
        return reply("❌ Message too long (max 3000 characters).");
      }

      await robin.sendMessage(jid, { text: message });

      return reply(`✅ Sent message to: ${numRaw}`);
    } catch (err) {
      console.error("sendmsg error:", err);
      return reply(`❌ Failed to send: ${err.message || "Unknown error"}`);
    }
  }
);
