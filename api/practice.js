// 웹→앱 연결 브릿지 페이지 — GET /practice
// ACT RAW(actraw.kr) 독백 페이지 등 외부 사이트의 버튼이
// https://art-link.kr/practice?title=..&content=..&field=..&source=..&m=.. 로 들어온다.
// 이 페이지는 앱 딥링크(artlink://practice?...)로 즉시 이동을 시도하고,
// 1.5초 뒤에도 화면이 그대로면(앱 미설치) 스토어로 보낸다. `m`은 앱에 넘기지 않는다.
// DB 기록 없음 — 순수 브릿지 페이지.

const APPSTORE = "https://apps.apple.com/kr/app/id6752890224";
const PLAY = "https://play.google.com/store/apps/details?id=com.mm00.artlink";

const FIELD_WHITELIST = new Set(["acting", "music", "art", "dance", "literature", "film"]);
const SOURCE_RE = /^[a-z0-9_-]{1,20}$/;

const TITLE_MAX = 120;
const CONTENT_MAX = 2000;

// HTML 텍스트/속성 컨텍스트에 값 삽입 시 이스케이프 (XSS 방지)
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => {
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

function truncate(str, max) {
  return typeof str === "string" ? str.slice(0, max) : "";
}

module.exports = async (req, res) => {
  const ua = req.headers["user-agent"] || "";
  const platform = /android/i.test(ua)
    ? "android"
    : /iphone|ipad|ipod/i.test(ua)
    ? "ios"
    : "desktop";

  let params;
  try {
    params = new URL(req.url, "http://x").searchParams;
  } catch (_) {
    params = new URLSearchParams();
  }

  const rawField = (params.get("field") || "").toLowerCase();
  const field = FIELD_WHITELIST.has(rawField) ? rawField : "acting";

  const rawSource = params.get("source") || "";
  const source = SOURCE_RE.test(rawSource) ? rawSource : "external";

  const title = truncate(params.get("title") || "", TITLE_MAX);
  const content = truncate(params.get("content") || "", CONTENT_MAX);

  const titleSafe = escapeHtml(title);
  const contentSafe = escapeHtml(content);
  const titlePreview = title ? escapeHtml(title.slice(0, 60)) : "";

  const storeUrl = platform === "android" ? PLAY : APPSTORE;
  const tryDeepLink = platform === "ios" || platform === "android";

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(renderHtml({ titleSafe, contentSafe, titlePreview, field, source, storeUrl, tryDeepLink }));
};

function renderHtml({ titleSafe, contentSafe, titlePreview, field, source, storeUrl, tryDeepLink }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>아트링크로 이어서 연습하기</title>
<meta name="robots" content="noindex">
<style>
  :root {
    --bg: #07070D;
    --fg: #FAFAFC;
    --fg-dim: rgba(250, 250, 252, 0.62);
    --line: rgba(255, 255, 255, 0.1);
    --pink: #FF2D78;
    --violet: #7C5CFF;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    height: 100%;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 420px;
    text-align: center;
  }
  .logo-mark {
    width: 56px; height: 56px;
    margin: 0 auto 24px;
    border-radius: 16px;
    background: linear-gradient(135deg, var(--pink), var(--violet));
    display: flex; align-items: center; justify-content: center;
    font-size: 26px; font-weight: 900;
    box-shadow: 0 12px 32px -8px rgba(255, 45, 120, 0.5);
  }
  h1 {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0 0 12px;
  }
  p.sub {
    color: var(--fg-dim);
    font-size: 14px;
    line-height: 1.5;
    margin: 0 0 28px;
  }
  .preview {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 14px 16px;
    margin: 0 0 28px;
    text-align: left;
    font-size: 13px;
    color: var(--fg-dim);
    word-break: break-word;
  }
  .preview strong { color: var(--fg); display: block; margin-bottom: 4px; }
  .spinner {
    width: 28px; height: 28px;
    margin: 0 auto 20px;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.15);
    border-top-color: var(--pink);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .btn {
    display: block;
    width: 100%;
    padding: 15px 20px;
    border-radius: 100px;
    font-weight: 700;
    font-size: 15px;
    text-decoration: none;
    color: var(--bg);
    background: var(--fg);
    margin-bottom: 12px;
  }
  .hint {
    color: var(--fg-dim);
    font-size: 13px;
    margin-top: 20px;
  }
  [hidden] { display: none !important; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo-mark">A</div>
    ${
      titlePreview
        ? `<div class="preview"><strong>${titlePreview}</strong>${contentSafe ? "대사를 아트링크로 불러옵니다" : ""}</div>`
        : ""
    }
    <div id="redirecting" ${tryDeepLink ? "" : "hidden"}>
      <div class="spinner"></div>
      <h1>아트링크 앱을 여는 중...</h1>
      <p class="sub">앱이 설치되어 있지 않다면 잠시 후 스토어로 이동합니다.</p>
    </div>
    <div id="fallback" ${tryDeepLink ? "hidden" : ""}>
      <h1>아트링크에서 이어서 연습하기</h1>
      <p class="sub">휴대폰으로 이 링크를 열면 앱에서 바로 대사를 불러올 수 있어요.</p>
      <a class="btn" href="https://apps.apple.com/kr/app/id6752890224">App Store에서 열기</a>
      <a class="btn" href="https://play.google.com/store/apps/details?id=com.mm00.artlink" style="background: rgba(255,255,255,0.08); color: var(--fg); border: 1px solid var(--line);">Google Play에서 열기</a>
      <p class="hint">휴대폰에서 이 링크를 다시 열어주세요.</p>
    </div>
  </div>
  <div hidden aria-hidden="true"
    id="practice-data"
    data-title="${titleSafe}"
    data-content="${contentSafe}"
    data-field="${escapeHtml(field)}"
    data-source="${escapeHtml(source)}"
  ></div>
<script>
(function () {
  var tryDeepLink = ${tryDeepLink ? "true" : "false"};
  if (!tryDeepLink) return;

  var d = document.getElementById('practice-data').dataset;
  var qs = 'title=' + encodeURIComponent(d.title)
    + '&content=' + encodeURIComponent(d.content)
    + '&field=' + encodeURIComponent(d.field)
    + '&source=' + encodeURIComponent(d.source);
  var deepLink = 'artlink://practice?' + qs;
  var storeUrl = ${JSON.stringify(storeUrl)};

  var hidden = false;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) hidden = true;
  });

  window.location.href = deepLink;

  setTimeout(function () {
    if (hidden) return;
    document.getElementById('redirecting').hidden = true;
    document.getElementById('fallback').hidden = false;
    window.location.href = storeUrl;
  }, 1500);
})();
</script>
</body>
</html>`;
}
