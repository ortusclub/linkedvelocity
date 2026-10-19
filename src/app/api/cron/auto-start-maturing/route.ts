import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logWarmupActivity } from "@/lib/warmup-activity";
import { list, start } from "@/lib/maturing/service.mjs";
import { newMaturePlan } from "@/lib/maturing/shared/mature-profile-plan.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// Auto-start the warm maturing campaign when an account reaches Level 4 (passed QC
// / verified) in onboarding, so the team doesn't have to add each one by hand. Only
// touches accounts that have NEVER had a campaign — it never resurrects a stopped or
// finished one. Warm-only (connections to other LinkedVelocity profiles): cold is a
// deliberate post-onboarding step. Gated behind MATURING_AUTOSTART=on and capped per
// run so the first run can't fire dozens of campaigns at once.
const DISQUALIFYING_APP_STATUS = new Set(["onboarded", "rejected", "unreachable"]);
const norm = (u?: string | null) => (u || "").split("?")[0].replace(/\/+$/, "").toLowerCase().trim();

// Aggressive warm-only ramp for the ~1-week maturation hold. Warm connections get
// accepted (other LV profiles), so a higher pace is low-restriction-risk vs cold.
// ~124 connections over 7 days. Tune here.
function autoWarmPlan(gid: string, name: string, linkedinUrl: string | null) {
  const p = newMaturePlan() as Record<string, unknown>;
  p.warmEnabled = true;
  p.coldEnabled = false;
  p.warmPool = "linkedvelocity_owned";
  p.warmUntilExhausted = true;
  p.stages = [
    { id: "warm", name: "Warm connections", fromDay: 1, toDay: 2, warmDaily: 10, coldDaily: 0, likesDaily: 0 },
    { id: "ramp", name: "Ramp warm connections", fromDay: 3, toDay: 5, warmDaily: 18, coldDaily: 0, likesDaily: 0 },
    { id: "push", name: "Push warm connections", fromDay: 6, toDay: 7, warmDaily: 25, coldDaily: 0, likesDaily: 0 },
  ];
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

  // Need the engine to know which profiles already have a campaign. If it's down,
  // do nothing (never start blind).
  let data: { campaigns: { profileIds: string[] }[]; engineError?: string };
  try {
    data = (await list()) as typeof data;
  } catch (e) {
    return NextResponse.json({ ok: false, skipped: "engine_unavailable", error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
  if (data.engineError) return NextResponse.json({ ok: false, skipped: "engine_unavailable", error: data.engineError }, { status: 200 });
  const hasCampaign = new Set(data.campaigns.flatMap((c) => c.profileIds || []).filter(Boolean));

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
      restrictedAt: null,
      permanentlyRestricted: false,
    },
    select: {
      id: true, gologinProfileId: true, linkedinName: true, linkedinUrl: true, notes: true, loginEmail: true,
      rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] }, isShadow: false }, select: { id: true }, take: 1 },
    },
  });

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
    (a) => !!a.gologinProfileId && a.rentals.length === 0 && !hasCampaign.has(a.gologinProfileId) && atLevel4(a),
  );

  let started = 0;
  const errors: { account: string; error: string }[] = [];
  for (const a of candidates.slice(0, cap)) {
    try {
      await start(
        { accountId: a.id, launchId: randomUUID(), plan: autoWarmPlan(a.gologinProfileId!, a.linkedinName, a.linkedinUrl), timezone: "Asia/Manila" },
        "system",
      );
      await logWarmupActivity(a.id, a.linkedinUrl, a.notes, "🔥 Maturing auto-started (Level 4 / passed QC) — aggressive warm ramp", "system").catch(() => {});
      started++;
    } catch (e) {
      errors.push({ account: a.loginEmail || a.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, eligible: candidates.length, started, capped: Math.max(0, candidates.length - started - errors.length), errors });
}

// Vercel Cron triggers with GET — alias to POST so the job runs.
export async function GET(req: NextRequest) {
  return POST(req);
}
