import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { businessDomain } from "@/lib/crm-compose";

// ─────────────────────────────────────────────────────────────────────────────
// Renters v3 — Phase 1 (persisted). Reads the unified crm_people overlay and derives
// renter numbers (rentals / MRR / vetting / payment) from the linked User. Writes
// persist to crm_people; renter-operational fields proxy to the User (single source).
// ─────────────────────────────────────────────────────────────────────────────

function vettingLabel(vettingReview?: string | null, vettedAt?: Date | null): "Verified" | "Needs review" | "Not vetted" {
  if (vettingReview === "verified") return "Verified";
  if (vettingReview === "flagged" || vettingReview === "pending" || vettedAt) return "Needs review";
  return "Not vetted";
}
const VET_TO_REVIEW: Record<string, string> = { Verified: "verified", "Needs review": "flagged", "Not vetted": "pending" };

export async function GET() {
  try {
    await requireAdmin();

    const people = await prisma.person.findMany({
      include: {
        company: true,
        conversations: { orderBy: { createdAt: "desc" } },
        user: {
          include: {
            rentals: {
              select: {
                status: true, lockedPrice: true, replacesRentalId: true, discountCode: true,
                linkedinAccount: { select: { monthlyPrice: true } },
              },
            },
            _count: { select: { rentals: true } },
          },
        },
      },
      orderBy: { lastActivityAt: "desc" },
    });

    const userIds = people.map((p) => p.userId).filter((x): x is string => !!x);
    const leadIds = people.map((p) => p.inboundLeadId).filter((x): x is string => !!x);

    const [deposits, txns, leads, companiesRaw, dupeRows] = await Promise.all([
      userIds.length ? prisma.transaction.findMany({ where: { userId: { in: userIds }, type: "deposit" }, select: { userId: true, description: true } }) : Promise.resolve([]),
      userIds.length ? prisma.transaction.findMany({ where: { userId: { in: userIds } }, select: { userId: true, type: true, amount: true } }) : Promise.resolve([]),
      leadIds.length ? prisma.inboundLead.findMany({ where: { id: { in: leadIds } }, select: { id: true, commsSummary: true, commsSummaryAt: true, lastContactAt: true } }) : Promise.resolve([]),
      prisma.company.findMany(),
      prisma.duplicateSuggestion.findMany({ where: { dismissedAt: null } }),
    ]);

    const fundingByUser = new Map<string, "Card" | "Crypto Wallet">();
    for (const d of deposits) {
      if ((d.description || "").startsWith("stripe_topup")) fundingByUser.set(d.userId, "Card");
      else if (!fundingByUser.has(d.userId)) fundingByUser.set(d.userId, "Crypto Wallet");
    }
    const txnCount = new Map<string, number>();
    const paidTotal = new Map<string, number>();
    for (const t of txns) {
      txnCount.set(t.userId, (txnCount.get(t.userId) || 0) + 1);
      if (t.type === "rental_payment") paidTotal.set(t.userId, (paidTotal.get(t.userId) || 0) + Number(t.amount));
    }
    const leadById = new Map(leads.map((l) => [l.id, l]));

    const rows = people.map((p) => {
      const u = p.user;
      const rentals = u?.rentals ?? [];
      const live = rentals.filter((r) => r.status === "active");
      const mrr = live.reduce((s, r) => s + Number(r.lockedPrice ?? r.linkedinAccount?.monthlyPrice ?? 0), 0);
      const lead = p.inboundLeadId ? leadById.get(p.inboundLeadId) : null;
      const stale = !!lead && p.conversations.length > 0 && (!lead.commsSummary || !lead.commsSummaryAt || lead.commsSummaryAt < lead.lastContactAt);
      return {
        id: p.id,
        kind: p.userId ? "user" : "lead",
        userId: p.userId,
        leadId: p.inboundLeadId,
        name: p.name,
        email: p.email,
        channel: (p.channel as "WA" | "TG" | null) ?? null,
        contact: p.contact,
        role: p.role,
        source: p.source,
        pocOwner: (p.pocOwner as "Ardi" | "Milee" | "Sam" | null) ?? null,
        followUp: p.followUp ? p.followUp.toISOString() : null,
        leadStage: (p.leadStage as "warm" | "cold" | null) ?? null,
        vetting: u ? vettingLabel(u.vettingReview, u.vettedAt) : "Not vetted",
        paymentMethod: (u && fundingByUser.get(u.id)) || null,
        paymentFailed: rentals.some((r) => r.status === "payment_failed"),
        signInAccess: u?.credentialAccess ?? false,
        dailyCap: u?.dailyRentalLimit ?? 5,
        isTest: u ? u.isTest : p.isTest,
        notes: p.notes,
        liveRentals: live.length,
        totalRentals: u?._count.rentals ?? 0,
        mrr,
        txnCount: (u && txnCount.get(u.id)) || 0,
        paidTotal: (u && paidTotal.get(u.id)) || 0,
        replacementCount: rentals.filter((r) => r.replacesRentalId).length,
        discount: rentals.find((r) => r.discountCode)?.discountCode ?? null,
        joinedAt: p.joinedAt.toISOString(),
        lastActivityAt: p.lastActivityAt.toISOString(),
        companyId: p.companyId,
        companyDomain: p.company?.domain ?? null,
        vettingReviewRaw: u?.vettingReview ?? null,
        commsSummary: lead?.commsSummary ?? null,
        commsSummaryStale: stale,
        conversations: p.conversations.map((c) => ({
          id: c.id, type: c.type, text: c.text,
          meta: [c.direction, c.createdAt.toISOString()].filter(Boolean).join(" · "),
          author: c.authorName || c.authorEmail || null, ts: c.createdAt.toISOString(),
        })),
      };
    });

    const companies = companiesRaw.map((c) => ({
      id: c.id, domain: c.domain ?? "", name: c.name, notes: c.notes, mainContactId: c.mainContactId,
      memberIds: people.filter((p) => p.companyId === c.id).map((p) => p.id),
    }));
    const dupes = dupeRows.map((d) => ({ id: d.id, aId: d.personAId, bId: d.personBId, reason: d.reason }));

    return NextResponse.json({ people: rows, companies, dupes });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    console.error("Renters v3 GET error:", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Update a person. Persists CRM fields to crm_people and proxies the renter-operational
// fields (vetting / sign-in / cap / test) to the linked User (single source of truth).
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const b = await req.json();
    const id: string = b.id;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const person = await prisma.person.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!person) return NextResponse.json({ error: "Person not found" }, { status: 404 });

    // CRM layer → crm_people
    const data: Record<string, unknown> = {};
    for (const k of ["name", "email", "channel", "contact", "role", "source", "pocOwner", "leadStage", "notes"] as const) {
      if (b[k] !== undefined) data[k] = b[k] === "" ? null : b[k];
    }
    if (b.followUp !== undefined) data.followUp = b.followUp ? new Date(b.followUp) : null;
    // Company: existing id, clear, or create-new by name
    if (b.newCompanyName) {
      const domain = businessDomain(b.email ?? null);
      const co = await prisma.company.create({ data: { name: b.newCompanyName, domain: domain ?? null } });
      data.companyId = co.id;
    } else if (b.companyId !== undefined) {
      data.companyId = b.companyId || null;
    }
    if (Object.keys(data).length) await prisma.person.update({ where: { id }, data });

    // Renter-operational layer → User
    if (person.userId) {
      const udata: Record<string, unknown> = {};
      if (typeof b.vetting === "string" && VET_TO_REVIEW[b.vetting]) udata.vettingReview = VET_TO_REVIEW[b.vetting];
      if (typeof b.signInAccess === "boolean") udata.credentialAccess = b.signInAccess;
      if (typeof b.dailyCap === "number" && Number.isFinite(b.dailyCap)) udata.dailyRentalLimit = Math.max(1, Math.min(50, Math.round(b.dailyCap)));
      if (typeof b.isTest === "boolean") udata.isTest = b.isTest;
      if (Object.keys(udata).length) {
        await prisma.user.update({ where: { id: person.userId }, data: udata });
        if ("credentialAccess" in udata) console.log(`[cred-access] ${admin.email} set credential access ${udata.credentialAccess ? "ON" : "OFF"} for user ${person.userId}`);
      }
    } else if (typeof b.isTest === "boolean") {
      await prisma.person.update({ where: { id }, data: { isTest: b.isTest } });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    console.error("Renters v3 PATCH error:", msg);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}

// Add a new person (no account yet → a lead/contact row).
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const b = await req.json();
    const name = (b.name || "").trim();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    let companyId: string | null = b.companyId || null;
    if (b.newCompanyName) {
      const co = await prisma.company.create({ data: { name: b.newCompanyName, domain: businessDomain(b.email ?? null) ?? null } });
      companyId = co.id;
    }
    const p = await prisma.person.create({
      data: {
        name, email: b.email || null, channel: b.channel || null, contact: b.contact || null,
        companyId, role: b.role || null, source: b.source || null, pocOwner: b.pocOwner || null,
        leadStage: b.leadStage || "warm", followUp: b.followUp ? new Date(b.followUp) : null, notes: b.notes || null,
      },
    });
    return NextResponse.json({ ok: true, id: p.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    return NextResponse.json({ error: "Create failed" }, { status: 500 });
  }
}

// Delete a person. Renter (has userId) → full account removal (as the Renters tab always
// meant). Lead-only → remove the person + its originating inbound lead.
export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const person = await prisma.person.findUnique({ where: { id }, select: { id: true, userId: true, inboundLeadId: true } });
    if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (person.userId) {
      const user = await prisma.user.findUnique({ where: { id: person.userId }, select: { email: true, role: true, rentals: { select: { linkedinAccountId: true } } } });
      if (user?.role === "admin") return NextResponse.json({ error: "Admins can't be deleted here." }, { status: 400 });
      const accountIds = [...new Set((user?.rentals ?? []).map((r) => r.linkedinAccountId))];
      await prisma.$transaction(async (tx) => {
        await tx.person.delete({ where: { id } }); // conversations cascade
        await tx.transaction.deleteMany({ where: { userId: person.userId! } });
        await tx.rental.deleteMany({ where: { userId: person.userId! } });
        await tx.session.deleteMany({ where: { userId: person.userId! } });
        await tx.waitlist.deleteMany({ where: { userId: person.userId! } });
        await tx.depositAddress.deleteMany({ where: { userId: person.userId! } }).catch(() => {});
        if (user?.email) {
          await tx.ambassadorApplication.deleteMany({ where: { email: user.email } }).catch(() => {});
          await tx.verificationCode.deleteMany({ where: { email: user.email } }).catch(() => {});
        }
        await tx.user.delete({ where: { id: person.userId! } });
        for (const aid of accountIds) {
          const stillRented = await tx.rental.count({ where: { linkedinAccountId: aid, status: { in: ["active", "pending_access"] } } });
          if (stillRented === 0) await tx.linkedInAccount.updateMany({ where: { id: aid, status: "rented" }, data: { status: "available", twoFactorResetNeeded: true } });
        }
      });
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.person.delete({ where: { id } });
        if (person.inboundLeadId) await tx.inboundLead.delete({ where: { id: person.inboundLeadId } }).catch(() => {});
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    console.error("Renters v3 DELETE error:", msg);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
