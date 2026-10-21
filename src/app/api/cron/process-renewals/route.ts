import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { stripe } from "@/lib/stripe";
import { revokeRentalAccess } from "@/lib/rental-access";
import {
  sendRenewalReminder3dBatch,
  sendRenewalGraceNoticeBatch,
  sendRenewalWinBackBatch,
  sendAccessRevokedBatch,
  sendRenewalConfirmation,
  sendRenewalHeadsUp,
  sendRenewalHeadsUpBatch,
  sendAccessRevokedEmail,
  sendPaymentFailedEmail,
  sendTopUpConfirmation,
} from "@/services/email";

const DAY = 24 * 60 * 60 * 1000;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const firstNameOf = (full: string | null) => (full || "").trim().split(" ")[0] || "";

// Daily renewal pass:
//  - USDC auto-renew: charge from wallet at period end.
//  - Manual renewals (auto-renew OFF): the 3-touch cadence — reminder (3d before) →
//    grace notice (day of, 24h grace) → lapse+revoke (after grace) → win-back (+7d).
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const result = { renewed: 0, cardRenewed: 0, recharged: 0, failed: 0, graced: 0, reminded: 0, graceNoticed: 0, lapsed: 0, winBack: 0, headsUp: 0, released: 0 };

  // Reclaim window: after a rental ends, hold the profile this many days so the same
  // renter can re-pay and keep it, before it's released to others.
  const RECLAIM_DAYS = 3;

  // Dunning grace for USDC auto-renew: if a wallet charge fails (insufficient balance),
  // DON'T cut access on the first miss. Keep the account on and keep retrying daily; only
  // revoke + release once the rental is this many days past its period end and still unpaid.
  // Matches the "release after 3 days of non-payment" policy / the card-rail reclaim window.
  const USDC_GRACE_DAYS = 3;

  try {
    // -1) Auto-recharge (Twilio-style): refill the wallet from the saved card when the balance
    // drops below the renter's threshold. OPT-IN only — autoRechargeEnabled is explicit consent
    // to automatic card charges; we never auto-charge a card without it. Runs before renewals so
    // the refilled balance is available for any charges due today. One recharge per user per day
    // (idempotency key on user+date) so a double cron run can't double-charge.
    const rechargeUsers = await prisma.user.findMany({
      where: {
        autoRechargeEnabled: true,
        stripeCustomerId: { not: null },
        stripePaymentMethodId: { not: null },
        autoRechargeThreshold: { not: null },
        autoRechargeAmount: { not: null },
      },
    });
    const dayKey = now.toISOString().slice(0, 10);
    for (const u of rechargeUsers) {
      const threshold = u.autoRechargeThreshold!;
      const amount = u.autoRechargeAmount!;
      if (u.usdcBalance.greaterThanOrEqualTo(threshold)) continue; // still above threshold
      let ok = false;
      let piId: string | null = null;
      try {
        const pi = await stripe.paymentIntents.create(
          {
            amount: Math.round(Number(amount) * 100),
            currency: "usd",
            customer: u.stripeCustomerId!,
            payment_method: u.stripePaymentMethodId!,
            off_session: true,
            confirm: true,
            description: `Auto-recharge — $${Number(amount).toFixed(0)} to LinkedVelocity balance`,
            metadata: { userId: u.id, type: "auto_recharge" },
          },
          { idempotencyKey: `recharge_${u.id}_${dayKey}` }
        );
        piId = pi.id;
        ok = pi.status === "succeeded";
      } catch (e) {
        // Card declined / needs authentication — skip; the wallet draw-down below handles
        // the shortfall path (grace), same as any other insufficient-balance renewal.
        console.error("auto-recharge charge failed", u.id, e instanceof Error ? e.message : e);
      }
      if (ok && piId) {
        // DB-side idempotency keyed on the PaymentIntent id: the per-day Stripe key means a
        // same-day re-run gets the SAME PI back (one card charge) — but we must credit the
        // wallet only ONCE for it, so skip if this PI was already recorded.
        const already = await prisma.transaction.findFirst({ where: { description: { contains: piId } } });
        if (!already) {
          const updated = await prisma.$transaction(async (tx) => {
            const uu = await tx.user.update({
              where: { id: u.id },
              data: { usdcBalance: { increment: amount } },
              select: { usdcBalance: true },
            });
            await tx.transaction.create({
              data: {
                userId: u.id, type: "deposit",
                amount: new Prisma.Decimal(amount),
                description: `Auto-recharge (card ••${u.cardLast4 ?? ""}) [${piId}]`,
              },
            });
            return uu;
          });
          try {
            await sendTopUpConfirmation({ email: u.email, amount: Number(amount), method: "card", newBalance: Number(updated.usdcBalance) });
          } catch (e) { console.error(e); }
          result.recharged++;
        }
      }
    }

    // 0) Auto-renew ON — pre-charge reminder ~3 days before renewal (Stripe + USDC + card-on-file).
    // For a rental billed to a saved card, this states the exact upcoming charge (amount + card):
    // section 1 will NOT charge a card until this reminder has gone out, so notice always comes first.
    const upcomingAuto = await prisma.rental.findMany({
      where: { shadowExitAt: null, autoRenew: true, status: "active", currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + 3 * DAY) }, linkedinAccount: { restrictedAt: null } },
      include: { user: true, linkedinAccount: true },
    });
    // Split the un-reminded upcoming renewals: card-on-file ones get ONE consolidated reminder
    // per renter (amount + card + total); everything else keeps the generic per-rental heads-up.
    const needHeadsUp = upcomingAuto.filter(
      (r) => r.currentPeriodEnd && !(Array.isArray(r.renewalRemindersSent) ? (r.renewalRemindersSent as string[]) : []).includes("heads_up")
    );
    const cardByUser = new Map<string, typeof needHeadsUp>();
    for (const r of needHeadsUp) {
      const onCard = !r.stripeSubscriptionId && !!r.user.stripePaymentMethodId;
      if (onCard) {
        const arr = cardByUser.get(r.userId) ?? [];
        arr.push(r);
        cardByUser.set(r.userId, arr);
      } else {
        // Generic per-rental reassurance (wallet-only or Stripe-subscription rentals).
        const sent = Array.isArray(r.renewalRemindersSent) ? (r.renewalRemindersSent as string[]) : [];
        try {
          await sendRenewalHeadsUp(r.user.email, firstNameOf(r.user.fullName), fmtDate(new Date(r.currentPeriodEnd!)));
          await prisma.rental.update({ where: { id: r.id }, data: { renewalRemindersSent: [...sent, "heads_up"] as unknown as Prisma.InputJsonValue } });
          result.headsUp++;
        } catch (e) { console.error(e); }
      }
    }
    // One consolidated pre-charge reminder per renter for all their card-on-file renewals.
    for (const [, rentals] of cardByUser) {
      const u = rentals[0].user;
      const items = rentals.map((r) => ({
        account: r.linkedinAccount.linkedinName,
        amount: `$${Number(r.lockedPrice ?? r.linkedinAccount.monthlyPrice).toFixed(0)}`,
        date: fmtDate(new Date(r.currentPeriodEnd!)),
      }));
      const total = `$${rentals.reduce((s, r) => s + Number(r.lockedPrice ?? r.linkedinAccount.monthlyPrice), 0).toFixed(0)}`;
      try {
        if (items.length === 1) {
          await sendRenewalHeadsUp(u.email, firstNameOf(u.fullName), items[0].date, items[0].amount, u.cardLast4);
        } else {
          await sendRenewalHeadsUpBatch(u.email, firstNameOf(u.fullName), items, total, u.cardLast4);
        }
        for (const r of rentals) {
          const sent = Array.isArray(r.renewalRemindersSent) ? (r.renewalRemindersSent as string[]) : [];
          await prisma.rental.update({ where: { id: r.id }, data: { renewalRemindersSent: [...sent, "heads_up"] as unknown as Prisma.InputJsonValue } });
        }
        result.headsUp++;
      } catch (e) { console.error(e); }
    }

    // 1) Auto-renew (wallet + card-on-file) — collect at (or just before) period end.
    // stripeSubscriptionId must be null — a rental with a Stripe subscription is billed on
    // the subscription rail (Stripe charges + the webhook extends it); this cron must never
    // also charge it, or a renter gets double-billed / wrongly revoked.
    // Collection order per rental: wallet balance first, then the saved card on file; if
    // neither covers it, fall into the dunning grace (keep access + retry, release after grace).
    // Charge on/after the due date (lte: now), not a day early — so the ~3-day pre-charge
    // reminder from section 0 always lands before any charge.
    const dueUsdc = await prisma.rental.findMany({
      where: { shadowExitAt: null, usdcPayment: true, stripeSubscriptionId: null, status: "active", autoRenew: true, currentPeriodEnd: { lte: now }, linkedinAccount: { restrictedAt: null } },
      include: { user: true, linkedinAccount: true },
    });
    for (const r of dueUsdc) {
      const price = r.lockedPrice ?? r.linkedinAccount.monthlyPrice;
      const base = r.currentPeriodEnd && r.currentPeriodEnd > now ? new Date(r.currentPeriodEnd) : now;
      const nextPeriodEnd = new Date(base.getFullYear(), base.getMonth() + 1, base.getDate());
      let renewed = false;

      // a) Wallet — if the balance fully covers the price, draw it down.
      if (r.user.usdcBalance.greaterThanOrEqualTo(price)) {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({ where: { id: r.userId }, data: { usdcBalance: { decrement: price } } });
          await tx.rental.update({
            where: { id: r.id },
            data: { currentPeriodEnd: nextPeriodEnd, renewalRemindersSent: [] as unknown as Prisma.InputJsonValue },
          });
          await tx.transaction.create({
            data: {
              userId: r.userId, type: "rental_payment",
              amount: new Prisma.Decimal(price).negated(), rentalId: r.id,
              description: `Monthly renewal for ${r.linkedinAccount.linkedinName}`,
            },
          });
        });
        try { await sendRenewalConfirmation(r.user.email, r.linkedinAccount.linkedinName); } catch (e) { console.error(e); }
        result.renewed++;
        renewed = true;
      } else if (r.user.stripeCustomerId && r.user.stripePaymentMethodId) {
        // Never charge a card without prior notice. If this rental somehow became due without a
        // pre-charge reminder (e.g. the cron missed the 3-day window), send it now and DEFER the
        // charge to a later run — notice must always come first. Normal flow: section 0 already
        // sent it 3 days ago, so heads_up is present here and we charge straight through.
        const remindedC = Array.isArray(r.renewalRemindersSent) ? (r.renewalRemindersSent as string[]) : [];
        if (!remindedC.includes("heads_up")) {
          try {
            await sendRenewalHeadsUp(r.user.email, firstNameOf(r.user.fullName), fmtDate(new Date(r.currentPeriodEnd!)), `$${Number(price).toFixed(0)}`, r.user.cardLast4);
            await prisma.rental.update({ where: { id: r.id }, data: { renewalRemindersSent: [...remindedC, "heads_up"] as unknown as Prisma.InputJsonValue } });
            result.headsUp++;
          } catch (e) { console.error(e); }
          continue; // defer the charge to the next run — no grace/revoke this pass
        }
        // b) Wallet short — charge the saved card on file off-session. The idempotency key is
        // scoped to (rental, period) so a retry (or a crash after the Stripe charge but before
        // our DB write) can never double-charge the same renewal.
        let ok = false;
        try {
          const pi = await stripe.paymentIntents.create(
            {
              amount: Math.round(Number(price) * 100),
              currency: "usd",
              customer: r.user.stripeCustomerId,
              payment_method: r.user.stripePaymentMethodId,
              off_session: true,
              confirm: true,
              description: `Monthly renewal for ${r.linkedinAccount.linkedinName}`,
              metadata: { rentalId: r.id, userId: r.userId, type: "rental_card_renewal" },
            },
            { idempotencyKey: `renew_${r.id}_${base.getTime()}` }
          );
          ok = pi.status === "succeeded";
        } catch (e) {
          // Card declined / needs authentication — leave `ok` false so it drops into grace.
          console.error("card renewal charge failed", r.id, e instanceof Error ? e.message : e);
        }
        if (ok) {
          await prisma.$transaction(async (tx) => {
            await tx.rental.update({
              where: { id: r.id },
              data: { currentPeriodEnd: nextPeriodEnd, renewalRemindersSent: [] as unknown as Prisma.InputJsonValue },
            });
            await tx.transaction.create({
              data: {
                userId: r.userId, type: "rental_payment",
                amount: new Prisma.Decimal(price).negated(), rentalId: r.id,
                description: `Monthly renewal (card ••${r.user.cardLast4 ?? ""}) for ${r.linkedinAccount.linkedinName}`,
              },
            });
          });
          try { await sendRenewalConfirmation(r.user.email, r.linkedinAccount.linkedinName); } catch (e) { console.error(e); }
          result.renewed++;
          result.cardRenewed++;
          renewed = true;
        }
      }

      // c) Neither wallet nor card covered it. Don't cut access on the first miss — keep the
      // account ON and let the cron keep retrying (the rental stays "active" and still due, so
      // every run re-attempts and collects the moment the wallet is funded or the card clears).
      // Only give up, revoke + release once we're USDC_GRACE_DAYS past the period end. During
      // grace we send the soft "payment hiccup" email once (not the hard revoke one); the marker
      // clears on a successful charge (renewalRemindersSent is reset to []).
      if (!renewed) {
        const periodEnd = r.currentPeriodEnd ? new Date(r.currentPeriodEnd) : now;
        const graceCutoff = new Date(periodEnd.getTime() + USDC_GRACE_DAYS * DAY);
        const sent = Array.isArray(r.renewalRemindersSent) ? (r.renewalRemindersSent as string[]) : [];
        if (now >= graceCutoff) {
          // Grace exhausted — revoke access and mark "expired" so the release pass (section 3)
          // cuts access and pulls the account into the after-rental reset, matching the lapse path.
          await prisma.rental.update({ where: { id: r.id }, data: { status: "expired" } });
          // Pause (not delete) the public link — the account is held for the reclaim window,
          // so a renter who re-pays regains access on grant without a fresh link.
          try { await revokeRentalAccess(r.id, { publicLink: "pause" }); } catch (e) { console.error("revoke on grace exhausted", r.id, e); }
          try { await sendAccessRevokedEmail(r.user.email, firstNameOf(r.user.fullName), `${APP_URL}/api/rentals/${r.id}/renew`, fmtDate(graceCutoff), r.linkedinAccount.linkedinName); } catch (e) { console.error(e); }
          result.failed++;
        } else {
          if (!sent.includes("payment_hiccup")) {
            try { await sendPaymentFailedEmail(r.user.email, firstNameOf(r.user.fullName), `${APP_URL}/api/rentals/${r.id}/renew`); } catch (e) { console.error(e); }
            await prisma.rental.update({ where: { id: r.id }, data: { renewalRemindersSent: [...sent, "payment_hiccup"] as unknown as Prisma.InputJsonValue } });
          }
          result.graced++;
        }
      }
    }

    // 2) Manual-renewal cadence — auto-renew OFF rentals (active or recently expired).
    const manual = await prisma.rental.findMany({
      where: { shadowExitAt: null, autoRenew: false, status: { in: ["active", "expired"] }, linkedinAccount: { restrictedAt: null } },
      include: { user: true, linkedinAccount: true },
    });
    // Emails are CONSOLIDATED per renter + stage — one email listing all of the renter's affected
    // accounts, not one per account. First pass classifies each rental into a stage (doing the
    // per-rental side effects like the lapse revoke); second pass sends one batched email per group.
    type RentalRow = (typeof manual)[number];
    type Grp = { user: RentalRow["user"]; first: string; stage: string; items: { account: string; date?: string; amount?: string }[]; rentals: RentalRow[]; graceDeadline?: string; releaseDate?: string };
    const groups = new Map<string, Grp>();
    const enqueue = (r: RentalRow, stage: string, item: { account: string; date?: string; amount?: string }, extra?: { graceDeadline?: string; releaseDate?: string }) => {
      const key = `${r.userId}|${stage}`;
      let g = groups.get(key);
      if (!g) { g = { user: r.user, first: firstNameOf(r.user.fullName), stage, items: [], rentals: [] }; groups.set(key, g); }
      g.items.push(item);
      g.rentals.push(r);
      if (extra?.graceDeadline && (!g.graceDeadline || extra.graceDeadline < g.graceDeadline)) g.graceDeadline = extra.graceDeadline;
      if (extra?.releaseDate && (!g.releaseDate || extra.releaseDate < g.releaseDate)) g.releaseDate = extra.releaseDate;
    };

    for (const r of manual) {
      if (!r.currentPeriodEnd) continue;
      const end = new Date(r.currentPeriodEnd);
      const sent = Array.isArray(r.renewalRemindersSent) ? (r.renewalRemindersSent as string[]) : [];
      const amount = `$${Number(r.lockedPrice ?? r.linkedinAccount.monthlyPrice).toFixed(0)}`;
      const account = r.linkedinAccount.linkedinName;

      // Reminder — within 3 days before the end date.
      if (r.status === "active" && now < end && end.getTime() - now.getTime() <= 3 * DAY && !sent.includes("reminder_3d")) {
        enqueue(r, "reminder_3d", { account, date: fmtDate(end), amount });
        continue;
      }
      // Grace notice — on/after expiry, still within the 24h grace window.
      if (r.status === "active" && now >= end && now < new Date(end.getTime() + DAY) && !sent.includes("grace")) {
        enqueue(r, "grace", { account, amount }, { graceDeadline: fmtDate(new Date(end.getTime() + DAY)) });
        continue;
      }
      // Lapse — grace window passed, still unpaid → revoke + expire (side effects now; email batched).
      // The account is HELD for the reclaim window, not released yet.
      if (r.status === "active" && now >= new Date(end.getTime() + DAY)) {
        await prisma.rental.update({ where: { id: r.id }, data: { status: "expired" } });
        // Pause (not delete) the public link — account is held for the reclaim window.
        try { await revokeRentalAccess(r.id, { publicLink: "pause" }); } catch (e) { console.error("revoke on lapse", r.id, e); }
        enqueue(r, "access_revoked", { account }, { releaseDate: fmtDate(new Date(end.getTime() + RECLAIM_DAYS * DAY)) });
        result.lapsed++;
        continue;
      }
      // Last chance — 1 day before the profiles are released to others.
      if (r.status === "expired" && now >= new Date(end.getTime() + (RECLAIM_DAYS - 1) * DAY) && now < new Date(end.getTime() + RECLAIM_DAYS * DAY) && !sent.includes("winback")) {
        enqueue(r, "winback", { account, amount }, { releaseDate: fmtDate(new Date(end.getTime() + RECLAIM_DAYS * DAY)) });
        continue;
      }
    }

    // Second pass — one consolidated email per (renter, stage), then mark the stage on each rental.
    for (const g of groups.values()) {
      try {
        if (g.stage === "reminder_3d") { await sendRenewalReminder3dBatch(g.user.email, g.first, g.items); result.reminded++; }
        else if (g.stage === "grace") { await sendRenewalGraceNoticeBatch(g.user.email, g.first, g.items, g.graceDeadline || ""); result.graceNoticed++; }
        else if (g.stage === "access_revoked") { await sendAccessRevokedBatch(g.user.email, g.first, g.items, g.releaseDate); }
        else if (g.stage === "winback") { await sendRenewalWinBackBatch(g.user.email, g.first, g.items, g.releaseDate); result.winBack++; }
      } catch (e) { console.error("batch renewal email failed", g.stage, e); }
      // access_revoked needs no marker — the status → "expired" change stops it re-firing.
      if (g.stage !== "access_revoked") {
        for (const r of g.rentals) {
          const sent = Array.isArray(r.renewalRemindersSent) ? (r.renewalRemindersSent as string[]) : [];
          try { await prisma.rental.update({ where: { id: r.id }, data: { renewalRemindersSent: [...sent, g.stage] as unknown as Prisma.InputJsonValue } }); } catch (e) { console.error(e); }
        }
      }
    }

    // 3) Release held profiles — reclaim window is over and still unpaid → cut real access
    // (delete the public link) and pull the account into the after-rental reset
    // (under_construction), NOT straight back into the rentable catalogue.
    const heldOut = await prisma.rental.findMany({
      where: {
        status: { in: ["expired", "cancelled"] },
        currentPeriodEnd: { lte: new Date(now.getTime() - RECLAIM_DAYS * DAY) },
        linkedinAccount: { status: "rented" },
      },
      include: { linkedinAccount: true },
    });
    for (const r of heldOut) {
      const sent = Array.isArray(r.renewalRemindersSent) ? (r.renewalRemindersSent as string[]) : [];
      if (sent.includes("released")) continue;
      // Don't release if the renter reclaimed it (a fresh active/pending rental exists).
      const reclaimed = await prisma.rental.count({
        where: { linkedinAccountId: r.linkedinAccountId, status: { in: ["active", "pending_access"] } },
      });
      if (reclaimed > 0) { await prisma.rental.update({ where: { id: r.id }, data: { renewalRemindersSent: [...sent, "released"] as unknown as Prisma.InputJsonValue } }); continue; }

      // Cut REAL access before freeing the account: delete the public (g.camp) link. If
      // GoLogin refuses, do NOT mark the account available — surfacing a profile the old
      // renter can still open is the shadow-leak bug. Hold it and retry next run instead.
      try {
        await revokeRentalAccess(r.id, { publicLink: "delete" });
      } catch (e) {
        console.error("release: public link delete failed, holding account", r.linkedinAccountId, e);
        continue;
      }
      // After-rental reset: do NOT drop straight back into the catalogue with the last
      // renter's sessions, campaigns and inbox still on the profile. Pull it to
      // under_construction (hidden) and clear the rental-ready checklist, so the housekeeping
      // gate (sign out other sessions, disconnect automation, clear the inbox) must be redone
      // before it can be re-listed Available. The waitlist is notified when it re-lists, not
      // here — the account is not actually available yet.
      await prisma.linkedInAccount.update({
        where: { id: r.linkedinAccountId },
        data: { status: "under_construction", listed: false, rentalReadyChecklist: {} },
      });
      await prisma.rental.update({ where: { id: r.id }, data: { renewalRemindersSent: [...sent, "released"] as unknown as Prisma.InputJsonValue } });
      result.released++;
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Renewal cron error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Vercel Cron Jobs trigger the endpoint with a GET request (carrying the CRON_SECRET bearer),
// so a GET handler is REQUIRED or the daily job never runs (405). Alias it to POST, which also
// stays available for manual triggering.
export async function GET(req: NextRequest) {
  return POST(req);
}
