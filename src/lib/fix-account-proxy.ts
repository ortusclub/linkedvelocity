import { prisma } from "@/lib/prisma";
import * as gologin from "@/services/gologin";
import { pickAvailableProxy } from "@/lib/proxy-select";
import { testProxy } from "@/lib/proxy-verify";

// Mid-rental proxy swap for a RENTED account — the one thing provisionAccount deliberately
// refuses to do (it bails on status === "rented"). Safe because swapping a proxy is a PATCH
// on the GoLogin profile's proxy subresource: the profile id + name are untouched, so the
// renter's g.camp share link keeps working right through the swap (verified in gologin.ts —
// the link is keyed to profile id + name, never the proxy).
//
// Rollback discipline: we hold the old proxy creds, swap on the live profile, verify, and
// only write the new proxy to the DB once it passes. If anything fails we PATCH the old proxy
// back and leave the DB untouched — so the old proxy stays "occupied" (capacity is counted
// from account rows) and remains ours to revert to.
//
// v1 picks from our existing pool only; if nothing's free in-country it returns "no_proxy"
// and the caller escalates to the team (no automatic mid-rental purchase).

export type FixOutcome = "swapped" | "no_proxy" | "verify_failed";
export type FixResult = { outcome: FixOutcome; newProxyHost?: string; newProxyPort?: number };

// Assign a fresh, geo-matched proxy to an ACCOUNT (by account id) — the recovery-side
// companion to the proxy-reclaim cron. That cron releases proxies from long-dead
// restricted accounts so they stop hogging capacity; when we then decide to recover one,
// it has no proxy, and this gives it one on demand (one click from the restrictions page).
//
// Works whether or not the account currently has a proxy: a reclaimed account has none
// (just assign + verify), and an account on a dead proxy gets it swapped (exclude the old
// one, verify, roll back on failure). Only touches the GoLogin profile's proxy subresource
// and the DB proxy columns — profile id/name (and any share link) are untouched. Picks from
// our existing pool only; returns "no_proxy" when nothing free matches the geo (caller
// escalates — no automatic purchase).
export async function assignProxyToAccount(accountId: string): Promise<FixResult> {
  const acct = await prisma.linkedInAccount.findUnique({ where: { id: accountId } });
  if (!acct) throw new Error("Account not found");
  if (!acct.gologinProfileId) return { outcome: "no_proxy" };

  const profileId = acct.gologinProfileId;
  // Proxy PATCHes must use the token for the GoLogin account that hosts this profile:
  // the master token gets 401 on "klabber"-hosted profiles (and vice-versa).
  const token = gologin.tokenForAccount(acct.gologinAccount);
  const old = {
    host: acct.proxyHost,
    port: acct.proxyPort,
    username: acct.proxyUsername,
    password: acct.proxyPassword,
  };

  const exclude = old.host && old.port ? new Set([`${old.host}:${old.port}`]) : new Set<string>();
  const picked = await pickAvailableProxy({
    provider: "",
    type: "",
    country: acct.proxyLocation || acct.location,
    exclude,
  });
  if (!picked || !picked.username || !picked.password) return { outcome: "no_proxy" };

  const next = { host: picked.host, port: picked.port, username: picked.username, password: picked.password };
  await gologin.updateProxy(profileId, next, token);

  const probe = testProxy(next);
  if (!probe.ok) {
    // Roll back to the old proxy on the profile when there was one; leave the DB as-is.
    if (old.host && old.port) {
      try {
        await gologin.updateProxy(profileId, {
          host: old.host,
          port: old.port,
          username: old.username ?? undefined,
          password: old.password ?? undefined,
        }, token);
      } catch (e) {
        console.error("assignProxyToAccount: rollback PATCH failed", accountId, e instanceof Error ? e.message : e);
      }
    }
    return { outcome: "verify_failed" };
  }

  await prisma.linkedInAccount.update({
    where: { id: acct.id },
    data: {
      proxyHost: next.host,
      proxyPort: next.port,
      proxyUsername: next.username,
      proxyPassword: next.password,
      proxyLocation: picked.country ?? acct.proxyLocation,
    },
  });

  return { outcome: "swapped", newProxyHost: next.host, newProxyPort: next.port };
}

export async function fixAccountProxy(rentalId: string): Promise<FixResult> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: { linkedinAccount: true },
  });
  if (!rental) throw new Error("Rental not found");
  const acct = rental.linkedinAccount;

  // Nothing to swap on without a live profile → let the caller escalate.
  if (!acct.gologinProfileId) return { outcome: "no_proxy" };

  const profileId = acct.gologinProfileId;
  // Use the token for the GoLogin account that hosts this profile (see assignProxyToAccount).
  const token = gologin.tokenForAccount(acct.gologinAccount);
  const old = {
    host: acct.proxyHost,
    port: acct.proxyPort,
    username: acct.proxyUsername,
    password: acct.proxyPassword,
  };

  // Pick a different, free proxy in the account's geo. Exclude the current (dead) one.
  const exclude = old.host && old.port ? new Set([`${old.host}:${old.port}`]) : new Set<string>();
  const picked = await pickAvailableProxy({
    provider: "",
    type: "",
    country: acct.proxyLocation || acct.location,
    exclude,
  });
  if (!picked || !picked.username || !picked.password) return { outcome: "no_proxy" };

  const next = { host: picked.host, port: picked.port, username: picked.username, password: picked.password };

  // Swap on the LIVE profile (share link unaffected — see note above).
  await gologin.updateProxy(profileId, next, token);

  // Verify the new proxy is actually alive before we commit it to the DB.
  const probe = testProxy(next);
  if (!probe.ok) {
    // Roll back to the old proxy on the profile; leave the DB pointing at it.
    if (old.host && old.port) {
      try {
        await gologin.updateProxy(profileId, {
          host: old.host,
          port: old.port,
          username: old.username ?? undefined,
          password: old.password ?? undefined,
        }, token);
      } catch (e) {
        console.error("fixAccountProxy: rollback PATCH failed", rentalId, e instanceof Error ? e.message : e);
      }
    }
    return { outcome: "verify_failed" };
  }

  // Verified — persist the new proxy to the account (the pool Proxy row already exists;
  // pickAvailableProxy only returns proxies from getProxies()).
  await prisma.linkedInAccount.update({
    where: { id: acct.id },
    data: {
      proxyHost: next.host,
      proxyPort: next.port,
      proxyUsername: next.username,
      proxyPassword: next.password,
      proxyLocation: picked.country ?? acct.proxyLocation,
    },
  });

  return { outcome: "swapped", newProxyHost: next.host, newProxyPort: next.port };
}
