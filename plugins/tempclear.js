const { cmd } = require("../command");
const fs = require("fs-extra");
const path = require("path");
const { isOwner } = require("../lib/auth");

cmd(
  {
    pattern: "cleartemp",
    ownerOnly: true,
    react: "🧹",
    desc: "Clear ./temp folder to free disk space",
    category: "system",
    filename: __filename,
  },
  async (robin, mek, m, { from, reply }) => {
    try {
      const tempPath = path.resolve("temp");

      // Check if temp folder exists
      const exists = await fs.pathExists(tempPath);
      if (!exists) {
        await fs.ensureDir(tempPath);
        return reply("📁 *Temp directory did not exist — created new empty folder.*");
      }

      // Remove everything inside temp
      await fs.emptyDir(tempPath);

      return reply("🧹 *Temp folder cleaned successfully!*");
    } catch (err) {
      console.error("❌ cleartemp error:", err);
      return reply(`❌ Failed to clear temp: ${err.message}`);
    }
  }
);
