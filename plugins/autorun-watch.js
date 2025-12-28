/**
 * Auto Status Watch Plugin
 * Watches all status updates, marks as seen & reacts.
 * Does NOT change anything inside index.js
 */

const config = require("../config");

module.exports = async (sock, mek) => {
  try {
    // Only status
    if (mek.key?.remoteJid !== "status@broadcast") return;

    // Ignore if disabled
    if (config.AUTO_STATUS_WATCH !== "true") return;

    const sender = mek.key?.participant || "unknown";

    // Ignore self status
    if (config.AUTO_STATUS_IGNORE_SELF === "true") {
      const botNumber = sock.user.id.split(":")[0];
      if (sender.includes(botNumber)) return;
    }

    // Mark as read
    await sock.readMessages([mek.key]);

    // React
    const emoji = config.AUTO_STATUS_EMOJI || "👻";
    await sock.sendMessage(mek.key.remoteJid, {
      react: { text: emoji, key: mek.key }
    });

    console.log(`👀 Viewed & reacted ${emoji} → status from ${sender}`);

  } catch (err) {
    console.error("❌ AutoStatusWatch plugin error:", err.message);
  }
};
