import { currencyConfigFor } from "@/lib/referral-currency";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto-creds";
import { isCompanyEmail } from "@/lib/company";
import { monthlyDueDate, setupPaidDate } from "@/lib/payment-schedule";
import { setupFeeReadyDate } from "@/lib/referrals";

// Payouts II data — money we pay OUT to the ambassador who supplies each account,
// per account, regardless of whether the account is currently rented. Payout
// history is stored per OWNER (ambassadorApplication.monthlyPayouts), so each of
// an owner's accounts shares that ledger. Admin-only; returns credentials for the
// expandable inventory-style row, same as /api/admin/accounts.

type PayoutEntry = { paidAt?: string; amount?: number; kind?: string; by?: string | null; proofUrl?: string | null; notified?: boolean; notifiedAt?: string | null; acknowledged?: boolean; acknowledgedAt?: string | null };
type Bucket = "setup" | "overdue" | "due" | "paid" | "na";

const sameMonth = (iso: string, y: number, m: number) => {
  const d = new Date(iso);
  return d.getFullYear() === y && d.getMonth() === m;
};

export async function GET() {
  try {
    await requireAdmin();

    const accounts = await prisma.linkedInAccount.findMany({
      // Inventory status is NOT a payout gate (same principle as #449): the setup fee is paid
      // BEFORE the account flips out of under_construction, so a matured owner sits on an
      // under_construction account while unpaid. Only truly-gone accounts are excluded here;
      // the per-row logic below drops restricted / still-onboarding / company rows, and the
      // setup bucket splits matured (due) vs still-maturing (upcoming).
      where: { status: { notIn: ["removed"] } },
      orderBy: { linkedinName: "asc" },
      select: {
        id: true, linkedinName: true, linkedinHeadline: true, linkedinUrl: true,
        location: true, connectionCount: true, accountAgeMonths: true,
        loginEmail: true, accountPassword: true, twoFactor: true, twoFactorResetNeeded: true,
        gologinProfileId: true, gologinShareLink: true,
        status: true, restrictedAt: true, payoutHoldReason: true, monthlyPrice: true, ambassadorPayment: true,
        notes: true,
      },
    });

    const apps = await prisma.ambassadorApplication.findMany({
      select: {
        id: true, email: true, fullName: true, linkedinUrl: true, onboardedAt: true,
        contactNumber: true, contactChannel: true, createdAt: true, diyTier: true, payoutCurrency: true, referredBy: true,
        accountFreshness: true, paidAt: true, verifiedAt: true,
        monthlyPayouts: true, paymentMethod: true, paypalEmail: true, wiseEmail: true,
        paymentDetails: true, payoutName: true, accountIssue: true, status: true,
        qcChecks: true, onboardingFix: true, onboardingMethod: true,
      },
    });

    // When one email has several applications (duplicate signups), prefer the onboarded one
    // so an account resolves to its live owner, not a stale still-onboarding duplicate — which
    // would classify the account "Still onboarding" and silently drop its real payout row.
    const appByEmail = new Map<string, (typeof apps)[number]>();
    for (const a of apps) {
      const key = a.email.toLowerCase();
      const cur = appByEmail.get(key);
      if (!cur || (!cur.onboardedAt && a.onboardedAt)) appByEmail.set(key, a);
    }
    const emailByUrl = new Map<string, string>();
    for (const a of apps) {
      if (a.linkedinUrl) {
        emailByUrl.set(a.linkedinUrl, a.email);
        emailByUrl.set(a.linkedinUrl.replace(/\/$/, ""), a.email);
      }
    }

    const now = Date.now();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    // Maturity is measured in Manila days — identical to the pipeline's matureDaysLeft — so
    // the "Initial payment due" list and the pipeline's "Matured" set are exactly the same
    // people (not off by the server's UTC day boundary).
    const manilaDay = (ms: number) => Math.floor((ms + 8 * 3600000) / 86400000);
    const todayManila = manilaDay(now);
    const cyStart = new Date(); cyStart.setDate(1); cyStart.setHours(0, 0, 0, 0);
    const CY = cyStart.getFullYear(), CM = cyStart.getMonth();

    const rows = accounts.map((a) => {
      // Resolve the external ambassador who owns this account.
      let ownerEmail = (a.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "") || "";
      if (!ownerEmail && a.linkedinUrl) ownerEmail = emailByUrl.get(a.linkedinUrl) || emailByUrl.get(a.linkedinUrl.replace(/\/$/, "")) || "";
      const app = ownerEmail ? appByEmail.get(ownerEmail.toLowerCase()) : undefined;
      const ownerName = app?.fullName || ownerEmail || null;
      const method = app?.paymentMethod || (app?.paypalEmail ? `PayPal: ${app.paypalEmail}` : app?.wiseEmail ? `Wise: ${app.wiseEmail}` : null);
      const methodDetail = app?.paymentDetails || null;

      const payouts: PayoutEntry[] = Array.isArray(app?.monthlyPayouts) ? (app!.monthlyPayouts as PayoutEntry[]) : [];
      const monthlyEntries = payouts.filter((p) => p?.kind !== "setup");
      const totalPaid = payouts.reduce((s, p) => s + Number(p?.amount || 0), 0);
      const last = monthlyEntries.reduce<PayoutEntry | null>((best, p) => (!best || (p.paidAt && best.paidAt && new Date(p.paidAt) > new Date(best.paidAt)) ? p : best), null);
      const monthlyAmount = Number(a.ambassadorPayment || 0);
      const onboardedAt = app?.onboardedAt ? new Date(app.onboardedAt).toISOString() : null;
      const paidCount = monthlyEntries.length;
      // Monthly schedule anchors on when the setup fee was PAID (15th cutoff), not onboarding.
      const setupPaidAt = setupPaidDate(app?.paidAt || null, payouts);
      const nextDue = monthlyDueDate(setupPaidAt, paidCount);
      const firstDue = monthlyDueDate(setupPaidAt, 0);

      // One-time ₱1,000 setup fee (per ambassador). "Logged" = marked paid (paidAt set or a
      // setup entry exists); "receipted" = that setup entry has a proof attached. Like the
      // monthly flow, it isn't fully settled — and doesn't leave the Initial-payment section —
      // until the receipt is on it (which is also what emails the owner).
      const setupEntry = payouts.find((p) => p?.kind === "setup");
      const setupLogged = !!app?.paidAt || !!setupEntry;
      const setupReceipted = !!setupEntry?.proofUrl;
      // Setup fee is due one week after QC (same clock as the pipeline / referrer portal).
      // No QC date → not due yet; the account is still in onboarding (handled below).
      const setupDue = setupFeeReadyDate(app?.verifiedAt || null);

      // Security gate for the INITIAL payment only: the setup fee doesn't become payable
      // until the account is actually secured and clean — mirrors the pipeline's
      // "Mark onboarded (live)" unlock. All three signals come from already-stored fields:
      //   2FA on file (and not pending a post-rental reset),
      //   no open "Chase an issue" (login issue OR unresolved onboarding-fix chips),
      //   the live-onboard security checklist ticked (same items that unlock the button).
      const twoFaMissing = !a.twoFactor || a.twoFactorResetNeeded;
      const fix = (app?.onboardingFix as { issues?: unknown[] } | null) || null;
      const issueOpen = !!(app?.accountIssue && app.accountIssue.trim())
        || (!!fix && Array.isArray(fix.issues) && fix.issues.length > 0);
      // Same items that unlock "Mark onboarded (live)" in the pipeline (pipeline-panel secItems):
      // sessionsOut + noRememberedPw always, plus gologinRemoved for a computer onboarding.
      const qc = (app?.qcChecks as Record<string, boolean> | null) || null;
      const needGologin = app?.onboardingMethod === "computer";
      const checklistDone = !!qc && !!qc.sessionsOut && !!qc.noRememberedPw
        && (!needGologin || !!qc.gologinRemoved);
      const securityBlockReason = twoFaMissing ? "Secure 2FA first"
        : issueOpen ? "Resolve open issue first"
        : !checklistDone ? "Finish security checklist"
        : null;

      // Categorise. Bucket meaning:
      //  setup   → one-time ₱1,000 initial payment still outstanding
      //  overdue → a monthly payout is due and unpaid (or on hold)
      //  due     → a monthly payout is coming up, not yet at its due date
      //  paid    → already paid this cycle
      //  na      → nobody to pay (restricted / inaccessible / company / no rate / no start date)
      let bucket: Bucket = "due";
      let reason = "Up to date";
      let overdue = false;
      // A payout logged this cycle but with no receipt yet — "paid" doesn't count until the
      // receipt is attached (that's also what emails the owner), so it stays out of "Paid".
      let awaitingReceipt = false;
      // Passed QC but still inside the 1-week maturation hold → not payable yet, shown as
      // upcoming (not in the pay-now "Initial payment due" list).
      let maturing = false;
      // Matured + setup not yet paid, but the account isn't cleared to pay yet (2FA / open
      // issue / security checklist). Held out of the pay-now list in its own "Not cleared"
      // group, distinct from time-based maturing.
      let blocked = false;
      let dueISO: string | null = nextDue ? new Date(nextDue).toISOString() : null;

      if (a.restrictedAt) { bucket = "na"; reason = "Restricted"; }
      // Admin payout hold: inaccessible / paused (not a LinkedIn restriction). Held out of
      // the due/overdue chase until released; the specific reason rides along in holdReason.
      else if (a.payoutHoldReason) { bucket = "na"; reason = "On hold"; }
      else if (a.status === "retired") { bucket = "na"; reason = "Inaccessible"; }
      else if (!ownerEmail || isCompanyEmail(ownerEmail)) { bucket = "na"; reason = "Company-owned · no ambassador"; }
      // Still in the onboarding pipeline — no onboarding date means nothing is owed
      // yet and no schedule exists. These belong on the Onboarding page, not here, so
      // they're filtered out below rather than shown as an unpayable "na" row.
      else if (!onboardedAt) { bucket = "na"; reason = "Still onboarding"; }
      // Logged in but not yet QC'd: the setup fee isn't due until a week after QC, so it
      // isn't payable yet. Keep it in the onboarding group (tracked on /admin/onboarding)
      // instead of showing a false "overdue" off the login date.
      else if (!setupLogged && !app?.verifiedAt) { bucket = "na"; reason = "Still onboarding"; }
      else if (!setupReceipted) {
        // Initial ₱1,000 not yet fully settled → its own section, regardless of monthly.
        bucket = "setup";
        if (setupLogged) {
          // Marked paid but no receipt yet — keep it here as "attach receipt" instead of
          // silently leaving the section; attaching the receipt emails the owner and moves it on.
          reason = "Paid · attach receipt"; awaitingReceipt = true; dueISO = null; overdue = false;
        } else if (setupDue && manilaDay(setupDue.getTime()) > todayManila) {
          // Still inside the 1-week maturation hold (QC + 7d, measured in Manila days — same
          // as the pipeline) — keep it visible as upcoming, out of the pay-now due list.
          maturing = true; dueISO = setupDue.toISOString(); overdue = false;
          reason = "Maturing";
        } else if (securityBlockReason) {
          // Matured and unpaid, but not cleared to pay — keep it visible out of the pay-now
          // list with the specific reason, until the security step is done in the pipeline.
          blocked = true; dueISO = setupDue ? setupDue.toISOString() : null; overdue = false;
          reason = securityBlockReason;
        } else {
          dueISO = setupDue ? setupDue.toISOString() : null;
          overdue = !!setupDue && manilaDay(setupDue.getTime()) < todayManila;
          reason = overdue ? "Initial payment overdue" : "Initial payment due";
        }
      }
      else if (monthlyAmount <= 0) { bucket = "na"; reason = "No monthly rate set"; }
      // Year-month comparison (not raw timestamps) — firstDue is anchored at noon UTC
      // on the 1st, so a same-day timezone offset must not hide a monthly due this cycle.
      else if (firstDue && (CY * 12 + CM) >= (firstDue.getUTCFullYear() * 12 + firstDue.getUTCMonth())) {
        // "Paid this cycle" requires a receipt on this cycle's payout. A payout logged
        // without a receipt yet sits in "Paid · attach receipt" (not chased, not yet paid)
        // until the receipt is attached — attaching it also emails the owner.
        const cycleEntry = monthlyEntries.find((p) => p.paidAt && sameMonth(p.paidAt, CY, CM));
        if (cycleEntry?.proofUrl) { bucket = "paid"; reason = "Paid this cycle"; }
        // Marked paid but no receipt yet — keep it right here in the overdue list (so it
        // doesn't vanish), labelled "attach receipt" and NOT chased as late, until the
        // receipt is attached (which then moves it to Paid this cycle).
        else if (cycleEntry) { bucket = "overdue"; reason = "Paid · attach receipt"; awaitingReceipt = true; overdue = false; }
        else if (app?.accountIssue || (!method)) { bucket = "overdue"; reason = app?.accountIssue ? "On hold · login issue" : "On hold · no payment method"; overdue = true; }
        else { bucket = "overdue"; reason = "Payment due"; overdue = true; }
      } else {
        bucket = "due"; reason = "Not due yet";
      }

      const daysLate = overdue && dueISO ? Math.max(0, Math.ceil((now - new Date(dueISO).getTime()) / 86400000)) : 0;

      return {
        id: a.id,
        linkedinName: a.linkedinName,
        linkedinHeadline: a.linkedinHeadline,
        linkedinUrl: a.linkedinUrl,
        location: a.location,
        connectionCount: a.connectionCount,
        accountAgeMonths: a.accountAgeMonths,
        loginEmail: a.loginEmail,
        accountPassword: decryptSecret(a.accountPassword),
        twoFactor: decryptSecret(a.twoFactor),
        gologinProfileId: a.gologinProfileId,
        gologinShareLink: a.gologinShareLink,
        status: a.status,
        monthlyPrice: a.monthlyPrice,
        bucket,
        reason,
        holdReason: a.payoutHoldReason || null,
        awaitingReceipt,
        maturing,
        blocked,
        overdue,
        daysLate,
        ownerName,
        ownerEmail: ownerEmail || null,
        ownerPhone: app?.contactNumber || null,
        contactChannel: app?.contactChannel || null,
        paymentMethod: method,
        paymentDetail: methodDetail,
        payoutName: app?.payoutName || null,
        monthlyAmount,
        lastPaidAt: last?.paidAt || null,
        lastPaidAmount: last?.amount != null ? Number(last.amount) : null,
        nextDueISO: dueISO,
        setupAmount: currencyConfigFor(app?.payoutCurrency, app?.referredBy, app).setupAmount,
        payoutCurrency: currencyConfigFor(app?.payoutCurrency, app?.referredBy, app).currency,
        totalPaid,
        // Owner's application id + full payout ledger, so the whole payment record can be
        // viewed and managed (receipt → auto-email, notified, acknowledged) here instead of
        // having to go back to the pipeline after onboarding.
        applicationId: app?.id || null,
        payouts: payouts.map((p) => ({
          paidAt: p.paidAt || null, amount: Number(p.amount) || 0, kind: p.kind === "setup" ? "setup" : "monthly",
          by: p.by || null, proofUrl: p.proofUrl || null,
          notified: !!p.notified, notifiedAt: p.notifiedAt || null,
          acknowledged: !!p.acknowledged, acknowledgedAt: p.acknowledgedAt || null,
        })),
      };
    });

    // Accounts still being onboarded are tracked on /admin/onboarding — surface only a
    // count here so this page stays a list of things that can actually be paid.
    const stillOnboarding = rows.filter((r) => r.reason === "Still onboarding");
    return NextResponse.json({
      rows: rows.filter((r) => r.reason !== "Still onboarding"),
      onboarding: { count: stillOnboarding.length, names: stillOnboarding.map((r) => r.linkedinName) },
    });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
