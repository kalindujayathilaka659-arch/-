// All required imports
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

const {
  getBuffer,
  getGroupAdmins,
  sms,
} = require("./lib/functions");

const connectDB = require("./lib/mongodb");
const { readEnv } = require("./lib/database");
const rawConfig = require("./config");
const ownerNumber = rawConfig.OWNER_NUM;
const sessionFilePath = path.join(__dirname, "auth_info_baileys/creds.json");

// Auto Status Watch plugin
const autoWatch = require("./plugins/autorun-watch");

// =================== SESSION SETUP ============================
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

// =================== PLUGIN LOADER ============================
function loadPlugins() {
  const pluginDir = path.resolve(__dirname, "plugins");
  if (!fs.existsSync(pluginDir)) return;

  const pluginFiles = fs.readdirSync(pluginDir).filter((f) => f.endsWith(".js"));
  pluginFiles.forEach((file) => {
    try {
      require(path.join(pluginDir, file));
      console.log(`✅ Loaded plugin: ${file}`);
    } catch (err) {
      console.error(`❌ Failed to load plugin ${file}:`, err.message);
    }
  });
}

// =================== CONNECT FUNCTION ============================
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
        image: { url: "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true" },
        caption: "👻GHOST MD👻 connected successfully ✅",
      });
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // =================== MESSAGE HANDLER ============================
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const mek = messages[0];
      if (!mek?.message) return;

      // Auto Status Watch
      if (rawConfig.AUTO_STATUS_SEEN && mek.key.remoteJid === "status@broadcast") {
        await autoWatch(sock, mek);
        return;
      }

      if (rawConfig.AUTO_READ) await sock.readMessages([mek.key]);
      if (rawConfig.AUTO_REACT) {
        try {
          await sock.sendMessage(mek.key.remoteJid, { react: { text: "✅", key: mek.key } });
        } catch (e) { console.error("Auto react failed:", e.message); }
      }

      mek.message = getContentType(mek.message) === "ephemeralMessage" ? mek.message.ephemeralMessage.message : mek.message;

      const type = getContentType(mek.message);
      const from = mek.key.remoteJid;
      if (from === "status@broadcast") return;

      let body = "";
      if (type === "conversation") body = mek.message.conversation;
      else if (type === "extendedTextMessage") body = mek.message.extendedTextMessage?.text || "";
      else if (type === "imageMessage") body = mek.message.imageMessage?.caption || "";
      else if (type === "videoMessage") body = mek.message.videoMessage?.caption || "";
      body = body || "";

      const isCmd = body.startsWith(prefix);
      const command = isCmd ? body.slice(prefix.length).trim().split(" ")[0].toLowerCase() : "";
      const args = body.trim().split(/\s+/).slice(1);
      const q = args.join(" ");
      const isGroup = from.endsWith("@g.us");
      const sender = mek.key.fromMe ? sock.user.id.split(":")[0] + "@s.whatsapp.net" : mek.key.participant || from;
      const senderNumber = sender.split("@")[0];
      const botNumber = sock.user.id.split(":")[0];
      const isOwner = rawConfig.OWNER_NUM.includes(senderNumber) || botNumber.includes(senderNumber);

      const reply = (text) => sock.sendMessage(from, { text }, { quoted: mek });

      if (!isOwner && envConfig.MODE === "private") return;
      if (!isOwner && isGroup && envConfig.MODE === "inbox") return;
      if (!isOwner && !isGroup && envConfig.MODE === "groups") return;

      // Load commands
      const events = require("./command");
      if (isCmd) {
        const cmd = events.commands.find(c => c.pattern === command) || events.commands.find(c => c.alias?.includes(command));
        if (cmd) {
          try { await cmd.function(sock, mek, sms(sock, mek), { from, body, args, q, reply }); }
          catch (err) { console.error("❌ Command error:", err.message); }
        }
      }

      // Trigger commands
      for (const cmd of events.commands) {
        const shouldRun =
          (cmd.on === "body" && body) ||
          (cmd.on === "text" && q) ||
          (cmd.on === "image" && type === "imageMessage") ||
          (cmd.on === "sticker" && type === "stickerMessage");
        if (shouldRun) {
          try { await cmd.function(sock, mek, sms(sock, mek), { from, body, q, reply }); }
          catch (e) { console.error(`❌ Trigger error [${cmd.on}]`, e.message); }
        }
      }

    } catch (err) {
      console.error("❌ Message handler error:", err.message);
    }
  });
}

// ========== Express Ping ==========
app.get("/", (req, res) => { res.send("👻GHOST MD👻 started ✅"); });
app.listen(port, () => { console.log(`🌐 Server running on http://localhost:${port}`); });

// ========== Start Bot ==========
(async () => {
  await ensureSession();
  await connectToWA();
})();
