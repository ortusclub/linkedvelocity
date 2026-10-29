import { prisma } from "@/lib/prisma";

export const EXISTING_ACCOUNT_NOTE = "[Existing account submission]";

// Shared matcher: the clauses that identify a prior application/account for the same
// person — their email (or linkedinEmail) or the same LinkedIn profile slug (query and
// hash stripped, so "/in/foo?utm=..." and "/in/foo" match the same profile).
function matchClauses(email: string, linkedinUrl?: string) {
  const address = email.trim().toLowerCase();
  const slug = linkedinUrl?.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1];
  const urlMatch = slug ? [
    { linkedinUrl: { equals: `https://www.linkedin.com/in/${slug}`, mode: "insensitive" as const } },
    { linkedinUrl: { endsWith: `/in/${slug}/`, mode: "insensitive" as const } },
    { linkedinUrl: { endsWith: `/in/${slug}`, mode: "insensitive" as const } },
    { linkedinUrl: { contains: `/in/${slug}?`, mode: "insensitive" as const } },
  ] : [];
  return { address, slug, urlMatch };
}

// A still-OPEN prior application that this fresh submission is just a repeat of — the
// commonest real duplicate (see Raquella/Jhann/Sheena, all verah-77, Oct 2026): the same
// person files the form 2-3 times, minutes apart, from different emails or a logged-in vs
// public session, so the narrow same-email+same-submitter+10min guard misses them.
//
// Keyed on the LinkedIn PROFILE (slug), which is the account's true identity — the same
// profile can't be two rentals, so a prior non-rejected application for it is always a
// duplicate no matter the email, submitter or how long ago. For a URL-less lead (walk-up)
// we fall back to the same email, also URL-less, within 24h. Both deliberately leave room
// for the legitimate cases the signup allows: re-applying after a rejection (rejected apps
// are excluded) and signing up a genuinely DIFFERENT second account on the same email (a
// different profile URL, so a different slug). Returns the earliest matching app (the
// original) so the caller can hand it back instead of creating another row.
export async function openDuplicateApplication(email: string, linkedinUrl?: string) {
  const { address, slug, urlMatch } = matchClauses(email, linkedinUrl);
  if (slug) {
    return prisma.ambassadorApplication.findFirst({ where: { status: { notIn: ["rejected"] }, OR: urlMatch }, orderBy: { createdAt: "asc" } });
  }
  return prisma.ambassadorApplication.findFirst({
    where: {
      status: { notIn: ["rejected"] },
      linkedinUrl: "",
      createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      OR: [{ email: { equals: address, mode: "insensitive" } }, { linkedinEmail: { equals: address, mode: "insensitive" } }],
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function existingApplicationAccount(email: string, linkedinUrl?: string) {
  const { address, urlMatch } = matchClauses(email, linkedinUrl);
  const [application, account] = await Promise.all([
    prisma.ambassadorApplication.findFirst({ where: { OR: [{ email: { equals: address, mode: "insensitive" } }, { linkedinEmail: { equals: address, mode: "insensitive" } }, ...urlMatch] }, select: { id: true } }),
    prisma.linkedInAccount.findFirst({ where: { OR: [{ personalEmail: { equals: address, mode: "insensitive" } }, { loginEmail: { equals: address, mode: "insensitive" } }, ...urlMatch] }, select: { id: true } }),
  ]);
  return application || account ? `${EXISTING_ACCOUNT_NOTE} We have already received an application for this account. This duplicate application will likely be rejected during review. Review before creating another account or payout.${application ? ` Existing application: ${application.id}.` : ""}${account ? ` Existing inventory account: ${account.id}.` : ""}` : null;
}

// A repeat signup of a profile that is ALREADY ESTABLISHED with us: an onboarded
// application, or a live (non-removed) inventory account for the same person. These are
// never a legitimate new signup — allowing them creates phantom duplicates that split one
// person across two applications and break owner/payout matching (the Payouts page resolves
// an account to its owner by email, so a second application on the same email can hijack the
// match and make a real payout row vanish). Returns the existing ids so the caller can hand
// the person back their existing record instead of creating another.
//
// `profileOnly` restricts the match to the LinkedIn profile (slug), ignoring the email, so a
// person genuinely signing up a SECOND, different account on the same email is still allowed
// through — only re-registering the SAME profile is caught. With no URL to key on it matches
// nothing (returns null).
export async function establishedDuplicate(
  email: string,
  linkedinUrl?: string,
  opts: { profileOnly?: boolean } = {},
): Promise<{ applicationId?: string; accountId?: string } | null> {
  const { address, slug, urlMatch } = matchClauses(email, linkedinUrl);
  if (opts.profileOnly && !slug) return null;
  const appOr = opts.profileOnly ? urlMatch : [{ email: { equals: address, mode: "insensitive" as const } }, { linkedinEmail: { equals: address, mode: "insensitive" as const } }, ...urlMatch];
  const accOr = opts.profileOnly ? urlMatch : [{ personalEmail: { equals: address, mode: "insensitive" as const } }, { loginEmail: { equals: address, mode: "insensitive" as const } }, ...urlMatch];
  const [application, account] = await Promise.all([
    prisma.ambassadorApplication.findFirst({ where: { status: "onboarded", OR: appOr }, select: { id: true } }),
    prisma.linkedInAccount.findFirst({ where: { status: { notIn: ["removed"] }, OR: accOr }, select: { id: true } }),
  ]);
  if (!application && !account) return null;
  return { applicationId: application?.id, accountId: account?.id };
}
