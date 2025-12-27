const { cmd } = require("../command");
const axios = require("axios");
const FileType = require("file-type");
const { isOwner } = require("../lib/auth");

cmd(
  {
    pattern: "download",
    ownerOnly: true,
    react: "🌐",
    desc: "Download and send a file from direct link (up to 2GB)",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    try {
      if (!q || !q.startsWith("http")) {
        return reply("❌ Please provide a valid direct download link.");
      }

      await reply("📥 Downloading file (up to 2GB)... This may take a while.");

      const response = await axios({
        method: "GET",
        url: q,
        responseType: "stream",
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const chunks = [];
      let totalLength = 0;

      await new Promise((resolve, reject) => {
        response.data.on("data", (chunk) => {
          chunks.push(chunk);
          totalLength += chunk.length;
        });
        response.data.on("end", resolve);
        response.data.on("error", reject);
      });

      if (totalLength > 2 * 1024 * 1024 * 1024) {
        return reply("❌ File too large. Max supported size is 2GB.");
      }

      const fileBuffer = Buffer.concat(chunks);
      const fileType = await FileType.fromBuffer(fileBuffer);
      const fileName =
        q.split("/").pop().split("?")[0] || "file_from_direct_link";
      const mimeType = fileType?.mime || "application/octet-stream";

      await robin.sendMessage(
        from,
        {
          document: fileBuffer,
          fileName: fileName,
          mimetype: mimeType,
          caption: `📎 *Downloaded from:* ${q}`,
        },
        { quoted: mek }
      );

      await reply("✅ File sent successfully.");
    } catch (err) {
      console.error(err);
      reply("❌ Failed to download or send the file:\n" + (err.message || err));
    }
  }
);
