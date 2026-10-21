// Shared derivations for the renter tracker (admin UI + CSV export), so both
// always show the same labels.

type ShareRef = { email?: string; shareId?: string };

export interface TrackerRental {
  status: string;
  usdcPayment?: boolean;
  paused?: boolean;
  accessGrantedAt?: string | Date | null;
  accessRevokedAt?: string | Date | null;
  gologinShareIds?: unknown;
}

// True when access was granted but the system has no stored GoLogin share to
// auto-revoke (e.g. it was shared manually). Such rentals still show "Granted",
// but pausing them needs a manual GoLogin step too.
export function isManualGrant(r: TrackerRental): boolean {
  const shares = Array.isArray(r.gologinShareIds) ? (r.gologinShareIds as ShareRef[]) : [];
  return shares.length === 0 && !!r.accessGrantedAt && !r.accessRevokedAt && !r.paused;
}

export function paymentMethod(r: TrackerRental): "USDC" | "Stripe" {
  return r.usdcPayment ? "USDC" : "Stripe";
}

// Money state: did they pay, are we waiting, or is it overdue/ended?
export function paymentStatus(r: TrackerRental): "Paid" | "Pending" | "Overdue" | "Expired" | "Cancelled" {
  switch (r.status) {
    case "active":
      return "Paid";
    case "pending_access":
      return "Pending";
    case "payment_failed":
      return "Overdue";
    case "expired":
      return "Expired";
    case "cancelled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

// --- Off-platform weekly rentals -------------------------------------------
// These experimental rentals (paid weekly in USDT off-site, GoLogin shared
// manually) deliberately carry no currentPeriodEnd, so the monthly renewal cron
// never touches them. Their weekly payment cadence lives in a machine-readable
// marker in the rental notes — the same "parse a tag out of notes" pattern the
// account list uses for "Profile email:". Marker format (kept human-readable):
//   [weekly $30 due 2026-07-17]
// where the date is the NEXT payment due date. The admin "Mark paid" button rolls
// it forward one week.
const WEEKLY_RE = /\[weekly \$(\d+(?:\.\d+)?) due (\d{4}-\d{2}-\d{2})\]/i;

export interface WeeklyBilling {
  amount: number;      // numeric weekly price, e.g. 30
  amountRaw: string;   // as written in the marker, e.g. "30" (preserves formatting)
  nextDue: string;     // YYYY-MM-DD of the next payment due
  marker: string;      // the exact matched marker substring
}

export function weeklyBilling(notes: string | null | undefined): WeeklyBilling | null {
  const m = (notes || "").match(WEEKLY_RE);
  if (!m) return null;
  return { amount: parseFloat(m[1]), amountRaw: m[1], nextDue: m[2], marker: m[0] };
}

export type WeeklyTone = "overdue" | "due" | "soon" | "ok";
export interface WeeklyDueState { label: string; tone: WeeklyTone; days: number }

// Whole-day difference between today and the due date, computed from local
// calendar components on both sides so it never drifts by a timezone offset.
export function weeklyDueState(nextDue: string, now: Date = new Date()): WeeklyDueState {
  const due = new Date(nextDue + "T00:00:00");
  const d0 = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const t0 = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((d0 - t0) / 86400000);
  if (days < 0) return { label: `Overdue ${-days}d`, tone: "overdue", days };
  if (days === 0) return { label: "Due today", tone: "due", days };
  if (days <= 2) return { label: `Due in ${days}d`, tone: "soon", days };
  return { label: `Due in ${days}d`, tone: "ok", days };
}

// Return `notes` with the weekly due date advanced one week (for "Mark paid").
// No-op if there's no marker.
export function advanceWeeklyNotes(notes: string | null | undefined): string {
  const b = weeklyBilling(notes);
  if (!b) return notes || "";
  const d = new Date(b.nextDue + "T00:00:00");
  d.setDate(d.getDate() + 7);
  const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
  return (notes || "").replace(b.marker, `[weekly $${b.amountRaw} due ${y}-${mo}-${da}]`);
}

// A single "last payment confirmed on-chain" audit tag the weekly-payment cron
// writes into notes, e.g.  [paid 2026-07-19 tx 7f873227]  — surfaced in admin so
// the team can see the last auto-detected payment (and its tx) at a glance.
const PAID_RE = /\[paid (\d{4}-\d{2}-\d{2}) tx ([0-9a-fA-F]{6,16})\]/;

export interface WeeklyPaidStamp { date: string; tx: string }

export function weeklyPaidStamp(notes: string | null | undefined): WeeklyPaidStamp | null {
  const m = (notes || "").match(PAID_RE);
  return m ? { date: m[1], tx: m[2] } : null;
}

// Advance the weekly due date one week AND record the confirmed payment (date +
// short tx id). Replaces any prior [paid …] tag so only the latest is kept.
export function confirmWeeklyPayment(notes: string | null | undefined, paidDate: string, txId: string): string {
  const advanced = advanceWeeklyNotes(notes);
  const stamp = `[paid ${paidDate} tx ${txId.slice(0, 8)}]`;
  const stripped = advanced.replace(PAID_RE, "").replace(/[ \t]{2,}/g, " ").trimEnd();
  return `${stripped} ${stamp}`.trim();
}

// --- Off-platform DAILY rentals --------------------------------------------
// Like the weekly rentals above, but billed per-day to a UNIQUE TRON address
// (one address per renter). Because each renter has their own address, payments
// are identified by *recipient* rather than by amount — so two renters can pay
// the same daily rate without colliding. Config marker (set once at rental
// creation, never rewritten):
//   [daily $8 from 2026-08-07]
// where the date is when tracking started (access granted). The daily-payment
// cron sums every USDT received on the renter's address and writes a separate,
// self-updating stamp carrying the computed next-due date + running total:
//   [daily-paid nextdue 2026-08-10 total 24 tx a1b2c3d4]
const DAILY_RE = /\[daily \$(\d+(?:\.\d+)?) from (\d{4}-\d{2}-\d{2})\]/i;

export interface DailyBilling {
  rate: number;    // numeric daily price, e.g. 8
  rateRaw: string; // as written, e.g. "8" (preserves formatting)
  from: string;    // YYYY-MM-DD tracking start (access date)
  marker: string;  // the exact matched marker substring
}

export function dailyBilling(notes: string | null | undefined): DailyBilling | null {
  const m = (notes || "").match(DAILY_RE);
  if (!m) return null;
  return { rate: parseFloat(m[1]), rateRaw: m[1], from: m[2], marker: m[0] };
}

const DAILY_PAID_RE = /\[daily-paid nextdue (\d{4}-\d{2}-\d{2}) total (\d+(?:\.\d+)?)(?: tx ([0-9a-fA-F]{6,16}))?\]/;

export interface DailyPaidStamp { nextDue: string; total: number; tx: string | null }

export function dailyPaidStamp(notes: string | null | undefined): DailyPaidStamp | null {
  const m = (notes || "").match(DAILY_PAID_RE);
  return m ? { nextDue: m[1], total: parseFloat(m[2]), tx: m[3] || null } : null;
}

// Add N whole days to a YYYY-MM-DD string, return YYYY-MM-DD.
export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

// Whole days a given USDT total covers at `rate`/day. The small epsilon absorbs
// rounding (e.g. 23.999 received for 3 days at $8 still counts as 3).
export function daysCovered(total: number, rate: number): number {
  if (rate <= 0) return 0;
  return Math.floor((total + 0.01) / rate);
}

// The next payment-due date = tracking start advanced by the number of paid days.
export function dailyNextDue(from: string, daysPaid: number): string {
  return addDays(from, daysPaid);
}

// Daily reuses the weekly due-state maths — both are "how many days until this
// date", same labels and tones.
export function dailyDueState(nextDue: string, now: Date = new Date()): WeeklyDueState {
  return weeklyDueState(nextDue, now);
}

// Write/replace the cron's self-updating daily-paid stamp in notes.
export function stampDailyPaid(notes: string | null | undefined, nextDue: string, total: number, txId: string | null): string {
  const totalStr = Number.isInteger(total) ? String(total) : total.toFixed(2);
  const stamp = txId
    ? `[daily-paid nextdue ${nextDue} total ${totalStr} tx ${txId.slice(0, 8)}]`
    : `[daily-paid nextdue ${nextDue} total ${totalStr}]`;
  const stripped = (notes || "").replace(DAILY_PAID_RE, "").replace(/[ \t]{2,}/g, " ").trimEnd();
  return `${stripped} ${stamp}`.trim();
}

// GoLogin access state, independent of payment.
export function accessStatus(r: TrackerRental): "Granted" | "Paused" | "Revoked" | "Not granted" {
  if (r.paused) return "Paused";
  const shares = Array.isArray(r.gologinShareIds) ? (r.gologinShareIds as ShareRef[]) : [];
  if (shares.length > 0) return "Granted";
  // Granted manually (no stored share) — still counts as granted.
  if (r.accessGrantedAt && !r.accessRevokedAt) return "Granted";
  if (r.accessRevokedAt) return "Revoked";
  return "Not granted";
}
