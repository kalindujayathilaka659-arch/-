const { cmd } = require("../command");
const { isOwner } = require("../lib/auth");

cmd({
  pattern: "restart",
  react: "♻️",
  desc: "Restart the bot",
  category: "owner",
  filename: __filename,
},
async (robin, mek, m, { reply, sender }) => {
  if (!isOwner(sender)) return reply("🚫 *You are not authorized!*");

  reply("♻️ *Restarting bot...*");
  setTimeout(() => process.exit(0), 500);
});
