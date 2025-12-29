/**
 * Auto Status Watch Plugin
 * Watches all statuses from your contacts and reacts if configured.
 */

const { getContentType } = require("@whiskeysockets/baileys");

function init(sock, config) {
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];
      if (!msg.message) return;

      // Only watch status updates
      if (msg.key.remoteJid !== "status@broadcast") return;

      const sender = msg.key.participant || "unknown";

      // Auto read status
      if (config.AUTO_READ_STATUS) {
        await sock.readMessages([msg.key]);
      }

      // Auto react to status
      if (config.AUTO_STATUS_REACT && config.AUTO_STATUS_REACT !== "false") {
        await sock.sendMessage(msg.key.remoteJid, {
          react: { text: config.AUTO_STATUS_REACT, key: msg.key },
        });
      }

      console.log(`👀 Status watched from: ${sender}`);
    } catch (err) {
      console.error("❌ Status watch plugin error:", err.message);
    }
  });
}

module.exports = { init };
