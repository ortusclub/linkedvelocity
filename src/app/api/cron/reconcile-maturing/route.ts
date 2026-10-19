import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logWarmupActivity } from "@/lib/warmup-activity";
import { list, control } from "@/lib/maturing/service.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Reconcile the auto maturing flag from the live Outreach engine into our DB.
// "Currently maturing" = this account's GoLogin profile has a LinkedVelocity
// maturing campaign whose status is not done/cancelled/error. We mirror that
// into LinkedInAccount.maturingStartedAt so Inventory + Pipeline can show the
// 🔥 badge without each page call depending on the engine's uptime, and we log
// the start / stop to the owner's Activity timeline (once per flip, not per tick).
// When an account is rented or restricted we also STOP its live engine campaign —
// a running campaign on a rented profile would send requests under the renter.
const TERMINAL = new Set(["done", "cancelled", "error"]);

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // If the engine is unreachable, do NOTHING. A transient engine outage must
  // never clear everyone's maturing flag — we only ever write on a real flip.
  // list() soft-fails (returns engineError instead of throwing), so check both.
  let data: { campaigns: { id: string; status: string; profileIds: string[]; createdAt?: string }[]; engineError?: string };
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

  // Per profile: the earliest start among its non-terminal campaigns, plus their
  // ids (so a blocked account's live campaigns can be stopped, not just hidden).
  // We stamp maturingStartedAt from the engine's real campaign start — NOT "now" —
  // so the "Nd" badge reflects how long the account has actually been maturing.
  const byProfile = new Map<string, { start: Date; ids: string[] }>();
  for (const c of data.campaigns) {
    if (TERMINAL.has(c.status)) continue;
    const t = c.createdAt ? new Date(c.createdAt) : null;
    const start = t && !isNaN(t.getTime()) ? t : null;
    for (const pid of c.profileIds || []) {
      if (!pid) continue;
      const cur = byProfile.get(pid);
      if (!cur) byProfile.set(pid, { start: start ?? new Date(), ids: c.id ? [c.id] : [] });
      else { if (start && start < cur.start) cur.start = start; if (c.id) cur.ids.push(c.id); }
    }
  }

  const accounts = await prisma.linkedInAccount.findMany({
    where: { gologinProfileId: { not: null }, status: { not: "removed" } },
    select: {
      id: true, gologinProfileId: true, maturingStartedAt: true, linkedinUrl: true, notes: true,
      status: true, restrictedAt: true, permanentlyRestricted: true, linkedinAccountHealth: true,
      rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] }, isShadow: false }, select: { id: true }, take: 1 },
    },
  });

  let started = 0;
  let ended = 0;
  let corrected = 0;
  let stopped = 0;
  for (const a of accounts) {
    const entry = a.gologinProfileId ? byProfile.get(a.gologinProfileId) : undefined;
    const startAt = entry?.start;
    // Rented or restricted accounts must not keep maturing: a running campaign on a
    // rented profile would send connection requests while the renter uses it. So we
    // actually STOP the engine campaign(s), not just hide the badge.
    const blocked =
      a.status === "rented" || a.rentals.length > 0 ||
      !!a.restrictedAt || a.permanentlyRestricted ||
      a.status === "retired" || a.status === "maintenance" ||
      a.linkedinAccountHealth === "restricted";

    if (blocked) {
      if (entry && entry.ids.length) {
        // Best-effort stop of every live campaign on this profile. Once stopped the
        // campaign goes terminal and drops out of byProfile, so this won't repeat.
        for (const id of entry.ids) { try { await control(id, "stop"); } catch { /* retried next run */ } }
        const reason =
          a.status === "rented" || a.rentals.length > 0 ? "account rented"
          : a.restrictedAt || a.permanentlyRestricted ? "account restricted"
          : `account ${a.status}`;
        await logWarmupActivity(a.id, a.linkedinUrl, a.notes, `Maturing stopped (auto) — ${reason}`, "system").catch(() => {});
        stopped++;
      }
      if (a.maturingStartedAt) await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStartedAt: null } });
      continue;
    }

    const isMaturing = !!startAt;
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

  return NextResponse.json({ ok: true, maturing: byProfile.size, started, ended, corrected, stopped });
}

// Vercel Cron triggers with GET — alias to POST so the job runs.
export async function GET(req: NextRequest) {
  return POST(req);
}
