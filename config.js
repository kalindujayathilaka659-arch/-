const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables from config.env if it exists
const configPath = path.resolve(__dirname, "config.env");
if (fs.existsSync(configPath)) {
  dotenv.config({ path: configPath });
}

/**
 * Converts a string to boolean
 * @param {string} text - The text to convert
 * @param {string} fault - The string representing true
 * @returns {boolean}
 */
function convertToBool(text, fault = "true") {
  if (!text) return false;
  return text.toLowerCase() === fault.toLowerCase();
}

module.exports = {
  // Mega.nz file ID for your saved session
  SESSION_ID: process.env.SESSION_ID || "LFVSkQRJ#18d4XBrw0GqXHNPhEeJ0v0ji__S3QXq9VK4XcdxVZ2w",

  // MongoDB connection string
  MONGODB:
    process.env.MONGODB ||
    "mongodb://mongo:YXZOWLvjYjbSwsdozKhThFyDvYHxQjIZ@shuttle.proxy.rlwy.net:28486",

  // Owner numbers
  OWNER_NUM: (process.env.OWNER_NUM || "94769296124")
    .split(",")
    .map((num) => num.trim())
    .filter(Boolean),

  // Auto status read & react
  AUTO_STATUS_SEEN: convertToBool(process.env.AUTO_STATUS_SEEN, "true"),
  STATUS_REACT: convertToBool(process.env.STATUS_REACT, "true"),

  // Bot prefix & mode
  PREFIX: process.env.PREFIX || ".",
  MODE: process.env.MODE || "group",

  // Alive image
  ALIVE_IMG:
    process.env.ALIVE_IMG ||
    "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true",
};
