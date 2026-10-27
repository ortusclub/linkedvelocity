import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logWarmupActivity } from "@/lib/warmup-activity";
import { list, control } from "@/lib/maturing/service.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Reconcile the auto maturing flags from the live Outreach engine into our DB.
// A profile's live campaign is classified two ways, mirrored onto the account so
// Inventory + Pipeline can badge it without depending on the engine's uptime:
//   • maturingStartedAt (🔥) — a campaign that is actually maturing (running, not a
//     terminal done/cancelled/error, and not stuck on a review).
//   • maturingStalledAt (⚠️) — it HAS a campaign but it isn't maturing: stuck on a
//     login / identity review (needs_review) etc. A stalled account must NOT wear the
//     healthy fire — it needs a human to fix it. The two flags are mutually exclusive.
// We log each start / stall / stop to the owner's Activity timeline once per flip.
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
  let data: { campaigns: { id: string; status: string; profileIds: string[]; createdAt?: string; live?: boolean }[]; engineError?: string };
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

  // A non-terminal campaign is NOT automatically "healthily maturing". Some states mean
  // "it has a campaign but it isn't actually sending" — most importantly needs_review (a
  // login / identity challenge, e.g. a profile that can't log in). Those must show the
  // ⚠️ "stalled" badge, not the healthy 🔥, so you can see and fix them. We split each
  // profile's live campaigns into healthy (actively maturing) vs stalled (stuck).
  const STALLED_STATUS = new Set(["needs_review"]);
  const stalledReason = (status: string) => (status === "needs_review" ? "login / identity review" : status);
  // Per profile: the earliest start among its healthy non-terminal campaigns, plus their
  // ids (so a blocked account's live campaigns can be stopped, not just hidden).
  // We stamp maturingStartedAt from the engine's real campaign start — NOT "now" —
  // so the "Nd" badge reflects how long the account has actually been maturing.
  const byProfile = new Map<string, { start: Date; ids: string[] }>();
  const stalledByProfile = new Map<string, { start: Date; ids: string[]; reason: string }>();
  for (const c of data.campaigns) {
    if (TERMINAL.has(c.status)) continue;
    const t = c.createdAt ? new Date(c.createdAt) : null;
    const start = t && !isNaN(t.getTime()) ? t : null;
    const stalled = STALLED_STATUS.has(c.status);
    for (const pid of c.profileIds || []) {
      if (!pid) continue;
      if (stalled) {
        const cur = stalledByProfile.get(pid);
        if (!cur) stalledByProfile.set(pid, { start: start ?? new Date(), ids: c.id ? [c.id] : [], reason: stalledReason(c.status) });
        else { if (start && start < cur.start) cur.start = start; if (c.id) cur.ids.push(c.id); }
      } else {
        const cur = byProfile.get(pid);
        if (!cur) byProfile.set(pid, { start: start ?? new Date(), ids: c.id ? [c.id] : [] });
        else { if (start && start < cur.start) cur.start = start; if (c.id) cur.ids.push(c.id); }
      }
    }
  }

  const accounts = await prisma.linkedInAccount.findMany({
    where: { gologinProfileId: { not: null }, status: { not: "removed" } },
    select: {
      id: true, gologinProfileId: true, maturingStartedAt: true, maturingStalledAt: true, maturingStalledReason: true, linkedinUrl: true, notes: true,
      status: true, restrictedAt: true, permanentlyRestricted: true, linkedinAccountHealth: true,
      // Any active rental blocks maturing, INCLUDING shadow rentals (Ortus / PP /
      // Agent360) — a shadow rental keeps status "available" but the renter is using
      // the account, so a running campaign on it must be stopped, not left firing.
      rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] } }, select: { id: true }, take: 1 },
    },
  });

  let started = 0;
  let ended = 0;
  let corrected = 0;
  let stopped = 0;
  let stalledFlagged = 0;
  for (const a of accounts) {
    const entry = a.gologinProfileId ? byProfile.get(a.gologinProfileId) : undefined;
    const stall = a.gologinProfileId ? stalledByProfile.get(a.gologinProfileId) : undefined;
    const startAt = entry?.start;
    // Rented or restricted accounts must not keep maturing: a running campaign on a
    // rented profile would send connection requests while the renter uses it. So we
    // actually STOP the engine campaign(s), not just hide the badge.
    // Hard blockers only — rented or an explicit restriction mark. We no longer stop a
    // campaign just because a health check flagged the account (that gate was dropped
    // from auto-start too); if the account really can't run, the engine fails it and the
    // campaign goes terminal on its own.
    const blocked =
      a.status === "rented" || a.rentals.length > 0 ||
      !!a.restrictedAt || a.permanentlyRestricted ||
      a.status === "retired" || a.status === "maintenance";

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
      if (a.maturingStartedAt || a.maturingStalledAt)
        await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStartedAt: null, maturingStalledAt: null, maturingStalledReason: null } });
      continue;
    }

    if (startAt) {
      // Healthy: at least one campaign actively maturing → 🔥. Clear any stale ⚠️.
      if (!a.maturingStartedAt) {
        await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStartedAt: startAt, maturingStalledAt: null, maturingStalledReason: null } });
        await logWarmupActivity(
          a.id,
          a.linkedinUrl,
          a.notes,
          "🔥 Maturing started (auto) — LinkedVelocity warm/cold campaign running",
          "system",
        ).catch(() => {});
        started++;
      } else {
        // Already maturing. Fix the start date if an earlier reconcile stamped "now",
        // and drop any leftover stalled mark. Silent — not a start/stop event.
        const patch: { maturingStartedAt?: Date; maturingStalledAt?: null; maturingStalledReason?: null } = {};
        if (Math.abs(a.maturingStartedAt.getTime() - startAt.getTime()) > 60000) { patch.maturingStartedAt = startAt; corrected++; }
        if (a.maturingStalledAt) { patch.maturingStalledAt = null; patch.maturingStalledReason = null; }
        if (Object.keys(patch).length) await prisma.linkedInAccount.update({ where: { id: a.id }, data: patch });
      }
    } else if (stall) {
      // Has a campaign but it isn't maturing (stuck on a login/identity review etc.) →
      // ⚠️ stalled, not a healthy fire. Don't auto-stop it; it needs a human to fix the
      // login. Clear any 🔥 so the maturing count stays honest.
      if (!a.maturingStalledAt) {
        await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStalledAt: stall.start, maturingStalledReason: stall.reason, maturingStartedAt: null } });
        await logWarmupActivity(
          a.id,
          a.linkedinUrl,
          a.notes,
          `⚠️ Maturing stalled (auto) — ${stall.reason}; campaign is not sending`,
          "system",
        ).catch(() => {});
        stalledFlagged++;
      } else if (a.maturingStartedAt || a.maturingStalledReason !== stall.reason || Math.abs(a.maturingStalledAt.getTime() - stall.start.getTime()) > 60000) {
        // Keep the stall mark current (reason/date) and clear any leftover 🔥. Silent.
        await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStalledAt: stall.start, maturingStalledReason: stall.reason, maturingStartedAt: null } });
      }
    } else if (a.maturingStartedAt || a.maturingStalledAt) {
      // No live campaign at all → clear both badges.
      await prisma.linkedInAccount.update({ where: { id: a.id }, data: { maturingStartedAt: null, maturingStalledAt: null, maturingStalledReason: null } });
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

  return NextResponse.json({ ok: true, maturing: byProfile.size, stalled: stalledByProfile.size, started, ended, corrected, stopped, stalledFlagged });
}

// Vercel Cron triggers with GET — alias to POST so the job runs.
export async function GET(req: NextRequest) {
  return POST(req);
}
