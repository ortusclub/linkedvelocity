import { prisma } from "@/lib/prisma";
import { readAccountCodeLink } from "@/lib/account-code-link";
import { formatName } from "@/lib/utils";

export type RecoveryOutcome = "worked" | "stuck";

type OwnerRecoveryInfo = {
  name: string;
  qrUrl: string | null;
  qrAt: string | null;
  outcome: RecoveryOutcome | null;
};

// Owner-facing: resolve a private /recover link token to just what the owner page needs to
// show — their first name, the verification QR the team relayed, and any outcome they've
// already reported (so a refresh keeps showing "you told us it worked"). Deliberately minimal:
// no credentials, no email, nothing that isn't needed to scan a QR. Throws (via
// readAccountCodeLink) on an invalid/expired token.
export async function ownerRecoveryInfo(access: string): Promise<OwnerRecoveryInfo> {
  const accountId = await readAccountCodeLink(access);
  const account = await prisma.linkedInAccount.findUnique({
    where: { id: accountId },
    select: { linkedinName: true, recoveryQrUrl: true, recoveryQrAt: true, recoveryOutcome: true },
  });
  if (!account) return { name: "", qrUrl: null, qrAt: null, outcome: null };
  const first = (formatName(account.linkedinName) || "").split(/\s+/)[0] || "";
  const outcome = account.recoveryOutcome === "worked" || account.recoveryOutcome === "stuck" ? account.recoveryOutcome : null;
  return { name: first, qrUrl: account.recoveryQrUrl, qrAt: account.recoveryQrAt ? account.recoveryQrAt.toISOString() : null, outcome };
}

// Owner-facing: record what the owner reported after trying the QR — "worked" (back in) or
// "stuck" (still can't). Surfaces on /admin/restrictions-v2 so the team knows whether to move on or
// step in. Token-gated by the same 24h private link; nothing sensitive is written or read.
export async function recordOwnerRecoveryOutcome(access: string, outcome: RecoveryOutcome): Promise<{ ok: true }> {
  const accountId = await readAccountCodeLink(access);
  await prisma.linkedInAccount.update({
    where: { id: accountId },
    data: { recoveryOutcome: outcome, recoveryOutcomeAt: new Date() },
  });
  return { ok: true };
}
