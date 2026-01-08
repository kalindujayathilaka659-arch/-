const { cmd } = require("../command");
const { Sticker } = require("wa-sticker-formatter");
const { downloadMediaMessage, sms } = require("../lib/msg.js");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { isOwner } = require("../lib/auth");

cmd(
  {
    pattern: "toimg",
    ownerOnly: true,
    react: "🖼️",
    desc: "Convert a sticker to an image",
    category: "utility",
    filename: __filename,
  },
  async (sock, mek, m, { from, reply }) => {
    try {
      // Normalize message
      const message = sms(sock, mek);

      // Determine quoted or direct sticker
      const quoted = message.quoted || message;

      // Check if message has a sticker
      const mType = quoted.type;
      if (mType !== "stickerMessage") {
        return reply("🖼️ Please reply to a sticker to convert it to an image.");
      }

      // Download sticker
      const stickerBuffer = await downloadMediaMessage(quoted, "stickerInput");
      if (!stickerBuffer)
        return reply("❌ Failed to download the sticker. Try again!");

      // Convert sticker to image buffer using Sticker class
      const sticker = new Sticker(stickerBuffer, {
        pack: "👻GHOST",
        author: "MD👻",
        type: "FULL",
        quality: 100,
      });

      const imageBuffer = await sticker.toBuffer({ format: "image/jpeg" });

      // Send the image
      await sock.sendMessage(
        from,
        {
          image: imageBuffer,
          caption: "Here is your converted image!\n\n𝐌𝐚𝐝𝐞 𝐛𝐲 🗿Nadeela Chamath🗿",
        },
        { quoted: mek }
      );
    } catch (err) {
      console.error("❌ toimg error:", err);
      reply(`❌ Failed to convert sticker: ${err.message || err}`);
    }
  }
);
