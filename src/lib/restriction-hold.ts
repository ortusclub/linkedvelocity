// Restriction-based payout hold — the ONE source of truth for "this account can't be paid yet
// because of a restriction". Read by the referrer portal (what the payee sees), the payouts
// console, the pipeline, and enforced server-side on every write that records a setup/monthly
// payout. Keeping it here means those surfaces can never disagree again (the bug that let a
// recently-recovered account read "ready to pay" in the pipeline while the portal said "on hold").
//
// The rule: an account is held while it is restricted, and for a short STABILISATION window after
// it recovers (recovery + 7 days), because accounts that just recovered often re-restrict within
// days — paying one immediately risks paying for an account that dies again.

export const RESTR_STABILISE_MS = 7 * 86_400_000; // 7 days

export interface RestrictionPayHold {
  reason: "restricted" | "stabilising"; // restricted = still down / no known date; stabilising = recovered, waiting out the window
  resumeAt: string | null;              // ISO date it becomes payable; null when still restricted (waits on clearance)
  recoveredAt: string | null;           // ISO of the recovery that started the stabilising window (null when still restricted)
}

type HoldAccount = {
  restrictedAt?: Date | string | null;
  permanentlyRestricted?: boolean | null;
  restrictionLog?: unknown;
} | null | undefined;

// Returns the active hold, or null when the account is clear to pay. Does NOT cover retired /
// permanently-restricted "never pay" states — those are handled by the existing status gates;
// this is only the restriction-recency hold.
export function restrictionPayHold(acct: HoldAccount, now: number = Date.now()): RestrictionPayHold | null {
  if (!acct) return null;
  // Live restriction flag set — held, no known resume date (waits on clearance).
  if (acct.restrictedAt) return { reason: "restricted", resumeAt: null, recoveredAt: null };

  const log = Array.isArray(acct.restrictionLog)
    ? (acct.restrictionLog as Array<{ at?: string; event?: string }>)
    : [];
  const evs = log
    .filter((e) => e && e.at && (e.event === "restricted" || e.event === "recovered"))
    .sort((x, y) => new Date(x.at!).getTime() - new Date(y.at!).getTime());
  const last = evs[evs.length - 1];
  if (!last) return null;

  // Last event is a restriction the live flag hasn't caught up to (recover→re-flag sync gap) —
  // treat as restricted, no known date.
  if (last.event === "restricted") return { reason: "restricted", resumeAt: null, recoveredAt: null };

  // Recovered — held only until the stabilisation window ends.
  const recoveredMs = new Date(last.at!).getTime();
  const resumeMs = recoveredMs + RESTR_STABILISE_MS;
  if (now < resumeMs) {
    return { reason: "stabilising", resumeAt: new Date(resumeMs).toISOString(), recoveredAt: new Date(recoveredMs).toISOString() };
  }
  return null;
}

// One short, admin-facing line explaining why a payout is blocked.
export function restrictionHoldMessage(hold: RestrictionPayHold): string {
  if (hold.reason === "restricted") {
    return "This account is restricted — payment is on hold until it's cleared.";
  }
  const d = hold.resumeAt ? new Date(hold.resumeAt).toISOString().slice(0, 10) : "soon";
  return `This account recovered recently and is in its stability window until ${d}. Paying before then risks paying for an account that re-restricts.`;
}
