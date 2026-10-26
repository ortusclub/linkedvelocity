import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logWarmupActivity } from "@/lib/warmup-activity";
import { list, start } from "@/lib/maturing/service.mjs";
import { newMaturePlan } from "@/lib/maturing/shared/mature-profile-plan.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// Auto-start the warm maturing campaign when an account reaches Level 4 (passed QC
// / verified) in onboarding, so the team doesn't have to add each one by hand. Starts
// profiles that never had a campaign, and RE-starts profiles whose campaigns all
// failed (a fresh replacement plan, after a cooldown); it never disturbs a campaign
// that is still running or one that already completed. Warm-only (connections to other
// LinkedVelocity profiles): cold is a deliberate post-onboarding step. Gated behind
// MATURING_AUTOSTART=on and capped per run so one run can't fire dozens at once.
const DISQUALIFYING_APP_STATUS = new Set(["onboarded", "rejected", "unreachable"]);
const norm = (u?: string | null) => (u || "").split("?")[0].replace(/\/+$/, "").toLowerCase().trim();

// Warm-only ramps. Warm connections get accepted (other LV profiles), so a higher
// pace is low-restriction-risk vs cold. Two profiles:
//  - AGGRESSIVE (default): 10→18→25/day over 7 days (~124) for clean, never-recently-
//    restricted accounts.
//  - GENTLE: 2→5→8/day over 14 days (~73) for accounts restricted/recovered in the last
//    30 days — they're fragile, so we warm them slowly per the restriction-avoidance SOP.
// Tune here.
const AGGRESSIVE_STAGES = [
  { id: "warm", name: "Warm connections", fromDay: 1, toDay: 2, warmDaily: 10, coldDaily: 0, likesDaily: 0 },
  { id: "ramp", name: "Ramp warm connections", fromDay: 3, toDay: 5, warmDaily: 18, coldDaily: 0, likesDaily: 0 },
  { id: "push", name: "Push warm connections", fromDay: 6, toDay: 7, warmDaily: 25, coldDaily: 0, likesDaily: 0 },
];
const GENTLE_STAGES = [
  { id: "warm", name: "Warm connections", fromDay: 1, toDay: 4, warmDaily: 2, coldDaily: 0, likesDaily: 0 },
  { id: "ramp", name: "Ramp warm connections", fromDay: 5, toDay: 9, warmDaily: 5, coldDaily: 0, likesDaily: 0 },
  { id: "push", name: "Ease up warm connections", fromDay: 10, toDay: 14, warmDaily: 8, coldDaily: 0, likesDaily: 0 },
];
function autoWarmPlan(gid: string, name: string, linkedinUrl: string | null, gentle: boolean) {
  const p = newMaturePlan() as Record<string, unknown>;
  p.warmEnabled = true;
  p.coldEnabled = false;
  p.warmPool = "linkedvelocity_owned";
  p.warmUntilExhausted = true;
  p.stages = gentle ? GENTLE_STAGES : AGGRESSIVE_STAGES;
  p.targetProfileIds = [gid];
  p.accounts = { [gid]: { name, linkedinUrl } };
  return p;
}

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Kill switch — off by default. Set MATURING_AUTOSTART=on to enable.
  if ((process.env.MATURING_AUTOSTART || "").toLowerCase() !== "on") {
    return NextResponse.json({ ok: false, skipped: "disabled" }, { status: 200 });
  }
  const cap = Math.max(1, Number(process.env.MATURING_AUTOSTART_MAX) || 5);

  // Need the engine to know what campaigns each profile already has. If it's down,
  // do nothing (never start blind).
  let data: {
    campaigns: { profileIds: string[]; status?: string; createdAt?: string; updatedAt?: string }[];
    engineError?: string;
  };
  try {
    data = (await list()) as typeof data;
  } catch (e) {
    return NextResponse.json({ ok: false, skipped: "engine_unavailable", error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
  if (data.engineError) return NextResponse.json({ ok: false, skipped: "engine_unavailable", error: data.engineError }, { status: 200 });

  // Auto-start is no longer one-shot. We skip a profile that has a campaign we must
  // NOT disturb — one still running (non-terminal) or one that already completed
  // ("done", i.e. it matured). But a profile whose campaigns ALL FAILED
  // ("cancelled"/"error") is retried: start() rebuilds a fresh replacement plan and
  // excludes anyone already contacted. A cooldown keeps a permanently-broken account
  // from re-firing every tick — it retries at most once per window and simply fails
  // again on its own (that's the policy), without starving brand-new accounts.
  const FAILED = new Set(["cancelled", "error"]);
  const RETRY_COOLDOWN_MS = Math.max(1, Number(process.env.MATURING_RETRY_COOLDOWN_H) || 24) * 3600000;
  const protectedProfiles = new Set<string>(); // running OR already matured ("done") — never auto-touch
  const lastFailedAt = new Map<string, number>(); // profile → newest failed-campaign time
  for (const c of data.campaigns) {
    const failed = FAILED.has(c.status || "");
    const t = Date.parse(c.updatedAt || c.createdAt || "") || 0;
    for (const pid of c.profileIds || []) {
      if (!pid) continue;
      if (failed) lastFailedAt.set(pid, Math.max(lastFailedAt.get(pid) || 0, t));
      else protectedProfiles.add(pid); // live / paused / pending / done
    }
  }
  // May auto-start this profile now? Never had a campaign, or its only campaigns
  // failed and the cooldown has elapsed. A live or completed campaign blocks it.
  function campaignOk(gid: string): boolean {
    if (protectedProfiles.has(gid)) return false;
    const failedAt = lastFailedAt.get(gid);
    if (failedAt === undefined) return true;
    return Date.now() - failedAt >= RETRY_COOLDOWN_MS;
  }

  // Level-4 signal lives on the application (verifiedAt set, not onboarded). Resolve
  // each eligible account to its application the same way the pipeline does.
  const apps = await prisma.ambassadorApplication.findMany({
    select: { id: true, verifiedAt: true, status: true, linkedinUrl: true, email: true },
  });
  const verifiedByUrl = new Map<string, boolean>();
  const verifiedByEmail = new Map<string, boolean>();
  const urlCount = new Map<string, number>();
  const appLive = new Map<string, boolean>();
  for (const a of apps) {
    const live = !!a.verifiedAt && !DISQUALIFYING_APP_STATUS.has(a.status);
    appLive.set(a.id, live);
    const u = norm(a.linkedinUrl);
    if (u) { urlCount.set(u, (urlCount.get(u) || 0) + 1); if (live) verifiedByUrl.set(u, true); }
    const em = (a.email || "").toLowerCase();
    if (em && live) verifiedByEmail.set(em, true);
  }
  const sessions = await prisma.selfServiceOnboarding.findMany({
    select: { accountId: true, applicationId: true },
  });
  const verifiedBySession = new Map<string, boolean>();
  for (const s of sessions) {
    if (s.accountId) verifiedBySession.set(s.accountId, appLive.get(s.applicationId) ?? false);
  }

  const accounts = await prisma.linkedInAccount.findMany({
    where: {
      gologinProfileId: { not: null },
      status: { notIn: ["removed", "rented", "retired", "maintenance"] },
      // Only hard exclusions: rented (renter is using it) and an explicit restriction
      // mark (restrictedAt / permanentlyRestricted — reconcile auto-STOPS those, so
      // starting them would just fight it). No readiness gate otherwise: if a verified
      // account can't actually run (challenge, stale login, etc.) let it fail on its own.
      restrictedAt: null,
      permanentlyRestricted: false,
    },
    select: {
      id: true, gologinProfileId: true, linkedinName: true, linkedinUrl: true, notes: true, loginEmail: true, restrictionLog: true,
      rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] }, isShadow: false }, select: { id: true }, take: 1 },
    },
  });

  // Recently restricted/recovered accounts (any restriction-log event in the last 30
  // days, matching the warm-up SOP window) are fragile — give them the GENTLE ramp,
  // not the aggressive one, so maturing doesn't tip them back into a restriction.
  const RESTR_WINDOW_MS = 30 * 86400000;
  function recentlyRestricted(a: { restrictionLog: unknown }): boolean {
    const log = Array.isArray(a.restrictionLog) ? (a.restrictionLog as { at?: string }[]) : [];
    return log.some((e) => e?.at && Date.now() - new Date(e.at).getTime() < RESTR_WINDOW_MS);
  }

  // Is this account's application at Level 4? session link wins, then unique URL, then owner-email.
  function atLevel4(a: (typeof accounts)[number]): boolean {
    if (verifiedBySession.has(a.id)) return verifiedBySession.get(a.id)!;
    const u = norm(a.linkedinUrl);
    if (u && urlCount.get(u) === 1 && verifiedByUrl.has(u)) return true;
    const ownerEmail = (a.notes || "").match(/Owner:\s*(\S+@\S+)/i)?.[1]?.replace(/[.,;]+$/, "").toLowerCase();
    if (ownerEmail && verifiedByEmail.has(ownerEmail)) return true;
    return false;
  }

  const candidates = accounts.filter(
    (a) =>
      !!a.gologinProfileId &&
      a.rentals.length === 0 &&
      campaignOk(a.gologinProfileId) &&
      atLevel4(a),
  );

  let started = 0;
  let gentleStarted = 0;
  let retried = 0;
  const errors: { account: string; error: string }[] = [];
  for (const a of candidates.slice(0, cap)) {
    const gentle = recentlyRestricted(a);
    const isRetry = lastFailedAt.has(a.gologinProfileId!);
    try {
      await start(
        { accountId: a.id, launchId: randomUUID(), plan: autoWarmPlan(a.gologinProfileId!, a.linkedinName, a.linkedinUrl, gentle), timezone: "Asia/Manila" },
        "system",
      );
      await logWarmupActivity(a.id, a.linkedinUrl, a.notes, `🔥 Maturing auto-${isRetry ? "restarted (prior campaign failed)" : "started (Level 4 / passed QC)"} — ${gentle ? "gentle warm ramp (recently restricted)" : "aggressive warm ramp"}`, "system").catch(() => {});
      if (gentle) gentleStarted++;
      if (isRetry) retried++;
      started++;
    } catch (e) {
      errors.push({ account: a.loginEmail || a.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, eligible: candidates.length, started, retried, gentleStarted, capped: Math.max(0, candidates.length - started - errors.length), errors });
}

// Vercel Cron triggers with GET — alias to POST so the job runs.
export async function GET(req: NextRequest) {
  return POST(req);
}
