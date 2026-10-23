import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { rentalReadyStatus, type ChecklistState } from "@/lib/rental-ready";

// Inventory v2 read endpoint. Returns the SAME per-account shape as
// /api/admin/accounts (so the v2 page has every field the live inventory has),
// PLUS two derived metrics the v2 mock needs:
//   - earnedTotal  : all-time gross collected for the account (off-platform crypto
//                    payments + on-platform rental_payment transactions, minus refunds).
//   - utilisation  : lifetime rented share = rented-days / days-since-we-got-it (0..1).
// It is intentionally separate from the live inventory route: the live page stays
// fast and untouched while v2 iterates. Consolidate when v2 is promoted.
//
// It ALSO returns a top-line `grossCollectedAllTime`. The per-account `earnedTotal`
// CANNOT see wallet-funded rentals: the real cash-in is a `deposit` with no rentalId
// (so it can't be attributed to an account), and the rental itself is stored as a
// NEGATIVE wallet-debit that we clamp to 0 — so summing earnedTotal badly under-counts.
// For the headline figure we sum the ledger directly instead, counting each payment once:
//   wallet deposits(+) + direct rental_payments(+) + off-platform crypto − refunds.
// Sweeps (internal crypto moves — may double-count deposits) and adjustments (manual
// credits, not "collected") are excluded. Off-ledger billing (e.g. ProfilePartner's
// manual period bumps) is invisible to any ledger sum and is NOT captured here.

const DAY = 86400000;

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin();

    const accounts = await prisma.linkedInAccount.findMany({
      where: {
        status: { in: ["under_review", "available", "rented", "trial", "maintenance", "under_construction", "construction_immature", "unavailable", "retired"] },
      },
      include: {
        rentals: {
          // Include pending_access too: a paid rental whose GoLogin share hasn't gone out
          // yet still has a real renter — show their name (awaiting access), not
          // "Shadow / no renter". Rented is rented, regardless of access state.
          where: { status: { in: ["active", "pending_access", "payment_failed"] }, isShadow: false },
          include: { user: { select: { id: true, fullName: true, email: true } } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        cryptoPayments: { select: { amount: true, paidAt: true }, orderBy: { paidAt: "desc" }, take: 100 },
      },
      orderBy: { createdAt: "desc" },
    });
    const ids = accounts.map((a) => a.id);

    // ── Earned: off-platform (crypto) ──
    const cryptoSums = ids.length
      ? await prisma.cryptoPayment.groupBy({ by: ["linkedinAccountId"], where: { linkedinAccountId: { in: ids } }, _sum: { amount: true } })
      : [];
    const cryptoByAccount = new Map(cryptoSums.map((r) => [r.linkedinAccountId, Number(r._sum.amount ?? 0)]));

    // Account-mail row flags: unreviewed security emails (amber) and open incidents (red).
    const mailStatusCounts = ids.length
      ? await prisma.accountMailEvent.groupBy({ by: ["linkedinAccountId", "status"], where: { linkedinAccountId: { in: ids }, status: { in: ["needs_review", "incident"] } }, _count: { _all: true } })
      : [];
    const mailNeedsReviewByAccount = new Map<string, number>();
    const mailIncidentByAccount = new Map<string, number>();
    for (const r of mailStatusCounts) {
      (r.status === "incident" ? mailIncidentByAccount : mailNeedsReviewByAccount).set(r.linkedinAccountId, r._count._all);
    }

    // ── Earned: on-platform (rental_payment − refund), attributed via rental → account ──
    const txns = ids.length
      ? await prisma.transaction.findMany({
          where: { rentalId: { not: null }, type: { in: ["rental_payment", "refund"] }, rental: { linkedinAccountId: { in: ids } } },
          select: { amount: true, type: true, rental: { select: { linkedinAccountId: true } } },
        })
      : [];
    // Ledger sign quirk: wallet-funded rentals store rental_payment NEGATIVE (a wallet
    // debit — the real cash-in was the wallet deposit, which has no rentalId so we can't
    // attribute it to an account). TRON/direct rentals store it POSITIVE (money received).
    // So only count POSITIVE rental_payment as collected, and subtract refunds. (Clamped
    // to >= 0 below.) Approximate by design: wallet-only rentals under-count here.
    const txnByAccount = new Map<string, number>();
    for (const t of txns) {
      const acc = t.rental?.linkedinAccountId;
      if (!acc) continue;
      const amt = Number(t.amount ?? 0);
      const signed = t.type === "refund" ? -Math.abs(amt) : Math.max(0, amt);
      txnByAccount.set(acc, (txnByAccount.get(acc) ?? 0) + signed);
    }

    // ── Utilisation: sum of rental spans / days owned ──
    const allRentals = ids.length
      ? await prisma.rental.findMany({
          where: { linkedinAccountId: { in: ids }, isShadow: false },
          select: { linkedinAccountId: true, startDate: true, currentPeriodEnd: true },
        })
      : [];
    const rentedMsByAccount = new Map<string, number>();
    const now = Date.now();
    for (const r of allRentals) {
      const start = r.startDate ? new Date(r.startDate).getTime() : now;
      const end = Math.min(r.currentPeriodEnd ? new Date(r.currentPeriodEnd).getTime() : now, now);
      const span = Math.max(0, end - start);
      rentedMsByAccount.set(r.linkedinAccountId, (rentedMsByAccount.get(r.linkedinAccountId) ?? 0) + span);
    }

    // ── Owner resolution (mirrors /api/admin/accounts so v2 has the same fields) ──
    const ownerEmails = accounts
      .map((a) => (a.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, ""))
      .filter(Boolean) as string[];
    const ownerUsers = ownerEmails.length ? await prisma.user.findMany({ where: { email: { in: ownerEmails } }, select: { email: true, fullName: true } }) : [];
    const ownerMap = new Map(ownerUsers.map((u) => [u.email, u.fullName]));
    // Load ALL applications (not just those named in an Owner note) so an account can match its
    // pipeline row by linkedinUrl OR owner email — and carry that row's profile data into inventory.
    const ownerApps = await prisma.ambassadorApplication.findMany({
      select: {
        id: true, email: true, linkedinUrl: true, fullName: true, location: true, industry: true, connectionCount: true, contactNumber: true, contactChannel: true,
        referredBy: true, referralSource: true, poc: true, ownerStatus: true, payoutCurrency: true, status: true,
        paymentMethod: true, paymentDetails: true, payoutName: true, paypalEmail: true, wiseEmail: true,
        onboardedAt: true, paidAt: true, outreachLog: true, nextFollowUp: true, updatedAt: true,
      },
    });
    const normUrl = (u?: string | null) => (u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("?")[0].replace(/\/+$/, "");
    const appMap = new Map(ownerApps.map((x) => [x.email.toLowerCase(), x]));
    const appByUrl = new Map(ownerApps.filter((x) => x.linkedinUrl).map((x) => [normUrl(x.linkedinUrl), x]));

    const referrers = await prisma.referrer.findMany({ select: { slug: true, name: true, email: true, contacts: true, contactMethod: true, contactHandle: true } });
    const refBySlug = new Map(referrers.map((r) => [r.slug.toLowerCase(), r]));
    const issueContactFor = (slug?: string | null) => {
      const r = refBySlug.get((slug || "").trim().toLowerCase());
      if (!r) return null;
      const contacts = (Array.isArray(r.contacts) ? r.contacts : []) as Array<{ method?: string; handle?: string; preferred?: boolean }>;
      const byMethod = (method: string) => contacts.find((c) => c.preferred && c.method?.toLowerCase() === method)?.handle || contacts.find((c) => c.method?.toLowerCase() === method)?.handle || (r.contactMethod?.toLowerCase() === method ? r.contactHandle : null);
      return { email: r.email || byMethod("email"), whatsapp: byMethod("whatsapp"), telegram: byMethod("telegram"), viber: byMethod("viber") };
    };

    // Shadow renters (account stays "Available" but someone is quietly on it).
    const shadowRentals = ids.length
      ? await prisma.rental.findMany({ where: { isShadow: true, status: { in: ["active", "pending_access", "payment_failed"] }, linkedinAccountId: { in: ids } }, select: { linkedinAccountId: true, user: { select: { email: true } } } })
      : [];
    const shadowByAccount = new Map(shadowRentals.map((r) => [r.linkedinAccountId, r.user.email]));

    // Accounts where a rental still holds a live GoLogin share (revoke didn't clear it) — auto
    // condition for the rental-ready gate ("GoLogin share cleared").
    const shareRows = ids.length
      ? await prisma.rental.findMany({ where: { linkedinAccountId: { in: ids } }, select: { linkedinAccountId: true, gologinShareIds: true } })
      : [];
    const gologinSharedSet = new Set(shareRows.filter((r) => Array.isArray(r.gologinShareIds) && (r.gologinShareIds as unknown[]).length > 0).map((r) => r.linkedinAccountId));

    const out = accounts.map((a) => {
      const ownerEmail = (a.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "") || "";
      const app = (a.linkedinUrl ? appByUrl.get(normUrl(a.linkedinUrl)) : undefined) || (ownerEmail ? appMap.get(ownerEmail.toLowerCase()) : undefined);
      const ownedMs = Math.max(DAY, now - new Date(a.createdAt).getTime());
      const rentedMs = rentedMsByAccount.get(a.id) ?? 0;
      const earnedTotal = Math.max(0, Math.round(((cryptoByAccount.get(a.id) ?? 0) + (txnByAccount.get(a.id) ?? 0)) * 100) / 100);
      return {
        ...a,
        mailNeedsReview: mailNeedsReviewByAccount.get(a.id) ?? 0,
        mailIncidentOpen: mailIncidentByAccount.get(a.id) ?? 0,
        // Whether the rental-ready housekeeping checklist passes (for the sweep flag on the row).
        gologinStillShared: gologinSharedSet.has(a.id),
        rentalReady: rentalReadyStatus({ ...a, gologinShared: gologinSharedSet.has(a.id) }, a.rentalReadyChecklist as ChecklistState).ready,
        // Carry pipeline (application) profile data into inventory when the account's own is blank.
        linkedinUrl: a.linkedinUrl || app?.linkedinUrl || null,
        location: a.location || app?.location || null,
        industry: a.industry || app?.industry || null,
        linkedinName: a.linkedinName || app?.fullName || null,
        earnedTotal,
        utilisation: Math.min(1, Math.max(0, rentedMs / ownedMs)),
        ownerName: ownerMap.get(ownerEmail) || app?.fullName || ownerEmail || null,
        ownerEmail: ownerEmail || null,
        ownerApplicationId: app?.id || null,
        issueReferrerName: refBySlug.get((app?.referredBy || "").trim().toLowerCase())?.name || null,
        issueEmailFrom: process.env.RESEND_FROM_EMAIL || "LinkedVelocity <info@linkedvelocity.com>",
        issueAmbassadorEmail: app?.email || ownerEmail || null,
        issueReferrerContact: issueContactFor(app?.referredBy),
        ownerUpdatedAt: app?.updatedAt ?? null,
        ownerOutreachLog: app?.outreachLog ?? null,
        ownerNextFollowUp: app?.nextFollowUp ?? null,
        ownerPhone: app?.contactNumber || null,
        contactChannel: app?.contactChannel || null,
        ownerReferredBy: app?.referredBy || null,
        ownerPayoutCurrency: app?.payoutCurrency || null,
        ownerReferralSource: app?.referralSource || null,
        ownerPoc: app?.poc || a.poc || null,
        ownerStatus: app?.ownerStatus || null,
        ownerPaymentMethod: app?.paymentMethod || (app?.paypalEmail ? `PayPal: ${app.paypalEmail}` : app?.wiseEmail ? `Wise: ${app.wiseEmail}` : null),
        ownerPaymentDetails: app?.paymentDetails || null,
        ownerPayoutName: app?.payoutName || null,
        ownerOnboardedAt: app?.onboardedAt || null,
        ownerSetupPaidAt: app?.paidAt || null,
        // Onboarded if the app status says so OR onboardedAt is set — matches the pipeline's
        // Level-5 definition (pipeline-model levelOf), which also treats an available+paid account
        // as onboarded even while the app status still reads "approved". Keeps the two views in sync
        // so a live account doesn't get stuck showing as "Construction" in inventory.
        ownerOnboarded: app?.status === "onboarded" || !!app?.onboardedAt,
        shadowRenter: shadowByAccount.get(a.id) || null,
      };
    });

    // ── Top-line gross collected, all-time (ledger-direct; see header note) ──
    const grossRows = await prisma.$queryRaw<{ gross: number | string | null }[]>`
      SELECT
          COALESCE((SELECT SUM(amount)      FROM transactions   WHERE type = 'deposit'        AND amount > 0), 0)
        + COALESCE((SELECT SUM(amount)      FROM transactions   WHERE type = 'rental_payment' AND amount > 0), 0)
        + COALESCE((SELECT SUM(amount)      FROM crypto_payments),                                            0)
        - COALESCE((SELECT SUM(ABS(amount)) FROM transactions   WHERE type = 'refund'),                       0)
        AS gross`;
    const grossCollectedAllTime = Math.max(0, Math.round(Number(grossRows[0]?.gross ?? 0)));

    return NextResponse.json({ accounts: out, grossCollectedAllTime });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
