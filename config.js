const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables from config.env if it exists
const configPath = path.resolve(__dirname, "config.env");
if (fs.existsSync(configPath)) dotenv.config({ path: configPath });

/**
 * Converts a string or boolean to boolean
 * @param {string|boolean} text
 * @param {string} fault - The string representing true
 * @returns {boolean}
 */
function convertToBool(text, fault = "true") {
  if (typeof text === "boolean") return text;
  if (!text) return false;
  return text.toString().trim().toLowerCase() === fault.toLowerCase();
}

module.exports = {
  // Mega.nz file ID for saved session
  SESSION_ID: process.env.SESSION_ID || "uMA1HBoK#02zoTb4uQ1hvjx4gYfpv6ngu7ZnpUqtOiTN9Yvvzelw",

  // MongoDB connection string
  MONGODB: process.env.MONGODB || "mongodb://mongo:YXZOWLvjYjbSwsdozKhThFyDvYHxQjIZ@shuttle.proxy.rlwy.net:28486",

  // Owner numbers (comma-separated in env)
  OWNER_NUM: (process.env.OWNER_NUM || "94769296124")
    .split(",")
    .map((num) => num.trim())
    .filter(Boolean),

  // Bot mode: public/private/groups/inbox
  MODE: process.env.MODE || "groups",

  // Command prefix
  PREFIX: process.env.PREFIX || ".",

  // Alive message and image
  ALIVE_MSG:
    process.env.ALIVE_MSG ||
    "👻 Hello! I am alive now!\n\n> Developer note: Ghost MD is designed to be simple, smooth, and convenient — no unnecessary complications, just pure functionality.\n> 💀 CREATED by Nadeela Chamath 💀",
  ALIVE_IMG:
    process.env.ALIVE_IMG ||
    "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true",

  // Auto status watch & react
  AUTO_STATUS_WATCH: convertToBool(process.env.AUTO_STATUS_WATCH, "true"),
  AUTO_STATUS_REACT: process.env.AUTO_STATUS_REACT || "👻",
  AUTO_READ_STATUS: convertToBool(process.env.AUTO_READ_STATUS, "true"),

  // Auto read & react for normal messages
  AUTO_READ: convertToBool(process.env.AUTO_READ, "true"),
  AUTO_REACT: convertToBool(process.env.AUTO_REACT, "true"),
};
