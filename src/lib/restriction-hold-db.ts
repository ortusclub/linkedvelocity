// Server-side resolver: given an application (and optionally a known accountId), find its
// inventory account and return any active restriction payout hold. Used to ENFORCE the hold on
// the write paths that record a payout (payouts console mark-paid, pipeline logPayment), so a
// recently-recovered or restricted account can't be marked paid without an explicit release.

import { prisma } from "@/lib/prisma";
import { resolveAccountForApplication } from "@/lib/account-link";
import { restrictionPayHold, type RestrictionPayHold } from "@/lib/restriction-hold";

const HOLD_SELECT = {
  id: true,
  linkedinUrl: true,
  personalEmail: true,
  restrictedAt: true,
  permanentlyRestricted: true,
  restrictionLog: true,
} as const;

// Resolve the hold for an application. `accountId` (when the caller already knows the linked
// account, e.g. the pipeline passes it on the setup payout) is trusted first. Returns null when
// no account can be resolved (nothing to block on) or the account is clear.
export async function restrictionHoldForApplication(
  app: { email: string; linkedinUrl: string | null; selfServiceOnboarding?: { accountId: string | null } | null },
  accountId?: string | null,
  now: number = Date.now(),
): Promise<RestrictionPayHold | null> {
  if (accountId) {
    const direct = await prisma.linkedInAccount.findUnique({ where: { id: accountId }, select: HOLD_SELECT }).catch(() => null);
    if (direct) return restrictionPayHold(direct, now);
  }
  const url = (app.linkedinUrl || "").trim();
  const where: Record<string, unknown>[] = [{ personalEmail: { equals: app.email, mode: "insensitive" } }];
  if (url) where.push({ linkedinUrl: url });
  if (app.selfServiceOnboarding?.accountId) where.push({ id: app.selfServiceOnboarding.accountId });
  const candidates = await prisma.linkedInAccount.findMany({ where: { OR: where }, select: HOLD_SELECT });
  const acct = resolveAccountForApplication(
    { email: app.email, linkedinUrl: app.linkedinUrl, selfServiceOnboarding: app.selfServiceOnboarding ?? null },
    candidates,
  );
  return acct ? restrictionPayHold(acct, now) : null;
}
