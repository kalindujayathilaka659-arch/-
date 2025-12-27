/**
 * TORRENT DOWNLOADER (NON-BLOCKING)
 * - Download magnet link up to 2GB
 * - Shows progress
 * - Does NOT freeze bot during download
 */

const { cmd } = require("../command");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { isOwner } = require("../lib/auth");

const DOWNLOAD_DIR = path.join(__dirname, "../temp");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

cmd(
  {
    pattern: "torrent",
    ownerOnly: true,
    react: "🧲",
    desc: "Download file using magnet link (supports up to 2GB)",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    if (!q || !q.startsWith("magnet:")) {
      return reply("❌ *Send a valid magnet link*\nExample: `.torrent <magnet>`");
    }

    let progressMsg = await reply("🧲 *Initializing torrent... Please wait*");

    try {
      const WebTorrent = (await import("webtorrent")).default;
      const client = new WebTorrent();

      // ⭐ NON-BLOCKING DOWNLOAD (important!)
      setImmediate(() => {
        client.add(q, async (torrent) => {
          console.log("Torrent started:", torrent.name);

          const updateProgress = async () => {
            const percent = Math.round(torrent.progress * 100);
            const speed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
            const eta = Math.round(torrent.timeRemaining / 1000);

            await robin.sendMessage(
              from,
              {
                text:
                  `🧲 *Torrent Downloading...*\n\n` +
                  `📂 *File:* ${torrent.name}\n` +
                  `📊 *Progress:* ${percent}%\n` +
                  `⚡ *Speed:* ${speed} MB/s\n` +
                  `⏳ *ETA:* ${eta} sec`,
                edit: progressMsg.key,
              },
              { quoted: mek }
            );
          };

          // 🔄 Update progress every 3 seconds (not heavy!)
          const progressInterval = setInterval(updateProgress, 10000);

          torrent.on("done", async () => {
            clearInterval(progressInterval);

            const mainFile = torrent.files.sort((a, b) => b.length - a.length)[0];
            const filePath = path.join(DOWNLOAD_DIR, mainFile.name);

            // write file → stream to disk
            await new Promise((resolve, reject) => {
              mainFile.createReadStream()
                .pipe(fs.createWriteStream(filePath))
                .on("finish", resolve)
                .on("error", reject);
            });

            // 📌 SIZE LIMIT CHECK (2GB)
            const fileSize = fs.statSync(filePath).size;
            if (fileSize > 2 * 1024 * 1024 * 1024) {
              fs.unlinkSync(filePath);
              return reply("❌ *File too large.* Max 2GB supported.");
            }

            const detectedMime = mime.lookup(mainFile.name) || "application/octet-stream";

            await robin.sendMessage(
              from,
              {
                text: `🎉 *Download Completed!*\n📂 *File:* ${mainFile.name}`,
                edit: progressMsg.key,
              },
              { quoted: mek }
            );

            // 📤 SEND FILE
            await robin.sendMessage(
              from,
              {
                document: fs.readFileSync(filePath),
                fileName: path.basename(filePath),
                mimetype: detectedMime,
              },
              { quoted: mek }
            );

            fs.unlinkSync(filePath); // 🧹 clean temp
            client.destroy(); // 🔚 stop client
          });
        });
      });

    } catch (err) {
      console.error(err);
      reply("❌ *Error:* " + err.message);
    }
  }
);
