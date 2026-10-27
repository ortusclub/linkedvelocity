import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dailyBilling, dailyDueState, weeklyBilling, weeklyDueState } from "@/lib/rental-tracker";
import { detectDailyPayment } from "@/lib/daily-payments";
import { sendOverdueRentalsAlert } from "@/services/email";

// Once-daily check that emails the team inbox when an off-platform rental (daily
// TRON or weekly USDT) hasn't paid by its due date, so someone can follow up
// manually — chase the renter, pause access, or end the rental. Only sends when
// there's at least one overdue rental (no "all clear" noise).

const TEAM_INBOX = process.env.ADMIN_NOTIFICATION_EMAIL || "info@linkedvelocity.com";

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

async function run(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  type Item = { renter: string; account: string; cadence: "daily" | "weekly"; rate: string; daysOverdue: number; nextDue: string; address: string | null };
  const overdue: Item[] = [];

  try {
    const rentals = await prisma.rental.findMany({
      where: { status: "active" },
      include: {
        user: { select: { fullName: true } },
        linkedinAccount: { select: { linkedinName: true, paymentWallet: true } },
      },
    });

    for (const r of rentals) {
      const renter = r.user.fullName;
      const account = r.linkedinAccount.linkedinName;
      const addr = r.linkedinAccount.paymentWallet;

      // Daily rentals — resolve next-due live from the renter's unique address.
      const d = dailyBilling(r.notes);
      if (d) {
        if (!addr) continue;
        const det = await detectDailyPayment(addr, d.rate, d.from);
        const st = dailyDueState(det.nextDue);
        if (st.tone === "overdue") {
          overdue.push({ renter, account, cadence: "daily", rate: `$${d.rateRaw}/day`, daysOverdue: -st.days, nextDue: det.nextDue, address: addr });
        }
        continue;
      }

      // Weekly rentals — the weekly-payment cron advances the due date when paid,
      // so a due date still in the past means it's genuinely unpaid.
      const w = weeklyBilling(r.notes);
      if (w) {
        const st = weeklyDueState(w.nextDue);
        if (st.tone === "overdue") {
          overdue.push({ renter, account, cadence: "weekly", rate: `$${w.amountRaw}/week`, daysOverdue: -st.days, nextDue: w.nextDue, address: addr });
        }
      }
    }

    if (overdue.length > 0) {
      overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
      await sendOverdueRentalsAlert(TEAM_INBOX, overdue);
    }

    return NextResponse.json({ ok: true, overdue: overdue.length, emailed: overdue.length > 0, items: overdue });
  } catch (error) {
    console.error("Overdue rentals alert error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
