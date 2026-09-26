// api/practice.js (웹→앱 연결 브릿지) + api/track-event.js 신규 이벤트 회귀 테스트
// (외부 네트워크·실 Supabase 없음). 실행: node scripts/test-practice-bridge.js
// - (a) iOS UA → 딥링크 시도 + 앱스토어 폴백
// - (b) Android UA → 플레이 폴백
// - (c) 데스크탑 UA → 두 스토어 버튼(딥링크 시도 없음)
// - (d) XSS: title/content 페이로드가 그대로(비이스케이프) 출력되지 않음
// - (e) field 화이트리스트, source 정규식
// - (f) content 2000자 초과 절단
// - (g) track-event가 신규 이벤트 6개를 200으로 받음(모킹)
import { runInNewContext } from "node:vm";

function emittedDeepLink(html) {
  const decode = (value) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const dataset = Object.fromEntries([...html.matchAll(/data-([a-z-]+)="([^"]*)"/g)]
    .map((m) => [m[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), decode(m[2])]));
  const window = { location: { href: "" } };
  const document = { getElementById: () => ({ dataset }), addEventListener() {} };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { window, document, setTimeout() {}, encodeURIComponent });
  return new URL(window.location.href);
}

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

function mockReq(url, ua) {
  return { method: "GET", url, headers: ua ? { "user-agent": ua } : {} };
}

function mockRes() {
  const r = { statusCode: null, headers: {}, body: null };
  r.setHeader = (k, v) => {
    r.headers[k] = v;
  };
  r.end = (b) => {
    r.body = b;
    return r;
  };
  return r;
}

const UA_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36";
const UA_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

const { default: practiceHandler } = await import("../api/practice.js");

// ── (a) iOS ──────────────────────────────────────────────
{
  const res = mockRes();
  await practiceHandler(
    mockReq("/practice?title=%EB%B0%B0%EC%97%AD&content=%EB%8C%80%EC%82%AC&field=acting&source=actraw", UA_IOS),
    res
  );
  check("(a) 200 응답", res.statusCode === 200, `status=${res.statusCode}`);
  check("(a) Cache-Control: no-store", res.headers["Cache-Control"] === "no-store");
  check("(a) 딥링크 스킴 포함", res.body.includes("artlink://practice?"));
  check("(a) tryDeepLink=true", res.body.includes("var tryDeepLink = true;"));
  check(
    "(a) 앱스토어 폴백 URL 포함",
    res.body.includes('var storeUrl = "https://apps.apple.com/kr/app/id6752890224";')
  );
}

// ── (b) Android ──────────────────────────────────────────
{
  const res = mockRes();
  await practiceHandler(mockReq("/practice?title=T&content=C&field=music&source=bium", UA_ANDROID), res);
  check("(b) 200 응답", res.statusCode === 200);
  check("(b) tryDeepLink=true", res.body.includes("var tryDeepLink = true;"));
  check(
    "(b) 플레이스토어 폴백 URL 포함",
    res.body.includes(
      'var storeUrl = "https://play.google.com/store/apps/details?id=com.mm00.artlink";'
    )
  );
}

// ── (c) 데스크탑 ─────────────────────────────────────────
{
  const res = mockRes();
  await practiceHandler(mockReq("/practice?title=T&content=C", UA_DESKTOP), res);
  check("(c) 200 응답", res.statusCode === 200);
  check("(c) tryDeepLink=false(딥링크 시도 없음)", res.body.includes("var tryDeepLink = false;"));
  check("(c) redirecting 블록 hidden", /id="redirecting"\s+hidden/.test(res.body));
  check("(c) fallback 블록이 보임(hidden 아님)", /id="fallback"\s*>/.test(res.body));
  check("(c) 앱스토어 버튼 포함", res.body.includes("apps.apple.com/kr/app/id6752890224"));
  check(
    "(c) 플레이 버튼 포함",
    res.body.includes("play.google.com/store/apps/details?id=com.mm00.artlink")
  );
}

// ── (d) XSS ──────────────────────────────────────────────
{
  const xssTitle = "</script><script>alert(1)</script>";
  const xssContent = '"onload=alert(1) x="';
  const res = mockRes();
  await practiceHandler(
    mockReq(
      `/practice?title=${encodeURIComponent(xssTitle)}&content=${encodeURIComponent(xssContent)}&field=acting&source=actraw`,
      UA_IOS
    ),
    res
  );
  check("(d) title이 비이스케이프 그대로 출력되지 않음", !res.body.includes(xssTitle));
  check("(d) </script><script> 이스케이프됨", res.body.includes("&lt;/script&gt;&lt;script&gt;"));
  check("(d) content가 비이스케이프 그대로 출력되지 않음", !res.body.includes(xssContent));
  check("(d) 따옴표 이스케이프됨(&quot;)", res.body.includes("&quot;onload="));
}

// ── (e) field 화이트리스트 / source 정규식 ───────────────
{
  const res = mockRes();
  await practiceHandler(mockReq("/practice?title=T&content=C&field=not-a-real-field&source=UPPER!!", UA_IOS), res);
  check("(e) 잘못된 field → acting으로 대체", /data-field="acting"/.test(res.body));
  check("(e) 잘못된 source → external로 대체", /data-source="external"/.test(res.body));

  const res2 = mockRes();
  await practiceHandler(mockReq("/practice?title=T&content=C&field=dance&source=bium-01", UA_IOS), res2);
  check("(e) 유효 field 통과(dance)", /data-field="dance"/.test(res2.body));
  check("(e) 유효 source 통과(bium-01)", /data-source="bium-01"/.test(res2.body));
}

// ── (f) content 2000자 초과 절단 ──────────────────────────
{
  const longContent = "a".repeat(2500);
  const res = mockRes();
  await practiceHandler(
    mockReq(`/practice?title=T&content=${longContent}&field=acting&source=actraw`, UA_IOS),
    res
  );
  const m = res.body.match(/data-content="([^"]*)"/);
  check("(f) data-content 존재", !!m);
  check("(f) 2000자로 절단됨", !!m && m[1].length === 2000, `len=${m ? m[1].length : "?"}`);
}

// ── (g) track-event 신규 이벤트 6개 200 ───────────────────
// ACT RAW 실제 최장 slug(62자)도 이름을 자르지 않고 sceneId(69자)로 이어진다.
{
  const longest = "daehanmingukeseo-geonmulju-doeneun-beop-jangdongcheol-ibanseok";
  const res = mockRes();
  await practiceHandler(mockReq(`/practice?title=Scene&content=Line&field=acting&source=actraw&m=${longest}`, UA_IOS), res);
  const link = emittedDeepLink(res.body);
  check("장면: 실제 최장 ACT RAW ID가 sceneId로 보존됨", link.searchParams.get("sceneId") === `actraw:${longest}`);
  check("장면: 제목/본문/분야/출처는 기존과 동일", ["title", "content", "field", "source"].map((key) => link.searchParams.get(key)).join("|") === "Scene|Line|acting|actraw");
  check("장면: 원래 m 파라미터를 중복 전송하지 않음", !link.searchParams.has("m"));

  const boundary = mockRes();
  await practiceHandler(mockReq(`/practice?source=actraw&m=${"a".repeat(64)}`, UA_IOS), boundary);
  check("장면: 허용 경계 64자 ID는 그대로 전달", emittedDeepLink(boundary.body).searchParams.get("sceneId") === `actraw:${"a".repeat(64)}`);

  for (const bad of ["", "a".repeat(65), "../private", "Hamlet", "a b", "<script>alert(1)</script>", "대본제목"]) {
    const rejected = mockRes();
    await practiceHandler(mockReq(`/practice?title=Kept&source=actraw&m=${encodeURIComponent(bad)}`, UA_IOS), rejected);
    const rejectedLink = emittedDeepLink(rejected.body);
    check(`장면: 부적절한 ID 제외 (${bad.slice(0, 12) || "empty"})`, !rejectedLink.searchParams.has("sceneId") && rejectedLink.searchParams.get("title") === "Kept");
  }
  for (const qs of ["source=actraw", "source=bium&m=hamlet-tobe", "source=actraw&m=hamlet-tobe&m=seagull-nina"]) {
    const rejected = mockRes();
    await practiceHandler(mockReq(`/practice?${qs}`, UA_IOS), rejected);
    check(`장면: 누락·다른 출처·중복 ID 제외 (${qs})`, !emittedDeepLink(rejected.body).searchParams.has("sceneId"));
  }
}

{
  process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
  process.env.SUPABASE_SERVICE_KEY = "test-key";
  globalThis.fetch = async () =>
    new Response(JSON.stringify([{ id: 1 }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const { default: trackEventHandler } = await import("../api/track-event.js");

  function mockTrackRes() {
    const r = { code: null, body: null };
    r.setHeader = () => {};
    r.status = (c) => {
      r.code = c;
      return r;
    };
    r.json = (b) => {
      r.body = b;
      return r;
    };
    r.end = () => r;
    return r;
  }

  const newEvents = [
    "deeplink_actraw",
    "deeplink_bium",
    "deeplink_external",
    "focus_selected",
    "repractice_started",
    "duet_to_note",
  ];

  for (const event of newEvents) {
    const res = mockTrackRes();
    await trackEventHandler(
      { method: "POST", headers: {}, body: { deviceId: "dev-test", event } },
      res
    );
    check(`(g) ${event} → 200`, res.code === 200 && res.body.success === true, JSON.stringify(res.body));
  }
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
