import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logWarmupActivity } from "@/lib/warmup-activity";
import { list, start } from "@/lib/maturing/service.mjs";
import { categoryResolver, programStages } from "@/lib/maturing/programs.mjs";
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

function autoMaturePlan(gid: string, name: string, linkedinUrl: string | null, gentle: boolean, category: string) {
  const p = newMaturePlan() as Record<string, unknown>;
  p.warmEnabled = true;
  p.coldEnabled = true; // warm first, then cold — keep maturing past onboarding
  p.warmPool = "linkedvelocity_owned";
  p.coldPoolSource = "default"; // the shared default cold sheet (DEFAULT_MATURE_COLD_SHEET_URL)
  p.warmUntilExhausted = false; // warm runs its fixed stages, then cold carries on
  p.stages = programStages(category, gentle);
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
    select: { id: true, verifiedAt: true, status: true, linkedinUrl: true, email: true, applicationReceived: true, paidAt: true },
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
    select: { accountId: true, applicationId: true, state: true },
  });
  const verifiedBySession = new Map<string, boolean>();
  for (const s of sessions) {
    if (s.accountId) verifiedBySession.set(s.accountId, appLive.get(s.applicationId) ?? false);
  }

  const accounts = await prisma.linkedInAccount.findMany({
    where: {
      gologinProfileId: { not: null },
      status: { notIn: ["removed", "rented", "retired", "maintenance"] },
      // Campaign pool = our own LinkedArmy outreach personas, run by hand. Never auto-start
      // a warm-up/maturing campaign on them (it would fight the real outreach we run).
      inventoryPool: { not: "campaign" },
      // Only hard exclusions: rented (renter is using it) and an explicit restriction
      // mark (restrictedAt / permanentlyRestricted — reconcile auto-STOPS those, so
      // starting them would just fight it). No readiness gate otherwise: if a verified
      // account can't actually run (challenge, stale login, etc.) let it fail on its own.
      restrictedAt: null,
      permanentlyRestricted: false,
    },
    select: {
      id: true, gologinProfileId: true, linkedinName: true, linkedinUrl: true, notes: true, loginEmail: true, restrictionLog: true, status: true, maturingStartFailedAt: true, createdAt: true, connectionCount: true,
      // Any active rental blocks maturing, INCLUDING shadow rentals (Ortus / PP /
      // Agent360): the renter is using the account, so it must not fire its own
      // connection requests. Shadow rentals keep status "available", so they'd slip
      // past a status check — we must catch them via the rental itself.
      rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] } }, select: { id: true }, take: 1 },
    },
  });

  // Recent restriction history keeps the gentle ramp in every inventory category.
  const RESTR_WINDOW_MS = 30 * 86400000;
  function recentlyRestricted(a: { restrictionLog: unknown }): boolean {
    const log = Array.isArray(a.restrictionLog) ? (a.restrictionLog as { at?: string }[]) : [];
    return log.some((e) => e?.at && Date.now() - new Date(e.at).getTime() < RESTR_WINDOW_MS);
  }
  function isFragile(a: { restrictionLog: unknown; status: string }): boolean {
    return recentlyRestricted(a);
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

  // Skip an account whose last auto-start THREW (engine couldn't launch it — e.g. the
  // profile can't log in) until a cooldown elapses. Without this the cron re-picks the
  // same failing accounts at the front every tick, burning all `cap` start slots on
  // them and never reaching the accounts that CAN start. After the cooldown it retries
  // once; a persistently-broken account just surfaces in the ⚠️ attention list.
  const STARTFAIL_COOLDOWN_MS = Math.max(1, Number(process.env.MATURING_STARTFAIL_COOLDOWN_H) || 6) * 3600000;
  function startFailOk(a: { maturingStartFailedAt: Date | null }): boolean {
    return !a.maturingStartFailedAt || Date.now() - a.maturingStartFailedAt.getTime() >= STARTFAIL_COOLDOWN_MS;
  }

  // ?explain=<login email>: say which check excludes one account, start nothing.
  // Added when the job answered "eligible: 0" for accounts every outside model
  // said were eligible (Sam, 2026-11-08).
  const explain = (req.nextUrl.searchParams.get("explain") || "").trim().toLowerCase();
  if (explain) {
    const raw = await prisma.linkedInAccount.findFirst({
      where: { loginEmail: { equals: explain, mode: "insensitive" } },
      select: { id: true, gologinProfileId: true, status: true, inventoryPool: true, restrictedAt: true, permanentlyRestricted: true, notes: true, maturingStartFailedAt: true, maturingStartFailedReason: true,
        rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] } }, select: { id: true, status: true } } },
    });
    if (!raw) return NextResponse.json({ explain, found: false });
    const inQuery = accounts.find((a) => a.id === raw.id) || null;
    const gid = raw.gologinProfileId || "";
    const checks = {
      hasGoLoginProfile: !!gid,
      statusAllowed: !["removed", "rented", "retired", "maintenance"].includes(raw.status),
      notCampaignPool: raw.inventoryPool !== "campaign",
      noRestrictionMark: !raw.restrictedAt && !raw.permanentlyRestricted,
      noActiveRental: raw.rentals.length === 0,
      noRunningCampaign: !gid || !running.has(gid),
      retryCooldownOver: !gid || !lastEndedAt.has(gid) || Date.now() - (lastEndedAt.get(gid) || 0) >= RETRY_COOLDOWN_MS,
      startFailCooldownOver: startFailOk(raw),
      level4OrInventoryStatus: inQuery ? (atLevel4(inQuery) || ["under_construction", "construction_immature", "available"].includes(raw.status)) : ["under_construction", "construction_immature", "available"].includes(raw.status),
      notShowcase: !(raw.notes || "").includes("[SHOWCASE]"),
    };
    const failing = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
    return NextResponse.json({ explain, found: true, eligible: failing.length === 0, failing, checks, status: raw.status, gologinProfileId: gid,
      lastEndedAt: gid && lastEndedAt.has(gid) ? new Date(lastEndedAt.get(gid)!).toISOString() : null, runningOnEngine: !!gid && running.has(gid),
      startFailedAt: raw.maturingStartFailedAt, startFailedReason: raw.maturingStartFailedReason, engineCampaigns: data.campaigns.length });
  }
  const candidates = accounts.filter(
    (a) =>
      !!a.gologinProfileId &&
      a.rentals.length === 0 &&
      campaignOk(a.gologinProfileId) &&
      startFailOk(a) &&
      (atLevel4(a) || ["under_construction", "construction_immature", "available"].includes(a.status)) &&
      !(a.notes || "").includes("[SHOWCASE]"),
  );

  // Pipeline accounts take priority over already-onboarded inventory. Match
  // the Level-4 bucket: received, QC passed, no setup in progress, not earning
  // inventory with its setup fee paid. Retain all existing eligibility holds.
  const category = categoryResolver(apps, sessions);
  const isPipeline = (a: (typeof accounts)[number]) => category(a) === "pipeline";
  const CONSTRUCTION_STATUS = new Set(["under_construction", "construction_immature"]);
  const inConstruction = (a: { status: string }) => CONSTRUCTION_STATUS.has(a.status);
  // A scoped operator-triggered run can enrol just the visible Level-4 cohort.
  const pipelineOnly = req.nextUrl.searchParams.get("pipelineOnly") === "true";
  const ordered = candidates.filter(a => !pipelineOnly || isPipeline(a)).sort((a, b) => {
    const ra = isPipeline(a) ? 0 : 1, rb = isPipeline(b) ? 0 : 1;
    if (ra !== rb) return ra - rb;                                   // pipeline first
    const na = a.connectionCount ?? 1e9, nb = b.connectionCount ?? 1e9;
    if (na !== nb) return na - nb;                                   // fewest connections first (<100 need it most)
    return a.createdAt.getTime() - b.createdAt.getTime();            // then longest-waiting
  });

  let started = 0;
  let gentleStarted = 0;
  let restarted = 0;
  let startFailed = 0;
  let queueFull = false;
  const errors: { account: string; error: string }[] = [];
  for (const a of ordered.slice(0, cap)) {
    const gentle = isFragile(a) || isPipeline(a);
    const isRestart = lastEndedAt.has(a.gologinProfileId!);
    try {
      await start(
        { accountId: a.id, launchId: randomUUID(), plan: autoMaturePlan(a.gologinProfileId!, a.linkedinName, a.linkedinUrl, gentle, category(a)), timezone: "Asia/Manila" },
        "system",
      );
      await logWarmupActivity(a.id, a.linkedinUrl, a.notes, `🔥 Maturing auto-${isRestart ? "restarted (continuing — prior campaign ended)" : "started"} — ${category(a)} programme${gentle ? " · gentle ramp" : ""}`, "system").catch(() => {});
      // Clear any prior start-failure mark now that it launched.
      if (a.maturingStartFailedAt) await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStartFailedAt: null, maturingStartFailedReason: null } }).catch(() => {});
      if (gentle) gentleStarted++;
      if (isRestart) restarted++;
      started++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ account: a.loginEmail || a.id, error: msg });
      // Engine on-ramp full ("You already have N campaigns queued or scheduled"). This is
      // a GLOBAL limit, not this account's fault — don't penalize it. Just stop adding this
      // tick; the queue drains as campaigns launch, and we try again next run.
      if (/queued or scheduled|campaigns? queued|queue slot|CAMPAIGN_QUEUE_FULL/i.test(msg)) {
        queueFull = true;
        break;
      }
      // Real per-account failure — the engine couldn't launch THIS profile (e.g. it can't
      // log in). Stamp a cooldown so the next tick advances PAST it instead of re-hitting it,
      // and surface it in the ⚠️ attention list. Only re-logs to the timeline on a new failure.
      startFailed++;
      const firstTime = !a.maturingStartFailedAt;
      await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStartFailedAt: new Date(), maturingStartFailedReason: `couldn't start — ${msg.slice(0, 120)}` } }).catch(() => {});
      if (firstTime) await logWarmupActivity(a.id, a.linkedinUrl, a.notes, `⚠️ Maturing could not start (auto) — ${msg.slice(0, 140)}`, "system").catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, eligible: ordered.length, construction: ordered.filter(inConstruction).length, started, restarted, gentleStarted, startFailed, queueFull, capped: Math.max(0, ordered.length - started - errors.length), errors });
}

// Vercel Cron triggers with GET — alias to POST so the job runs.
export async function GET(req: NextRequest) {
  return POST(req);
}
