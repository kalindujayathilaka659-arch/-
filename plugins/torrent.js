const { cmd } = require("../command");
const WebTorrent = require("webtorrent");
const fs = require("fs");
const path = require("path");

cmd(
  {
    pattern: "magnet",
    react: "🧲",
    desc: "Download torrent files using magnet link",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    try {
      if (!q || !q.startsWith("magnet:?")) {
        return reply("❌ Send a valid magnet link.\n\nExample:\n*magnet magnet:?xt=urn:btih:XXXX*");
      }

      const downloadDir = "./torrents";
      if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

      const client = new WebTorrent();
      await reply("🔗 Adding torrent...\n⏳ Fetching metadata...");

      client.add(q, { path: downloadDir }, async (torrent) => {
        const totalMB = (torrent.length / (1024 ** 2)).toFixed(2);
        let lastEdit = Date.now();

        let statusMsg = await robin.sendMessage(
          from,
          { text: `📥 *Downloading torrent...*\n\n🧲 *Name:* ${torrent.name}\n📦 *Size:* ${totalMB} MB\n⏳ *Starting...*` },
          { quoted: mek }
        );

        const interval = setInterval(async () => {
          try {
            const downloadedMB = (torrent.downloaded / (1024 ** 2)).toFixed(2);
            const percent = (torrent.progress * 100).toFixed(1);
            const speed = (torrent.downloadSpeed / (1024 ** 2)).toFixed(2);
            const eta = (torrent.timeRemaining / 1000).toFixed(0);

            if (Date.now() - lastEdit >= 2500) { // update every 2.5s
              lastEdit = Date.now();
              await robin.sendMessage(
                from,
                {
                  text:
                    `🧲 *TORRENT DOWNLOAD*\n\n` +
                    `📁 *File:* ${torrent.name}\n` +
                    `⚡ *Speed:* ${speed} MB/s\n` +
                    `📊 *Progress:* ${percent}%\n` +
                    `⬇ *Downloaded:* ${downloadedMB}/${totalMB} MB\n` +
                    `⏳ *ETA:* ${eta} sec`,
                  edit: statusMsg.key,
                }
              ).catch(() => {});
            }
          } catch (e) {}
        }, 1000);

        torrent.on("done", async () => {
          clearInterval(interval);

          await robin.sendMessage(
            from,
            {
              text:
                `🎉 *Download Complete!*\n\n` +
                `🧲 *Name:* ${torrent.name}\n` +
                `📦 *Size:* ${totalMB} MB\n` +
                `📁 *Saved to:* ${path.resolve(downloadDir)}`
            },
            { quoted: mek }
          );

          client.destroy();
        });
      });

    } catch (err) {
      console.log("Torrent error:", err);
      reply("❌ Failed to process torrent.\n" + err.message);
    }
  }
);
