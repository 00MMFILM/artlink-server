// 오프라인: 생년월일 정규화·나이 계산 (대시보드 나이 표시·나이 필터)
import assert from "node:assert/strict";
import { normalizeBirthDate, ageFromBirthDate } from "../api/_birthDate.js";
const now = new Date(2026, 9, 7);
for (const [input, expected] of [
  ["20010119", "2001-01-19"], ["2001-01-19", "2001-01-19"], ["2009.04.12", "2009-04-12"], ["2009/06/21", "2009-06-21"],
  ["2010 -7-23", "2010-07-23"], ["14-05-1997", "1997-05-14"], ["010611", "2001-06-11"], ["790830", "1979-08-30"],
]) assert.equal(normalizeBirthDate(input, now), expected, input);
for (const bad of ["", null, undefined, "22 Januari", "20011340", "2001-02-30", "29991231", "abc"]) {
  assert.equal(normalizeBirthDate(bad, now), null, String(bad));
  assert.equal(ageFromBirthDate(bad, now), null, String(bad));
}
assert.equal(ageFromBirthDate("20010119", now), 25);
assert.equal(ageFromBirthDate("2001.10.08", now), 24, "생일 하루 전");
console.log("PASS: birth date formats, invalid input, age");
