import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { EmailSetupError } from "@/lib/onboarding-email-policy";
const TTL = 24 * 60 * 60 * 1000;
// The owner QR-recovery page shows no credentials — just the verification QR + "did it work?"
// buttons — and owners are often slow to act, so its link should effectively never expire (owners
// kept hitting "this private link is invalid or expired" days after we sent it). Credential links
// (/c#) keep the 24h TTL; only the /recover# routes pass this one.
export const RECOVERY_LINK_TTL = 3650 * 24 * 60 * 60 * 1000; // ~10 years
function sign(payload: string) {
  const secret = process.env.ONBOARDING_EMAIL_CODE_SECRET;
  if (!secret) throw new EmailSetupError("Account code links are temporarily unavailable.", 503);
  return createHmac("sha256", secret).update(`account-code:v1:${payload}`).digest("base64url");
}
export async function createAccountCodeLink(id: string, now = Date.now(), ttlMs: number = TTL) {
  const token = randomBytes(16).toString("base64url");
  await prisma.accountCodeLink.create({ data: { tokenHash: createHash("sha256").update(token).digest("hex"), accountId: id, expiresAt: new Date(now + ttlMs) } });
  return `https://linkedvelocity.com/c#${token}`;
}
export async function readAccountCodeLink(token: string, now = Date.now()): Promise<string> {
  const deny = () => new EmailSetupError("This private link is invalid or expired. Ask our team for a new link.", 403);
  if (/^[A-Za-z0-9_-]{22}$/.test(token)) {
    const row = await prisma.accountCodeLink.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    if (!row || row.expiresAt.getTime() <= now) throw deny();
    return row.accountId;
  }
  // Previously issued signed links remain valid until their original expiry.
  if (token.length > 1000) throw deny();
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw deny();
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw deny();
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.id !== "string" || !/^[a-f0-9-]{36}$/i.test(data.id) || !Number.isFinite(data.expires) || data.expires <= now || data.expires > now + TTL) throw deny();
    return data.id;
  } catch { throw deny(); }
}
