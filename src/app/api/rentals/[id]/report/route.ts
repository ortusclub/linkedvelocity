import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { sendProblemReport } from "@/services/email";

// Renter taps "Something wrong? Report it" and picks what's happening. We log it, email the team,
// and the dashboard shows the account as "reported" until it's sorted. A "won't load" on a healthy
// account is handled by the proxy-fix swap flow on the client instead — this endpoint logs the
// other cases (logged out / code or ID check / something else, and a won't-load we can't swap).
const CATEGORY_LABEL: Record<string, string> = {
  logged_out: "Logged out of LinkedIn",
  verification: "Asking for a code or ID check",
  wont_load: "LinkedIn won't load",
  other: "Something else",
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const category = String(body?.category || "");
    if (!CATEGORY_LABEL[category]) {
      return NextResponse.json({ error: "Pick what's happening." }, { status: 400 });
    }
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 1000) || null : null;

    const rental = await prisma.rental.findFirst({
      where: { id, userId: user.id },
      include: { linkedinAccount: { select: { id: true, linkedinName: true, restrictedAt: true } } },
    });
    if (!rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    // A rental the renter is actually holding — not expired/cancelled/replaced.
    if (!["active", "pending_access", "payment_failed"].includes(rental.status)) {
      return NextResponse.json({ error: "This rental isn't active." }, { status: 409 });
    }

    const acct = rental.linkedinAccount;
    const state = acct.restrictedAt ? "Restricted" : rental.paused ? "Paused" : null;

    // One open report per rental: if there's already one open, update it (the renter may be
    // adding detail or changing what they picked) rather than stacking duplicates.
    const existing = await prisma.problemReport.findFirst({
      where: { rentalId: rental.id, status: "open" },
      orderBy: { createdAt: "desc" },
    });

    let ticketRef: string;
    if (existing) {
      ticketRef = existing.ticketRef;
      await prisma.problemReport.update({ where: { id: existing.id }, data: { category, note } });
    } else {
      ticketRef = `LV-${Date.now().toString(36).toUpperCase()}`;
      await prisma.problemReport.create({
        data: {
          rentalId: rental.id,
          linkedinAccountId: acct.id,
          userId: user.id,
          ticketRef,
          category,
          note,
          status: "open",
        },
      });
    }

    try {
      await sendProblemReport({
        ticketRef,
        accountName: acct.linkedinName || "(account)",
        renterEmail: user.email,
        category,
        categoryLabel: CATEGORY_LABEL[category],
        note,
        state,
      });
    } catch (e) {
      console.error("report: team email failed", ticketRef, e instanceof Error ? e.message : e);
    }

    return NextResponse.json({ status: "open", ticketRef });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("report error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
