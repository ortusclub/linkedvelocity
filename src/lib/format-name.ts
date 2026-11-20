// Tidy a person's name whether it was entered in ALL CAPS or all lowercase
// (e.g. "AIZA MAE PULAO BARIATA" → "Aiza Mae Pulao Bariata", "janna dela cruz" →
// "Janna Dela Cruz"). Also trims and collapses spaces. Already-mixed-case words are
// left alone so "McKay", "De Leon", "Hanna-Jen", and initials like "N." survive;
// two-letter initials like "AJ" stay as typed unless the whole name is in caps;
// words containing digits (usernames such as "abebe060") are not touched.
// Idempotent, so it is safe both on save (signup routes) and on display.
const nameLetters = (s: string) => s.replace(/[^\p{L}]/gu, "");
const capFirst = (s: string) => s.replace(/(^|\.)(\P{L}*)(\p{Ll})/gu, (_m, a: string, b: string, c: string) => a + b + c.toUpperCase());
export function formatName(name: string | null | undefined): string {
  if (!name) return "";
  const all = nameLetters(name);
  const wholeNameCaps = all.length > 0 && all === all.toUpperCase() && all !== all.toLowerCase();
  return name.trim().split(/\s+/).map((word) => {
    if (/\d/.test(word)) return word;
    const l = nameLetters(word);
    if (l.length > 1 && l === l.toUpperCase() && l !== l.toLowerCase()) {
      if (l.length === 2 && !wholeNameCaps) return word;
      return word.toLowerCase().split("-").map(capFirst).join("-");
    }
    if (l && l === l.toLowerCase() && l !== l.toUpperCase()) return capFirst(word);
    return word;
  }).join(" ");
}
