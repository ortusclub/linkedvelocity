import { prisma } from "@/lib/prisma";
import { computePaymentsDue, type DueItem, type ReferralDue } from "@/lib/payment-schedule";
import type { Currency } from "@/lib/referral-currency";

// Unified payouts layer — ONE normalized view over the two payout stores that today
// live apart: referral commissions (the `payouts` table) and ambassador setup+monthly
// fees (`ambassador_applications.monthly_payouts` JSONB). It is the backend keystone for
// the merged /admin/payouts console: the "Pay run" tab reads `ready`, the "Directory" tab
// reads `payees`.
//
// The owed/ready computation is NOT reimplemented here — it delegates to
// computePaymentsDue() (the same engine the Owners view and the weekly digest use) so the
// three surfaces can never disagree about who is owed what. This layer adds: a single row
// shape across all three kinds, per-payee grouping, Wise reachability (rail), and the
// merged payment history.

export type PayoutKind = "referral" | "setup" | "monthly";

// State on the PAY-RUN side, before any Wise send begins. The live send lifecycle
// (preparing/reviewing/sent/…) is layered on top at runtime from the payout's wise_* columns.
export type ReadyState =
  | "ready"          // due now, payable via Wise
  | "upcoming"       // earned but not yet at its due date
  | "hold"           // manually held / account restricted — out of the due list
  | "needs_details"  // no payment method/details on file (can't build a recipient)
  | "manual";        // has a method Wise can't reach (PayPal/UPI/…) — pay by hand

export interface UnifiedReadyPayout {
  id: string;                 // stable row id, unique within a pay run
  kind: PayoutKind;
  payeeKey: string;           // groups rows under one payee (referrer slug or ambassador email)
  payeeName: string;
  payeeSub: string | null;    // slug or email, shown under the name
  referredBy: string | null;  // referrer display name (for ambassador rows)
  description: string;        // who/what this payout is for
  amount: number;
  currency: Currency;
  method: string | null;
  details: string | null;     // raw account detail (caller masks)
  rail: "wallet" | "bank" | null;
  dueDate: string;            // ISO
  overdue: boolean;
  state: ReadyState;
  holdReason: string | null;
}

export interface UnifiedPayment {
  date: string | null;        // ISO paidAt
  amount: number;
  kind: PayoutKind;
  label: string;              // e.g. "Referral · 3 renters" / "Monthly" / "Setup fee"
  by: string | null;          // who logged it
  receipt: string | null;     // Wise receipt / proof URL
  notified: boolean;
  acknowledged: boolean;
}

export interface UnifiedPayee {
  key: string;
  name: string;
  sub: string | null;
  kinds: PayoutKind[];        // which payout kinds this payee receives
  referredBy: string | null;
  method: string | null;
  details: string | null;
  rail: "wallet" | "bank" | null;
  totalPaid: number;
  lastPaidAt: string | null;
  history: UnifiedPayment[];  // newest first
}

export interface UnifiedPayouts {
  ready: UnifiedReadyPayout[];
  payees: UnifiedPayee[];
}

// Wise PHP reachability by payment method. Wallets pay out directly; PH banks pay via
// account number. Anything else (PayPal, UPI, "Bank transfer (Wise)", unknown) is left
// as manual so the console never auto-prepares a recipient we haven't verified.
const WALLETS = new Set([
  "gcash", "maya", "paymaya", "grabpay", "shopeepay", "starpay",
  "bayad", "bayad wallet", "tayocash", "juancash",
]);
const BANKS = new Set([
  "maribank", "gotyme", "gotyme bank", "bpi", "unionbank", "union bank", "bdo",
  "seabank", "landbank", "metrobank", "pnb", "rcbc", "chinabank", "china bank",
  "eastwest", "security bank", "psbank", "dbp",
]);
export function railFor(method: string | null | undefined): "wallet" | "bank" | null {
  if (!method) return null;
  const m = method.trim().toLowerCase();
  if (WALLETS.has(m)) return "wallet";
  if (BANKS.has(m)) return "bank";
  return null;
}

// State for a ready/owed row from its method + due-ness. `blocked`/held rows come in
// pre-flagged by the caller; this only decides reachability vs date.
function readyStateFor(method: string | null, details: string | null, overdue: boolean, dueNow: boolean): ReadyState {
  if (!method && !details) return "needs_details";
  if (railFor(method) === null) return "manual";
  return dueNow || overdue ? "ready" : "upcoming";
}

export async function getUnifiedPayouts(horizonDays = 14): Promise<UnifiedPayouts> {
  const due = await computePaymentsDue(horizonDays);

  // Payment method/details per payee, fetched once so referral and ambassador rows can
  // both show a masked destination and a Wise rail. Referrers key by slug; ambassadors by email.
  const [referrers, apps] = await Promise.all([
    prisma.referrer.findMany({ select: { id: true, slug: true, name: true, paymentName: true, paymentMethod: true, paymentDetails: true } }),
    prisma.ambassadorApplication.findMany({
      select: {
        id: true, email: true, fullName: true, referredBy: true, payoutCurrency: true,
        paymentMethod: true, paymentDetails: true, payoutName: true, paypalEmail: true, wiseEmail: true,
        monthlyPayouts: true, onboardedAt: true, status: true,
      },
    }),
  ]);
  const refBySlug = new Map(referrers.map((r) => [r.slug.toLowerCase(), r]));
  const refNameBySlug = new Map(referrers.map((r) => [r.slug.toLowerCase(), r.name || r.paymentName || r.slug]));
  // Prefer an onboarded application when an email signed up more than once.
  const appByEmail = new Map<string, (typeof apps)[number]>();
  for (const a of apps) {
    const k = a.email.toLowerCase();
    const cur = appByEmail.get(k);
    if (!cur || (!cur.onboardedAt && a.onboardedAt)) appByEmail.set(k, a);
  }
  const ambMethod = (a: (typeof apps)[number] | undefined) =>
    a?.paymentMethod || (a?.paypalEmail ? `PayPal: ${a.paypalEmail}` : a?.wiseEmail ? `Wise: ${a.wiseEmail}` : null);

  const ready: UnifiedReadyPayout[] = [];

  // ── Referral commissions ──────────────────────────────────────────────
  const pushReferral = (r: ReferralDue, held: boolean) => {
    const ref = r.referrerSlug ? refBySlug.get(r.referrerSlug.toLowerCase()) : undefined;
    const method = ref?.paymentMethod || null;
    const details = ref?.paymentDetails || null;
    const overdue = !held && r.status === "ready" && new Date(r.dueDate).getTime() < Date.now();
    const state: ReadyState = held
      ? "hold"
      : readyStateFor(method, details, false, r.status === "ready");
    ready.push({
      id: `ref:${r.applicationId}`,
      kind: "referral",
      payeeKey: `ref:${(r.referrerSlug || r.referrerName).toLowerCase()}`,
      payeeName: r.referrerName,
      payeeSub: r.referrerSlug,
      referredBy: null,
      description: r.person,
      amount: r.amount,
      currency: r.currency,
      method,
      details,
      rail: railFor(method),
      dueDate: r.dueDate,
      overdue,
      state,
      holdReason: r.holdReason ?? null,
    });
  };
  for (const r of due.referralsDue) pushReferral(r, false);
  for (const r of due.referralsHeld) pushReferral(r, true);

  // ── Ambassador setup + monthly (due now, overdue, and upcoming) ───────
  const pushAmb = (d: DueItem, dueNow: boolean) => {
    const app = appByEmail.get(d.email.toLowerCase());
    const held = !!d.blocked;
    const method = d.method || ambMethod(app);
    const details = d.details;
    const state: ReadyState = held ? "hold" : readyStateFor(method, details, d.overdue, dueNow);
    ready.push({
      id: `${d.kind}:${d.email}:${d.dueDate.slice(0, 10)}`,
      kind: d.kind,
      payeeKey: `amb:${d.email.toLowerCase()}`,
      payeeName: d.name,
      payeeSub: d.email,
      referredBy: app?.referredBy ? refNameBySlug.get(app.referredBy.trim().toLowerCase()) || app.referredBy.trim() : null,
      description: d.kind === "setup" ? "Setup fee" : "Monthly",
      amount: d.amount,
      currency: d.currency,
      method,
      details,
      rail: railFor(method),
      dueDate: d.dueDate,
      overdue: d.overdue,
      state,
      holdReason: held ? d.blocked : null,
    });
  };
  for (const d of due.setup) pushAmb(d, true);
  for (const d of due.monthly) pushAmb(d, true);
  for (const d of due.upcoming) pushAmb(d, false);

  // ── Payment history, merged from both stores, grouped by payee ────────
  const payeeMap = new Map<string, UnifiedPayee>();
  const ensurePayee = (key: string, name: string, sub: string | null, kind: PayoutKind,
    method: string | null, details: string | null, referredBy: string | null): UnifiedPayee => {
    let p = payeeMap.get(key);
    if (!p) {
      p = { key, name, sub, kinds: [], referredBy, method, details, rail: railFor(method), totalPaid: 0, lastPaidAt: null, history: [] };
      payeeMap.set(key, p);
    }
    if (!p.kinds.includes(kind)) p.kinds.push(kind);
    if (!p.method && method) { p.method = method; p.rail = railFor(method); }
    if (!p.details && details) p.details = details;
    if (!p.referredBy && referredBy) p.referredBy = referredBy;
    return p;
  };

  // Referral commission payments (paid rows in the payouts table).
  const commPayouts = await prisma.payout.findMany({
    where: { type: "commission", paidAt: { not: null } },
    select: { referrerId: true, amount: true, paidAt: true, description: true, paidBy: true, reference: true, confirmedAt: true, notifiedAt: true },
  });
  const refById = new Map(referrers.map((r) => [r.id, r]));
  for (const p of commPayouts) {
    const r = refById.get(p.referrerId);
    const key = `ref:${(r?.slug || p.referrerId).toLowerCase()}`;
    const payee = ensurePayee(key, r?.name || r?.paymentName || p.referrerId, r?.slug || null, "referral", r?.paymentMethod || null, r?.paymentDetails || null, null);
    const amt = Number(p.amount) || 0;
    payee.history.push({
      date: p.paidAt ? (p.paidAt as Date).toISOString() : null,
      amount: amt,
      kind: "referral",
      label: p.description ? `Referral · ${p.description}` : "Referral",
      by: p.paidBy || null,
      receipt: p.reference || null,
      notified: !!p.notifiedAt,
      acknowledged: !!p.confirmedAt,
    });
    payee.totalPaid += amt;
  }

  // Ambassador setup + monthly payments (JSONB ledger per owner application).
  type Entry = { paidAt?: string; amount?: number; kind?: string; by?: string | null; proofUrl?: string | null; notified?: boolean; acknowledged?: boolean };
  for (const a of apps) {
    const entries = Array.isArray(a.monthlyPayouts) ? (a.monthlyPayouts as Entry[]) : [];
    if (entries.length === 0) continue;
    const key = `amb:${a.email.toLowerCase()}`;
    const referredBy = a.referredBy ? refNameBySlug.get(a.referredBy.trim().toLowerCase()) || a.referredBy.trim() : null;
    for (const e of entries) {
      const kind: PayoutKind = e.kind === "setup" ? "setup" : "monthly";
      const payee = ensurePayee(key, a.fullName || a.email, a.email, kind, ambMethod(a), a.paymentDetails || null, referredBy);
      const amt = Number(e.amount) || 0;
      payee.history.push({
        date: e.paidAt || null,
        amount: amt,
        kind,
        label: kind === "setup" ? "Setup fee" : "Monthly",
        by: e.by || null,
        receipt: e.proofUrl || null,
        notified: !!e.notified,
        acknowledged: !!e.acknowledged,
      });
      payee.totalPaid += amt;
    }
  }

  // Finalize payees: sort history newest-first, set lastPaidAt.
  const payees = [...payeeMap.values()];
  for (const p of payees) {
    p.history.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
    p.lastPaidAt = p.history.find((h) => h.date)?.date || null;
  }
  payees.sort((a, b) => b.totalPaid - a.totalPaid);

  return { ready, payees };
}
