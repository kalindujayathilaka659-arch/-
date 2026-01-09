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
}, async (bot, mek, m, { args, reply, sender }) => {
  const isUserOwner = require("../lib/auth").isOwner;
  if (!isUserOwner(sender)) return reply("🚫 *You are not authorized!*");

  if (!fs.existsSync(configPath)) return reply("❌ Config file not found!");

  // Load config safely using require
  let config;
  try {
    delete require.cache[require.resolve(configPath)]; // reload fresh
    config = require(configPath);
  } catch (err) {
    console.error("❌ Error loading config:", err);
    return reply("❌ Unable to read current settings.");
  }

  // Keys to hide when listing
  const hiddenKeys = ["SESSION_ID", "MONGODB", "ALIVE_IMG"];

  // If no args provided, list all settings except hidden
  if (!args[0]) {
    let settingsList = "📌 *Current Bot Settings:*\n\n";
    for (const [key, value] of Object.entries(config)) {
      if (hiddenKeys.includes(key)) continue; // skip sensitive keys
      settingsList += `• ${key}: ${value}\n`;
    }
    return reply(settingsList);
  }

  // If key + value provided, update setting
  if (!args[1]) return reply(
    "📌 *Usage:* `.set <key> <value>`\n" +
    "Example: `.set AUTO_READ_STATUS false`\n" +
    "Keys: " + Object.keys(config).filter(k => !hiddenKeys.includes(k)).join(", ")
  );

  const key = args[0];
  const value = args.slice(1).join(" ");

  if (!Object.keys(config).includes(key)) return reply("❌ Key not found in config.js!");
  if (hiddenKeys.includes(key)) return reply("🚫 *You cannot update this key via this command.*");

  // Handle boolean & numeric values
  let formattedValue = value;
  if (["true", "false"].includes(value.toLowerCase())) {
    formattedValue = value.toLowerCase();
  } else if (!isNaN(value)) {
    formattedValue = value;
  } else {
    formattedValue = `"${value}"`;
  }

  // Read file content and update the key
  let fileContent = fs.readFileSync(configPath, "utf-8");
  const regex = new RegExp(`(${key}\\s*:\\s*)([^,\\n]+)`, "i");
  fileContent = fileContent.replace(regex, `$1${formattedValue}`);
  fs.writeFileSync(configPath, fileContent, "utf-8");

  reply(`✅ Setting updated: ${key} = ${value}\n⚠️ Restart bot for changes to take effect.`);
});
