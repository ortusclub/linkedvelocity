// Downtime-credit cap — the single source of truth shared by the renter dashboard (live accrual
// display) and every server site that banks a credit (restriction recover, recovery-case
// hand-back, self-serve replace). Pure math, no imports, so the client bundle can use it too.
//
// A restricted rental is owed at most (30 days − the days the account actually worked this cycle)
// of free extension; elapsed downtime beyond that is NOT credited, so total working time inside a
// paid cycle can never exceed one 30-day cycle. Without the cap an account that sits restricted
// for weeks — or a permanently-restricted one, which skips the recovery-hold gate — would push the
// next-payment date out day-for-day while the renter isn't paying.
//
//   daysActive = restrictedAt − periodStart   (periodStart = currentPeriodEnd − 30d), clamped 0–30d
//   credit     = min(elapsed downtime, 30d − daysActive)
//
// With no currentPeriodEnd to measure the cycle against, the cap is a full 30 days.
export const DAY_MS = 86_400_000;
export const CYCLE_MS = 30 * DAY_MS;

export function cappedDowntimeMs(
  restrictedAt: Date | string,
  currentPeriodEnd: Date | string | null | undefined,
): number {
  const restrictedMs = new Date(restrictedAt).getTime();
  if (!Number.isFinite(restrictedMs)) return 0;
  const downtimeMs = Math.max(0, Date.now() - restrictedMs);
  if (!currentPeriodEnd) return Math.min(downtimeMs, CYCLE_MS);
  const periodStart = new Date(currentPeriodEnd).getTime() - CYCLE_MS;
  const activeMs = Math.min(CYCLE_MS, Math.max(0, restrictedMs - periodStart));
  return Math.min(downtimeMs, CYCLE_MS - activeMs);
}
