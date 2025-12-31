// plugins/autoread_status.js
module.exports = async (client) => {
    client.ev.on('messages.upsert', async (msg) => {
        try {
            // Only handle status messages
            if (msg.type === 'notify' && msg.messages[0].key.remoteJid === 'status@broadcast') {
                const m = msg.messages[0];
                const jid = m.key.participant || m.key.remoteJid;

                // Skip the bot's own statuses
                if (jid === client.user.id.split(':')[0] + '@s.whatsapp.net') return;

                // 1. Mark status as seen (Read receipt)
                await client.readMessages([{
                    remoteJid: 'status@broadcast',
                    id: m.key.id,
                    participant: jid
                }]);

                // 2. React to the status (Like/Ghost emoji)
                // You can change '👻' to '❤️' or any emoji you prefer
                await client.sendMessage('status@broadcast', {
                    react: {
                        text: '👻', 
                        key: m.key
                    }
                }, { statusJidList: [jid] });

                // Logging for confirmation
                const msgType = Object.keys(m.message || {})[0] || 'unknown';
                console.log(`✅ Status Read & Liked: ${jid}`);
                console.log(`   • Type: ${msgType}`);
            }
        } catch (err) {
            console.error('❌ Auto-read/like status error:', err);
        }
    });
};
