// ../lib/autoread_status.js
module.exports = function (client) {

    client.ev.on('messages.upsert', async (msg) => {
        try {
            // check if message type is status update
            if (
                msg.type === 'notify' &&
                msg.messages[0].key.remoteJid === 'status@broadcast'
            ) {
                const m = msg.messages[0]
                const jid = m.key.participant || m.key.remoteJid

                console.log("Reading status:", jid)

                await client.readMessages([
                    {
                        remoteJid: 'status@broadcast',
                        id: m.key.id,
                        participant: jid
                    }
                ])
            }
        } catch (err) {
            console.log("Auto-read Status Error:", err)
        }
    })
}
