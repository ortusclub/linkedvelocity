import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// Company operations for Renters v3. POST { action, ... }:
//   update     { id, name?, domain?, mainContactId?, notes? }
//   create     { name, domain? }                → returns id
//   addMember  { companyId, personId }
//   removeMember { personId }
//   ungroup    { id }                           → detaches members, deletes company
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const b = await req.json();
    switch (b.action) {
      case "update": {
        if (!b.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        const data: Record<string, unknown> = {};
        if (b.name !== undefined) data.name = b.name;
        if (b.domain !== undefined) data.domain = b.domain || null;
        if (b.notes !== undefined) data.notes = b.notes || null;
        if (b.mainContactId !== undefined) data.mainContactId = b.mainContactId || null;
        await prisma.company.update({ where: { id: b.id }, data });
        return NextResponse.json({ ok: true });
      }
      case "create": {
        if (!b.name) return NextResponse.json({ error: "Name required" }, { status: 400 });
        const co = await prisma.company.create({ data: { name: b.name, domain: b.domain || null } });
        return NextResponse.json({ ok: true, id: co.id });
      }
      case "addMember": {
        if (!b.companyId || !b.personId) return NextResponse.json({ error: "Missing ids" }, { status: 400 });
        await prisma.person.update({ where: { id: b.personId }, data: { companyId: b.companyId } });
        return NextResponse.json({ ok: true });
      }
      case "removeMember": {
        if (!b.personId) return NextResponse.json({ error: "Missing personId" }, { status: 400 });
        await prisma.person.update({ where: { id: b.personId }, data: { companyId: null } });
        return NextResponse.json({ ok: true });
      }
      case "ungroup": {
        if (!b.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        await prisma.$transaction(async (tx) => {
          await tx.person.updateMany({ where: { companyId: b.id }, data: { companyId: null } });
          await tx.company.delete({ where: { id: b.id } });
        });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    console.error("Renters v3 company error:", msg);
    return NextResponse.json({ error: "Company op failed" }, { status: 500 });
  }
}
