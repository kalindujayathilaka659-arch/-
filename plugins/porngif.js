const { cmd } = require("../command");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { isOwner } = require("../lib/auth");

const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// runtime memory to avoid repeats
const sentIds = new Set();

cmd(
  {
    pattern: "pornclip",
    ownerOnly: true,
    react: "🔞",
    desc: "RedGifs video downloader (ALL niches, no repeats, HQ, WhatsApp safe)",
    category: "nsfw",
    filename: __filename,
  },
  async (robin, mek, m, { q, reply, from }) => {
    try {
      /* ---------------- QUERY ---------------- */
      const query =
        typeof q === "string" && q.trim().length
          ? q.trim()
          : "ass";

      const keywords = query.toLowerCase().split(/\s+/);

      await reply(`🔍 Searching RedGifs for: *${query}*`);

      /* ---------------- AUTH ---------------- */
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

      /* ---------------- SEARCH ---------------- */
      const search = await axios.get(
        "https://api.redgifs.com/v2/gifs/search",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
            Origin: "https://www.redgifs.com",
            Referer: "https://www.redgifs.com/",
          },
          params: {
            search_text: query,
            count: 100,
            page: 1,
          },
          timeout: 20000,
        }
      );

      const gifs = search.data?.gifs || [];
      if (!gifs.length) return reply("❌ No results found.");

      /* ---------------- REMOVE REPEATS ---------------- */
      let available = gifs.filter(g => g.id && !sentIds.has(g.id));

      if (!available.length) {
        sentIds.clear(); // reset only when exhausted
        return reply("♻️ All videos used. Try again.");
      }

      /* ---------------- SCORING ---------------- */
      const scored = available.map(g => {
        const title = (g.title || "").toLowerCase();
        const tags = (g.tags || []).map(t => t.toLowerCase());

        let score = 0;
        for (const k of keywords) {
          if (tags.includes(k)) score += 6;
          else if (tags.some(t => t.startsWith(k))) score += 4;
          else if (tags.some(t => t.includes(k))) score += 2;
          else if (title.includes(k)) score += 1;
        }

        return { gif: g, score };
      });

      scored.sort((a, b) => b.score - a.score);

      /* ---------------- RANDOM PICK FROM TOP ---------------- */
      const topPool = scored.slice(0, Math.min(5, scored.length));
      const selected =
        topPool[Math.floor(Math.random() * topPool.length)].gif;

      sentIds.add(selected.id);

      /* ---------------- VIDEO SOURCE ---------------- */
      const sourceUrl =
        selected.urls?.hd ||
        selected.urls?.sd;

      if (!sourceUrl)
        return reply("❌ No playable video found.");

      /* ---------------- TEMP FILES ---------------- */
      const tmpDir = path.join(os.tmpdir(), "redgifs");
      fs.mkdirSync(tmpDir, { recursive: true });

      const rawPath = path.join(tmpDir, `raw_${Date.now()}.mp4`);
      const finalPath = path.join(tmpDir, `final_${Date.now()}.mp4`);

      /* ---------------- DOWNLOAD ---------------- */
      const res = await axios.get(sourceUrl, {
        responseType: "stream",
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept-Encoding": "identity",
        },
        timeout: 30000,
      });

      await new Promise((resolve, reject) => {
        const w = fs.createWriteStream(rawPath);
        res.data.pipe(w);
        w.on("finish", resolve);
        w.on("error", reject);
      });

      /* ---------------- WHATSAPP SAFE ---------------- */
      async function makeWhatsAppSafe(input, output) {
        // REMUX FIRST (NO QUALITY LOSS)
        try {
          await new Promise((resolve, reject) => {
            ffmpeg(input)
              .videoCodec("copy")
              .audioCodec("copy")
              .outputOptions([
                "-movflags +faststart",
                "-pix_fmt yuv420p",
              ])
              .save(output)
              .on("end", resolve)
              .on("error", reject);
          });
          return;
        } catch {}

        // FALLBACK RE-ENCODE (NEAR LOSSLESS)
        await new Promise((resolve, reject) => {
          ffmpeg(input)
            .videoCodec("libx264")
            .audioCodec("aac")
            .outputOptions([
              "-movflags +faststart",
              "-pix_fmt yuv420p",
              "-profile:v baseline",
              "-level 3.0",
              "-crf 18",
              "-preset veryfast",
            ])
            .format("mp4")
            .save(output)
            .on("end", resolve)
            .on("error", reject);
        });
      }

      await makeWhatsAppSafe(rawPath, finalPath);

      /* ---------------- SEND ---------------- */
      await robin.sendMessage(
        from,
        {
          video: fs.readFileSync(finalPath),
          mimetype: "video/mp4",
          caption: `🎞️ *${selected.title || query}*`,
        },
        { quoted: mek }
      );

      /* ---------------- CLEANUP ---------------- */
      fs.unlinkSync(rawPath);
      fs.unlinkSync(finalPath);

    } catch (err) {
      console.error("RedGifs error:", err?.response?.status, err.message);
      reply("❌ Failed to fetch RedGifs video.");
    }
  }
);
