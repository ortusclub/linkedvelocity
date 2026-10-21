import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { buildCase, deriveCase, matchApp, notesSaysPerma, type CaseAccount } from "@/lib/recovery-case";
import type { RestrictionEvent } from "@/lib/restriction";

export const dynamic = "force-dynamic";

// Restrictions v2 — the case list. Returns every account that's currently restricted or was
// recovered in the last 30 days, each with its built recovery case (reason + chain steps), the
// auto-computed next step / triage bucket / flags, the renter impacted, and its restriction
// history. The page renders these and drives actions through the recovery-case / recover-send /
// recovery-qr routes.
const RECOVERED_WINDOW_MS = 30 * 86400000;

const asLog = (v: unknown): RestrictionEvent[] => (Array.isArray(v) ? (v as RestrictionEvent[]) : []);
const dayMs = 86400000;

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const staleDays = Math.min(30, Math.max(1, Number(url.searchParams.get("staleDays")) || 7));
    const ownerSilentHours = Math.min(168, Math.max(6, Number(url.searchParams.get("ownerSilentHours")) || 48));
    const now = Date.now();

    const accounts = await prisma.linkedInAccount.findMany({
      where: { status: { not: "removed" } },
      select: {
        id: true, linkedinName: true, loginEmail: true, status: true, linkedinVerified: true, poc: true,
        linkedinUrl: true, notes: true,
        restrictedAt: true, restrictionLog: true,
        recoveryQrUrl: true, recoveryQrAt: true, recoverySentAt: true, recoverySentVia: true,
        recoveryOutcome: true, recoveryOutcomeAt: true, recoveryCase: true,
      },
      orderBy: { restrictedAt: "desc" },
    });

    // Link each account to its application the way inventory/onboarding do, to borrow the PoC,
    // the pipeline issue flag and the owner's self-report.
    const apps = await prisma.ambassadorApplication.findMany({ select: { id: true, email: true, linkedinUrl: true, poc: true, accountIssue: true, restrictionReport: true } });
    const appByAccount = new Map<string, (typeof apps)[number]>();
    for (const a of accounts) { const app = matchApp(apps, a); if (app) appByAccount.set(a.id, app); }

    const permaFromSignals = (a: (typeof accounts)[number]) => {
      const app = appByAccount.get(a.id);
      const logRestricted = asLog(a.restrictionLog).some((e) => e.event === "restricted");
      const issue = app?.accountIssue || "";
      if (/permanent/i.test(issue)) return true;
      if (a.status === "retired" && (logRestricted || /restrict/i.test(issue) || notesSaysPerma(a.notes))) return true;
      return !!notesSaysPerma(a.notes);
    };

    // Keep accounts with an open restriction, a recent recovery, or a permanently-restricted signal.
    const relevant = accounts.filter((a) => {
      if (a.restrictedAt) return true;
      const rec = [...asLog(a.restrictionLog)].reverse().find((e) => e.event === "recovered");
      if (rec && now - Date.parse(rec.at) <= RECOVERED_WINDOW_MS) return true;
      return permaFromSignals(a);
    });

    // Resolve the renter impacted (active rental's user) for the flag.
    const ids = relevant.map((a) => a.id);
    const rentals = ids.length
      ? await prisma.rental.findMany({
          where: { linkedinAccountId: { in: ids }, status: { in: ["active", "pending_access"] } },
          select: { linkedinAccountId: true, user: { select: { company: true, fullName: true } } },
        })
      : [];
    const renterByAccount = new Map<string, string>();
    for (const r of rentals) {
      const label = r.user?.company || r.user?.fullName || "";
      if (label && !renterByAccount.has(r.linkedinAccountId)) renterByAccount.set(r.linkedinAccountId, label);
    }

    // A restriction email logged in the shared outreach trail (the pipeline Issue email).
    const matchedIds = [...new Set(relevant.map((a) => appByAccount.get(a.id)?.id).filter((x): x is string => !!x))];
    const outreach = matchedIds.length
      ? await prisma.ambassadorApplication.findMany({ where: { id: { in: matchedIds } }, select: { id: true, outreachLog: true } })
      : [];
    const outreachById = new Map(outreach.map((o) => [o.id, o]));
    const outreachEmailAtFor = (appId?: string) => {
      const log = appId ? (Array.isArray(outreachById.get(appId)?.outreachLog) ? (outreachById.get(appId)!.outreachLog as Array<{ ch?: string; text?: string; at?: string }>) : []) : [];
      const t = log.filter((x) => x.ch === "email" && /restrict/i.test(x.text || "") && x.at).sort((x, y) => Date.parse(x.at!) - Date.parse(y.at!))[0];
      return t?.at || null;
    };

    const rows = relevant.map((a) => {
      const app = appByAccount.get(a.id);
      const pocResolved = app?.poc || a.poc || "";
      const acct: CaseAccount = {
        ...a, renterName: renterByAccount.get(a.id) || null, poc: pocResolved,
        accountIssue: app?.accountIssue || null,
        restrictionReport: (app?.restrictionReport as { type?: "qr_done" | "recovered"; at?: string } | null) || null,
        outreachEmailAt: outreachEmailAtFor(app?.id),
      };
      const built = buildCase(acct);
      const d = deriveCase(acct, built, { now, staleDays, ownerSilentHours });

      // Restriction history: pair restricted→recovered events from the log (newest first).
      const log = asLog(a.restrictionLog);
      const history: Array<{ reason: string; days: number; at: string; how: string; open: boolean }> = [];
      let openStart: RestrictionEvent | null = null;
      for (const e of log) {
        if (e.event === "restricted") openStart = e;
        else if (e.event === "recovered" && openStart) {
          history.push({
            reason: openStart.note || "Restriction",
            days: Math.max(0, Math.round((Date.parse(e.at) - Date.parse(openStart.at)) / dayMs)),
            at: openStart.at, how: e.note || (e.creditedDays ? `Recovered (+${e.creditedDays}d credit)` : "Recovered"), open: false,
          });
          openStart = null;
        }
      }
      const curAt = a.restrictedAt ? (typeof a.restrictedAt === "string" ? a.restrictedAt : a.restrictedAt.toISOString())
        : (d.lostOutcome ? [...log].reverse().find((e) => e.event === "restricted")?.at || null : null);
      if (curAt) history.push({ reason: built.reason, days: Math.round(d.restrictedMs / dayMs), at: curAt, how: d.lostOutcome ? (d.lostOutcome === "perma" ? "Perma-restricted" : "No contact") : "Open", open: true });
      history.reverse();

      return {
        id: a.id, name: a.linkedinName, email: a.loginEmail, status: a.status, verified: a.linkedinVerified,
        poc: pocResolved, phase: d.phase,
        restrictedAt: a.restrictedAt, reason: built.reason, steps: built.steps,
        next: d.next, urgent: d.urgent, bucket: d.bucket, cnt: d.cnt, restrictedMs: d.restrictedMs,
        resolvedAt: d.resolvedAt, closedAt: d.closedAt, lostOutcome: d.lostOutcome, lastErr: d.lastErr, flags: d.flags, chain: d.chain,
        renterName: renterByAccount.get(a.id) || null,
        qrUrl: a.recoveryQrUrl, qrAt: a.recoveryQrAt, sentAt: a.recoverySentAt, sentVia: a.recoverySentVia,
        outcome: a.recoveryOutcome, history,
      };
    });

    return NextResponse.json({ rows, now, staleDays, ownerSilentHours });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}
