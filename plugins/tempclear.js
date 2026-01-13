const { cmd } = require("../command");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { isOwner } = require("../lib/auth");

/* ---------- helpers ---------- */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

async function getDirSize(dir) {
  let total = 0;
  try {
    const items = await fs.readdir(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      const stat = await fs.lstat(full);
      if (stat.isDirectory()) total += await getDirSize(full);
      else total += stat.size;
    }
  } catch {
    // ignore
  }
  return total;
}

// Linux/macOS disk free via `df -kP <path>`
function getDiskFreeBytes(targetPath) {
  return new Promise((resolve, reject) => {
    execFile("df", ["-kP", targetPath], (err, stdout) => {
      if (err) return reject(err);
      const lines = String(stdout || "").trim().split("\n");
      if (lines.length < 2) return reject(new Error("df output parse failed"));
      const cols = lines[1].replace(/\s+/g, " ").split(" ");
      // cols: Filesystem 1024-blocks Used Available Capacity Mounted on
      const availKB = parseInt(cols[3], 10);
      if (!Number.isFinite(availKB)) return reject(new Error("df available parse failed"));
      resolve(availKB * 1024);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

cmd(
  {
    pattern: "cleartemp",
    ownerOnly: true,
    react: "🧹",
    desc: "Clear ./temp folder to free disk space (+show freed RAM/disk stats)",
    category: "system",
    filename: __filename,
  },
  async (robin, mek, m, { from, reply }) => {
    try {
      const tempPath = path.resolve("temp");

      // Create temp if missing
      const exists = await fs.pathExists(tempPath);
      if (!exists) {
        await fs.ensureDir(tempPath);
        return reply("📁 *Temp directory did not exist — created new empty folder.*");
      }

      // ----- BEFORE STATS -----
      const tempSizeBefore = await getDirSize(tempPath);

      const procMemBefore = process.memoryUsage(); // rss/heapUsed/etc
      const sysFreeBefore = os.freemem();
      const sysTotal = os.totalmem();

      let diskFreeBefore = null;
      try {
        diskFreeBefore = await getDiskFreeBytes(tempPath);
      } catch {
        // ignore if df not available
      }

      // ----- CLEAR TEMP -----
      await fs.emptyDir(tempPath);

      // ----- TRY FREE RAM (GC) -----
      // Needs Node started with --expose-gc (ex: NODE_OPTIONS=--expose-gc)
      let gcRan = false;
      if (typeof global.gc === "function") {
        global.gc();
        await sleep(50);
        global.gc();
        gcRan = true;
      }

      // ----- AFTER STATS -----
      const tempSizeAfter = await getDirSize(tempPath);

      const procMemAfter = process.memoryUsage();
      const sysFreeAfter = os.freemem();

      let diskFreeAfter = null;
      try {
        diskFreeAfter = await getDiskFreeBytes(tempPath);
      } catch {
        // ignore
      }

      const freedTemp = Math.max(0, tempSizeBefore - tempSizeAfter);

      const rssFreed = Math.max(0, procMemBefore.rss - procMemAfter.rss);
      const heapFreed = Math.max(0, procMemBefore.heapUsed - procMemAfter.heapUsed);

      const sysFreed = Math.max(0, sysFreeAfter - sysFreeBefore);

      const diskGained =
        diskFreeBefore !== null && diskFreeAfter !== null
          ? Math.max(0, diskFreeAfter - diskFreeBefore)
          : null;

      // ----- MESSAGE -----
      const lines = [];
      lines.push("🧹 *Temp folder cleaned successfully!*");
      lines.push("");
      lines.push(`🗑️ *Temp freed:* ${formatBytes(freedTemp)}`);
      if (diskGained !== null) lines.push(`💽 *Disk free increased:* ${formatBytes(diskGained)}`);
      if (diskFreeAfter !== null) lines.push(`💾 *Disk free now:* ${formatBytes(diskFreeAfter)}`);

      lines.push("");
      lines.push(`🧠 *Process RAM (RSS) freed:* ${formatBytes(rssFreed)}`);
      lines.push(`🧩 *Heap freed:* ${formatBytes(heapFreed)}`);
      lines.push(`🌐 *System free RAM change:* ${formatBytes(sysFreed)}`);
      lines.push(`📊 *System RAM now:* ${formatBytes(sysFreeAfter)} / ${formatBytes(sysTotal)} free`);

      if (!gcRan) {
        lines.push("");
        lines.push("ℹ️ *GC not forced.* To force RAM cleanup, start node with:");
        lines.push("`NODE_OPTIONS=--expose-gc`");
      }

      return reply(lines.join("\n"));
    } catch (err) {
      console.error("❌ cleartemp error:", err);
      return reply(`❌ Failed to clear temp: ${err.message}`);
    }
  }
);
