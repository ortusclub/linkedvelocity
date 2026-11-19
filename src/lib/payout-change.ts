// Payout-change flagging — one small record written whenever a payee changes their OWN
// payout method/details from a self-serve surface (the referrer portal, or the owner payout
// form). It drives the "mode of payment changed — verify before paying" flag on the merged
// /admin/payouts console, so a change made out-of-band (e.g. relayed over Telegram and typed
// in) can't slip through unnoticed and get paid to an unverified destination.
//
// Stored on Referrer.payoutChange / AmbassadorApplication.payoutChange (JSONB). The raw OLD
// values are kept server-side for audit; the console is only ever sent the CHANGED field
// labels + when/by, never the raw old account number.

export interface PayoutChange {
  at: string;                         // ISO — when the change was recorded
  by: string;                         // "referrer" | "owner" (the self-serve actor)
  from: Record<string, string | null>; // changed field key → its value BEFORE the change
  ackedAt: string | null;             // when an admin marked it verified (null = still flagged)
  ackedBy: string | null;             // who verified it
}

// Human labels for the tracked fields, per model. Only these fields are watched for changes.
export const REFERRER_PAYOUT_FIELDS = ["paymentMethod", "paymentDetails", "paymentName"] as const;
export const AMBASSADOR_PAYOUT_FIELDS = [
  "paymentMethod", "bankName", "bankAccountName", "bankAccountNumber",
  "bankRoutingNumber", "bankSortCode", "usdcWalletAddress", "usdcNetwork",
  "paypalEmail", "wiseEmail",
] as const;
// The GCash-style free-text payout an ambassador is paid on, as set from the referrer portal
// (per onboarded person). A different, smaller set than the logged-in owner's bank form above.
export const AMBASSADOR_PORTAL_PAYOUT_FIELDS = ["paymentMethod", "paymentDetails", "payoutName"] as const;

const FIELD_LABELS: Record<string, string> = {
  paymentMethod: "method",
  paymentDetails: "account details",
  paymentName: "account name",
  payoutName: "account name",
  bankName: "bank",
  bankAccountName: "account name",
  bankAccountNumber: "account number",
  bankRoutingNumber: "routing",
  bankSortCode: "sort code",
  usdcWalletAddress: "wallet address",
  usdcNetwork: "network",
  paypalEmail: "PayPal",
  wiseEmail: "Wise",
};

const norm = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

// Compute the set of tracked fields whose value actually changed (prev → next). Returns the
// PREV values keyed by field, or null when nothing meaningful changed.
export function diffPayout(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly string[],
): Record<string, string | null> | null {
  const from: Record<string, string | null> = {};
  for (const f of fields) {
    const a = norm(prev[f]);
    const b = norm(next[f]);
    if (a !== b) from[f] = a;
  }
  return Object.keys(from).length ? from : null;
}

// Build the JSON to store after a self-serve change. If an earlier change is still UNACKED,
// its original `from` baseline is preserved (so the console keeps showing the true pre-change
// values the team hasn't verified yet) while the timestamp/actor advance to the latest edit.
export function nextPayoutChange(
  existing: unknown,
  from: Record<string, string | null>,
  by: string,
): PayoutChange {
  const prior = parsePayoutChange(existing);
  const baseline = prior && !prior.ackedAt ? { ...prior.from, ...carryMissing(prior.from, from) } : from;
  return { at: new Date().toISOString(), by, from: baseline, ackedAt: null, ackedBy: null };
}

// When merging a prior unacked baseline with a new change, keep the prior value for fields the
// prior already recorded, and add the new change's fields that the prior didn't cover.
function carryMissing(prior: Record<string, string | null>, next: Record<string, string | null>) {
  const out: Record<string, string | null> = {};
  for (const k of Object.keys(next)) if (!(k in prior)) out[k] = next[k];
  return out;
}

export function parsePayoutChange(raw: unknown): PayoutChange | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== "string" || typeof r.from !== "object" || !r.from) return null;
  return {
    at: r.at,
    by: typeof r.by === "string" ? r.by : "someone",
    from: r.from as Record<string, string | null>,
    ackedAt: typeof r.ackedAt === "string" ? r.ackedAt : null,
    ackedBy: typeof r.ackedBy === "string" ? r.ackedBy : null,
  };
}

// The compact shape the payouts console receives — no raw old values, just what changed, when,
// and by whom. Null when there's no change or the change has been verified.
export interface PayoutChangeFlag { at: string; by: string; fields: string[] }

export function payoutChangeFlag(raw: unknown): PayoutChangeFlag | null {
  const pc = parsePayoutChange(raw);
  if (!pc || pc.ackedAt) return null;
  const fields = Object.keys(pc.from).map((k) => FIELD_LABELS[k] || k);
  // De-dup labels (bankAccountName + paymentName both read "account name").
  const seen = new Set<string>();
  const dedup = fields.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
  return { at: pc.at, by: pc.by, fields: dedup };
}

// Acknowledge (verify) a pending change — sets ackedAt/ackedBy, keeping the from/at history.
// Returns the updated record, or null if there was nothing pending to ack.
export function ackPayoutChange(raw: unknown, ackedBy: string): PayoutChange | null {
  const pc = parsePayoutChange(raw);
  if (!pc || pc.ackedAt) return null;
  return { ...pc, ackedAt: new Date().toISOString(), ackedBy };
}
