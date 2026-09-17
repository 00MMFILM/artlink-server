// 요금제별 모델 선택 단위 테스트 — node scripts/test-model-select.js
const { modelParams, paramChain, textOf, isRefusal, MODEL_PREMIUM, MODEL_FREE } = await import("../api/_model.js");
let fail = 0; const ok = (name, cond, extra = "") => { console.log(cond ? "PASS " : "FAIL ", name, extra); if (!cond) fail++; };
const p = modelParams(true), f = modelParams(false);
ok("프리미엄 = opus-5", p.model === "claude-opus-5" && MODEL_PREMIUM === "claude-opus-5");
ok("무료 = sonnet-5", f.model === "claude-sonnet-5" && MODEL_FREE === "claude-sonnet-5");
ok("샘플링 파라미터 없음(400 방지)", !("temperature" in p) && !("top_p" in p) && !("temperature" in f));
ok("thinking adaptive + max_tokens 넉넉", p.thinking.type === "adaptive" && p.max_tokens >= 16000 && f.max_tokens >= 16000);
ok("effort: 프리미엄 medium / 무료 low", p.output_config.effort === "medium" && f.output_config.effort === "low");
ok("프리미엄 체인 = opus → sonnet 폴백", paramChain(true).map((x) => x.model).join(">") === "claude-opus-5>claude-sonnet-5");
ok("무료 체인 = sonnet만", paramChain(false).length === 1);
ok("textOf: thinking 블록이 앞에 와도 text만", textOf({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "📌 가" }, { type: "text", text: "나" }] }) === "📌 가나");
ok("textOf: 빈 응답 안전", textOf(null) === "" && textOf({ content: [] }) === "");
ok("isRefusal", isRefusal({ stop_reason: "refusal" }) && !isRefusal({ stop_reason: "end_turn" }));
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS"); process.exit(fail ? 1 : 0);
