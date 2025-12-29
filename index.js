// ==================== IMPORTS ====================
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  fetchLatestBaileysVersion,
  Browsers,
} = require("@whiskeysockets/baileys");

const fs = require("fs");
const path = require("path");
const P = require("pino");
const axios = require("axios");
const { File } = require("megajs");
const express = require("express");

const app = express();
const port = process.env.PORT || 8000;

const { getBuffer, getGroupAdmins } = require("./lib/functions");
const { sms } = require("./lib/msg");
const connectDB = require("./lib/mongodb");
const { readEnv } = require("./lib/database");

const rawConfig = require("./config");
const ownerNumber = rawConfig.OWNER_NUM;
const sessionFilePath = path.join(__dirname, "auth_info_baileys/creds.json");

// ==================== SESSION SETUP ====================
async function ensureSession() {
  if (fs.existsSync(sessionFilePath)) return;

  if (!rawConfig.SESSION_ID) {
    console.error("❌ Please set your SESSION_ID in config.js or environment variables.");
    process.exit(1);
  }

  try {
    const file = File.fromURL(`https://mega.nz/file/${rawConfig.SESSION_ID}`);
    await file.loadAttributes();

    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(sessionFilePath);
      file.download().pipe(writeStream);
      writeStream.on("finish", () => resolve());
      writeStream.on("error", reject);
    });
    console.log("✅ Session downloaded successfully");
  } catch (err) {
    console.error("❌ Failed to download session:", err.message);
    process.exit(1);
  }
}

// ==================== PLUGIN LOADER ====================
function loadPlugins() {
  const pluginDir = path.resolve(__dirname, "plugins");
  if (!fs.existsSync(pluginDir)) return console.warn("⚠️ Plugins directory does not exist!");

  const pluginFiles = fs.readdirSync(pluginDir).filter(f => f.endsWith(".js"));
  if (!pluginFiles.length) return console.warn("⚠️ No plugins found.");

  for (const file of pluginFiles) {
    try {
      require(path.join(pluginDir, file));
      console.log(`✅ Loaded plugin: ${file}`);
    } catch (err) {
      console.error(`❌ Failed to load plugin ${file}:`, err.message);
    }
  }
}

// ==================== CONNECT FUNCTION ====================
async function connectToWA() {
  await connectDB();
  const envConfig = await readEnv();
  const prefix = envConfig.PREFIX;

  console.log("🔌 Connecting GHOST MD...");

  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys/");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    browser: Browsers.macOS("Firefox"),
    syncFullHistory: true,
    auth: state,
    version,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(shouldReconnect ? "🔄 Reconnecting..." : "🔒 Session closed, logged out.");
      if (shouldReconnect) connectToWA();
    } else if (connection === "open") {
      console.log("✅ GHOST MD connected!");
      loadPlugins();
      sock.sendMessage(ownerNumber + "@s.whatsapp.net", {
        image: { url: rawConfig.ALIVE_IMG },
        caption: "👻GHOST MD👻 connected successfully ✅",
      });

      // ===== INIT STATUS WATCH PLUGIN =====
      const statusWatchPlugin = require("./plugins/statusWatch");
      statusWatchPlugin.init(sock, rawConfig);
    }
  });

  // ==================== MESSAGES HANDLER ====================
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const mek = messages[0];
      if (!mek.message) return;

      const from = mek.key.remoteJid;

      // === NORMAL MESSAGE HANDLING ===
      if (rawConfig.AUTO_READ) await sock.readMessages([mek.key]);
      if (rawConfig.AUTO_REACT) {
        try { await sock.sendMessage(from, { react: { text: "✅", key: mek.key } }); } catch {}
      }

      // Handle ephemeral messages
      mek.message = getContentType(mek.message) === "ephemeralMessage"
        ? mek.message.ephemeralMessage.message
        : mek.message;

      const m = sms(sock, mek);
      const type = getContentType(mek.message);

      const body = type === "conversation"
        ? mek.message.conversation
        : type === "extendedTextMessage"
        ? mek.message.extendedTextMessage?.text
        : type === "imageMessage"
        ? mek.message.imageMessage?.caption
        : type === "videoMessage"
        ? mek.message.videoMessage?.caption
        : "";

      const isCmd = body?.startsWith(prefix);
      const command = isCmd ? body.slice(prefix.length).trim().split(" ")[0].toLowerCase() : "";
      const args = body.trim().split(/\s+/).slice(1);
      const q = args.join(" ");
      const isGroup = from.endsWith("@g.us");
      const sender = mek.key.fromMe
        ? sock.user.id.split(":")[0] + "@s.whatsapp.net"
        : mek.key.participant || mek.key.remoteJid;
      const senderNumber = sender.split("@")[0];
      const botNumber = sock.user.id.split(":")[0];
      const pushname = mek.pushName || "Sin Nombre";
      const isMe = botNumber.includes(senderNumber);
      const isOwner = rawConfig.OWNER_NUM.includes(senderNumber) || isMe;

      const botNumber2 = await jidNormalizedUser(sock.user.id);
      const groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => null) : null;
      const participants = groupMetadata?.participants || [];
      const groupAdmins = isGroup ? await getGroupAdmins(participants) : [];
      const reply = (text) => sock.sendMessage(from, { text }, { quoted: mek });

      // === MODE CHECKS ===
      if (!isOwner && envConfig.MODE === "private") return;
      if (!isOwner && isGroup && envConfig.MODE === "inbox") return;
      if (!isOwner && !isGroup && envConfig.MODE === "groups") return;

      // === sendFileUrl helper ===
      sock.sendFileUrl = async (jid, url, caption = "", quoted, options = {}) => {
        try {
          const res = await axios.head(url);
          const mime = res.headers["content-type"];
          const type = mime.split("/")[0];
          const mediaData = await getBuffer(url);

          if (type === "image") return sock.sendMessage(jid, { image: mediaData, caption, ...options }, { quoted });
          if (type === "video") return sock.sendMessage(jid, { video: mediaData, caption, mimetype: "video/mp4", ...options }, { quoted });
          if (type === "audio") return sock.sendMessage(jid, { audio: mediaData, mimetype: "audio/mpeg", ...options }, { quoted });
          if (mime === "application/pdf") return sock.sendMessage(jid, { document: mediaData, mimetype: mime, caption, ...options }, { quoted });
        } catch (err) {
          console.error("❌ sendFileUrl error:", err.message);
        }
      };

      // === COMMAND SYSTEM ===
      const events = require("./command");

      if (isCmd) {
        const cmdObj =
          events.commands.find((c) => c.pattern === command) ||
          events.commands.find((c) => c.alias?.includes(command));
        if (cmdObj) {
          if (cmdObj.react) await sock.sendMessage(from, { react: { text: cmdObj.react, key: mek.key } });
          try {
            await cmdObj.function(sock, mek, m, { from, quoted: mek.quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupAdmins, reply });
          } catch (err) { console.error("❌ Command error:", err.message); }
        }
      }

      // === TRIGGER COMMANDS ===
      for (const cmdObj of events.commands) {
        const shouldRun =
          (cmdObj.on === "body" && body) ||
          (cmdObj.on === "text" && q) ||
          (cmdObj.on === "image" && type === "imageMessage") ||
          (cmdObj.on === "sticker" && type === "stickerMessage");

        if (shouldRun) {
          try { await cmdObj.function(sock, mek, m, { from, body, q, reply }); } catch (e) { console.error(`❌ Trigger error [${cmdObj.on}]`, e.message); }
        }
      }

    } catch (err) {
      console.error("❌ Message handler error:", err.message);
    }
  });
}

// ==================== EXPRESS PING ====================
app.get("/", (req, res) => res.send("👻GHOST MD👻 started ✅"));
app.listen(port, () => console.log(`🌐 Server running on http://localhost:${port}`));

// ==================== START BOT ====================
(async () => {
  await ensureSession();
  await connectToWA();
})();
