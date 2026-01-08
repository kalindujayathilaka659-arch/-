const { cmd } = require("../command")
const { Sticker, StickerTypes } = require("wa-sticker-formatter")
const fs = require("fs")
const path = require("path")
const os = require("os")
const ffmpeg = require("fluent-ffmpeg")
const { sms, downloadMediaMessage } = require("../lib/msg")
const { isOwner } = require("../lib/auth");

cmd(
  {
    pattern: "sticker",
    react: "🧩",
    ownerOnly: true,
    desc: "Convert image or short video (<20s) to sticker",
    category: "utility",
    filename: __filename,
  },
  async (sock, mek, m, { reply, from }) => {
    try {
      // --- Normalize message using sms()
      const message = sms(sock, mek)

      // --- Determine sender for personalized messages
      const senderJid = message.key.fromMe
        ? sock.user.id.split(":")[0] + "@s.whatsapp.net"
        : message.key.participant || message.key.remoteJid
      const pushname =
        message.pushName || senderJid.split("@")[0] || "User"

      // --- Check quoted or direct media
      let quoted = message.quoted || message
      if (!quoted?.msg) return reply(`🖼️ Hey ${pushname}, reply to an image or video (max 20s)`)

      const mType = quoted.type
      const isImage = mType === "imageMessage"
      const isVideo = mType === "videoMessage" || mType === "gifMessage"

      if (!isImage && !isVideo)
        return reply(`🖼️ Hey ${pushname}, reply to an image or video (max 20s)`)

      // --- Check video duration
      const duration =
        quoted.msg?.seconds ||
        0
      if (isVideo && duration > 20)
        return reply(`❌ Hey ${pushname}, video too long (max 20s)`)

      // --- Temp files
      const inputPath = path.join(os.tmpdir(), `input_${Date.now()}`)
      const outputPath = path.join(os.tmpdir(), `output_${Date.now()}.webp`)

      // --- Download media
      const buffer = await downloadMediaMessage(quoted, isVideo ? "video" : "image")
      if (!buffer) return reply("❌ Failed to download media.")

      fs.writeFileSync(inputPath, buffer)

      // --- Convert to WebP
      await new Promise((resolve, reject) => {
        const ff = ffmpeg(inputPath)
          .outputOptions([
            "-vcodec libwebp",
            "-vf scale=512:512:force_original_aspect_ratio=decrease,fps=15",
            "-loop 0",
            "-an",
            "-vsync 0",
          ])
          .toFormat("webp")
          .save(outputPath)
          .on("end", resolve)
          .on("error", reject)

        if (isVideo) ff.duration(20)
      })

      // --- Create sticker
      const sticker = new Sticker(fs.readFileSync(outputPath), {
        pack: "GHOST-MD",
        author: pushname,
        type: StickerTypes.FULL,
        quality: 100,
      })

      await sock.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: mek })

      // --- Cleanup
      fs.unlinkSync(inputPath)
      fs.unlinkSync(outputPath)

      console.log(`✅ Sticker created by ${pushname} | JID: ${senderJid}`)
    } catch (err) {
      console.error("❌ Sticker error:", err)
      reply(`❌ Failed to create sticker. ${err.message || ""}`)
    }
  }
)
