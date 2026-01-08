const fs = require("fs")
const path = require("path")
const config = require("../config")
const { cmd } = require("../command")

const AUTH_FILE = path.join(__dirname, "../auth.json")

// Define multiple keys
const SECRET_KEYS = [
  "GHOST-LM7R2JZ8TQC",
  "GHOST-R2MKJ7B9FQA",
  "GHOST-8XJTB4L9ZQM",
  "GHOST-J3ZQ8UP5KTF",
  "GHOST-V9HLP3W6RJB",
  "GHOST-KUF29QJ7ZHL",
  "GHOST-2QW9MHP3GJD",
  "GHOST-Q9XH8C2JPLB"
]

// Load auth file safely
function loadAuth() {
  if (!fs.existsSync(AUTH_FILE)) {
    fs.writeFileSync(
      AUTH_FILE,
      JSON.stringify({ authorized: [], usedKeys: [] }, null, 2)
    )
  }
  const rawData = JSON.parse(fs.readFileSync(AUTH_FILE))
  rawData.authorized = rawData.authorized || []
  rawData.usedKeys = rawData.usedKeys || []
  return rawData
}

// Save auth file
function saveAuth(data) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2))
}

cmd(
  {
    pattern: "auth",
    react: "🔑",
    desc: "Authenticate to access owner commands",
    category: "auth",
    filename: __filename,
  },
  async (robin, mek, m, { reply, args, sender }) => {

    // 🔒 AUTH SYSTEM SWITCH
    if (config.AUTH_SYSTEM === false) {
      return reply("⚠️ *Auth system is disabled by owner*")
    }

    if (!args[0]) return reply("📌 *Usage:* `.auth <secret_key>`")

    const key = args[0]
    const user = sender.split("@")[0]

    const data = loadAuth()

    // Check if key is valid
    if (!SECRET_KEYS.includes(key)) {
      return reply("❌ *Invalid secret key!*")
    }

    // Check if key already used
    const keyUsed = data.usedKeys.find(k => k.key === key)
    if (keyUsed && keyUsed.user !== user) {
      return reply("❌ *This key has already been used by another user!*")
    }

    // Authorize user
    if (!data.authorized.includes(user)) {
      data.authorized.push(user)
    }

    // Mark key as used
    if (!keyUsed) {
      data.usedKeys.push({ key, user })
    }

    saveAuth(data)

    reply("🔓 *Authorization successful!*\nYou now have access to owner commands.")
  }
)
