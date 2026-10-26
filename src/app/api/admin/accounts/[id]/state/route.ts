import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import type { RestrictionEvent } from "@/lib/restriction";

// Status-strip state changes that aren't a restrict/recover (those go through /restricted so the
// downtime-credit + billing-paused logic stays in one place). Handles:
//   perm        → permanently restricted / retired
//   returned    → owner took the account back, comms clear (off-market, unavailable)
//   access_lost → owner cut off our access (off-market, unavailable) — distinct from a clean return
//   clear       → undo perm/returned/access_lost back toward active (caller then lists it via the gated PATCH)
// Every change is written to the account's restriction history with who + when.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const { state } = (await req.json()) as { state?: string };
    const who = admin.fullName || admin.email;
    const account = await prisma.linkedInAccount.findUnique({ where: { id }, select: { restrictionLog: true } });
    if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });

    const log: RestrictionEvent[] = Array.isArray(account.restrictionLog) ? (account.restrictionLog as RestrictionEvent[]) : [];
    const at = new Date().toISOString();
    const append = (event: "restricted" | "recovered", note: string) => [...log, { at, event, note } as RestrictionEvent];

    let data: Record<string, unknown>;
    if (state === "perm") {
      data = { permanentlyRestricted: true, status: "retired", restrictionLog: append("restricted", `Perm. restricted · set by ${who}`) };
    } else if (state === "returned") {
      // Owner took the account back, communication clear. Off-market but reversible.
      data = { status: "unavailable", exitReason: "returned", restrictionLog: append("recovered", `Returned to owner (comms clear) · set by ${who}`) };
    } else if (state === "access_lost") {
      // Owner cut off our access — distinct from a clean return. Off-market, logged as a negative event.
      data = { status: "unavailable", exitReason: "access_lost", restrictionLog: append("restricted", `Access removed by owner · set by ${who}`) };
    } else if (state === "clear") {
      // Undo perm/returned/access_lost. Leaves status "unavailable" (not listed) — caller lists it with
      // the gated PATCH → available once rental-ready passes. healthCheckedAt bumped like Mark active.
      data = { permanentlyRestricted: false, exitReason: null, status: "unavailable", linkedinAccountHealth: "active", healthCheckedAt: new Date(), restrictionLog: append("recovered", `Marked active by ${who}`) };
    } else {
      return NextResponse.json({ error: "unknown state" }, { status: 400 });
    }

    await prisma.linkedInAccount.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const code = msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
