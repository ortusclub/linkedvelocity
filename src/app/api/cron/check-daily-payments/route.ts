import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { dailyBilling, dailyDueState, stampDailyPaid } from "@/lib/rental-tracker";
import { detectDailyPayment } from "@/lib/daily-payments";

// Daily pass that confirms off-platform DAILY rental payments from the TRON
// blockchain. For each active rental carrying a [daily $X from YYYY-MM-DD] marker
// whose account has a unique payment address, we sum every USDT transfer received
// on that address, work out how many days it funds, and:
//   - record any new transfers in the ledger (so /admin/transactions shows them),
//   - refresh a self-updating [daily-paid nextdue … total …] stamp in notes so
//     the admin badge flips paid/overdue on its own.
// See src/lib/daily-payments.ts for the detection, and check-weekly-payments for
// the shared-wallet weekly variant.

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

async function run(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = { checked: 0, updated: 0, newPayments: 0, overdue: 0, rentals: [] as unknown[] };

  try {
    const rentals = await prisma.rental.findMany({
      where: { status: "active" },
      include: {
        user: { select: { id: true, fullName: true } },
        linkedinAccount: { select: { linkedinName: true, paymentWallet: true } },
      },
    });

    for (const r of rentals) {
      const b = dailyBilling(r.notes);
      const addr = r.linkedinAccount.paymentWallet;
      if (!b || !addr) continue; // not a daily rental, or no address assigned yet
      result.checked++;

      const det = await detectDailyPayment(addr, b.rate, b.from);

      // Record any new on-chain transfers in the ledger (idempotent by txHash).
      for (const t of det.transfers) {
        const already = await prisma.transaction.findFirst({ where: { txHash: t.txId } });
        if (already) continue;
        await prisma.transaction.create({
          data: {
            userId: r.user.id,
            type: "rental_payment",
            amount: new Prisma.Decimal(t.amount),
            txHash: t.txId,
            rentalId: r.id,
            description: `Daily USDT (TRC-20) · ${r.linkedinAccount.linkedinName} · ${r.user.fullName}`,
          },
        });
        result.newPayments++;
      }

      // Refresh the self-updating daily-paid stamp so the UI reflects on-chain state.
      const newNotes = stampDailyPaid(r.notes, det.nextDue, det.total, det.lastTx);
      if (newNotes !== (r.notes || "")) {
        await prisma.rental.update({ where: { id: r.id }, data: { notes: newNotes } });
        result.updated++;
      }

      const due = dailyDueState(det.nextDue);
      if (due.tone === "overdue") result.overdue++;
      result.rentals.push({
        renter: r.user.fullName,
        account: r.linkedinAccount.linkedinName,
        rate: b.rate,
        total: det.total,
        daysPaid: det.daysPaid,
        nextDue: det.nextDue,
        state: due.label,
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Daily payment check error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
