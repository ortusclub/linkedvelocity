import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ackPayoutChange } from "@/lib/payout-change";
import type { Prisma } from "@/generated/prisma/client";

// Mark a payee's "payout method changed" flag as verified. Clears the flag on the payouts
// console (keeps the change history, just stamps ackedAt/ackedBy). Moves no money.
//
// payeeKey mirrors the unified feed: "ref:<slug>" for a referrer, "amb:<email>" for an owner.
// An owner email can have more than one application, so every matching app with a pending
// change is acked.

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const who = admin.fullName || admin.email || "admin";
    const { payeeKey } = await req.json().catch(() => ({}));
    if (typeof payeeKey !== "string" || !payeeKey.trim()) {
      return NextResponse.json({ error: "payeeKey required" }, { status: 400 });
    }

    if (payeeKey.startsWith("ref:")) {
      const slug = payeeKey.slice(4);
      const ref = await prisma.referrer.findFirst({ where: { slug: { equals: slug, mode: "insensitive" } }, select: { id: true, payoutChange: true } });
      const acked = ref && ackPayoutChange(ref.payoutChange, who);
      if (ref && acked) await prisma.referrer.update({ where: { id: ref.id }, data: { payoutChange: acked as unknown as Prisma.InputJsonValue } });
      return NextResponse.json({ ok: true, acked: !!acked });
    }

    if (payeeKey.startsWith("amb:")) {
      const email = payeeKey.slice(4);
      const apps = await prisma.ambassadorApplication.findMany({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, payoutChange: true } });
      let count = 0;
      for (const a of apps) {
        const acked = ackPayoutChange(a.payoutChange, who);
        if (acked) { await prisma.ambassadorApplication.update({ where: { id: a.id }, data: { payoutChange: acked as unknown as Prisma.InputJsonValue } }); count++; }
      }
      return NextResponse.json({ ok: true, acked: count > 0 });
    }

    return NextResponse.json({ error: "Unknown payeeKey" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
