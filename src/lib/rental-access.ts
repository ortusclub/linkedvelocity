import { paidMonthEnd } from "@/lib/shadow-handover";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { shareProfile, unshareProfile, tokenForAccount, workspaceForAccount, createPublicShareLink, getPublicShareLink, deletePublicShareLink, setPublicShareLinkPaused } from "@/services/gologin";
import { Prisma } from "@/generated/prisma/client";

export type ShareRef = { email: string; shareId: string };

// Grant (or re-grant) a rental's renter GoLogin access, storing the Share ID so it
// can be revoked later. Throws on error (no profile id / no share id).
export async function grantRentalAccess(rentalId: string): Promise<{ shareId: string; email: string }> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      user: { select: { email: true, gologinShareEmail: true } },
      linkedinAccount: { select: { gologinProfileId: true, gologinAccount: true, gologinShareLink: true, restrictedAt: true, twoFactorResetNeeded: true } },
    },
  });
  if (!rental) throw new Error("Rental not found");
  if (rental.handoverAt) {
    const outstanding = await prisma.rental.count({ where: { linkedinAccountId: rental.linkedinAccountId, isShadow: true, status: { in: ["active", "pending_access", "payment_failed"] } } });
    if (rental.handoverAt.getTime() > Date.now() || outstanding) throw new Error("Account is being prepared for handover");
  } else if (!rental.isShadow) {
    const outstanding = await prisma.rental.count({ where: { linkedinAccountId: rental.linkedinAccountId, isShadow: true, status: { in: ["active", "pending_access", "payment_failed"] } } });
    if (outstanding) throw new Error("Shadow handover must be scheduled before granting access");
  }
  if (rental.status === "cancelled" || rental.status === "expired") throw new Error("Rental has ended");
  if (rental.linkedinAccount.restrictedAt || rental.linkedinAccount.twoFactorResetNeeded) throw new Error("Account is not ready for access");
  const profileId = rental.linkedinAccount.gologinProfileId;
  if (!profileId) {
    throw new Error("This account has no GoLogin profile ID, so access can't be managed automatically.");
  }
  // Share to the renter's GoLogin login — usually their account email, but some renters
  // (e.g. ProfilePartner) access GoLogin under a different address; sharing to a non-GoLogin
  // email 400s, so honour gologinShareEmail when set.
  const email = rental.user.gologinShareEmail || rental.user.email;
  // Use the token AND workspace for whichever GoLogin account hosts this profile
  // (master vs klabber) — they must match, or the share silently returns no id.
  const token = tokenForAccount(rental.linkedinAccount.gologinAccount);
  const workspace = workspaceForAccount(rental.linkedinAccount.gologinAccount);
  const start = new Date();
  const periodEnd = paidMonthEnd(start);
  if (rental.handoverAt && rental.stripeSubscriptionId) {
    await stripe.subscriptions.update(rental.stripeSubscriptionId, { pause_collection: "", trial_end: Math.floor(periodEnd.getTime() / 1000), proration_behavior: "none" });
  }
  const current = (rental.gologinShareIds as unknown as ShareRef[] | null) || [];
  let shareId = current.find(s => s.email === email)?.shareId;
  if (!shareId) {
    const result = await shareProfile(profileId, email, token, workspace);
    shareId = Array.isArray(result) ? result[0]?.id : (result as { id?: string } | null)?.id;
    if (!shareId) throw new Error("GoLogin did not return a share id");
  }
  const next: ShareRef[] = [...current.filter(s => s.email !== email), { email, shareId }];
  // Retain revocable access even if preparing the link fails after the email share succeeds.
  await prisma.rental.update({ where: { id: rentalId }, data: { gologinShareIds: next as unknown as Prisma.InputJsonValue } });
  if (rental.handoverAt) {
    const fresh = await getPublicShareLink(profileId, undefined, token) ?? await createPublicShareLink(profileId, undefined, token);
    await prisma.linkedInAccount.update({ where: { id: rental.linkedinAccountId }, data: { gologinShareLink: fresh.publicUrl } });
  }
  await prisma.rental.update({
    where: { id: rentalId },
    data: {
      // Mark access ready only after sharing and handover preparation succeed.
      status: "active",
      paused: false,
      gologinShareIds: next as unknown as Prisma.InputJsonValue,
      accessGrantedAt: new Date(),
      accessRevokedAt: null,
      ...(rental.handoverAt ? { startDate: start, currentPeriodEnd: periodEnd, handoverAt: null } : {}),
    },
  });
  // If this profile has a public (g.camp) link that was PAUSED on a prior lapse, bring it
  // back so a renter who re-paid regains access through the same URL (grants that don't
  // involve a paused link are a cheap no-op beyond the lookup).
  if (rental.linkedinAccount.gologinShareLink) {
    try {
      const link = await getPublicShareLink(profileId, undefined, token);
      if (link?.paused) await setPublicShareLinkPaused(link.linkId, profileId, false, token);
    } catch (e) {
      console.error("grantRentalAccess: could not unpause public link", rentalId, e);
    }
  }
  return { shareId, email };
}

// Revoke ALL of a rental's GoLogin shares (cut the renter off) and clear the stored IDs.
// Does NOT change status/paused — the caller decides what the revoke means (pause vs end).
//
// `opts.publicLink` controls the PUBLIC (g.camp) share link, which email unshares don't
// touch. A link-based renter gets in through that link, so a revoke that ignores it does
// NOT actually cut access — the April shadow-leak gap. Pass "pause" for a reversible hold
// (lapse, account still reclaimable) or "delete" for a permanent cut (release to catalogue).
// "delete" THROWS if GoLogin refuses, so a caller can treat it as a guard and avoid freeing
// an account whose access is still live. Omit it to leave the public link untouched.
export async function revokeRentalAccess(
  rentalId: string,
  opts?: { publicLink?: "pause" | "delete" },
): Promise<{ shareId: string; ok: boolean; error?: string }[]> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: { linkedinAccount: { select: { gologinAccount: true, gologinProfileId: true } } },
  });
  if (!rental) throw new Error("Rental not found");
  const token = tokenForAccount(rental.linkedinAccount.gologinAccount);
  const workspace = workspaceForAccount(rental.linkedinAccount.gologinAccount);
  const current = (rental.gologinShareIds as unknown as ShareRef[] | null) || [];
  const results: { shareId: string; ok: boolean; error?: string }[] = [];
  for (const s of current) {
    try {
      await unshareProfile(s.shareId, token, workspace);
      results.push({ shareId: s.shareId, ok: true });
    } catch (e) {
      results.push({ shareId: s.shareId, ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  }
  await prisma.rental.update({
    where: { id: rentalId },
    data: { gologinShareIds: current.filter(s => results.some(r => r.shareId === s.shareId && !r.ok)) as unknown as Prisma.InputJsonValue, ...(results.every(r => r.ok) ? { accessRevokedAt: new Date() } : {}) },
  });
  // Public (g.camp) link — the leak-closing step.
  if (opts?.publicLink) {
    const profileId = rental.linkedinAccount.gologinProfileId;
    if (profileId) {
      const link = await getPublicShareLink(profileId, undefined, token).catch((e) => {
        // A lookup failure is fatal for "delete" (we can't prove access was cut) but only
        // logged for "pause" (best-effort hold); rethrow in the delete case below.
        if (opts.publicLink === "delete") throw e;
        console.error("revokeRentalAccess: could not look up public link to pause", rentalId, e);
        return null;
      });
      if (opts.publicLink === "delete") {
        if (link) await deletePublicShareLink(link.linkId, profileId, token);
        await prisma.linkedInAccount.update({ where: { id: rental.linkedinAccountId }, data: { gologinShareLink: null } });
      } else if (link) {
        try { await setPublicShareLinkPaused(link.linkId, profileId, true, token); }
        catch (e) { console.error("revokeRentalAccess: could not pause public link", rentalId, e); }
      }
    }
  }
  return results;
}
