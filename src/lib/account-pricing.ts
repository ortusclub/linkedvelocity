export function tierPricing(conns: number, ageMonths: number | null | undefined, hasSalesNav?: boolean, verified?: boolean): { weekly: number; monthly: number; daily: number } {
  const age = ageMonths || 0;
  let base =
    conns >= 2000 ? { weekly: 40, monthly: 150, daily: 8 }
    : conns >= 1000 && age >= 12 ? { weekly: 30, monthly: 110, daily: 6 }
    : conns >= 500 && age >= 12 ? { weekly: 20, monthly: 75, daily: 4 }
    : conns >= 100 && age >= 6 ? { weekly: 15, monthly: 50, daily: 3 }
    // Floor — 50+/3mo and everything below it (including <30 connections).
    : { weekly: 13, monthly: 45, daily: 2.75 };
  // Verified (blue-check) premium: +$20/mo, +$6/wk, +$1/day on top of any tier.
  if (verified) base = { weekly: base.weekly + 6, monthly: base.monthly + 20, daily: base.daily + 1 };
  // Sales Navigator add-on: +$70/mo, +$20/wk, +$4/day on top of the tier.
  if (hasSalesNav) return { weekly: base.weekly + 20, monthly: base.monthly + 70, daily: base.daily + 4 };
  return base;
}

export function monthlyRentalPrice(account: { connectionCount: number; accountAgeMonths?: number | null; hasSalesNav?: boolean; linkedinVerified?: boolean }): number {
  return tierPricing(account.connectionCount, account.accountAgeMonths, account.hasSalesNav, account.linkedinVerified).monthly;
}
