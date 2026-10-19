import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { summariseComms, hasAnthropicKey, type CommEntry } from "@/lib/crm-summary";

// POST { leadId, force? } → { summary, cached, at }
// Returns the cached comms summary when it's newer than the latest touchpoint;
// otherwise regenerates with Claude, stores it on the lead, and returns it.
export async function POST(req: Request) {
  try {
    await requireAdmin();
    if (!hasAnthropicKey()) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured on the server." }, { status: 503 });
    }
    const { leadId, force } = await req.json();
    if (!leadId) return NextResponse.json({ error: "Missing leadId" }, { status: 400 });

    const lead = await prisma.inboundLead.findUnique({
      where: { id: leadId },
      select: { id: true, name: true, company: true, type: true, commsLog: true, commsSummary: true, commsSummaryAt: true, lastContactAt: true },
    });
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const fresh = lead.commsSummary && lead.commsSummaryAt && lead.commsSummaryAt >= lead.lastContactAt;
    if (fresh && !force) {
      return NextResponse.json({ summary: lead.commsSummary, cached: true, at: lead.commsSummaryAt });
    }

    const entries = (Array.isArray(lead.commsLog) ? lead.commsLog : []) as CommEntry[];
    const summary = await summariseComms({ name: lead.name, company: lead.company, type: lead.type, entries });
    const at = new Date();
    await prisma.inboundLead.update({ where: { id: lead.id }, data: { commsSummary: summary || null, commsSummaryAt: at } });

    return NextResponse.json({ summary, cached: false, at });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") {
      return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    }
    console.error("CRM summarise error:", msg);
    return NextResponse.json({ error: "Failed to summarise" }, { status: 500 });
  }
}
