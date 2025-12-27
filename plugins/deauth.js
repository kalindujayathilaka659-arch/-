const { cmd } = require("../command");
const fs = require("fs-extra");
const path = require("path");
const { isOwner } = require("../lib/auth");

cmd(
  {
    pattern: "auth",
    ownerOnly: true,
    react: "🔒",
    desc: "Clear session folder (auth_info_baileys)",
    category: "system",
    filename: __filename,
  },
  async (robin, mek, m, { from, reply, isOwner }) => {
    try {
      const sessionPath = path.resolve("auth_info_baileys");

      // Ensure the folder exists
      const exists = await fs.pathExists(sessionPath);
      if (!exists) {
        await fs.ensureDir(sessionPath);
        return reply("📂 *Session folder not found — created a new one.*");
      }

      // Empty the session directory
      await fs.emptyDir(sessionPath);

      return reply("🔐 *Session folder cleared successfully!*");
    } catch (err) {
      console.error("❌ clearsession error:", err);
      return reply(`❌ Failed to clear session folder: ${err.message}`);
    }
  }
);
