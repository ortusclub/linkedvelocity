import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { diffPayout, nextPayoutChange, AMBASSADOR_PAYOUT_FIELDS } from "@/lib/payout-change";
import type { Prisma } from "@/generated/prisma/client";

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();

    const { paymentMethod, bankName, bankAccountName, bankAccountNumber, bankRoutingNumber, bankSortCode, usdcWalletAddress, usdcNetwork, paypalEmail, wiseEmail } = body;

    // Find the ambassador application for this user
    const app = await prisma.ambassadorApplication.findFirst({
      where: { email: user.email },
      orderBy: { updatedAt: "desc" },
    });

    if (!app) {
      return NextResponse.json({ error: "No ambassador application found" }, { status: 404 });
    }

    const next = {
      paymentMethod: paymentMethod ?? null,
      bankName: bankName || null,
      bankAccountName: bankAccountName || null,
      bankAccountNumber: bankAccountNumber || null,
      bankRoutingNumber: bankRoutingNumber || null,
      bankSortCode: bankSortCode || null,
      usdcWalletAddress: usdcWalletAddress || null,
      usdcNetwork: usdcNetwork || null,
      paypalEmail: paypalEmail || null,
      wiseEmail: wiseEmail || null,
    };
    // Flag a self-serve payout change so the payouts console verifies before paying.
    const changed = diffPayout(app, next, AMBASSADOR_PAYOUT_FIELDS);

    const updated = await prisma.ambassadorApplication.update({
      where: { id: app.id },
      data: {
        ...next,
        ...(changed ? { payoutChange: nextPayoutChange(app.payoutChange, changed, "owner") as unknown as Prisma.InputJsonValue } : {}),
      },
      select: {
        paymentMethod: true,
        bankName: true,
        bankAccountName: true,
        bankAccountNumber: true,
        bankRoutingNumber: true,
        bankSortCode: true,
        usdcWalletAddress: true,
        usdcNetwork: true,
        paypalEmail: true,
        wiseEmail: true,
      },
    });

    return NextResponse.json({ paymentDetails: updated });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
