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
  SESSION_ID: process.env.SESSION_ID || "HFlBRC6D#M6u_d0UY1Z42m9FU2cWup_iw2M7tjFi1i7mFR1QBLUw",

  MONGODB:
    process.env.MONGODB ||
    "mongodb://mongo:YXZOWLvjYjbSwsdozKhThFyDvYHxQjIZ@shuttle.proxy.rlwy.net:28486",

  OWNER_NUM: (process.env.OWNER_NUM || "94701981053").split(","),

  IS_BOT_PUBLIC: convertToBool(process.env.IS_BOT_PUBLIC || "true"),
  AUTO_STATUS_READ: convertToBool(process.env.AUTO_STATUS_READ || "true"),
  STATUS_REACT: convertToBool(process.env.STATUS_REACT || "true"),

  GEMINI_API_KEY:
    process.env.GEMINI_API_KEY || "AIzaSyBmh_YTo1S4jHJirGjOQ8RYNkX1fy6EckI",

  DEEPAI_API_KEY:
    process.env.DEEPAI_API_KEY || "7e0056ab-19dc-46f4-9c49-06456689a60d",

  STABLE_HORDE_API_KEY:
    process.env.STABLE_HORDE_API_KEY || "y-Zqmcw0jvt9mKE3Y1CN3A",
  ALIVE_IMG: process.env.ALIVE_IMG || "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true"
};
