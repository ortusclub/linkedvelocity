// When a LinkedIn account was created — its "Joined LinkedIn" month from the profile's
// About section (recorded at the Level-4 build). Account age for promotion rules is measured
// from LinkedIn creation, NOT from when LinkedVelocity got the account (Sam, 2026-11-18).
// Fallbacks when the joined month was never recorded: the older "account age (months)"
// estimate, measured back from when we added the account; then the date we added it.
const DAY = 86_400_000;

export function linkedinCreatedAt(a: { linkedinJoinedAt?: Date | string | null; accountAgeMonths?: number | null; createdAt: Date | string }): { at: Date; source: "joined" | "age_months" | "added" } {
  if (a.linkedinJoinedAt) {
    const joined = new Date(a.linkedinJoinedAt);
    if (!Number.isNaN(joined.getTime())) return { at: joined, source: "joined" };
  }
  const added = new Date(a.createdAt);
  if (a.accountAgeMonths && a.accountAgeMonths > 0) {
    const est = new Date(added);
    est.setUTCMonth(est.getUTCMonth() - a.accountAgeMonths);
    return { at: est, source: "age_months" };
  }
  return { at: added, source: "added" };
}

export function linkedinAgeDays(a: Parameters<typeof linkedinCreatedAt>[0], now = Date.now()): number {
  return Math.floor((now - linkedinCreatedAt(a).at.getTime()) / DAY);
}

/** True once at least `months` calendar months have passed since the LinkedIn account was created. */
export function linkedinOlderThanMonths(a: Parameters<typeof linkedinCreatedAt>[0], months: number, now = Date.now()): boolean {
  const cutoff = new Date(linkedinCreatedAt(a).at);
  cutoff.setUTCMonth(cutoff.getUTCMonth() + months);
  return cutoff.getTime() <= now;
}
