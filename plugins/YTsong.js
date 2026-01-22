const { cmd } = require("../command");
const ytsr = require("yt-search");
const ytdlp = require("yt-dlp-exec");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs-extra");
const path = require("path");

/* ================= COOKIES (AUTO FIND) ================= */
const COOKIE_CANDIDATES = [
  path.join(__dirname, "../cookies/yt.txt"),
  path.join(process.cwd(), "cookies/yt.txt"),
];

function findCookiesFile() {
  return COOKIE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

/* ================= HELPERS ================= */
function safeFileName(name, max = 80) {
  return (name || "song")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function tailLines(text = "", n = 15) {
  return String(text).split("\n").filter(Boolean).slice(-n).join("\n");
}

function getYtDlpText(err) {
  return (
    (err?.stderr || "") +
    "\n" +
    (err?.stdout || "") +
    "\n" +
    (err?.message || "")
  );
}

function detectReason(text = "") {
  const t = String(text).toLowerCase();

  if (t.includes("sign in to confirm") || t.includes("not a bot"))
    return "YouTube bot-check (cookies not working / not loaded)";
  if (t.includes("private video") || t.includes("login required"))
    return "Private / Login required";
  if (t.includes("signature solving failed") || t.includes("challenge solving failed"))
    return "EJS solver missing (install Deno/Node20 + remote-components)";
  if (t.includes("429") || t.includes("too many requests"))
    return "Rate limited (429)";
  if (t.includes("403") || t.includes("forbidden"))
    return "403 Forbidden (blocked)";
  if (t.includes("unavailable") || t.includes("not available"))
    return "Video unavailable / removed";
  if (t.includes("downloaded file is empty"))
    return "Downloaded file is empty (blocked / cookies issue)";

  return "Unknown";
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "song",
    ownerOnly: true,
    react: "🎵",
    desc: "Download Song using yt-dlp (cookies fix)",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    const id = Date.now();
    const tempDir = path.join("./temp", String(id));

    try {
      if (!q) return reply("*Please provide a song name or YouTube URL.*");

      // ✅ Find cookies
      const COOKIES_PATH = findCookiesFile();
      if (!COOKIES_PATH) {
        return reply(
          "❌ YouTube cookies file not found!\n\n" +
            "✅ Put your cookies file in:\n" +
            "• /cookies/youtube_cookies.txt\n" +
            "or\n" +
            "• /cookies/yt.txt"
        );
      }

      // 🔍 Search video
      const search = await ytsr(q);
      const data = search.videos?.[0];
      if (!data) return reply("❌ Song not found.");

      await fs.ensureDir(tempDir);

      const webmPath = path.join(tempDir, "audio.webm");
      const mp3Path = path.join(tempDir, "audio.mp3");

      const desc =
        `*🎵 GHOST SONG DOWNLOADER 👻*\n\n` +
        `👻 *Title:* ${data.title}\n` +
        `👻 *Duration:* ${data.timestamp || "Unknown"}\n` +
        `👻 *Uploaded:* ${data.ago}\n` +
        `👻 *Views:* ${data.views}\n` +
        `👻 *URL:* ${data.url}\n\n` +
        `🍪 Cookies: ✅ Loaded\n\n` +
        `📥 *Downloading Song…*`;

      await robin.sendMessage(
        from,
        { image: { url: data.thumbnail }, caption: desc },
        { quoted: mek }
      );

      // ✅ Download audio (WITH cookies ALWAYS)
      try {
        await ytdlp(data.url, {
          output: webmPath,
          format: "bestaudio[ext=m4a]/bestaudio/best",

          // ✅ IMPORTANT
          cookies: COOKIES_PATH,

          // ✅ EJS solver
          remoteComponents: "ejs:github",
          jsRuntimes: "node",

          noWarnings: true,
          noPlaylist: true,
          quiet: true,
        });
      } catch (e) {
        const out = getYtDlpText(e);
        const reason = detectReason(out);

        await fs.remove(tempDir).catch(() => {});
        return reply(
          `❌ Download failed.\n🧠 Reason: *${reason}*\n\n` +
            `📌 yt-dlp output:\n\`\`\`\n${tailLines(out, 18)}\n\`\`\``
        );
      }

      // ✅ Protect empty file
      if (!fs.existsSync(webmPath) || fs.statSync(webmPath).size < 50 * 1024) {
        await fs.remove(tempDir).catch(() => {});
        return reply(
          "❌ Downloaded file is empty.\n" +
            "✅ Your cookies are not accepted by YouTube (export again)."
        );
      }

      // 🎶 Convert → MP3 320kbps
      await new Promise((resolve, reject) => {
        ffmpeg(webmPath)
          .audioCodec("libmp3lame")
          .audioBitrate(320)
          .on("end", resolve)
          .on("error", reject)
          .save(mp3Path);
      });

      // ✅ Send mp3 audio
      await robin.sendMessage(
        from,
        { audio: { url: mp3Path }, mimetype: "audio/mpeg", ptt: false },
        { quoted: mek }
      );

      // ✅ Send mp3 file
      await robin.sendMessage(
        from,
        {
     document: { url: mp3Path },
     mimetype: "audio/mpeg",
     fileName: `${safeFileName(data.title)}.mp3`,
     caption: `👻 *${data.title}*`,
        },
        { quoted: mek }
      );

      await fs.remove(tempDir);
      reply("*✅ Song downloaded successfully!* 👻");
    } catch (err) {
      console.error("❌ Song Error:", err);
      reply("❌ Error: " + (err.message || "unknown"));
      await fs.remove(tempDir).catch(() => {});
    }
  }
);
