import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { diffPayout, nextPayoutChange, AMBASSADOR_PAYOUT_FIELDS } from "@/lib/payout-change";
import type { Prisma } from "@/generated/prisma/client";

const bankSchema = z.object({
  applicationId: z.string().min(1),
  paymentMethod: z.enum(["usdc", "paypal", "wise"]),
  bankName: z.string().optional(),
  bankAccountName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankRoutingNumber: z.string().optional(),
  bankSortCode: z.string().optional(),
  usdcWalletAddress: z.string().optional(),
  usdcNetwork: z.string().optional(),
  paypalEmail: z.string().optional(),
  wiseEmail: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const data = bankSchema.parse(body);

    const application = await prisma.ambassadorApplication.findUnique({
      where: { id: data.applicationId },
    });

    if (!application) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    // Verify the application belongs to the logged-in user
    if (application.email !== session.email) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (application.status !== "approved") {
      return NextResponse.json({ error: "Application is not approved" }, { status: 400 });
    }

    const next = {
      paymentMethod: data.paymentMethod,
      bankName: data.bankName,
      bankAccountName: data.bankAccountName,
      bankAccountNumber: data.bankAccountNumber,
      bankRoutingNumber: data.bankRoutingNumber,
      bankSortCode: data.bankSortCode,
      usdcWalletAddress: data.usdcWalletAddress,
      usdcNetwork: data.usdcNetwork,
      paypalEmail: data.paypalEmail,
      wiseEmail: data.wiseEmail,
    };
    // Flag a self-serve payout change so the payouts console verifies before paying. Fields
    // omitted from the payload (undefined) are left unchanged, so compare against current.
    const effective = Object.fromEntries(
      AMBASSADOR_PAYOUT_FIELDS.map((f) => [f, next[f] !== undefined ? next[f] : (application as Record<string, unknown>)[f]]),
    );
    const changed = diffPayout(application, effective, AMBASSADOR_PAYOUT_FIELDS);

    await prisma.ambassadorApplication.update({
      where: { id: data.applicationId },
      data: {
        ...next,
        ...(changed ? { payoutChange: nextPayoutChange(application.payoutChange, changed, "owner") as unknown as Prisma.InputJsonValue } : {}),
        // Saving payout details does NOT change the onboarding stage — that only moves
        // when the team moves it on the board (Accepted -> Onboarding -> Onboarded, where
        // Onboarded means we've logged in). Leave status untouched.
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    console.error("Bank details error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
