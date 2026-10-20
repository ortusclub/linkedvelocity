import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { phpToUsd } from "@/lib/utils";
import { computeMonthlyPayoutsPhp } from "@/lib/metrics";

// A real (sellable) inventory account: not a showcase/dummy, not a leftover test account.
function isRealAccount(a: { notes: string | null; linkedinName: string }) {
  return !(a.notes || "").includes("[SHOWCASE]") && !a.linkedinName.toUpperCase().includes("(TEST)");
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    // Live by default: hide test customers + their rentals from the headline numbers.
    // Pass ?includeTest=1 to show everything.
    const includeTest = req.nextUrl.searchParams.get("includeTest") === "1";
    const liveUser = includeTest ? {} : { isTest: false };
    const liveRental = includeTest ? {} : { user: { isTest: false } };
    const now = new Date();
    const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Selected month (for the period filter) + previous month (for trend %).
    const monthParam = req.nextUrl.searchParams.get("month");
    const ref = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? new Date(Number(monthParam.slice(0, 4)), Number(monthParam.slice(5, 7)) - 1, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const mStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const mEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    const monthKey = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const isCurrentMonth = monthKey === currentMonthKey;

    const [
      inventoryAccounts,
      totalCustomers,
      newCustomers30d,
      activeRentalsList,
      renewalsDue30d,
      atRisk,
      appsToReview,
      recentSignups,
      recentSubmissions,
      vettingStarted,
      vettingDropped,
    ] = await Promise.all([
      // Real inventory — exclude removed/retired; showcase + test filtered in JS.
      prisma.linkedInAccount.findMany({
        where: { status: { notIn: ["removed", "retired"] } },
        select: { status: true, notes: true, linkedinName: true, restrictedAt: true },
      }),
      // Customers who have actually rented (a signup with zero rentals isn't a customer yet).
      prisma.user.count({ where: { role: "customer", status: "active", ...liveUser, rentals: { some: {} } } }),
      prisma.user.count({ where: { role: "customer", status: "active", ...liveUser, rentals: { some: { createdAt: { gte: last30d } } } } }),
      prisma.rental.findMany({
        where: { status: "active", ...liveRental },
        include: {
          user: { select: { fullName: true, email: true, isTest: true } },
          linkedinAccount: { select: { linkedinName: true, monthlyPrice: true, ambassadorPayment: true, notes: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.rental.count({ where: { status: "active", ...liveRental, currentPeriodEnd: { gte: now, lte: in30d } } }),
      prisma.rental.count({ where: { ...liveRental, OR: [{ status: "payment_failed" }, { status: "active", autoRenew: false }] } }),
      prisma.ambassadorApplication.count({ where: { status: { in: ["reviewing", "pending"] } } }),
      prisma.user.findMany({ where: { role: "customer", ...liveUser }, select: { fullName: true, email: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
      prisma.ambassadorApplication.findMany({ select: { fullName: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
      // Vetting funnel: how many opened the form, and how many opened but didn't finish.
      prisma.user.count({ where: { vettingStartedAt: { not: null } } }),
      prisma.user.count({ where: { vettingStartedAt: { not: null }, vettedAt: null } }),
    ]);

    const realAccounts = inventoryAccounts.filter(isRealAccount);
    const totalAccounts = realAccounts.length;
    const availableAccounts = realAccounts.filter((a) => a.status === "available").length;
    const offlineAccounts = realAccounts.filter((a) => a.status === "unavailable" || a.status === "maintenance").length;
    const restrictedAccounts = realAccounts.filter((a) => a.restrictedAt).length;

    const activeRentals = activeRentalsList.length;
    const rentedAccounts = activeRentals; // a test-held account doesn't inflate this
    // MRR also counts pending_access rentals (paid up front, awaiting GoLogin setup) — keep in
    // sync with computeCoreMetrics (src/lib/metrics.ts). activeRentals/rentedAccounts stay active-only.
    const pendingMrrList = await prisma.rental.findMany({
      where: { status: "pending_access", ...liveRental },
      select: { lockedPrice: true, linkedinAccount: { select: { monthlyPrice: true } } },
    });
    const mrr =
      activeRentalsList.reduce((s, r) => s + Number(r.lockedPrice ?? r.linkedinAccount.monthlyPrice ?? 0), 0) +
      pendingMrrList.reduce((s, r) => s + Number(r.lockedPrice ?? r.linkedinAccount.monthlyPrice ?? 0), 0);
    // Payouts (money out) = what we ACTUALLY paid out in the selected month — ambassador
    // setup fees + logged monthly payouts + referral/marketer fees. Real cash out (only
    // people actually paid), not a run-rate over every onboarded ambassador. Computed from
    // dated records so it's exact for any month. Stored in PHP → convert to USD to net
    // against the USD mrr.
    const payoutsPhp = await computeMonthlyPayoutsPhp(mStart, mEnd);
    const payouts = phpToUsd(payoutsPhp);
    const netProfit = mrr - payouts;
    const utilization = totalAccounts > 0 ? Math.round((rentedAccounts / totalAccounts) * 100) : 0;

    // Cash actually collected in the selected month = money IN from customers:
    // on-platform USDC top-ups (deposit) + off-platform weekly rental payments the
    // TRON cron records (positive rental_payment). Excludes internal sweeps/refunds.
    // Computed straight from the ledger, so it's accurate for any month.
    const collectedAgg = await prisma.transaction.aggregate({
      _sum: { amount: true },
      _count: true,
      where: {
        createdAt: { gte: mStart, lt: mEnd },
        amount: { gt: 0 },
        type: { in: ["deposit", "rental_payment"] },
        ...(includeTest ? {} : { user: { isTest: false } }),
      },
    });
    const collected = Number(collectedAgg._sum.amount ?? 0);
    const collectedCount = collectedAgg._count;

    // ── Month filter + month-over-month trends, powered by the daily snapshot table ──
    // baseline = the latest snapshot strictly before the selected month (i.e. last month's
    // end-of-day state); list of months we actually have snapshots for (drives the dropdown).
    const [baseSnap, snapMonthRows] = await Promise.all([
      prisma.metricsSnapshot.findFirst({ where: { date: { lt: mStart } }, orderBy: { date: "desc" } }),
      prisma.metricsSnapshot.findMany({ select: { date: true }, orderBy: { date: "desc" } }),
    ]);

    // Live (current) core numbers — what we show for the current month.
    let disp = { netProfit, mrr, payouts, activeRentals, totalCustomers, totalAccounts, availableAccounts, rentedAccounts, offlineAccounts, restrictedAccounts, utilization };
    let hasMonthData = true;
    if (!isCurrentMonth) {
      // A past month: show that month's last snapshot instead of the live numbers.
      const monthSnap = await prisma.metricsSnapshot.findFirst({ where: { date: { gte: mStart, lt: mEnd } }, orderBy: { date: "desc" } });
      if (monthSnap) {
        disp = {
          netProfit: monthSnap.netProfit, mrr: monthSnap.mrr, payouts: monthSnap.payouts, activeRentals: monthSnap.activeRentals,
          totalCustomers: monthSnap.totalCustomers, totalAccounts: monthSnap.totalAccounts, availableAccounts: monthSnap.availableAccounts,
          rentedAccounts: monthSnap.rentedAccounts, offlineAccounts: monthSnap.offlineAccounts, restrictedAccounts: monthSnap.restrictedAccounts, utilization: monthSnap.utilization,
        };
      } else {
        hasMonthData = false;
      }
    }
    // Payouts + netProfit always come from live, per-month ACTUAL payment records (dated and
    // immutable), not the snapshot — old snapshots stored a different, run-rate payouts value.
    disp.payouts = payouts;
    disp.netProfit = disp.mrr - payouts;

    // trend = % change vs the baseline snapshot. undefined => no prior snapshot yet (no chip);
    // null => baseline was 0 but there's a value now ("new").
    const trend = (cur: number, key: "mrr" | "netProfit" | "activeRentals" | "totalCustomers" | "utilization"): number | null | undefined => {
      if (!baseSnap) return undefined;
      const prev = Number((baseSnap as Record<string, unknown>)[key] ?? 0);
      return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? null : 0);
    };
    const mrrTrend = trend(disp.mrr, "mrr");
    const netProfitTrend = trend(disp.netProfit, "netProfit");
    const activeRentalsTrend = trend(disp.activeRentals, "activeRentals");
    const customersTrend = trend(disp.totalCustomers, "totalCustomers");
    const utilizationTrend = trend(disp.utilization, "utilization");

    const ymOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthSet = new Set<string>(snapMonthRows.map((r) => ymOf(r.date)));
    monthSet.add(currentMonthKey); // always offer the current (live) month
    const availableMonths = [...monthSet].sort().reverse();

    // Merge into one activity feed, newest first.
    const recentActivity = [
      ...realAccounts.filter((a) => a.restrictedAt).map((a) => ({ type: "restricted" as const, label: `Restricted — ${a.linkedinName}`, date: a.restrictedAt as Date, isTest: false })),
      ...activeRentalsList.map((r) => ({ type: "rental" as const, label: `${r.user.fullName} → ${r.linkedinAccount.linkedinName}`, date: r.createdAt, isTest: r.user.isTest })),
      ...recentSignups.map((u) => ({ type: "signup" as const, label: `New signup — ${u.fullName}`, date: u.createdAt, isTest: false })),
      ...recentSubmissions.map((s) => ({ type: "submission" as const, label: `Ambassador application — ${s.fullName}`, date: s.createdAt, isTest: false })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8);

    return NextResponse.json({
      stats: {
        // money (live for the current month, snapshot for a past month)
        netProfit: disp.netProfit, mrr: disp.mrr, payouts: disp.payouts, activeRentals: disp.activeRentals,
        payoutsPhp, // native ₱ figure of actual payouts in the selected month
        collected, collectedCount,
        // demand
        totalCustomers: disp.totalCustomers, newCustomers30d, renewalsDue30d, atRisk,
        // supply
        totalAccounts: disp.totalAccounts, availableAccounts: disp.availableAccounts, rentedAccounts: disp.rentedAccounts, offlineAccounts: disp.offlineAccounts, restrictedAccounts: disp.restrictedAccounts, utilization: disp.utilization, appsToReview,
        // vetting funnel
        vettingStarted, vettingDropped,
        // month filter + month-over-month trends (from the daily snapshot table)
        month: monthKey, isCurrentMonth, hasMonthData, availableMonths,
        mrrTrend, netProfitTrend, activeRentalsTrend, customersTrend, utilizationTrend,
      },
      recentActivity,
    });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
