// plugins/autoread.js
const config = require("../config");

module.exports = async (client) => {
  client.ev.on("messages.upsert", async (msg) => {
    try {
      if (msg.type !== "notify" || !msg.messages?.length) return;

      const botJid = client.user?.id?.split(":")[0] + "@s.whatsapp.net";

      for (const m of msg.messages) {
        if (!m?.key) continue;

        const remoteJid = m.key.remoteJid;
        if (!remoteJid) continue;

        // ❌ skip bot's own messages
        if (m.key.fromMe) continue;

        const isStatus = remoteJid === "status@broadcast";
        const isOtherBroadcast =
          remoteJid.endsWith("@broadcast") && !isStatus;
        if (isOtherBroadcast) continue;

        const senderJid = m.key.participant || remoteJid;

        // ❌ skip bot's own status/messages
        if (senderJid === botJid) continue;

        /* ================= STATUS HANDLING ================= */
        if (isStatus) {
          const AUTO_READ_STATUS = config.AUTO_READ_STATUS === true;
          const AUTO_LIKE_STATUS =
            AUTO_READ_STATUS && config.AUTO_LIKE_STATUS === true;
          const AUTO_REPLY_STATUS =
            AUTO_READ_STATUS && config.AUTO_REPLY_STATUS === true;

          if (!AUTO_READ_STATUS && !AUTO_LIKE_STATUS && !AUTO_REPLY_STATUS)
            continue;

          // ✅ Auto-read status
          if (AUTO_READ_STATUS) {
            await client.readMessages([
              {
                remoteJid: "status@broadcast",
                id: m.key.id,
                participant: senderJid,
              },
            ]);
          }

          // ❤️ Auto-like status
          if (AUTO_LIKE_STATUS) {
            await client.sendMessage(
              "status@broadcast",
              {
                react: {
                  text: config.STATUS_REACT_EMOJI || "❤️",
                  key: m.key,
                },
              },
              { statusJidList: [senderJid] }
            );
          }

          // 💬 Auto-reply status
          if (AUTO_REPLY_STATUS) {
            await client.sendMessage(
              senderJid,
              { text: config.STATUS_REPLY_TEXT || "Nice status 🙂" },
              { quoted: m, statusJidList: [senderJid] }
            );
          }

          console.log(`✅ STATUS handled | ${senderJid}`);
          continue;
        }

        /* ================= NORMAL MESSAGE HANDLING ================= */
        const AUTO_READ_MESSAGES = config.AUTO_READ_MESSAGES === true;
        if (!AUTO_READ_MESSAGES) continue;

        // ✅ Auto-read ALL messages (DM + Groups)
        await client.readMessages([
          {
            remoteJid: remoteJid,
            id: m.key.id,
            participant: m.key.participant, // exists only in groups
          },
        ]);

        console.log(`✅ Auto-read MESSAGE | ${remoteJid}`);
      }
    } catch (err) {
      console.error("❌ Auto read error:", err);
    }
  });
};
