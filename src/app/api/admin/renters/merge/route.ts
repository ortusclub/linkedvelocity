import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { businessDomain } from "@/lib/crm-compose";

// Duplicate resolution for Renters v3. POST { action, ... }:
//   merge    { intoId, fromId }  → move from's conversations + empty fields + user/lead links
//                                   into `into`, delete `from`, resolve dupes.
//   group    { aId, bId }        → "different people, same company": put both in one company.
//   dismiss  { dupeId } | { aId, bId } → mark the suggestion resolved.
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const b = await req.json();

    if (b.action === "merge") {
      const { intoId, fromId } = b;
      if (!intoId || !fromId || intoId === fromId) return NextResponse.json({ error: "Bad ids" }, { status: 400 });
      const into = await prisma.person.findUnique({ where: { id: intoId } });
      const from = await prisma.person.findUnique({ where: { id: fromId } });
      if (!into || !from) return NextResponse.json({ error: "Not found" }, { status: 404 });

      await prisma.$transaction(async (tx) => {
        await tx.conversation.updateMany({ where: { personId: fromId }, data: { personId: intoId } });
        // delete `from` first so unique userId / inboundLeadId can move onto `into`
        await tx.person.delete({ where: { id: fromId } });
        const fill: Record<string, unknown> = {};
        for (const k of ["email", "contact", "channel", "role", "source", "pocOwner", "leadStage", "notes", "companyId"] as const) {
          if ((into as Record<string, unknown>)[k] == null && (from as Record<string, unknown>)[k] != null) fill[k] = (from as Record<string, unknown>)[k];
        }
        if (into.userId == null && from.userId != null) fill.userId = from.userId;
        if (into.inboundLeadId == null && from.inboundLeadId != null) fill.inboundLeadId = from.inboundLeadId;
        if (from.lastActivityAt > into.lastActivityAt) fill.lastActivityAt = from.lastActivityAt;
        if (Object.keys(fill).length) await tx.person.update({ where: { id: intoId }, data: fill });
        await tx.duplicateSuggestion.deleteMany({ where: { OR: [{ personAId: fromId }, { personBId: fromId }, { personAId: intoId }, { personBId: intoId }] } });
      });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "group") {
      const { aId, bId } = b;
      if (!aId || !bId) return NextResponse.json({ error: "Bad ids" }, { status: 400 });
      const a = await prisma.person.findUnique({ where: { id: aId }, select: { companyId: true, email: true } });
      const bp = await prisma.person.findUnique({ where: { id: bId }, select: { companyId: true, email: true } });
      if (!a || !bp) return NextResponse.json({ error: "Not found" }, { status: 404 });
      let companyId = a.companyId || bp.companyId;
      if (!companyId) {
        const domain = businessDomain(a.email) || businessDomain(bp.email);
        const name = domain ? domain.split(".")[0].replace(/\b\w/g, (m) => m.toUpperCase()) : "New company";
        const co = await prisma.company.create({ data: { name, domain: domain ?? null } });
        companyId = co.id;
      }
      await prisma.person.updateMany({ where: { id: { in: [aId, bId] } }, data: { companyId } });
      await prisma.duplicateSuggestion.deleteMany({ where: { OR: [{ personAId: aId, personBId: bId }, { personAId: bId, personBId: aId }] } });
      return NextResponse.json({ ok: true, companyId });
    }

    if (b.action === "dismiss") {
      if (b.dupeId) await prisma.duplicateSuggestion.update({ where: { id: b.dupeId }, data: { dismissedAt: new Date() } });
      else if (b.aId && b.bId) await prisma.duplicateSuggestion.updateMany({ where: { OR: [{ personAId: b.aId, personBId: b.bId }, { personAId: b.bId, personBId: b.aId }] }, data: { dismissedAt: new Date() } });
      else return NextResponse.json({ error: "Missing dupe ref" }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    console.error("Renters v3 merge error:", msg);
    return NextResponse.json({ error: "Merge op failed" }, { status: 500 });
  }
}
