import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { wiseStatus, WiseError } from "@/services/wise";

// Connectivity check for the Wise payout link. Confirms WISE_API_TOKEN_FULL authenticates
// and names the business profile. Read-only (GET /profiles) — moves no money.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    if (!process.env.WISE_API_TOKEN_FULL) {
      return NextResponse.json({ connected: false, reason: "no_token", message: "WISE_API_TOKEN_FULL is not set in the environment." });
    }
    const status = await wiseStatus();
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof WiseError) {
      return NextResponse.json({ connected: false, reason: error.code, message: error.message });
    }
    return NextResponse.json({ connected: false, reason: "error", message: "Unexpected error checking Wise." });
  }
}
