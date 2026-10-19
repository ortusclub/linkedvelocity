import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Renters v3 — PREVIEW (Phase 0)
//
// This endpoint composes the unified "Person" view the Renters v3 UI expects, but
// WITHOUT any new tables or migration. It reads the existing spines live and merges
// them in-memory:
//   • User (role:"customer")  → renters + signups (the account/billing side)
//   • InboundLead             → leads + their conversation history (commsLog)
// De-dupe is by email, then phone/handle. Company grouping is derived from shared
// email domains (no Company table yet). Everything here is READ-ONLY composition;
// the few edits the preview supports (vetting / cap / sign-in / test) go through the
// existing /api/admin/customers PATCH, and conversation notes through the existing
// /api/admin/inbound/notes route. Phase 1 replaces this with real crm_people tables.
// ─────────────────────────────────────────────────────────────────────────────

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com",
  "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com",
  "live.com", "msn.com", "yandex.com", "mail.com", "ymail.com",
]);

function domainOf(email?: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).trim().toLowerCase();
  return d || null;
}

// Normalise any owner string (an admin email, a name, or a free-text lvPoc) to the
// three canonical points of contact the UI knows about.
function normalisePoc(raw?: string | null): "Ardi" | "Milee" | "Sam" | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes("ardi")) return "Ardi";
  if (s.includes("milee")) return "Milee";
  if (s.includes("sam")) return "Sam";
  return null;
}

// Phone/handle normaliser for dedup: strip channel prefixes, punctuation, spaces.
function normaliseContact(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^telegram:/, "").replace(/^whatsapp:/, "");
  s = s.replace(/[\s()+\-]/g, "");
  s = s.replace(/^@/, "");
  return s || null;
}

// User.contactNumber encodes the channel as a prefix (telegram:/whatsapp:).
function channelFromContactNumber(raw?: string | null): { channel: "WA" | "TG" | null; contact: string | null } {
  if (!raw) return { channel: null, contact: null };
  if (raw.startsWith("telegram:")) return { channel: "TG", contact: raw.slice("telegram:".length).trim() || null };
  if (raw.startsWith("whatsapp:")) return { channel: "WA", contact: raw.slice("whatsapp:".length).trim() || null };
  return { channel: null, contact: raw.trim() || null };
}

function channelFromInbound(ch?: string | null): "WA" | "TG" | null {
  const s = (ch || "").toLowerCase();
  if (s.includes("telegram")) return "TG";
  if (s.includes("whatsapp")) return "WA";
  return null;
}

// Map a lead's CRM `stage` to the UI's warm/cold lead stage (null = not a lead tag).
function leadStageFrom(stage?: string | null): "warm" | "cold" | null {
  const s = (stage || "").toLowerCase();
  if (s === "warm" || s === "new" || s === "active") return "warm";
  if (s === "cold" || s === "lost" || s === "previously_active") return "cold";
  return null;
}

// User vetting (pending|verified|flagged + vettedAt) → UI vetting label.
function vettingLabel(vettingReview?: string | null, vettedAt?: Date | null): "Verified" | "Needs review" | "Not vetted" {
  if (vettingReview === "verified") return "Verified";
  if (vettingReview === "flagged" || vettingReview === "pending" || vettedAt) return "Needs review";
  return "Not vetted";
}

type CommEntry = { id?: string; ts?: string; channel?: string; body?: string; direction?: string; authorName?: string; authorEmail?: string };

function convTypeFrom(channel?: string): "Note" | "Call" | "WhatsApp" | "Telegram" | "Email" {
  const s = (channel || "note").toLowerCase();
  if (s.includes("whatsapp") || s === "wa") return "WhatsApp";
  if (s.includes("telegram") || s === "tg") return "Telegram";
  if (s.includes("email") || s.includes("mail")) return "Email";
  if (s.includes("call") || s.includes("meeting") || s.includes("booking")) return "Call";
  return "Note";
}

export async function GET() {
  try {
    await requireAdmin();

    const [users, inboundLeads, adminUsers] = await Promise.all([
      prisma.user.findMany({
        where: { role: "customer" },
        include: {
          rentals: {
            select: {
              id: true,
              status: true,
              lockedPrice: true,
              replacesRentalId: true,
              discountCode: true,
              lvPoc: true,
              linkedinAccount: { select: { monthlyPrice: true } },
            },
          },
          _count: { select: { rentals: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.inboundLead.findMany({ orderBy: { lastContactAt: "desc" } }),
      prisma.user.findMany({ where: { role: "admin" }, select: { email: true, fullName: true } }),
    ]);

    const userIds = users.map((u) => u.id);
    const emails = users.map((u) => u.email);

    const [deposits, txnAgg, ambApps] = await Promise.all([
      userIds.length
        ? prisma.transaction.findMany({ where: { userId: { in: userIds }, type: "deposit" }, select: { userId: true, description: true } })
        : Promise.resolve([]),
      userIds.length
        ? prisma.transaction.findMany({ where: { userId: { in: userIds } }, select: { userId: true, type: true, amount: true } })
        : Promise.resolve([]),
      emails.length
        ? prisma.ambassadorApplication.findMany({ where: { email: { in: emails } }, select: { email: true } })
        : Promise.resolve([]),
    ]);

    // Payment method heuristic (same as /admin/customers): stripe top-up => Card, else Crypto.
    const fundingByUser = new Map<string, "Card" | "Crypto Wallet">();
    for (const d of deposits) {
      if ((d.description || "").startsWith("stripe_topup")) fundingByUser.set(d.userId, "Card");
      else if (!fundingByUser.has(d.userId)) fundingByUser.set(d.userId, "Crypto Wallet");
    }

    // Txn count + total paid per user.
    const txnCount = new Map<string, number>();
    const paidTotal = new Map<string, number>();
    for (const t of txnAgg) {
      txnCount.set(t.userId, (txnCount.get(t.userId) || 0) + 1);
      if (t.type === "rental_payment") paidTotal.set(t.userId, (paidTotal.get(t.userId) || 0) + Number(t.amount));
    }

    // "Pure ambassador" exclusion — same rule the current Renters tab uses.
    const ambEmails = new Set(ambApps.map((a) => a.email));

    // Admin email -> normalised PoC, for mapping InboundLead.ownerEmail.
    const adminPoc = new Map<string, "Ardi" | "Milee" | "Sam" | null>();
    for (const a of adminUsers) adminPoc.set(a.email.toLowerCase(), normalisePoc(a.fullName) || normalisePoc(a.email));

    type Person = {
      id: string;              // userId or "lead:<inboundLeadId>"
      kind: "user" | "lead";
      userId: string | null;
      leadId: string | null;
      name: string;
      email: string | null;
      channel: "WA" | "TG" | null;
      contact: string | null;
      role: string | null;
      source: string | null;
      pocOwner: "Ardi" | "Milee" | "Sam" | null;
      followUp: string | null;
      leadStage: "warm" | "cold" | null;
      vetting: "Verified" | "Needs review" | "Not vetted";
      paymentMethod: "Card" | "Crypto Wallet" | null;
      paymentFailed: boolean;
      signInAccess: boolean;
      dailyCap: number;
      isTest: boolean;
      notes: string | null;
      liveRentals: number;
      totalRentals: number;
      mrr: number;
      txnCount: number;
      paidTotal: number;
      replacementCount: number;
      discount: string | null;
      joinedAt: string;
      lastActivityAt: string;
      companyDomain: string | null;
      conversations: { id: string; type: string; text: string; meta: string; author: string | null; ts: string }[];
      // vettingReview raw (for writing back via existing PATCH)
      vettingReviewRaw: string | null;
    };

    const people: Person[] = [];
    // indexes for lead dedup
    const byEmail = new Map<string, Person>();
    const byContact = new Map<string, Person>();

    for (const u of users) {
      if (!(u.rentals.length > 0 || !ambEmails.has(u.email))) continue; // drop pure ambassadors
      const { channel, contact } = channelFromContactNumber(u.contactNumber);
      const live = u.rentals.filter((r) => r.status === "active");
      const mrr = live.reduce((sum, r) => sum + Number(r.lockedPrice ?? r.linkedinAccount?.monthlyPrice ?? 0), 0);
      const discount = u.rentals.find((r) => r.discountCode)?.discountCode ?? null;
      const lvPoc = u.rentals.map((r) => r.lvPoc).find(Boolean) ?? null;
      const p: Person = {
        id: u.id,
        kind: "user",
        userId: u.id,
        leadId: null,
        name: u.fullName,
        email: u.email,
        channel,
        contact,
        role: null,
        source: u.referralSource,
        pocOwner: normalisePoc(lvPoc),
        followUp: null,
        leadStage: null,
        vetting: vettingLabel(u.vettingReview, u.vettedAt),
        paymentMethod: fundingByUser.get(u.id) || null,
        paymentFailed: u.rentals.some((r) => r.status === "payment_failed"),
        signInAccess: u.credentialAccess,
        dailyCap: u.dailyRentalLimit,
        isTest: u.isTest,
        notes: null,
        liveRentals: live.length,
        totalRentals: u._count.rentals,
        mrr,
        txnCount: txnCount.get(u.id) || 0,
        paidTotal: paidTotal.get(u.id) || 0,
        replacementCount: u.rentals.filter((r) => r.replacesRentalId).length,
        discount,
        joinedAt: u.createdAt.toISOString(),
        lastActivityAt: u.updatedAt.toISOString(),
        companyDomain: (() => { const d = domainOf(u.email); return d && !FREE_EMAIL_DOMAINS.has(d) ? d : null; })(),
        conversations: [],
        vettingReviewRaw: u.vettingReview,
      };
      people.push(p);
      if (p.email) byEmail.set(p.email.toLowerCase(), p);
      const nc = normaliseContact(u.contactNumber);
      if (nc) byContact.set(nc, p);
    }

    // Fold inbound leads in: attach to a matching person, else create a lead row.
    for (const l of inboundLeads) {
      const emailKey = (l.companyEmail || "").toLowerCase();
      const contactKey = normaliseContact(l.contact) || normaliseContact(l.handle) || normaliseContact(l.phone);
      let match: Person | undefined;
      if (emailKey) match = byEmail.get(emailKey);
      if (!match && contactKey) match = byContact.get(contactKey);

      const comms = (Array.isArray(l.commsLog) ? (l.commsLog as CommEntry[]) : []).map((c, i) => ({
        id: c.id || `${l.id}:${i}`,
        type: convTypeFrom(c.channel),
        text: c.body || "",
        meta: [c.direction, c.ts ? new Date(c.ts).toISOString() : null].filter(Boolean).join(" · "),
        author: c.authorName || c.authorEmail || null,
        ts: c.ts || l.lastContactAt.toISOString(),
      }));

      if (match) {
        // Enrich the existing (renter/signup) person with lead-side CRM data.
        match.leadId = match.leadId || l.id;
        if (!match.pocOwner) match.pocOwner = adminPoc.get((l.ownerEmail || "").toLowerCase()) || normalisePoc(l.ownerEmail);
        if (!match.source) match.source = l.source;
        if (!match.followUp && l.followUpDate) match.followUp = l.followUpDate.toISOString();
        if (!match.role && l.jobTitle) match.role = l.jobTitle;
        if (!match.notes && l.notes) match.notes = l.notes;
        if (match.leadStage === null) match.leadStage = leadStageFrom(l.stage);
        if (!match.channel) match.channel = channelFromInbound(l.channel);
        match.conversations.push(...comms);
        const lts = l.lastContactAt.toISOString();
        if (lts > match.lastActivityAt) match.lastActivityAt = lts;
        continue;
      }

      // New lead-only person.
      const d = domainOf(l.companyEmail);
      const p: Person = {
        id: `lead:${l.id}`,
        kind: "lead",
        userId: null,
        leadId: l.id,
        name: l.name || l.handle || l.companyEmail || "Unknown",
        email: l.companyEmail,
        channel: channelFromInbound(l.channel),
        contact: l.contact || l.handle || l.phone || null,
        role: l.jobTitle,
        source: l.source,
        pocOwner: adminPoc.get((l.ownerEmail || "").toLowerCase()) || normalisePoc(l.ownerEmail),
        followUp: l.followUpDate ? l.followUpDate.toISOString() : null,
        leadStage: leadStageFrom(l.stage),
        vetting: "Not vetted",
        paymentMethod: null,
        paymentFailed: false,
        signInAccess: false,
        dailyCap: 5,
        isTest: false,
        notes: l.notes,
        liveRentals: 0,
        totalRentals: 0,
        mrr: 0,
        txnCount: 0,
        paidTotal: 0,
        replacementCount: 0,
        discount: null,
        joinedAt: l.firstContactAt.toISOString(),
        lastActivityAt: l.lastContactAt.toISOString(),
        companyDomain: d && !FREE_EMAIL_DOMAINS.has(d) ? d : null,
        conversations: comms,
        vettingReviewRaw: null,
      };
      people.push(p);
      if (p.email) byEmail.set(p.email.toLowerCase(), p);
      if (contactKey) byContact.set(contactKey, p);
    }

    // Sort each person's conversations newest-first.
    for (const p of people) p.conversations.sort((a, b) => (b.ts > a.ts ? 1 : -1));

    // Derive companies from shared non-free email domains (≥2 people).
    const byDomain = new Map<string, Person[]>();
    for (const p of people) {
      if (!p.companyDomain) continue;
      const arr = byDomain.get(p.companyDomain) || [];
      arr.push(p);
      byDomain.set(p.companyDomain, arr);
    }
    const companies = [] as { id: string; domain: string; name: string; memberIds: string[]; mainContactId: string | null }[];
    for (const [domain, members] of byDomain) {
      if (members.length < 2) continue;
      // name from the first member's email local-part fallback → domain label
      const label = domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
      const main = members.find((m) => m.liveRentals > 0) || members[0];
      companies.push({ id: `co:${domain}`, domain, name: label, memberIds: members.map((m) => m.id), mainContactId: main.id });
    }
    const companyByPerson = new Map<string, string>();
    for (const c of companies) for (const id of c.memberIds) companyByPerson.set(id, c.id);

    const rows = people.map((p) => ({ ...p, companyId: companyByPerson.get(p.id) || null }));

    return NextResponse.json({ people: rows, companies, preview: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") {
      return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    }
    console.error("Renters v3 preview error:", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
