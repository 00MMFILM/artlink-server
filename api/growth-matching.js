import { createClient } from "@supabase/supabase-js";
import { checkAppToken, rejectAppToken } from "./_usage.js";

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

/**
 * 유사 성장 궤적 매칭 API (artlinknote/server에서 이식)
 *
 * POST: { userId, field?, limit? }
 *
 * Returns:
 * - matches: [{ userId, field, similarity, potentialScore, pattern, trajectorySummary, matchType }]
 * - myVector, myPattern, myPotentialScore
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (!checkAppToken(req)) return rejectAppToken(res);

  if (!supabase) {
    return res.status(500).json({ error: "Server configuration error" });
  }

  try {
    const { userId, field, limit = 10 } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // 내 벡터 조회
    let myQuery = supabase.from("growth_vectors").select("*").eq("user_id", userId);
    if (field) myQuery = myQuery.eq("field", field);

    const { data: myVectors, error: myError } = await myQuery;

    if (myError) throw myError;
    if (!myVectors || myVectors.length === 0) {
      return res.status(404).json({
        error: "성장 분석 데이터가 없습니다. 먼저 /api/growth-analysis를 호출하세요.",
      });
    }

    const myVector = myVectors[0];

    // 다른 유저들의 벡터 조회
    let othersQuery = supabase
      .from("growth_vectors")
      .select("*")
      .neq("user_id", userId)
      .gte("notes_count", 2); // 최소 2개 이상 기록 있는 유저만
    if (field) othersQuery = othersQuery.eq("field", field);

    const { data: others, error: othersError } = await othersQuery;

    if (othersError) throw othersError;
    if (!others || others.length === 0) {
      return res.status(200).json({
        matches: [],
        myVector: myVector.vector,
        message: "아직 비교 가능한 다른 아티스트가 없습니다",
      });
    }

    // 코사인 유사도 계산 & 정렬
    const matches = others
      .map((other) => ({
        userId: other.user_id,
        field: other.field,
        similarity: round(cosineSimilarity(myVector.vector, other.vector), 4),
        potentialScore: other.potential_score,
        pattern: other.pattern,
        trajectorySummary: other.trajectory_summary,
        notesCount: other.notes_count,
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    const classified = matches.map((m) => ({
      ...m,
      matchType: classifyMatchType(myVector, m),
    }));

    return res.status(200).json({
      matches: classified,
      myVector: myVector.vector,
      myPattern: myVector.pattern,
      myPotentialScore: myVector.potential_score,
    });
  } catch (err) {
    console.error("[growth-matching] Error:", err.message);
    return res.status(500).json({ error: "Matching failed" });
  }
}

/**
 * 코사인 유사도 — 벡터 첫 요소(분야코드)는 범주형이므로 제외
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

  const a = vecA.slice(1);
  const b = vecB.slice(1);

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * 매칭 유형: peer(동료) / mentor(멘토 후보) / mentee(멘티 후보)
 */
function classifyMatchType(myVector, match) {
  const myScore = myVector.potential_score || 0;
  const theirScore = match.potentialScore || 0;
  const diff = theirScore - myScore;

  if (diff > 15) return { type: "mentor", label: "멘토 후보", description: "나보다 앞선 성장 궤적을 가진 아티스트" };
  if (diff < -15) return { type: "mentee", label: "멘티 후보", description: "유사한 궤적을 따라오는 아티스트" };
  return { type: "peer", label: "동료", description: "비슷한 성장 단계의 아티스트" };
}

function round(n, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
