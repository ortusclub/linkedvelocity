import { prisma } from "@/lib/prisma";
import { phpToUsd } from "@/lib/utils";

// Money ACTUALLY paid out (in ₱) within [start, end): the ambassador payment log
// (monthlyPayouts jsonb — every disbursement with its amount + kind: setup ₱1,000 /
// monthly ₱500) plus referral/marketer payouts (payouts table: commission, day-rate…).
// Real cash out — only people actually paid — not a run-rate over every onboarded
// ambassador. Both sources are dated records, so it's exact for any month. NB: the app's
// `paidAt` flag mirrors the same setup payment that's already in monthlyPayouts, so it's
// deliberately NOT added here (would double-count the setup fee).
export async function computeMonthlyPayoutsPhp(start: Date, end: Date): Promise<number> {
  const [apps, refAgg] = await Promise.all([
    prisma.ambassadorApplication.findMany({ select: { monthlyPayouts: true } }),
    prisma.payout.aggregate({ _sum: { amount: true }, where: { paidAt: { gte: start, lt: end } } }),
  ]);
  let php = 0;
  for (const a of apps) {
    if (!Array.isArray(a.monthlyPayouts)) continue;
    for (const p of a.monthlyPayouts as Array<{ paidAt?: string; amount?: number }>) {
      const at = p?.paidAt ? new Date(p.paidAt) : null;
      if (at && at >= start && at < end) php += Number(p.amount || 0);
    }
  }
  php += Number(refAgg._sum.amount || 0); // referral + marketer payouts
  return php;
}

// The headline run-rate metrics, the same way the dashboard shows them. Kept here so the
// daily snapshot (/api/cron/snapshot-metrics) and the live dashboard compute them
// identically. NB: the live /api/admin/stats route mirrors this formula inline (it needs
// the underlying lists for its activity feed) — keep the two in sync if the formula changes.
export type CoreMetrics = {
  mrr: number; netProfit: number; payouts: number; activeRentals: number;
  totalCustomers: number; totalAccounts: number; availableAccounts: number;
  rentedAccounts: number; offlineAccounts: number; restrictedAccounts: number; utilization: number;
};

// A real (sellable) inventory account: not a showcase/dummy, not a leftover test account.
function isRealAccount(a: { notes: string | null; linkedinName: string }) {
  return !(a.notes || "").includes("[SHOWCASE]") && !a.linkedinName.toUpperCase().includes("(TEST)");
}

// Live (non-test) figures — what "Live" mode on the dashboard shows.
export async function computeCoreMetrics(): Promise<CoreMetrics> {
  const [inventoryAccounts, totalCustomers, paidRentals] = await Promise.all([
    prisma.linkedInAccount.findMany({
      where: { status: { notIn: ["removed", "retired"] } },
      select: { status: true, notes: true, linkedinName: true, restrictedAt: true },
    }),
    prisma.user.count({ where: { role: "customer", status: "active", isTest: false, rentals: { some: {} } } }),
    // MRR counts paid, committed rentals: active AND pending_access (paid up front, just
    // awaiting GoLogin setup). We keep pending_access out of the activeRentals count below.
    prisma.rental.findMany({
      where: { status: { in: ["active", "pending_access"] }, user: { isTest: false } },
      select: { status: true, lockedPrice: true, linkedinAccount: { select: { monthlyPrice: true } } },
    }),
  ]);

  const realAccounts = inventoryAccounts.filter(isRealAccount);
  const totalAccounts = realAccounts.length;
  const availableAccounts = realAccounts.filter((a) => a.status === "available").length;
  const offlineAccounts = realAccounts.filter((a) => a.status === "unavailable" || a.status === "maintenance").length;
  const restrictedAccounts = realAccounts.filter((a) => a.restrictedAt).length;

  const activeRentals = paidRentals.filter((r) => r.status === "active").length;
  const rentedAccounts = activeRentals;
  // MRR = active + pending_access (both paid); the counts above stay active-only.
  const mrr = paidRentals.reduce((s, r) => s + Number(r.lockedPrice ?? r.linkedinAccount.monthlyPrice ?? 0), 0);
  // Money out = what we ACTUALLY paid out this calendar month (ambassador setup + monthly +
  // referral/marketer fees), not a run-rate over all onboarded ambassadors. Stored in PHP →
  // convert to USD to net against the USD mrr.
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const payoutsPhp = await computeMonthlyPayoutsPhp(mStart, mEnd);
  const payouts = phpToUsd(payoutsPhp);
  const netProfit = mrr - payouts;
  const utilization = totalAccounts > 0 ? Math.round((rentedAccounts / totalAccounts) * 100) : 0;

  return { mrr, netProfit, payouts, activeRentals, totalCustomers, totalAccounts, availableAccounts, rentedAccounts, offlineAccounts, restrictedAccounts, utilization };
}
