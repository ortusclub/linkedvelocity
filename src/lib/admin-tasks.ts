import { prisma } from "@/lib/prisma";

// The dashboard To-do worklist is DERIVED live from existing signals. Each task has a
// stable `taskKey` so that human state (claim / assignee / done), stored separately in
// the admin_tasks table, survives regeneration and clears automatically when the
// underlying signal resolves (the task simply stops being generated).

export type TaskCategory = "BILLING" | "RENEWALS" | "APPLICATIONS" | "SUPPLY" | "RESTRICTIONS";
export type TaskUrgency = "overdue" | "today" | "soon" | "later";

export interface DerivedTask {
  taskKey: string;
  category: TaskCategory;
  title: string;
  sub: string;
  href: string;
  urgency: TaskUrgency;
  dueLabel: string;
  sort: number; // lower = more urgent
}

const URGENCY_SORT: Record<TaskUrgency, number> = { overdue: 0, today: 1, soon: 2, later: 3 };

// A real (sellable) inventory account: not a showcase/dummy, not a leftover test account.
function isRealAccount(a: { notes: string | null; linkedinName: string }) {
  return !(a.notes || "").includes("[SHOWCASE]") && !a.linkedinName.toUpperCase().includes("(TEST)");
}

const DAY = 24 * 60 * 60 * 1000;
const daysBetween = (a: Date, b: Date) => Math.round(Math.abs(a.getTime() - b.getTime()) / DAY);
const priceOf = (lockedPrice: unknown, monthlyPrice: unknown) =>
  Number((lockedPrice as number | null) ?? (monthlyPrice as number | null) ?? 0);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export async function generateTasks(opts: { includeTest: boolean }): Promise<DerivedTask[]> {
  const now = new Date();
  const in30d = new Date(now.getTime() + 30 * DAY);
  const liveRental = opts.includeTest ? {} : { user: { isTest: false } };

  const [failedRentals, overdueRentals, cardOffRentals, apps, inventory] = await Promise.all([
    // 1. Failed charges — chase the renter / fix the card.
    prisma.rental.findMany({
      where: { status: "payment_failed", ...liveRental },
      include: { user: { select: { fullName: true } }, linkedinAccount: { select: { linkedinName: true, monthlyPrice: true } } },
    }),
    // 2. Active rentals whose billing period already lapsed (not yet renewed).
    prisma.rental.findMany({
      where: { status: "active", currentPeriodEnd: { lt: now }, ...liveRental },
      include: { user: { select: { fullName: true } }, linkedinAccount: { select: { linkedinName: true, monthlyPrice: true } } },
    }),
    // 3. Active rentals renewing soon with auto-renew OFF — need a card / manual renewal.
    prisma.rental.findMany({
      where: { status: "active", autoRenew: false, currentPeriodEnd: { gte: now, lte: in30d }, ...liveRental },
      include: { user: { select: { fullName: true } }, linkedinAccount: { select: { linkedinName: true, monthlyPrice: true } } },
    }),
    // 4. Ambassador applications waiting on review (aggregate task).
    prisma.ambassadorApplication.findMany({
      where: { status: { in: ["reviewing", "pending"] } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    // 5. Inventory — for idle + restricted aggregate tasks.
    prisma.linkedInAccount.findMany({
      where: { status: { notIn: ["removed", "retired"] } },
      select: { status: true, notes: true, linkedinName: true, restrictedAt: true },
    }),
  ]);

  const tasks: DerivedTask[] = [];

  for (const r of failedRentals) {
    tasks.push({
      taskKey: `failed-payment:${r.id}`,
      category: "BILLING",
      title: `Chase failed payment: ${r.linkedinAccount.linkedinName}`,
      sub: `${r.user.fullName} · ${money(priceOf(r.lockedPrice, r.linkedinAccount.monthlyPrice))} · card declined`,
      href: "/admin/rentals",
      urgency: "today",
      dueLabel: "Today",
      sort: URGENCY_SORT.today,
    });
  }

  for (const r of overdueRentals) {
    const days = r.currentPeriodEnd ? daysBetween(now, new Date(r.currentPeriodEnd)) : 0;
    tasks.push({
      taskKey: `overdue:${r.id}`,
      category: "RENEWALS",
      title: `Overdue renewal: ${r.linkedinAccount.linkedinName}`,
      sub: `${r.user.fullName} · was due ${days === 0 ? "today" : `${days}d ago`}`,
      href: "/admin/rentals",
      urgency: "overdue",
      dueLabel: "Overdue",
      sort: URGENCY_SORT.overdue,
    });
  }

  for (const r of cardOffRentals) {
    const d = r.currentPeriodEnd ? new Date(r.currentPeriodEnd) : now;
    tasks.push({
      taskKey: `renew-cardoff:${r.id}`,
      category: "RENEWALS",
      title: `Renewal needs a card: ${r.linkedinAccount.linkedinName}`,
      sub: `${r.user.fullName} · auto-renew off · renews ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      href: "/admin/rentals",
      urgency: "soon",
      dueLabel: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      sort: URGENCY_SORT.soon,
    });
  }

  if (apps.length > 0) {
    const waited = daysBetween(now, new Date(apps[0].createdAt));
    tasks.push({
      taskKey: "review-apps",
      category: "APPLICATIONS",
      title: `Review ${apps.length} ambassador application${apps.length === 1 ? "" : "s"}`,
      sub: waited > 0 ? `Oldest waiting ${waited} day${waited === 1 ? "" : "s"}` : "Just came in",
      href: "/admin/pipeline",
      urgency: waited >= 2 ? "today" : "soon",
      dueLabel: waited >= 2 ? "Today" : "This week",
      sort: waited >= 2 ? URGENCY_SORT.today : URGENCY_SORT.soon,
    });
  }

  const real = inventory.filter(isRealAccount);
  const idle = real.filter((a) => a.status === "available").length;
  if (idle > 0) {
    tasks.push({
      taskKey: "assign-idle",
      category: "SUPPLY",
      title: `Assign renters to ${idle} idle account${idle === 1 ? "" : "s"}`,
      sub: "Available, not earning",
      href: "/admin/accounts",
      urgency: "later",
      dueLabel: "This week",
      sort: URGENCY_SORT.later,
    });
  }

  const restricted = real.filter((a) => a.restrictedAt).length;
  if (restricted > 0) {
    tasks.push({
      taskKey: "recover-restricted",
      category: "RESTRICTIONS",
      title: `Recover ${restricted} restricted account${restricted === 1 ? "" : "s"}`,
      sub: "Access & billing paused",
      href: "/admin/restrictions",
      urgency: "overdue",
      dueLabel: "Overdue",
      sort: URGENCY_SORT.overdue,
    });
  }

  // Later: pay-run approval + per-renter replacements once their ready-state is wired.

  return tasks.sort((a, b) => a.sort - b.sort || a.taskKey.localeCompare(b.taskKey));
}
