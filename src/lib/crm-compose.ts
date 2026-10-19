import type { PrismaClient } from "@/generated/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Compose the unified "Person" structure from the existing spines (User + InboundLead).
// Used by the Phase-1 backfill to populate crm_people / companies / conversations /
// duplicate_suggestions. Pure read + in-memory shaping — no writes here.
// (Mirrors the Phase-0 preview composition in /api/admin/renters.)
// ─────────────────────────────────────────────────────────────────────────────

export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com",
  "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com",
  "live.com", "msn.com", "yandex.com", "mail.com", "ymail.com",
]);

export function domainOf(email?: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).trim().toLowerCase();
  return d || null;
}
export function businessDomain(email?: string | null): string | null {
  const d = domainOf(email);
  return d && !FREE_EMAIL_DOMAINS.has(d) ? d : null;
}
export function normalisePoc(raw?: string | null): "Ardi" | "Milee" | "Sam" | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes("ardi")) return "Ardi";
  if (s.includes("milee")) return "Milee";
  if (s.includes("sam")) return "Sam";
  return null;
}
export function normaliseContact(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^telegram:/, "").replace(/^whatsapp:/, "").replace(/[\s()+\-]/g, "").replace(/^@/, "");
  return s || null;
}
function channelFromContactNumber(raw?: string | null): { channel: "WA" | "TG" | null; contact: string | null } {
  if (!raw) return { channel: null, contact: null };
  if (raw.startsWith("telegram:")) return { channel: "TG", contact: raw.slice(9).trim() || null };
  if (raw.startsWith("whatsapp:")) return { channel: "WA", contact: raw.slice(9).trim() || null };
  return { channel: null, contact: raw.trim() || null };
}
function channelFromInbound(ch?: string | null): "WA" | "TG" | null {
  const s = (ch || "").toLowerCase();
  if (s.includes("telegram")) return "TG";
  if (s.includes("whatsapp")) return "WA";
  return null;
}
function leadStageFrom(stage?: string | null): "warm" | "cold" | null {
  const s = (stage || "").toLowerCase();
  if (s === "warm" || s === "new" || s === "active") return "warm";
  if (s === "cold" || s === "lost" || s === "previously_active") return "cold";
  return null;
}
function convTypeFrom(channel?: string): "Note" | "Call" | "WhatsApp" | "Telegram" | "Email" {
  const s = (channel || "note").toLowerCase();
  if (s.includes("whatsapp") || s === "wa") return "WhatsApp";
  if (s.includes("telegram") || s === "tg") return "Telegram";
  if (s.includes("email") || s.includes("mail")) return "Email";
  if (s.includes("call") || s.includes("meeting") || s.includes("booking")) return "Call";
  return "Note";
}
function companyLabel(domain: string): string {
  return domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
function localPart(email?: string | null) { return email ? email.split("@")[0].toLowerCase() : ""; }

type CommEntry = { id?: string; ts?: string; channel?: string; body?: string; direction?: string; authorName?: string; authorEmail?: string };

export type ComposedConversation = {
  type: string; text: string; direction: string | null; authorName: string | null; authorEmail: string | null; externalId: string | null; createdAt: Date;
};
export type ComposedPerson = {
  key: string;                 // temp key: userId or "lead:<id>"
  userId: string | null;
  inboundLeadId: string | null;
  name: string;
  email: string | null;
  channel: string | null;
  contact: string | null;
  companyDomain: string | null;
  role: string | null;
  source: string | null;
  pocOwner: string | null;
  followUp: Date | null;
  leadStage: string | null;
  isTest: boolean;
  notes: string | null;
  joinedAt: Date;
  lastActivityAt: Date;
  conversations: ComposedConversation[];
};
export type ComposedCompany = { domain: string; name: string; memberKeys: string[]; mainContactKey: string };
export type Composed = {
  people: ComposedPerson[];
  companies: ComposedCompany[];
  dupes: { aKey: string; bKey: string; reason: string }[];
};

export async function composePeople(prisma: PrismaClient): Promise<Composed> {
  const [users, inboundLeads, adminUsers] = await Promise.all([
    prisma.user.findMany({
      where: { role: "customer" },
      include: { rentals: { select: { id: true, status: true, lvPoc: true } }, _count: { select: { rentals: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.inboundLead.findMany({ orderBy: { lastContactAt: "desc" } }),
    prisma.user.findMany({ where: { role: "admin" }, select: { email: true, fullName: true } }),
  ]);

  const emails = users.map((u) => u.email);
  const ambApps = emails.length
    ? await prisma.ambassadorApplication.findMany({ where: { email: { in: emails } }, select: { email: true } })
    : [];
  const ambEmails = new Set(ambApps.map((a) => a.email));
  const adminPoc = new Map<string, "Ardi" | "Milee" | "Sam" | null>();
  for (const a of adminUsers) adminPoc.set(a.email.toLowerCase(), normalisePoc(a.fullName) || normalisePoc(a.email));

  const people: ComposedPerson[] = [];
  const byEmail = new Map<string, ComposedPerson>();
  const byContact = new Map<string, ComposedPerson>();

  for (const u of users) {
    if (!(u.rentals.length > 0 || !ambEmails.has(u.email))) continue; // drop pure ambassadors
    const { channel, contact } = channelFromContactNumber(u.contactNumber);
    const lvPoc = u.rentals.map((r) => r.lvPoc).find(Boolean) ?? null;
    const p: ComposedPerson = {
      key: u.id, userId: u.id, inboundLeadId: null, name: u.fullName, email: u.email,
      channel, contact, companyDomain: businessDomain(u.email), role: null, source: u.referralSource,
      pocOwner: normalisePoc(lvPoc), followUp: null, leadStage: null, isTest: u.isTest, notes: null,
      joinedAt: u.createdAt, lastActivityAt: u.updatedAt, conversations: [],
    };
    people.push(p);
    if (p.email) byEmail.set(p.email.toLowerCase(), p);
    const nc = normaliseContact(u.contactNumber);
    if (nc) byContact.set(nc, p);
  }

  for (const l of inboundLeads) {
    const emailKey = (l.companyEmail || "").toLowerCase();
    const contactKey = normaliseContact(l.contact) || normaliseContact(l.handle) || normaliseContact(l.phone);
    let match: ComposedPerson | undefined;
    if (emailKey) match = byEmail.get(emailKey);
    if (!match && contactKey) match = byContact.get(contactKey);

    const comms: ComposedConversation[] = (Array.isArray(l.commsLog) ? (l.commsLog as CommEntry[]) : []).map((c, i) => ({
      type: convTypeFrom(c.channel), text: c.body || "", direction: c.direction || null,
      authorName: c.authorName || null, authorEmail: c.authorEmail || null,
      externalId: c.id || `${l.id}:${i}`, createdAt: c.ts ? new Date(c.ts) : l.lastContactAt,
    }));

    if (match) {
      match.inboundLeadId = match.inboundLeadId || l.id;
      if (!match.pocOwner) match.pocOwner = adminPoc.get((l.ownerEmail || "").toLowerCase()) || normalisePoc(l.ownerEmail);
      if (!match.source) match.source = l.source;
      if (!match.followUp && l.followUpDate) match.followUp = l.followUpDate;
      if (!match.role && l.jobTitle) match.role = l.jobTitle;
      if (!match.notes && l.notes) match.notes = l.notes;
      if (match.leadStage === null) match.leadStage = leadStageFrom(l.stage);
      if (!match.channel) match.channel = channelFromInbound(l.channel);
      if (!match.companyDomain) match.companyDomain = businessDomain(l.companyEmail);
      match.conversations.push(...comms);
      if (l.lastContactAt > match.lastActivityAt) match.lastActivityAt = l.lastContactAt;
      continue;
    }

    const p: ComposedPerson = {
      key: `lead:${l.id}`, userId: null, inboundLeadId: l.id,
      name: l.name || l.handle || l.companyEmail || "Unknown", email: l.companyEmail,
      channel: channelFromInbound(l.channel), contact: l.contact || l.handle || l.phone || null,
      companyDomain: businessDomain(l.companyEmail), role: l.jobTitle, source: l.source,
      pocOwner: adminPoc.get((l.ownerEmail || "").toLowerCase()) || normalisePoc(l.ownerEmail),
      followUp: l.followUpDate, leadStage: leadStageFrom(l.stage), isTest: false, notes: l.notes,
      joinedAt: l.firstContactAt, lastActivityAt: l.lastContactAt, conversations: comms,
    };
    people.push(p);
    if (p.email) byEmail.set(p.email.toLowerCase(), p);
    if (contactKey) byContact.set(contactKey, p);
  }

  // Companies: every non-free domain forms a company (incl. solo contacts).
  const byDomain = new Map<string, ComposedPerson[]>();
  for (const p of people) {
    if (!p.companyDomain) continue;
    (byDomain.get(p.companyDomain) || byDomain.set(p.companyDomain, []).get(p.companyDomain)!).push(p);
  }
  const companies: ComposedCompany[] = [];
  for (const [domain, members] of byDomain) {
    const main = members.find((m) => m.userId) || members[0];
    companies.push({ domain, name: companyLabel(domain), memberKeys: members.map((m) => m.key), mainContactKey: main.key });
  }

  // Duplicate suggestions: same email local-part (conservative seed).
  const dupes: { aKey: string; bKey: string; reason: string }[] = [];
  const byLocal = new Map<string, ComposedPerson[]>();
  for (const p of people) {
    const lp = localPart(p.email);
    if (!lp) continue;
    (byLocal.get(lp) || byLocal.set(lp, []).get(lp)!).push(p);
  }
  const seen = new Set<string>();
  for (const arr of byLocal.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const key = [arr[i].key, arr[j].key].sort().join("|");
      if (seen.has(key)) continue; seen.add(key);
      dupes.push({ aKey: arr[i].key, bKey: arr[j].key, reason: "same-email-localpart" });
    }
  }

  return { people, companies, dupes };
}
