import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { restrictionUpdate, type RestrictionEvent } from "@/lib/restriction";
import { notifyBillingPaused } from "@/lib/billing-pause-notify";
import { notifyRestrictionOwnerReferrer } from "@/lib/restrict-notify";

// Admin: mark a rented account as restricted (LinkedIn restricted it, we're recovering)
// or clear it (recovered). On recover, credit the active rental's downtime by extending
// currentPeriodEnd by the time it was restricted.
// Body: { restricted: boolean, notifyOwnerReferrer?: boolean }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const restrict = !!body.restricted;
    // Owner+referrer "restricted / payments suspended" notice fires ONLY when the caller opts
    // in (the inventory UI asks per restriction). Other restrict paths — PATCH, pipeline carry —
    // still auto-notify on their own; this flag only gates the /restricted (inventory) path.
    const notifyOwner = !!body.notifyOwnerReferrer;
    const note = typeof body.note === "string" ? body.note.trim() : "";

    const account = await prisma.linkedInAccount.findUnique({ where: { id } });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    // Single source of truth for the restrict/recover event + shared log (also used by
    // the account PATCH route, so pipeline restriction changes are logged identically).
    const fields = await restrictionUpdate(account, restrict, note);
    const updated = await prisma.linkedInAccount.update({
      where: { id },
      data: { restrictedAt: fields.restrictedAt, ...(fields.restrictionLog ? { restrictionLog: fields.restrictionLog } : {}) },
    });

    // Recovered: clear any "I'll wait" choice on this account's live rentals (there's nothing
    // left to wait for).
    if (!restrict && account.restrictedAt) {
      await prisma.rental.updateMany({
        where: { linkedinAccountId: id, status: { in: ["active", "pending_access", "payment_failed"] }, waitingForRecovery: true },
        data: { waitingForRecovery: false, waitChosenAt: null },
      });
    }

    // Newly restricted (was clear, now set): tell any real renter(s) their billing is paused,
    // and (only if the caller opted in) notify the account owner + referrer.
    let notify: Awaited<ReturnType<typeof notifyRestrictionOwnerReferrer>> | null = null;
    if (restrict && !account.restrictedAt && updated.restrictedAt) {
      const renters = await prisma.rental.findMany({
        where: { linkedinAccountId: id, isShadow: false, status: { in: ["active", "pending_access", "payment_failed"] } },
        select: { userId: true },
      });
      const seen = new Set<string>();
      for (const r of renters) {
        if (seen.has(r.userId)) continue;
        seen.add(r.userId);
        await notifyBillingPaused(r.userId, { trigger: "restricted", highlightAccount: account.linkedinName });
      }
      // Owner + referrer notice — only when explicitly requested (best-effort; must not fail the restrict).
      if (notifyOwner) {
        try { notify = await notifyRestrictionOwnerReferrer(id); } catch (e) { console.error("restrict owner/referrer notify failed", e); }
      }
    }

    return NextResponse.json({ restrictedAt: updated.restrictedAt, creditedDays: fields.creditedDays ?? 0, restrictionLog: updated.restrictionLog, notify });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const code = msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}

// Admin: replace the whole restriction history with an edited version (fix dates, flip an
// event's type, edit/clear a note, add a past entry, or drop one). A manual correction tool —
// it does NOT touch rental credits or send notifications (unlike POST). The live `restrictedAt`
// flag is recomputed from the edited log: the account is "currently restricted" iff its most
// recent event (by `at`) is a restriction. creditedDays on an existing entry is preserved when
// its `at` is unchanged.
// Body: { log: { at: string; event: "restricted" | "recovered"; note?: string }[] }
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body.log) ? body.log : null;
    if (!raw) return NextResponse.json({ error: "Missing log array" }, { status: 400 });

    const account = await prisma.linkedInAccount.findUnique({ where: { id }, select: { id: true, restrictionLog: true } });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    const prev: RestrictionEvent[] = Array.isArray(account.restrictionLog) ? (account.restrictionLog as RestrictionEvent[]) : [];
    const creditByAt = new Map(prev.filter((e) => e.creditedDays != null).map((e) => [e.at, e.creditedDays]));

    // Validate + normalise each entry.
    const cleaned: RestrictionEvent[] = [];
    for (const e of raw) {
      const atStr = typeof e?.at === "string" ? e.at : "";
      const d = atStr ? new Date(atStr) : null;
      if (!d || isNaN(d.getTime())) return NextResponse.json({ error: `Invalid date: ${atStr || "(empty)"}` }, { status: 400 });
      if (e?.event !== "restricted" && e?.event !== "recovered") return NextResponse.json({ error: "Each entry needs event 'restricted' or 'recovered'" }, { status: 400 });
      const at = d.toISOString();
      const note = typeof e?.note === "string" ? e.note.trim() : "";
      const credited = creditByAt.get(at);
      cleaned.push({ at, event: e.event, ...(note ? { note } : {}), ...(credited != null ? { creditedDays: credited } : {}) });
    }
    // Chronological order (oldest first), matching how restrictionUpdate appends.
    cleaned.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    const last = cleaned[cleaned.length - 1];
    const restrictedAt = last && last.event === "restricted" ? new Date(last.at) : null;

    const updated = await prisma.linkedInAccount.update({
      where: { id },
      data: { restrictionLog: cleaned, restrictedAt },
    });
    return NextResponse.json({ restrictedAt: updated.restrictedAt, restrictionLog: updated.restrictionLog });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const code = msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}

// Admin: delete a single event from the restriction history (a mistaken restrict/recover
// entry). Identified by its `at` timestamp. If the deleted event was the account's current
// open restriction (its `at` matches restrictedAt), we also clear restrictedAt so the flag
// and the log stay consistent. Does not touch rental credits (this is a correction).
// Body: { at: string }
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const at = typeof body.at === "string" ? body.at : "";
    if (!at) return NextResponse.json({ error: "Missing event timestamp" }, { status: 400 });

    const account = await prisma.linkedInAccount.findUnique({ where: { id }, select: { id: true, restrictedAt: true, restrictionLog: true } });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const log: RestrictionEvent[] = Array.isArray(account.restrictionLog) ? (account.restrictionLog as RestrictionEvent[]) : [];
    const idx = log.findIndex((e) => e.at === at);
    if (idx === -1) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    const removed = log[idx];
    const nextLog = log.filter((_, i) => i !== idx);

    // Clearing the open restriction event also clears the live flag.
    const clearsFlag = removed.event === "restricted" && account.restrictedAt && new Date(account.restrictedAt).toISOString() === at;

    const updated = await prisma.linkedInAccount.update({
      where: { id },
      data: { restrictionLog: nextLog, ...(clearsFlag ? { restrictedAt: null } : {}) },
    });
    return NextResponse.json({ restrictedAt: updated.restrictedAt, restrictionLog: updated.restrictionLog });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const code = msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
