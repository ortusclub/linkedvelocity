import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// Manual-tracked off-platform rentals: admin marks a period paid / unpaid by hand.
// Marking paid sets manualPaidUntil = (later of now / current paid-through) + one
// period (derived from the terms label) and promotes a trial to Rented. Marking
// unpaid clears the paid-through date (row goes back to Unpaid) but stays Rented.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const { paid } = (await req.json()) as { paid?: boolean };

    const acc = await prisma.linkedInAccount.findUnique({
      where: { id },
      select: { paymentTermsLabel: true, manualPaidUntil: true, status: true },
    });
    if (!acc) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    if (paid) {
      const label = (acc.paymentTermsLabel || "").toLowerCase();
      const days = label.includes("month") ? 30 : label.includes("day") ? 1 : 7; // default: weekly
      const base = acc.manualPaidUntil && acc.manualPaidUntil.getTime() > Date.now() ? acc.manualPaidUntil.getTime() : Date.now();
      const until = new Date(base + days * 86400000);
      await prisma.linkedInAccount.update({
        where: { id },
        data: {
          manualPaidUntil: until,
          ...(acc.status === "trial" ? { status: "rented", trialEndsAt: null } : {}),
          listed: false,
        },
      });
      await (await import('@/lib/lv-reserve-revocation')).notifyReserveRental(id);
      return NextResponse.json({ ok: true, manualPaidUntil: until, promoted: acc.status === "trial" });
    }

    await prisma.linkedInAccount.update({ where: { id }, data: { manualPaidUntil: null } });
    return NextResponse.json({ ok: true, manualPaidUntil: null });
  } catch (error) {
    if (error instanceof Error && /unauthorized|forbidden/i.test(error.message)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("manual-paid error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
