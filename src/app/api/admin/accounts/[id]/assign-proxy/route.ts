import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { assignProxyToAccount } from "@/lib/fix-account-proxy";

// Admin: assign a fresh, geo-matched proxy to an account on demand — the recovery-side
// companion to the proxy-reclaim cron. Used from the restrictions page "Assign proxy"
// button when an account whose proxy was reclaimed (or died) is being recovered.
// No body. Returns the assign outcome + the new proxy host:port on success.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const result = await assignProxyToAccount(id);
    if (result.outcome === "no_proxy") {
      return NextResponse.json(
        { error: "No free proxy in this account's country — add capacity, then retry." },
        { status: 409 },
      );
    }
    if (result.outcome === "verify_failed") {
      return NextResponse.json(
        { error: "Picked a proxy but it failed the live check — try again." },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      proxyHost: result.newProxyHost,
      proxyPort: result.newProxyPort,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const code = msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : msg === "Account not found" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
