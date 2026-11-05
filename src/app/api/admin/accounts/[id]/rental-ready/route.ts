import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { RENTAL_READY_ITEMS, RENTAL_READY_OPTIONAL, rentalReadyStatus, type ChecklistState } from "@/lib/rental-ready";

const KNOWN = new Set([...RENTAL_READY_ITEMS, ...RENTAL_READY_OPTIONAL].map((i) => i.key));

// Toggle one rental-ready checklist item. Merges into the account's JSON with who/when.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    // One item (key) or several at once (keys) — the "mark housekeeping done & list" one-tap sends keys.
    const { key, keys, done } = (await req.json()) as { key?: string; keys?: string[]; done?: boolean };
    const toSet = Array.isArray(keys) && keys.length ? keys : key ? [key] : [];
    if (!toSet.length || toSet.some((k) => !KNOWN.has(k))) return NextResponse.json({ error: "unknown item" }, { status: 400 });

    const acc = await prisma.linkedInAccount.findUnique({
      where: { id },
      select: { rentalReadyChecklist: true, restrictedAt: true, permanentlyRestricted: true, twoFactorResetNeeded: true, proxyHost: true },
    });
    if (!acc) return NextResponse.json({ error: "not found" }, { status: 404 });

    const checklist: ChecklistState = { ...((acc.rentalReadyChecklist as ChecklistState) || {}) };
    const stamp = done ? { done: true, by: admin.fullName || admin.email, at: new Date().toISOString() } : { done: false };
    for (const k of toSet) checklist[k] = stamp;

    await prisma.linkedInAccount.update({ where: { id }, data: { rentalReadyChecklist: checklist } });
    const shareRows = await prisma.rental.findMany({ where: { linkedinAccountId: id }, select: { gologinShareIds: true } });
    const gologinShared = shareRows.some((rr) => Array.isArray(rr.gologinShareIds) && (rr.gologinShareIds as unknown[]).length > 0);
    const status = rentalReadyStatus({ ...acc, gologinShared }, checklist);
    return NextResponse.json({ checklist, ...status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const code = msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
