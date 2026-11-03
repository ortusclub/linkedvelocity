import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Resume a paused payout — clears the pause so the row returns to its computed state.
// Keeps any checkedAt acknowledgement. Moves no money.

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { payeeKey } = await req.json().catch(() => ({}));
    if (typeof payeeKey !== "string" || !payeeKey.trim()) {
      return NextResponse.json({ error: "payeeKey required" }, { status: 400 });
    }
    // Clearing the reason/timestamp is enough — pauseFor() ignores pauseEmailed unless a
    // reason is set, so we leave that column (and any checkedAt) untouched.
    await prisma.payoutOverride.updateMany({
      where: { key: payeeKey },
      data: { pauseReason: null, pausedAt: null, pauseNote: null },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
