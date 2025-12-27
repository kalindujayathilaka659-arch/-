const fs = require("fs");
const path = require("path");

const AUTH_FILE = path.join(__dirname, "../auth.json");
const SECRET_KEY = "GHOST-Q8ZJH2PLW7K"; // <-- change this

function loadAuth() {
  return JSON.parse(fs.readFileSync(AUTH_FILE));
}

function saveAuth(data) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
}

const { cmd } = require("../command");

cmd({
  pattern: "auth",
  react: "🔑",
  desc: "Authenticate to access owner commands",
  category: "auth",
  filename: __filename,
},
async (robin, mek, m, { reply, args, sender }) => {
  if (!args[0]) return reply("📌 *Usage:* `.auth <secret_key>`");

  const key = args[0];
  if (key !== SECRET_KEY) return reply("❌ *Invalid secret key!*");

  const data = loadAuth();
  const user = sender.split("@")[0];

  if (!data.authorized.includes(user)) {
    data.authorized.push(user);
    saveAuth(data);
  }

  reply(`🔓 *Authorization successful!*\nYou now have access to owner commands.`);
});
