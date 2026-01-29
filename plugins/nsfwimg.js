const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");

/* ================= CONFIG ================= */
const BASE = "https://rule34.xxx";
const DEFAULT_TAG = "big_ass";
const DEFAULT_SEND = 5;
const MAX_SEND = 10;
const LIMIT = 100;

// ⚠️ Safety tag blocks
const BLOCK_TAGS = ["loli", "shota", "child", "young", "underage"];

/* ================= HELPERS ================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || "").trim());
}

function normalizeBase(base) {
  return String(base || "").replace(/\/+$/, "");
}

/**
 * Supports:
 *  - "big_ass"
 *  - "big ass"  -> "big_ass" (single tag convenience)
 *  - "big_ass, solo, 1girl" -> "big_ass solo 1girl" (multiple tags via comma)
 * Also preserves negative tags like "-tag" (exclude).
 */
function normalizeTags(input) {
  if (!input) return DEFAULT_TAG;

  const raw = String(input)
    .toLowerCase()
    .trim()
    // allow (), :, _, -, commas, spaces
    .replace(/[^a-z0-9_\s\-():,]/g, "")
    .replace(/\s+/g, " ");

  // allow multi-tags by commas
  const groups = raw
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);

  if (!groups.length) return DEFAULT_TAG;

  const fixed = groups
    .map((g) => {
      // keep negative tags working: "-tag"
      const neg = g.startsWith("-");
      const body = neg ? g.slice(1) : g;

      // "space -> underscore" inside a tag group
      const tag = body
        .split(" ")
        .filter(Boolean)
        .map((t) => t.replace(/-/g, "_")) // dash inside tag name -> underscore
        .join("_");

      return neg ? `-${tag}` : tag;
    })
    // tags must be space-separated for rule34
    .join(" ")
    .trim();

  return fixed || DEFAULT_TAG;
}

function hasBlockedTags(tags) {
  const tokens = String(tags || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return tokens.some((tok) => {
    const neg = tok.startsWith("-");
    const body = neg ? tok.slice(1) : tok;
    if (!body) return false;

    // split tag parts by underscore and check blocked words
    const parts = body.split("_");
    return parts.some((p) => BLOCK_TAGS.includes(p));
  });
}

function extractTagsFromListUrl(url) {
  try {
    const u = new URL(url);
    const t = u.searchParams.get("tags") || "";
    // URLSearchParams gives decoded value; keep as-is
    return t.trim();
  } catch {
    return "";
  }
}

function normalizeListUrl(url) {
  const u = new URL(url);
  const out = new URL("/index.php", u.origin);
  out.searchParams.set("page", "post");
  out.searchParams.set("s", "list");

  const tags = u.searchParams.get("tags") || "";
  if (tags) out.searchParams.set("tags", tags);

  const pid = u.searchParams.get("pid");
  if (pid) out.searchParams.set("pid", pid);

  return out.toString();
}

function parseQuery(q) {
  let sendCount = DEFAULT_SEND;
  let query = (q || "").trim();

  // support: tag | 7
  if (query.includes("|")) {
    const [a, b] = query.split("|").map((x) => x.trim());
    query = a;
    const n = parseInt(b, 10);
    if (!Number.isNaN(n)) sendCount = n;
  } else {
    // support: 7 tag words
    const parts = query.split(/\s+/).filter(Boolean);
    if (parts.length > 1 && /^\d+$/.test(parts[0])) {
      sendCount = Math.min(parseInt(parts[0], 10), MAX_SEND);
      query = parts.slice(1).join(" ");
    }
  }

  sendCount = Math.max(1, Math.min(sendCount, MAX_SEND));

  // ✅ URL support:
  // if user passes full URL, extract tags for API, and keep url for HTML fallback
  if (isHttpUrl(query)) {
    const listUrl = normalizeListUrl(query);
    const tagsFromUrl = extractTagsFromListUrl(listUrl);
    const tags = tagsFromUrl ? tagsFromUrl : DEFAULT_TAG;
    return { tags, sendCount, listUrl };
  }

  return { tags: normalizeTags(query), sendCount, listUrl: null };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fixUrl(u) {
  if (!u) return null;
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) return BASE + u;
  return u;
}

function isImageUrl(url) {
  return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url);
}

/* ================= HEADERS ================= */
const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: BASE + "/",
};

/* ================= API FETCH ================= */
async function fetchRule34ApiPosts(tags, pid = 0) {
  const res = await axios.get(`${BASE}/index.php`, {
    params: {
      page: "dapi",
      s: "post",
      q: "index",
      json: 1,
      limit: LIMIT,
      pid,
      tags,
    },
    headers,
    timeout: 20000,
    validateStatus: () => true,
  });

  if (res.status !== 200) return [];

  const d = res.data;
  if (Array.isArray(d)) return d;
  if (d?.post && Array.isArray(d.post)) return d.post;
  return [];
}

/* ================= HTML FALLBACK ================= */
async function fetchPostIdsFromList(tagsOrUrl) {
  const input = String(tagsOrUrl ?? "").trim();
  const cleanBase = normalizeBase(BASE);

  const url = isHttpUrl(input)
    ? normalizeListUrl(input)
    : `${cleanBase}/index.php?page=post&s=list&tags=${encodeURIComponent(input).replace(
        /%20/g,
        "+"
      )}`;

  const res = await axios.get(url, {
    headers: { ...headers, Accept: "text/html" },
    timeout: 20000,
    validateStatus: () => true,
  });

  if (res.status !== 200) return [];

  const $ = cheerio.load(res.data);
  const ids = new Set();

  $('a[href*="page=post"][href*="s=view"][href*="id="]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/(?:\?|&)id=(\d+)/);
    if (m) ids.add(m[1]);
  });

  return [...ids];
}

async function fetchFullImageFromPostId(id) {
  const res = await axios.get(`${BASE}/index.php?page=post&s=view&id=${id}`, {
    headers: { ...headers, Accept: "text/html" },
    timeout: 20000,
    validateStatus: () => true,
  });

  if (res.status !== 200) return null;

  const $ = cheerio.load(res.data);
  let img =
    $("#highres").attr("href") ||
    $("#image").attr("src") ||
    $("img#image").attr("src");

  img = fixUrl(img);
  if (!img || !isImageUrl(img)) return null;

  return { id, url: img };
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "nsfwimg",
    ownerOnly: true,
    react: "🍑",
    desc: "Rule34 scraper (API + HTML fallback)",
    category: "nsfw",
    filename: __filename,
  },
  async (robin, mek, m, { q, from, reply }) => {
    try {
      const { tags, sendCount, listUrl } = parseQuery(q);

      if (hasBlockedTags(tags)) {
        return reply("❌ Blocked tag detected (safety).");
      }

      let images = [];

      /* API first */
      for (let pid = 0; pid < 2; pid++) {
        const posts = await fetchRule34ApiPosts(tags, pid);
        const temp = posts
          .map((p) => ({
            id: p.id,
            url: fixUrl(p.file_url || p.sample_url),
          }))
          .filter((x) => x.url && isImageUrl(x.url));

        if (temp.length) {
          images = temp;
          break;
        }
      }

      /* HTML fallback */
      if (!images.length) {
        const ids = await fetchPostIdsFromList(listUrl || tags);
        for (const id of shuffle(ids).slice(0, 30)) {
          const img = await fetchFullImageFromPostId(id);
          if (img) images.push(img);
          if (images.length >= sendCount) break;
          await sleep(250);
        }
      }

      if (!images.length) {
        return reply(`❌ No images found for: *${tags}*`);
      }

      const unique = [...new Map(images.map((x) => [x.url, x])).values()];
      const selected = shuffle(unique).slice(
        0,
        Math.min(sendCount, unique.length)
      );

      for (const item of selected) {
        await robin.sendMessage(
          from,
          {
            image: { url: item.url },
            caption:
              `🍑 *Rule34 Image*\n` +
              `🔍 *Tags:* ${tags}\n` +
              `🆔 *ID:* ${item.id}\n` +
              `🌐 *Source:* rule34.xxx`,
          },
          { quoted: mek }
        );
      }
    } catch (err) {
      console.error("Rule34 error:", err);
      reply("❌ Failed to fetch Rule34 images.");
    }
  }
);
