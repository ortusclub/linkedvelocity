import type { PrismaClient } from "@/generated/prisma/client";
import {
  businessDomain, isInternalEmail, normalisePoc, normaliseContact,
  channelFromContactNumber, channelFromInbound, leadStageFrom, companyLabel,
  loadAccountHolders, isAccountHolder,
} from "@/lib/crm-compose";

// ─────────────────────────────────────────────────────────────────────────────
// Stage C — keep the crm_people overlay current. New signups (User) and inbound
// leads land in their own spines; this ADDITIVELY inserts any that don't yet have a
// crm_people row, applying the same exclusion filters as composePeople. It never
// updates or deletes existing rows, so manual edits (status overrides, tags, merges)
// are preserved. Cheap when nothing is new. Safe to call on every GET.
// ─────────────────────────────────────────────────────────────────────────────
export async function reconcileCrmPeople(prisma: PrismaClient): Promise<number> {
  const [missingUsers, allLeads, existing, linkedLeadRows] = await Promise.all([
    prisma.user.findMany({
      where: { role: "customer", isTest: false, person: null },
      include: { rentals: { select: { lvPoc: true } } },
    }),
    prisma.inboundLead.findMany(),
    prisma.person.findMany({ select: { email: true, contact: true } }),
    prisma.person.findMany({ where: { inboundLeadId: { not: null } }, select: { inboundLeadId: true } }),
  ]);
  const linkedLeadIds = new Set(linkedLeadRows.map((p) => p.inboundLeadId));
  const missingLeads = allLeads.filter((l) => !linkedLeadIds.has(l.id));
  if (!missingUsers.length && !missingLeads.length) return 0;

  const [ambApps, holders] = await Promise.all([
    missingUsers.length
      ? prisma.ambassadorApplication.findMany({ where: { email: { in: missingUsers.map((u) => u.email) } }, select: { email: true } })
      : Promise.resolve([]),
    loadAccountHolders(prisma),
  ]);
  const ambEmails = new Set(ambApps.map((a) => a.email));
  const existingEmails = new Set(existing.map((p) => p.email?.toLowerCase()).filter(Boolean) as string[]);
  const existingContacts = new Set(existing.map((p) => normaliseContact(p.contact)).filter(Boolean) as string[]);

  // find-or-create companies by business domain (cached within this run)
  const companyByDomain = new Map<string, string | null>();
  async function companyIdFor(domain: string | null): Promise<string | null> {
    if (!domain) return null;
    if (companyByDomain.has(domain)) return companyByDomain.get(domain)!;
    const found = await prisma.company.findUnique({ where: { domain } });
    const id = found?.id ?? (await prisma.company.create({ data: { name: companyLabel(domain), domain } })).id;
    companyByDomain.set(domain, id);
    return id;
  }

  const toCreate: Array<Record<string, unknown>> = [];

  for (const u of missingUsers) {
    if (isInternalEmail(u.email)) continue;
    if (u.rentals.length === 0 && (ambEmails.has(u.email) || isAccountHolder(u.fullName, u.email, holders))) continue;
    const { channel, contact } = channelFromContactNumber(u.contactNumber);
    const lvPoc = u.rentals.map((r) => r.lvPoc).find(Boolean) ?? null;
    toCreate.push({
      userId: u.id, name: u.fullName, email: u.email, channel, contact,
      companyId: await companyIdFor(businessDomain(u.email)), source: u.referralSource,
      pocOwner: normalisePoc(lvPoc), joinedAt: u.createdAt, lastActivityAt: u.updatedAt,
    });
    if (u.email) existingEmails.add(u.email.toLowerCase());
    const nc = normaliseContact(u.contactNumber); if (nc) existingContacts.add(nc);
  }

  for (const l of missingLeads) {
    if (isInternalEmail(l.companyEmail)) continue;
    const email = (l.companyEmail || "").toLowerCase();
    const contactKey = normaliseContact(l.contact) || normaliseContact(l.handle) || normaliseContact(l.phone);
    if (email && existingEmails.has(email)) continue;        // same person already has a row (as a user) → skip
    if (contactKey && existingContacts.has(contactKey)) continue;
    toCreate.push({
      inboundLeadId: l.id, name: l.name || l.handle || l.companyEmail || "Unknown", email: l.companyEmail,
      channel: channelFromInbound(l.channel), contact: l.contact || l.handle || l.phone || null,
      companyId: await companyIdFor(businessDomain(l.companyEmail)), role: l.jobTitle, source: l.source,
      pocOwner: normalisePoc(l.ownerEmail), followUp: l.followUpDate, leadStage: leadStageFrom(l.stage),
      notes: l.notes, joinedAt: l.firstContactAt, lastActivityAt: l.lastContactAt,
    });
    if (email) existingEmails.add(email);
    if (contactKey) existingContacts.add(contactKey);
  }

  if (!toCreate.length) return 0;
  await prisma.person.createMany({ data: toCreate as never, skipDuplicates: true });
  return toCreate.length;
}
