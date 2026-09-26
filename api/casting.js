// 공고 웹 상세 페이지 — GET /casting/:id (vercel.json rewrites → /api/casting?id=:id)
// 앱이 없는 사람도 인스타 스토리·링크로 공고를 열어보고, "어디에 어떻게 지원하는지"를
// 첫 화면에서 바로 알 수 있게 한다. 위쪽 고정 블록 3개 = 출처 / 지원 방법 / 마감.
// 지원처는 postings.contact에 저장된 값만 쓴다 — 추측하거나 사이트 고객센터 주소로 대체하지 않는다.
// 지원처 버튼을 여는 것은 지원 완료가 아니므로 별도 집계를 하지 않는다.
const { createClient } = require("@supabase/supabase-js");
const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 앱(matching-feed)의 sourcePlatform 표기와 맞춘다. 모르는 출처는 원문 값 그대로.
const SOURCE_NAMES = {
  filmmakers: "필름메이커스",
  plfil: "플필",
  castingnara: "캐스팅나라",
  otr: "OTR",
  contestkorea: "콘테스트코리아",
  artnuri: "아트누리",
  artculture: "아트컬처",
  artmore: "아트모어",
  artnet: "아트넷",
  cine21: "씨네21",
};

const APP_LINK = "/app?s=casting";
// 공개 페이지에 필요한 컬럼만 읽는다. 내부 메모·수집 원본·지원 조건 객체는 가져오지 않는다.
const PUBLIC_COLUMNS = "id,source,source_url,title,company,category,description,deadline,pay,location,contact,tags,status";

function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function safeUrl(value) {
  if (typeof value !== "string") return "";
  const candidate = value.trim();
  // URL 파서가 보정하는 역슬래시/제어문자나 복합 문장을 링크로 만들지 않는다.
  if (!/^https?:\/\//i.test(candidate) || /[\s\\<>"'\u0000-\u001f\u007f]/.test(candidate) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(candidate)) return "";
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return "";
    return parsed.href;
  } catch (_) {
    return "";
  }
}

// 단일 ASCII 주소만 직접 연다. mailto 쿼리·헤더·혼합 문장은 원문 확인으로 남긴다.
const EMAIL_RE = /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const PHONE_RE = /^0\d{1,2}-?\d{3,4}-?\d{4}$/;

// URL을 먼저 판정한다. 지원 폼 쿼리 안의 이메일을 mailto로 잘못 해석하면 안 된다.
function resolveApply(contactRaw, sourceUrlRaw) {
  const contact = typeof contactRaw === "string" ? contactRaw.trim() : "";
  const sourceUrl = safeUrl(sourceUrlRaw);

  if (contact) {
    const url = safeUrl(contact);
    if (url) return { kind: "form", value: url, raw: contact };
    const localPart = contact.split("@")[0];
    if (contact.length <= 254 && localPart.length <= 64 && !/(^\.|\.$|\.\.)/.test(localPart) && EMAIL_RE.test(contact)) {
      return { kind: "email", value: contact, raw: contact };
    }
    const compact = contact.replace(/ /g, "");
    if (PHONE_RE.test(compact)) return { kind: "phone", value: compact.replace(/-/g, ""), raw: contact };
    return { kind: "text", value: sourceUrl, raw: contact };
  }

  if (sourceUrl) return { kind: "source", value: sourceUrl, raw: "" };
  return { kind: "none", value: "", raw: "" };
}

// deadline은 'YYYY-MM-DD' 텍스트 컬럼. KST 오늘 기준으로 D-day를 센다.
function resolveDeadline(deadline) {
  const unknown = { label: "마감일 미정", expired: false, date: "" };
  if (typeof deadline !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return unknown;
  const parsed = new Date(`${deadline}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== deadline) return unknown;
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const days = Math.round((parsed.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days < 0) return { label: "마감됨", expired: true, date: deadline };
  if (days === 0) return { label: "오늘 마감", expired: false, date: deadline };
  return { label: `D-${days}`, expired: false, date: deadline };
}

function send(res, statusCode, cacheControl, html) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.end(html);
}

module.exports = async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD");
    return send(res, 405, "no-store", errorPage("지원하지 않는 요청입니다", "공고 링크를 다시 열어주세요."));
  }
  let id = "";
  try {
    const url = new URL(req.url, "http://x");
    // Vercel의 rewrite query와 직접 API 요청 모두 받되, 중복 id는 거절한다.
    if (req.query && Object.prototype.hasOwnProperty.call(req.query, "id")) {
      id = typeof req.query.id === "string" ? req.query.id : "";
    } else if (url.searchParams.getAll("id").length === 1) {
      id = url.searchParams.get("id");
    }
  } catch (_) {}

  // postings.id는 uuid — 숫자 id를 DB에 넘기면 타입 오류(500)가 나므로 여기서 400으로 끊는다.
  if (!UUID_RE.test(id)) {
    return send(res, 400, "no-store", errorPage("잘못된 주소입니다", "공고 주소가 올바르지 않습니다."));
  }
  if (!supabase) {
    return send(res, 503, "no-store", errorPage("잠시 후 다시 열어주세요", "공고를 불러오지 못했습니다."));
  }

  let row = null;
  try {
    const { data, error } = await supabase.from("postings").select(PUBLIC_COLUMNS).eq("id", id).limit(1);
    if (error) throw new Error(error.message);
    row = (data && data[0]) || null;
  } catch (err) {
    console.error("[casting] query failed:", err.message);
    return send(res, 500, "no-store", errorPage("잠시 후 다시 열어주세요", "공고를 불러오지 못했습니다."));
  }

  if (!row) {
    return send(res, 404, "no-store", errorPage("공고를 찾을 수 없습니다", "삭제되었거나 주소가 바뀐 공고입니다."));
  }

  // 수집 중·보류 등 알 수 없는 상태는 공개하지 않는다. 만료/비활성 행의 연락처도 숨긴다.
  if (row.status !== "active" && row.status !== "inactive") {
    return send(res, 404, "no-store", errorPage("공고를 찾을 수 없습니다", "공개 중인 공고가 아닙니다."));
  }
  if (row.status === "inactive" || resolveDeadline(row.deadline).expired) {
    return send(res, 410, "no-store", errorPage("마감된 공고입니다", "마감되었거나 공개가 종료된 공고입니다."));
  }

  // 공개 중이던 공고의 연락처가 종료 후 캐시에서 계속 보이지 않도록 저장하지 않는다.
  return send(res, 200, "no-store", renderPage(row));
};

const STYLE = `
  :root {
    --bg: #07070D;
    --fg: #FAFAFC;
    --fg-dim: rgba(250, 250, 252, 0.62);
    --line: rgba(255, 255, 255, 0.1);
    --panel: rgba(255, 255, 255, 0.05);
    --pink: #FF2D78;
    --violet: #7C5CFF;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { padding: 24px 16px 40px; }
  .wrap { max-width: 520px; margin: 0 auto; }
  .logo-mark { width: 40px; height: 40px; border-radius: 12px; margin-bottom: 20px;
    background: linear-gradient(135deg, var(--pink), var(--violet));
    display: flex; align-items: center; justify-content: center; font-size: 19px; font-weight: 900; }
  h1 { font-size: 21px; font-weight: 700; line-height: 1.35; letter-spacing: -0.01em; margin: 0 0 8px; word-break: keep-all; }
  .meta { color: var(--fg-dim); font-size: 13px; margin: 0 0 20px; }
  .box { background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
    padding: 14px 16px; margin-bottom: 10px; }
  .box .k { font-size: 12px; color: var(--fg-dim); margin-bottom: 8px; }
  .box .v { font-size: 15px; font-weight: 600; word-break: break-all; }
  .badge { display: inline-block; padding: 5px 11px; border-radius: 100px; font-size: 13px; font-weight: 700;
    background: rgba(255, 45, 120, 0.15); color: var(--pink); }
  .badge.off { background: rgba(255, 255, 255, 0.08); color: var(--fg-dim); }
  .notice { background: rgba(255, 45, 120, 0.12); border: 1px solid rgba(255, 45, 120, 0.3);
    border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; font-size: 14px; line-height: 1.5; }
  .notice a { color: var(--pink); }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .btn { display: inline-block; padding: 12px 18px; border-radius: 100px; font-weight: 700; font-size: 14px;
    text-decoration: none; color: var(--bg); background: var(--fg); border: 0; cursor: pointer; }
  .btn.ghost { background: rgba(255, 255, 255, 0.08); color: var(--fg); border: 1px solid var(--line); }
  .btn.block { display: block; width: 100%; text-align: center; margin-bottom: 10px; }
  .body { white-space: pre-wrap; word-break: break-word; font-size: 15px; line-height: 1.65;
    color: rgba(250, 250, 252, 0.88); margin: 24px 0 28px; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }
  .tag { font-size: 12px; color: var(--fg-dim); border: 1px solid var(--line); border-radius: 100px; padding: 4px 10px; }
  .foot { border-top: 1px solid var(--line); padding-top: 22px; }
  .hint { color: var(--fg-dim); font-size: 12px; line-height: 1.6; margin-top: 16px; }
  a.plain { color: var(--fg-dim); }
`;

function shell({ title, description, bodyHtml, ogUrl, script }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="robots" content="noindex">
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="article">${ogUrl ? `\n<meta property="og:url" content="${escapeHtml(ogUrl)}">` : ""}
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <div class="logo-mark">A</div>
${bodyHtml}
</div>${script ? `\n<script>${script}</script>` : ""}
</body>
</html>`;
}

function errorPage(title, message) {
  return shell({
    title,
    description: message,
    ogUrl: "",
    script: "",
    bodyHtml: `  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${escapeHtml(message)}</p>
  <a class="btn" href="${APP_LINK}">아트링크 앱 다운로드</a>`,
  });
}

function applyBlock(apply) {
  const raw = apply.raw ? `<div class="meta" style="margin:10px 0 0">${escapeHtml(apply.raw)}</div>` : "";
  const copy = apply.raw
    ? `<button class="btn ghost" type="button" data-copy="${escapeHtml(apply.raw)}">복사</button>`
    : "";

  if (apply.kind === "email") {
    return `  <div class="box">
    <div class="k">지원 방법</div>
    <div class="row"><a class="btn" href="mailto:${escapeHtml(encodeURIComponent(apply.value).replace(/%40/g, "@"))}">이메일로 지원하기</a>${copy}</div>${raw}
  </div>`;
  }
  if (apply.kind === "phone") {
    return `  <div class="box">
    <div class="k">지원 방법</div>
    <div class="row"><a class="btn" href="tel:${escapeHtml(apply.value)}">전화로 문의하기</a>${copy}</div>${raw}
  </div>`;
  }
  if (apply.kind === "form") {
    return `  <div class="box">
    <div class="k">지원 방법</div>
    <div class="row"><a class="btn" href="${escapeHtml(apply.value)}" target="_blank" rel="noopener noreferrer">지원 폼 열기</a>${copy}</div>${raw}
  </div>`;
  }
  if (apply.kind === "text") {
    return `  <div class="box">
    <div class="k">지원 방법</div>
    <div class="v">${escapeHtml(apply.raw)}</div>
    <div class="row" style="margin-top:12px">${copy}${apply.value ? `<a class="btn" href="${escapeHtml(apply.value)}" target="_blank" rel="noopener noreferrer">원문에서 지원 방법 확인</a>` : ""}</div>
  </div>`;
  }
  if (apply.kind === "source") {
    return `  <div class="box">
    <div class="k">지원 방법</div>
    <div class="row"><a class="btn" href="${escapeHtml(apply.value)}" target="_blank" rel="noopener noreferrer">원문에서 지원 방법 확인</a></div>
  </div>`;
  }
  return `  <div class="box">
    <div class="k">지원 방법</div>
    <span class="badge off">지원 정보 확인 중</span>
  </div>`;
}

function renderPage(row) {
  const sourceUrl = safeUrl(row.source_url);
  const platform = SOURCE_NAMES[row.source] || row.source || "출처 미상";
  const apply = resolveApply(row.contact, row.source_url);
  const deadline = resolveDeadline(row.deadline);

  const description = String(row.description || "").replace(/\s+/g, " ").trim();
  const characters = Array.from(description);
  const excerpt = characters.slice(0, 280).join("") + (characters.length > 280 ? "…" : "");
  const ogDescription = `${platform} · ${deadline.label}${description ? ` · ${characters.slice(0, 100).join("")}` : ""}`;

  const tags = Array.isArray(row.tags) ? row.tags.slice(0, 8) : [];
  const metaLine = [row.company, row.location, row.pay].filter(Boolean).join(" · ");

  const sourceBlock = `  <div class="box">
    <div class="k">출처</div>
    <div class="row">
      <span class="v">${escapeHtml(platform)}</span>
      ${sourceUrl ? `<a class="plain" style="font-size:13px" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">원문 보기 ↗</a>` : ""}
    </div>
  </div>`;

  const deadlineBlock = `  <div class="box">
    <div class="k">마감</div>
    <div class="row">
      <span class="badge">${escapeHtml(deadline.label)}</span>
      ${deadline.date ? `<span class="meta" style="margin:0">${escapeHtml(deadline.date)}</span>` : ""}
    </div>
  </div>`;

  const bodyHtml = `  <h1>${escapeHtml(row.title || "제목 없음")}</h1>
  ${metaLine ? `<p class="meta">${escapeHtml(metaLine)}</p>` : `<p class="meta">${escapeHtml(row.category || "")}</p>`}
${sourceBlock}
${applyBlock(apply)}
${deadlineBlock}
${tags.length ? `  <div class="tags" style="margin-top:16px">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
  <div class="body">${excerpt ? `<div class="k">공고 요약</div>${escapeHtml(excerpt)}` : "자세한 모집 조건은 원문을 확인해 주세요."}</div>
  <div class="foot">
    <a class="btn block" href="${APP_LINK}">아트링크 앱 다운로드</a>
    ${sourceUrl ? `<a class="btn ghost block" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">원문 보기</a>` : ""}
    <p class="hint">모집 조건과 지원 방법은 원문에서 확인해 주세요. 지원 버튼을 열어도 지원이 완료되지는 않습니다.</p>
  </div>`;

  const script = apply.raw
    ? `document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){b.textContent='복사됨';setTimeout(function(){b.textContent='복사';},1500);});});});`
    : "";

  return shell({
    title: `${row.title || "공고"} | 아트링크`,
    description: ogDescription,
    ogUrl: `https://art-link.kr/casting/${row.id}`,
    bodyHtml,
    script,
  });
}
