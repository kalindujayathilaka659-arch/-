const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables from config.env if it exists
const configPath = path.resolve(__dirname, "config.env");
if (fs.existsSync(configPath)) {
  dotenv.config({ path: configPath });
}

function convertToBool(text, fault = "true") {
  return text?.toLowerCase() === fault.toLowerCase();
}

module.exports = {
  SESSION_ID: process.env.SESSION_ID || "LFVSkQRJ#18d4XBrw0GqXHNPhEeJ0v0ji__S3QXq9VK4XcdxVZ2w",

  MONGODB:
    process.env.MONGODB ||
    "mongodb://mongo:YXZOWLvjYjbSwsdozKhThFyDvYHxQjIZ@shuttle.proxy.rlwy.net:28486",

  OWNER_NUM: (process.env.OWNER_NUM || "94769296124").split(","),
  AUTO_STATUS_READ: process.env.AUTO_STATUS_READ || "true"),
  STATUS_REACT: process.env.STATUS_REACT || "true"),
  STATUS_REACT_IMOJI: process.env.STATUS_REACT_IMOJI || "👻"),
  MODE: process.env.MODE || "group",
  PREFIX: process.env.PREFIX || ".",

  ALIVE_IMG: process.env.ALIVE_IMG || "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true"
};
