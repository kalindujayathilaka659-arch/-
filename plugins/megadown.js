const { cmd } = require("../command");
const { File } = require("megajs");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isOwner } = require("../lib/auth");

/* ---------- HELPERS ---------- */
function formatSize(bytes) {
  if (!bytes) return "0 MB";
  if (bytes >= 1024 ** 3)
    return (bytes / 1024 ** 3).toFixed(2) + " GB";
  return (bytes / 1024 ** 2).toFixed(2) + " MB";
}

cmd(
  {
    pattern: "mega",
    ownerOnly: true,
    react: "📦",
    desc: "MEGA ultra-fast download (2GB, live % edit)",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    let tmpPath;

    try {
      if (!q || !q.includes("#"))
        return reply("❌ Invalid MEGA link (missing # key).");

      /* ---------- LOAD FILE ---------- */
      const file = File.fromURL(q);
      await file.loadAttributes();

      const total = file.size;
      const name = file.name || "mega_file";
      const totalText = formatSize(total);

      // WhatsApp document hard limit
      const WA_LIMIT = 2 * 1024 * 1024 * 1024;
      if (total > WA_LIMIT) {
        return reply(
          `❌ File too large for WhatsApp\n📦 ${name}\n📁 ${totalText}\nMax: 2GB`
        );
      }

      tmpPath = path.join(os.tmpdir(), `${Date.now()}_${name}`);

      /* ---------- INITIAL MESSAGE ---------- */
      const msg = await robin.sendMessage(from, {
        text:
          `📦 *${name}*\n` +
          `📁 Size: ${totalText}\n` +
          `📥 Downloading: 0% (0 / ${totalText})`,
      });

      const editKey = msg.key;

      /* ---------- FAST DOWNLOAD ---------- */
      const download = file.download({
        highWaterMark: 1024 * 1024 * 8, // 8MB
      });

      const write = fs.createWriteStream(tmpPath, {
        highWaterMark: 1024 * 1024 * 8,
      });

      let downloaded = 0;
      let lastPercent = -1;
      let editing = false;

      download.on("data", (chunk) => {
        downloaded += chunk.length;

        const percent = Math.floor((downloaded / total) * 100);
        if (percent === lastPercent || editing) return;

        lastPercent = percent;
        editing = true;

        robin.sendMessage(
          from,
          {
            text:
              percent < 100
                ? `📦 *${name}*\n📁 Size: ${totalText}\n⏬ Downloading: ${percent}% (${formatSize(downloaded)} / ${totalText})`
                : `📦 *${name}*\n📁 Size: ${totalText}\n✅ Download Complete: 100% (${totalText})`,
            edit: editKey,
          }
        ).finally(() => (editing = false));
      });

      await new Promise((res, rej) => {
        download.pipe(write);
        write.once("finish", res);
        download.once("error", rej);
        write.once("error", rej);
      });

      /* ---------- SEND FILE (BAILEYS SAFE) ---------- */
      await robin.sendMessage(
        from,
        {
          document: { url: tmpPath }, // 🔥 FIXED
          fileName: name,
        },
        { quoted: mek }
      );

      fs.unlink(tmpPath, () => {});

    } catch (err) {
      console.error("MEGA error:", err);
      if (tmpPath && fs.existsSync(tmpPath)) fs.unlink(tmpPath, () => {});
      reply("❌ Download or upload failed.");
    }
  }
);
