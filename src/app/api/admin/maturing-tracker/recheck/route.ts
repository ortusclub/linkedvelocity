import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { list, control } from "@/lib/maturing/service.mjs";

// "Re-check" from the tracker: the operator has re-logged-in a parked (needs_review)
// account and wants the engine to try again now. Finds this account's live campaigns on
// the engine and fires check-now on each — the same ⚡ the profile-maturing board does.
// If the login now works, the campaign moves off review and the ⚠️ flag clears on the next
// reconcile. Idempotent; a no-op campaign just reports already-running.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });

    const account = await prisma.linkedInAccount.findUnique({
      where: { id: accountId },
      select: { gologinProfileId: true, loginEmail: true },
    });
    if (!account?.gologinProfileId) return NextResponse.json({ error: "Account not found or has no browser profile" }, { status: 404 });

    const data = (await list()) as { campaigns: { id: string; status: string; profileIds: string[]; name?: string }[]; engineError?: string };
    if (data.engineError) return NextResponse.json({ error: data.engineError }, { status: 502 });

    const email = (account.loginEmail || "").toLowerCase();
    const LIVE = new Set(["needs_review", "monitoring", "running", "waiting_daily_reset", "scheduled"]);
    const targets = (data.campaigns || []).filter(
      (c) =>
        LIVE.has(c.status) &&
        ((c.profileIds || []).includes(account.gologinProfileId!) ||
          (c.name || "").trim().toLowerCase().replace(/\s*·\s*cold$/, "") === email),
    );
    if (!targets.length) return NextResponse.json({ ok: true, rechecked: 0, note: "No live campaign found to re-check." });

    const results = await Promise.allSettled(targets.map((c) => control(c.id, "check")));
    const rechecked = results.filter((r) => r.status === "fulfilled").length;
    return NextResponse.json({ ok: true, rechecked, total: targets.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Re-check failed.";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
