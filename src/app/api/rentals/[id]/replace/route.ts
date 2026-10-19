import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireAuth } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { monthlyRentalPrice } from "@/lib/account-pricing";
import { canReplaceNow } from "@/lib/replacement";
import { grantRentalAccess, revokeRentalAccess } from "@/lib/rental-access";
import { PUBLIC_AVAILABLE_WHERE } from "@/lib/public-inventory";

// Self-serve replacement: swap a RESTRICTED rental for an available account.
// Ends the old rental (status "replaced"), starts a new one that carries the billing date + a
// downtime credit, links the two via replacesRentalId, and grants GoLogin. Same tier or lower
// keeps the locked price with no charge; a pricier pick is a paid upgrade that collects the
// prorated rate difference from the wallet. Exempt from the daily rental cap.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const { newAccountId } = await req.json();
    if (!newAccountId || typeof newAccountId !== "string") {
      return NextResponse.json({ error: "Pick an account to switch to." }, { status: 400 });
    }

    const old = await prisma.rental.findFirst({
      where: { id, userId: user.id },
      include: { linkedinAccount: { select: { id: true, linkedinName: true, restrictedAt: true, permanentlyRestricted: true, connectionCount: true, accountAgeMonths: true, hasSalesNav: true, linkedinVerified: true } } },
    });
    if (!old) return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    if (!["active", "pending_access", "payment_failed"].includes(old.status)) {
      return NextResponse.json({ error: "This rental can no longer be replaced." }, { status: 409 });
    }
    const oldAcct = old.linkedinAccount;
    if (!oldAcct.restrictedAt) {
      return NextResponse.json({ error: "This account isn't restricted, so it can't be replaced." }, { status: 400 });
    }
    // Permanently-restricted accounts skip the recovery hold (there's nothing to wait for).
    if (!oldAcct.permanentlyRestricted && !canReplaceNow(oldAcct.restrictedAt)) {
      return NextResponse.json({ error: "We're still trying to recover this account. Replacement unlocks after the recovery window." }, { status: 409 });
    }

    const oldPrice = monthlyRentalPrice(oldAcct);

    // Carry over the remaining paid time plus a credit for the downtime so far (mirrors the
    // recovery credit in restriction.ts: currentPeriodEnd + time-restricted).
    const downtimeMs = Math.max(0, Date.now() - new Date(oldAcct.restrictedAt).getTime());
    const base = old.currentPeriodEnd ? new Date(old.currentPeriodEnd).getTime() : Date.now();
    const carriedPeriodEnd = new Date(base + downtimeMs);
    // Bank the carried downtime on the new rental so the dashboard shows the applied figure.
    // Carry forward any credit the old rental already banked (e.g. an earlier recovery) since
    // carriedPeriodEnd inherits the old renewal date that those days were already added to.
    const carriedCreditDays = (old.downtimeCreditDays ?? 0) + Math.round(downtimeMs / 86400000);

    let swap: { id: string; charged: number };
    try {
      swap = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${newAccountId}))`;

        // Re-validate the chosen account is still genuinely available (shared definition:
        // excludes restricted / 2FA-reset / segregated-pool / [SHOWCASE]), same tier or lower.
        const picked = await tx.linkedInAccount.findFirst({
          where: { ...PUBLIC_AVAILABLE_WHERE, id: newAccountId },
          select: { id: true, linkedinName: true, connectionCount: true, accountAgeMonths: true, hasSalesNav: true, linkedinVerified: true },
        });
        if (!picked) throw new Error("UNAVAILABLE");
        const newTier = monthlyRentalPrice(picked);
        const effectiveOld = old.lockedPrice ? Number(old.lockedPrice) : oldPrice;
        // Same tier or lower: keep their rate (pay min of locked rate and the new tier), no
        // charge. Pricier than the restricted account's tier: it's a paid UPGRADE — move to the
        // new tier and collect the prorated rate difference for the days left in the paid
        // period. Shadow renters pay a flat rate, so they can't upgrade.
        // It's a paid upgrade only when the new tier costs more than BOTH the restricted
        // account's tier and what they actually pay today — so a pick at or below their current
        // rate is always a free swap (never a confusing "+$0 upgrade" when their locked rate
        // happens to sit above the restricted account's tier).
        const freeCeiling = Math.max(oldPrice, effectiveOld);
        const isUpgrade = newTier > freeCeiling;
        if (isUpgrade && old.isShadow) throw new Error("TIER");
        const newRate = isUpgrade ? newTier : Math.min(effectiveOld, newTier);
        let upgradeDue = 0;
        if (isUpgrade) {
          const dayMs = 86400000;
          const remainingDays = old.currentPeriodEnd
            ? Math.max(0, Math.ceil((new Date(old.currentPeriodEnd).getTime() - Date.now()) / dayMs))
            : 0;
          // Prorated difference between the new rate and what they pay today, over the days
          // left in the already-paid period (credited downtime days are free, so excluded).
          upgradeDue = Math.round(((newTier - effectiveOld) / 30) * remainingDays * 100) / 100;
          if (upgradeDue > 0) {
            // Atomic, race-safe: deduct only if the wallet still covers it (a concurrent
            // renewal could have drawn it down). No silent card charge — a short wallet blocks
            // the upgrade and the renter is asked to top up first.
            const paid = await tx.user.updateMany({
              where: { id: user.id, usdcBalance: { gte: new Prisma.Decimal(upgradeDue) } },
              data: { usdcBalance: { decrement: new Prisma.Decimal(upgradeDue) } },
            });
            if (paid.count === 0) throw new Error(`FUNDS:${upgradeDue}`);
          }
        }

        // Guard against a double-replace: re-read the old rental's status inside the lock.
        const stillOld = await tx.rental.findFirst({ where: { id: old.id, status: { in: ["active", "pending_access", "payment_failed"] } }, select: { id: true } });
        if (!stillOld) throw new Error("ALREADY");

        // One shadow holder per account — don't let a shadow replacement land on an account
        // another shadow renter already holds.
        if (old.isShadow) {
          const held = await tx.rental.count({ where: { linkedinAccountId: picked.id, isShadow: true, status: { in: ["active", "pending_access", "payment_failed"] } } });
          if (held) throw new Error("SHADOWHELD");
        }

        const created = await tx.rental.create({
          data: {
            userId: user.id,
            linkedinAccountId: picked.id,
            usdcPayment: old.usdcPayment,
            autoRenew: old.autoRenew,
            status: "pending_access",
            accessGrantedAt: null,
            // A shadow replacement stays shadow (flat rate, keeps the account catalogue-available);
            // a real replacement takes the new account out of the catalogue.
            isShadow: old.isShadow,
            lockedPrice: new Prisma.Decimal(newRate),
            discountCode: old.discountCode,
            replacesRentalId: old.id,
            // Keep the original rental's "renting since" date so the replacement reads as a
            // continuation, not a brand-new rental.
            startDate: old.startDate,
            currentPeriodEnd: carriedPeriodEnd,
            downtimeCreditDays: carriedCreditDays,
            notes: `Replacement for ${oldAcct.linkedinName} (restricted ${new Date(oldAcct.restrictedAt!).toISOString().slice(0, 10)})`,
          },
          select: { id: true },
        });

        // Record the prorated upgrade charge against the new rental (negative = debit).
        if (upgradeDue > 0) {
          await tx.transaction.create({
            data: {
              userId: user.id,
              type: "rental_payment",
              amount: new Prisma.Decimal(upgradeDue).negated(),
              rentalId: created.id,
              description: `Upgrade to ${picked.linkedinName} (prorated difference)`,
            },
          });
        }

        await tx.rental.update({ where: { id: old.id }, data: { status: "replaced", waitingForRecovery: false, waitChosenAt: null, notes: old.notes ? `${old.notes} · Replaced by ${picked.linkedinName}` : `Replaced by ${picked.linkedinName}` } });

        if (!old.isShadow) {
          // Real rental: new account leaves the catalogue.
          await tx.linkedInAccount.update({ where: { id: picked.id }, data: { status: "rented" } });
          if (oldAcct.permanentlyRestricted) {
            // Permanently gone: retire it — it never comes back to inventory.
            await tx.linkedInAccount.update({ where: { id: oldAcct.id }, data: { status: "removed", removedAt: new Date() } });
          } else {
            // Otherwise free it back but keep it gated by restrictedAt (admin recovers it).
            // Only flag a 2FA reset if this renter actually had the raw 2FA (credentialAccess) —
            // standing rule: a normal g.camp profile share never exposes the code, so no rotation
            // is needed. Flagging it unconditionally would wrongly block the account from
            // re-listing after recovery (PUBLIC_AVAILABLE_WHERE excludes 2FA-reset accounts).
            await tx.linkedInAccount.update({ where: { id: oldAcct.id }, data: { status: "available", twoFactorResetNeeded: user.credentialAccess === true } });
          }
        }
        // Shadow rental: leave both accounts' status untouched (shadow never owns the account).

        return { id: created.id, charged: upgradeDue };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "UNAVAILABLE") return NextResponse.json({ error: "That account was just taken. Pick another." }, { status: 409 });
      if (msg === "TIER") return NextResponse.json({ error: "Upgrades aren't available on this rental." }, { status: 400 });
      if (msg.startsWith("FUNDS:")) {
        const due = Number(msg.slice(6)) || 0;
        return NextResponse.json(
          { error: `You need $${due.toFixed(2)} in your wallet to upgrade. Add funds and try again.`, due, balance: Number(user.usdcBalance ?? 0) },
          { status: 402 }
        );
      }
      if (msg === "ALREADY") return NextResponse.json({ error: "This rental was already replaced." }, { status: 409 });
      if (msg === "SHADOWHELD") return NextResponse.json({ error: "That account is already held. Pick another." }, { status: 409 });
      throw e;
    }
    const newRentalId = swap.id;
    const charged = swap.charged;

    // Stop billing the dead account (card renters). Wallet rentals have no Stripe sub.
    if (old.stripeSubscriptionId) {
      try { await stripe.subscriptions.cancel(old.stripeSubscriptionId); }
      catch (e) { console.error("replace: cancel old Stripe sub failed:", old.stripeSubscriptionId, e instanceof Error ? e.message : e); }
    }
    // Cut access to the restricted account.
    try { await revokeRentalAccess(old.id); }
    catch (e) { console.error("replace: revoke old access failed:", old.id, e instanceof Error ? e.message : e); }
    // A real replacement auto-grants GoLogin on the new account (cron retries if not ready).
    // A shadow replacement is prepared manually (shadow rentals are never auto-granted), so
    // it stays pending_access until the team hands it over — matching normal shadow checkout.
    if (!old.isShadow) {
      try { await grantRentalAccess(newRentalId); }
      catch (e) { console.error("replace: grant new access failed (cron will retry):", newRentalId, e instanceof Error ? e.message : e); }
    }

    return NextResponse.json({ newRentalId, charged });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("replace error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
