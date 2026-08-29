// 종합점수 서버 계산 (2026-08-29)
// 점수를 앱이 계산해 올리던 구조 때문에, 공식을 고쳐도 각자 앱을 업데이트·실행하기 전까지
// 대시보드가 옛 점수로 남고, 구버전 앱이 접속하면 고친 점수를 다시 덮어썼다.
// 서버에 노트가 있는 사용자는 서버가 직접 계산해 신뢰 원천을 서버로 옮긴다.
// 앱 src/services/analyticsService.js의 computeArtistProfile과 동일한 공식.

export function computeScoreFromNotes(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return null;
  const fieldCounts = {}, tagCounts = {};
  let totalContentLength = 0, mediaRecordCount = 0;

  notes.forEach((n) => {
    const f = n.field || "etc";
    fieldCounts[f] = (fieldCounts[f] || 0) + 1;
    (n.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    totalContentLength += (n.content || "").length + (n.transcript || "").length;
    // 서버는 로컬 미디어(사진·음성)를 볼 수 없어 영상분석만 센다 → 앱 계산값보다 보수적
    mediaRecordCount += n.video_analysis ? 1 : 0;
  });

  const aiCount = notes.filter((n) => n.ai_comment).length;
  const noteScore = Math.min(100, notes.length * 5);
  const aiScore = Math.min(100, aiCount * 10);
  const primaryFieldCount = Object.values(fieldCounts).reduce((m, v) => Math.max(m, v), 0);
  const specializationScore = Math.min(100, Math.max(
    Object.keys(fieldCounts).length * 20,
    Object.keys(tagCounts).length * 8,
    primaryFieldCount * 8,
  ));
  const depthScore = Math.min(100, Math.round(totalContentLength / 100) + mediaRecordCount * 5);
  const dates = [...new Set(notes.map((n) => new Date(n.created_at).toDateString()))];
  const consistencyScore = notes.length < 2 ? 0 : Math.min(100, dates.length * 8);

  return Math.round((noteScore + aiScore + specializationScore + depthScore + consistencyScore) / 5);
}

// 사용자의 서버 노트로 점수를 계산한다. 노트가 없으면(비로그인·미동기화) null → 앱 값을 쓴다.
export async function serverScoreFor(supabase, userId) {
  try {
    const { data: user } = await supabase
      .from("users").select("auth_user_id").eq("id", userId).maybeSingle();
    if (!user?.auth_user_id) return null;
    const { data: notes, error } = await supabase
      .from("user_notes")
      .select("field,tags,content,transcript,ai_comment,video_analysis,created_at")
      .eq("auth_user_id", user.auth_user_id)
      .eq("deleted", false)
      .limit(2000);
    if (error) throw error;
    return computeScoreFromNotes(notes);
  } catch (e) {
    console.error("[score] serverScoreFor:", e.message);
    return null; // 계산 실패가 프로필 동기화를 막으면 안 된다
  }
}
