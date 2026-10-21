import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { createAccountCodeLink } from "@/lib/account-code-link";

export const runtime = "nodejs";

// Admin: attach a LinkedIn in-app verification QR (screenshot, usually pasted from the GoLogin
// session) to a restricted account, and get back the owner-facing /recover link to relay. The
// owner opens that link on their phone and scans the QR — no email-instruction parsing needed.
// Body: { image: "data:image/png;base64,…" }. Returns { qrUrl, ownerLink }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const image: unknown = body?.image;
    const m = typeof image === "string" ? image.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/) : null;
    if (!m) return NextResponse.json({ error: "Paste or upload a QR image (PNG/JPG)." }, { status: 400 });
    const buf = Buffer.from(m[2], "base64");
    if (buf.length === 0 || buf.length > 5_000_000) return NextResponse.json({ error: "Image must be under 5 MB." }, { status: 413 });

    const account = await prisma.linkedInAccount.findUnique({ where: { id }, select: { id: true } });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const contentType = m[1];
    const ext = contentType.split("/")[1].replace("jpeg", "jpg");
    const blob = await put(`recovery-qr-${uuid()}.${ext}`, buf, { access: "public", contentType });
    await prisma.linkedInAccount.update({ where: { id }, data: { recoveryQrUrl: blob.url, recoveryQrAt: new Date() } });

    const ownerLink = await createAccountCodeLink(id).catch(() => "");
    return NextResponse.json({ qrUrl: blob.url, ownerLink: ownerLink.replace("/c#", "/recover#") });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}

// Admin: mark the owner recovery link as sent/shared. Fired when the team hits a
// Copy/WhatsApp/Telegram/Viber/Email send action in /admin/recover, so the card shows "Sent via
// X" and we can tell apart "not sent yet" from "sent, awaiting the owner". Body: { via }.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const via = typeof body?.via === "string" && body.via.length <= 20 ? body.via : "link";
    const account = await prisma.linkedInAccount.findUnique({ where: { id }, select: { id: true } });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    await prisma.linkedInAccount.update({ where: { id }, data: { recoverySentAt: new Date(), recoverySentVia: via } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}

// Admin: clear a stale QR once recovery is done (or to re-capture a fresh one).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    await prisma.linkedInAccount.update({ where: { id }, data: { recoveryQrUrl: null, recoveryQrAt: null } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}
