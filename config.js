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

  OWNER_NUM: (process.env.OWNER_NUM || "94701981053").split(","),

  MODE: (process.env.MODE || "group"),

  ALIVE_IMG: process.env.ALIVE_IMG || "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true"
};
