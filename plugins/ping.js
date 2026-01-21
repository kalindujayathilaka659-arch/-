const { cmd } = require("../command");
const os = require("os");
const axios = require("axios");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// ✅ More accurate CPU usage (sample-based)
async function getCpuUsageSample(intervalMs = 350) {
  const start = os.cpus();
  await sleep(intervalMs);
  const end = os.cpus();

  let idleDiff = 0;
  let totalDiff = 0;

  for (let i = 0; i < start.length; i++) {
    const s = start[i].times;
    const e = end[i].times;

    const startTotal = s.user + s.nice + s.sys + s.idle + s.irq;
    const endTotal = e.user + e.nice + e.sys + e.idle + e.irq;

    totalDiff += endTotal - startTotal;
    idleDiff += e.idle - s.idle;
  }

  const usage = totalDiff > 0 ? ((totalDiff - idleDiff) / totalDiff) * 100 : 0;
  return usage.toFixed(2);
}

// ✅ Download speed test using Cloudflare official endpoint
async function getDownloadSpeedMbps() {
  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

  const testUrls = [
    "https://speed.cloudflare.com/__down?bytes=5000000", // 5MB
    "https://speed.cloudflare.com/__down?bytes=2000000", // 2MB fallback
  ];

  for (const url of testUrls) {
    try {
      const start = Date.now();

      const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 20000,
        headers: {
          "User-Agent": UA,
          "Accept": "*/*",
          "Cache-Control": "no-cache",
        },
      });

      const bytes = res.data.length;
      const seconds = (Date.now() - start) / 1000;

      if (!bytes || seconds <= 0) return null;

      const mbps = (bytes * 8) / seconds / 1_000_000;
      return Number(mbps.toFixed(2));
    } catch {
      continue;
    }
  }

  return null;
}

cmd(
  {
    pattern: "ping",
    ownerOnly: true,
    desc: "Ping, uptime, RAM, CPU, + network speed (animated)",
    react: "🏓",
    category: "test",
  },
  async (robin, mek, m, { reply }) => {
    try {
      const chatId = m?.from || m?.key?.remoteJid;
      if (!chatId) return reply("❌ Invalid chat ID.");

      const start = Date.now();

      // ✅ Send one message and animate with edits
      const pingMsg = await robin.sendMessage(
        chatId,
        { text: "🏓 Pinging" },
        { quoted: mek }
      );

      const frames = ["🏓 Pinging.", "🏓 Pinging..", "🏓 Pinging..."];
      let frameIndex = 0;

      const anim = setInterval(async () => {
        try {
          frameIndex = (frameIndex + 1) % frames.length;
          await robin.sendMessage(chatId, { text: frames[frameIndex], edit: pingMsg.key });
        } catch {}
      }, 500);

      // ✅ Latency check
      const latency = Date.now() - start;

      // ✅ Stats
      const uptime = formatUptime(process.uptime());
      const usedRAM = process.memoryUsage().rss / 1024 / 1024;
      const totalRAM = os.totalmem() / 1024 / 1024;

      // ✅ run CPU + Net speed together
      const [cpuUsage, downloadMbps] = await Promise.all([
        getCpuUsageSample(350),
        getDownloadSpeedMbps(),
      ]);

      clearInterval(anim);

      // ✅ Edit ping msg final
      await robin.sendMessage(
        chatId,
        { text: "✅ Pong! Sending status…", edit: pingMsg.key },
        { quoted: mek }
      );

      // 👇 Ghost MD image
      const imageUrl =
        "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true";

      const message =
        `🏓 *PONG!*\n\n` +
        `📶 *Latency:* ${latency}ms\n` +
        `⏱ *Uptime:* ${uptime}\n` +
        `🧠 *RAM:* ${usedRAM.toFixed(2)} MB / ${totalRAM.toFixed(2)} MB\n` +
        `⚙️ *CPU Usage:* ${cpuUsage}%\n` +
        `📡 *Net Speed:* ${downloadMbps ? `${downloadMbps} Mbps` : "Blocked/No access"}\n\n` +
        `👻 *Ghost MD is running smoothly!*`;

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
