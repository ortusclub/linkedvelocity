import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { onboardingMailRequest } from "@/services/onboarding-mail";
const schema = z.object({ recipient: z.enum(["ambassador", "referrer"]), issue: z.enum(["application_incomplete", "email_added", "email_primary", "twofa", "twofa_incorrect", "password", "restricted", "verification_code", "unresponsive", "other"]), details: z.string().max(3000), subject: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(15000), requestId: z.string().uuid() }).refine(v => v.issue !== "other" || !!v.details.trim());
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin();
    const input = schema.parse(await req.json());
    const { id } = await params;
    const app = await prisma.ambassadorApplication.findUnique({ where: { id }, select: { email: true, referredBy: true } });
    if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    let to = app.email;
    if (input.recipient === "referrer") {
      const ref = app.referredBy ? await prisma.referrer.findFirst({ where: { slug: { equals: app.referredBy, mode: "insensitive" } }, select: { email: true, contacts: true, contactMethod: true, contactHandle: true } }) : null;
      const contacts = (Array.isArray(ref?.contacts) ? ref.contacts : []) as Array<{ method?: string; handle?: string }>;
      to = ref?.email || contacts.find(c => c.method?.toLowerCase() === "email")?.handle || (ref?.contactMethod?.toLowerCase() === "email" ? ref.contactHandle : "") || "";
    }
    if (!z.string().email().safeParse(to).success) return NextResponse.json({ error: `No ${input.recipient} email is saved.` }, { status: 400 });
    await onboardingMailRequest("/emails", { from: process.env.RESEND_FROM_EMAIL || "LinkedVelocity <info@linkedvelocity.com>", reply_to: "info@linkedvelocity.com", to: [to], subject: input.subject, text: input.text }, `pipeline-issue-${id}-${input.requestId}`);
    const logId = `issue:${input.requestId}`;
    const entry = JSON.stringify([{ id: logId, ch: "email", text: `Emailed ${input.recipient} (${to}): ${input.subject}\n\n${input.text}`, by: user.fullName || user.email, at: new Date().toISOString() }]);
    await prisma.$executeRaw`UPDATE ambassador_applications SET outreach_log = COALESCE(outreach_log, '[]'::jsonb) || ${entry}::jsonb, updated_at = NOW() WHERE id = ${id}::uuid AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(outreach_log, '[]'::jsonb)) item WHERE item->>'id' = ${logId})`;
    if (["application_incomplete", "email_added", "email_primary", "twofa", "password"].includes(input.issue)) {
      // Merge issue flags atomically so separate messages cannot overwrite each other.
      await prisma.$executeRaw`UPDATE ambassador_applications SET onboarding_fix = jsonb_build_object('issues', (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(COALESCE(onboarding_fix->'issues', '[]'::jsonb) || jsonb_build_array(${input.issue}::text))), 'state', 'open', 'raisedAt', COALESCE(onboarding_fix->>'raisedAt', ${new Date().toISOString()}::text)) WHERE id = ${id}::uuid`;
    }
    return NextResponse.json({ ok: true, to });
  } catch(error) { const message = error instanceof Error ? error.message : "Could not send email"; return NextResponse.json({ error: error instanceof z.ZodError ? "Choose an issue and complete the message." : message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : error instanceof z.ZodError ? 400 : 500 }); }
}
