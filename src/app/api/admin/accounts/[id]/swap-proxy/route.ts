import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { swapNonRentedProxy } from "@/lib/fix-account-proxy";

// Admin / ambassador-support: self-serve proxy swap for a NON-RENTED account. Picks a fresh
// geo-matched proxy by persona country, verifies it for real (live egress + LinkedIn answers)
// and retries through several candidates so one bad proxy doesn't dead-end. Refuses outright
// if the account is currently rented — that path belongs to the renter's own "fix my proxy".
// No body. Returns the new proxy host:port and how many candidates it tried on success.
//
// Auth: an admin session OR the shared CRON_SECRET bearer, so support tooling (a script run
// by an ambassador-support assistant) can trigger it without the GoLogin/DB creds — those stay
// server-side. The verify+retry loop makes several live probes, hence the extended duration.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const bearer = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
    if (!bearer) await requireAdmin();
    const { id } = await params;
    const result = await swapNonRentedProxy(id);

    if (result.outcome === "rented") {
      return NextResponse.json(
        { error: "This account is rented — use the renter's Fix proxy flow, not the self-serve swap." },
        { status: 409 },
      );
    }
    if (result.outcome === "no_proxy") {
      return NextResponse.json(
        { error: "No free proxy in this account's country — add capacity, then retry." },
        { status: 409 },
      );
    }
    if (result.outcome === "verify_failed") {
      return NextResponse.json(
        { error: "Tried several proxies and none passed the live LinkedIn check — add clean capacity in this country." },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      proxyHost: result.newProxyHost,
      proxyPort: result.newProxyPort,
      tried: result.tried,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const code = msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : msg === "Account not found" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
