const { cmd } = require("../command");
const fs = require("fs");
const path = require("path");
const os = require("os");
const axios = require("axios");
const { spawn, execFile } = require("child_process");

const COOKIE_FILE = path.join(__dirname, "../cookies/eporner.txt");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ================= HELPERS ================= */
function safeFileName(name, max = 80) {
  return (name || "eporner")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function isValidEpornerUrl(url) {
  return typeof url === "string" && url.includes("eporner.com");
}

function runYtDlp(args, label = "yt-dlp") {
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      args,
      { maxBuffer: 1024 * 1024 * 50 }, // 50MB buffer
      (err, stdout, stderr) => {
        if (err) {
          console.error(`\n❌ ${label} FAILED`);
          console.error("Exit:", err.code);
          console.error("STDERR:\n", stderr || "(empty)");
          console.error("STDOUT:\n", stdout || "(empty)");
          err._stdout = stdout;
          err._stderr = stderr;
          return reject(err);
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

function detectReason(err) {
  const t = ((err?._stderr || "") + "\n" + (err?._stdout || "")).toLowerCase();

  if (t.includes("cookie")) return "Cookies expired / invalid";
  if (t.includes("403")) return "403 Forbidden (blocked)";
  if (t.includes("429")) return "429 Rate limited";
  if (t.includes("cloudflare") || t.includes("captcha"))
    return "Cloudflare / Captcha block";
  if (t.includes("not available") || t.includes("removed"))
    return "Video removed / unavailable";
  if (t.includes("private") || t.includes("login"))
    return "Login required";
  if (t.includes("format") && t.includes("available"))
    return "Requested quality not available";
  return "Unknown";
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "eporner",
    ownerOnly: true,
    react: "💋",
    desc: "Eporner downloader (360/480/720/1080, NO AV1, stable JSON)",
    category: "download",
    filename: __filename,
  },
  async (bot, msg, m, { from, q, reply }) => {
    let tempDir = null;
    let outputFile = null;

    try {
      if (!q) {
        return reply(
          "⚠️ *Usage:*\n" +
            "`.eporner <url>`\n" +
            "`.eporner 360 <url>`\n" +
            "`.eporner 480 <url>`\n" +
            "`.eporner 720 <url>`\n" +
            "`.eporner 1080 <url>`"
        );
      }

      // ================= QUALITY PARSER ================= //
      let quality = 720; // ✅ default
      let url = q.trim();

      const parts = q.trim().split(/\s+/);

      // support: 1080 / 1080p
      if (parts.length > 1) {
        const first = parts[0].toLowerCase().replace("p", "");
        if (["360", "480", "720", "1080"].includes(first)) {
          quality = parseInt(first, 10);
          url = parts.slice(1).join(" ");
        }
      }

      if (!isValidEpornerUrl(url)) {
        return reply("❌ Invalid URL. Please provide an eporner.com link.");
      }

      if (!fs.existsSync(COOKIE_FILE)) {
        return reply("❌ *Cookie file missing*\nAdd: `/cookies/eporner.txt`");
      }

      // ✅ unique temp dir
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eporner-"));
      outputFile = path.join(tempDir, `ep_${Date.now()}.mp4`);

      // ================= METADATA (STABLE JSON) ================= //
      const metaArgsCookie = [
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--cookies",
        COOKIE_FILE,
        "--user-agent",
        UA,
        "--referer",
        "https://www.eporner.com/",
        url,
      ];

      const metaArgsNoCookie = [
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        url,
      ];

      let info = null;

      try {
        const { stdout } = await runYtDlp(metaArgsCookie, "EPORNER META (cookie)");
        info = JSON.parse(stdout);
      } catch (e) {
        try {
          const { stdout } = await runYtDlp(metaArgsNoCookie, "EPORNER META (no-cookie)");
          info = JSON.parse(stdout);
        } catch (e2) {
          const reason = detectReason(e2);
          return reply(`❌ Metadata failed.\n🧠 Reason: *${reason}*`);
        }
      }

      const title = info.title || "Eporner Video";
      const uploader = info.uploader || "N/A";
      const views = info.view_count ? info.view_count.toLocaleString() : "N/A";
      const likes = info.like_count ? info.like_count.toLocaleString() : "N/A";
      const rating = info.average_rating || "N/A";
      const duration = info.duration_string || "N/A";
      const thumbnail = info.thumbnail;

      const caption =
        `🎬 *${title}*\n` +
        `👤 Uploader: ${uploader}\n` +
        `📊 Views: ${views}\n` +
        `👍 Likes: ${likes}\n` +
        `⭐ Rating: ${rating}\n` +
        `⏳ Duration: ${duration}\n` +
        `🎥 Quality: *≤${quality}p*\n` +
        `🎞 Codec: *H.264 (No AV1)*\n\n` +
        `📥 *Starting download…*`;

      // ================= SEND METADATA ================= //
      if (thumbnail) {
        try {
          const tRes = await axios.get(thumbnail, { responseType: "arraybuffer" });
          await bot.sendMessage(
            from,
            { image: Buffer.from(tRes.data), caption },
            { quoted: msg }
          );
        } catch {
          await bot.sendMessage(from, { text: caption }, { quoted: msg });
        }
      } else {
        await bot.sendMessage(from, { text: caption }, { quoted: msg });
      }

      // ================= DOWNLOAD (FORCE H.264 NOT AV1) ================= //
      const formatRule =
        `bv*[ext=mp4][vcodec^=avc1][height<=${quality}]+` +
        `ba[ext=m4a][acodec^=mp4a]/` +
        `b[ext=mp4][vcodec^=avc1][height<=${quality}]/` +
        `best[ext=mp4][height<=${quality}]`;

      const ytdlp = spawn("yt-dlp", [
        "--no-warnings",
        "--no-playlist",
        "--cookies",
        COOKIE_FILE,
        "--user-agent",
        UA,
        "--referer",
        "https://www.eporner.com/",
        "--retries",
        "infinite",
        "--fragment-retries",
        "infinite",
        "--socket-timeout",
        "20",
        "--concurrent-fragments",
        "16",
        "--http-chunk-size",
        "20M",
        "-f",
        formatRule,
        "--merge-output-format",
        "mp4",
        "-o",
        outputFile,
        url,
      ]);

      let progressMsg = null; // ✅ only create after real progress begins
      let lastUpdate = 0;

      ytdlp.stderr.on("data", async (data) => {
        const text = data.toString();
        const match = text.match(/(\d{1,3}\.\d)%/); // e.g 12.3%

        if (!match) return;

        const now = Date.now();

        // ✅ create progress message ONLY when progress starts
        if (!progressMsg) {
          progressMsg = await bot.sendMessage(
            from,
            { text: `📥 Downloading…\n⏳ Progress: *${match[1]}%*` },
            { quoted: msg }
          );
          lastUpdate = now;
          return;
        }

        // ✅ edit every ~2.5s
        if (now - lastUpdate > 2500) {
          lastUpdate = now;
          await bot.sendMessage(
            from,
            {
              text: `📥 Downloading…\n⏳ Progress: *${match[1]}%*`,
              edit: progressMsg.key,
            },
            { quoted: msg }
          );
        }
      });

      ytdlp.on("error", (err) => {
        console.error("yt-dlp spawn error:", err);
      });

      // ================= DONE ================= //
      ytdlp.on("close", async (code) => {
        try {
          if (code !== 0 || !fs.existsSync(outputFile)) {
            if (tempDir && fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }
            return reply("❌ *Download failed*");
          }

          const sizeMB = (fs.statSync(outputFile).size / 1048576).toFixed(2);

          await bot.sendMessage(
            from,
            {
              document: fs.readFileSync(outputFile),
              fileName: `${safeFileName(title)}_${quality}p.mp4`,
              mimetype: "video/mp4",
              caption:
                `✅ *Download complete*\n` +
                `🎥 Quality: *${quality}p*\n` +
                `🎞 Codec: *H.264*\n` +
                `💾 Size: *${sizeMB} MB*`,
            },
            { quoted: msg }
          );

          // cleanup
          if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch (e) {
          console.error("Send Error:", e);
          reply("❌ Failed to send video.");
          try {
            if (tempDir && fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }
          } catch {}
        }
      });
    } catch (err) {
      console.error("EPORNER ERROR:", err);

      try {
        if (tempDir && fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {}

      reply("❌ Error: " + (err.message || "unknown"));
    }
  }
);
