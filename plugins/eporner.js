const { cmd } = require("../command");
const fs = require("fs");
const path = require("path");
const os = require("os");
const axios = require("axios");
const { spawn, execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static"); // ✅ for audio bitrate fixing

const COOKIE_FILE = path.join(__dirname, "../cookies/eporner.txt");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ✅ Force MP4 Audio bitrate
const FORCE_AUDIO_BITRATE = "320k"; // ✅ AAC 320kbps

/* ================= HELPERS ================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function tailLines(text = "", maxLines = 10) {
  const lines = String(text).split("\n").filter(Boolean);
  return lines.slice(-maxLines).join("\n");
}

function execBin(bin, args, label = "EXEC") {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { maxBuffer: 1024 * 1024 * 50 },
      (err, stdout, stderr) => {
        if (err) {
          err._stdout = stdout || "";
          err._stderr = stderr || "";
          console.error(`\n❌ ${label} FAILED`);
          console.error("Exit:", err.code);
          console.error("STDERR:\n", err._stderr || "(empty)");
          console.error("STDOUT:\n", err._stdout || "(empty)");
          return reject(err);
        }
        resolve({ stdout: stdout || "", stderr: stderr || "" });
      }
    );
  });
}

function runYtDlp(args, label = "yt-dlp") {
  return execBin("yt-dlp", args, label);
}

// ✅ improved reason detector (more real cases)
function detectReasonFromText(text = "") {
  const t = String(text).toLowerCase();

  if (t.includes("cookie")) return "Cookies expired / invalid";
  if (t.includes("403") || t.includes("forbidden")) return "403 Forbidden (blocked)";
  if (t.includes("404") || t.includes("not found")) return "404 Not Found (removed)";
  if (t.includes("429") || t.includes("too many requests")) return "429 Rate limited";
  if (t.includes("cloudflare") || t.includes("captcha")) return "Cloudflare / Captcha blocked";

  if (t.includes("unable to download webpage")) return "Blocked / site changed / network issue";
  if (t.includes("name resolution") || t.includes("enotfound")) return "DNS error / No internet";
  if (t.includes("timed out") || t.includes("timeout")) return "Timeout / Slow network";
  if (t.includes("connection refused") || t.includes("econnrefused")) return "Connection refused";
  if (t.includes("connection reset") || t.includes("econnreset")) return "Connection reset";

  if (t.includes("tls") || t.includes("ssl")) return "SSL/TLS handshake error";
  if (t.includes("private") || t.includes("login") || t.includes("sign in"))
    return "Login required / restricted";

  if (t.includes("requested format is not available") || t.includes("no video formats"))
    return "Requested quality not available";

  if (t.includes("not available") || t.includes("removed") || t.includes("this video is not"))
    return "Video removed / unavailable";

  if (t.includes("ffmpeg")) return "FFmpeg merge error";

  if (t.includes("http error 520")) return "Cloudflare 520";
  if (t.includes("http error 521")) return "Cloudflare 521";
  if (t.includes("http error 522")) return "Cloudflare 522";
  if (t.includes("http error 523")) return "Cloudflare 523";
  if (t.includes("http error 524")) return "Cloudflare 524";

  return "Unknown";
}

function detectReason(err) {
  const t = (err?._stderr || "") + "\n" + (err?._stdout || "");
  return detectReasonFromText(t);
}

/* ================= METADATA GETTER (RETRY) ================= */
async function getMetadata(url) {
  const attempts = [
    {
      label: "EPORNER META (cookie)",
      args: [
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
      ],
    },
    {
      label: "EPORNER META (no-cookie)",
      args: ["--dump-single-json", "--no-warnings", "--no-playlist", url],
    },
  ];

  let lastErr = null;

  for (const item of attempts) {
    for (let i = 0; i < 2; i++) {
      try {
        const { stdout } = await runYtDlp(item.args, `${item.label} try#${i + 1}`);
        return JSON.parse(stdout);
      } catch (e) {
        lastErr = e;
        await sleep(700);
      }
    }
  }

  throw lastErr || new Error("Metadata failed");
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "eporner",
    ownerOnly: true,
    react: "💋",
    desc: "Eporner downloader (360/480/720/1080, NO AV1 + AAC 320kbps)",
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

      if (!ffmpegPath) {
        return reply("❌ ffmpeg-static missing (needed for AAC 320kbps fix)");
      }

      // ================= QUALITY PARSER ================= //
      let quality = 720;
      let url = q.trim();

      const parts = q.trim().split(/\s+/);
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

      // ================= METADATA ================= //
      let info = null;

      try {
        info = await getMetadata(url);
      } catch (e) {
        const reason = detectReason(e);
        const snippet = tailLines(e?._stderr || e?._stdout || "", 10);

        return reply(
          `❌ Metadata failed.\n🧠 Reason: *${reason}*\n\n` +
            `📌 Details:\n\`\`\`\n${snippet || "No output"}\n\`\`\``
        );
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
        `🎞 Video: *H.264 (No AV1)*\n` +
        `🎧 Audio: *AAC ${FORCE_AUDIO_BITRATE}*\n\n` +
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

      // ================= DOWNLOAD (NO AV1) ================= //
      const formatRule =
        `bv*[ext=mp4][vcodec^=avc1][height<=${quality}]+` +
        `ba[ext=m4a][acodec^=mp4a]/` +
        `b[ext=mp4][vcodec^=avc1][height<=${quality}]/` +
        `best[ext=mp4][height<=${quality}]`;

      let progressMsg = null;
      let lastUpdate = 0;
      let stderrLog = "";

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

      ytdlp.stderr.on("data", async (data) => {
        const text = data.toString();

        stderrLog += text;
        if (stderrLog.length > 20000) stderrLog = stderrLog.slice(-20000);

        const match = text.match(/(\d{1,3}\.\d)%/);
        if (!match) return;

        const now = Date.now();

        if (!progressMsg) {
          progressMsg = await bot.sendMessage(
            from,
            { text: `📥 Downloading…\n⏳ Progress: *${match[1]}%*` },
            { quoted: msg }
          );
          lastUpdate = now;
          return;
        }

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
            const reason = detectReasonFromText(stderrLog);
            const snippet = tailLines(stderrLog, 10);

            if (tempDir && fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }

            return reply(
              `❌ *Download failed*\n🧠 Reason: *${reason}*\n\n` +
                `📌 Details:\n\`\`\`\n${snippet || "No output"}\n\`\`\``
            );
          }

          const sizeBytes = fs.statSync(outputFile).size;
          if (sizeBytes < 300 * 1024) {
            const reason = detectReasonFromText(stderrLog);
            const snippet = tailLines(stderrLog, 10);

            if (tempDir && fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }

            return reply(
              `❌ *Download failed (empty file)*\n🧠 Reason: *${reason}*\n\n` +
                `📌 Details:\n\`\`\`\n${snippet || "No output"}\n\`\`\``
            );
          }

          /* =====================================================
             ✅ AUDIO FIX: Convert to AAC 320k (keep video copy)
          ===================================================== */
          const fixedFile = path.join(tempDir, `fixed_${Date.now()}.mp4`);
          let sendPath = outputFile;

          try {
            await execBin(
              ffmpegPath,
              [
                "-y",
                "-i",
                outputFile,
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                FORCE_AUDIO_BITRATE,
                "-movflags",
                "+faststart",
                fixedFile,
              ],
              "FFmpeg AUDIO 320K"
            );

            if (fs.existsSync(fixedFile) && fs.statSync(fixedFile).size > 300 * 1024) {
              sendPath = fixedFile;
            }
          } catch (e) {
            console.log("⚠ FFmpeg audio fix failed, sending original...");
          }

          const sizeMB = (fs.statSync(sendPath).size / 1048576).toFixed(2);

          await bot.sendMessage(
            from,
            {
              document: fs.readFileSync(sendPath),
              fileName: `${safeFileName(title)}_${quality}p.mp4`,
              mimetype: "video/mp4",
              caption:
                `✅ *Download complete*\n` +
                `🎥 Quality: *${quality}p*\n` +
                `🎞 Video: *H.264*\n` +
                `🎧 Audio: *AAC ${FORCE_AUDIO_BITRATE}*\n` +
                `💾 Size: *${sizeMB} MB*`,
            },
            { quoted: msg }
          );

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
