const { cmd } = require("../command");
const axios = require("axios");
const { isOwner } = require("../lib/auth");

cmd({
  pattern: "alive",
  alias: ["bot", "ghost"],
  ownerOnly: true,
  react: "👻",
  desc: "Check if the bot is online (image + voice message + audio from URL)",
  category: "main",
  filename: __filename
}, 
async (robin, mek, m, { from, quoted, reply }) => {
  try {
    // 👇 PUT YOUR NEW IMAGE LINK HERE
    const aliveImage = "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true"; // 🖼️ Replace this with your new image URL

    // 👇 Your improved alive message
    const aliveMessage = `
👻 *Hello, I’m alive now!*

> 🧠 *Developer Note:*

> This WhatsApp bot is built for simplicity and user convenience — no unnecessary complications.

> 💀 *Created by Nadeela Chamath* 💀

👻 *Ghost MD is Online!* 👻
    `.trim();

    // Send image + caption
    await robin.sendMessage(from, {
      image: { url: aliveImage },
      caption: aliveMessage
    }, { quoted: mek });

    // 👇 Optional spooky sound
    const songUrl = "https://cdn.pixabay.com/download/audio/2021/08/09/audio_0b8c6f0c5b.mp3?filename=boo-and-laugh-7060.mp3";
    const response = await axios.get(songUrl, { responseType: "arraybuffer" });
    const audioBuffer = Buffer.from(response.data, "utf-8");

    await robin.sendMessage(from, {
      audio: audioBuffer,
      mimetype: "audio/mpeg",
      fileName: "ghost-alive.mp3"
    }, { quoted: mek });

  } catch (e) {
    console.error("Alive command error:", e);
    reply(`❌ Error: ${e.message || "Something went wrong."}`);
  }
});
