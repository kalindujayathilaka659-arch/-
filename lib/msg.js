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
  const rootType = type;

  // Unwrap common wrappers: ephemeral + viewOnce variants
  while (type === "ephemeralMessage" || (type && type.startsWith("viewOnceMessage"))) {
    if (type === "ephemeralMessage") {
      root = root.ephemeralMessage?.message || null;
    } else {
      root = root[type]?.message || null;
    }
    if (!root) break;
    type = getContentType(root);
  }

  return { type, msg: type ? root[type] : null, rootType };
}

/** Extract text safely from many message types */
function extractBody(type, msg) {
  if (!type || !msg) return "";

  switch (type) {
    case "conversation":
      return msg;

    case "extendedTextMessage":
      return msg?.text;

    case "imageMessage":
    case "videoMessage":
      return msg?.caption;

    case "documentMessage":
      return msg?.caption || msg?.fileName;

    case "templateButtonReplyMessage":
      return msg?.selectedId || msg?.selectedDisplayText;

    case "buttonsResponseMessage":
      return msg?.selectedButtonId || msg?.selectedDisplayText;

    // ✅ common new types that often break handlers
    case "listResponseMessage":
      return (
        msg?.singleSelectReply?.selectedRowId ||
        msg?.title ||
        msg?.description
      );

    case "interactiveResponseMessage":
      return (
        msg?.nativeFlowResponseMessage?.paramsJson ||
        msg?.buttonReply?.id ||
        msg?.buttonReply?.displayText ||
        msg?.listReply?.id ||
        msg?.listReply?.title
      );

    case "messageContextInfo":
      return "";

    default:
      return "";
  }
}

const downloadMediaMessage = async (m, filename) => {
  if (!m) return null;

  try {
    let type = m.type;
    let msg = m.msg;

    // Handle viewOnce wrappers if passed here
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

  // ✅ Always initialize strings so other code never sees null
  m.body = "";
  m.text = "";
  m.argsText = "";

  // Basic message info
  if (m.key) {
    m.id = m.key.id;
    m.chat = m.key.remoteJid;
    m.fromMe = !!m.key.fromMe;
    m.isGroup = !!(m.chat && m.chat.endsWith("@g.us"));

    const myJid = toStr(robin?.user?.id).split(":")[0] + "@s.whatsapp.net";
    m.sender = m.fromMe ? myJid : m.isGroup ? m.key.participant : m.key.remoteJid;
  }

  // Message content
  if (m.message) {
    const unwrapped = unwrapBaileysMessage(m.message);

    m.type = unwrapped.type;
    m.msg = unwrapped.msg;
    m.rootType = unwrapped.rootType;

    const body = extractBody(m.type, m.msg);

    // ✅ ALWAYS strings
    m.body = toStr(body);
    m.text = safeTrim(m.body);
    m.argsText = m.text;

    // Quoted
    const ctx = m.msg?.contextInfo;
    m.quoted = ctx?.quotedMessage || null;

    if (m.quoted) {
      const qUnwrapped = unwrapBaileysMessage(m.quoted);
      m.quoted.type = qUnwrapped.type;
      m.quoted.msg = qUnwrapped.msg;

      m.quoted.id = ctx?.stanzaId;
      m.quoted.sender = ctx?.participant;

      const myNum = toStr(robin?.user?.id).split(":")[0];
      m.quoted.fromMe = toStr(m.quoted.sender).includes(myNum);

      m.quoted.download = (filename) =>
        downloadMediaMessage({ type: m.quoted.type, msg: m.quoted.msg }, filename);
    }
  }

  // ✅ helper: always safe text getter (use this in handler/plugins if needed)
  m.getText = () => safeTrim(m.body);

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
