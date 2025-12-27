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
    desc: "Convert image, GIF, or short video (<20s) to sticker",
    category: "utility",
    filename: __filename,
  },
  async (robin, mek, m, { from, quoted, reply }) => {
    try {
      if (!quoted) return reply("🖼️ Reply to an image, GIF, or video < 20s");

      const isImage = quoted.imageMessage;
      const isVideo = quoted.videoMessage;

      if (!isImage && !isVideo) {
        return reply("❌ Reply to a valid image or video (under 20s).");
      }

      const duration = isVideo ? quoted.videoMessage.seconds || 0 : 0;
      if (isVideo && duration > 20) {
        return reply("❌ Video is too long. Max allowed is 20 seconds.");
      }

      const ext = isVideo ? ".mp4" : ".jpg";
      const tmpInput = path.join(tmpdir(), `input_${Date.now()}${ext}`);
      const tmpOutput = path.join(tmpdir(), `output_${Date.now()}.webp`);

      const buffer = await downloadMediaMessage(quoted, isVideo ? "video" : "stickerImage");
      if (!buffer) return reply("❌ Failed to download media.");

      await fs.writeFile(tmpInput, buffer);

      if (isVideo) {
        await new Promise((resolve, reject) => {
          ffmpeg(tmpInput)
            .outputOptions([
              "-vcodec", "libwebp",
              "-vf", "scale=512:512:force_original_aspect_ratio=decrease,fps=15,format=rgba",
              "-lossless", "1",
              "-preset", "default",
              "-loop", "0",
              "-an",
              "-vsync", "0",
              "-ss", "0",
              "-t", "20",
            ])
            .toFormat("webp")
            .save(tmpOutput)
            .on("end", resolve)
            .on("error", reject);
        });
      } else {
        // Convert image to webp for better sticker quality and no white dots
        await new Promise((resolve, reject) => {
          ffmpeg(tmpInput)
            .outputOptions([
              "-vcodec", "libwebp",
              "-vf", "scale=512:512:force_original_aspect_ratio=decrease,format=rgba",
              "-lossless", "1",
              "-preset", "default",
              "-an",
              "-vsync", "0",
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
        type: StickerTypes.FULL,
        quality: 100,
      });

      const stickerBuffer = await sticker.toBuffer();
      await robin.sendMessage(from, { sticker: stickerBuffer }, { quoted: mek });

      // Cleanup
      await fs.unlink(tmpInput);
      await fs.unlink(tmpOutput);
    } catch (e) {
      console.error("❌ Sticker error:", e);
      reply(`❌ Error: ${e.message || "Something went wrong."}`);
    }
  }
);
