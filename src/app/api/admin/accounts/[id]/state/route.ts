import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import type { RestrictionEvent } from "@/lib/restriction";
import { tokenForAccount, getPublicShareLink, deletePublicShareLink } from "@/services/gologin";

// Status-strip state changes that aren't a restrict/recover (those go through /restricted so the
// downtime-credit + billing-paused logic stays in one place). Handles:
//   perm        → permanently restricted / retired
//   returned    → owner took the account back, comms clear (off-market, unavailable)
//   access_lost → owner cut off our access. Off-market AND, since the account is gone: holds the
//                 owner payout, frees the proxy from the account, and revokes the GoLogin public
//                 share link (seat freed). The provider subscription is NOT touched.
//   clear       → undo perm/returned/access_lost back toward active (also releases the payout hold;
//                 caller then lists it via the gated PATCH)
// Every change is written to the account's restriction history with who + when.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const { state } = (await req.json()) as { state?: string };
    const who = admin.fullName || admin.email;
    const account = await prisma.linkedInAccount.findUnique({
      where: { id },
      select: { restrictionLog: true, gologinProfileId: true, gologinAccount: true },
    });
    if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });

    const log: RestrictionEvent[] = Array.isArray(account.restrictionLog) ? (account.restrictionLog as RestrictionEvent[]) : [];
    const at = new Date().toISOString();
    const append = (event: "restricted" | "recovered", note: string) => [...log, { at, event, note } as RestrictionEvent];

    let data: Record<string, unknown>;
    if (state === "perm") {
      data = { permanentlyRestricted: true, status: "retired", restrictionLog: append("restricted", `Perm. restricted · set by ${who}`) };
    } else if (state === "returned") {
      // Owner took the account back, communication clear. Off-market but reversible; benign — no
      // payout hold / proxy / GoLogin side effects (clean handover).
      data = { status: "unavailable", listed: false, exitReason: "returned", restrictionLog: append("recovered", `Returned to owner (comms clear) · set by ${who}`) };
    } else if (state === "access_lost") {
      // Owner cut off our access — the account is effectively gone to us. Best-effort revoke the
      // GoLogin public share link first (frees the seat; prod has the token). Never block the
      // status change on a GoLogin hiccup.
      if (account.gologinProfileId) {
        try {
          const token = tokenForAccount(account.gologinAccount);
          const existing = await getPublicShareLink(account.gologinProfileId, undefined, token);
          if (existing) await deletePublicShareLink(existing.linkId, account.gologinProfileId, token);
        } catch (e) { console.error("access_lost: GoLogin share revoke failed (continuing)", e); }
      }
      data = {
        status: "unavailable",
        listed: false,
        exitReason: "access_lost",
        // Hold the owner payout (drops them out of the Payouts II "due" chase until cleared).
        payoutHoldReason: "Access removed by owner",
        payoutHeldAt: new Date(),
        // Free the proxy from this account so it can be reassigned (provider sub untouched).
        proxyHost: null, proxyPort: null, proxyUsername: null, proxyPassword: null,
        // GoLogin public share link revoked above — clear the stored URL.
        gologinShareLink: null,
        restrictionLog: append("restricted", `Access removed by owner · set by ${who} — payout held, proxy freed, GoLogin share revoked`),
      };
    } else if (state === "clear") {
      // Undo perm/returned/access_lost and release any payout hold. Leaves status "unavailable"
      // (not listed) — caller lists it with the gated PATCH → available once rental-ready passes.
      // Does NOT restore a freed proxy / revoked GoLogin link (reactivating re-provisions those).
      data = { permanentlyRestricted: false, exitReason: null, status: "unavailable", payoutHoldReason: null, payoutHeldAt: null, linkedinAccountHealth: "active", healthCheckedAt: new Date(), restrictionLog: append("recovered", `Marked active by ${who}`) };
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
