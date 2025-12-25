const { cmd } = require("../command");
const fs = require("fs");
const path = require("path");

// temp folder
const DOWNLOAD_DIR = path.join(__dirname, "../temp");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

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
      // ⬇️ dynamic import to fix ESM error
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
                `⏳ *ETA:* ${eta} sec`,
              edit: progressMsg.key,
            },
            { quoted: mek }
          );
        };

        // ⏱ update progress every second
        const interval = setInterval(updateProgress, 500);

        torrent.on("done", async () => {
          clearInterval(interval);

          // pick biggest file
          const mainFile = torrent.files.sort((a, b) => b.length - a.length)[0];
          const filePath = path.join(DOWNLOAD_DIR, mainFile.name);

          // write file to disk
          await new Promise((resolve, reject) => {
            mainFile.createReadStream()
              .pipe(fs.createWriteStream(filePath))
              .on("finish", resolve)
              .on("error", reject);
          });

          const fileSize = fs.statSync(filePath).size;
          if (fileSize > 2 * 1024 * 1024 * 1024) {
            fs.unlinkSync(filePath);
            return reply("❌ *File too large.* Max 2GB supported.");
          }

          // final progress message
          await robin.sendMessage(
            from,
            {
              text: `🎉 *Download Completed:* ${mainFile.name}`,
              edit: progressMsg.key,
            },
            { quoted: mek }
          );

          // 📌 SEND WITH ORIGINAL NAME + EXTENSION
          await robin.sendMessage(
            from,
            {
              document: fs.readFileSync(filePath),
              fileName: path.basename(filePath), // ⬅️ FIXED: keeps original extension
              mimetype: "application/octet-stream",
            },
            { quoted: mek }
          );

          fs.unlinkSync(filePath);
        });
      });
    } catch (err) {
      console.log(err);
      reply("❌ *Error:* " + err.message);
    }
  }
);
