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
  currentPeriodEnd?: string | Date | null;
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
    case "active": {
      // Active but past its billing date = payment is actually overdue (the account is
      // parked / the renewal hasn't been collected yet), NOT "Paid". Date-aware so the
      // dashboard reflects what's really owed instead of showing green on an unpaid rental.
      // Weekly off-platform rentals carry no currentPeriodEnd, so they stay "Paid" here and
      // are flagged separately by the weekly-due logic.
      const end = r.currentPeriodEnd ? new Date(r.currentPeriodEnd) : null;
      if (end && !isNaN(end.getTime()) && end.getTime() < Date.now()) return "Overdue";
      return "Paid";
    }
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
