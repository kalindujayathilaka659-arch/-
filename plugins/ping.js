const { cmd } = require("../command");
const os = require("os"); // for CPU info
const { isOwner } = require("../lib/auth");

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// Function to calculate average CPU usage
function getCpuUsage() {
  const cpus = os.cpus();

  let user = 0;
  let nice = 0;
  let sys = 0;
  let idle = 0;
  let irq = 0;

  for (let cpu of cpus) {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  }

  const total = user + nice + sys + idle + irq;
  const usage = ((total - idle) / total) * 100;
  return usage.toFixed(2);
}

cmd(
  {
    pattern: "ping",
    ownerOnly: true,
    desc: "Ping, uptime, RAM, and CPU usage (with image)",
    react: "🏓",
    category: "test",
  },
  async (robin, mek, m, { reply }) => {
    try {
      const chatId = m?.from || m?.key?.remoteJid;
      if (!chatId) return reply("❌ Invalid chat ID.");

      const start = Date.now();

      await robin.sendMessage(
        chatId,
        { text: "🏓 Pinging..." },
        { quoted: mek }
      );

      const latency = Date.now() - start;
      const uptime = formatUptime(process.uptime());

      // ✅ FIXED RAM VALUES
      const usedRAM = process.memoryUsage().rss / 1024 / 1024;
      const totalRAM = os.totalmem() / 1024 / 1024;

      const cpuUsage = getCpuUsage();

      // 👇 Ghost MD image
      const imageUrl =
        "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true";

      const message = `🏓 *PONG!*

📶 *Latency:* ${latency}ms
⏱ *Uptime:* ${uptime}
🧠 *RAM:* ${usedRAM.toFixed(2)} MB / ${totalRAM.toFixed(2)} MB
⚙️ *CPU Usage:* ${cpuUsage}%

👻 *Ghost MD is running smoothly!*`;

      await robin.sendMessage(
        chatId,
        {
          image: { url: imageUrl },
          caption: message,
        },
        { quoted: mek }
      );

    } catch (err) {
      console.error("Ping error:", err);
      reply(`❌ Error during ping.\n\`\`\`\n${err.message}\n\`\`\``);
    }
  }
);
