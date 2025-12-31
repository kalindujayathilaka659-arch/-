// plugins/autoread_status.js
module.exports = async (client) => {
    client.ev.on('messages.upsert', async msg => {
        try {
            if (
                msg.type === 'notify' &&
                msg.messages[0].key.remoteJid === "status@broadcast"
            ) {
                const m = msg.messages[0]
                const jid = m.key.participant || m.key.remoteJid

                await client.readMessages([{
                    remoteJid: "status@broadcast",
                    id: m.key.id,
                    participant: jid
                }])

                console.log(`Status auto-read: ${jid}`)
            }
        } catch (err) {
            console.log("Auto-read status error:", err)
        }
    })
}
