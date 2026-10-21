import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto-creds";
import { restrictionUpdate, type RestrictionEvent } from "@/lib/restriction";
import { parseStoredCase, LOST_LABEL, matchApp, type Step, type StoredCase } from "@/lib/recovery-case";

export const dynamic = "force-dynamic";

// Restrictions v2 — mutate one case. Drives the recovery workflow end to end: log a step, set the
// reason/PoC, mark the owner contacted, recover (QR/ID/appeal/LinkedIn), secure the account
// (GoLogin + password reset), and finally relist or hand back. A successful verify step RECOVERS
// the account (clears restrictedAt, credits rental downtime) but KEEPS THE CASE OPEN through the
// post-recovery steps; non-rented accounts go to "under construction" for the warm-up. Relist
// (→ available) and hand-back close the case for good, archiving its steps into the restriction log.
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_step"), kind: z.enum(["email", "qr", "id", "form", "li", "note", "gl", "pw", "relist", "handback"]), outcome: z.enum(["ok", "fail", "pending"]), note: z.string().max(500).optional(), password: z.string().max(200).optional() }),
  z.object({ action: z.literal("toggle_step"), kind: z.enum(["gl", "pw"]), password: z.string().max(200).optional() }),
  z.object({ action: z.literal("set_reason"), reason: z.string().max(200) }),
  z.object({ action: z.literal("set_poc"), poc: z.string().max(80) }),
  z.object({ action: z.literal("mark_recovered"), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("mark_lost"), outcome: z.enum(["perma", "nocontact"]), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("reopen") }),
]);

const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;

// Recover the account but KEEP the case open for the post-recovery workflow. Clears restrictedAt
// and credits any rental downtime (via restrictionUpdate), marks the case resolved, and parks a
// non-rented account in "under construction" for the warm-up.
async function recoverKeepOpen(id: string, stored: StoredCase, now: Date) {
  const acct = await prisma.linkedInAccount.findUnique({ where: { id }, select: { id: true, restrictedAt: true, restrictionLog: true, status: true } });
  if (!acct) throw new Error("Account not found");
  const fields = await restrictionUpdate(acct, false);
  stored.resolvedAt = now.toISOString();
  const activeRental = await prisma.rental.findFirst({ where: { linkedinAccountId: id, status: { in: ["active", "pending_access"] } }, select: { id: true } });
  const toConstruction = !activeRental && acct.status !== "rented" && acct.status !== "under_construction";
  await prisma.linkedInAccount.update({
    where: { id },
    data: {
      restrictedAt: fields.restrictedAt,
      ...(fields.restrictionLog ? { restrictionLog: asJson(fields.restrictionLog) } : {}),
      recoveryCase: asJson(stored),
      ...(toConstruction ? { status: "under_construction" } : {}),
    },
  });
}

// Final close (relist / hand back): archive the case's steps into the latest "recovered" log event
// for history, clear the live case + recovery_* fields, and (on relist) put the account back as available.
async function closeFinal(id: string, stored: StoredCase, relist: boolean) {
  const acct = await prisma.linkedInAccount.findUnique({ where: { id }, select: { restrictionLog: true } });
  const log = (Array.isArray(acct?.restrictionLog) ? acct!.restrictionLog : []) as Array<RestrictionEvent & { reason?: string; steps?: Step[] }>;
  const lastRec = [...log].reverse().find((e) => e.event === "recovered");
  if (lastRec) { if (stored.reason) lastRec.reason = stored.reason; if (stored.steps?.length) lastRec.steps = stored.steps; }
  await prisma.linkedInAccount.update({
    where: { id },
    data: {
      restrictionLog: asJson(log),
      recoveryCase: Prisma.DbNull,
      recoveryQrUrl: null, recoveryQrAt: null, recoverySentAt: null, recoverySentVia: null, recoveryOutcome: null, recoveryOutcomeAt: null,
      ...(relist ? { status: "available" } : {}),
    },
  });
}

const setPassword = (id: string, password: string) => prisma.linkedInAccount.update({ where: { id }, data: { accountPassword: encryptSecret(password.trim()) } });
const persistCase = (id: string, stored: StoredCase) => prisma.linkedInAccount.update({ where: { id }, data: { recoveryCase: asJson(stored) } });

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
      await persistCase(id, stored);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "set_poc") {
      // Write to the linked application's poc (where inventory/onboarding keep it) AND the account.
      const poc = input.poc.trim() || null;
      const acc = await prisma.linkedInAccount.findUnique({ where: { id }, select: { linkedinUrl: true, notes: true } });
      const apps = await prisma.ambassadorApplication.findMany({ select: { id: true, email: true, linkedinUrl: true } });
      const app = acc ? matchApp(apps, acc) : null;
      if (app) await prisma.ambassadorApplication.update({ where: { id: app.id }, data: { poc } });
      await prisma.linkedInAccount.update({ where: { id }, data: { poc } });
      return NextResponse.json({ ok: true });
    }

    if (input.action === "mark_recovered") {
      stored.steps.push({ k: "li", o: "ok", at: now.toISOString(), ...(input.note?.trim() ? { note: input.note.trim() } : {}) });
      await recoverKeepOpen(id, stored, now);
      return NextResponse.json({ ok: true, recovered: true });
    }

    if (input.action === "mark_lost") {
      stored.outcome = input.outcome;
      stored.closedAt = now.toISOString();
      if (input.note?.trim()) stored.outcomeNote = input.note.trim();
      await persistCase(id, stored);
      return NextResponse.json({ ok: true, lost: true });
    }

    if (input.action === "reopen") {
      const was = stored.outcome ? LOST_LABEL[stored.outcome] : "closed";
      stored.steps.push({ k: "note", o: "pending", at: now.toISOString(), note: `Reopened (was ${was})` });
      delete stored.outcome; delete stored.closedAt; delete stored.outcomeNote;
      stored.reopened = true;
      await persistCase(id, stored);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "toggle_step") {
      const has = stored.steps.some((s) => s.k === input.kind);
      if (has) stored.steps = stored.steps.filter((s) => s.k !== input.kind);
      else { stored.steps.push({ k: input.kind, o: "ok", at: now.toISOString() }); if (input.kind === "pw" && input.password?.trim()) await setPassword(id, input.password); }
      await persistCase(id, stored);
      return NextResponse.json({ ok: true });
    }

    // add_step — workflow actions + hand-logged steps
    const trimmed = input.note?.trim() || "";
    const step: Step = { k: input.kind, o: input.outcome, at: now.toISOString(), ...(input.outcome === "fail" && trimmed ? { err: trimmed } : trimmed ? { note: trimmed } : {}) };

    if (input.kind === "relist") { stored.steps.push(step); await closeFinal(id, stored, true); return NextResponse.json({ ok: true, relisted: true }); }
    if (input.kind === "handback") { stored.steps.push(step); await closeFinal(id, stored, false); return NextResponse.json({ ok: true, handedBack: true }); }

    stored.steps.push(step);
    if (input.kind === "pw" && input.password?.trim()) await setPassword(id, input.password);

    // A successful QR / ID / appeal / LinkedIn step restores the account — case stays open.
    if (input.outcome === "ok" && (input.kind === "qr" || input.kind === "id" || input.kind === "form" || input.kind === "li")) {
      if (input.kind !== "li") stored.steps.push({ k: "li", o: "ok", at: now.toISOString() });
      await recoverKeepOpen(id, stored, now);
      return NextResponse.json({ ok: true, recovered: true });
    }
    await persistCase(id, stored);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Invalid step." }, { status: 400 });
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}
