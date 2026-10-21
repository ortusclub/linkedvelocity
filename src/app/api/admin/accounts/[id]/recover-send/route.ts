import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAccountCodeLink } from "@/lib/account-code-link";
import { onboardingMailRequest } from "@/services/onboarding-mail";
import { formatName } from "@/lib/utils";

// Admin: actually EMAIL the owner + referrer the private /recover link (the phone-first page
// that shows the verification QR to scan). Mirrors the restrict-notify recipient resolution —
// owner = the one linked ambassador application's email, referrer = the referrer's email — so
// the link goes to the people who can do the phone identity check, NEVER the renter. Admin-
// triggered per click; fails safe (no unique application linked, or no QR attached = no send).
// Dedupes on the current QR capture time so re-clicking for the same QR can't double-send.
const RECOVER_BASE = "https://linkedvelocity.com/recover";

function message(name: string, recipient: "ambassador" | "referrer", link: string) {
  const subject = `Scan this to get ${name}'s LinkedIn back online`;
  const text = recipient === "referrer"
    ? `Hi,\n\nLinkedIn needs a quick identity check to get ${name}'s account back online, and it has to be done on a phone. Please send ${name} this private link and ask them to open it on their phone:\n\n${link}\n\nIt shows a QR code to scan with the LinkedIn app (and a 6-digit code option if LinkedIn asks for one instead). It's private and expires in 24 hours. Reply here if anything's unclear and we'll help.\n\nThanks,\nThe LinkedVelocity team`
    : `Hi ${name},\n\nYour LinkedIn account needs a quick identity check to get back online, and it has to be done on your phone. Open this private link on your phone and follow the steps:\n\n${link}\n\nIt shows a QR code to scan with the LinkedIn app (and a 6-digit code option if LinkedIn asks for one instead). It's private and expires in 24 hours. Reply here if you get stuck and we'll help you verify another way.\n\nThanks,\nThe LinkedVelocity team`;
  return { subject, text };
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const account = await prisma.linkedInAccount.findUnique({
      where: { id },
      select: { linkedinName: true, linkedinUrl: true, notes: true, recoveryQrUrl: true, recoveryQrAt: true, selfServiceOnboarding: { select: { applicationId: true } } },
    });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    if (!account.recoveryQrUrl) return NextResponse.json({ error: "Attach a QR first — there's nothing to send yet." }, { status: 400 });

    // Resolve the one linked application (same matching as restrict-notify / the Issue email).
    const owner = (account.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "");
    const apps = await prisma.ambassadorApplication.findMany({ select: { id: true, email: true, fullName: true, linkedinUrl: true, referredBy: true } });
    const norm = (s: string | null) => (s || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").split("?")[0].replace(/\/+$/, "");
    const matched = account.selfServiceOnboarding ? apps.filter(a => a.id === account.selfServiceOnboarding!.applicationId) : apps.filter(a => norm(account.linkedinUrl) && norm(a.linkedinUrl) === norm(account.linkedinUrl));
    const candidates = matched.length ? matched : apps.filter(a => owner && a.email.toLowerCase() === owner.toLowerCase());
    if (candidates.length !== 1) return NextResponse.json({ error: "Link a unique ambassador application to this account before emailing (so we know the owner + referrer)." }, { status: 400 });
    const app = candidates[0];

    const ref = app.referredBy ? await prisma.referrer.findFirst({ where: { slug: { equals: app.referredBy, mode: "insensitive" } }, select: { email: true, contacts: true } }) : null;
    const refContacts = (Array.isArray(ref?.contacts) ? ref.contacts : []) as Array<{ method?: string; handle?: string }>;
    const referrerEmail = ref?.email || refContacts.find(c => c.method?.toLowerCase() === "email")?.handle || "";

    const name = formatName(account.linkedinName) || formatName(app.fullName) || "your account";
    const codeLink = await createAccountCodeLink(id).catch(() => "");
    const link = codeLink ? codeLink.replace("/c#", "/recover#") : RECOVER_BASE;
    const stamp = account.recoveryQrAt ? new Date(account.recoveryQrAt).toISOString() : new Date().toISOString();

    const recipients: Array<{ recipient: "ambassador" | "referrer"; to: string }> = [];
    if (z.string().email().safeParse(app.email).success) recipients.push({ recipient: "ambassador", to: app.email });
    if (z.string().email().safeParse(referrerEmail).success) recipients.push({ recipient: "referrer", to: referrerEmail });

    const sent: Array<{ recipient: string; to: string }> = [];
    const skipped: Array<{ recipient: string; reason: string }> = [];
    if (!recipients.some(r => r.recipient === "ambassador")) skipped.push({ recipient: "ambassador", reason: "no owner email on file" });
    if (!recipients.some(r => r.recipient === "referrer")) skipped.push({ recipient: "referrer", reason: "no referrer email on file" });
    if (!recipients.length) return NextResponse.json({ error: "No owner or referrer email on file for this account.", sent, skipped }, { status: 400 });

    for (const { recipient, to } of recipients) {
      const { subject, text } = message(name, recipient, link);
      await onboardingMailRequest("/emails", { from: process.env.RESEND_FROM_EMAIL || "LinkedVelocity <info@linkedvelocity.com>", reply_to: process.env.ADMIN_NOTIFICATION_EMAIL || "info@linkedvelocity.com", to: [to], subject, text }, `recover-send-${id}-${recipient}-${stamp}`);
      const entry = `[${new Date().toISOString()}] Emailed recover QR link to ${recipient} (${to}).`;
      await prisma.$executeRaw`UPDATE linkedin_accounts SET notes = concat_ws(E'\n', nullif(notes, ''), ${entry}::text), updated_at = NOW() WHERE id = ${id}::uuid`;
      sent.push({ recipient, to });
    }

    await prisma.linkedInAccount.update({ where: { id }, data: { recoverySentAt: new Date(), recoverySentVia: "email" } });
    return NextResponse.json({ ok: true, sent, skipped });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send the recovery email.";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}
