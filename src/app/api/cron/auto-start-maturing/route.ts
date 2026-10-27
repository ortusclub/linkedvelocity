import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logWarmupActivity } from "@/lib/warmup-activity";
import { list, start } from "@/lib/maturing/service.mjs";
import { newMaturePlan } from "@/lib/maturing/shared/mature-profile-plan.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// Keep every non-rented account maturing — warm up first, then CONTINUE with cold
// outreach, not just during onboarding. Auto-start picks up any Level-4 (QC'd /
// verified) account that isn't rented, including ones that already onboarded, and it
// keeps them going: when a campaign ends (completed OR failed) it starts a fresh one
// after a cooldown. The only hard stops are rented / explicitly restricted / removed /
// retired / maintenance (reconcile STOPS those). Gated behind MATURING_AUTOSTART=on and
// capped per run so one run can't fire dozens at once.
// NOTE: "onboarded" is intentionally NOT disqualifying anymore — maturing continues
// past onboarding (owner directive: mature everything that isn't rented).
const DISQUALIFYING_APP_STATUS = new Set(["rejected", "unreachable"]);
const norm = (u?: string | null) => (u || "").split("?")[0].replace(/\/+$/, "").toLowerCase().trim();

// Warm-then-cold ramps. Warm connections (other LV profiles) get accepted and carry low
// restriction risk, so they lead; cold outreach (from the default cold sheet) follows to
// keep the account active once the warm pool thins out. Two profiles:
//  - AGGRESSIVE (default): warm 10→18→25/day (days 1-7), then cold 8→15/day (days 8-28)
//    for clean, never-recently-restricted accounts.
//  - GENTLE: warm 2→5→8/day (days 1-14), then cold 4→8/day (days 15-35) for accounts
//    restricted/recovered in the last 30 days — fragile, warmed slowly per the SOP.
// Stages must stay consecutive (each fromDay = previous toDay + 1). Tune here.
const AGGRESSIVE_STAGES = [
  { id: "warm", name: "Warm connections", fromDay: 1, toDay: 2, warmDaily: 10, coldDaily: 0, likesDaily: 0 },
  { id: "ramp", name: "Ramp warm connections", fromDay: 3, toDay: 5, warmDaily: 18, coldDaily: 0, likesDaily: 0 },
  { id: "push", name: "Push warm connections", fromDay: 6, toDay: 7, warmDaily: 25, coldDaily: 0, likesDaily: 0 },
  { id: "cold", name: "Introduce cold outreach", fromDay: 8, toDay: 14, warmDaily: 10, coldDaily: 8, likesDaily: 0 },
  { id: "coldramp", name: "Ramp cold outreach", fromDay: 15, toDay: 28, warmDaily: 5, coldDaily: 15, likesDaily: 0 },
];
const GENTLE_STAGES = [
  { id: "warm", name: "Warm connections", fromDay: 1, toDay: 4, warmDaily: 2, coldDaily: 0, likesDaily: 0 },
  { id: "ramp", name: "Ramp warm connections", fromDay: 5, toDay: 9, warmDaily: 5, coldDaily: 0, likesDaily: 0 },
  { id: "push", name: "Ease up warm connections", fromDay: 10, toDay: 14, warmDaily: 8, coldDaily: 0, likesDaily: 0 },
  { id: "cold", name: "Introduce cold (slow)", fromDay: 15, toDay: 21, warmDaily: 5, coldDaily: 4, likesDaily: 0 },
  { id: "coldramp", name: "Ramp cold (slow)", fromDay: 22, toDay: 35, warmDaily: 3, coldDaily: 8, likesDaily: 0 },
];
function autoMaturePlan(gid: string, name: string, linkedinUrl: string | null, gentle: boolean) {
  const p = newMaturePlan() as Record<string, unknown>;
  p.warmEnabled = true;
  p.coldEnabled = true; // warm first, then cold — keep maturing past onboarding
  p.warmPool = "linkedvelocity_owned";
  p.coldPoolSource = "default"; // the shared default cold sheet (DEFAULT_MATURE_COLD_SHEET_URL)
  p.warmUntilExhausted = false; // warm runs its fixed stages, then cold carries on
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

  // Continuous maturing. A profile is skipped only while it has a campaign STILL
  // RUNNING (non-terminal). Once its campaign ENDS — whether it completed ("done") or
  // failed ("cancelled"/"error") — we restart it after a cooldown, so maturing keeps
  // going past onboarding instead of being one-and-done. start() rebuilds a fresh plan
  // excluding anyone already contacted (so a restart naturally shifts toward cold as the
  // warm pool thins). The cooldown stops a just-ended or broken account from re-firing
  // every tick and starving others; a permanently-broken one just fails again on its own.
  const TERMINAL = new Set(["done", "cancelled", "error"]);
  const RETRY_COOLDOWN_MS = Math.max(1, Number(process.env.MATURING_RETRY_COOLDOWN_H) || 24) * 3600000;
  const running = new Set<string>(); // non-terminal campaign — never disturb
  const lastEndedAt = new Map<string, number>(); // profile → newest ended-campaign time
  for (const c of data.campaigns) {
    const ended = TERMINAL.has(c.status || "");
    const t = Date.parse(c.updatedAt || c.createdAt || "") || 0;
    for (const pid of c.profileIds || []) {
      if (!pid) continue;
      if (ended) lastEndedAt.set(pid, Math.max(lastEndedAt.get(pid) || 0, t));
      else running.add(pid); // live / paused / pending
    }
  }
  // May auto-start this profile now? Never had a campaign, or its last campaign ended
  // and the cooldown has elapsed. A campaign still running blocks it.
  function campaignOk(gid: string): boolean {
    if (running.has(gid)) return false;
    const endedAt = lastEndedAt.get(gid);
    if (endedAt === undefined) return true;
    return Date.now() - endedAt >= RETRY_COOLDOWN_MS;
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
      id: true, gologinProfileId: true, linkedinName: true, linkedinUrl: true, notes: true, loginEmail: true, restrictionLog: true, status: true,
      // Any active rental blocks maturing, INCLUDING shadow rentals (Ortus / PP /
      // Agent360): the renter is using the account, so it must not fire its own
      // connection requests. Shadow rentals keep status "available", so they'd slip
      // past a status check — we must catch them via the rental itself.
      rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] } }, select: { id: true }, take: 1 },
    },
  });

  // Fragile accounts get the GENTLE ramp, not the aggressive one, so maturing doesn't
  // tip them over. Two kinds are fragile: (1) recently restricted/recovered — any
  // restriction-log event in the last 30 days (the warm-up SOP window); (2) still
  // under construction — a freshly built profile that isn't established yet and can't
  // take an aggressive 10→18→25/day ramp.
  const RESTR_WINDOW_MS = 30 * 86400000;
  function recentlyRestricted(a: { restrictionLog: unknown }): boolean {
    const log = Array.isArray(a.restrictionLog) ? (a.restrictionLog as { at?: string }[]) : [];
    return log.some((e) => e?.at && Date.now() - new Date(e.at).getTime() < RESTR_WINDOW_MS);
  }
  function isFragile(a: { restrictionLog: unknown; status: string }): boolean {
    return recentlyRestricted(a) || a.status === "under_construction";
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
  let restarted = 0;
  const errors: { account: string; error: string }[] = [];
  for (const a of candidates.slice(0, cap)) {
    const gentle = isFragile(a);
    const isRestart = lastEndedAt.has(a.gologinProfileId!);
    try {
      await start(
        { accountId: a.id, launchId: randomUUID(), plan: autoMaturePlan(a.gologinProfileId!, a.linkedinName, a.linkedinUrl, gentle), timezone: "Asia/Manila" },
        "system",
      );
      await logWarmupActivity(a.id, a.linkedinUrl, a.notes, `🔥 Maturing auto-${isRestart ? "restarted (continuing — prior campaign ended)" : "started (Level 4 / passed QC)"} — ${gentle ? `gentle warm→cold ramp (fragile — ${a.status === "under_construction" ? "still in construction" : "recently restricted"})` : "warm→cold ramp"}`, "system").catch(() => {});
      if (gentle) gentleStarted++;
      if (isRestart) restarted++;
      started++;
    } catch (e) {
      errors.push({ account: a.loginEmail || a.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, eligible: candidates.length, started, restarted, gentleStarted, capped: Math.max(0, candidates.length - started - errors.length), errors });
}

// Vercel Cron triggers with GET — alias to POST so the job runs.
export async function GET(req: NextRequest) {
  return POST(req);
}
