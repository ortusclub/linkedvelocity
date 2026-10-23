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
  // Forward-sync last_activity_at on existing rows so the renters board's "PoC · last touch"
  // stays current. The additive insert below deliberately never updates existing rows (to
  // preserve manual edits); this is the one safe exception — it only ADVANCES last_activity_at
  // to the most recent of the linked user's updatedAt / lead's lastContactAt, never backwards,
  // and touches no manual-edit field. GREATEST ignores NULLs, so a user-only or lead-only person
  // is handled; the WHERE guard means rows already current are skipped (no write churn).
  await prisma.$executeRawUnsafe(`
    UPDATE crm_people AS p
    SET last_activity_at = GREATEST(p.last_activity_at, u.updated_at, l.last_contact_at)
    FROM crm_people AS px
      LEFT JOIN users AS u ON u.id = px.user_id
      LEFT JOIN inbound_leads AS l ON l.id = px.inbound_lead_id
    WHERE px.id = p.id
      AND GREATEST(p.last_activity_at, u.updated_at, l.last_contact_at) > p.last_activity_at
  `);

  const [missingUsers, allLeads, existing, linkedLeadRows] = await Promise.all([
    prisma.user.findMany({
      where: { role: "customer", isTest: false, person: null },
      include: { rentals: { select: { lvPoc: true } } },
    }),
    prisma.inboundLead.findMany(),
    prisma.person.findMany({ select: { id: true, email: true, contact: true, inboundLeadId: true } }),
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

  // Index existing person rows so a late-arriving lead can ATTACH to the person it belongs to
  // (instead of being skipped and left invisible). Only rows with no lead yet are link targets.
  type LinkTarget = { id: string; inboundLeadId: string | null };
  const personByEmail = new Map<string, LinkTarget>();
  const personByContact = new Map<string, LinkTarget>();
  for (const p of existing) {
    const em = p.email?.toLowerCase();
    if (em && !personByEmail.has(em)) personByEmail.set(em, { id: p.id, inboundLeadId: p.inboundLeadId });
    const nc = normaliseContact(p.contact);
    if (nc && !personByContact.has(nc)) personByContact.set(nc, { id: p.id, inboundLeadId: p.inboundLeadId });
  }

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
  // Just-created user entries indexed by email/contact, so a lead for the same person can attach
  // its inboundLeadId onto the new row rather than being skipped (both-new-in-one-run case).
  const createByEmail = new Map<string, Record<string, unknown>>();
  const createByContact = new Map<string, Record<string, unknown>>();

  for (const u of missingUsers) {
    if (isInternalEmail(u.email)) continue;
    if (u.rentals.length === 0 && (ambEmails.has(u.email) || isAccountHolder(u.fullName, u.email, holders))) continue;
    const { channel, contact } = channelFromContactNumber(u.contactNumber);
    const lvPoc = u.rentals.map((r) => r.lvPoc).find(Boolean) ?? null;
    const entry: Record<string, unknown> = {
      userId: u.id, name: u.fullName, email: u.email, channel, contact,
      companyId: await companyIdFor(businessDomain(u.email)), source: u.referralSource,
      pocOwner: normalisePoc(lvPoc), joinedAt: u.createdAt, lastActivityAt: u.updatedAt,
    };
    toCreate.push(entry);
    if (u.email) { existingEmails.add(u.email.toLowerCase()); createByEmail.set(u.email.toLowerCase(), entry); }
    const nc = normaliseContact(u.contactNumber); if (nc) { existingContacts.add(nc); createByContact.set(nc, entry); }
  }

  // Link a lead onto the person it belongs to (existing row, or a row being created this run).
  // Only fills a NULL inboundLeadId and never overwrites lead/CRM fields, so manual edits survive;
  // the timeline then reads live from comms_log on the next GET. Returns true if it attached.
  const toLink: Array<{ personId: string; leadId: string }> = [];
  function attachToExistingPerson(email: string, contactKey: string | null, leadId: string): boolean {
    const target = (email && personByEmail.get(email)) || (contactKey ? personByContact.get(contactKey) : undefined);
    if (!target) return false;
    if (target.inboundLeadId == null) { target.inboundLeadId = leadId; toLink.push({ personId: target.id, leadId }); }
    return true; // person already represented — never create a duplicate standalone row
  }
  function attachToNewEntry(email: string, contactKey: string | null, leadId: string): boolean {
    const entry = (email && createByEmail.get(email)) || (contactKey ? createByContact.get(contactKey) : undefined);
    if (!entry) return false;
    if (entry.inboundLeadId == null) entry.inboundLeadId = leadId;
    return true;
  }

  for (const l of missingLeads) {
    if (isInternalEmail(l.companyEmail)) continue;
    const email = (l.companyEmail || "").toLowerCase();
    const contactKey = normaliseContact(l.contact) || normaliseContact(l.handle) || normaliseContact(l.phone);
    // Same person already represented (as a user/other row) → attach this lead to it instead of skipping.
    if ((email && existingEmails.has(email)) || (contactKey && existingContacts.has(contactKey))) {
      if (!attachToExistingPerson(email, contactKey, l.id)) attachToNewEntry(email, contactKey, l.id);
      continue;
    }
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

  if (toCreate.length) await prisma.person.createMany({ data: toCreate as never, skipDuplicates: true });
  // Attach late-arriving leads to the person rows they belong to (fills NULL inboundLeadId only).
  for (const link of toLink) {
    // updateMany guards on inboundLeadId still being NULL (conditional). inboundLeadId is @unique,
    // so a concurrent run that already claimed this lead would make this throw — swallow that race.
    try {
      await prisma.person.updateMany({ where: { id: link.personId, inboundLeadId: null }, data: { inboundLeadId: link.leadId } });
    } catch { /* lead linked elsewhere by a concurrent run; ignore */ }
  }
  return toCreate.length + toLink.length;
}
