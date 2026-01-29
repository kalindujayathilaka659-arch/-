"use strict";

const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");
const http = require("http");
const https = require("https");

const BASE = "https://xanimeporn.com";
const LIST_URL = `${BASE}/hentai-list/`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// Keep-alive helps a bit (HTML + resolve requests)
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const ax = axios.create({
  timeout: 30000,
  httpAgent,
  httpsAgent,
  headers: {
    "User-Agent": UA,
    "Accept-Language": "en-US,en;q=0.9",
    Referer: BASE,
  },
  validateStatus: (s) => s >= 200 && s < 400,
});

/* =========================
   Message text extractor
   Works even when cmd() match is empty
========================= */
function getMessageText(m) {
  if (!m) return "";

  if (typeof m.body === "string" && m.body.trim()) return m.body.trim();
  if (typeof m.text === "string" && m.text.trim()) return m.text.trim();
  if (typeof m.caption === "string" && m.caption.trim()) return m.caption.trim();

  const msg = m.message || m.msg || m?.messages?.[0]?.message;

  const t =
    msg?.conversation ||
    msg?.extendedTextMessage?.text ||
    msg?.imageMessage?.caption ||
    msg?.videoMessage?.caption ||
    msg?.documentMessage?.caption ||
    msg?.buttonsResponseMessage?.selectedButtonId ||
    msg?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg?.templateButtonReplyMessage?.selectedId ||
    "";

  return String(t || "").trim();
}

// If user replies to a message containing a URL and types ".xanime", use quoted too
function getQuotedText(m) {
  const q =
    m?.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    m?.msg?.extendedTextMessage?.contextInfo?.quotedMessage ||
    null;

  if (!q) return "";

  const t =
    q?.conversation ||
    q?.extendedTextMessage?.text ||
    q?.imageMessage?.caption ||
    q?.videoMessage?.caption ||
    q?.documentMessage?.caption ||
    "";

  return String(t || "").trim();
}

function getCtx(args) {
  const arr = Array.isArray(args) ? args : [];

  const m =
    arr.find((a) => a && typeof a === "object" && (a.message || a.msg || a.key || a.chat || a.from || a.remoteJid)) ||
    arr.find((a) => a && a.m && typeof a.m === "object")?.m ||
    null;

  const conn =
    arr.find((a) => a && typeof a.sendMessage === "function") ||
    arr.find((a) => a && a.conn && typeof a.conn.sendMessage === "function")?.conn ||
    null;

  const jid = m?.chat || m?.from || m?.key?.remoteJid || m?.remoteJid || null;

  // router match may be empty on your bot
  const matchFromArgs = arr.find((a) => typeof a === "string") || "";

  return { conn, m, jid, matchFromArgs: String(matchFromArgs || "").trim() };
}

async function sendText(conn, jid, quoted, text) {
  if (!conn?.sendMessage || !jid) return;
  return conn.sendMessage(jid, { text }, { quoted });
}

/* =========================
   Utils
========================= */
function normalize(str = "") {
  return String(str)
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeFileName(name) {
  return String(name || "XAnime")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// remove command word even if repeated: ".xanime 1080 .xanime URL"
function stripCommandWords(text = "") {
  let t = String(text || "").trim();
  t = t.replace(/[.!/#]?\s*xanime\b/gi, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// remove surrounding <> "" '' () and trailing punctuation
function sanitizeRawInput(text = "") {
  let t = String(text || "").trim();

  // remove wrapping <...>
  if ((t.startsWith("<") && t.endsWith(">")) || (t.startsWith("(") && t.endsWith(")"))) {
    t = t.slice(1, -1).trim();
  }

  // strip quotes
  t = t.replace(/^["']+|["']+$/g, "").trim();

  // trim trailing punctuation after URLs
  t = t.replace(/[)\].,;]+$/g, "").trim();

  return t;
}

// Accept domain without protocol
function normalizePossibleUrl(u = "") {
  let s = sanitizeRawInput(u);
  // if starts with xanimeporn.com or www.xanimeporn.com, add https://
  if (/^(www\.)?xanimeporn\.com\//i.test(s)) s = "https://" + s;
  return s;
}

function isUrl(s = "") {
  const v = normalizePossibleUrl(s);
  return /^https?:\/\//i.test(v);
}

function extractEpisodeNumber(qRaw = "") {
  const q = String(qRaw);
  const m =
    q.match(/\bepisode\s*[:\-]?\s*(\d+)\b/i) ||
    q.match(/\bep\s*[:\-]?\s*(\d+)\b/i) ||
    q.match(/\be\s*(\d+)\b/i);

  const ep = m ? parseInt(m[1], 10) : null;

  const cleaned = q
    .replace(/\bepisode\s*[:\-]?\s*\d+\b/gi, " ")
    .replace(/\bep\s*[:\-]?\s*\d+\b/gi, " ")
    .replace(/\be\s*\d+\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { ep, cleanedQuery: cleaned };
}

function parseEpisodeFromUrl(url) {
  const m = String(url).match(/episode-(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/* =========================
   Parse command:
   - default quality 480p
   - ".xanime 1080 title"
   - ".xanime <URL>"
   - ".xanime 1080 <URL>"
   - "--ep 2"
   - "--link" (fast, no upload)
========================= */
function parseCommand(raw = "") {
  let text = stripCommandWords(raw);
  text = sanitizeRawInput(text);

  const out = {
    quality: "480p", // default
    ep: null,
    linkOnly: false,
    query: "",
  };

  if (/\s--link\b/i.test(text)) out.linkOnly = true;

  const em = text.match(/\s--ep(?:=|\s+)(\d+)\b/i);
  if (em) out.ep = parseInt(em[1], 10);

  const qm = text.match(/\s--q(?:=|\s+)(best|1080p|720p|480p|240p|1080|720|480|240)\b/i);
  if (qm) {
    const q = qm[1].toLowerCase();
    out.quality = q === "best" ? "best" : (q.endsWith("p") ? q : `${q}p`);
  }

  // remove flags
  text = text
    .replace(/\s--link\b/gi, " ")
    .replace(/\s--ep(?:=|\s+)\d+\b/gi, " ")
    .replace(/\s--q(?:=|\s+)(best|1080p|720p|480p|240p|1080|720|480|240)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // support leading quality token
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length) {
    const first = parts[0].toLowerCase();
    if (/^(best|1080p|720p|480p|240p|1080|720|480|240)$/.test(first)) {
      out.quality = first === "best" ? "best" : (first.endsWith("p") ? first : `${first}p`);
      parts.shift();
      text = parts.join(" ").trim();
    }
  }

  out.query = text;
  return out;
}

/* =========================
   HTTP / scrape
========================= */
async function fetchHtml(url) {
  const res = await ax.get(url);
  return res.data;
}

// Faster resolve: HEAD first (no body), fallback to GET range
async function resolveFinalUrl(downloadPhpUrl) {
  try {
    const r = await ax.request({
      method: "HEAD",
      url: downloadPhpUrl,
      timeout: 15000,
      maxRedirects: 6,
    });

    return (
      r?.request?.res?.responseUrl ||
      r?.request?._redirectable?._currentUrl ||
      downloadPhpUrl
    );
  } catch (_) {}

  const res = await ax.get(downloadPhpUrl, {
    headers: { Range: "bytes=0-0" },
    timeout: 30000,
    maxRedirects: 6,
    responseType: "stream",
  });

  const finalUrl =
    res?.request?.res?.responseUrl ||
    res?.request?._redirectable?._currentUrl ||
    downloadPhpUrl;

  if (res.data && typeof res.data.destroy === "function") res.data.destroy();
  return finalUrl;
}

async function scrapeEpisodePage(episodeUrl) {
  const html = await fetchHtml(episodeUrl);
  const $ = cheerio.load(html);

  let thumb =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $("img.wp-post-image").attr("src") ||
    $("article img").first().attr("src") ||
    $("img").first().attr("src") ||
    null;

  if (thumb && !/^https?:\/\//i.test(thumb)) {
    try { thumb = new URL(thumb, BASE).toString(); } catch {}
  }

  const downloads = [];
  $('a[href*="videos.xanimeporn.com/download.php"]').each((_, a) => {
    const href = $(a).attr("href");
    const label = $(a).text().trim();
    if (!href) return;
    downloads.push({ quality: (label || "unknown").trim().toLowerCase(), url: href });
  });

  // dedupe
  const seen = new Set();
  const uniq = downloads.filter((d) => {
    const k = `${d.quality}::${d.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    title: $("h1").first().text().trim() || null,
    episodeUrl,
    thumbnail: thumb,
    downloads: uniq,
  };
}

async function scrapeSeriesPage(seriesUrl) {
  const html = await fetchHtml(seriesUrl);
  const $ = cheerio.load(html);

  const episodes = [];
  $("a").each((_, a) => {
    const text = $(a).text().trim();
    const href = $(a).attr("href");
    if (!href || !text) return;

    const m = text.match(/\bEpisode\s+(\d+)\b/i);
    if (!m) return;

    episodes.push({
      episode: parseInt(m[1], 10),
      url: href.startsWith("http") ? href : new URL(href, BASE).toString(),
    });
  });

  const map = new Map();
  for (const ep of episodes) if (!map.has(ep.episode)) map.set(ep.episode, ep);

  return {
    title: $("h1").first().text().trim() || null,
    episodes: [...map.values()].sort((a, b) => a.episode - b.episode),
  };
}

/* =========================
   SEARCH INDEX FIX (prevents Contact/Privacy winning)
========================= */
let LIST_CACHE = null;
let LIST_CACHE_AT = 0;
let LIST_PROMISE = null;

function isDeniedPath(pathname) {
  const p = String(pathname || "").toLowerCase();
  const deny = [
    /^\/$/,
    /^\/(hentai-list|hentai-series|top-10|censored|uncensored)(\/|$)/,
    /^\/(contact|contact-us|about|faq|dmca|privacy-policy|terms|sitemap)(\/|$)/,
  ];
  return deny.some((r) => r.test(p));
}

async function getSeriesIndex({ cacheMinutes = 60 } = {}) {
  const now = Date.now();
  if (LIST_CACHE && now - LIST_CACHE_AT < cacheMinutes * 60_000) return LIST_CACHE;
  if (LIST_PROMISE) return LIST_PROMISE;

  LIST_PROMISE = (async () => {
    const html = await fetchHtml(LIST_URL);
    const $ = cheerio.load(html);

    const out = [];
    const seen = new Set();

    $("a").each((_, a) => {
      const title = $(a).text().trim();
      const hrefRaw = $(a).attr("href");
      if (!title || !hrefRaw) return;

      const href = hrefRaw.startsWith("http") ? hrefRaw : new URL(hrefRaw, BASE).toString();
      if (!/https?:\/\/(www\.)?xanimeporn\.com\//i.test(href)) return;

      let pathname = "/";
      try { pathname = new URL(href).pathname; } catch {}
      if (isDeniedPath(pathname)) return;

      if (/\/episode-\d+/i.test(pathname) || /sub-eng/i.test(pathname)) return;

      if (seen.has(href)) return;
      seen.add(href);

      out.push({ title, url: href });
    });

    LIST_CACHE = out;
    LIST_CACHE_AT = Date.now();
    LIST_PROMISE = null;
    return out;
  })();

  return LIST_PROMISE;
}

async function searchSeries(query, { limit = 5 } = {}) {
  const idx = await getSeriesIndex();
  const qn = normalize(query);
  if (!qn) return [];

  const qTokens = qn.split(" ").filter(Boolean);

  function score(title) {
    const tn = normalize(title);
    let s = 0;
    let hits = 0;

    const tokens = qTokens.filter((t) => t.length >= 3);
    for (const t of tokens) {
      if (tn.includes(t)) {
        hits++;
        s += 3;
      }
    }

    // No token match => score 0
    if (hits === 0 && tn !== qn && !tn.startsWith(qn)) return 0;

    if (tn === qn) s += 50;
    if (tn.startsWith(qn)) s += 15;

    s += Math.max(0, 10 - Math.floor(tn.length / 20));
    return s;
  }

  return idx
    .map((x) => ({ ...x, _score: score(x.title) }))
    .filter((x) => x._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...rest }) => rest);
}

/* =========================
   Core: resolve query/url -> episode + downloads
========================= */
async function findEpisodeAndDownloads(input, forcedEp = null) {
  const raw = String(input || "").trim();
  const maybeUrl = normalizePossibleUrl(raw);

  if (isUrl(maybeUrl)) {
    const url = maybeUrl;

    if (!/https?:\/\/(www\.)?xanimeporn\.com\//i.test(url) && !/videos\.xanimeporn\.com\/download\.php/i.test(url)) {
      return { error: "Only xanimeporn.com URLs are supported." };
    }

    // download.php direct
    if (/videos\.xanimeporn\.com\/download\.php/i.test(url)) {
      return { title: "XAnime", episode: 1, episodeUrl: url, thumbnail: null, downloads: [{ quality: "unknown", url }] };
    }

    // episode page
    if (/\/episode-\d+/i.test(url) || /sub-eng/i.test(url)) {
      const epNum = parseEpisodeFromUrl(url) || 1;
      const ep = await scrapeEpisodePage(url);
      return { title: ep.title || "XAnime", episode: epNum, episodeUrl: ep.episodeUrl, thumbnail: ep.thumbnail, downloads: ep.downloads };
    }

    // series page
    const series = await scrapeSeriesPage(url);
    const wantEp = forcedEp || 1;
    const epObj = series.episodes.find((x) => x.episode === wantEp);
    if (!epObj) return { error: `Episode ${wantEp} not found.`, title: series.title, episodes: series.episodes };

    const ep = await scrapeEpisodePage(epObj.url);
    return { title: series.title || ep.title || "XAnime", episode: wantEp, episodeUrl: epObj.url, thumbnail: ep.thumbnail, downloads: ep.downloads };
  }

  // search query
  const { ep, cleanedQuery } = extractEpisodeNumber(raw);
  const results = await searchSeries(cleanedQuery || raw, { limit: 5 });
  if (!results.length) return { error: "No matches found." };

  const best = results[0];
  const series = await scrapeSeriesPage(best.url);

  const wantEp = forcedEp || ep || 1;
  const epObj = series.episodes.find((x) => x.episode === wantEp);
  if (!epObj) return { error: `Episode ${wantEp} not found.`, title: series.title, episodes: series.episodes };

  const epPage = await scrapeEpisodePage(epObj.url);
  return { title: series.title || "XAnime", episode: wantEp, episodeUrl: epObj.url, thumbnail: epPage.thumbnail, downloads: epPage.downloads };
}

function pickDownload(downloads, preferred = "480p") {
  if (!downloads?.length) return null;

  const map = new Map(downloads.map((d) => [String(d.quality || "").toLowerCase(), d]));
  const want = String(preferred || "480p").toLowerCase();

  if (want !== "best") {
    const exact = map.get(want);
    if (exact) return exact;
  }

  const orders = {
    best: ["1080p", "720p", "480p", "240p"],
    "1080p": ["1080p", "720p", "480p", "240p"],
    "720p": ["720p", "1080p", "480p", "240p"],
    "480p": ["480p", "720p", "1080p", "240p"],
    "240p": ["240p", "480p", "720p", "1080p"],
  };

  const order = orders[want] || orders["480p"];
  for (const q of order) {
    const hit = map.get(q);
    if (hit) return hit;
  }
  return downloads[0];
}

/* =========================
   COMMAND
========================= */
cmd(
  {
    pattern: "xanime",
    desc: "Auto-send as document (default 480p). Supports .xanime <URL>",
    category: "nsfw",
    filename: __filename,
  },
  async (...args) => {
    const { conn, m, jid, matchFromArgs } = getCtx(args);
    if (!conn || !jid) return;

    const fullText = getMessageText(m);
    const quotedText = getQuotedText(m);

    // Prefer router match; otherwise full message; if still empty use quoted
    const rawInput = matchFromArgs?.trim() ? matchFromArgs : (fullText?.trim() ? fullText : quotedText);

    const parsed = parseCommand(rawInput);

    if (!parsed.query) {
      return sendText(
        conn,
        jid,
        m,
        "❌ Usage:\n" +
          ".xanime sister lover\n" +
          ".xanime 1080 sister lover\n" +
          ".xanime 720 sister lover --ep 2\n" +
          ".xanime <URL>\n" +
          ".xanime 1080 <URL>\n\n" +
          "Default quality: 480p\n" +
          "Add --link to send only link (fast)."
      );
    }

    const epFromQuery = extractEpisodeNumber(parsed.query).ep;
    const forcedEp = Number.isInteger(parsed.ep) ? parsed.ep : epFromQuery;

    let found;
    try {
      found = await findEpisodeAndDownloads(parsed.query, forcedEp);
    } catch (e) {
      return sendText(conn, jid, m, `❌ Error: ${String(e?.message || e)}`);
    }

    if (found.error) {
      if (found.episodes?.length) {
        const preview = found.episodes.slice(0, 15).map((e) => `Ep ${e.episode}: ${e.url}`).join("\n");
        return sendText(conn, jid, m, `❌ ${found.error}\n\n📺 Episodes (first 15):\n${preview}`);
      }
      return sendText(conn, jid, m, `❌ ${found.error}`);
    }

    if (!found.downloads?.length) return sendText(conn, jid, m, "❌ No download links found.");

    const pick = pickDownload(found.downloads, parsed.quality);
    if (!pick?.url) return sendText(conn, jid, m, "❌ Could not pick a download link.");

    const title = found.title || "XAnime";
    const episode = found.episode || 1;

    // Instant mode
    if (parsed.linkOnly) {
      return sendText(conn, jid, m, `🎬 ${title}\n📌 Episode: ${episode}\n🎞 Quality: ${pick.quality}\n🔗 ${found.episodeUrl}\n⬇️ ${pick.url}`);
    }

    // Status (thumbnail + caption)
    const statusText =
      `⏳ Sending as document...\n` +
      `🎬 ${title}\n` +
      `📌 Episode: ${episode}\n` +
      `🎞 Quality: ${pick.quality}`;

    try {
      if (found.thumbnail) {
        await conn.sendMessage(jid, { image: { url: found.thumbnail }, caption: statusText }, { quoted: m });
      } else {
        await sendText(conn, jid, m, statusText);
      }
    } catch {}

    const fileName = `${safeFileName(title)} - Ep ${episode} - ${pick.quality}.mp4`;

    // Speed: try sending download.php directly first (no resolve request)
    try {
      await conn.sendMessage(
        jid,
        {
          document: { url: pick.url },
          mimetype: "video/mp4",
          fileName,
          caption: `🎬 ${title} | Ep ${episode} | ${pick.quality}`,
        },
        { quoted: m }
      );
      return;
    } catch (_) {}

    // Fallback: resolve then send
    try {
      const finalUrl = await resolveFinalUrl(pick.url);
      await conn.sendMessage(
        jid,
        {
          document: { url: finalUrl },
          mimetype: "video/mp4",
          fileName,
          caption: `🎬 ${title} | Ep ${episode} | ${pick.quality}`,
        },
        { quoted: m }
      );
    } catch (e) {
      return sendText(conn, jid, m, `⚠️ Could not send document.\nHere is the link:\n${pick.url}\n\nError: ${String(e?.message || e)}`);
    }
  }
);

module.exports = {};
