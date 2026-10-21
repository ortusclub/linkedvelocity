import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { restrictionUpdate, type RestrictionEvent } from "@/lib/restriction";
import { parseStoredCase, LOGGABLE, LOST_LABEL, type Step, type StoredCase } from "@/lib/recovery-case";

const POCS = ["", "Ardi", "Milee", "Sam", "Ortus"] as const;

export const dynamic = "force-dynamic";

// Restrictions v2 — mutate one case. Logs a recovery step (ID / Appeal form / LinkedIn decision /
// Note), sets the case reason, or marks the account recovered. A LinkedIn "Restored" step and the
// explicit "mark recovered" both close the case: they run the shared restrictionUpdate (clears
// restrictedAt, credits rental downtime), archive the case's steps + reason into the restrictionLog
// "recovered" event for history, and reset the recovery_* fields so the next case starts clean.
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_step"), kind: z.enum(["id", "form", "li", "note"]), outcome: z.enum(["ok", "fail", "pending"]), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("set_reason"), reason: z.string().max(200) }),
  z.object({ action: z.literal("set_poc"), poc: z.enum(POCS) }),
  z.object({ action: z.literal("mark_recovered"), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("mark_lost"), outcome: z.enum(["perma", "nocontact"]), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("reopen") }),
]);

async function closeCase(id: string, stored: StoredCase, note: string | undefined, now: Date) {
  const acct = await prisma.linkedInAccount.findUnique({ where: { id }, select: { id: true, restrictedAt: true, restrictionLog: true } });
  if (!acct) throw new Error("Account not found");
  const fields = await restrictionUpdate(acct, false, note);
  // Enrich the just-appended "recovered" event with the archived case for history.
  const log = (fields.restrictionLog || (Array.isArray(acct.restrictionLog) ? (acct.restrictionLog as RestrictionEvent[]) : [])) as Array<RestrictionEvent & { reason?: string; steps?: Step[] }>;
  const lastRec = [...log].reverse().find((e) => e.event === "recovered");
  if (lastRec) { if (stored.reason) lastRec.reason = stored.reason; if (stored.steps?.length) lastRec.steps = stored.steps; }
  await prisma.linkedInAccount.update({
    where: { id },
    data: {
      restrictedAt: fields.restrictedAt,
      restrictionLog: log as unknown as Prisma.InputJsonValue,
      recoveryCase: Prisma.DbNull,
      recoveryQrUrl: null, recoveryQrAt: null, recoverySentAt: null, recoverySentVia: null, recoveryOutcome: null, recoveryOutcomeAt: null,
    },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const input = schema.parse(await req.json().catch(() => ({})));
    const now = new Date();

    const acct = await prisma.linkedInAccount.findUnique({ where: { id }, select: { recoveryCase: true } });
    if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    const stored = parseStoredCase(acct.recoveryCase);
    stored.steps = stored.steps || [];

    if (input.action === "set_reason") {
      stored.reason = input.reason.trim() || undefined;
      await prisma.linkedInAccount.update({ where: { id }, data: { recoveryCase: stored as unknown as Prisma.InputJsonValue } });
      return NextResponse.json({ ok: true });
    }

    if (input.action === "set_poc") {
      await prisma.linkedInAccount.update({ where: { id }, data: { poc: input.poc || null } });
      return NextResponse.json({ ok: true });
    }

    if (input.action === "mark_recovered") {
      await closeCase(id, stored, input.note, now);
      return NextResponse.json({ ok: true, recovered: true });
    }

    // Close the case as lost (permanently restricted / can't contact owner) — keeps the account
    // restricted, just stops the worklist chasing it. Reversible via "reopen".
    if (input.action === "mark_lost") {
      stored.outcome = input.outcome;
      stored.closedAt = now.toISOString();
      if (input.note?.trim()) stored.outcomeNote = input.note.trim();
      await prisma.linkedInAccount.update({ where: { id }, data: { recoveryCase: stored as unknown as Prisma.InputJsonValue } });
      return NextResponse.json({ ok: true, lost: true });
    }

    if (input.action === "reopen") {
      const was = stored.outcome ? LOST_LABEL[stored.outcome] : "closed";
      stored.steps.push({ k: "note", o: "pending", at: now.toISOString(), note: `Reopened (was ${was})` });
      delete stored.outcome; delete stored.closedAt; delete stored.outcomeNote;
      await prisma.linkedInAccount.update({ where: { id }, data: { recoveryCase: stored as unknown as Prisma.InputJsonValue } });
      return NextResponse.json({ ok: true });
    }

    // add_step
    if (!LOGGABLE.includes(input.kind)) return NextResponse.json({ error: "That step can't be logged by hand." }, { status: 400 });
    const trimmed = input.note?.trim() || "";
    const step: Step = { k: input.kind, o: input.outcome, at: now.toISOString(), ...(input.outcome === "fail" && trimmed ? { err: trimmed } : trimmed ? { note: trimmed } : {}) };
    stored.steps.push(step);

    // A LinkedIn "Restored" decision closes the case.
    if (input.kind === "li" && input.outcome === "ok") {
      await closeCase(id, stored, trimmed || "LinkedIn restored the account", now);
      return NextResponse.json({ ok: true, recovered: true });
    }
    await prisma.linkedInAccount.update({ where: { id }, data: { recoveryCase: stored as unknown as Prisma.InputJsonValue } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Invalid step." }, { status: 400 });
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}
