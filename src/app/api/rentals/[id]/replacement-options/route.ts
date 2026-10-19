import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicInventorySlice, hasFullListAccess, PUBLIC_AVAILABLE_WHERE } from "@/lib/public-inventory";
import { requireAuth } from "@/lib/auth";
import { monthlyRentalPrice } from "@/lib/account-pricing";
import { maskPublicAccount } from "@/lib/mask";
import { canReplaceNow, replacementUnlockAt } from "@/lib/replacement";
import { activeShadowAccountIds } from "@/lib/shadow-rental";

// Accounts a renter may swap a RESTRICTED rental to. Same tier or lower is free — they keep
// their locked rate. A non-shadow renter may also UPGRADE to a pricier account and pay the
// prorated rate difference for the days left in the current paid period (collected at swap).
// Only offered once the 2-day recovery hold has elapsed.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const rental = await prisma.rental.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        status: true,
        isShadow: true,
        lockedPrice: true,
        currentPeriodEnd: true,
        linkedinAccount: {
          select: {
            id: true, restrictedAt: true, permanentlyRestricted: true,
            connectionCount: true, accountAgeMonths: true, hasSalesNav: true, linkedinVerified: true,
          },
        },
      },
    });

    if (!rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    const acct = rental.linkedinAccount;
    if (!acct.restrictedAt) {
      return NextResponse.json({ error: "This account isn't restricted, so it can't be replaced." }, { status: 400 });
    }
    // A permanently-restricted account can be replaced right away (no point waiting it out).
    if (!acct.permanentlyRestricted && !canReplaceNow(acct.restrictedAt)) {
      return NextResponse.json(
        { error: "We're still trying to recover this account. Replacement unlocks after the recovery window.", unlockAt: replacementUnlockAt(acct.restrictedAt) },
        { status: 409 }
      );
    }

    const oldPrice = monthlyRentalPrice(acct);
    // What they actually pay now (locked/discounted rate, else the restricted account's tier).
    const effectiveRate = rental.lockedPrice != null ? Number(rental.lockedPrice) : oldPrice;
    // Days left in the paid period — the window an upgrade's prorated difference covers. Uses
    // the original billing date (the credited downtime days are free, so no upgrade diff on them).
    const dayMs = 86400000;
    const remainingDays = rental.currentPeriodEnd
      ? Math.max(0, Math.ceil((new Date(rental.currentPeriodEnd).getTime() - Date.now()) / dayMs))
      : 0;
    // Shadow renters pay a flat rate regardless of tier, so upgrades don't apply to them.
    const canUpgrade = !rental.isShadow;
    const walletBalance = Number(user.usdcBalance ?? 0);

    // For a shadow renter, drop accounts another shadow renter already holds (one shadow
    // holder per account), mirroring the checkout guard.
    const excludeIds = [acct.id];
    if (rental.isShadow) excludeIds.push(...(await activeShadowAccountIds()));

    // Genuinely-rentable inventory only (mirror the catalogue's "available" branch), minus
    // the restricted account itself (and shadow-held ones for a shadow renter).
    // Like the catalogue, replacement candidates are capped to the public slice (see
    // lib/public-inventory) — unless the renter supplies the full-roster password
    // (?key=<FULL_LIST_PASSWORD>), which lifts the cap to the whole roster.
    const fullList = hasFullListAccess(new URL(req.url).searchParams.get("key"));
    const { availableIds } = await publicInventorySlice();
    const candidates = await prisma.linkedInAccount.findMany({
      where: {
        ...PUBLIC_AVAILABLE_WHERE,
        id: fullList ? { notIn: excludeIds } : { in: availableIds.filter((id) => !excludeIds.includes(id)) },
      },
      select: {
        id: true, linkedinName: true, linkedinHeadline: true, linkedinUrl: true,
        connectionCount: true, industry: true, location: true, profilePhotoUrl: true,
        accountAgeMonths: true, hasSalesNav: true, linkedinVerified: true, notes: true,
      },
      orderBy: { connectionCount: "desc" },
    });

    // Same tier or lower is always offered. Pricier accounts are offered too (as paid upgrades)
    // for non-shadow renters; shadow renters stay capped at their tier.
    const options = candidates
      .map((a) => ({ ...a, monthlyPrice: monthlyRentalPrice(a) }))
      .filter((a) => canUpgrade || a.monthlyPrice <= oldPrice)
      .map((a) => maskPublicAccount(a));

    return NextResponse.json({ oldPrice, effectiveRate, remainingDays, canUpgrade, walletBalance, options, fullList });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("replacement-options error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
