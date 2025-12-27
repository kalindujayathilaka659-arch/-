const fs = require("fs");
const path = require("path");

const AUTH_FILE = path.join(__dirname, "../auth.json");

exports.isOwner = (jid) => {
  const data = JSON.parse(fs.readFileSync(AUTH_FILE));
  const user = jid.split("@")[0];
  return data.authorized.includes(user);
};
