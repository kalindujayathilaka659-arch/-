const { proto, downloadContentFromMessage, getContentType } = require('@whiskeysockets/baileys')
const fs = require('fs')

const downloadMediaMessage = async(m, filename) => {
    if (!m) return null;
	if (m.type === 'viewOnceMessage') {
		m.type = m.msg.type
	}
	let buffer;
	try {
		if (m.type === 'imageMessage') {
			const name = filename ? filename + '.jpg' : 'undefined.jpg';
			const stream = await downloadContentFromMessage(m.msg, 'image');
			buffer = Buffer.from([]);
			for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
			fs.writeFileSync(name, buffer);
			return fs.readFileSync(name);
		} else if (m.type === 'videoMessage') {
			const name = filename ? filename + '.mp4' : 'undefined.mp4';
			const stream = await downloadContentFromMessage(m.msg, 'video');
			buffer = Buffer.from([]);
			for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
			fs.writeFileSync(name, buffer);
			return fs.readFileSync(name);
		} else if (m.type === 'stickerMessage') {
			const name = filename ? filename + '.webp' : 'undefined.webp';
			const stream = await downloadContentFromMessage(m.msg, 'sticker');
			buffer = Buffer.from([]);
			for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
			fs.writeFileSync(name, buffer);
			return fs.readFileSync(name);
		} else if (m.type === 'documentMessage') {
			const ext = m.msg?.fileName?.split('.')[1]?.toLowerCase() || 'bin';
			const name = filename ? filename + '.' + ext : 'undefined.' + ext;
			const stream = await downloadContentFromMessage(m.msg, 'document');
			buffer = Buffer.from([]);
			for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
			fs.writeFileSync(name, buffer);
			return fs.readFileSync(name);
		}
	} catch (err) {
		console.error("❌ downloadMediaMessage error:", err);
		return null;
	}
}

const sms = (robin, m) => {
	if (!m) return null;
	
	// Setup basic message info
	if (m.key) {
		m.id = m.key.id;
		m.chat = m.key.remoteJid;
		m.fromMe = m.key.fromMe;
		m.isGroup = m.chat.endsWith('@g.us');
		m.sender = m.fromMe
			? robin.user.id.split(':')[0] + '@s.whatsapp.net'
			: m.isGroup
				? m.key.participant
				: m.key.remoteJid;
	}

	if (m.message) {
		m.type = getContentType(m.message);
		m.msg = (m.type === 'viewOnceMessage') 
			? m.message[m.type]?.message?.[getContentType(m.message[m.type].message)] 
			: m.message[m.type];

		// Safely get body
		m.body = (
			m.type === 'conversation' ? (m.msg || '') :
			m.type === 'extendedTextMessage' ? (m.msg?.text || '') :
			m.type === 'imageMessage' ? (m.msg?.caption || '') :
			m.type === 'videoMessage' ? (m.msg?.caption || '') :
			m.type === 'templateButtonReplyMessage' ? (m.msg?.selectedId || '') :
			m.type === 'buttonsResponseMessage' ? (m.msg?.selectedButtonId || '') :
			''
		);

		m.quoted = m.msg?.contextInfo?.quotedMessage || null;

		if (m.quoted) {
			m.quoted.type = getContentType(m.quoted);
			m.quoted.id = m.msg.contextInfo?.stanzaId;
			m.quoted.sender = m.msg.contextInfo?.participant;
			m.quoted.fromMe = m.quoted.sender?.split('@')[0]?.includes(robin.user.id.split(':')[0]) || false;
			m.quoted.msg = (m.quoted.type === 'viewOnceMessage') 
				? m.quoted[m.quoted.type]?.message?.[getContentType(m.quoted[m.quoted.type].message)] 
				: m.quoted[m.quoted.type];

			m.quoted.download = (filename) => downloadMediaMessage(m.quoted, filename);
		}
	}

	// Add reply helpers
	m.reply = (text, id = m.chat, options = { mentions: [m.sender] }) => robin.sendMessage(id, { text, contextInfo: { mentionedJid: options.mentions } }, { quoted: m });
	m.replyS = (stik, id = m.chat, options = { mentions: [m.sender] }) => robin.sendMessage(id, { sticker: stik, contextInfo: { mentionedJid: options.mentions } }, { quoted: m });
	m.replyImg = (img, text, id = m.chat, options = { mentions: [m.sender] }) => robin.sendMessage(id, { image: img, caption: text, contextInfo: { mentionedJid: options.mentions } }, { quoted: m });
	m.replyVid = (vid, text, id = m.chat, options = { mentions: [m.sender], gif: false }) => robin.sendMessage(id, { video: vid, caption: text, gifPlayback: options.gif, contextInfo: { mentionedJid: options.mentions } }, { quoted: m });
	m.replyAud = (aud, id = m.chat, options = { mentions: [m.sender], ptt: false }) => robin.sendMessage(id, { audio: aud, ptt: options.ptt, mimetype: 'audio/mpeg', contextInfo: { mentionedJid: options.mentions } }, { quoted: m });
	m.replyDoc = (doc, id = m.chat, options = { mentions: [m.sender], filename: 'undefined.pdf', mimetype: 'application/pdf' }) => robin.sendMessage(id, { document: doc, fileName: options.filename, mimetype: options.mimetype, contextInfo: { mentionedJid: options.mentions } }, { quoted: m });
	m.react = (emoji) => robin.sendMessage(m.chat, { react: { text: emoji, key: m.key } });

	return m;
}

module.exports = { sms, downloadMediaMessage };
