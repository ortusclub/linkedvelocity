import { monthlyRentalPrice } from "@/lib/account-pricing";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { Prisma } from "@/generated/prisma/client";
import { sendRentalReadyEmail, sendRentalNotification } from "@/services/email";
import { grantRentalAccess } from "@/lib/rental-access";
import { SALES_NAV_MONTHLY } from "@/lib/utils";
import { SHADOW_MONTHLY_PRICE, yieldShadowRentals, isShadowRenterEmail, shadowRateFor } from "@/lib/shadow-rental";
import { lookupDiscount, discountedPrice, consumeDiscount, type AppliedDiscount } from "@/lib/discounts";
import { PUBLIC_AVAILABLE_WHERE, RENTABLE_WHERE, SEGREGATED_POOLS } from "@/lib/public-inventory";

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const { accountIds, autoRenew = true, discountCode: rawDiscountCode, direct } = await req.json();

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return NextResponse.json({ error: "No accounts selected" }, { status: 400 });
    }

    // Direct rent link (single account): the account may be on hold for this very person, so
    // validate against RENTABLE_WHERE (ignores holds) instead of the catalogue filter.
    const rentableWhere = direct === true && accountIds.length === 1 ? RENTABLE_WHERE : PUBLIC_AVAILABLE_WHERE;

    // Accounts the renter chose to add Sales Navigator to (+$70/mo each). Only
    // honoured for accounts that don't already include it.
    // Sales Navigator add-on withdrawn (2026-09-23): a request that still sends
    // salesNavAccountIds is ignored, so nothing can be billed for it.
    const salesNavSet = new Set<string>();

    // Shadow renter (e.g. Apex Strategy): rents idle accounts at a flat rate without
    // taking them out of the catalogue, and gets auto-yielded when a real customer rents
    // the same account. Identified by a flag on the User (not a hardcoded email).
    const isShadow = user.isShadowRenter === true || isShadowRenterEmail(user.email);

    let accounts = await prisma.linkedInAccount.findMany({
      // Shared "genuinely rentable" definition (real OR shadow buy): excludes restricted /
      // 2FA-reset accounts, segregated pools, and [SHOWCASE] teasers.
      where: { ...rentableWhere, id: { in: accountIds } },
    });

    // Each account can be shadow-bought by only ONE shadow renter at a time — drop any
    // account that ALREADY has an active shadow rental (this renter's OR the other shadow
    // renter's), so two shadow buyers can never hold the same account.
    if (isShadow && accounts.length) {
      const already = await prisma.rental.findMany({
        where: {
          isShadow: true,
          status: { in: ["active", "pending_access", "payment_failed"] },
          linkedinAccountId: { in: accounts.map((a) => a.id) },
        },
        select: { linkedinAccountId: true },
      });
      const heldIds = new Set(already.map((r) => r.linkedinAccountId));
      accounts = accounts.filter((a) => !heldIds.has(a.id));
    }

    if (accounts.length === 0) {
      return NextResponse.json({ error: "No selected accounts are available" }, { status: 400 });
    }

    // Daily rental cap (anti-burn speed limit). A real renter may start at most
    // user.dailyRentalLimit rentals per calendar day. Shadow renters (Apex) are exempt —
    // their automated idle-account renting isn't a burn risk. Cancelled rentals don't count
    // (the account was freed again). Replacements (Phase 2) will be exempt here too.
    if (!isShadow) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startedToday = await prisma.rental.count({
        where: {
          userId: user.id,
          isShadow: false,
          status: { not: "cancelled" },
          createdAt: { gte: startOfToday },
        },
      });
      const limit = user.dailyRentalLimit ?? 5;
      if (startedToday + accounts.length > limit) {
        const remaining = Math.max(0, limit - startedToday);
        return NextResponse.json(
          {
            error:
              remaining === 0
                ? `Daily rental limit reached (${limit}/day). Try again tomorrow, or contact us to raise your limit.`
                : `This would pass your daily rental limit (${limit}/day). You can start ${remaining} more today.`,
          },
          { status: 400 }
        );
      }
    }

    // Voucher / discount code (not applicable to shadow renters, who pay a fixed flat rate).
    // Validate up front so a bad code fails the whole order cleanly; the discounted rate is
    // locked onto each rental so renewals keep it.
    let discount: AppliedDiscount | undefined;
    if (!isShadow && rawDiscountCode) {
      const look = await lookupDiscount(rawDiscountCode);
      if (!look.ok || !look.discount) {
        return NextResponse.json({ error: look.error || "That code isn't valid." }, { status: 400 });
      }
      discount = look.discount;
    }

    // Effective monthly charge per account = base price + Sales Nav add-on (if chosen
    // and not already included), then any voucher applied. This is the amount we bill now
    // AND lock in for renewals. Shadow renters ignore all of that and pay the flat rate.
    const addonFor = (a: (typeof accounts)[number]) =>
      !isShadow && salesNavSet.has(a.id) && !a.hasSalesNav ? SALES_NAV_MONTHLY : 0;
    const shadowRate = new Prisma.Decimal(shadowRateFor(user.email) ?? SHADOW_MONTHLY_PRICE);
    const priceFor = (a: (typeof accounts)[number]) => {
      if (isShadow) return shadowRate;
      const base = new Prisma.Decimal(monthlyRentalPrice(a)).add(addonFor(a));
      // Pass the account so a tiered ("price book") code can price by its verified flag +
      // connection count; percent/fixed/flat ignore it.
      return discount ? new Prisma.Decimal(discountedPrice(base.toNumber(), discount, a)) : base;
    };

    const totalPrice = accounts.reduce(
      (sum, a) => sum.add(priceFor(a)),
      new Prisma.Decimal(0)
    );

    // Atomically check and deduct balance to prevent race condition
    const deducted = await prisma.$executeRaw`
      UPDATE users
      SET usdc_balance = usdc_balance - ${totalPrice.toNumber()}::decimal
      WHERE id = ${user.id}::uuid
        AND usdc_balance >= ${totalPrice.toNumber()}::decimal
    `;

    if (deducted === 0) {
      const userData = await prisma.user.findUnique({
        where: { id: user.id },
        select: { usdcBalance: true },
      });
      return NextResponse.json(
        {
          error: "Insufficient USDC balance",
          required: totalPrice.toString(),
          available: userData?.usdcBalance?.toString() || "0",
        },
        { status: 400 }
      );
    }

    // Balance deducted — now create rentals in a transaction
    try {
      const created = await prisma.$transaction(async (tx) => {
        const arr: { rentalId: string; accountId: string }[] = [];

        for (const account of accounts) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${account.id}))`;
          const current = await tx.linkedInAccount.findFirst({ where: { id: account.id, status: "available", listed: true, inventoryPool: { notIn: SEGREGATED_POOLS }, restrictedAt: null, twoFactorResetNeeded: false } });
          if (!current) throw new Error("Account is no longer available");
          if (isShadow && await tx.rental.count({ where: { linkedinAccountId: account.id, isShadow: true, status: { in: ["active", "pending_access", "payment_failed"] } } })) throw new Error("Account already has a shadow renter");
          const withSalesNav = addonFor(account) > 0;
          const effectivePrice = priceFor(account);
          // Create as pending_access; we attempt the actual grant right after commit.
          const rental = await tx.rental.create({
            data: {
              userId: user.id,
              linkedinAccountId: account.id,
              usdcPayment: true,
              autoRenew: !!autoRenew,
              status: "pending_access",
              accessGrantedAt: null,
              isShadow,
              // Lock the rate so every renewal bills the same: the flat shadow rate for a
              // shadow renter, or base+Sales Nav add-on otherwise (all billing paths read
              // lockedPrice ?? monthlyPrice).
              lockedPrice: effectivePrice,
              discountCode: discount ? discount.code : null,
              notes: isShadow
                ? `Shadow rental (${SHADOW_MONTHLY_PRICE}/mo) — stays in catalogue; yields to a real rental`
                : discount ? `Voucher ${discount.code} applied` : withSalesNav ? "Sales Navigator add-on (+$70/mo)" : null,
              currentPeriodEnd: new Date(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()),
            },
          });

          // A shadow rental deliberately does NOT flip the account to "rented" — it stays
          // catalogue-available so a real customer can still rent it (and yield the shadow).
          if (!isShadow) {
            await tx.linkedInAccount.update({
              where: { id: account.id },
              data: { status: "rented" },
            });
          }

          await tx.transaction.create({
            data: {
              userId: user.id,
              type: "rental_payment",
              amount: effectivePrice.negated(),
              rentalId: rental.id,
              description: `Rental payment for ${account.linkedinName}${isShadow ? " (shadow)" : withSalesNav ? " (+ Sales Navigator)" : ""}`,
            },
          });

          arr.push({ rentalId: rental.id, accountId: account.id });
        }

        // Count one redemption for the whole order (one use of the code).
        if (discount) await consumeDiscount(discount.code, tx);

        return arr;
      });

      // A REAL rental reclaims any account a shadow renter (Apex) was holding: cut their
      // GoLogin access, end the shadow rental, and email them. Never for a shadow order.
      if (!isShadow) {
        for (const { accountId } of created) {
          try {
            await yieldShadowRentals(accountId, { reason: "wallet rental" });
          } catch (e) {
            console.error("shadow yield after wallet rental failed:", accountId, e instanceof Error ? e.message : e);
          }
        }
      }

      // AUTO-GRANT each on the spot (after commit, so grantRentalAccess sees the rentals).
      // Shares to the renter via the right master/klabber token + flips to active. If the
      // renter hasn't set up GoLogin yet it throws -> stays pending_access; the cron retries.
      const readyByAccount = new Map<string, boolean>();
      for (const { rentalId, accountId } of created) {
        // Shadow rentals are NOT auto-granted — we prepare the profile/share link manually,
        // so the renter sees "Preparing" until we hand it over. Leave it pending_access.
        if (isShadow) { readyByAccount.set(accountId, false); continue; }
        const account = accounts.find((a) => a.id === accountId);
        if (!account?.gologinProfileId) { readyByAccount.set(accountId, false); continue; }
        try {
          await grantRentalAccess(rentalId);
          readyByAccount.set(accountId, true);
        } catch (e) {
          console.error("auto-grant on rental start failed (cron will retry):", rentalId, e instanceof Error ? e.message : e);
          readyByAccount.set(accountId, false);
        }
      }
      const rentalIds = created.map((c) => c.rentalId);

      // ONE consolidated email for the whole order (not one per account — that fires a
      // burst of near-identical emails that get rate-limited / threaded into one).
      try {
        await sendRentalReadyEmail(
          user.email,
          accounts.map((a) => ({ name: a.linkedinName, ready: readyByAccount.get(a.id) || false }))
        );
      } catch (e) {
        console.error("Failed to send rental email:", e);
      }
      try {
        await sendRentalNotification({
          customerEmail: user.email,
          customerName: user.fullName,
          accountName: accounts.map((a) => a.linkedinName).join(", "),
        });
      } catch (e) {
        console.error("Failed to send rental notification:", e);
      }

      return NextResponse.json({ success: true, rentalIds });
    } catch (rentalError) {
      // Rental creation failed — refund the balance
      await prisma.$executeRaw`
        UPDATE users
        SET usdc_balance = usdc_balance + ${totalPrice.toNumber()}::decimal
        WHERE id = ${user.id}::uuid
      `;
      console.error("USDC checkout rental creation failed, balance refunded:", rentalError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("USDC checkout error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
