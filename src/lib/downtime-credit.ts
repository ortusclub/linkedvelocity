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
//   daysActive = (restrictedAt − rentalStart) mod 30d   — how far into its current cycle the
//                account was when it got restricted, counted from the rental's start date
//   credit     = min(elapsed downtime, 30d − daysActive)
//
// IMPORTANT: daysActive is anchored on `rentalStart` (the rental's startDate), NOT on
// currentPeriodEnd. currentPeriodEnd drifts forward with every renewal and credit, so after an
// account has been renewed past its restriction the "currentPeriodEnd − 30d" window starts AFTER
// the restriction and wrongly reads 0 active days — handing a full 30-day credit to an account
// that was actually used (e.g. restricted 14 days in should be credited 30 − 14 = 16, not 30).
// startDate never moves, so the cycle position stays correct for the life of the rental (a
// replacement carries the original startDate forward, so cycles keep aligning across swaps).
// With no rentalStart to measure against, the cap is a full 30 days.
export const DAY_MS = 86_400_000;
export const CYCLE_MS = 30 * DAY_MS;

export function cappedDowntimeMs(
  restrictedAt: Date | string,
  rentalStart: Date | string | null | undefined,
): number {
  const restrictedMs = new Date(restrictedAt).getTime();
  if (!Number.isFinite(restrictedMs)) return 0;
  const downtimeMs = Math.max(0, Date.now() - restrictedMs);
  const startMs = rentalStart == null ? NaN : new Date(rentalStart).getTime();
  // No usable start, or restricted at/before it: nothing to subtract, cap at a full cycle.
  if (!Number.isFinite(startMs) || restrictedMs <= startMs) return Math.min(downtimeMs, CYCLE_MS);
  const activeMs = (restrictedMs - startMs) % CYCLE_MS; // position within the restriction's cycle
  return Math.min(downtimeMs, CYCLE_MS - activeMs);
}
