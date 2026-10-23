import { prisma } from "@/lib/prisma";

// Append-only restriction/recovery history for an account. `restrictedAt` only ever
// holds the CURRENT open restriction (wiped on recover), so the log is the record of
// every time an account was restricted or recovered. Both the pipeline and the
// inventory views write through this one helper, so the history is shared, not
// duplicated per surface.
// Snapshot of the proxy the account was on AT THE MOMENT of the event. Stamped on
// every "restricted" event so we can later attribute restrictions to a proxy/IP/geo
// without guessing (proxy assignment itself isn't timestamped elsewhere).
export type RestrictionProxy = {
  host: string | null;
  port: number | null;
  provider?: string | null;
  type?: string | null;       // residential | datacenter | mobile
  country?: string | null;    // verified egress country at the time (ISO2), for geo-jump detection
};

export type RestrictionEvent = {
  at: string;
  event: "restricted" | "recovered";
  note?: string;
  creditedDays?: number;
  proxy?: RestrictionProxy;
};

// Read the account's current proxy (host:port) and enrich it from the proxies table
// (provider/type/verified country). Best-effort: returns null only if no proxy is set,
// and still returns host:port when the proxies table has no matching row.
async function snapshotProxy(accountId: string): Promise<RestrictionProxy | null> {
  const a = await prisma.linkedInAccount.findUnique({
    where: { id: accountId },
    select: { proxyHost: true, proxyPort: true },
  });
  if (!a || !a.proxyHost) return null;
  const p =
    a.proxyPort != null
      ? await prisma.proxy.findUnique({
          where: { host_port: { host: a.proxyHost, port: a.proxyPort } },
          select: { provider: true, type: true, verifiedCountry: true },
        })
      : null;
  return {
    host: a.proxyHost,
    port: a.proxyPort ?? null,
    provider: p?.provider ?? null,
    type: p?.type ?? null,
    country: p?.verifiedCountry ?? null,
  };
}

type RestrictionAccount = {
  id: string;
  restrictedAt: Date | null;
  restrictionLog: unknown;
};

// Compute the account fields to write for a restrict (true) or recover (false) action,
// appending the event to the shared log. On recover, credit an active rental's downtime
// by extending its currentPeriodEnd (a side effect done here). Returns only the account
// fields to merge into a linkedInAccount update — the caller performs the write.
export async function restrictionUpdate(
  account: RestrictionAccount,
  restrict: boolean,
  note?: string,
): Promise<{ restrictedAt: Date | null; restrictionLog?: RestrictionEvent[]; creditedDays?: number }> {
  const log: RestrictionEvent[] = Array.isArray(account.restrictionLog)
    ? (account.restrictionLog as RestrictionEvent[])
    : [];
  const trimmed = note?.trim() || "";

  if (restrict) {
    // Already restricted → keep the original open timestamp and log nothing (no dupes).
    if (account.restrictedAt) return { restrictedAt: account.restrictedAt };
    const at = new Date();
    const proxy = await snapshotProxy(account.id);
    return {
      restrictedAt: at,
      restrictionLog: [
        ...log,
        { at: at.toISOString(), event: "restricted", ...(trimmed ? { note: trimmed } : {}), ...(proxy ? { proxy } : {}) },
      ],
    };
  }

  // Recover: nothing to do if it wasn't restricted.
  if (!account.restrictedAt) return { restrictedAt: null };
  let creditedDays = 0;
  const downtimeMs = Date.now() - new Date(account.restrictedAt).getTime();
  const active = await prisma.rental.findFirst({
    where: { linkedinAccountId: account.id, status: { in: ["active", "pending_access"] } },
  });
  if (active?.currentPeriodEnd && downtimeMs > 0) {
    const extended = new Date(new Date(active.currentPeriodEnd).getTime() + downtimeMs);
    creditedDays = Math.round(downtimeMs / 86400000);
    // Also bank the credited days on the rental so the dashboard can show the applied figure
    // (cause-agnostic running total), not just the live "accruing" estimate.
    await prisma.rental.update({
      where: { id: active.id },
      data: { currentPeriodEnd: extended, downtimeCreditDays: { increment: creditedDays } },
    });
  }
  return {
    restrictedAt: null,
    restrictionLog: [
      ...log,
      { at: new Date().toISOString(), event: "recovered", ...(trimmed ? { note: trimmed } : {}), ...(creditedDays ? { creditedDays } : {}) },
    ],
    creditedDays,
  };
}

// Restriction can be flagged on an application (accountIssue free-text) BEFORE an account
// exists — that's the only place to record it for an account-less lead. These helpers move
// that flag onto the account once one is linked, so the account stays the single source of
// truth. "permanent" issues mean retired, handled separately, so they don't count here.
export function appIssueIsRestricted(accountIssue?: string | null): boolean {
  const s = (accountIssue || "").toLowerCase();
  return s.includes("restrict") && !s.includes("permanent");
}

// When an account becomes linked to an application, carry a pending pipeline-side
// restriction flag onto the account (logging it), then clear the keyword from the
// application so the two views agree. Safe to call whenever an account is created/linked:
// it no-ops if the app isn't flagged or the account is already restricted. Pass a tx-bound
// client (or the default prisma) so it can run inside the caller's transaction.
export async function carryAppRestrictionToAccount(
  accountId: string,
  app: { id: string; accountIssue: string | null } | null | undefined,
  db: { linkedInAccount: typeof prisma.linkedInAccount; ambassadorApplication: typeof prisma.ambassadorApplication } = prisma,
): Promise<boolean> {
  if (!app || !appIssueIsRestricted(app.accountIssue)) return false;
  const acct = await db.linkedInAccount.findUnique({
    where: { id: accountId },
    select: { id: true, restrictedAt: true, restrictionLog: true },
  });
  if (!acct || acct.restrictedAt) return false; // no account, or already restricted → nothing to carry
  const fields = await restrictionUpdate(acct, true, "Carried over from pipeline restriction flag");
  await db.linkedInAccount.update({
    where: { id: accountId },
    data: { restrictedAt: fields.restrictedAt, ...(fields.restrictionLog ? { restrictionLog: fields.restrictionLog } : {}) },
  });
  // Remove the restriction keyword from the app now that the account owns the state.
  await db.ambassadorApplication.update({ where: { id: app.id }, data: { accountIssue: null } });
  return true;
}
