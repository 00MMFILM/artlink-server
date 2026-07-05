// 프로필 생성/수정 — 소유권 토큰 검증 후 service_role로 upsert.
// anon 직접 쓰기를 대체하여 남의 프로필 변조 차단.
import { supabase, checkAppToken, verifyOwnership, cors } from "./_profileLib.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!checkAppToken(req)) return res.status(401).json({ error: "Unauthorized" });

  const { userId, profileToken, profile } = req.body || {};
  if (!userId || !profile) return res.status(400).json({ error: "userId, profile required" });
  if (!verifyOwnership(userId, profileToken)) {
    return res.status(403).json({ error: "ownership verification failed" });
  }

  const p = profile;
  const row = {
    user_id: userId,
    name: p.name || "익명",
    email: p.email || null,
    user_type: p.userType || null,
    fields: p.fields || [],
    gender: p.gender || null,
    birth_date: p.birthDate || null,
    height: p.height || null,
    weight: p.weight || null,
    height_private: p.heightPrivate || false,
    weight_private: p.weightPrivate || false,
    specialties: p.specialties || [],
    school: p.school || null,
    location: p.location || null,
    agency: p.agency || null,
    career: p.career || [],
    bio: p.bio || null,
    role_models: p.roleModels || [],
    interests: p.interests || [],
    photo_url: p.photoUrl || null,
    photos: p.photos || [],
    score: p.score || 0,
    notes_count: p.notesCount || 0,
    streak_days: p.streakDays || 0,
    updated_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase
      .from("artist_profiles")
      .upsert(row, { onConflict: "user_id" });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[profile-sync]", e.message);
    return res.status(500).json({ error: "sync failed" });
  }
}
