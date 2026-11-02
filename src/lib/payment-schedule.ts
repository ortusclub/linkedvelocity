import { prisma } from "@/lib/prisma";
import { isReferralEarned, isReferralMatured, referralMaturesAt, referralCommissionAmount, setupFeeReadyDate } from "@/lib/referrals";
import { type Currency, currencyConfig, currencyConfigFor } from "@/lib/referral-currency";

// Ambassador payout schedule + "who's due to be paid" computation, shared by the
// admin Owners panel and the weekly digest email so both agree exactly.
//
// Amounts are per-referrer currency: PH referrers (and the ambassadors they refer)
// stay ₱ (₱1,000 setup / ₱500 monthly / ₱500 commission); non-PH referrers use USD
// — see lib/referral-currency. SETUP_FEE stays the PH default for legacy callers.

export const SETUP_FEE = 1000;       // one-time ₱ setup fee (PH default)
const DAY = 24 * 60 * 60 * 1000;

// Philippine nationwide non-working days (regular holidays + special non-working days)
// when the LinkedVelocity team is NOT operating, so a payment is never scheduled on one.
// Dates are the Manila calendar day, YYYY-MM-DD. The Ambassador terms promise the monthly
// fee moves to "the first working day where the 1st falls on a weekend or public holiday",
// and this set is what makes that true in code.
//
// UPDATE ANNUALLY from the official Presidential proclamation (add the next year before it
// starts). Movable feasts (Holy Week, Eid, Chinese New Year) change each year — only the
// confirmed dates are listed. In practice only early-month holidays shift a 1st-of-month
// payout, but the full nationwide list is kept so every working-day calculation agrees.
const PH_HOLIDAYS = new Set<string>([
  // 2026 — Proclamation No. 1006 (regular holidays + special non-working days)
  "2026-01-01", // New Year's Day
  "2026-02-17", // Chinese New Year (special non-working)
  "2026-03-20", // Eid'l Fitr (regular; date approximate until moon-sighting)
  "2026-04-02", // Maundy Thursday
  "2026-04-03", // Good Friday
  "2026-04-04", // Black Saturday (special non-working)
  "2026-04-09", // Araw ng Kagitingan
  "2026-05-01", // Labor Day
  "2026-05-27", // Eid'l Adha (regular; date approximate)
  "2026-06-12", // Independence Day
  "2026-08-21", // Ninoy Aquino Day (special non-working)
  "2026-08-31", // National Heroes Day
  "2026-11-01", // All Saints' Day (special non-working)
  "2026-11-02", // All Souls' Day (special non-working)
  "2026-11-30", // Bonifacio Day
  "2026-12-08", // Immaculate Conception (special non-working)
  "2026-12-24", // Christmas Eve (special non-working)
  "2026-12-25", // Christmas Day
  "2026-12-30", // Rizal Day
  "2026-12-31", // Last Day of the Year (special non-working)
  // 2027 — fixed-date nationwide holidays only (movable feasts/Eid to be added from the
  // 2027 proclamation; the ones below are what shift a 1st-of-month payout).
  "2027-01-01", // New Year's Day
  "2027-02-06", // Chinese New Year (special non-working)
  "2027-04-09", // Araw ng Kagitingan
  "2027-05-01", // Labor Day
  "2027-06-12", // Independence Day
  "2027-08-21", // Ninoy Aquino Day (special non-working)
  "2027-08-30", // National Heroes Day (last Mon of August)
  "2027-11-01", // All Saints' Day (special non-working)
  "2027-11-02", // All Souls' Day (special non-working)
  "2027-11-30", // Bonifacio Day
  "2027-12-08", // Immaculate Conception (special non-working)
  "2027-12-24", // Christmas Eve (special non-working)
  "2027-12-25", // Christmas Day
  "2027-12-30", // Rizal Day
  "2027-12-31", // Last Day of the Year (special non-working)
]);

// The Manila calendar day of a Date, as YYYY-MM-DD. Payment dates are built at noon UTC
// from Manila-shifted components (see monthlyDueDate), so the +8h shift keeps the date on
// the intended Manila day for the holiday lookup.
function manilaYMD(d: Date): string {
  const m = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}-${String(m.getUTCDate()).padStart(2, "0")}`;
}

export function isPhHoliday(d: Date): boolean {
  return PH_HOLIDAYS.has(manilaYMD(d));
}

// Roll a date forward to the next working day when it lands on a weekend (Sat/Sun) OR a
// Philippine public holiday, so a payment is never scheduled for a day the team is off.
// Advances one Manila day at a time (handles a holiday landing right after a weekend, e.g.
// the 1st on a Sunday followed by a Monday holiday → Tuesday). Capped so it always returns.
export function nextBusinessDay(d: Date): Date {
  const r = new Date(d);
  for (let i = 0; i < 31; i++) {
    const day = new Date(r.getTime() + 8 * 3600 * 1000).getUTCDay(); // Manila weekday; 0=Sun, 6=Sat
    if (day !== 0 && day !== 6 && !PH_HOLIDAYS.has(manilaYMD(r))) return r;
    r.setUTCDate(r.getUTCDate() + 1);
  }
  return r;
}


// Warm-up window before we log in: 3 days for an established account, 1 week for fresh,
// anchored on when onboarding started. Drives the "log in due" nudge, not a payment.
export function loginDueDate(onboardingStartedAt: Date | string | null, freshness: string | null): Date | null {
  if (!onboardingStartedAt) return null;
  const d = new Date(onboardingStartedAt);
  d.setDate(d.getDate() + (freshness === "fresh" ? 7 : 3));
  return nextBusinessDay(d);
}

// The date the setup fee was PAID drives the monthly schedule (not the onboard date).
// Prefer the "setup" payout entry's paidAt; fall back to the legacy paidAt timestamp.
export function setupPaidDate(paidAt: Date | string | null, monthlyPayouts: unknown): Date | null {
  const arr = Array.isArray(monthlyPayouts) ? (monthlyPayouts as Array<{ kind?: string; paidAt?: string }>) : [];
  const s = arr.find((p) => p?.kind === "setup" && p.paidAt);
  if (s?.paidAt) return new Date(s.paidAt);
  return paidAt ? new Date(paidAt) : null;
}

// Monthly ₱500 begins the first FULL month after the setup fee is PAID, on a 15th-of-
// month cutoff (paid 1st–15th → the 1st of next month; paid 16th–end → the 1st of the
// month after), then the 1st of every month, rolled to the next business day. The Nth
// payment (idx, 0-based) advances by a month. Computed in Manila time so the cutoff
// matches the team's wall clock. Returns null until the setup fee is actually paid.
export function monthlyDueDate(setupPaidAt: Date | string | null, idx: number): Date | null {
  if (!setupPaidAt) return null;
  const m = new Date(new Date(setupPaidAt).getTime() + 8 * 3600 * 1000); // shift to Manila wall clock
  const add = m.getUTCDate() <= 15 ? 1 : 2;
  const base = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + add + idx, 1, 12));
  return nextBusinessDay(base);
}

export interface DueItem {
  kind: "setup" | "monthly";
  name: string;
  email: string;
  method: string | null;
  details: string | null;
  amount: number;
  currency: Currency;
  dueDate: string; // ISO
  overdue: boolean;
  blocked: string | null; // login issue reason — due but can't be paid until resolved
}
export interface ReferralPerson { name: string; url: string | null; dueDate: string; }
export interface MarketerDue { name: string; count: number; dueCount: number; amount: number; currency: Currency; dueDate: string | null; people: ReferralPerson[]; }
export interface MarketerUpcoming { name: string; count: number; amount: number; currency: Currency; dueDate: string; people: ReferralPerson[]; }
export interface MarketerPayment { name: string; amount: number; paidAt: string; }
export interface ReferralDue {
  applicationId: string;
  person: string;          // referred ambassador name
  url: string | null;      // their LinkedIn profile
  referrerName: string;
  referrerId: string | null;
  referrerSlug: string | null;
  amount: number;
  currency: Currency;
  dueDate: string;         // maturation date (past for ready, future for upcoming)
  status: "ready" | "upcoming";
  payVia: string | null;   // referrer's payout method · details
  holdReason?: string | null; // set only on held items (see referralsHeld)
}
export interface PaymentsDue {
  setup: DueItem[];        // setup fees due now / overdue (unpaid)
  monthly: DueItem[];      // monthly due now / overdue
  upcoming: DueItem[];     // due within the horizon (not yet due)
  marketers: MarketerDue[];// commissions ready to pay (onboarded + verified + matured)
  marketersUpcoming: MarketerUpcoming[]; // earned but still maturing (Level 4→5) — due later
  referralsDue: ReferralDue[]; // per-person referral commissions still owed (ready + upcoming)
  referralsHeld: ReferralDue[]; // earned but manually held (blocked) — out of "due now" with a reason
  marketerPayments: MarketerPayment[]; // referral commissions actually paid (drives ✓ Paid rows)
  totalDueNow: number;     // setup + monthly + marketer, due now (PH ₱ only — legacy)
  totalsByCurrency: Record<Currency, number>; // due-now totals split by currency
  horizonDays: number;
}

export async function computePaymentsDue(horizonDays = 7): Promise<PaymentsDue> {
  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const horizonEnd = now + horizonDays * DAY;

  const apps = await prisma.ambassadorApplication.findMany({
    // Payment comes BEFORE the "onboarded" flip — the team pays the owner first, then marks
    // onboarded as the "paid" marker. So the schedule must surface a MATURED account (passed
    // QC, 7-day hold elapsed) even while it is still status=approved and unpaid, or there is a
    // catch-22: you can't see someone to pay them until you've already marked them paid.
    // Include: already-onboarded, already-paid, OR anyone who has passed QC (verifiedAt) and
    // isn't dead (rejected/unreachable). Restricted owners are dropped below; the inventory
    // status (under_construction/available) is NOT a payout gate. The setup bucket's own date
    // logic still splits matured (due now) vs still-maturing (upcoming), and the referral
    // commission gates downstream (isReferralEarned/setupReceipted) stay strict, so broadening
    // this query never credits a referrer before the setup fee is actually settled.
    where: { OR: [{ status: "onboarded" }, { paidAt: { not: null } }, { status: { notIn: ["rejected", "unreachable"] }, verifiedAt: { not: null } }] },
    select: {
      id: true, fullName: true, email: true, linkedinUrl: true, onboardedAt: true,
      accountFreshness: true, paidAt: true, monthlyPayouts: true,
      paymentMethod: true, paymentDetails: true, referredBy: true, referralSource: true, payoutCurrency: true, verifiedAt: true,
      createdAt: true, diyTier: true, status: true, accountIssue: true, onboardingMethod: true, onboardingVerified: true,
      referralHoldReason: true,
    },
  });

  // Live inventory → which onboarded owners actually have an account, and their ₱/mo.
  const accounts = await prisma.linkedInAccount.findMany({
    where: { status: { notIn: ["removed", "retired", "under_review"] } },
    select: { linkedinUrl: true, ambassadorPayment: true, notes: true, restrictedAt: true },
  });
  const urlToEmail = new Map<string, string>();
  for (const a of apps) {
    if (a.linkedinUrl) { urlToEmail.set(a.linkedinUrl, a.email); urlToEmail.set(a.linkedinUrl.replace(/\/$/, ""), a.email); }
  }
  const monthlyByEmail = new Map<string, number>();
  const hasAccount = new Set<string>();
  // Restricted (on-hold) accounts don't get paid — track held vs total per owner so a
  // fully-held owner drops out of "due" entirely and a partly-held owner's monthly
  // sum only counts their live accounts. Mirrors the Account Owners view.
  const totalByEmail = new Map<string, number>();
  const heldByEmail = new Map<string, number>();
  for (const acc of accounts) {
    let email = (acc.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "") || "";
    if (!email && acc.linkedinUrl) email = urlToEmail.get(acc.linkedinUrl) || urlToEmail.get(acc.linkedinUrl.replace(/\/$/, "")) || "";
    if (!email) continue;
    hasAccount.add(email);
    totalByEmail.set(email, (totalByEmail.get(email) || 0) + 1);
    if (acc.restrictedAt) { heldByEmail.set(email, (heldByEmail.get(email) || 0) + 1); continue; }
    monthlyByEmail.set(email, (monthlyByEmail.get(email) || 0) + Number(acc.ambassadorPayment || 0));
  }

  const setup: DueItem[] = [];
  const monthly: DueItem[] = [];
  const upcoming: DueItem[] = [];

  for (const a of apps) {
    if (!hasAccount.has(a.email)) continue; // real owners only (matches Owners page)
    // Every account this owner supplies is restricted → nothing owed while on hold.
    const total = totalByEmail.get(a.email) || 0;
    if (total > 0 && (heldByEmail.get(a.email) || 0) >= total) continue;
    // Currency: a per-owner override wins, else it follows the referrer who signed
    // this ambassador up (PH → ₱, else USD).
    const cfg = currencyConfigFor(a.payoutCurrency, a.referredBy, a);
    const monthlyAmount = monthlyByEmail.get(a.email) || cfg.monthlyAmount;
    const base = { name: a.fullName || a.email, email: a.email, method: a.paymentMethod, details: a.paymentDetails, currency: cfg.currency, blocked: a.accountIssue || null };

    // Setup fee — only if not yet marked paid. Due one week after QC (the same maturation
    // clock the pipeline and referrer portal show), so every view agrees on the date.
    if (!a.paidAt) {
      // Fall back to the onboard date for the rare onboarded account with no QC date, so an
      // owed fee still appears rather than dropping out of the digest.
      const due = setupFeeReadyDate(a.verifiedAt) || (a.onboardedAt ? new Date(a.onboardedAt) : null);
      if (due) {
        const item: DueItem = { ...base, kind: "setup", amount: cfg.setupAmount, dueDate: due.toISOString(), overdue: due < startOfToday };
        if (due.getTime() <= now) setup.push(item);
        else if (due.getTime() <= horizonEnd) upcoming.push(item);
      }
    }

    // Monthly — the next unpaid month. Count only real monthly payouts, never the
    // one-time setup fee (which is stored in the same array with kind "setup"),
    // so the next-due month matches the per-owner card on the Owners page.
    const paidCount = Array.isArray(a.monthlyPayouts)
      ? (a.monthlyPayouts as Array<{ kind?: string }>).filter((p) => p?.kind !== "setup").length
      : 0;
    const nextDue = monthlyDueDate(setupPaidDate(a.paidAt, a.monthlyPayouts), paidCount);
    if (nextDue) {
      const item: DueItem = { ...base, kind: "monthly", amount: monthlyAmount, dueDate: nextDue.toISOString(), overdue: nextDue < startOfToday };
      if (nextDue.getTime() <= now) monthly.push(item);
      else if (nextDue.getTime() <= horizonEnd) upcoming.push(item);
    }
  }

  // Marketer commissions ready to pay — NET of commission already paid, keyed to the
  // referrer's display name (not the slug). Mirrors /admin/referrals so both agree.
  // A referral is fully READY once its account has matured (passed its check window after
  // QC / verifiedAt — 3 days established / 1 week new) or is onboarded; while still maturing
  // it's UPCOMING, with a due date = maturation completion.
  type MatGate = { status: string; verifiedAt: Date | string | null; accountFreshness: string | null };
  const isMatured = (a: MatGate) => isReferralMatured(a);
  type RefPerson = { name: string; url: string | null; dueDate: string };
  // Commission payouts. An ATTRIBUTED payout (ambassadorApplicationId) marks one specific
  // referral paid; legacy lump payouts (no appId) are still netted by amount, oldest first.
  const commPayouts = await prisma.payout.findMany({
    where: { type: "commission", paidAt: { not: null } },
    select: { referrerId: true, amount: true, paidAt: true, ambassadorApplicationId: true },
  });
  const paidAppIds = new Set(commPayouts.map((p) => p.ambassadorApplicationId).filter(Boolean) as string[]);
  const legacyPaidByRefId = new Map<string, number>();
  for (const p of commPayouts) if (!p.ambassadorApplicationId) legacyPaidByRefId.set(p.referrerId, (legacyPaidByRefId.get(p.referrerId) || 0) + Number(p.amount));

  // A referral is only EARNED once the referred account's setup fee is fully SETTLED — the
  // receipt is attached, not merely marked paid. A "paid · awaiting receipt" setup does not
  // yet credit the referrer (mirrors how the owner setup payment itself only settles on the
  // receipt). A manually-onboarded account (status=onboarded) counts as settled even with no
  // stored receipt, to grandfather legacy rows.
  const setupReceipted = (a: (typeof apps)[number]) =>
    a.status === "onboarded" ||
    (Array.isArray(a.monthlyPayouts) ? (a.monthlyPayouts as Array<{ kind?: string; proofUrl?: string }>) : [])
      .some((p) => p?.kind === "setup" && !!p?.proofUrl);

  const earnedByRefSlug = new Map<string, typeof apps>();
  for (const a of apps) {
    const ref = (a.referredBy || "").trim().toLowerCase();
    if (!ref || !isReferralEarned(a) || !setupReceipted(a)) continue;
    const arr = earnedByRefSlug.get(ref) || [];
    arr.push(a);
    earnedByRefSlug.set(ref, arr);
  }
  const refSlugs = [...earnedByRefSlug.keys()];
  const paidRefIds = [...new Set(commPayouts.map((p) => p.referrerId))];
  const referrers = (refSlugs.length || paidRefIds.length)
    ? await prisma.referrer.findMany({ where: { OR: [{ slug: { in: refSlugs } }, { id: { in: paidRefIds } }] }, select: { id: true, name: true, slug: true, paymentMethod: true, paymentDetails: true } })
    : [];
  const refBySlug = new Map(referrers.map((r) => [r.slug.toLowerCase(), r]));
  const refById = new Map(referrers.map((r) => [r.id, r]));
  const marketerPayments: MarketerPayment[] = commPayouts.map((p) => ({ name: refById.get(p.referrerId)?.name || p.referrerId, amount: Number(p.amount), paidAt: (p.paidAt as Date).toISOString() }));

  // Per-person referral dues — one row per still-owed referral, tied to its applicationId.
  const referralsDue: ReferralDue[] = [];
  const referralsHeld: ReferralDue[] = [];
  for (const [slug, list] of earnedByRefSlug) {
    const r = refBySlug.get(slug);
    const cfg = currencyConfig(r?.slug || slug);
    const payVia = r?.paymentDetails ? `${r.paymentMethod || "—"} · ${r.paymentDetails}` : null;
    let legacyRemaining = r ? legacyPaidByRefId.get(r.id) || 0 : 0;
    const sorted = [...list].sort((a, b) => (a.verifiedAt ? new Date(a.verifiedAt).getTime() : 0) - (b.verifiedAt ? new Date(b.verifiedAt).getTime() : 0));
    for (const a of sorted) {
      const amt = referralCommissionAmount(a, cfg.referralTiers);
      if (paidAppIds.has(a.id)) continue;                          // explicitly paid to this person
      const matured = isMatured(a);
      const dueMs = referralMaturesAt(a)?.getTime() ?? Date.now(); // null → already matured/onboarded → due now
      const row: ReferralDue = {
        applicationId: a.id, person: a.fullName, url: a.linkedinUrl,
        referrerName: r?.name || slug, referrerId: r?.id || null, referrerSlug: r?.slug || null,
        amount: amt, currency: cfg.currency, dueDate: new Date(dueMs).toISOString(),
        status: matured ? "ready" : "upcoming", payVia,
      };
      // Manually held (blocked) → out of "due now" and totals, into the Held list. This MUST be
      // checked BEFORE the legacy-lump netting below: a held referral is not payable, so it must
      // not consume a lump payment meant for someone else — otherwise an already-paid, unheld
      // referral is left showing as due (hit: Aiza's held Larry Jaime ate Carl Estrada's paid ₱600).
      if (a.referralHoldReason) { referralsHeld.push({ ...row, holdReason: a.referralHoldReason }); continue; }
      if (legacyRemaining >= amt - 0.001) { legacyRemaining -= amt; continue; } // covered by a legacy lump payout
      referralsDue.push(row);
    }
  }
  referralsHeld.sort((a, b) => a.referrerName.localeCompare(b.referrerName));
  referralsDue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // Aggregate per referrer (backward-compat for the digest) from the per-person dues.
  const aggReady = new Map<string, MarketerDue>();
  const aggUp = new Map<string, MarketerUpcoming>();
  for (const it of referralsDue) {
    const person: RefPerson = { name: it.person, url: it.url, dueDate: it.dueDate };
    if (it.status === "ready") {
      const cur = aggReady.get(it.referrerName) || { name: it.referrerName, count: 0, dueCount: 0, amount: 0, currency: it.currency, dueDate: it.dueDate as string | null, people: [] as RefPerson[] };
      cur.count++; cur.dueCount++; cur.amount += it.amount; cur.people.push(person);
      if (!cur.dueDate || it.dueDate < cur.dueDate) cur.dueDate = it.dueDate;
      aggReady.set(it.referrerName, cur);
    } else {
      const cur = aggUp.get(it.referrerName) || { name: it.referrerName, count: 0, amount: 0, currency: it.currency, dueDate: it.dueDate, people: [] as RefPerson[] };
      cur.count++; cur.amount += it.amount; cur.people.push(person);
      if (it.dueDate < cur.dueDate) cur.dueDate = it.dueDate;
      aggUp.set(it.referrerName, cur);
    }
  }
  const marketers = [...aggReady.values()].sort((a, b) => b.amount - a.amount);
  const marketersUpcoming = [...aggUp.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const sortByDue = (arr: DueItem[]) => arr.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  sortByDue(setup); sortByDue(monthly); sortByDue(upcoming);

  // Totals split by currency — ₱ and $ can't be summed into one figure.
  const totalsByCurrency: Record<Currency, number> = { PHP: 0, USD: 0 };
  for (const i of setup) totalsByCurrency[i.currency] += i.amount;
  for (const i of monthly) totalsByCurrency[i.currency] += i.amount;
  for (const m of marketers) totalsByCurrency[m.currency] += m.amount;

  return { setup, monthly, upcoming, marketers, marketersUpcoming, referralsDue, referralsHeld, marketerPayments, totalDueNow: totalsByCurrency.PHP, totalsByCurrency, horizonDays };
}
