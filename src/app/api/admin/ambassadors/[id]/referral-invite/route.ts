import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { onboardingMailRequest } from "@/services/onboarding-mail";

// Records the referral-program invite from the onboarded pipeline row. For channel "email" it
// also sends the email via Resend; the chat channels (WhatsApp/Telegram/Viber) open directly
// from the client, so for those this route only logs that the invite was sent (so the "not yet
// invited" flag on the pipeline row clears). Both log an outreachLog entry id "referral:<uuid>".
const schema = z.object({
  recipient: z.enum(["ambassador", "referrer"]),
  channel: z.enum(["email", "whatsapp", "telegram", "viber"]).default("email"),
  subject: z.string().trim().max(200).optional(),
  text: z.string().trim().min(1).max(15000),
  requestId: z.string().uuid(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin();
    const input = schema.parse(await req.json());
    const { id } = await params;
    const app = await prisma.ambassadorApplication.findUnique({ where: { id }, select: { email: true, referredBy: true } });
    if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });

    const logId = `referral:${input.requestId}`;
    let to = "";

    if (input.channel === "email") {
      const subject = input.subject?.trim();
      if (!subject) return NextResponse.json({ error: "Add a subject before sending." }, { status: 400 });
      to = app.email ?? "";
      if (input.recipient === "referrer") {
        const ref = app.referredBy ? await prisma.referrer.findFirst({ where: { slug: { equals: app.referredBy, mode: "insensitive" } }, select: { email: true, contacts: true, contactMethod: true, contactHandle: true } }) : null;
        const contacts = (Array.isArray(ref?.contacts) ? ref.contacts : []) as Array<{ method?: string; handle?: string }>;
        to = ref?.email || contacts.find(c => c.method?.toLowerCase() === "email")?.handle || (ref?.contactMethod?.toLowerCase() === "email" ? ref.contactHandle : "") || "";
      }
      if (!z.string().email().safeParse(to).success) return NextResponse.json({ error: `No ${input.recipient} email is saved.` }, { status: 400 });

      await onboardingMailRequest("/emails", { from: process.env.RESEND_FROM_EMAIL || "LinkedVelocity <info@linkedvelocity.com>", reply_to: "info@linkedvelocity.com", to: [to], subject, text: input.text }, `referral-invite-${id}-${input.requestId}`);
    }

    const logText = input.channel === "email"
      ? `Referral invite to ${input.recipient} (${to}): ${input.subject}\n\n${input.text}`
      : `Referral invite to ${input.recipient} via ${input.channel}:\n\n${input.text}`;
    const entry = JSON.stringify([{ id: logId, ch: input.channel, text: logText, by: user.fullName || user.email, at: new Date().toISOString() }]);
    await prisma.$executeRaw`UPDATE ambassador_applications SET outreach_log = COALESCE(outreach_log, '[]'::jsonb) || ${entry}::jsonb, updated_at = NOW() WHERE id = ${id}::uuid AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(outreach_log, '[]'::jsonb)) item WHERE item->>'id' = ${logId})`;

    return NextResponse.json({ ok: true, to });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send email";
    return NextResponse.json({ error: error instanceof z.ZodError ? "Complete the message before sending." : message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : error instanceof z.ZodError ? 400 : 500 });
  }
}
