import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { composePeople, computeDuplicatePairs, loadAccountHolders, isAccountHolder } from "@/lib/crm-compose";

// ─────────────────────────────────────────────────────────────────────────────
// Phase-1 backfill. POST { mode: "dry" | "run", force?: boolean }
//   dry → compute the unified structure from User + InboundLead and report counts
//         (+ a small sample). Writes nothing.
//   run → populate companies / crm_people / conversations / duplicate_suggestions.
//         Refuses if crm_people already has rows unless force=true (then wipes + rebuilds).
// Idempotent via pre-generated ids + bulk createMany.
// ─────────────────────────────────────────────────────────────────────────────
// GET = dry-run (safe, read-only) so you can review counts by opening the URL in the browser.
export async function GET() {
  try {
    await requireAdmin();
    const { people, companies, dupes } = await composePeople(prisma);
    const convTotal = people.reduce((s, p) => s + p.conversations.length, 0);
    const existing = await prisma.person.count();
    return NextResponse.json({
      mode: "dry",
      alreadyBackfilled: existing,
      wouldCreate: {
        people: people.length,
        renters: people.filter((p) => p.userId).length,
        leadsOnly: people.filter((p) => !p.userId).length,
        companies: companies.length,
        conversations: convTotal,
        duplicateSuggestions: dupes.length,
      },
      sample: people.slice(0, 12).map((p) => ({ name: p.name, email: p.email, company: p.companyDomain, kind: p.userId ? "renter/signup" : "lead", convs: p.conversations.length })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    return NextResponse.json({ error: "Dry-run failed: " + msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { mode = "dry", force = false } = await req.json().catch(() => ({}));

    // Recompute duplicate suggestions against the PERSISTED people (keeps real person ids;
    // does not rebuild anything else). Use after tightening the dupe rule.
    if (mode === "reseed-dupes") {
      const persisted = await prisma.person.findMany({ select: { id: true, name: true, email: true, contact: true, joinedAt: true } });
      const pairs = computeDuplicatePairs(persisted);
      await prisma.duplicateSuggestion.deleteMany({});
      if (pairs.length) await prisma.duplicateSuggestion.createMany({ data: pairs.map((p) => ({ id: randomUUID(), personAId: p.aId, personBId: p.bId, reason: p.reason })), skipDuplicates: true });
      return NextResponse.json({ mode: "reseed-dupes", duplicateSuggestions: pairs.length });
    }

    // Remove ambassador/account-owner rows that slipped in as 0-rental "signups" (they hold a
    // LinkedIn account by name/email but never rented), then reseed dupes. Surgical — leaves
    // real renters + edits intact.
    if (mode === "prune-ambassadors") {
      const persons = await prisma.person.findMany({ where: { NOT: { userId: null } }, select: { id: true, name: true, email: true, user: { select: { _count: { select: { rentals: true } } } } } });
      const holders = await loadAccountHolders(prisma);
      const targetIds = persons.filter((p) => (p.user?._count.rentals ?? 0) === 0 && isAccountHolder(p.name, p.email, holders)).map((p) => p.id);
      if (targetIds.length) {
        await prisma.duplicateSuggestion.deleteMany({ where: { OR: [{ personAId: { in: targetIds } }, { personBId: { in: targetIds } }] } });
        await prisma.company.updateMany({ where: { mainContactId: { in: targetIds } }, data: { mainContactId: null } });
        await prisma.person.deleteMany({ where: { id: { in: targetIds } } });
      }
      const survivors = await prisma.person.findMany({ select: { id: true, name: true, email: true, contact: true, joinedAt: true } });
      const pairs = computeDuplicatePairs(survivors);
      await prisma.duplicateSuggestion.deleteMany({});
      if (pairs.length) await prisma.duplicateSuggestion.createMany({ data: pairs.map((p) => ({ id: randomUUID(), personAId: p.aId, personBId: p.bId, reason: p.reason })), skipDuplicates: true });
      return NextResponse.json({ mode: "prune-ambassadors", removed: targetIds.length, duplicateSuggestions: pairs.length });
    }

    const { people, companies, dupes } = await composePeople(prisma);
    const convTotal = people.reduce((s, p) => s + p.conversations.length, 0);
    const stats = {
      people: people.length,
      renters: people.filter((p) => p.userId).length,
      leadsOnly: people.filter((p) => !p.userId).length,
      companies: companies.length,
      conversations: convTotal,
      duplicateSuggestions: dupes.length,
    };

    if (mode !== "run") {
      const sample = people.slice(0, 12).map((p) => ({
        name: p.name, email: p.email, company: p.companyDomain, kind: p.userId ? "renter/signup" : "lead", convs: p.conversations.length,
      }));
      return NextResponse.json({ mode: "dry", wouldCreate: stats, sample });
    }

    // run
    const existing = await prisma.person.count();
    if (existing > 0 && !force) {
      return NextResponse.json({ error: `crm_people already has ${existing} rows. Pass force:true to wipe and rebuild.`, existing }, { status: 409 });
    }
    if (existing > 0 && force) {
      await prisma.duplicateSuggestion.deleteMany({});
      await prisma.conversation.deleteMany({});
      await prisma.person.deleteMany({});
      await prisma.company.deleteMany({});
    }

    // Pre-generate ids so we can bulk-insert in dependency order.
    const keyToId = new Map<string, string>();
    for (const p of people) keyToId.set(p.key, randomUUID());
    const domainToId = new Map<string, string>();
    for (const c of companies) domainToId.set(c.domain, randomUUID());

    await prisma.company.createMany({
      data: companies.map((c) => ({
        id: domainToId.get(c.domain)!,
        name: c.name,
        domain: c.domain,
        mainContactId: keyToId.get(c.mainContactKey) ?? null,
      })),
    });

    await prisma.person.createMany({
      data: people.map((p) => ({
        id: keyToId.get(p.key)!,
        userId: p.userId,
        inboundLeadId: p.inboundLeadId,
        name: p.name,
        email: p.email,
        channel: p.channel,
        contact: p.contact,
        companyId: p.companyDomain ? domainToId.get(p.companyDomain) ?? null : null,
        role: p.role,
        source: p.source,
        pocOwner: p.pocOwner,
        followUp: p.followUp,
        leadStage: p.leadStage,
        isTest: p.isTest,
        notes: p.notes,
        joinedAt: p.joinedAt,
        lastActivityAt: p.lastActivityAt,
      })),
    });

    const convRows = people.flatMap((p) => {
      const pid = keyToId.get(p.key)!;
      return p.conversations.map((c) => ({
        id: randomUUID(), personId: pid, type: c.type, text: c.text,
        direction: c.direction, authorName: c.authorName, authorEmail: c.authorEmail,
        externalId: c.externalId, createdAt: c.createdAt,
      }));
    });
    if (convRows.length) {
      // chunk to keep each insert well under parameter limits
      for (let i = 0; i < convRows.length; i += 500) {
        await prisma.conversation.createMany({ data: convRows.slice(i, i + 500) });
      }
    }

    const dupeRows = dupes.flatMap((d) => {
      const a = keyToId.get(d.aKey); const b = keyToId.get(d.bKey);
      return a && b ? [{ id: randomUUID(), personAId: a, personBId: b, reason: d.reason }] : [];
    });
    if (dupeRows.length) await prisma.duplicateSuggestion.createMany({ data: dupeRows, skipDuplicates: true });

    return NextResponse.json({ mode: "run", created: { ...stats }, wiped: existing > 0 && force });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") {
      return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    }
    console.error("Backfill error:", msg);
    return NextResponse.json({ error: "Backfill failed: " + msg }, { status: 500 });
  }
}
