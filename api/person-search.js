// 인물 검색 — 롤모델 자유 입력 시 실제 인물을 찾아 자동완성.
// 한국어 위키백과 API 사용 (무료·키 불필요·클라우드 접근 가능).
// 반환: [{ name, description, thumbnail }]
import { checkAppToken, rejectAppToken } from "./_usage.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!checkAppToken(req)) return rejectAppToken(res);

  const q = (req.query && (req.query.q || req.query.query) || "").trim();
  if (!q || q.length < 1) return res.status(200).json({ results: [] });

  try {
    const url =
      "https://ko.wikipedia.org/w/api.php?action=query&generator=search" +
      `&gsrsearch=${encodeURIComponent(q)}&gsrlimit=8` +
      "&prop=pageimages|extracts&exintro=1&explaintext=1&exsentences=1" +
      "&piprop=thumbnail&pithumbsize=120&format=json&origin=*";

    const r = await fetch(url, {
      headers: { "User-Agent": "ArtlinkApp/1.0 (role-model search)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`wiki ${r.status}`);
    const data = await r.json();

    const pages = data?.query?.pages || {};
    const results = Object.values(pages)
      .sort((a, b) => (a.index || 99) - (b.index || 99))
      .map((p) => ({
        name: p.title,
        description: (p.extract || "").slice(0, 80),
        thumbnail: p.thumbnail?.source || null,
      }))
      // 동음이의/목록 페이지 등 잡음 약간 걸러내기 (괄호 설명은 유지)
      .filter((x) => x.name && !/의 (목록|음반|작품 목록|수상)/.test(x.name));

    return res.status(200).json({ results });
  } catch (e) {
    console.error("[person-search]", e.message);
    return res.status(200).json({ results: [] }); // 검색 실패해도 자유입력은 가능
  }
}
