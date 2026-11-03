import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Mark a payee "checked before paying" — records the acknowledgement timestamp so the
// console suppresses its flags until a newer email / recovery lands. Moves no money.

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { payeeKey } = await req.json().catch(() => ({}));
    if (typeof payeeKey !== "string" || !payeeKey.trim()) {
      return NextResponse.json({ error: "payeeKey required" }, { status: 400 });
    }
    const checkedAt = new Date();
    await prisma.payoutOverride.upsert({
      where: { key: payeeKey },
      create: { key: payeeKey, checkedAt },
      update: { checkedAt },
    });
    return NextResponse.json({ ok: true, checkedAt: checkedAt.toISOString() });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
