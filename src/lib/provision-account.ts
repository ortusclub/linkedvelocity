import { prisma } from "@/lib/prisma";
import * as gologin from "@/services/gologin";
import { findProfileByName } from "@/lib/gologin-match";
import { assignAutomaticProxy } from "@/lib/automatic-proxy";
import { pickAvailableProxy } from "@/lib/proxy-select";

// One-shot provisioning for an account that has a login email: ensure it has a
// GoLogin profile (link an existing one by name, else create), an assigned proxy
// (by tier + country + capacity), and a public g.camp share link — writing it all
// to the DB so /admin/pipeline + /admin/proxies reflect it. Idempotent: only fills
// what's missing. Called both by the account-save hook (instant) and the backstop
// cron. Reuses any eligible proxy, then purchases within the shared $100 budget.

export type ProvisionResult = {
  accountId: string;
  loginEmail: string | null;
  profile: "existing" | "linked" | "created" | "skipped";
  proxy: "existing" | "assigned" | "flagged" | "skipped";
  shareLink: "existing" | "created" | "skipped";
  provisionStatus: string | null;
  errors: string[];
};

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function provisionAccount(
  accountId: string,
  opts: { dryRun?: boolean; claimed?: Set<string> } = {}
): Promise<ProvisionResult> {
  const dryRun = !!opts.dryRun;
  const acct = await prisma.linkedInAccount.findUnique({ where: { id: accountId } });
  const res: ProvisionResult = {
    accountId,
    loginEmail: acct?.loginEmail ?? null,
    profile: "skipped",
    proxy: "skipped",
    shareLink: "skipped",
    provisionStatus: acct?.provisionStatus ?? null,
    errors: [],
  };
  if (!acct || !acct.loginEmail) return res; // nothing to key a profile on yet
  // Never touch a live rented account — a proxy/profile change mid-rental would
  // disrupt the renter. Provisioning is for onboarding-stage accounts only.
  if (acct.status === "rented") return res;

  const token = gologin.tokenForAccount(acct.gologinAccount) || undefined;
  let profileId = acct.gologinProfileId;

  // 1. Proxy FIRST — resolve the creds to use so a NEW profile can be created with a
  // proxy attached (GoLogin rejects create with a null proxy). Assign one of the right
  // tier/country if the account has none; else flag for a buy.
  let proxyCreds: { host: string; port: number; username: string | null; password: string | null } | null = null;
  let newlyAssigned = false;
  if (acct.proxyHost && acct.proxyPort) {
    proxyCreds = { host: acct.proxyHost, port: acct.proxyPort, username: acct.proxyUsername, password: acct.proxyPassword };
    res.proxy = "existing";
  } else {
    try {
      if (dryRun) {
        const picked = await pickAvailableProxy({ provider: "", type: "", country: acct.location, claimed: opts.claimed });
        res.proxy = picked ? "assigned" : "flagged";
        proxyCreds = picked;
      } else {
        const assigned = await assignAutomaticProxy(accountId);
        if (assigned.proxyHost && assigned.proxyPort) {
          proxyCreds = { host: assigned.proxyHost, port: assigned.proxyPort, username: assigned.proxyUsername, password: assigned.proxyPassword };
          newlyAssigned = true; res.proxy = "assigned"; res.provisionStatus = null;
        }
      }
    } catch (e) { res.proxy = "flagged"; res.errors.push(`proxy: ${msg(e)}`); }
  }
  // Never create an unprotected browser while proxy allocation is pending.
  if (!proxyCreds?.username || !proxyCreds.password) return res;

  const proxyForGologin =
    proxyCreds && proxyCreds.username && proxyCreds.password
      ? { host: proxyCreds.host, port: proxyCreds.port, username: proxyCreds.username, password: proxyCreds.password }
      : undefined;

  // 2. GoLogin profile — link an existing profile named with the login email, else
  // create it (with the resolved proxy attached). Push the proxy onto an existing
  // profile only when we just assigned a new one.
  if (!profileId) {
    try {
      const found = await findProfileByName(acct.loginEmail, token);
      if (found) {
        profileId = found.id;
        res.profile = "linked";
        if (!dryRun) {
          await prisma.linkedInAccount.update({ where: { id: accountId }, data: { gologinProfileId: profileId } });
          if (newlyAssigned && proxyForGologin) {
            try { await gologin.updateProxy(profileId, proxyForGologin, token); }
            catch (e) { res.errors.push(`gologin proxy push: ${msg(e)}`); }
          }
        }
      } else {
        res.profile = "created";
        if (!dryRun) {
          const created = await gologin.createProfile({ name: acct.loginEmail, proxy: proxyForGologin });
          profileId = (created as { id?: string } | null)?.id ?? null;
          if (profileId) await prisma.linkedInAccount.update({ where: { id: accountId }, data: { gologinProfileId: profileId } });
        }
      }
    } catch (e) {
      res.errors.push(`profile: ${msg(e)}`);
    }
  } else {
    res.profile = "existing";
    if (newlyAssigned && !dryRun && proxyForGologin) {
      try { await gologin.updateProxy(profileId, proxyForGologin, token); }
      catch (e) { res.errors.push(`gologin proxy push: ${msg(e)}`); }
    }
  }

  // 3. Public share link — reuse an existing one, else create.
  if (acct.gologinShareLink) {
    res.shareLink = "existing";
  } else if (profileId) {
    try {
      if (!dryRun) {
        const link = (await gologin.getPublicShareLink(profileId, acct.loginEmail, token)) ||
          (await gologin.createPublicShareLink(profileId, acct.loginEmail, token));
        if (link) {
          await prisma.linkedInAccount.update({ where: { id: accountId }, data: { gologinShareLink: link.publicUrl } });
          res.shareLink = "created";
        }
      } else {
        res.shareLink = "created";
      }
    } catch (e) {
      res.errors.push(`sharelink: ${msg(e)}`);
    }
  }

  if (!dryRun) {
    try {
      await prisma.linkedInAccount.update({ where: { id: accountId }, data: { provisionCheckedAt: new Date() } });
    } catch (e) {
      res.errors.push(`stamp: ${msg(e)}`);
    }
  }
  return res;
}
