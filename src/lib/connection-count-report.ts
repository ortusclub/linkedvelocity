// Weekly connection count reported by the maturing engine (read from the account's own
// LinkedIn session during a maturing turn). Pure rules, kept separate from the route so they
// can be tested. Sam, 2026-11-18: update counts automatically, as part of maturing only,
// at most once a week.

export const AUTO_NOTE = "auto (maturing)";
export const MIN_INTERVAL_MS = 6 * 86_400_000; // weekly, with a day's slack for schedule drift
const MAX_WEEKLY_GAIN = 1000;

type Entry = { at: string; count: number; note?: string };

export function decideConnectionUpdate(
  current: { connectionCount: number | null; connectionHistory: unknown },
  reported: number,
  now = Date.now(),
): { action: "update"; history: Entry[] } | { action: "skip"; reason: string } {
  if (!Number.isInteger(reported) || reported < 1 || reported > 30_000) return { action: "skip", reason: "implausible count" };
  const history = Array.isArray(current.connectionHistory) ? (current.connectionHistory as Entry[]) : [];
  const lastAuto = [...history].reverse().find((e) => e?.note === AUTO_NOTE);
  if (lastAuto && now - Date.parse(lastAuto.at) < MIN_INTERVAL_MS) return { action: "skip", reason: "already updated this week" };
  const was = current.connectionCount ?? 0;
  // LinkedIn counts only drift down slightly (removed connections). A big drop or jump is a bad
  // read (wrong account, partial page) — keep the human-entered number rather than wipe it.
  if (was > 0 && reported < was * 0.8) return { action: "skip", reason: `count dropped from ${was} to ${reported}` };
  if (reported - was > MAX_WEEKLY_GAIN) return { action: "skip", reason: `count jumped from ${was} to ${reported}` };
  const at = new Date(now).toISOString();
  return { action: "update", history: [...history, { at, count: reported, note: AUTO_NOTE }].slice(-300) };
}

// What the Profile Maturing board shows: the latest count the engine actually read from LinkedIn,
// and the change over the last 30 days measured between two real readings (Sam: "from actual
// readings, not assumptions"). Hand-typed counts are ignored here. Until a reading 30+ days old
// exists, the change is measured from the first reading and `since` says from when.
export function connectionSummary(history: unknown, now = Date.now()) {
  const readings = (Array.isArray(history) ? (history as Entry[]) : [])
    .filter((e) => e?.note === AUTO_NOTE && Number.isFinite(e.count) && !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!readings.length) return null;
  const latest = readings[readings.length - 1];
  const cutoff = now - 30 * 86_400_000;
  const base = [...readings].reverse().find((e) => Date.parse(e.at) <= cutoff) || readings[0];
  return {
    count: latest.count,
    readAt: latest.at,
    change30d: latest.count - base.count,
    since: base.at,
    full30d: Date.parse(base.at) <= cutoff,
    readings: readings.length,
  };
}

// "Joined LinkedIn" month read from the account's About panel by the engine ("YYYY-MM").
// A real reading replaces a hand-entered or estimated month. Returns the 1st of that month (UTC).
export function parseJoinedMonth(value: unknown, now = Date.now()): Date | null {
  const m = typeof value === "string" ? value.match(/^(\d{4})-(0[1-9]|1[0-2])$/) : null;
  if (!m) return null;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return at.getUTCFullYear() >= 2003 && at.getTime() <= now ? at : null;
}
