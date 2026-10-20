import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

const TYPE_TO_CHANNEL: Record<string, string> = { Note: "note", Call: "call", WhatsApp: "whatsapp", Telegram: "telegram", Email: "email" };

// POST { personId, type, text } — log a conversation on a person. Writes a conversations
// row and, when the person has a linked inbound lead, mirrors the entry into
// inbound_leads.comms_log so /admin/crm and /admin/inbound show the same history.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { personId, type = "Note", text } = await req.json();
    const body = (text || "").trim();
    if (!personId || !body) return NextResponse.json({ error: "Missing personId or text" }, { status: 400 });

    const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, inboundLeadId: true } });
    if (!person) return NextResponse.json({ error: "Person not found" }, { status: 404 });

    const channel = TYPE_TO_CHANNEL[type] || "note";
    const now = new Date();
    const conv = await prisma.conversation.create({
      data: { personId, type, text: body, direction: "outbound", authorName: admin.fullName, authorEmail: admin.email, createdAt: now },
    });
    await prisma.person.update({ where: { id: personId }, data: { lastActivityAt: now } });

    // Mirror into the legacy comms_log (idempotent on the conversation id).
    if (person.inboundLeadId) {
      const entry = JSON.stringify([{ id: conv.id, ts: now.toISOString(), channel, body, direction: "outbound", authorName: admin.fullName, authorEmail: admin.email }]);
      await prisma.$executeRaw`
        UPDATE inbound_leads
        SET comms_log = ${entry}::jsonb || COALESCE(comms_log, '[]'::jsonb),
            last_contact_at = CASE WHEN ${channel} = 'note' THEN last_contact_at ELSE NOW() END,
            updated_at = NOW()
        WHERE id = ${person.inboundLeadId}::uuid
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(comms_log, '[]'::jsonb)) item WHERE item->>'id' = ${conv.id})`;
    }

    return NextResponse.json({
      ok: true,
      conversation: { id: conv.id, type: conv.type, text: conv.text, meta: ["outbound", now.toISOString()].join(" · "), author: admin.fullName, ts: now.toISOString() },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    console.error("Renters v3 conversation error:", msg);
    return NextResponse.json({ error: "Failed to log" }, { status: 500 });
  }
}
