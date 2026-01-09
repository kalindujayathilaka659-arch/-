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

  // Load config safely
  let config;
  try {
    delete require.cache[require.resolve(configPath)]; // reload fresh
    config = require(configPath);
  } catch (err) {
    console.error("❌ Error loading config:", err);
    return reply("❌ Unable to read current settings.");
  }

  // Hidden keys that cannot be listed or updated
  const hiddenKeys = ["SESSION_ID", "MONGODB", "ALIVE_IMG"];

  // If no args, list current settings excluding hidden keys
  if (!args[0]) {
    let settingsList = "📌 *Current Bot Settings:*\n\n";
    for (const [key, value] of Object.entries(config)) {
      if (hiddenKeys.includes(key)) continue;
      settingsList += `• ${key}: ${value}\n`;
    }
    return reply(settingsList);
  }

  // If only one arg provided
  if (!args[1]) return reply(
    "📌 *Usage:* `.set <key> <value>`\n" +
    "Example: `.set AUTO_READ_STATUS false`\n" +
    "Keys: " + Object.keys(config).filter(k => !hiddenKeys.includes(k)).join(", ")
  );

  let keyInput = args[0];
  let valueInput = args.slice(1).join(" ");

  // Match key case-insensitively
  const configKeys = Object.keys(config);
  const matchedKey = configKeys.find(k => k.toLowerCase() === keyInput.toLowerCase());
  if (!matchedKey) return reply("❌ Key not found in config.js!");
  const key = matchedKey;

  // Prevent updating hidden keys
  if (hiddenKeys.includes(key)) return reply("🚫 *You cannot update this key via this command.*");

  // Format value safely
  let formattedValue;
  if (key === "OWNER_NUM") {
    // Always store OWNER_NUM as string
    formattedValue = `"${valueInput}"`;
  } else if (["true", "false"].includes(valueInput.toLowerCase())) {
    formattedValue = valueInput.toLowerCase(); // boolean
  } else if (!isNaN(valueInput)) {
    formattedValue = valueInput; // number
  } else if (!/^["'].*["']$/.test(valueInput)) {
    formattedValue = `"${valueInput}"`; // string
  } else {
    formattedValue = valueInput; // already quoted string
  }

  // Update config.js safely
  try {
    let fileContent = fs.readFileSync(configPath, "utf-8");
    const regex = new RegExp(`(${key}\\s*:\\s*)([^,\\n]+)`, "i");
    fileContent = fileContent.replace(regex, `$1${formattedValue}`);
    fs.writeFileSync(configPath, fileContent, "utf-8");

    return reply(`✅ Setting updated: ${key} = ${valueInput}\n⚠️ Restart bot for changes to take effect.`);
  } catch (err) {
    console.error("❌ Error updating config.js:", err);
    return reply("❌ Failed to update setting.");
  }
});
