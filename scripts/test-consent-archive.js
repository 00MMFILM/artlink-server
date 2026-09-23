// 동의 기반 학습자산 보관 회귀 테스트 (외부 네트워크·실 Supabase 없음 — globalThis.fetch mock).
// 실행: node scripts/test-consent-archive.js
//
// analyze-video / ai-analyze 핸들러를 실제로 구동해 검증한다. (transcribe는 ffmpeg 서브프로세스가
// 실 미디어+네트워크를 요구해 오프라인 구동 불가 — 단 transcribe는 여기서 검증되는 동일한 공유
// 헬퍼 hasDataConsent/copyTempToArchive/upsertMediaAsset를 그대로 쓰므로 보관 로직은 커버된다.)
//
// 보관은 AI 생성 호출 이전에 동의 게이트로 실행된다. Anthropic SDK의 create도 별도로
// 대체하여 자체 fetch가 전역 mock을 우회하는 버전에서도 외부 요청을 하지 않는다.
//
// (a) X-Data-Consent 없음 → 원본 복사(copy) 미호출 + media_assets 미적재
// (b) X-Data-Consent == '1' → copy 호출 + media_assets(kind=video) upsert
// (c) analyze-video: 전사(transcript) 없이(무음 가정) + gemini 미설정에도 동의 시 video 보관
// (d) ai-analyze: 동의 + frames(사진) → photo 업로드 + media_assets(kind=photo)
// (e) ai-analyze: frames 다수(10장) → 상한 8장까지만 보관
// (f) ai-analyze: 미동의면 frames 있어도 사진 보관 안 함
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.APP_SECRET = "";
process.env.ARCHIVE_COLLECTION_ENABLED = "true"; // 과거 보관 경로의 회귀 검사에만 명시 활성화
delete process.env.GEMINI_API_KEY; // gemini 경로 스킵 → 프레임 경로

const Anthropic = (await import("@anthropic-ai/sdk")).default;
Anthropic.Messages.prototype.create = async (params) => ({
  model: params.model,
  content: [{ type: "text", text: "📌 합성 테스트 분석 결과입니다. 실제 사용자 기록은 사용하지 않습니다." }],
  stop_reason: "end_turn", usage: {},
});

const SUPA = process.env.SUPABASE_URL;
const VIDEO_URL = `${SUPA}/storage/v1/object/public/temp-media/u-1/rec123.mp4`;

const state = {
  calls: [],
  copyCalls: [],
  assetUpserts: [],
  photoUploads: [],
  authUser: { id: "u-1", aud: "authenticated" },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || "GET").toUpperCase();
  state.calls.push(`${method} ${u}`);

  if (u.includes("/auth/v1/user")) {
    return state.authUser ? json(state.authUser) : json({ message: "invalid JWT" }, 401);
  }
  if (u.includes("/v1/messages")) {
    return json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "📌 좋은 분석입니다. 계속 발전하고 있어요." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  }
  if (u.includes("/storage/v1/object/copy")) {
    state.copyCalls.push(JSON.parse(init.body));
    return json({ Key: "media-archive/x" });
  }
  if (u.includes("/storage/v1/object/media-archive/")) {
    state.photoUploads.push(decodeURI(u.split("/object/media-archive/")[1]));
    return json({ Key: "media-archive/x" });
  }
  if (u.includes("/rest/v1/media_assets")) {
    if (method === "POST") state.assetUpserts.push(JSON.parse(init.body));
    return json([], method === "POST" ? 201 : 200);
  }
  return json([]); // 기타 rest(쿼터 조회/소비 등)
};

const { default: analyzeVideo } = await import("../api/analyze-video.js");
const { default: aiAnalyze } = await import("../api/ai-analyze.js");

function mockRes() {
  const r = { code: null, body: null };
  r.setHeader = () => {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.write = () => {};
  r.end = () => r;
  return r;
}

function reset() {
  state.calls = [];
  state.copyCalls = [];
  state.assetUpserts = [];
  state.photoUploads = [];
}

async function run(handler, { consent, body }) {
  reset();
  const headers = { authorization: "Bearer faketoken" };
  if (consent) headers["x-data-consent"] = "1";
  const res = mockRes();
  // 합성 AI 응답 로그 소음 억제 — 보관은 그 전에 이미 실행됨
  const origLog = console.log, origErr = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    await handler({ method: "POST", headers, body, query: {} }, res);
  } finally {
    console.log = origLog; console.error = origErr;
  }
  return res;
}

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

const IMG = "QUJDREVGR0g="; // ≥8자 유효 base64 (사진 프레임 스텁)
const baseVideoBody = { prompt: "오늘 연습", field: "acting", noteTitle: "독백", frames: [IMG], videoUrl: VIDEO_URL };

// (a) 미동의 → 보관 안 함
let res = await run(analyzeVideo, { consent: false, body: { ...baseVideoBody, transcript: "안녕" } });
check("(a) copy 미호출", state.copyCalls.length === 0, `copy=${state.copyCalls.length}`);
check("(a) media_assets 미적재", state.assetUpserts.length === 0, `upsert=${state.assetUpserts.length}`);

// (b) 동의 → copy + media_assets(kind=video)
res = await run(analyzeVideo, { consent: true, body: { ...baseVideoBody, transcript: "안녕" } });
check("(b) copy 1회 호출", state.copyCalls.length === 1, `copy=${state.copyCalls.length}`);
check("(b) copy destinationBucket=media-archive", state.copyCalls[0]?.destinationBucket === "media-archive");
check("(b) copy destinationKey=u-1/u-1/rec123.mp4", state.copyCalls[0]?.destinationKey === "u-1/u-1/rec123.mp4", state.copyCalls[0]?.destinationKey);
check("(b) media_assets upsert 1건", state.assetUpserts.length === 1, `upsert=${state.assetUpserts.length}`);
check("(b) kind=video", state.assetUpserts[0]?.kind === "video");
check("(b) storage_path 일치", state.assetUpserts[0]?.storage_path === "u-1/u-1/rec123.mp4");
check("(b) user_id=u-1", state.assetUpserts[0]?.user_id === "u-1");
check("(b) field=acting", state.assetUpserts[0]?.field === "acting");
check("(b) title_hash 존재(원문 아님)", typeof state.assetUpserts[0]?.title_hash === "string" && state.assetUpserts[0].title_hash !== "독백");
check("(b) consent_at 존재", !!state.assetUpserts[0]?.consent_at);

// (c) 무음(전사 없음) + gemini 미설정에도 동의 시 video 보관
res = await run(analyzeVideo, { consent: true, body: { ...baseVideoBody, transcript: undefined } });
check("(c) 전사 없이도 copy 호출", state.copyCalls.length === 1, `copy=${state.copyCalls.length}`);
check("(c) 전사 없이도 video 보관", state.assetUpserts[0]?.kind === "video");

// (d) ai-analyze: 동의 + 사진 3장 → photo 3건
res = await run(aiAnalyze, {
  consent: true,
  body: { prompt: "그림 피드백", field: "art", noteTitle: "수채화", noteLocalId: "note-9", frames: [IMG, IMG, IMG] },
});
check("(d) 사진 업로드 3건", state.photoUploads.length === 3, `uploads=${state.photoUploads.length}`);
const photoAssets = state.assetUpserts.filter((a) => a.kind === "photo");
check("(d) media_assets photo 3건", photoAssets.length === 3, `photo=${photoAssets.length}`);
check("(d) 사진 storage_path=u-1/photos/note-9-0.jpg", state.photoUploads.includes("u-1/photos/note-9-0.jpg"), state.photoUploads.join(","));
check("(d) photo 행 note_local_id 연결", photoAssets[0]?.note_local_id === "note-9");

// (e) 상한 8장
res = await run(aiAnalyze, {
  consent: true,
  body: { prompt: "많은 사진", field: "art", noteTitle: "연작", noteLocalId: "note-big", frames: Array.from({ length: 10 }, () => IMG) },
});
check("(e) 10장 중 8장만 보관", state.photoUploads.length === 8, `uploads=${state.photoUploads.length}`);

// (f) 미동의면 사진 보관 안 함
res = await run(aiAnalyze, {
  consent: false,
  body: { prompt: "그림", field: "art", noteTitle: "x", noteLocalId: "note-z", frames: [IMG, IMG] },
});
check("(f) 미동의 사진 업로드 0건", state.photoUploads.length === 0, `uploads=${state.photoUploads.length}`);
check("(f) 미동의 photo 행 0건", state.assetUpserts.filter((a) => a.kind === "photo").length === 0);

delete process.env.ARCHIVE_COLLECTION_ENABLED;
await run(analyzeVideo, { consent: true, body: baseVideoBody });
check("(g) 기본 수집 중단: 구버전 동의 헤더가 있어도 영상 보관 없음", state.copyCalls.length === 0 && state.assetUpserts.length === 0);
await run(aiAnalyze, { consent: true, body: { prompt: "합성 사진", frames: [IMG] } });
check("(g) 기본 수집 중단: 동의 사진도 보관 없음", state.photoUploads.length === 0 && state.assetUpserts.length === 0);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
