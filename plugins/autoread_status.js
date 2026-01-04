// plugins/autoread_status.js
const config = require("../config")

module.exports = async (client) => {
    client.ev.on("messages.upsert", async (msg) => {
        try {
            if (
                msg.type !== "notify" ||
                !msg.messages ||
                msg.messages[0].key.remoteJid !== "status@broadcast"
            ) return

            const m = msg.messages[0]
            const jid = m.key.participant || m.key.remoteJid

            // Skip bot's own status
            const botJid = client.user.id.split(":")[0] + "@s.whatsapp.net"
            if (jid === botJid) return

            // 🔒 MASTER RULE
            const AUTO_READ  = config.AUTO_READ_STATUS === true
            const AUTO_LIKE  = AUTO_READ && config.AUTO_LIKE_STATUS === true
            const AUTO_REPLY = AUTO_READ && config.AUTO_REPLY_STATUS === true

            // Nothing enabled
            if (!AUTO_READ && !AUTO_LIKE && !AUTO_REPLY) return

            // ✅ Auto-read
            if (AUTO_READ) {
                await client.readMessages([{
                    remoteJid: "status@broadcast",
                    id: m.key.id,
                    participant: jid
                }])
            }

            // ❤️ Auto-like (reaction)
            if (AUTO_LIKE) {
                await client.sendMessage(
                    "status@broadcast",
                    {
                        react: {
                            text: config.STATUS_REACT_EMOJI || "❤️",
                            key: m.key
                        }
                    },
                    { statusJidList: [jid] }
                )
            }

            // 💬 Auto-reply to status
            if (AUTO_REPLY) {
                await client.sendMessage(
                    jid,
                    {
                        text: config.STATUS_REPLY_TEXT || "Nice status 🙂"
                    },
                    {
                        quoted: m,
                        statusJidList: [jid]
                    }
                )
            }

            console.log(
                `✅ Status handled | Read:${AUTO_READ} Like:${AUTO_LIKE} Reply:${AUTO_REPLY} | ${jid}`
            )

        } catch (err) {
            console.error("❌ Auto status error:", err)
        }
    })
}
