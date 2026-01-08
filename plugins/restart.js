const fs = require("fs");
const path = require("path");
const { cmd } = require("../command");
const configPath = path.join(__dirname, "../config.js");
const { isOwner } = require("../lib/auth");

cmd({
  pattern: "set",
  react: "⚙️",
  desc: "Edit bot settings dynamically",
  category: "owner",
  ownerOnly: true,
  filename: __filename,
}, async (robin, mek, m, { args, reply, sender }) => {
  const isOwner = require("../lib/auth").isOwner;
  if (!isOwner(sender)) return reply("🚫 *You are not authorized!*");

  if (!args[0] || !args[1]) return reply(
    "📌 *Usage:* `.set <key> <value>`\n" +
    "Example: `.set AUTO_READ_STATUS false`\n" +
    "Keys: AUTO_READ_STATUS, AUTO_LIKE_STATUS, AUTO_REPLY_STATUS, STATUS_REACT_EMOJI, STATUS_REPLY_TEXT, MODE, PREFIX"
  );

  const key = args[0];
  const value = args.slice(1).join(" ");

  if (!fs.existsSync(configPath)) return reply("❌ Config file not found!");

  let fileContent = fs.readFileSync(configPath, "utf-8");

  // Handle boolean values
  let formattedValue = value;
  if (["true", "false"].includes(value.toLowerCase())) {
    formattedValue = value.toLowerCase();
  } else if (!isNaN(value)) {
    // number value
    formattedValue = value;
  } else {
    // string value
    formattedValue = `"${value}"`;
  }

  // Regex to find the key in config.js
  const regex = new RegExp(`(${key}\\s*:\\s*)([^,\\n]+)`, "i");
  if (!regex.test(fileContent)) return reply("❌ Key not found in config.js!");

  fileContent = fileContent.replace(regex, `$1${formattedValue}`);
  fs.writeFileSync(configPath, fileContent, "utf-8");

  reply(`✅ Setting updated: ${key} = ${value}\n⚠️ Restart bot for changes to take effect.`);
});
