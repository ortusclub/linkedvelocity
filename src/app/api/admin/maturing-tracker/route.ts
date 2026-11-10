import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inventoryGroup, pipelineMatcher } from "@/lib/maturing/programs.mjs";

// Profile-maturing tracker API. Returns everything the tracker page renders, from the DB alone
// (reads the AUTO flags the reconcile-maturing cron writes + the MANUAL maturing_flag an operator
// sets), so it works even when the engine is down. Three things:
//   1. KPIs + per-inventory-bucket match (does every eligible profile mature; does it match
//      /admin/inventory-v2 — same inventoryGroup() grouping, so unpaid-setup = Initial, etc.).
//   2. Needs review — eligible-but-not-maturing (relogin / start-failed / not-enrolled) PLUS any
//      account an operator has manually flagged (logged out / identity / paused / other).
//   3. Currently maturing — every live-maturing account, searchable/filterable on the page.
// Eligibility mirrors auto-start-maturing: Level-4 (pipeline) OR inventory group Construction /
// Available; returned/retired/maintenance/rented/restricted are never "eligible maturing".

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = 86400000;
const BUCKET_NAME: Record<string, string> = {
  available: "Available (inventory)",
  construction: "Construction (inventory)",
  pipeline: "Pipeline maturing (level 4)",
};
const FLAG_LABEL: Record<string, string> = {
  logged_out: "Logged out", relogin: "Needs relogin", identity: "Identity check", paused: "Paused", other: "Other",
};

type Flag = { kind?: string; note?: string | null; by?: string; at?: string } | null;

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
          maturingStartFailedAt: true, maturingStartFailedReason: true, maturingFlag: true, restrictionLog: true,
          rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] } }, select: { id: true }, take: 1 },
        },
      }),
      prisma.ambassadorApplication.findMany({
        select: { id: true, verifiedAt: true, status: true, onboardedAt: true, paidAt: true, linkedinUrl: true, email: true, applicationReceived: true },
      }),
      prisma.selfServiceOnboarding.findMany({ select: { accountId: true, applicationId: true, state: true } }),
    ]);

    const match = pipelineMatcher(apps, sessions);
    const now = Date.now();
    const lastEvent = (log: unknown): string => {
      const arr = Array.isArray(log) ? (log as { event?: string }[]) : [];
      return arr.length ? arr[arr.length - 1]?.event || "" : "";
    };
    const validUrl = (u: string | null) => /^https:\/\/(?:[a-z]+\.)?linkedin\.com\/in\//i.test(String(u || ""));
    const ago = (ms: number) => { const d = Math.floor((now - ms) / DAY); if (d >= 1) return `${d}d ago`; const h = Math.floor((now - ms) / 3600000); if (h >= 1) return `${h}h ago`; return `${Math.max(1, Math.floor((now - ms) / 60000))}m ago`; };

    const buckets: Record<string, { key: string; name: string; inv: number; mat: number; relogin: number; fail: number; ne: number }> = {
      available: { key: "available", name: BUCKET_NAME.available, inv: 0, mat: 0, relogin: 0, fail: 0, ne: 0 },
      construction: { key: "construction", name: BUCKET_NAME.construction, inv: 0, mat: 0, relogin: 0, fail: 0, ne: 0 },
      pipeline: { key: "pipeline", name: BUCKET_NAME.pipeline, inv: 0, mat: 0, relogin: 0, fail: 0, ne: 0 },
    };

    type Review = { id: string; kind: string; label: string; email: string; name: string; bucket: string; status: string; conns: number | null; detail: string; sub: string; facts: { l: string; v: string }[]; since: string; sinceDays: number; canRecheck: boolean; canRestrict: boolean; isFlag: boolean };
    type MatRow = { id: string; email: string; name: string; bucket: string; status: string; conns: number | null; day: number; started: string; re: boolean; flagKind: string | null; flagLabel: string | null };
    const review: Review[] = [];
    const rows: MatRow[] = [];
    const notEnrolled: { a: (typeof accountsRaw)[number]; bucketKey: string; pipeline: boolean; app: { verifiedAt?: Date | null } | null }[] = [];
    let restrictedCount = 0;

    const dueFacts = (pipeline: boolean, app: { verifiedAt?: Date | null } | null): { l: string; v: string }[] => {
      if (!pipeline || !app?.verifiedAt) return [];
      const due = new Date(app.verifiedAt).getTime() + 7 * DAY;
      const n = Math.round((due - now) / DAY);
      const d = new Date(due).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return [{ l: "Onboard due", v: `${d} (${n < 0 ? `${-n}d overdue` : n === 0 ? "today" : `${n}d left`})` }];
    };

    for (const a of accountsRaw) {
      const shaped = { status: a.status, restrictedAt: a.restrictedAt, loginEmail: a.loginEmail, hasPassword: !!a.accountPassword, twoFactorResetNeeded: a.twoFactorResetNeeded, notes: a.notes, linkedinUrl: a.linkedinUrl };
      const { app, pipeline } = match(a);
      const group = inventoryGroup(shaped, app);
      const rented = a.rentals.length > 0 || a.status === "rented";
      if (a.restrictedAt || a.permanentlyRestricted) { restrictedCount++; continue; }
      if (["unavailable", "retired", "maintenance"].includes(a.status)) continue;
      const eligible = pipeline || group === "Construction" || group === "Available";
      if (!eligible || rented) continue;

      const bucketKey = group === "Construction" ? "construction" : group === "Available" ? "available" : "pipeline";
      const b = buckets[bucketKey];
      b.inv++;
      const bucketName = BUCKET_NAME[bucketKey];
      const re = lastEvent(a.restrictionLog) === "recovered";
      const base = { id: a.id, email: a.loginEmail || "", name: a.linkedinName || "", bucket: bucketName, status: a.status, conns: a.connectionCount };
      const flag = (a.maturingFlag as Flag) || null;
      const flagKind = flag?.kind && FLAG_LABEL[flag.kind] ? flag.kind : null;

      // Manual operator flag → always a needs-review item. Except 'other', it also drops the
      // account out of the live maturing count (it needs a human).
      if (flagKind) {
        review.push({ ...base, kind: `flag:${flagKind}`, label: FLAG_LABEL[flagKind], detail: flag?.note || "Flagged by an operator.", sub: `Flagged${flag?.by ? ` by ${flag.by}` : ""}${flag?.at ? ` · ${ago(Date.parse(flag.at))}` : ""}`, facts: [], since: flag?.at ? ago(Date.parse(flag.at)) : "", sinceDays: flag?.at ? Math.floor((now - Date.parse(flag.at)) / DAY) : 0, canRecheck: ["relogin", "identity", "logged_out"].includes(flagKind), canRestrict: true, isFlag: true });
      }

      if (a.maturingStartedAt) {
        const day = Math.max(1, Math.floor((now - a.maturingStartedAt.getTime()) / DAY) + 1);
        rows.push({ ...base, day, started: ago(a.maturingStartedAt.getTime()), re, flagKind, flagLabel: flagKind ? FLAG_LABEL[flagKind] : null });
        if (!flagKind || flagKind === "other") b.mat++;
      } else if (flagKind) {
        // flagged but not maturing — already in review; no further engine classification
      } else if (a.maturingStalledAt) {
        b.relogin++;
        review.push({ ...base, kind: "relogin", label: "Relogin / identity", detail: `Campaign parked on a login/identity check${a.maturingStalledReason ? ` (${a.maturingStalledReason})` : ""}. Logging the account back in does NOT resume it — use Re-check / resume; if the login works it continues and the flag clears.`, sub: "", facts: dueFacts(pipeline, app), since: ago(a.maturingStalledAt.getTime()), sinceDays: Math.floor((now - a.maturingStalledAt.getTime()) / DAY), canRecheck: true, canRestrict: true, isFlag: false });
      } else if (a.maturingStartFailedAt) {
        b.fail++;
        review.push({ ...base, kind: "start-failed", label: "Start failed", detail: `Engine couldn't launch it${a.maturingStartFailedReason ? ` — ${a.maturingStartFailedReason}` : ""}. Fix the cause (usually a missing/invalid LinkedIn URL or a login issue); it auto-retries after a cooldown.`, sub: "", facts: dueFacts(pipeline, app), since: ago(a.maturingStartFailedAt.getTime()), sinceDays: Math.floor((now - a.maturingStartFailedAt.getTime()) / DAY), canRecheck: true, canRestrict: true, isFlag: false });
      } else {
        b.ne++;
        notEnrolled.push({ a, bucketKey, pipeline, app });
      }
    }

    // Not-enrolled: order the way auto-start picks (pipeline first, then fewest connections) and
    // give each its queue position so the operator can see how far down the line it is.
    notEnrolled.sort((x, y) => (x.pipeline === y.pipeline ? (x.a.connectionCount ?? 1e9) - (y.a.connectionCount ?? 1e9) : x.pipeline ? -1 : 1));
    const neTotal = notEnrolled.length;
    notEnrolled.forEach((e, i) => {
      const a = e.a;
      const facts = [{ l: "Queue", v: `#${i + 1} of ${neTotal}` }, ...dueFacts(e.pipeline, e.app)];
      const detail = !validUrl(a.linkedinUrl)
        ? "No valid LinkedIn URL on the account — add it in Inventory so maturing can start."
        : "Queued for auto-start. The system switches on a few accounts at a time, so this is just waiting its turn — nothing is wrong with it.";
      review.push({ id: a.id, kind: "not-enrolled", label: "Not enrolled", email: a.loginEmail || "", name: a.linkedinName || "", bucket: BUCKET_NAME[e.bucketKey], status: a.status, conns: a.connectionCount, detail, sub: "", facts, since: "", sinceDays: 0, canRecheck: false, canRestrict: false, isFlag: false });
    });

    const reviewOrder = (k: string) => (k.startsWith("flag:") ? 0 : k === "relogin" ? 1 : k === "start-failed" ? 2 : 3);
    review.sort((x, y) => reviewOrder(x.kind) - reviewOrder(y.kind) || y.sinceDays - x.sinceDays);
    rows.sort((x, y) => y.day - x.day);

    const eligible = buckets.available.inv + buckets.construction.inv + buckets.pipeline.inv;
    const maturing = buckets.available.mat + buckets.construction.mat + buckets.pipeline.mat;

    return NextResponse.json(
      {
        updatedAt: new Date().toISOString(),
        kpis: { eligible, maturing, maturingPct: eligible ? Math.round((maturing / eligible) * 100) : 0, needsReview: review.length, restricted: restrictedCount },
        buckets: [buckets.available, buckets.construction, buckets.pipeline],
        review, rows,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the maturing tracker.";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
