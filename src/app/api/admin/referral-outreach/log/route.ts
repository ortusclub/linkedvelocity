import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Records a chat outreach (WhatsApp/Telegram/Viber) against a person's outreach_log, so
// opening the chat from the outreach page shows "already messaged" and doesn't get doubled.
// Targets an ambassador application (applicationId) OR a standalone referrer (referrerId) —
// exactly one. Email sends log themselves in /send; this is for the client-opened chat channels.
const schema = z.object({
  applicationId: z.string().uuid().optional(),
  referrerId: z.string().uuid().optional(),
  channel: z.enum(["whatsapp", "telegram", "viber"]),
}).refine(d => !!d.applicationId !== !!d.referrerId, { message: "Provide exactly one of applicationId / referrerId" });

export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const { applicationId, referrerId, channel } = schema.parse(await req.json());
    const at = new Date().toISOString();
    const entry = JSON.stringify([{ id: `referral:${randomUUID()}`, ch: channel, text: `Referral program invite sent via ${channel}`, by: user.fullName || user.email, at }]);
    if (referrerId) {
      await prisma.$executeRaw`UPDATE referrers SET outreach_log = COALESCE(outreach_log, '[]'::jsonb) || ${entry}::jsonb, updated_at = NOW() WHERE id = ${referrerId}::uuid`;
    } else {
      await prisma.$executeRaw`UPDATE ambassador_applications SET outreach_log = COALESCE(outreach_log, '[]'::jsonb) || ${entry}::jsonb, updated_at = NOW() WHERE id = ${applicationId}::uuid`;
    }
    return NextResponse.json({ ok: true, ch: channel, at });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const msg = error instanceof Error ? error.message : "Could not log";
    return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500 });
  }
}
