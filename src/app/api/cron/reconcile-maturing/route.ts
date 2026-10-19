import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logWarmupActivity } from "@/lib/warmup-activity";
import { list } from "@/lib/maturing/service.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Reconcile the auto maturing flag from the live Outreach engine into our DB.
// "Currently maturing" = this account's GoLogin profile has a LinkedVelocity
// maturing campaign whose status is not done/cancelled/error. We mirror that
// into LinkedInAccount.maturingStartedAt so Inventory + Pipeline can show the
// 🔥 badge without each page call depending on the engine's uptime, and we log
// the start / stop to the owner's Activity timeline (once per flip, not per tick).
const TERMINAL = new Set(["done", "cancelled", "error"]);

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // If the engine is unreachable, do NOTHING. A transient engine outage must
  // never clear everyone's maturing flag — we only ever write on a real flip.
  // list() soft-fails (returns engineError instead of throwing), so check both.
  let data: { campaigns: { status: string; profileIds: string[]; createdAt?: string }[]; engineError?: string };
  try {
    data = (await list()) as typeof data;
  } catch (e) {
    return NextResponse.json(
      { ok: false, skipped: "engine_unavailable", error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
  if (data.engineError) {
    return NextResponse.json({ ok: false, skipped: "engine_unavailable", error: data.engineError }, { status: 200 });
  }

  // Earliest campaign start per profile (among non-terminal campaigns). We stamp
  // maturingStartedAt from the engine's real campaign start — NOT "now" — so the
  // "Nd" badge reflects how long the account has actually been maturing, even for
  // campaigns that predate this reconcile cron.
  const startByProfile = new Map<string, Date>();
  for (const c of data.campaigns) {
    if (TERMINAL.has(c.status)) continue;
    const t = c.createdAt ? new Date(c.createdAt) : null;
    for (const pid of c.profileIds || []) {
      if (!pid) continue;
      const cur = startByProfile.get(pid);
      if (t && !isNaN(t.getTime())) { if (!cur || t < cur) startByProfile.set(pid, t); }
      else if (!cur) startByProfile.set(pid, new Date());
    }
  }
  const maturing = startByProfile;

  const accounts = await prisma.linkedInAccount.findMany({
    where: { gologinProfileId: { not: null }, status: { not: "removed" } },
    select: {
      id: true, gologinProfileId: true, maturingStartedAt: true, linkedinUrl: true, notes: true,
      status: true, restrictedAt: true, permanentlyRestricted: true,
      rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] }, isShadow: false }, select: { id: true }, take: 1 },
    },
  });

  let started = 0;
  let ended = 0;
  let corrected = 0;
  for (const a of accounts) {
    // Rented or restricted accounts are never "maturing" — maturing is paused the
    // moment an account is rented or restricted, so suppress the flag even if the
    // engine still carries a stale non-terminal campaign for its profile.
    const blocked =
      a.status === "rented" || a.rentals.length > 0 ||
      !!a.restrictedAt || a.permanentlyRestricted ||
      a.status === "retired" || a.status === "maintenance";
    const startAt = a.gologinProfileId ? maturing.get(a.gologinProfileId) : undefined;
    const isMaturing = !blocked && !!startAt;
    if (isMaturing && !a.maturingStartedAt) {
      await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStartedAt: startAt } });
      await logWarmupActivity(
        a.id,
        a.linkedinUrl,
        a.notes,
        "🔥 Maturing started (auto) — LinkedVelocity warm/cold campaign running",
        "system",
      ).catch(() => {});
      started++;
    } else if (isMaturing && a.maturingStartedAt && Math.abs(a.maturingStartedAt.getTime() - startAt!.getTime()) > 60000) {
      // Correct an earlier stamp (e.g. the first reconcile stamped "now") to the
      // real campaign start. Silent — not a start/stop event, just a date fix.
      await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStartedAt: startAt } });
      corrected++;
    } else if (!isMaturing && a.maturingStartedAt) {
      await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStartedAt: null } });
      await logWarmupActivity(
        a.id,
        a.linkedinUrl,
        a.notes,
        "Maturing finished / stopped (auto) — no active LinkedVelocity campaign",
        "system",
      ).catch(() => {});
      ended++;
    }
  }

  return NextResponse.json({ ok: true, maturing: maturing.size, started, ended, corrected });
}

// Vercel Cron triggers with GET — alias to POST so the job runs.
export async function GET(req: NextRequest) {
  return POST(req);
}
