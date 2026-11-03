import { prisma } from "@/lib/prisma";
import { computePaymentsDue, type DueItem, type ReferralDue } from "@/lib/payment-schedule";
import { currencyConfig, currencyConfigFor, type Currency } from "@/lib/referral-currency";

// Unified payouts layer — ONE normalized view over the two payout stores that today
// live apart: referral commissions (the `payouts` table) and ambassador setup+monthly
// fees (`ambassador_applications.monthly_payouts` JSONB). It is the backend keystone for
// the merged /admin/payouts console: "This pay run" reads `ready`, "All payees" reads `payees`.
//
// The owed/ready computation is NOT reimplemented here — it delegates to
// computePaymentsDue() (the same engine the Owners view and the weekly digest use) so the
// three surfaces can never disagree about who is owed what. This layer adds: a single row
// shape across all three kinds, this-cycle PAID rows (so the run shows what's already been
// sent and the SENT card has data), per-payee grouping, Wise reachability, and merged history.

export type PayoutKind = "referral" | "setup" | "monthly";

// State on the PAY-RUN side. The live Wise send lifecycle (preparing/reviewing/sent/…) is
// layered on top at runtime once the send routes + wise_* columns exist; "paid" here means
// already settled this cycle (receipt attached).
export type ReadyState =
  | "ready"          // due now, payable via Wise
  | "upcoming"       // earned but not yet at its due date
  | "hold"           // manually held / account restricted — out of the due list
  | "needs_details"  // no payment method/details on file (can't build a recipient)
  | "manual"         // method Wise can't reach (PayPal/UPI/…) — pay by hand
  | "paid";          // already paid this cycle

type Entry = { paidAt?: string; amount?: number; kind?: string; by?: string | null; proofUrl?: string | null; notified?: boolean; notifiedAt?: string | null; acknowledged?: boolean; acknowledgedAt?: string | null };

// Login-health flags for an ambassador's account(s), so the team can confirm the account
// can actually be logged into before paying the owner. Surfaced only when there's something
// to check (null otherwise). "danger" = probably can't log in now (restricted / 2FA reset /
// danger mail); "review" = recently recovered or an unresolved security email to eyeball.
export interface LoginHealth {
  level: "danger" | "review";
  flags: string[];            // short labels for the row + detail card
  restricted: boolean;        // open or permanent LinkedIn restriction
  recoveredAt: string | null; // most recent recovery (ISO) — verify login works
  twoFaReset: boolean;        // 2FA reset still pending
  mailCount: number;          // unresolved security mails (severity review/danger)
  mailLatest: string | null;  // e.g. "New login · Nov 2"
}

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
  receipt: string | null;     // paid rows: Wise receipt / proof URL
  paidAt: string | null;
  confirmed: boolean;         // payee acknowledged / confirmed receipt
  sentViaWise: boolean;       // paid and the receipt is a wise.com link
  health: LoginHealth | null; // account login-health flags (ambassador rows only)
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
  email: string | null;
  phone: string | null;
  holder: string | null;      // account-holder name on the payout method
  accounts: number;           // accounts this ambassador supplies (0 for pure referrers)
  linkedinUrls: string[];     // the LinkedIn account URL(s) this ambassador supplies
  nextDue: string | null;     // next monthly due date (ISO)
  note: string | null;        // hold / restriction reason, if any
  totalPaid: number;
  lastPaidAt: string | null;
  history: UnifiedPayment[];  // newest first
  health: LoginHealth | null; // account login-health flags (ambassadors only)
}

export interface UnifiedPayouts {
  ready: UnifiedReadyPayout[];
  payees: UnifiedPayee[];
}

// Wise PHP reachability by payment method. Wallets pay out directly; PH banks pay via
// account number. Anything else (PayPal, UPI, "Bank transfer (Wise)", unknown) is left
// as manual so the console never auto-prepares a recipient we haven't verified.
// Matched as substrings, because real method strings carry extra words
// ("BDO Unibank", "BPI bank transfer", "Bank transfer (Wise)", "Indian Overseas Bank").
const WALLET_KW = ["gcash", "maya", "paymaya", "grabpay", "shopeepay", "starpay", "bayad", "tayocash", "juancash"];
const BANK_KW = ["maribank", "gotyme", "bpi", "bdo", "unionbank", "union bank", "seabank", "landbank",
  "metrobank", "pnb", "rcbc", "chinabank", "china bank", "eastwest", "security bank", "psbank", "dbp",
  "cimb", "overseas bank", "iob"];
export function railFor(method: string | null | undefined): "wallet" | "bank" | null {
  if (!method) return null;
  const m = method.trim().toLowerCase();
  if (WALLET_KW.some((k) => m.includes(k))) return "wallet";
  if (m.includes("paypal") || m.includes("upi")) return null; // not a PH rail Wise reaches
  if (BANK_KW.some((k) => m.includes(k)) || m.includes("bank")) return "bank";
  return null;
}

// State for a ready/owed row. Due-ness FIRST: anything not yet due is "upcoming" regardless
// of method, so a paid/next-cycle payout can't leak into the pay run mislabeled manual.
function readyStateFor(method: string | null, details: string | null, overdue: boolean, dueNow: boolean): ReadyState {
  if (!dueNow && !overdue) return "upcoming";
  if (!method && !details) return "needs_details";
  if (railFor(method) === null) return "manual";
  return "ready";
}

const isWiseReceipt = (url: string | null | undefined) => !!url && /wise\.com/i.test(url);

const DAY_MS = 86400000;
const fmtShort = (d: string | Date) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" });
const MAIL_LABEL: Record<string, string> = {
  new_login: "New login", location_change: "New location", password_changed: "Password changed",
  email_changed: "Email changed", name_changed: "Name changed", photo_changed: "Photo changed",
  restriction: "Restriction notice", email_verify: "Email verify",
};
const mailLabel = (t: string) => MAIL_LABEL[t] || "Security email";

type HealthAccount = { id: string; linkedinUrl: string | null; notes: string | null; restrictedAt: Date | null; permanentlyRestricted: boolean; twoFactorResetNeeded: boolean; restrictionLog: unknown };

// Fold restriction / recovery / 2FA-reset / unresolved-security-mail signals per ambassador
// email, so the pay run can flag "check this account logs in before you pay". Only returns an
// entry when there's something worth checking. Recovery and mail windows are 30 days (a
// long-stable account needs no nudge). Account→owner mapping mirrors computePaymentsDue.
async function buildLoginHealth(apps: { email: string; linkedinUrl: string | null }[], accounts: HealthAccount[]): Promise<{ health: Map<string, LoginHealth>; urls: Map<string, string[]> }> {
  const urlToEmail = new Map<string, string>();
  for (const a of apps) {
    if (a.linkedinUrl) { urlToEmail.set(a.linkedinUrl, a.email); urlToEmail.set(a.linkedinUrl.replace(/\/$/, ""), a.email); }
  }
  const ownerOf = (acc: HealthAccount): string | null => {
    const m = (acc.notes || "").match(/Owner:\s*(\S+@\S+)/);
    if (m) return m[1].replace(/\.$/, "").toLowerCase();
    if (acc.linkedinUrl) return (urlToEmail.get(acc.linkedinUrl) || urlToEmail.get(acc.linkedinUrl.replace(/\/$/, "")) || "").toLowerCase() || null;
    return null;
  };
  const accEmail = new Map<string, string>();
  const emailAccounts = new Map<string, HealthAccount[]>();
  const urls = new Map<string, string[]>();   // owner email → LinkedIn account URL(s) they supply
  for (const acc of accounts) {
    const email = ownerOf(acc);
    if (!email) continue;
    accEmail.set(acc.id, email);
    let arr = emailAccounts.get(email); if (!arr) { arr = []; emailAccounts.set(email, arr); } arr.push(acc);
    if (acc.linkedinUrl) { let u = urls.get(email); if (!u) { u = []; urls.set(email, u); } if (!u.includes(acc.linkedinUrl)) u.push(acc.linkedinUrl); }
  }
  // Fall back to the application's own LinkedIn URL for owners with no account-notes match.
  for (const a of apps) {
    const k = a.email.toLowerCase();
    if (a.linkedinUrl && !urls.has(k)) urls.set(k, [a.linkedinUrl]);
  }

  // Unresolved security mail (needs a look before login) in the last 30 days, newest first.
  const since = new Date(Date.now() - 30 * DAY_MS);
  const mails = accEmail.size
    ? await prisma.accountMailEvent.findMany({
        where: {
          linkedinAccountId: { in: [...accEmail.keys()] },
          severity: { in: ["review", "danger"] },
          status: { in: ["logged", "needs_review", "incident"] },
          receivedAt: { gte: since },
        },
        select: { linkedinAccountId: true, type: true, severity: true, receivedAt: true },
        orderBy: { receivedAt: "desc" },
      })
    : [];
  const mailByEmail = new Map<string, { count: number; danger: boolean; type: string; at: Date }>();
  for (const ev of mails) {
    const email = accEmail.get(ev.linkedinAccountId); if (!email) continue;
    const cur = mailByEmail.get(email);
    if (!cur) mailByEmail.set(email, { count: 1, danger: ev.severity === "danger", type: ev.type, at: ev.receivedAt });
    else { cur.count++; if (ev.severity === "danger") cur.danger = true; } // desc order → first seen is latest
  }

  const out = new Map<string, LoginHealth>();
  for (const [email, accs] of emailAccounts) {
    let restricted = false, twoFaReset = false;
    let recoveredAt: string | null = null;
    for (const acc of accs) {
      if (acc.restrictedAt || acc.permanentlyRestricted) restricted = true;
      if (acc.twoFactorResetNeeded) twoFaReset = true;
      if (!acc.restrictedAt) {
        const log = Array.isArray(acc.restrictionLog) ? (acc.restrictionLog as Array<{ at?: string; event?: string }>) : [];
        const lastRec = [...log].reverse().find((e) => e.event === "recovered");
        // Only flag RECENT recoveries (14d) — a month-stable account logs in fine and needs no nudge.
        if (lastRec?.at && Date.now() - new Date(lastRec.at).getTime() < 14 * DAY_MS && (!recoveredAt || lastRec.at > recoveredAt)) recoveredAt = lastRec.at;
      }
    }
    const mail = mailByEmail.get(email) || null;
    const flags: string[] = [];
    if (restricted) flags.push("Restricted");
    if (twoFaReset) flags.push("2FA reset needed");
    if (recoveredAt) flags.push(`Recovered ${fmtShort(recoveredAt)}`);
    if (mail) flags.push(mailLabel(mail.type));
    if (flags.length === 0) continue;
    const level: "danger" | "review" = restricted || twoFaReset || mail?.danger ? "danger" : "review";
    out.set(email, {
      level, flags, restricted, recoveredAt, twoFaReset,
      mailCount: mail?.count || 0, mailLatest: mail ? `${mailLabel(mail.type)} · ${fmtShort(mail.at)}` : null,
    });
  }
  return { health: out, urls };
}

export async function getUnifiedPayouts(horizonDays = 14): Promise<UnifiedPayouts> {
  const due = await computePaymentsDue(horizonDays);

  // Payment method/details per payee, fetched once so referral and ambassador rows can
  // both show a masked destination and a Wise rail. Referrers key by slug; ambassadors by email.
  const [referrers, apps, accounts] = await Promise.all([
    prisma.referrer.findMany({ select: { id: true, slug: true, name: true, paymentName: true, paymentMethod: true, paymentDetails: true, email: true } }),
    prisma.ambassadorApplication.findMany({
      select: {
        id: true, email: true, fullName: true, referredBy: true, payoutCurrency: true, linkedinUrl: true,
        paymentMethod: true, paymentDetails: true, payoutName: true, paypalEmail: true, wiseEmail: true,
        monthlyPayouts: true, onboardedAt: true, status: true, contactNumber: true,
      },
    }),
    // Live accounts for login-health flags (restricted / recovered / 2FA reset).
    prisma.linkedInAccount.findMany({
      where: { status: { notIn: ["removed", "retired", "under_review"] } },
      select: { id: true, linkedinUrl: true, notes: true, restrictedAt: true, permanentlyRestricted: true, twoFactorResetNeeded: true, restrictionLog: true },
    }),
  ]);

  // Login-health per ambassador email, so the team can confirm an account is loggable
  // before paying its owner. Maps each account to its owner (notes "Owner: <email>", else
  // the application that owns the LinkedIn URL), then folds restriction/recovery/mail signals.
  const { health: healthByEmail, urls: accountUrlsByEmail } = await buildLoginHealth(apps, accounts);

  // Next monthly due date per ambassador email (for the detail card).
  const nextDueByEmail = new Map<string, string>();
  for (const d of [...due.monthly, ...due.upcoming]) {
    if (d.kind !== "monthly") continue;
    const k = d.email.toLowerCase();
    const cur = nextDueByEmail.get(k);
    if (!cur || d.dueDate < cur) nextDueByEmail.set(k, d.dueDate);
  }
  const refBySlug = new Map(referrers.map((r) => [r.slug.toLowerCase(), r]));
  const refById = new Map(referrers.map((r) => [r.id, r]));
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

  // ── Owed: referral commissions ────────────────────────────────────────
  const pushReferral = (r: ReferralDue, held: boolean) => {
    const ref = r.referrerSlug ? refBySlug.get(r.referrerSlug.toLowerCase()) : undefined;
    const method = ref?.paymentMethod || null;
    const details = ref?.paymentDetails || null;
    const overdue = !held && r.status === "ready" && new Date(r.dueDate).getTime() < Date.now();
    const state: ReadyState = held ? "hold" : readyStateFor(method, details, false, r.status === "ready");
    ready.push({
      id: `ref:${r.applicationId}`, kind: "referral",
      payeeKey: `ref:${(r.referrerSlug || r.referrerName).toLowerCase()}`, payeeName: r.referrerName, payeeSub: r.referrerSlug,
      referredBy: null, description: r.person, amount: r.amount, currency: r.currency,
      method, details, rail: railFor(method), dueDate: r.dueDate, overdue, state, holdReason: r.holdReason ?? null,
      receipt: null, paidAt: null, confirmed: false, sentViaWise: false, health: null,
    });
  };
  for (const r of due.referralsDue) pushReferral(r, false);
  for (const r of due.referralsHeld) pushReferral(r, true);

  // ── Owed: ambassador setup + monthly (due now, overdue, upcoming) ─────
  const pushAmb = (d: DueItem, dueNow: boolean) => {
    const app = appByEmail.get(d.email.toLowerCase());
    const held = !!d.blocked;
    const method = d.method || ambMethod(app);
    const details = d.details;
    const state: ReadyState = held ? "hold" : readyStateFor(method, details, d.overdue, dueNow);
    ready.push({
      id: `${d.kind}:${d.email}:${d.dueDate.slice(0, 10)}`, kind: d.kind,
      payeeKey: `amb:${d.email.toLowerCase()}`, payeeName: d.name, payeeSub: d.email,
      referredBy: app?.referredBy ? refNameBySlug.get(app.referredBy.trim().toLowerCase()) || app.referredBy.trim() : null,
      description: d.kind === "setup" ? "Setup fee" : "Monthly", amount: d.amount, currency: d.currency,
      method, details, rail: railFor(method), dueDate: d.dueDate, overdue: d.overdue, state, holdReason: held ? d.blocked : null,
      receipt: null, paidAt: null, confirmed: false, sentViaWise: false, health: healthByEmail.get(d.email.toLowerCase()) || null,
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
    if (!p) { p = { key, name, sub, kinds: [], referredBy, method, details, rail: railFor(method), email: null, phone: null, holder: null, accounts: 0, linkedinUrls: [], nextDue: null, note: null, totalPaid: 0, lastPaidAt: null, history: [], health: null }; payeeMap.set(key, p); }
    if (!p.kinds.includes(kind)) p.kinds.push(kind);
    if (!p.method && method) { p.method = method; p.rail = railFor(method); }
    if (!p.details && details) p.details = details;
    if (!p.referredBy && referredBy) p.referredBy = referredBy;
    return p;
  };

  const commPayouts = await prisma.payout.findMany({
    where: { type: "commission", paidAt: { not: null } },
    select: { referrerId: true, amount: true, paidAt: true, description: true, paidBy: true, reference: true, confirmedAt: true, notifiedAt: true },
  });
  for (const p of commPayouts) {
    const r = refById.get(p.referrerId);
    const key = `ref:${(r?.slug || p.referrerId).toLowerCase()}`;
    const payee = ensurePayee(key, r?.name || r?.paymentName || p.referrerId, r?.slug || null, "referral", r?.paymentMethod || null, r?.paymentDetails || null, null);
    if (!payee.email && r?.email) payee.email = r.email;
    if (!payee.holder && r?.paymentName) payee.holder = r.paymentName;
    const amt = Number(p.amount) || 0;
    payee.history.push({
      date: p.paidAt ? (p.paidAt as Date).toISOString() : null, amount: amt, kind: "referral",
      label: p.description ? `Referral · ${p.description}` : "Referral", by: p.paidBy || null,
      receipt: p.reference || null, notified: !!p.notifiedAt, acknowledged: !!p.confirmedAt,
    });
    payee.totalPaid += amt;
  }
  for (const a of apps) {
    const entries = Array.isArray(a.monthlyPayouts) ? (a.monthlyPayouts as Entry[]) : [];
    if (entries.length === 0) continue;
    const key = `amb:${a.email.toLowerCase()}`;
    const referredBy = a.referredBy ? refNameBySlug.get(a.referredBy.trim().toLowerCase()) || a.referredBy.trim() : null;
    for (const e of entries) {
      const kind: PayoutKind = e.kind === "setup" ? "setup" : "monthly";
      const payee = ensurePayee(key, a.fullName || a.email, a.email, kind, ambMethod(a), a.paymentDetails || null, referredBy);
      if (!payee.email) payee.email = a.email;
      if (!payee.phone && a.contactNumber) payee.phone = a.contactNumber;
      if (!payee.holder && a.payoutName) payee.holder = a.payoutName;
      if (!payee.nextDue) payee.nextDue = nextDueByEmail.get(a.email.toLowerCase()) || null;
      if (!payee.health) payee.health = healthByEmail.get(a.email.toLowerCase()) || null;
      if (payee.linkedinUrls.length === 0) payee.linkedinUrls = accountUrlsByEmail.get(a.email.toLowerCase()) || [];
      const amt = Number(e.amount) || 0;
      payee.history.push({ date: e.paidAt || null, amount: amt, kind, label: kind === "setup" ? "Setup fee" : "Monthly", by: e.by || null, receipt: e.proofUrl || null, notified: !!e.notified, acknowledged: !!e.acknowledged });
      payee.totalPaid += amt;
    }
  }

  // ── This-cycle PAID rows (current calendar month) → shown in the pay run ──
  const nowD = new Date();
  const cycle = (iso: string | null | undefined) => { if (!iso) return null; const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}`; };
  const thisCycle = `${nowD.getFullYear()}-${nowD.getMonth()}`;

  for (const p of commPayouts) {
    const iso = p.paidAt ? (p.paidAt as Date).toISOString() : null;
    if (cycle(iso) !== thisCycle) continue;
    const r = refById.get(p.referrerId);
    const method = r?.paymentMethod || null;
    ready.push({
      id: `paid-ref:${p.referrerId}:${iso}`, kind: "referral",
      payeeKey: `ref:${(r?.slug || p.referrerId).toLowerCase()}`, payeeName: r?.name || r?.paymentName || p.referrerId, payeeSub: r?.slug || null,
      referredBy: null, description: p.description || "Referral", amount: Number(p.amount) || 0, currency: currencyConfig(r?.slug || "").currency,
      method, details: r?.paymentDetails || null, rail: railFor(method), dueDate: iso as string, overdue: false, state: "paid", holdReason: null,
      receipt: p.reference || null, paidAt: iso, confirmed: !!p.confirmedAt, sentViaWise: isWiseReceipt(p.reference), health: null,
    });
  }
  for (const a of apps) {
    const entries = Array.isArray(a.monthlyPayouts) ? (a.monthlyPayouts as Entry[]) : [];
    const cur = currencyConfigFor(a.payoutCurrency, a.referredBy).currency;
    const referredBy = a.referredBy ? refNameBySlug.get(a.referredBy.trim().toLowerCase()) || a.referredBy.trim() : null;
    const method = ambMethod(a);
    for (const e of entries) {
      if (cycle(e.paidAt) !== thisCycle) continue;
      const kind: PayoutKind = e.kind === "setup" ? "setup" : "monthly";
      ready.push({
        id: `paid-${kind}:${a.email}:${e.paidAt}`, kind,
        payeeKey: `amb:${a.email.toLowerCase()}`, payeeName: a.fullName || a.email, payeeSub: a.email,
        referredBy, description: kind === "setup" ? "Setup fee" : "Monthly", amount: Number(e.amount) || 0, currency: cur,
        method, details: a.paymentDetails || null, rail: railFor(method), dueDate: e.paidAt as string, overdue: false, state: "paid", holdReason: null,
        receipt: e.proofUrl || null, paidAt: e.paidAt || null, confirmed: !!e.acknowledged, sentViaWise: isWiseReceipt(e.proofUrl), health: healthByEmail.get(a.email.toLowerCase()) || null,
      });
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
