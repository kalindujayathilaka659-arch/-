// plugins/statusWatch.js
const { getContentType } = require("@whiskeysockets/baileys");

module.exports = {
  name: "statusWatch",
  category: "utility",
  desc: "Automatically watches and reacts to statuses from contacts",
  async init(sock, rawConfig) {
    sock.ev.on("messages.upsert", async ({ messages }) => {
      try {
        const mek = messages[0];
        if (!mek.message) return;

        const from = mek.key.remoteJid;

        if (from === "status@broadcast") {
          if (rawConfig.AUTO_READ_STATUS) await sock.readMessages([mek.key]);
          if (rawConfig.AUTO_STATUS_REACT && rawConfig.AUTO_STATUS_REACT !== "false") {
            await sock.sendMessage(from, { react: { text: rawConfig.AUTO_STATUS_REACT, key: mek.key } });
          }

          console.log(`👀 Status watched from: ${mek.key.participant || "unknown"}`);
        }
      } catch (err) {
        console.error("❌ Status watch plugin error:", err.message);
      }
    });
  },
};
