import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getUnifiedPayouts } from "@/lib/payouts-unified";

// Unified payouts feed for the merged /admin/payouts console. One normalized list of
// everyone owed (referral + setup + monthly) plus the per-payee directory with merged
// history. Account details are masked here — the client never needs the raw number; the
// Wise prepare/send routes read the unmasked value server-side from the same store.

export const dynamic = "force-dynamic";

function maskDetail(details: string | null): string | null {
  if (!details) return null;
  const d = details.trim();
  if (!d) return null;
  if (d.includes("@")) {
    const [user, domain] = d.split("@");
    return `${user.slice(0, 3)}•••@${domain}`;
  }
  const digits = d.replace(/\D/g, "");
  if (digits.length >= 4) return `•••• ${digits.slice(-4)}`;
  return "••••";
}

export async function GET() {
  try {
    await requireAdmin();
    const { ready, payees } = await getUnifiedPayouts();

    // Strip raw account details; expose only the masked form to the client.
    const readyOut = ready.map(({ details, ...r }) => ({ ...r, masked: maskDetail(details) }));
    const payeesOut = payees.map(({ details, ...p }) => ({ ...p, masked: maskDetail(details) }));

    // Whether live Wise sending is switched on (full-access token present). Until then the
    // console renders the Send buttons but keeps them inert.
    const wiseEnabled = !!process.env.WISE_API_TOKEN_FULL;

    return NextResponse.json({ ready: readyOut, payees: payeesOut, wiseEnabled });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
