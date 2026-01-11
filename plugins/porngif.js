const { cmd } = require("../command");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// ================= RUNTIME MEMORY =================
const sentIds = new Set();

// ================= HELPERS =================
const normalize = (str = "") =>
  str
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const STOP_TAGS = new Set([
  "porn", "sex", "nsfw", "adult", "xxx", "redgifs", "gif"
]);

const keywordCoverage = (keywords, text) =>
  keywords.filter(k => text.includes(k)).length;

// ================= SCORING ENGINE =================
function scoreGif(gif, keywords, fullQuery) {
  const title = normalize(gif.title || "");
  const tags = (gif.tags || []).map(t => normalize(t));
  const tagText = tags.join(" ");

  let score = 0;

  // ❌ remove generic junk
  if (tags.some(t => STOP_TAGS.has(t))) score -= 4;

  // ✅ exact phrase match (HUGE BOOST)
  if (title.includes(fullQuery) || tagText.includes(fullQuery)) {
    score += 20;
  }

  // ✅ keyword coverage
  const tagHits = keywordCoverage(keywords, tagText);
  const titleHits = keywordCoverage(keywords, title);

  score += tagHits * 6;
  score += titleHits * 3;

  // ❌ reject weak matches
  if (tagHits === 0 && titleHits === 0) return null;

  // ❌ must match at least half keywords
  if (tagHits + titleHits < Math.ceil(keywords.length / 2)) {
    score -= 6;
  }

  return score >= 8 ? score : null;
}

// ================= COMMAND =================
cmd(
  {
    pattern: "pornclip",
    ownerOnly: true,
    react: "🔞",
    desc: "Highly accurate RedGifs video downloader",
    category: "nsfw",
    filename: __filename,
  },
  async (bot, mek, m, { q, reply, from }) => {
    try {
      // ---------------- QUERY ----------------
      const query = q?.trim() || "ass";
      const fullQuery = normalize(query);
      const keywords = fullQuery.split(" ");

      await reply(`🔍 Searching RedGifs for: *${query}*`);

      // ---------------- AUTH ----------------
      const auth = await axios.get(
        "https://api.redgifs.com/v2/auth/temporary",
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
            Origin: "https://www.redgifs.com",
            Referer: "https://www.redgifs.com/",
          },
          timeout: 15000,
        }
      );

      const token = auth.data?.token;
      if (!token) return reply("❌ RedGifs auth failed.");

      // ---------------- SEARCH ----------------
      const search = await axios.get(
        "https://api.redgifs.com/v2/gifs/search",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "Mozilla/5.0",
          },
          params: {
            search_text: query,
            count: 100,
          },
          timeout: 20000,
        }
      );

      let gifs = search.data?.gifs || [];
      if (!gifs.length) return reply("❌ No results found.");

      // ---------------- REMOVE REPEATS ----------------
      gifs = gifs.filter(g => g.id && !sentIds.has(g.id));
      if (!gifs.length) {
        sentIds.clear();
        return reply("♻️ All videos used. Try again.");
      }

      // ---------------- ACCURATE SCORING ----------------
      const scored = gifs
        .map(g => {
          const s = scoreGif(g, keywords, fullQuery);
          return s ? { gif: g, score: s } : null;
        })
        .filter(Boolean);

      if (!scored.length)
        return reply("❌ No highly relevant results found.");

      scored.sort((a, b) => b.score - a.score);

      // ---------------- SMART PICK ----------------
      const pool = scored.slice(0, Math.min(5, scored.length));
      const selected =
        pool[Math.floor(Math.random() * pool.length)].gif;

      sentIds.add(selected.id);

      // ---------------- VIDEO SOURCE ----------------
      const sourceUrl = selected.urls?.hd || selected.urls?.sd;
      if (!sourceUrl) return reply("❌ No playable video.");

      // ---------------- TEMP FILES ----------------
      const tmpDir = path.join(os.tmpdir(), "redgifs");
      fs.mkdirSync(tmpDir, { recursive: true });

      const rawPath = path.join(tmpDir, `raw_${Date.now()}.mp4`);
      const finalPath = path.join(tmpDir, `final_${Date.now()}.mp4`);

      // ---------------- DOWNLOAD ----------------
      const res = await axios.get(sourceUrl, {
        responseType: "stream",
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 30000,
      });

      await new Promise((resolve, reject) => {
        const w = fs.createWriteStream(rawPath);
        res.data.pipe(w);
        w.on("finish", resolve);
        w.on("error", reject);
      });

      // ---------------- WHATSAPP SAFE ----------------
      await new Promise((resolve, reject) => {
        ffmpeg(rawPath)
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions([
            "-movflags +faststart",
            "-pix_fmt yuv420p",
            "-profile:v baseline",
            "-level 3.0",
            "-crf 20",
            "-preset veryfast",
          ])
          .save(finalPath)
          .on("end", resolve)
          .on("error", reject);
      });

      // ---------------- SEND ----------------
      await bot.sendMessage(
        from,
        {
          video: fs.readFileSync(finalPath),
          mimetype: "video/mp4",
          caption: `🎞️ *${selected.title || query}*`,
        },
        { quoted: mek }
      );

      fs.unlinkSync(rawPath);
      fs.unlinkSync(finalPath);

    } catch (err) {
      console.error("RedGifs error:", err.message);
      reply("❌ Failed to fetch accurate RedGifs video.");
    }
  }
);
