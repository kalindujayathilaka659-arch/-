const { cmd } = require("../command");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");

// use only temp folder that already exists in project root
const TEMP_DIR = path.join(process.cwd(), "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

cmd(
  {
    pattern: "torrent",
    react: "🧲",
    desc: "Download file using magnet link (supports up to 2GB)",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    if (!q || !q.startsWith("magnet:")) {
      return reply("❌ *Send a valid magnet link*\n\nUsage: `.torrent <magnet>`");
    }

    let progressMsg = await reply("🧲 *Starting torrent download...*");

    try {
      const WebTorrent = (await import("webtorrent")).default;
      const client = new WebTorrent();

      client.add(q, async (torrent) => {
        const updateProgress = async () => {
          const percent = Math.round(torrent.progress * 100);
          const speed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
          const eta = Math.round(torrent.timeRemaining / 1000);

          await robin.sendMessage(
            from,
            {
              text:
                `🧲 *Torrent Downloading...*\n\n` +
                `📂 *Name:* ${torrent.name}\n` +
                `📊 *Progress:* ${percent}%\n` +
                `⚡ *Speed:* ${speed} MB/s\n` +
                `⏳ *ETA:* ${eta}s`,
              edit: progressMsg.key,
            },
            { quoted: mek }
          );
        };

        const interval = setInterval(updateProgress, 2000);

        torrent.on("done", async () => {
          clearInterval(interval);

          const mainFile = torrent.files.sort((a, b) => b.length - a.length)[0];
          const filePath = path.join(TEMP_DIR, mainFile.name);

          await new Promise((resolve, reject) => {
            mainFile.createReadStream()
              .pipe(fs.createWriteStream(filePath))
              .on("finish", resolve)
              .on("error", reject);
          });

          const fileSize = fs.statSync(filePath).size;
          if (fileSize > 2 * 1024 * 1024 * 1024) {
            fs.unlinkSync(filePath);
            return reply("❌ *File too large.* Max supported size: 2GB");
          }

          const fileMime = mime.lookup(filePath) || "application/octet-stream";

          await robin.sendMessage(
            from,
            {
              text: `🎉 *Download Completed:* ${mainFile.name}`,
              edit: progressMsg.key,
            },
            { quoted: mek }
          );

          await robin.sendMessage(
            from,
            {
              document: fs.readFileSync(filePath),
              fileName: path.basename(filePath),
              mimetype: fileMime,
            },
            { quoted: mek }
          );

          fs.unlinkSync(filePath);
        });
      });
    } catch (err) {
      console.error(err);
      reply("❌ Error: " + err.message);
    }
  }
);
