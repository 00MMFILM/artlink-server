// 생년월일을 "YYYY-MM-DD"로 맞춘다. 못 읽으면 null. (앱 src/utils/helpers.js normalizeBirthDate와 같은 규칙)
// 앱 입력 칸이 자유 입력이라 저장값이 20010119·2009.04.12·010611·14-05-1997처럼 제각각이다(2026-10-07 실측 29건).
export function normalizeBirthDate(input, now = new Date()) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  let y, m, d;
  if (/^\d{8}$/.test(raw)) [y, m, d] = [raw.slice(0, 4), raw.slice(4, 6), raw.slice(6, 8)];
  else if (/^\d{6}$/.test(raw)) {
    const yy = Number(raw.slice(0, 2));
    y = String((yy > now.getFullYear() % 100 ? 1900 : 2000) + yy);
    [m, d] = [raw.slice(2, 4), raw.slice(4, 6)];
  } else {
    const parts = raw.split(/[^0-9]+/).filter(Boolean);
    if (parts.length !== 3) return null;
    if (parts[0].length === 4) [y, m, d] = parts;
    else if (parts[2].length === 4) [d, m, y] = parts;
    else return null;
  }
  const [yn, mn, dn] = [Number(y), Number(m), Number(d)];
  const date = new Date(yn, mn - 1, dn);
  if (yn < 1900 || date > now || date.getFullYear() !== yn || date.getMonth() !== mn - 1 || date.getDate() !== dn) return null;
  return `${yn}-${String(mn).padStart(2, "0")}-${String(dn).padStart(2, "0")}`;
}

export function ageFromBirthDate(input, now = new Date()) {
  const iso = normalizeBirthDate(input, now);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age > 0 ? age : null;
}
