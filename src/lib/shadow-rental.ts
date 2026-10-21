import { prisma } from "@/lib/prisma";
import { scheduleShadowHandover } from "@/lib/shadow-handover";

// Per-renter flat monthly rate. A shadow renter pays this per idle account instead of the
// account's tier/Sales Nav/verified price. Each shadow email has its OWN rate.
// Override via env SHADOW_RENTER_RATES="email:rate,email:rate".
export const SHADOW_RENTER_RATES: Record<string, number> = (() => {
  // Apex (info@apexstrategy.io) was removed Oct 2026 — Sam moved them to a normal
  // full-price rental (holds accounts, out of catalogue, no yield). Ortus stays shadow.
  const out: Record<string, number> = { "info@ortus.solutions": 25 };
  const raw = process.env.SHADOW_RENTER_RATES;
  if (raw) {
    for (const pair of raw.split(",")) {
      const [em, rate] = pair.split(":").map((s) => s.trim());
      const n = Number(rate);
      if (em && Number.isFinite(n) && n > 0) out[em.toLowerCase()] = n;
    }
  }
  return out;
})();

// Legacy default (Apex rate) — kept for any caller that still references a single price.
export const SHADOW_MONTHLY_PRICE = 20;

export const SHADOW_RENTER_EMAILS = Object.keys(SHADOW_RENTER_RATES);

// The flat rate for a shadow renter's email, or null if they're not a shadow renter.
export const shadowRateFor = (email?: string | null): number | null =>
  email ? (SHADOW_RENTER_RATES[email.toLowerCase()] ?? null) : null;

export const isShadowRenterEmail = (email?: string | null): boolean => shadowRateFor(email) !== null;

// Account ids that already have an ACTIVE shadow rental — a given account can be shadow-
// bought by only ONE shadow renter at a time, and it must read as unavailable to shadow
// buyers (but still available to everyone else).
export async function activeShadowAccountIds(): Promise<Set<string>> {
  const rows = await prisma.rental.findMany({
    where: { isShadow: true, status: { in: ["active", "pending_access", "payment_failed"] } },
    select: { linkedinAccountId: true },
  });
  return new Set(rows.map((r) => r.linkedinAccountId));
}

// Reserve seven days for the current shadow renter. Called after creating a real rental;
// retries are safe, and the auto-grant job recovers any interrupted checkout scheduling.
export async function yieldShadowRentals(accountId: string, opts?: { reason?: string }): Promise<number> {
  return scheduleShadowHandover(accountId, opts?.reason);
}
