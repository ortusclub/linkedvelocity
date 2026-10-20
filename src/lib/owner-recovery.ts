import { prisma } from "@/lib/prisma";
import { readAccountCodeLink } from "@/lib/account-code-link";
import { formatName } from "@/lib/utils";

// Owner-facing: resolve a private /recover link token to just what the owner page needs to
// show — their first name and the verification QR the team relayed. Deliberately minimal: no
// credentials, no email, nothing that isn't needed to scan a QR. Throws (via readAccountCodeLink)
// on an invalid/expired token.
export async function ownerRecoveryInfo(access: string): Promise<{ name: string; qrUrl: string | null; qrAt: string | null }> {
  const accountId = await readAccountCodeLink(access);
  const account = await prisma.linkedInAccount.findUnique({
    where: { id: accountId },
    select: { linkedinName: true, recoveryQrUrl: true, recoveryQrAt: true },
  });
  if (!account) return { name: "", qrUrl: null, qrAt: null };
  const first = (formatName(account.linkedinName) || "").split(/\s+/)[0] || "";
  return { name: first, qrUrl: account.recoveryQrUrl, qrAt: account.recoveryQrAt ? account.recoveryQrAt.toISOString() : null };
}
