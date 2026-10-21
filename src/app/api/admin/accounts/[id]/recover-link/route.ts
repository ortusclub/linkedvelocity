import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAccountCodeLink } from "@/lib/account-code-link";
import { formatName } from "@/lib/utils";

// Admin: mint the private /recover link for MANUAL sharing (Copy / WhatsApp / Telegram / Viber),
// as opposed to emailing it (that's recover-send). Returns the link so the admin can relay it on
// the channel the owner actually uses. When a `via` app channel is given (the one-tap buttons,
// not a bare copy) we also stamp it as sent, so the case stops reading "not sent yet" — fixing the
// trap where relaying by hand left no trace.
const VIA = new Set(["whatsapp", "telegram", "viber", "copy"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const via = typeof body.via === "string" && VIA.has(body.via) ? body.via : null;

    const account = await prisma.linkedInAccount.findUnique({
      where: { id },
      select: { linkedinName: true, recoveryQrUrl: true },
    });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    if (!account.recoveryQrUrl) return NextResponse.json({ error: "Attach a QR first — there's nothing to share yet." }, { status: 400 });

    const link = (await createAccountCodeLink(id)).replace("/c#", "/recover#");

    // A one-tap app send (not a bare copy) is a real hand-off — record it so the tracker reflects it.
    if (via && via !== "copy") {
      const entry = `[${new Date().toISOString()}] Shared recover QR link with owner via ${via}.`;
      await prisma.linkedInAccount.update({ where: { id }, data: { recoverySentAt: new Date(), recoverySentVia: via } });
      await prisma.$executeRaw`UPDATE linkedin_accounts SET notes = concat_ws(E'\n', nullif(notes, ''), ${entry}::text), updated_at = NOW() WHERE id = ${id}::uuid`;
    }

    return NextResponse.json({ link, name: formatName(account.linkedinName) || "your account", via });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}
