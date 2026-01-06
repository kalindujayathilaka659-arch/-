const fs = require("fs")
const path = require("path")
const config = require("../config")

const AUTH_FILE = path.join(__dirname, "../auth.json")

function loadAuth() {
  if (!fs.existsSync(AUTH_FILE)) {
    return { authorized: [] }
  }

  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE))
    data.authorized = data.authorized || []
    return data
  } catch {
    return { authorized: [] }
  }
}

exports.isOwner = (jid) => {
  const user = jid.split("@")[0]

  // 🔓 AUTH SYSTEM OFF → ALWAYS TRUE
  if (config.AUTH_SYSTEM === false) return true

  // 👑 REAL OWNER ALWAYS TRUE
  if (config.OWNER_NUM?.includes(user)) return true

  const data = loadAuth()
  return data.authorized.includes(user)
}
