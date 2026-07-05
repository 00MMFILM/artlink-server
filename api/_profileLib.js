// 프로필 서버 경유 공통 로직 — 소유권 HMAC 토큰 + service_role 클라이언트.
// 목적: anon 키로 남의 프로필을 조회(이메일)·수정·삭제하던 것을 서버가 소유권 검증 후 대행.
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const APP_TOKEN = process.env.APP_SECRET || "";
const PROFILE_SECRET = process.env.PROFILE_SECRET || "";

// 앱 토큰 검증 (기본 게이트)
export function checkAppToken(req) {
  const t = req.headers["x-app-token"] || "";
  if (!APP_TOKEN) return true; // 미설정 시 통과(개발)
  return typeof t === "string" && t.length > 0 && timingSafeEq(t, APP_TOKEN);
}

// userId에 대한 소유권 토큰 = HMAC_SHA256(PROFILE_SECRET, userId)
export function makeProfileToken(userId) {
  return crypto.createHmac("sha256", PROFILE_SECRET).update(String(userId)).digest("hex");
}

// 요청의 profileToken이 userId의 정당한 소유자인지 검증
export function verifyOwnership(userId, profileToken) {
  if (!userId || !profileToken || !PROFILE_SECRET) return false;
  const expected = makeProfileToken(userId);
  return timingSafeEq(String(profileToken), expected);
}

function timingSafeEq(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token");
}

// 공개 브라우징에서 제거할 민감 컬럼 (이메일 등 연락처 PII)
export const SENSITIVE_COLS = ["email", "agency"];

export function stripSensitive(row) {
  if (!row) return row;
  const out = { ...row };
  for (const c of SENSITIVE_COLS) delete out[c];
  return out;
}
