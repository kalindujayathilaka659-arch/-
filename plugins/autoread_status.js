// plugins/autoread.js
const config = require("../config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= UNWRAP WRAPPERS ================= */
function unwrapMessage(m) {
  let msg = m?.message || {};

  // unwrap ephemeral
  if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;

  // unwrap viewOnce
  if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
  if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
  if (msg.viewOnceMessageV2Extension?.message)
    msg = msg.viewOnceMessageV2Extension.message;

  return msg;
}

/* ================= GET MESSAGE TEXT ================= */
function getTextMessage(m) {
  const msg = unwrapMessage(m);

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.buttonsResponseMessage?.selectedButtonId ||
    msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg.templateButtonReplyMessage?.selectedId ||
    ""
  );
}

/* ================= PREFIX SUPPORT ================= */
function getPrefixes() {
  const p = config.PREFIX ?? ".";
  return Array.isArray(p) ? p : [String(p)];
}

function isBotCommand(text = "") {
  const clean = String(text || "").trim();
  if (!clean) return false;

  const prefixes = getPrefixes();
  return prefixes.some((pre) => clean.startsWith(pre));
}

/* ================= FAKE TYPING ================= */
async function fakeTyping(client, jid) {
  try {
    if (!(config.AUTO_FAKE_TYPING == true)) return;

    const min = Number(config.FAKE_TYPING_DELAY_MIN ?? 800);
    const max = Number(config.FAKE_TYPING_DELAY_MAX ?? 2000);
    const delay = Math.floor(min + Math.random() * (max - min + 1));

    // ✅ helps in some chats
    try {
      await client.presenceSubscribe(jid);
    } catch {}

    await client.sendPresenceUpdate("composing", jid);
    await sleep(delay);
    await client.sendPresenceUpdate("paused", jid);
  } catch {
    // ignore
  }
}

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

        // ✅ skip other broadcasts except status
        const isStatus = remoteJid === "status@broadcast";
        const isOtherBroadcast = remoteJid.endsWith("@broadcast") && !isStatus;
        if (isOtherBroadcast) continue;

        const senderJid = m.key.participant || remoteJid;

        // ❌ skip bot's own status/messages
        if (senderJid === botJid) continue;

        /* ================= STATUS HANDLING ================= */
        if (isStatus) {
          const AUTO_READ_STATUS = config.AUTO_READ_STATUS == true;
          const AUTO_LIKE_STATUS = AUTO_READ_STATUS && config.AUTO_LIKE_STATUS == true;
          const AUTO_REPLY_STATUS = AUTO_READ_STATUS && config.AUTO_REPLY_STATUS == true;

          if (!AUTO_READ_STATUS && !AUTO_LIKE_STATUS && !AUTO_REPLY_STATUS) continue;

          if (AUTO_READ_STATUS) {
            await client.readMessages([
              {
                remoteJid: "status@broadcast",
                id: m.key.id,
                participant: senderJid,
              },
            ]);
          }

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
        const AUTO_READ_MESSAGES = config.AUTO_READ_MESSAGES == true;

        const text = getTextMessage(m);
        const command = isBotCommand(text);

        /**
         * ✅ MODE 1:
         * AUTO_READ_MESSAGES = true
         * - Read ALL messages
         * - Fake typing ONLY for commands
         */
        if (AUTO_READ_MESSAGES) {
          if (command) {
            await fakeTyping(client, remoteJid);
            console.log(`⌨️ Fake typing (COMMAND) | ${remoteJid} | ${text}`);
          }

          await client.readMessages([
            {
              remoteJid: remoteJid,
              id: m.key.id,
              participant: m.key.participant, // groups only
            },
          ]);

          console.log(`✅ Auto-read MESSAGE | ${remoteJid}`);
          continue;
        }

        /**
         * ✅ MODE 2:
         * AUTO_READ_MESSAGES = false
         * - Don't read
         * - Fake typing ONLY for commands
         */
        if (!AUTO_READ_MESSAGES && command) {
          await fakeTyping(client, remoteJid);
          console.log(`⌨️ Fake typing (COMMAND) | ${remoteJid} | ${text}`);
        }
      }
    } catch (err) {
      console.error("❌ Auto read error:", err);
    }
  });
};
