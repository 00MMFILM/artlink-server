import * as cheerio from "cheerio";

const BOARDS = [
  { mid: "actorCasting", tab: "프로젝트", field: "acting" },
  { mid: "performerCasting", tab: "오디션", field: "acting" },
  { mid: "volunteerActor", tab: "콜라보", field: "acting" },
];

const UA = "Mozilla/5.0 (compatible; ArtlinkBot/1.0)";

// Server-side cache: 30 min TTL
let _cache = { data: null, ts: 0 };
const CACHE_TTL = 30 * 60 * 1000;

function parseGender(raw) {
  if (!raw) return undefined;
  const g = raw.trim();
  if (g.includes("남자") && g.includes("여자")) return "all";
  if (g.includes("남자")) return "male";
  if (g.includes("여자")) return "female";
  return undefined;
}

function parseDaysBadge(text) {
  // "+D 3" means 3 days until deadline
  const m = text.match(/\+D\s*(\d+)/);
  if (!m) return undefined;
  const days = parseInt(m[1], 10);
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + days);
  return deadline.toISOString().split("T")[0];
}

function extractTags(category, meta) {
  const tags = [];
  if (category) tags.push(category);
  if (meta["극중배역"]) {
    const role = meta["극중배역"];
    if (role.length <= 20) tags.push(role);
  }
  if (meta["출연료"] && meta["출연료"] !== "없음") tags.push("유급");
  return tags;
}

async function fetchBoard(board) {
  const url = `https://www.filmmakers.co.kr/${board.mid}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${board.mid}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const posts = [];

  $("#board_list > div").each((i, el) => {
    const a = $(el).find("a.block.p-3");
    if (!a.length) return;

    const href = a.attr("href") || "";
    const srlMatch = href.match(/\/(\d+)$/);
    if (!srlMatch) return;
    const srl = srlMatch[1];

    // Title
    const title = a.find("h2").text().trim();
    if (!title) return;

    // Category badge (first span in badge row)
    const badges = a.find("div.flex.flex-wrap.items-center.gap-1 > span");
    let category = "";
    let deadline = undefined;
    badges.each((j, badge) => {
      const txt = $(badge).text().trim();
      if (txt.startsWith("+D") || txt === "마감") {
        if (txt === "마감") return; // skip closed posts
        deadline = parseDaysBadge(txt);
      } else if (txt !== "N" && !category) {
        category = txt;
      }
    });

    // Check for "마감" (closed) — skip
    let isClosed = false;
    badges.each((j, badge) => {
      if ($(badge).text().trim() === "마감") isClosed = true;
    });
    if (isClosed) return;

    // Metadata fields
    const meta = {};
    a.find("div.flex.flex-wrap.gap-x-4 > span").each((j, span) => {
      const label = $(span).find("span").text().trim();
      const fullText = $(span).text().trim();
      const value = fullText.replace(label, "").trim();
      if (label && value) meta[label] = value;
    });

    // Date
    const dateText = a
      .find("div.flex.items-center.justify-between > span")
      .first()
      .text()
      .trim();

    // Build description from metadata
    const descParts = [];
    if (meta["극중배역"]) descParts.push(`배역: ${meta["극중배역"]}`);
    if (meta["출연료"]) descParts.push(`출연료: ${meta["출연료"]}`);
    if (meta["작품 제목"]) descParts.push(`작품: ${meta["작품 제목"]}`);
    if (meta["제작"] && meta["제작"] !== "()") descParts.push(`제작: ${meta["제작"]}`);
    const description = descParts.join(" | ") || title;

    const gender = parseGender(meta["모집성별"]);
    const tags = extractTags(category, meta);

    posts.push({
      id: `cr-${srl}`,
      source: "ai",
      sourcePlatform: "AI수집",
      tab: board.tab,
      title,
      field: board.field,
      description,
      deadline: deadline || undefined,
      tags,
      requirements: {
        ...(gender && { gender }),
        location: "서울",
      },
      postedAt: dateText || undefined,
    });
  });

  return posts;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Return cache if valid
  if (_cache.data && Date.now() - _cache.ts < CACHE_TTL) {
    return res.status(200).json(_cache.data);
  }

  try {
    const results = await Promise.allSettled(
      BOARDS.map((board) => fetchBoard(board))
    );

    const allPosts = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        allPosts.push(...result.value);
      }
    }

    if (allPosts.length === 0) {
      return res.status(502).json({ error: "No posts fetched from any board" });
    }

    // Sort by postedAt descending
    allPosts.sort((a, b) => {
      if (!a.postedAt || !b.postedAt) return 0;
      return b.postedAt.localeCompare(a.postedAt);
    });

    // Cache the result
    _cache = { data: allPosts, ts: Date.now() };

    return res.status(200).json(allPosts);
  } catch (error) {
    console.error("[matching-feed] Error:", error.message);
    return res.status(500).json({ error: "Failed to fetch matching feed" });
  }
}
