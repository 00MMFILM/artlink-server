// B2B 프로필 브라우징 — 서버가 필터·중복제거 후 민감정보(이메일 등) 제거하여 반환.
// anon의 select("*") 이메일 유출을 대체.
import { supabase, checkAppToken, stripSensitive, cors } from "./_profileLib.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!checkAppToken(req)) return res.status(401).json({ error: "Unauthorized" });

  const f = req.body || {};
  try {
    let query = supabase
      .from("artist_profiles")
      .select("*")
      .order("score", { ascending: false })
      .limit(50);

    if (f.gender) query = query.eq("gender", f.gender);
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

    const { data, error } = await query;
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

    // 민감정보 제거 후 반환
    return res.status(200).json({ profiles: deduped.map(stripSensitive) });
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
