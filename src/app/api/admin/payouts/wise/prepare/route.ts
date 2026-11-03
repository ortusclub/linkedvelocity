import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createQuote, wiseSendUrl, WiseError } from "@/services/wise";

// Phase 1 of the prepare-then-tap Wise send: price the payout with a real Wise quote (moves
// no money, reserves nothing) and hand back a "Pay in Wise" link. The UK business account
// can't fund transfers via API, so the human finishes the payout in Wise. Recipient +
// transfer creation (so the link opens the exact pre-filled transfer) lands in phase 2.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requireAdmin();
    if (!process.env.WISE_API_TOKEN_FULL) {
      return NextResponse.json({ error: "Wise isn't connected (no token)." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount);
    const currency = typeof body.currency === "string" ? body.currency : "PHP";
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "A positive amount is required." }, { status: 400 });
    }
    const quote = await createQuote(amount, currency);
    return NextResponse.json({ ok: true, quote, payUrl: wiseSendUrl() });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof WiseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 502 });
    }
    return NextResponse.json({ error: "Couldn't prepare the payout." }, { status: 500 });
  }
}
