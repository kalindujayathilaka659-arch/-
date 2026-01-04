// ====================== IMPORTS ======================
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
const qrcode = require("qrcode-terminal");
const axios = require("axios");
const { File } = require("megajs");
const express = require("express");
const app = express();
const port = process.env.PORT || 8000;

const { getBuffer, getGroupAdmins } = require("./lib/functions");
const { sms, downloadMediaMessage } = require("./lib/msg");
const connectDB = require("./lib/mongodb");
const { readEnv } = require("./lib/database");
const rawConfig = require("./config");
const ownerNumber = rawConfig.OWNER_NUM;
const sessionFilePath = path.join(__dirname, "auth_info_baileys/creds.json");
const chokidar = require("chokidar");

// ====================== SESSION SETUP ======================
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
      writeStream.on("finish", () => {
        console.log("✅ Session downloaded successfully");
        resolve();
      });
      writeStream.on("error", reject);
    });
  } catch (err) {
    console.error("❌ Failed to download session:", err.message);
    process.exit(1);
  }
}

// ====================== PLUGIN LOADER ======================
function loadPlugin(client, filePath) {
  if (!filePath.endsWith(".js") || path.basename(filePath) === "loader.js") return;
  try {
    delete require.cache[require.resolve(filePath)];
    const plugin = require(filePath);
    if (typeof plugin === "function") plugin(client);
    console.log(`✅ Loaded plugin: ${path.basename(filePath)}`);
  } catch (err) {
    console.log(`❌ Failed to load plugin ${path.basename(filePath)}:`, err.message);
  }
}

function loadPlugins(client) {
  const pluginsPath = path.join(__dirname, "plugins");
  console.log("📂 Loading plugins from:", pluginsPath);

  if (!fs.existsSync(pluginsPath)) return;

  fs.readdirSync(pluginsPath).forEach(file => loadPlugin(client, path.join(pluginsPath, file)));

  chokidar.watch(pluginsPath, { ignoreInitial: true })
    .on("add", filePath => loadPlugin(client, filePath))
    .on("change", filePath => loadPlugin(client, filePath));
}

// ====================== CONNECT FUNCTION ======================
async function connectToWA() {
  await connectDB();
  const envConfig = await readEnv();
  const prefix = rawConfig.PREFIX || "!";

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

  // ====================== CONNECTION EVENTS ======================
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(shouldReconnect ? "🔄 Reconnecting..." : "🔒 Session closed, logged out.");
      if (shouldReconnect) connectToWA();
    } else if (connection === "open") {
      console.log("✅ GHOST MD connected!");
      loadPlugins(sock);

      sock.sendMessage(ownerNumber + "@s.whatsapp.net", {
        image: { url: "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true" },
        caption: "👻GHOST MD👻 connected successfully ✅",
      });
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // ====================== MESSAGE HANDLER ======================
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const mek = messages[0];
      if (!mek?.message) return;

      const from = mek.key.remoteJid;
      const isGroup = from.endsWith("@g.us");
      const sender = mek.key.fromMe ? sock.user.id.split(":")[0] + "@s.whatsapp.net" : mek.key.participant || from;
      const senderNumber = sender.split("@")[0];
      const botNumber = sock.user.id.split(":")[0];
      const isOwner = rawConfig.OWNER_NUM.includes(senderNumber) || senderNumber === botNumber;

      // ===== MODE CHECK =====
      switch (rawConfig.MODE) {
        case "private":
          if (!isOwner) return;
          break;
        case "inbox":
          if (isGroup && !isOwner) return;
          break;
        case "groups":
          if (!isGroup && !isOwner) return;
          break;
        case "public":
          // everyone can use
          break;
        default:
          console.warn(`⚠️ Unknown MODE: "${rawConfig.MODE}", defaulting to private.`);
          if (!isOwner) return;
      }

      // ===== AUTO STATUS READ =====
      if (rawConfig.AUTO_STATUS_SEEN && from === "status@broadcast") {
        try {
          await sock.readMessages([mek.key]);
          console.log(`✅ Auto-seen status from ${mek.pushName || "unknown"}`);
          return;
        } catch (e) {
          console.error("❌ Auto status seen failed:", e.message);
        }
      }

      // ===== AUTO READ & REACT =====
      if (rawConfig.AUTO_READ) await sock.readMessages([mek.key]);
      if (rawConfig.AUTO_REACT) {
        try {
          await sock.sendMessage(from, { react: { text: "✅", key: mek.key } });
        } catch (e) {
          console.error("Auto react failed:", e.message);
        }
      }

      // ===== MESSAGE PARSING =====
      mek.message = getContentType(mek.message) === "ephemeralMessage"
        ? mek.message.ephemeralMessage.message
        : mek.message;

      const m = sms(sock, mek); // make sure sms function is exported correctly
      const type = getContentType(mek.message);

      if (from === "status@broadcast") return;

      const body =
        type === "conversation" ? mek.message.conversation :
        type === "extendedTextMessage" ? mek.message.extendedTextMessage.text :
        type === "imageMessage" ? mek.message.imageMessage.caption :
        type === "videoMessage" ? mek.message.videoMessage.caption : "";

      const isCmd = body?.startsWith(prefix);
      const command = isCmd ? body.slice(prefix.length).trim().split(" ")[0].toLowerCase() : "";
      const args = body.trim().split(/\s+/).slice(1);
      const q = args.join(" ");

      const botNumber2 = await jidNormalizedUser(sock.user.id);
      const groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => null) : null;
      const participants = groupMetadata?.participants || [];
      const groupAdmins = isGroup ? await getGroupAdmins(participants) : [];

      const reply = (text) => sock.sendMessage(from, { text }, { quoted: mek });

      // ===== SEND FILE FUNCTION =====
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

      // ===== COMMAND HANDLER =====
      const events = require("./command");
      if (isCmd) {
        const cmdObj = events.commands.find(c => c.pattern === command || c.alias?.includes(command));
        if (cmdObj) {
          if (cmdObj.react) sock.sendMessage(from, { react: { text: cmdObj.react, key: mek.key } });
          try {
            await cmdObj.function(sock, mek, m, { from, body, q, args, isGroup, sender, isOwner, reply });
          } catch (err) {
            console.error("❌ Command error:", err.message);
          }
        }
      }

      // Trigger on events
      for (const cmd of events.commands) {
        const shouldRun =
          (cmd.on === "body" && body) ||
          (cmd.on === "text" && q) ||
          (cmd.on === "image" && type === "imageMessage") ||
          (cmd.on === "sticker" && type === "stickerMessage");
        if (shouldRun) {
          try {
            await cmd.function(sock, mek, m, { from, body, q, reply });
          } catch (e) {
            console.error(`❌ Trigger error [${cmd.on}]`, e.message);
          }
        }
      }

    } catch (err) {
      console.error("❌ Message handler error:", err.message);
    }
  });
}

// ====================== EXPRESS PING ======================
app.get("/", (req, res) => {
  res.send("👻GHOST MD👻 started ✅");
});

app.listen(port, () => console.log(`🌐 Server running on http://localhost:${port}`));

// ====================== START BOT ======================
(async () => {
  await ensureSession();
  await connectToWA();
})();
