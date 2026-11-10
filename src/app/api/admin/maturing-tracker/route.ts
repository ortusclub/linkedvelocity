import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inventoryGroup, pipelineMatcher } from "@/lib/maturing/programs.mjs";

// Profile-maturing tracker. One operator view (built for Gigi) that answers three
// questions without touching the engine (reads the AUTO maturing flags the
// reconcile-maturing cron writes, so it works even when the engine is down):
//   1. Does maturing match the admin inventory? — per inventory bucket, how many
//      eligible accounts there are vs how many are actually maturing (🔥).
//   2. Is everyone who should be maturing actually maturing? — the gap list.
//   3. What needs a human? — stalled (relogin / identity review), start-failed,
//      not-enrolled-yet, split by reason so it can be worked.
// Eligibility mirrors auto-start-maturing: an account is eligible when it is Level-4
// (pipeline) OR its inventory group is Construction / Available. Buckets use the SAME
// inventoryGroup() the board and the inventory page group by, so the counts match
// /admin/inventory-v2 (unpaid-setup accounts are "Initial", not Construction, etc.).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = {
  id: string;
  name: string;
  email: string;
  status: string;
  group: string;
  level4: boolean;
  connections: number | null;
  reason: string;
  detail: string;
  since: string | null;
};

export async function GET() {
  try {
    await requireAdmin();

    const [accountsRaw, apps, sessions] = await Promise.all([
      prisma.linkedInAccount.findMany({
        where: { status: { not: "removed" }, gologinProfileId: { not: null } },
        select: {
          id: true, gologinProfileId: true, linkedinName: true, linkedinUrl: true, loginEmail: true,
          status: true, restrictedAt: true, permanentlyRestricted: true, twoFactorResetNeeded: true,
          accountPassword: true, connectionCount: true, notes: true, inventoryPool: true,
          maturingStartedAt: true, maturingStalledAt: true, maturingStalledReason: true,
          maturingStartFailedAt: true, maturingStartFailedReason: true, restrictionLog: true,
          rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] } }, select: { id: true }, take: 1 },
        },
      }),
      prisma.ambassadorApplication.findMany({
        select: { id: true, verifiedAt: true, status: true, onboardedAt: true, paidAt: true, linkedinUrl: true, email: true, applicationReceived: true },
      }),
      prisma.selfServiceOnboarding.findMany({ select: { accountId: true, applicationId: true, state: true } }),
    ]);

    const match = pipelineMatcher(apps, sessions);

    const buckets: Record<string, { total: number; maturing: number; stalled: number; startFailed: number; notEnrolled: number }> = {
      Available: { total: 0, maturing: 0, stalled: 0, startFailed: 0, notEnrolled: 0 },
      Construction: { total: 0, maturing: 0, stalled: 0, startFailed: 0, notEnrolled: 0 },
      "Pipeline": { total: 0, maturing: 0, stalled: 0, startFailed: 0, notEnrolled: 0 },
    };
    const needsReview: Row[] = [];
    const maturing: Row[] = [];
    let restrictedCount = 0;
    const restrictedSample: Row[] = [];

    const lastEvent = (log: unknown): string => {
      const arr = Array.isArray(log) ? (log as { event?: string }[]) : [];
      return arr.length ? arr[arr.length - 1]?.event || "" : "";
    };
    const validUrl = (u: string | null) => /^https:\/\/(?:[a-z]+\.)?linkedin\.com\/in\//i.test(String(u || ""));

    for (const a of accountsRaw) {
      // Shape inventoryGroup() expects (hasPassword mirrors canonicalStatus's accountPassword).
      const shaped = {
        status: a.status, restrictedAt: a.restrictedAt, loginEmail: a.loginEmail,
        hasPassword: !!a.accountPassword, twoFactorResetNeeded: a.twoFactorResetNeeded,
        notes: a.notes, linkedinUrl: a.linkedinUrl,
      };
      const { app, pipeline } = match(a);
      const group = inventoryGroup(shaped, app);
      const rented = a.rentals.length > 0 || a.status === "rented";
      const restricted = !!a.restrictedAt || a.permanentlyRestricted;

      if (restricted) {
        restrictedCount++;
        if (restrictedSample.length < 12)
          restrictedSample.push({ id: a.id, name: a.linkedinName || "", email: a.loginEmail || "", status: a.status, group, level4: pipeline, connections: a.connectionCount, reason: "restricted", detail: a.permanentlyRestricted ? "permanently restricted" : lastEvent(a.restrictionLog) === "recovered" ? "recovered — re-maturing" : "restricted", since: a.restrictedAt?.toISOString() || null });
        continue; // restricted accounts are a separate recovery concern, never "eligible maturing"
      }

      // Not-maturable account statuses never belong in the maturing tracker, even when the
      // application is verified (Level-4): a returned ('unavailable'), retired, or in-maintenance
      // account isn't ours to mature. Without this a retired account with a verified app shows as
      // an eligible "Level-4" row. auto-start already excludes these; reconcile stops their runs.
      if (["unavailable", "retired", "maintenance"].includes(a.status)) continue;

      const eligible = pipeline || group === "Construction" || group === "Available";
      if (!eligible || rented) continue;

      const bkey = group === "Construction" || group === "Available" ? group : "Pipeline";
      const b = buckets[bkey];
      b.total++;

      const base = { id: a.id, name: a.linkedinName || "", email: a.loginEmail || "", status: a.status, group, level4: pipeline, connections: a.connectionCount };
      // Level-4 (pipeline) accounts are in the ~1-week maturing hold before onboarding.
      // Show when they're due (verified + 7d) so an overdue account is obvious.
      const vAt = app?.verifiedAt ? new Date(app.verifiedAt).getTime() : 0;
      const dueSuffix =
        pipeline && vAt
          ? (() => {
              const due = vAt + 7 * 86400000;
              const n = Math.round((due - Date.now()) / 86400000);
              const d = new Date(due).toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return ` · Due to onboard ${d} (${n < 0 ? `${-n}d overdue` : n === 0 ? "due today" : `${n}d left`}).`;
            })()
          : "";
      if (a.maturingStartedAt) {
        b.maturing++;
        maturing.push({ ...base, reason: "maturing", detail: lastEvent(a.restrictionLog) === "recovered" ? "re-maturing (recovered)" : "healthy", since: a.maturingStartedAt.toISOString() });
      } else if (a.maturingStalledAt) {
        b.stalled++;
        needsReview.push({ ...base, reason: "relogin", detail: `Campaign parked on a login/identity check${a.maturingStalledReason ? ` (${a.maturingStalledReason})` : ""}. Logging the account back in does NOT resume it on its own — re-check/resume the campaign and, if the login works, it continues and the flag clears.${dueSuffix}`, since: a.maturingStalledAt.toISOString() });
      } else if (a.maturingStartFailedAt) {
        b.startFailed++;
        needsReview.push({ ...base, reason: "start-failed", detail: `Engine couldn't launch it${a.maturingStartFailedReason ? ` — ${a.maturingStartFailedReason}` : ""}. Fix the cause (usually a missing/invalid LinkedIn URL or a login issue); it auto-retries after a cooldown.${dueSuffix}`, since: a.maturingStartFailedAt.toISOString() });
      } else {
        b.notEnrolled++;
        const detail = !validUrl(a.linkedinUrl)
          ? "No valid LinkedIn URL on the account — add it in Inventory so maturing can start."
          : "Queued for auto-start. The system switches on a few accounts at a time, so this is just waiting its turn — nothing is wrong with it.";
        needsReview.push({ ...base, reason: "not-enrolled", detail: detail + dueSuffix, since: null });
      }
    }

    const order = { "not-enrolled": 0, relogin: 1, "start-failed": 2 } as Record<string, number>;
    needsReview.sort((x, y) => (order[x.reason] ?? 9) - (order[y.reason] ?? 9) || (x.connections ?? 1e9) - (y.connections ?? 1e9));
    maturing.sort((x, y) => (y.since || "").localeCompare(x.since || ""));

    const eligibleTotal = buckets.Available.total + buckets.Construction.total + buckets["Pipeline"].total;
    const maturingTotal = buckets.Available.maturing + buckets.Construction.maturing + buckets["Pipeline"].maturing;

    return NextResponse.json(
      { updatedAt: new Date().toISOString(), buckets, needsReview, maturing, restrictedCount, restrictedSample,
        totals: { eligible: eligibleTotal, maturing: maturingTotal, needsReview: needsReview.length } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the maturing tracker.";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
