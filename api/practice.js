// 웹→앱 연결 브릿지 페이지 — GET /practice
// ACT RAW(actraw.kr) 독백 페이지 등 외부 사이트의 버튼이
// https://art-link.kr/practice?title=..&content=..&field=..&source=..&m=.. 로 들어온다.
// 이 페이지는 앱 딥링크(artlink://practice?...)로 즉시 이동을 시도하고,
// 1.5초 뒤에도 화면이 그대로면(앱 미설치) 스토어로 보낸다. ACT RAW의 `m`은 sceneId로 넘긴다.
// 표준어 연습은 사용자가 앱 열기를 누른다. 설치 후 돌아와 같은 대사를 열 수 있게
// 페이지를 유지한다. DB 기록 없음 — 순수 브릿지 페이지.

const APPSTORE = "https://apps.apple.com/kr/app/id6752890224";
const PLAY = "https://play.google.com/store/apps/details?id=com.mm00.artlink";

const FIELD_WHITELIST = new Set(["acting", "music", "art", "dance", "literature", "film"]);
const SOURCE_RE = /^[a-z0-9_-]{1,20}$/;
// ACT RAW data.js의 MONOLOGUES는 소문자 영숫자/하이픈/밑줄 ID를 사용한다.
// 제목을 식별자로 삼거나 긴 ID를 잘라 다른 장면과 충돌시키지 않는다.
const ACTRAW_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

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
  const monologueId = params.getAll("m").length === 1 ? params.get("m") : null;
  const sceneId = source === "actraw" && typeof monologueId === "string" && ACTRAW_ID_RE.test(monologueId)
    ? `actraw:${monologueId}` : "";
  const mode = params.getAll("mode").length === 1 && params.get("mode") === "standard_speech"
    && params.getAll("source").length === 1 && source === "actraw" && sceneId && field === "acting"
    ? "standard_speech" : "";

  const title = truncate(params.get("title") || "", TITLE_MAX);
  const content = truncate(params.get("content") || "", CONTENT_MAX);

  const titleSafe = escapeHtml(title);
  const contentSafe = escapeHtml(content);
  const titlePreview = title ? escapeHtml(title.slice(0, 60)) : "";

  const storeUrl = platform === "android" ? PLAY : APPSTORE;
  const tryDeepLink = platform === "ios" || platform === "android";
  const appParams = new URLSearchParams({ title, content, field, source });
  if (sceneId) appParams.set("sceneId", sceneId);
  if (mode) appParams.set("mode", mode);
  const appLink = `artlink://practice?${appParams.toString()}`;

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(renderHtml({ titleSafe, contentSafe, titlePreview, field, source, sceneId, mode, appLink, storeUrl, tryDeepLink }));
};

function renderHtml({ titleSafe, contentSafe, titlePreview, field, source, sceneId, mode, appLink, storeUrl, tryDeepLink }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    min-height: 100%;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  body {
    min-height: 100vh;
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
    line-height: 1.6;
  }
  .secondary { background: transparent; color: var(--fg); border: 1px solid var(--line); }
  .back { display: inline-block; margin-top: 12px; color: var(--fg-dim); font-size: 14px; }
  a:focus-visible { outline: 3px solid var(--pink); outline-offset: 4px; }
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
    ${mode ? `<div id="speech-handoff">
      <h1>같은 대사로<br>표준어 연습을 이어가세요</h1>
      <p class="sub">아트링크에서 대사를 듣고, 새로 녹음하고, 연습 기록을 남길 수 있어요.</p>
      <a class="btn" id="open-practice" href="${escapeHtml(appLink)}">아트링크에서 이 대사 열기</a>
      <p class="hint">앱이 없다면 아래에서 설치한 뒤 <strong>이 페이지로 돌아와 위 버튼을 다시 눌러주세요.</strong></p>
      <a class="btn secondary" href="${APPSTORE}">App Store에서 설치</a>
      <a class="btn secondary" href="${PLAY}">Google Play에서 설치</a>
      <p class="hint">ACT RAW에서 녹음한 파일은 자동으로 옮겨지지 않습니다.<br>기기 음성은 참고용이며 자동 사투리·억양 채점은 제공하지 않습니다.<br>전용 연습 카드가 보이지 않으면 앱을 업데이트해 주세요.</p>
      <a class="back" href="https://actraw.kr/standard-speech">ACT RAW 표준어 연습으로 돌아가기</a>
    </div>` : ""}
    <div id="redirecting" ${tryDeepLink && !mode ? "" : "hidden"}>
      <div class="spinner"></div>
      <h1>아트링크 앱을 여는 중...</h1>
      <p class="sub">앱이 설치되어 있지 않다면 잠시 후 스토어로 이동합니다.</p>
    </div>
    <div id="fallback" ${tryDeepLink || mode ? "hidden" : ""}>
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
    data-scene-id="${escapeHtml(sceneId)}"
    data-mode="${escapeHtml(mode)}"
  ></div>
<script>
(function () {
  var tryDeepLink = ${tryDeepLink ? "true" : "false"};
  if (!tryDeepLink) return;

  var d = document.getElementById('practice-data').dataset;
  // This mode has a server-rendered explicit link; never force the user into a store.
  if (d.mode === 'standard_speech') return;
  var qs = 'title=' + encodeURIComponent(d.title)
    + '&content=' + encodeURIComponent(d.content)
    + '&field=' + encodeURIComponent(d.field)
    + '&source=' + encodeURIComponent(d.source);
  if (d.sceneId) qs += '&sceneId=' + encodeURIComponent(d.sceneId);
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
