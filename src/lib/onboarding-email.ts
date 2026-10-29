import { forwardPrimaryRecoveryEmail } from "@/lib/primary-email-recovery";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assignedEmail, emailSetupConfig, EmailSetupError, forwardingActive, hashEmailCode, linkedinSender, forwardedText, onboardingEmailFrom } from "@/lib/onboarding-email-policy";
import { onboardingMailRequest } from "@/services/onboarding-mail";
import type { Prisma } from "@/generated/prisma/client";

// Forwarding stays active for the whole onboarding, not a tight hour — a slow owner (or a
// LinkedIn resend that arrives late) should still be captured. Bounded generously so an
// abandoned onboarding eventually stops, and refreshed on every resend below.
const FORWARD_WINDOW_MS = 30 * 24 * 3600000; // 30 days

export const emailAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), destination: z.string().trim().email().max(254).transform(s => s.toLowerCase()), consent: z.literal(true) }),
  z.object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("restart"), consent: z.literal(true) }),
  z.object({ action: z.literal("primary"), consent: z.literal(true) }),
]);

// Called only inside the email allocation lock. Retained setup rows are the
// durable round-robin counter; resends/resumes never consume another position.
export async function allocateOnboardingAddress(tx: Prisma.TransactionClient, name: string, domains: string[], excludeAddress?: string | null) {
  if (!domains.length) throw new EmailSetupError("No receiving domain is configured.", 503);
  const domain = domains[(await tx.onboardingEmailSetup.count()) % domains.length];
  for (let collision = 0; collision < 10000; collision++) {
    const address = assignedEmail(name, domain, collision);
    if (address === excludeAddress) continue;
    const [setup, account, application] = await Promise.all([
      tx.onboardingEmailSetup.findUnique({ where: { address }, select: { sessionId: true } }),
      tx.linkedInAccount.findFirst({ where: { OR: [{ loginEmail: { equals: address, mode: "insensitive" } }, { personalEmail: { equals: address, mode: "insensitive" } }] }, select: { id: true } }),
      tx.ambassadorApplication.findFirst({ where: { OR: [{ linkedinEmail: { equals: address, mode: "insensitive" } }, { email: { equals: address, mode: "insensitive" } }] }, select: { id: true } }),
    ]);
    if (!setup && !account && !application) return address;
  }
  throw new EmailSetupError("Could not reserve a unique email address. Ask the team for help.", 409);
}

export async function emailSetupSummary(id: string, referrerId: string) {
  const config = emailSetupConfig();
  if (!config.enabled) return null;
  const s = await prisma.selfServiceOnboarding.findFirst({ where: { id, referrerId }, select: { state: true, emailSetup: true, email: true, publicToken: true } });
  if (!s) throw new EmailSetupError("Onboarding not found.", 404);
  const e = s.emailSetup;
  return { previouslyVerifiedEmail: s.publicToken ? s.email : null, configured: config.ready, domains: config.domains, address: e?.address || null, destination: e?.destination || null,
    destinationVerified: !!e?.destinationVerifiedAt, primaryConfirmed: !!e?.primaryConfirmedAt,
    verificationCodePending: !!e?.codeHash && !!e.codeExpiresAt && e.codeExpiresAt > new Date(),
    forwardingActive: !!e && forwardingActive(e, s.state), forwardingUntil: e?.forwardingUntil || null,
    lastForwardedAt: e?.lastForwardedAt || null, primaryConfirmedAt: e?.primaryConfirmedAt || null,
    confirmUrl: e?.confirmUrl || null,
    // Latest LinkedIn code — shown ONLY while forwarding is active (session not confirmed /
    // not onboarded) and only if reasonably fresh (<60 min). Auto-hides after onboarding and
    // when stale. The window is generous so the code doesn't vanish while the referrer is
    // toggling between LinkedIn and the portal; the UI notes it may be expired.
    latestCode: e && forwardingActive(e, s.state) && e.lastCode && e.lastCodeAt && (Date.now() - e.lastCodeAt.getTime() < 60 * 60000) ? e.lastCode : null,
    latestCodeAt: e && forwardingActive(e, s.state) && e.lastCode && e.lastCodeAt && (Date.now() - e.lastCodeAt.getTime() < 60 * 60000) ? e.lastCodeAt : null };
}

export async function requireEmailSetup(id: string, referrerId: string) {
  const info = await emailSetupSummary(id, referrerId);
  if (info && (!info.configured || !info.primaryConfirmed)) throw new EmailSetupError("Complete the primary-email step before opening GoLogin.", 409);
}

export async function updateEmailSetup(id: string, referrerId: string, input: z.infer<typeof emailAction>, options: { publicOwner?: boolean } = {}) {
  const config = emailSetupConfig();
  if (!config.ready) throw new EmailSetupError("Email setup is not live yet. The team needs to verify receiving and forwarding first.", 503);
  const owner = await prisma.selfServiceOnboarding.findFirst({ where: { id, referrerId }, include: { application: { select: { fullName: true } } } });
  if (!owner || owner.state === "confirmed") throw new EmailSetupError("This onboarding cannot be changed.", 409);
  const now = new Date();
  if (input.action === "start") {
    if (config.domains.includes(input.destination.split("@")[1])) throw new EmailSetupError("Use an existing inbox, not an onboarding address.");
    // Public session tokens are minted only after the original email passes the
    // signup verification gate. Never trust a client-supplied verification flag.
    if (options.publicOwner && owner.publicToken && owner.email.toLowerCase() === input.destination) {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(69100902)`;
        const prior = await tx.onboardingEmailSetup.findUnique({ where: { sessionId: id } });
        if (prior?.destinationVerifiedAt && prior.destination !== input.destination) throw new EmailSetupError("Restart the email step before changing your forwarding inbox.", 409);
        const address = prior?.address || await allocateOnboardingAddress(tx, owner.application.fullName, config.domains);
        const verified = { destination: input.destination, consentAt: now, destinationVerifiedAt: now,
          forwardingUntil: new Date(now.getTime() + FORWARD_WINDOW_MS), codeHash: null, codeExpiresAt: null, codeAttempts: 0 };
        await tx.onboardingEmailSetup.upsert({ where: { sessionId: id }, create: { sessionId: id, address, ...verified }, update: verified });
      }, { timeout: 15000 });
      return;
    }
    const code = String(randomInt(100000, 1000000));
    const attempt = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(69100902)`;
      const prior = await tx.onboardingEmailSetup.findUnique({ where: { sessionId: id } });
      if (prior?.destinationVerifiedAt && prior.destination !== input.destination) throw new EmailSetupError("A verified route cannot be reassigned. Ask the team for help.", 409);
      if (prior?.codeSentAt && now.getTime() - prior.codeSentAt.getTime() < 60000) throw new EmailSetupError("Wait one minute before requesting another code.", 429);
      if ((prior?.codeSends || 0) >= 5) throw new EmailSetupError("Verification send limit reached. Ask the team for help.", 429);
      const recent = await tx.onboardingEmailSetup.count({ where: { destination: input.destination, codeSentAt: { gt: new Date(now.getTime() - 60000) } } });
      if (recent) throw new EmailSetupError("A code was recently sent to this inbox. Wait one minute.", 429);
      const address = prior?.address || await allocateOnboardingAddress(tx, owner.application.fullName, config.domains);
      return tx.onboardingEmailSetup.upsert({ where: { sessionId: id },
        create: { sessionId: id, address, destination: input.destination, consentAt: now,
          codeHash: hashEmailCode(id, input.destination, code), codeExpiresAt: new Date(now.getTime() + 600000), codeSentAt: now, codeSends: 1 },
        update: { destination: input.destination, consentAt: now, codeHash: hashEmailCode(id, input.destination, code), codeExpiresAt: new Date(now.getTime() + 600000), codeSentAt: now, codeAttempts: 0, codeSends: { increment: 1 } },
      });
    }, { timeout: 15000 });
    try {
      await onboardingMailRequest("/emails", { from: onboardingEmailFrom(), to: [input.destination], subject: "Confirm your onboarding forwarding inbox",
        text: `Your verification code is ${code}. It expires in 10 minutes. Only enter it in the LinkedVelocity onboarding you started. If you did not request this, ignore this email.` }, `onboarding-inbox-${id}-${attempt.codeSends}`);
    } catch { throw new EmailSetupError("The verification email could not be confirmed as sent. Wait a minute, then request a new code.", 502); }
    return;
  }
  if (input.action === "verify") {
    const accepted = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(69100902)`;
      const e = await tx.onboardingEmailSetup.findUnique({ where: { sessionId: id } });
      if (!e?.codeHash || !e.codeExpiresAt || e.codeExpiresAt <= now || e.codeAttempts >= 5) return false;
      // Persist failed attempts: throwing inside the transaction would roll them back.
      await tx.onboardingEmailSetup.update({ where: { sessionId: id }, data: { codeAttempts: { increment: 1 } } });
      if (e.codeHash !== hashEmailCode(id, e.destination, input.code)) return false;
      await tx.onboardingEmailSetup.update({ where: { sessionId: id }, data: { destinationVerifiedAt: now, forwardingUntil: new Date(now.getTime() + FORWARD_WINDOW_MS), codeHash: null, codeExpiresAt: null } });
      return true;
    });
    if (!accepted) throw new EmailSetupError("Incorrect or expired code. Request a new code if needed.");
    return;
  }
  if (input.action === "restart") {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(69100902)`;
      const e = await tx.onboardingEmailSetup.findUnique({ where: { sessionId: id } });
      if (!e?.destinationVerifiedAt) throw new EmailSetupError("Verify the forwarding inbox before restarting this step.", 409);
      const address = await allocateOnboardingAddress(tx, owner.application.fullName, config.domains, e.address);
      await tx.onboardingEmailSetup.update({ where: { sessionId: id }, data: {
        address, consentAt: now, destinationVerifiedAt: null, primaryConfirmedAt: null,
        forwardingUntil: null, lastForwardedAt: null, confirmUrl: null, codeHash: null, codeExpiresAt: null, codeAttempts: 0,
      } });
    }, { timeout: 15000 });
    return;
  }
  await prisma.$transaction(async tx => {
    const e = await tx.onboardingEmailSetup.findUnique({ where: { sessionId: id } });
    if (!e || !forwardingActive(e, owner.state) || !(e.lastForwardedAt || e.confirmUrl)) throw new EmailSetupError("Verify the forwarding inbox and receive the LinkedIn message before confirming the primary address.", 409);
    if (e.primaryConfirmedAt) return;
    await tx.onboardingEmailSetup.update({ where: { sessionId: id }, data: { primaryConfirmedAt: now } });
    await tx.linkedInAccount.update({ where: { id: owner.accountId }, data: { loginEmail: e.address } });
    await tx.ambassadorApplication.update({ where: { id: owner.applicationId }, data: { linkedinEmail: e.address } });
    // This is a referrer attestation only. It does not verify LinkedIn ownership or authorize payout.
  });
}

const incomingEmail = z.object({ id: z.string(), from: z.string(), to: z.array(z.string()), created_at: z.string(), subject: z.string(), text: z.string().nullable(), html: z.string().nullable() });

export async function forwardOnboardingEmail(emailId: string) {
  const config = emailSetupConfig();
  if (!config.ready) throw new Error("Inbound routing is disabled");
  const msg = incomingEmail.parse(await onboardingMailRequest(`/emails/receiving/${encodeURIComponent(emailId)}`));
  if (await forwardPrimaryRecoveryEmail(emailId, msg)) return;
  if (msg.id !== emailId || !linkedinSender(msg.from)) return;
  // Never fan out a multi-recipient message across account owners or disclose its contents in logs.
  if (msg.to.length !== 1) return;
  const address = msg.to[0].trim().toLowerCase();
  if (!config.domains.includes(address.split("@")[1])) return;
  // Capture the confirm link / 6-digit code for ANY LinkedIn email to our domains — even an
  // address added to LinkedIn manually that never went through the wizard — so the team can
  // read it in /admin/onboarding-codes. Independent of (and before) the wizard-forward path.
  try {
    const cap = forwardedText(msg.text, msg.html);
    const capConfirm = cap.match(/https:\/\/[a-z0-9.-]*linkedin\.com\/comm\/psettings\/email\/confirm[^\s)]*/i)?.[0] || null;
    const capLabeled = cap.match(/(?:code|pin|verification|security)[^0-9]{0,24}(\d{6})\b/i)?.[1];
    const capAll = cap.match(/\b\d{6}\b/g);
    const capCode = capLabeled || (capAll && new Set(capAll).size === 1 ? capAll[0] : null);
    if (capConfirm || capCode) {
      await prisma.capturedVerification.upsert({
        where: { emailId },
        create: { emailId, address, fromAddr: msg.from.slice(0, 254), subject: (msg.subject || "").slice(0, 300) || null, confirmUrl: capConfirm, code: capCode, receivedAt: new Date(msg.created_at) },
        update: {},
      });
    }
  } catch { console.error("verification capture failed"); }
  const e = await prisma.onboardingEmailSetup.findUnique({ where: { address }, include: { session: { select: { state: true, referrer: { select: { active: true } } } } } });
  const now = new Date();
  if (!e || !e.session.referrer.active || !forwardingActive(e, e.session.state, now)) return;
  const received = new Date(msg.created_at);
  if (!Number.isFinite(received.getTime()) || received < e.destinationVerifiedAt! || received > now || now.getTime() - received.getTime() > 86400000) return;
  const claimed = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(69100902)`;
    const prior = await tx.onboardingEmailDelivery.findUnique({ where: { emailId } });
    if (prior && (prior.status === "sent" || prior.createdAt.getTime() < now.getTime() - 23 * 3600000)) return false;
    if (prior?.leaseUntil && prior.leaseUntil > now) throw new Error("Delivery is in progress");
    // Rolling 24h cap (not lifetime) — anti-abuse without permanently locking a long/retried
    // onboarding out of receiving new codes once it has forwarded 20 emails over its lifetime.
    if (!prior && await tx.onboardingEmailDelivery.count({ where: { sessionId: e.sessionId, createdAt: { gt: new Date(now.getTime() - 86400000) } } }) >= 20) return false;
    await tx.onboardingEmailDelivery.upsert({ where: { emailId }, create: { emailId, sessionId: e.sessionId, leaseUntil: new Date(now.getTime() + 60000) }, update: { leaseUntil: new Date(now.getTime() + 60000) } });
    return true;
  });
  if (!claimed) return;
  // Plain text avoids remote tracking, executable markup and attachment disclosure.
  const content = forwardedText(msg.text, msg.html);
  const confirmUrl = content.match(/https:\/\/[a-z0-9.-]*linkedin\.com\/comm\/psettings\/email\/confirm[^\s)]*/i)?.[0];
  // Surface LinkedIn's confirm link in the wizard immediately — this is the reliable path;
  // the forwarded email below is a fallback. Store it before attempting the forward so a
  // slow/failed forward never hides the link from the referrer.
  if (confirmUrl) {
    try { await prisma.onboardingEmailSetup.update({ where: { sessionId: e.sessionId }, data: { confirmUrl } }); } catch { /* best effort */ }
  }
  // Capture LinkedIn's 6-digit verification/OTP code so the referrer (wizard) and team (admin)
  // can read it directly during setup — no relaying through the team. Only ever written here,
  // inside the forwardingActive-gated path (session not confirmed), and cleared on confirm/onboard.
  const labeledCode = content.match(/(?:code|pin|verification|security)[^0-9]{0,24}(\d{6})\b/i)?.[1];
  const allSix = content.match(/\b\d{6}\b/g);
  const code = labeledCode || (allSix && new Set(allSix).size === 1 ? allSix[0] : null);
  if (code) {
    try { await prisma.onboardingEmailSetup.update({ where: { sessionId: e.sessionId }, data: { lastCode: code, lastCodeAt: new Date() } }); } catch { /* best effort */ }
  }
  // Only forward a genuine email-confirmation message: LinkedIn's confirm link, or a verification
  // code the owner actually needs. Other LinkedIn mail that lands while the forwarding window is
  // open — a restriction/appeal update, a security notice, a generic notification — must NOT be
  // relayed, because it goes out under the onboarding "Confirm your new LinkedIn email" subject
  // with a reassurance header ("password unchanged, you keep full access") that is false and
  // alarming on those emails (e.g. an appeal rejection saying the account stays restricted). Mark
  // the delivery handled so it isn't retried, and return without sending.
  if (!confirmUrl && !code) {
    await prisma.onboardingEmailDelivery.update({ where: { emailId }, data: { status: "skipped", sentAt: new Date(), leaseUntil: null } });
    return;
  }
  try {
    const current = await prisma.onboardingEmailSetup.findUnique({ where: { sessionId: e.sessionId }, include: { session: { select: { state: true } } } });
    if (!current || !forwardingActive(current, current.session.state)) return;
    await onboardingMailRequest("/emails", { from: onboardingEmailFrom(), to: [e.destination], subject: "Confirm your new LinkedIn email",
      text: `Hi from LinkedVelocity,\n\nA new email (${e.address}) was just added to your LinkedIn account as part of setting it up with LinkedVelocity. LinkedIn needs you to confirm it.\n\n${confirmUrl ? `Confirm it here (tap the link, or copy and paste it into your browser):\n${confirmUrl}\n` : `Open the confirmation link in LinkedIn's message below (tap it, or copy and paste it into your browser).\n`}\nThen:\n1. If LinkedIn asks you to sign in, use your normal LinkedIn login.\n2. In your LinkedIn settings, set this new email as your Primary email.\n\nGood to know: your LinkedIn password does NOT change and you keep full access to your account. LinkedVelocity will never ask for your password, so never share it with anyone.\n\n------------------------------\nLinkedIn's original message:\n\n${content}` }, `onboarding-forward-${emailId}`);
    await prisma.$transaction([
      prisma.onboardingEmailDelivery.update({ where: { emailId }, data: { status: "sent", sentAt: new Date(), leaseUntil: null } }),
      prisma.onboardingEmailSetup.update({ where: { sessionId: e.sessionId }, data: { lastForwardedAt: new Date() } }),
    ]);
  } catch {
    await prisma.onboardingEmailDelivery.update({ where: { emailId }, data: { leaseUntil: null } });
    throw new Error("Forward delivery needs retry");
  }
}
