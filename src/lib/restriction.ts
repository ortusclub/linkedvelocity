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
  // Context snapshotted at the MOMENT of a "restricted" event (best-effort current state then), so
  // the analysis dashboard can attribute a restriction by domain / renter / age / connections /
  // location without relying on mutable current state. Cause is deliberately NOT here: it usually
  // arrives later via a LinkedIn email (and ~92% of restrictions have no email at all), so it's
  // enriched afterward from captured mail, not stamped on the spot.
  domain?: string | null;       // login (or work) email domain
  renter?: string | null;       // active/pending renter label (company → name → email)
  ageMonths?: number | null;
  connections?: number | null;
  location?: string | null;     // the account's profile location
  verified?: boolean | null;
  acctStatus?: string | null;   // account status at the time (rented / under_construction / …)
};

// Snapshot the account's context at the moment of a restriction: proxy (host/geo, enriched from the
// proxies table), login-email domain, the active renter, age, connection count, profile location,
// verified + status. Best-effort — any field we can't read is simply omitted. This is what lets the
// restriction dashboard attribute by point-in-time facts instead of mutable current state.
async function snapshotContext(accountId: string): Promise<Partial<RestrictionEvent>> {
  const a = await prisma.linkedInAccount.findUnique({
    where: { id: accountId },
    select: {
      proxyHost: true, proxyPort: true, loginEmail: true, workEmail: true,
      accountAgeMonths: true, connectionCount: true, linkedinVerified: true, location: true, status: true,
    },
  });
  if (!a) return {};
  let proxy: RestrictionProxy | undefined;
  if (a.proxyHost) {
    const p =
      a.proxyPort != null
        ? await prisma.proxy.findUnique({
            where: { host_port: { host: a.proxyHost, port: a.proxyPort } },
            select: { provider: true, type: true, verifiedCountry: true },
          })
        : null;
    proxy = { host: a.proxyHost, port: a.proxyPort ?? null, provider: p?.provider ?? null, type: p?.type ?? null, country: p?.verifiedCountry ?? null };
  }
  const rental = await prisma.rental.findFirst({
    where: { linkedinAccountId: accountId, status: { in: ["active", "pending_access"] } },
    orderBy: { startDate: "desc" },
    select: { user: { select: { email: true, company: true, fullName: true } } },
  });
  const renter = rental?.user ? (rental.user.company || rental.user.fullName || rental.user.email || null) : null;
  const email = (a.loginEmail || a.workEmail || "").toLowerCase();
  const domain = email.includes("@") ? email.split("@")[1] || null : null;
  return {
    ...(proxy ? { proxy } : {}),
    domain,
    renter,
    ageMonths: a.accountAgeMonths ?? null,
    connections: a.connectionCount ?? null,
    location: a.location ?? null,
    verified: a.linkedinVerified ?? null,
    acctStatus: a.status ?? null,
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
//
// `applyCredit` (default true) controls whether recover extends the rental here and now. The
// restrictions-v2 case flow passes false: recovery (LinkedIn restoring the account) does NOT yet
// make it usable for the renter — we still reset the password and re-establish the GoLogin login
// first — so that flow defers the downtime credit until hand-back (see the recovery-case route),
// measuring the full restriction→handback window. The old inventory/pipeline toggle, which has no
// hand-back step, keeps crediting at recovery (default).
export async function restrictionUpdate(
  account: RestrictionAccount,
  restrict: boolean,
  note?: string,
  applyCredit = true,
): Promise<{ restrictedAt: Date | null; restrictionLog?: RestrictionEvent[]; creditedDays?: number }> {
  const log: RestrictionEvent[] = Array.isArray(account.restrictionLog)
    ? (account.restrictionLog as RestrictionEvent[])
    : [];
  const trimmed = note?.trim() || "";

  if (restrict) {
    // Already restricted → keep the original open timestamp and log nothing (no dupes).
    if (account.restrictedAt) return { restrictedAt: account.restrictedAt };
    const at = new Date();
    const snap = await snapshotContext(account.id);
    return {
      restrictedAt: at,
      restrictionLog: [
        ...log,
        { at: at.toISOString(), event: "restricted", ...(trimmed ? { note: trimmed } : {}), ...snap },
      ],
    };
  }

  // Recover: nothing to do if it wasn't restricted.
  if (!account.restrictedAt) return { restrictedAt: null };
  let creditedDays = 0;
  if (applyCredit) {
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
