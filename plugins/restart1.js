const { cmd } = require("../command");
const { isOwner } = require("../lib/auth");

cmd({
  pattern: "restart",
  react: "♻️",
  ownerOnly: true,
  desc: "Restart the bot",
  category: "owner",
  filename: __filename,
}, async (robin, mek, m, { reply, sender }) => {
  if (!isOwner(sender)) return reply("🚫 *You are not authorized!*");

  reply("♻️ *Restarting bot...*");

  // Delay slightly so the reply can be sent before restarting
  setTimeout(() => {
    process.exit(0); // PM2 or other process manager will restart the bot automatically
  }, 500);
});
