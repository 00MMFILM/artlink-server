// 동의 기반 학습자산 보관 공통 모듈 (2026-08-27)
// - 수집 기본 중단. 명시적 활성화 + 요청 헤더 X-Data-Consent: 1일 때만 보관
// - 동의 시에만 앱이 올린 원본(음성/영상/사진)을 private 버킷 media-archive로 복사·업로드
//   + media_assets 테이블에 메타 행 적재 (storage_path 기준 upsert)
// - 철회 시: 유저 프리픽스 객체 + media_assets 행 삭제
// 모든 storage/DB 접근은 service key + REST fetch로 처리 (테스트 mock 단순화, SDK 의존 최소화).
// 관련: schema-media-assets.sql (media_assets 테이블·RLS), schema-data-assets.sql (버킷 정의)
import crypto from "crypto";

const ARCHIVE_BUCKET = "media-archive";
const TEMP_BUCKET = "temp-media";
export const PHOTO_MAX_PER_NOTE = 8; // 노트당 첨부 사진 보관 상한 (초과분은 로그만)

const base = () => process.env.SUPABASE_URL;
const key = () => process.env.SUPABASE_SERVICE_KEY;

// 전역 수집 허용과 요청의 동의 신호를 함께 판정한다.
export function hasDataConsent(req) {
  // 소유자·서버 동의 철회 계약을 갖추기 전 신규 원본 수집은 기본 중단한다.
  // 기존 원본의 철회 경로는 이 플래그와 무관하게 계속 동작한다.
  return process.env.ARCHIVE_COLLECTION_ENABLED === "true" && req.headers["x-data-consent"] === "1";
}

// 노트 제목 → 짧은 해시 (원문 저장 없이 동일 노트 묶기용). 없으면 null.
export function titleHash(title) {
  if (!title || typeof title !== "string") return null;
  return crypto.createHash("sha256").update(title).digest("hex").slice(0, 16);
}

function authHeaders(extra = {}) {
  const k = key();
  return { apikey: k, Authorization: `Bearer ${k}`, ...extra };
}

// temp-media의 원본 URL → media-archive로 복사. 성공 시 { storagePath }, 아니면 null.
// 같은 destinationKey 재복사(중복)는 idempotent 성공으로 간주(덮어쓰기 OK).
export async function copyTempToArchive(videoUrl, userId) {
  const b = base();
  if (!b || !key() || typeof videoUrl !== "string" || !videoUrl.startsWith(b)) return null;
  const marker = `/${TEMP_BUCKET}/`;
  const i = videoUrl.indexOf(marker);
  if (i === -1) return null;
  const sourceKey = decodeURIComponent(videoUrl.slice(i + marker.length));
  const destinationKey = `${userId || "anon"}/${sourceKey}`;
  try {
    const r = await fetch(`${b}/storage/v1/object/copy`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        bucketId: TEMP_BUCKET,
        sourceKey,
        destinationBucket: ARCHIVE_BUCKET,
        destinationKey,
      }),
    });
    if (r.ok) return { storagePath: destinationKey };
    const text = await r.text();
    // 이미 존재 → 이미 보관됨 → idempotent 성공
    if (r.status === 409 || /exist|duplicate/i.test(text)) return { storagePath: destinationKey };
    console.error("[archive] copy failed:", r.status, text);
    return null;
  } catch (e) {
    console.error("[archive] copy error:", e.message);
    return null;
  }
}

// base64 JPEG → media-archive 업로드 (private). 성공 시 { storagePath }, 아니면 null.
export async function uploadPhotoToArchive(base64, userId, keyHint) {
  const b = base();
  if (!b || !key() || typeof base64 !== "string" || base64.length < 8) return null;
  const destinationKey = `${userId || "anon"}/photos/${keyHint}.jpg`;
  try {
    const bytes = Buffer.from(base64, "base64");
    const r = await fetch(`${b}/storage/v1/object/${ARCHIVE_BUCKET}/${encodeURI(destinationKey)}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "image/jpeg", "x-upsert": "true" }),
      body: bytes,
    });
    if (!r.ok) {
      console.error("[archive] photo upload failed:", r.status, await r.text());
      return null;
    }
    return { storagePath: destinationKey };
  } catch (e) {
    console.error("[archive] photo upload error:", e.message);
    return null;
  }
}

// media_assets 행 upsert (storage_path 기준 병합 — 같은 객체 재기록 시 최신값으로 갱신).
export async function upsertMediaAsset(row) {
  const b = base();
  if (!b || !key() || !row || !row.storage_path) return;
  try {
    const r = await fetch(`${b}/rest/v1/media_assets?on_conflict=storage_path`, {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify({
        user_id: row.user_id || "anon",
        note_local_id: row.note_local_id ?? null,
        field: row.field ?? null,
        title_hash: row.title_hash ?? null,
        kind: row.kind,
        storage_path: row.storage_path,
        consent_at: row.consent_at || new Date().toISOString(),
        ai_scores: row.ai_scores ?? null,
      }),
    });
    if (!r.ok) console.error("[archive] media_assets upsert failed:", r.status, await r.text());
  } catch (e) {
    console.error("[archive] media_assets upsert error:", e.message);
  }
}

// 첨부 사진 배열 보관 — 상한(PHOTO_MAX_PER_NOTE)까지만, 초과분은 로그. 보관된 개수 반환.
export async function archivePhotos(frames, meta = {}) {
  if (!Array.isArray(frames) || frames.length === 0) return 0;
  const take = frames.slice(0, PHOTO_MAX_PER_NOTE);
  if (frames.length > PHOTO_MAX_PER_NOTE) {
    console.log(
      `[archive] photo cap: note=${meta.noteLocalId || "?"} frames=${frames.length} archiving=${PHOTO_MAX_PER_NOTE}`
    );
  }
  const idBase = meta.noteLocalId || crypto.randomUUID().slice(0, 8);
  let n = 0;
  for (let i = 0; i < take.length; i++) {
    const up = await uploadPhotoToArchive(take[i], meta.userId, `${idBase}-${i}`);
    if (!up) continue;
    await upsertMediaAsset({
      user_id: meta.userId || "anon",
      note_local_id: meta.noteLocalId || null,
      field: meta.field || null,
      title_hash: meta.titleHash || null,
      kind: "photo",
      storage_path: up.storagePath,
      consent_at: new Date().toISOString(),
    });
    n++;
  }
  return n;
}

// media-archive에서 userId 프리픽스의 모든 객체 키를 재귀 나열.
async function listAllKeys(prefix) {
  const b = base();
  const keys = [];
  async function walk(pfx) {
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const r = await fetch(`${b}/storage/v1/object/list/${ARCHIVE_BUCKET}`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prefix: pfx, limit: pageSize, offset, sortBy: { column: "name", order: "asc" } }),
      });
      if (!r.ok) throw new Error(`archive_list_failed:${r.status}`);
      const items = await r.json();
      if (!Array.isArray(items)) throw new Error("archive_list_invalid");
      for (const it of items) {
        const full = pfx + it.name;
        if (it.id) keys.push(full); // 파일
        else await walk(full + "/"); // 폴더 → 재귀
      }
      if (items.length < pageSize) break;
    }
  }
  await walk(prefix.endsWith("/") ? prefix : prefix + "/");
  return keys;
}

// 동의 철회 — 해당 유저의 media-archive 객체 + media_assets 행 삭제.
// 실패하면 완료를 반환하지 않는다. 원본 삭제가 확인된 뒤에만 메타 행을 지운다.
export async function withdrawUserArchive(userId) {
  const b = base();
  let deleted = 0;
  if (!b || !key() || !userId || userId === "anon") throw new Error("archive_owner_or_config_missing");

  // 1) storage 객체 일괄 삭제
  const keys = await listAllKeys(`${userId}/`);
  for (let offset = 0; offset < keys.length; offset += 1000) {
    const batch = keys.slice(offset, offset + 1000);
    const r = await fetch(`${b}/storage/v1/object/${ARCHIVE_BUCKET}`, {
      method: "DELETE",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: batch }),
    });
    if (!r.ok) throw new Error(`archive_delete_failed:${r.status}`);
    deleted += batch.length;
  }

  // 성공 응답을 받았어도 파일이 남거나 지연된 업로드가 도착했다면 재시도가 필요하다.
  if ((await listAllKeys(`${userId}/`)).length) throw new Error("archive_files_remaining");

  // 2) 원본 삭제 확인 후 media_assets 행 삭제. 실패하면 다음 요청에서 재시도할 수 있다.
  const r = await fetch(`${b}/rest/v1/media_assets?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: authHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
  });
  if (!r.ok) throw new Error(`archive_rows_delete_failed:${r.status}`);

  return { deleted };
}
