// Optional v2 client preference. Do not interpolate arbitrary client text into
// system instructions; unsupported values keep the legacy language detection.
export function feedbackLanguageInstruction(value) {
  const language = value === "ko" ? "Korean (한국어)" : value === "en" ? "English" : null;
  if (!language) return "";
  return `CRITICAL OVERRIDE — EXPLICIT FEEDBACK LANGUAGE: The user explicitly selected ${language} for this feedback. Write ALL coaching prose, section text, comparison explanations, and next-practice focus options in ${language}, even when the script, transcript, note, previous feedback, or examples are in another language. This explicit selection overrides every earlier instruction to match the note/request language and every example's language. Brief quotations from the source may remain in their original language. Keep the required emoji sections and machine-readable [[FOCUS]] / [[SCORES]] markers and score keys unchanged. The language choice does not change the evidence limits or scoring rules.`;
}
