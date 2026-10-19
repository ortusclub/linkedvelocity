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
  let data: { campaigns: { status: string; profileIds: string[] }[]; engineError?: string };
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

  const maturing = new Set(
    data.campaigns
      .filter((c) => !TERMINAL.has(c.status))
      .flatMap((c) => c.profileIds || [])
      .filter(Boolean),
  );

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
  for (const a of accounts) {
    // Rented or restricted accounts are never "maturing" — maturing is paused the
    // moment an account is rented or restricted, so suppress the flag even if the
    // engine still carries a stale non-terminal campaign for its profile.
    const blocked =
      a.status === "rented" || a.rentals.length > 0 ||
      !!a.restrictedAt || a.permanentlyRestricted ||
      a.status === "retired" || a.status === "maintenance";
    const isMaturing = !blocked && !!a.gologinProfileId && maturing.has(a.gologinProfileId);
    if (isMaturing && !a.maturingStartedAt) {
      await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStartedAt: new Date() } });
      await logWarmupActivity(
        a.id,
        a.linkedinUrl,
        a.notes,
        "🔥 Maturing started (auto) — LinkedVelocity warm/cold campaign running",
        "system",
      ).catch(() => {});
      started++;
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

  return NextResponse.json({ ok: true, maturing: maturing.size, started, ended });
}

// Vercel Cron triggers with GET — alias to POST so the job runs.
export async function GET(req: NextRequest) {
  return POST(req);
}
