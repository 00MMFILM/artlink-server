// B2B 프로필 브라우징 — 서버가 필터·중복제거 후 민감정보(이메일 등) 제거하여 반환.
// anon의 select("*") 이메일 유출을 대체.
// 공개 OFF(profile_public=false) 묘비 행은 결과에서 제외한다. 컬럼이 아직 없는 구버전 DB에서는
// 해당 필터만 빼고 기존 동작으로 재조회한다 (migrations/2026-09-23-profile-visibility.sql).
import { supabase, checkAppToken, stripSensitive, cors } from "./_profileLib.js";
import { isMissingColumnError } from "./profile-sync.js";

// 비공개 제외 필터를 뺀 것 외에는 동일한 조회. 컬럼 부재 폴백을 위해 매번 새로 조립한다.
export function buildBrowseQuery(client, f, { excludePrivate }) {
  let query = client
    .from("artist_profiles")
    .select("*")
    .order("score", { ascending: false })
    .limit(50);

  // 공개 OFF는 제외. 마이그레이션이 NOT NULL DEFAULT TRUE라 기존 행은 전부 공개로 남는다.
  // (검색어도 or()를 쓰므로 여기서는 or()를 겹쳐 쓰지 않는다)
  if (excludePrivate) query = query.neq("profile_public", false);
  if (f.gender) query = query.eq("gender", f.gender);
  // 비공개 값을 범위 검색에 사용해도 노출 여부로 값을 추정할 수 있다.
  if (f.heightMin || f.heightMax) query = query.eq("height_private", false);
  if (f.heightMin) query = query.gte("height", Number(f.heightMin));
  if (f.heightMax) query = query.lte("height", Number(f.heightMax));
  if (f.field) query = query.contains("fields", [f.field]);
  if (f.specialties && f.specialties.length > 0) query = query.overlaps("specialties", f.specialties);
  if (f.location) query = query.ilike("location", `%${f.location}%`);
  if (f.search) {
    // PostgREST or() 인젝션 방어: 콤마·괄호·별표 등 구조 문자 제거 후 길이 제한
    const s = String(f.search).replace(/[,()*\\]/g, "").trim().slice(0, 100);
    if (s) query = query.or(`name.ilike.%${s}%,agency.ilike.%${s}%`);
  }
  return query;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!checkAppToken(req)) return res.status(401).json({ error: "Unauthorized" });

  const f = req.body || {};
  try {
    let { data, error } = await buildBrowseQuery(supabase, f, { excludePrivate: true });
    if (error && isMissingColumnError(error)) {
      ({ data, error } = await buildBrowseQuery(supabase, f, { excludePrivate: false }));
    }
    if (error) throw error;

    // ① 가입(로그인) 계정만 노출: auth_user_id 있는 users의 프로필만.
    const { data: authUsers } = await supabase
      .from("users")
      .select("id")
      .not("auth_user_id", "is", null)
      .limit(5000);
    const signedUp = new Set((authUsers || []).map((u) => u.id));

    // ② 품질 필터: 빈 껍데기(이메일·활동·사진 모두 없음) 제외.
    const quality = (data || []).filter((r) => {
      if (!signedUp.has(r.user_id)) return false; // 미가입 게스트 제외
      const hasEmail = !!(r.email && String(r.email).includes("@"));
      const hasActivity = (r.notes_count || 0) > 0;
      const hasPhotos = Array.isArray(r.photos) && r.photos.length > 0;
      return hasEmail || hasActivity || hasPhotos;
    });

    // 중복 제거 (user_id → name), 앱 로직과 동일
    const byUserId = new Map();
    for (const row of quality) {
      if (!row.user_id) continue;
      const ex = byUserId.get(row.user_id);
      if (!ex || (row.updated_at || "") > (ex.updated_at || "")) byUserId.set(row.user_id, row);
    }
    const byName = new Map();
    for (const row of byUserId.values()) {
      const name = (row.name || "").trim();
      if (!name || name === "익명") { byName.set(row.user_id, row); continue; }
      const ex = byName.get(name);
      if (!ex || (row.updated_at || "") > (ex.updated_at || "")) byName.set(name, row);
    }
    let deduped = [...byName.values()];

    // 나이 필터 (birth_date 기반)
    if (f.ageMin || f.ageMax) {
      deduped = deduped.filter((p) => {
        const age = calcAge(p.birth_date);
        if (!age) return false;
        if (f.ageMin && age < Number(f.ageMin)) return false;
        if (f.ageMax && age > Number(f.ageMax)) return false;
        return true;
      });
    }

    // 마일리지·레벨 기본값 보정(마이그레이션 전 컬럼 미존재 시에도 형태 일관) 후 민감정보 제거
    const withMileage = deduped.map((r) => ({
      ...r,
      mileage: r.mileage ?? 0,
      level: r.level ?? 1,
    }));
    return res.status(200).json({ profiles: withMileage.map(stripSensitive) });
  } catch (e) {
    console.error("[artist-browse]", e.message);
    return res.status(500).json({ error: "browse failed" });
  }
}

function calcAge(birthDate) {
  if (!birthDate) return null;
  const parts = String(birthDate).split("-");
  if (parts.length < 3) return null;
  const birth = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age > 0 ? age : null;
}
