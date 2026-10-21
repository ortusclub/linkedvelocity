import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { SHADOW_MONTHLY_PRICE, yieldShadowRentals, isShadowRenterEmail, shadowRateFor } from "@/lib/shadow-rental";

export async function GET() {
  try {
    await requireAdmin();

    const rentals = await prisma.rental.findMany({
      // Cancelled/ended rentals aren't "live" — keep them out of the list so ending a
      // rental makes it disappear (and it stops being counted / showing a fake renewal).
      where: { status: { not: "cancelled" } },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            contactNumber: true,
            company: true,
            industry: true,
            createdAt: true,
          },
        },
        linkedinAccount: {
          select: {
            id: true,
            linkedinName: true,
            linkedinUrl: true,
            connectionCount: true,
            monthlyPrice: true,
            gologinProfileId: true,
            notes: true,
            restrictedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // How many accounts each renter currently has (active or pending_access).
    const liveCounts = new Map<string, number>();
    for (const r of rentals) {
      if (r.status === "active" || r.status === "pending_access") {
        liveCounts.set(r.userId, (liveCounts.get(r.userId) || 0) + 1);
      }
    }

    // Payment method by how the renter actually funded us: a Stripe card top-up =>
    // "Stripe", a crypto deposit => "USDC". (A wallet-paid rental otherwise just reads
    // "USDC" even when the wallet was funded by card — this corrects that.)
    const userIds = [...new Set(rentals.map((r) => r.userId))];
    const deposits = userIds.length
      ? await prisma.transaction.findMany({
          where: { userId: { in: userIds }, type: "deposit" },
          select: { userId: true, description: true },
        })
      : [];
    const fundingByUser = new Map<string, "Stripe" | "USDC">();
    for (const d of deposits) {
      if ((d.description || "").startsWith("stripe_topup")) {
        fundingByUser.set(d.userId, "Stripe"); // any card top-up => card payer
      } else if (!fundingByUser.has(d.userId)) {
        fundingByUser.set(d.userId, "USDC");
      }
    }

    const enriched = rentals.map((r) => ({
      ...r,
      renterAccountsLive: liveCounts.get(r.userId) || 0,
      paymentMethodResolved: fundingByUser.get(r.userId) || (r.usdcPayment ? "USDC" : "Stripe"),
    }));

    return NextResponse.json({ rentals: enriched });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const createRentalSchema = z.object({
  userEmail: z.string().email(),
  linkedinAccountId: z.string().uuid(),
  startDate: z.string(),
  autoRenew: z.boolean().default(true),
});

export async function POST(req: Request) {
  try {
    await requireAdmin();

    const body = await req.json();
    const data = createRentalSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { email: data.userEmail } });
    if (!user) {
      return NextResponse.json({ error: "User not found with that email" }, { status: 404 });
    }

    const account = await prisma.linkedInAccount.findUnique({ where: { id: data.linkedinAccountId } });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Rentals are monthly — the period is always exactly 1 calendar month from start.
    const start = new Date(data.startDate);
    const periodEnd = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate());

    // A shadow renter (now Ortus only) gets the same soft-hold behaviour here as via
    // self-checkout: their OWN flat rate, no status flip, and no yield.
    const isShadow = user.isShadowRenter === true || isShadowRenterEmail(user.email);
    const shadowRate = shadowRateFor(user.email) ?? SHADOW_MONTHLY_PRICE;

    const rental = await prisma.rental.create({
      data: {
        userId: user.id,
        linkedinAccountId: data.linkedinAccountId,
        status: "active",
        startDate: start,
        currentPeriodEnd: periodEnd,
        autoRenew: data.autoRenew,
        isShadow,
        lockedPrice: isShadow ? new Prisma.Decimal(shadowRate) : undefined,
        notes: isShadow
          ? `Shadow rental ($${shadowRate}/mo) — stays in catalogue; yields to a real rental`
          : undefined,
      },
    });

    if (!isShadow) {
      // Real rental: take the account out of the catalogue and reclaim it from any shadow holder.
      await prisma.linkedInAccount.update({
        where: { id: data.linkedinAccountId },
        data: { status: "rented" },
      });
      try {
        await yieldShadowRentals(data.linkedinAccountId, { reason: "admin-created rental" });
      } catch (e) {
        console.error("shadow yield after admin rental failed:", data.linkedinAccountId, e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ rental }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map(i => i.message).join(", ") }, { status: 400 });
    }
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    console.error("Create rental error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Edit tracker fields: rental Notes (campaign goal / issues) and the renter's Company.
const patchSchema = z.object({
  id: z.string().uuid(),
  notes: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  campaignGoal: z.string().nullable().optional(),
  lvPoc: z.string().nullable().optional(),
});

export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const data = patchSchema.parse(await req.json());

    const rental = await prisma.rental.findUnique({
      where: { id: data.id },
      select: { id: true, userId: true },
    });
    if (!rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    const rentalData: { notes?: string | null; campaignGoal?: string | null; lvPoc?: string | null } = {};
    if (data.notes !== undefined) rentalData.notes = data.notes;
    if (data.campaignGoal !== undefined) rentalData.campaignGoal = data.campaignGoal;
    if (data.lvPoc !== undefined) rentalData.lvPoc = data.lvPoc;
    if (Object.keys(rentalData).length) {
      await prisma.rental.update({ where: { id: data.id }, data: rentalData });
    }
    const userData: { company?: string | null; industry?: string | null } = {};
    if (data.company !== undefined) userData.company = data.company;
    if (data.industry !== undefined) userData.industry = data.industry;
    if (Object.keys(userData).length) {
      await prisma.user.update({ where: { id: rental.userId }, data: userData });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map(i => i.message).join(", ") }, { status: 400 });
    }
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    console.error("Patch rental error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
