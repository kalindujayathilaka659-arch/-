// plugins/logger.js
const fs = require("fs");
const path = require("path");
const os = require("os");

// TEMP DIRECTORY FOR LOGS
const tempDir = path.join(os.tmpdir(), "ghost-logs");
const logFile = path.join(tempDir, "logs.txt");

// ensure temp folder exists
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// keep original console.log
const originalLog = console.log;

// override console.log
console.log = function (...msg) {
    const time = new Date().toISOString();
    const text = msg.join(" ");

    // print normally
    originalLog(`[${time}]`, text);

    // save to temp logs.txt
    try {
        fs.appendFileSync(logFile, `[${time}] ${text}\n`);
    } catch (err) {
        originalLog("Logger write error:", err.message);
    }
};

// function to get log file path for sending
function getLogFile() {
    return fs.existsSync(logFile) ? logFile : null;
}

// function to delete log file after sending
function deleteLogFile() {
    if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
        console.log("🗑️ log file deleted after sending");
    }
}

console.log("📌 Logger started! Output saved to TEMP folder");

// export functions so bot can use them
module.exports = { getLogFile, deleteLogFile };
