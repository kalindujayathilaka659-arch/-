const { downloadContentFromMessage, getContentType } = require("@whiskeysockets/baileys");
const fs = require("fs");

const toStr = (v) => (v == null ? "" : typeof v === "string" ? v : String(v));
const safeTrim = (v) => toStr(v).trim();

/**
 * Unwrap Baileys wrapper messages (ephemeral/viewOnce) safely.
 * Returns: { type, msg, rootType }
 */
function unwrapBaileysMessage(message) {
  if (!message) return { type: null, msg: null, rootType: null };

  let root = message;
  let type = getContentType(root);

  // Unwrap common wrappers
  // - ephemeralMessage
  // - viewOnceMessage / viewOnceMessageV2 / viewOnceMessageV2Extension
  while (type === "ephemeralMessage" || (type && type.startsWith("viewOnceMessage"))) {
    if (type === "ephemeralMessage") {
      root = root.ephemeralMessage?.message || null;
    } else {
      // viewOnce wrapper
      root = root[type]?.message || null;
    }
    if (!root) break;
    type = getContentType(root);
  }

  return { type, msg: type ? root[type] : null, rootType: getContentType(message) };
}

const downloadMediaMessage = async (m, filename) => {
  if (!m) return null;

  try {
    // If quoted message comes in wrapped, unwrap it
    // We expect m.message-like structure on quoted, but sometimes it's already a "msg" object.
    // If it has "message", unwrap that; else use m.msg + m.type as-is.
    let type = m.type;
    let msg = m.msg;

    // Handle viewOnce (both v1/v2)
    if (type && type.startsWith("viewOnceMessage")) {
      const inner = unwrapBaileysMessage({ [type]: { message: m.msg?.message || m.msg } });
      type = inner.type;
      msg = inner.msg;
    }

    let buffer = Buffer.from([]);

    const writeAndReturn = async (stream, outName) => {
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      fs.writeFileSync(outName, buffer);
      return fs.readFileSync(outName);
    };

    if (type === "imageMessage") {
      const name = filename ? `${filename}.jpg` : "undefined.jpg";
      const stream = await downloadContentFromMessage(msg, "image");
      return await writeAndReturn(stream, name);
    }

    if (type === "videoMessage") {
      const name = filename ? `${filename}.mp4` : "undefined.mp4";
      const stream = await downloadContentFromMessage(msg, "video");
      return await writeAndReturn(stream, name);
    }

    if (type === "stickerMessage") {
      const name = filename ? `${filename}.webp` : "undefined.webp";
      const stream = await downloadContentFromMessage(msg, "sticker");
      return await writeAndReturn(stream, name);
    }

    if (type === "documentMessage") {
      const ext = safeTrim(msg?.fileName).split(".").pop()?.toLowerCase() || "bin";
      const name = filename ? `${filename}.${ext}` : `undefined.${ext}`;
      const stream = await downloadContentFromMessage(msg, "document");
      return await writeAndReturn(stream, name);
    }

    return null;
  } catch (err) {
    console.error("❌ downloadMediaMessage error:", err);
    return null;
  }
};

const sms = (robin, m) => {
  if (!m) return null;

  // Basic message info
  if (m.key) {
    m.id = m.key.id;
    m.chat = m.key.remoteJid;

    m.fromMe = !!m.key.fromMe;
    m.isGroup = !!(m.chat && m.chat.endsWith("@g.us"));

    const myJid = toStr(robin?.user?.id).split(":")[0] + "@s.whatsapp.net";
    m.sender = m.fromMe
      ? myJid
      : m.isGroup
      ? m.key.participant
      : m.key.remoteJid;
  }

  // Message content
  if (m.message) {
    const unwrapped = unwrapBaileysMessage(m.message);

    m.type = unwrapped.type; // final real type (after unwrapping)
    m.msg = unwrapped.msg;   // actual message object for that type
    m.rootType = unwrapped.rootType; // original wrapper type (if needed)

    // ✅ ALWAYS STRING: prevents ".trim of null" everywhere
    const body =
      m.type === "conversation" ? m.msg :
      m.type === "extendedTextMessage" ? m.msg?.text :
      m.type === "imageMessage" ? m.msg?.caption :
      m.type === "videoMessage" ? m.msg?.caption :
      m.type === "documentMessage" ? (m.msg?.caption || m.msg?.fileName) :
      m.type === "templateButtonReplyMessage" ? (m.msg?.selectedId || m.msg?.selectedDisplayText) :
      m.type === "buttonsResponseMessage" ? (m.msg?.selectedButtonId || m.msg?.selectedDisplayText) :
      "";

    m.body = toStr(body);        // raw body (string)
    m.text = safeTrim(m.body);   // trimmed safe text (string)
    m.argsText = m.text;         // alias if your handler uses other names

    // Quoted
    m.quoted = m.msg?.contextInfo?.quotedMessage || null;

    if (m.quoted) {
      // quotedMessage itself is a "message object"
      const qUnwrapped = unwrapBaileysMessage(m.quoted);

      m.quoted.type = qUnwrapped.type;
      m.quoted.msg = qUnwrapped.msg;

      m.quoted.id = m.msg?.contextInfo?.stanzaId;
      m.quoted.sender = m.msg?.contextInfo?.participant;
      const myNum = toStr(robin?.user?.id).split(":")[0];
      m.quoted.fromMe = toStr(m.quoted.sender).includes(myNum);

      // quoted helpers
      m.quoted.download = (filename) =>
        downloadMediaMessage(
          {
            type: m.quoted.type,
            msg: m.quoted.msg,
          },
          filename
        );
    }
  } else {
    // Ensure these exist as strings even if message missing
    m.body = "";
    m.text = "";
    m.argsText = "";
  }

  // Reply helpers (all safe strings)
  m.reply = (text, id = m.chat, options = {}) => {
    const mentions = Array.isArray(options.mentions) ? options.mentions : [m.sender].filter(Boolean);
    return robin.sendMessage(
      id,
      { text: toStr(text), contextInfo: mentions.length ? { mentionedJid: mentions } : undefined },
      { quoted: m }
    );
  };

  m.replyS = (stik, id = m.chat, options = {}) => {
    const mentions = Array.isArray(options.mentions) ? options.mentions : [m.sender].filter(Boolean);
    return robin.sendMessage(
      id,
      { sticker: stik, contextInfo: mentions.length ? { mentionedJid: mentions } : undefined },
      { quoted: m }
    );
  };

  m.replyImg = (img, text, id = m.chat, options = {}) => {
    const mentions = Array.isArray(options.mentions) ? options.mentions : [m.sender].filter(Boolean);
    return robin.sendMessage(
      id,
      { image: img, caption: toStr(text), contextInfo: mentions.length ? { mentionedJid: mentions } : undefined },
      { quoted: m }
    );
  };

  m.replyVid = (vid, text, id = m.chat, options = {}) => {
    const mentions = Array.isArray(options.mentions) ? options.mentions : [m.sender].filter(Boolean);
    const gif = !!options.gif;
    return robin.sendMessage(
      id,
      { video: vid, caption: toStr(text), gifPlayback: gif, contextInfo: mentions.length ? { mentionedJid: mentions } : undefined },
      { quoted: m }
    );
  };

  m.replyAud = (aud, id = m.chat, options = {}) => {
    const mentions = Array.isArray(options.mentions) ? options.mentions : [m.sender].filter(Boolean);
    const ptt = !!options.ptt;
    return robin.sendMessage(
      id,
      { audio: aud, ptt, mimetype: "audio/mpeg", contextInfo: mentions.length ? { mentionedJid: mentions } : undefined },
      { quoted: m }
    );
  };

  m.replyDoc = (doc, id = m.chat, options = {}) => {
    const mentions = Array.isArray(options.mentions) ? options.mentions : [m.sender].filter(Boolean);
    const filename = toStr(options.filename || "undefined.pdf");
    const mimetype = toStr(options.mimetype || "application/pdf");
    return robin.sendMessage(
      id,
      { document: doc, fileName: filename, mimetype, contextInfo: mentions.length ? { mentionedJid: mentions } : undefined },
      { quoted: m }
    );
  };

  m.react = (emoji) => robin.sendMessage(m.chat, { react: { text: toStr(emoji), key: m.key } });

  return m;
};

module.exports = { sms, downloadMediaMessage };
