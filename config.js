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
  SESSION_ID: process.env.SESSION_ID || "KEkljS6b#Bksgu4HFB7CdwK_sYE_mDrXplefWV-qQOc6VOMHIjtI",

  MONGODB: process.env.MONGODB || "mongodb://mongo:XenHeRDUjMLxafGOvMuPVNoSEwqdNCPo@tramway.proxy.rlwy.net:39180",

  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "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",

  OWNER_NUM: (process.env.OWNER_NUM || "94701981053").split(","),

AI_MODEL: "gpt-5.2",
AUTH_SYSTEM: true,
AUTO_READ_STATUS: true,   // true = read status
AUTO_LIKE_STATUS: true,   // true = like (heart/react) status
AUTO_REPLY_STATUS: true,   
STATUS_REACT_EMOJI: "👻",  // emoji for status reaction
STATUS_REPLY_TEXT: "🔥 Nice status!",
MODE: "groups", // Options: "public" | "private" | "inbox" | "groups"
PREFIX: ".",

ALIVE_IMG: process.env.ALIVE_IMG || "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true"
};
