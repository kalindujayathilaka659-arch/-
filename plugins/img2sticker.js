const { cmd } = require("../command");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const { downloadMediaMessage } = require("../lib/msg.js");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs-extra");
const path = require("path");
const { tmpdir } = require("os");

cmd(
  {
    pattern: "sticker",
    react: "🧩",
    desc: "Convert image, GIF, or short video (<20s) to WhatsApp-safe sticker",
    category: "utility",
    filename: __filename,
  },
  async (robin, mek, m, { from, quoted, reply }) => {
    try {
      if (!quoted)
        return reply("🖼️ Reply to an image, GIF, or video (<20s)");

      const isImage = quoted.imageMessage;
      const isVideo = quoted.videoMessage;

      if (!isImage && !isVideo)
        return reply("❌ Reply to a valid image or video.");

      const duration = isVideo ? quoted.videoMessage.seconds || 0 : 0;
      if (isVideo && duration > 20)
        return reply("❌ Video too long. Max 20 seconds.");

      const inputExt = isVideo ? ".mp4" : ".jpg";
      const tmpInput = path.join(tmpdir(), `stk_in_${Date.now()}${inputExt}`);
      const tmpOutput = path.join(tmpdir(), `stk_out_${Date.now()}.webp`);

      const buffer = await downloadMediaMessage(
        quoted,
        isVideo ? "video" : "image"
      );
      if (!buffer) return reply("❌ Failed to download media.");

      await fs.writeFile(tmpInput, buffer);

      /* ---------- VIDEO → ANIMATED STICKER (MOBILE SAFE) ---------- */
      if (isVideo) {
        await new Promise((resolve, reject) => {
          ffmpeg(tmpInput)
            .outputOptions([
              "-vf",
              "scale=512:512:force_original_aspect_ratio=decrease,fps=15",
              "-c:v", "libwebp",
              "-loop", "0",
              "-an",
              "-preset", "default",
              "-compression_level", "6",
              "-vsync", "0",
              "-t", "20",
            ])
            .toFormat("webp")
            .save(tmpOutput)
            .on("end", resolve)
            .on("error", reject);
        });
      } 
      /* ---------- IMAGE → STATIC STICKER ---------- */
      else {
        await new Promise((resolve, reject) => {
          ffmpeg(tmpInput)
            .outputOptions([
              "-vf",
              "scale=512:512:force_original_aspect_ratio=decrease",
              "-c:v", "libwebp",
              "-lossless", "1",
              "-preset", "default",
              "-an",
            ])
            .toFormat("webp")
            .save(tmpOutput)
            .on("end", resolve)
            .on("error", reject);
        });
      }

      const sticker = new Sticker(fs.readFileSync(tmpOutput), {
        pack: "GHOST-MD",
        author: "Sticker Maker",
        type: isVideo ? StickerTypes.FULL : StickerTypes.DEFAULT,
        quality: 100,
      });

      await robin.sendMessage(
        from,
        { sticker: await sticker.toBuffer() },
        { quoted: mek }
      );

      await fs.unlink(tmpInput);
      await fs.unlink(tmpOutput);

    } catch (e) {
      console.error("❌ Sticker error:", e);
      reply("❌ Failed to create sticker.");
    }
  }
);
