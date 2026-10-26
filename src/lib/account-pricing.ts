export function tierPricing(conns: number, ageMonths: number | null | undefined, hasSalesNav?: boolean, verified?: boolean): { weekly: number; monthly: number; daily: number } {
  const age = ageMonths || 0;
  // Pricing grid (monthly): base $45 for under-300 connections / under-3-months old,
  // +$5 per connection band and +$5 per age band. Tops out at $85 (2000+ conns / 2yr+).
  //   connection bands: <300 | 300-499 | 500-999 | 1000-1999 | 2000+
  //   age bands (months): <3 | 3-6 | 6-12 | 12-24 | 24+
  const connStep = conns >= 2000 ? 4 : conns >= 1000 ? 3 : conns >= 500 ? 2 : conns >= 300 ? 1 : 0;
  const ageStep = age >= 24 ? 4 : age >= 12 ? 3 : age >= 6 ? 2 : age >= 3 ? 1 : 0;
  let monthly = 45 + 5 * connStep + 5 * ageStep;
  // Verified (blue-check) premium: +$20/mo on top of the grid.
  if (verified) monthly += 20;
  // Sales Navigator add-on: +$70/mo. Legacy/grandfathered only — not sold to new renters.
  if (hasSalesNav) monthly += 70;
  // Weekly and daily derive from the monthly rate (weekly ~28% of monthly; daily ~monthly/18,
  // rounded to the nearest $0.25).
  const weekly = Math.round(monthly * 0.28);
  const daily = Math.round((monthly / 18) * 4) / 4;
  return { weekly, monthly, daily };
}

export function monthlyRentalPrice(account: { connectionCount: number; accountAgeMonths?: number | null; hasSalesNav?: boolean; linkedinVerified?: boolean }): number {
  return tierPricing(account.connectionCount, account.accountAgeMonths, account.hasSalesNav, account.linkedinVerified).monthly;
}
