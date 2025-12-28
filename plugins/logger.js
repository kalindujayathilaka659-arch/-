// plugins/logger.js
const { cmd } = require("../command"); 
const fs = require("fs");
const path = require("path");
const os = require("os");
const { isOwner } = require("../lib/auth");

// TEMP DIRECTORY FOR LOGS
const tempDir = path.join(os.tmpdir(), "ghost-md-logs");
const logFile = path.join(tempDir, "logs.txt");

// ensure temp folder exists
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// save original console.log but DO NOT USE IT
const originalLog = console.log;

// override console.log to write ONLY to logs.txt
console.log = function (...msg) {
    const time = new Date().toISOString();
    const text = msg.join(" ");
    try {
        fs.appendFileSync(logFile, `[${time}] ${text}\n`);
    } catch (_) {}
};

// get logs.txt for sending
function getLogFile() {
    return fs.existsSync(logFile) ? logFile : null;
}

// delete logs.txt silently
function deleteLogFile() {
    if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
    }
}

// ==========================
// .logsend command (owner)
// ==========================
cmd({
    pattern: "logsend",
    ownerOnly: true,
    react: "⚙️",
    desc: "Send Ghost MD logs (auto delete after sending)",
    category: "system",
    filename: __filename
}, async (robin, mek, m, { from, reply }) => {

    const file = getLogFile();
    if (!file) return reply("⚠ No logs found!");

    try {
        await robin.sendMessage(from, {
            document: { url: file },
            mimetype: "text/plain",
            fileName: "ghost-logs.txt"
        }, { quoted: mek });

        deleteLogFile();
        reply("📨 Logs sent & 🗑️ deleted!");
    } catch (err) {
        reply("❌ Error: " + err.message);
    }
});

module.exports = { getLogFile, deleteLogFile };
