const GOLOGIN_API_BASE = "https://api.gologin.com";
// Workspace that owns the rental profiles. The share API needs this in the query
// string — without it (and with the wrong body `type`) shares become non-functional "ghosts".
const GOLOGIN_WORKSPACE_ID = process.env.GOLOGIN_WORKSPACE_ID || "68654b73cd7edf1e3ed6d13f";

// Pick the GoLogin API token for an account based on which GoLogin account hosts it.
// "klabber" (info@klabber.co — new inventory) uses GOLOGIN_API_TOKEN_KLABBER; everything
// else ("master", info@ortus — legacy rentals) uses the default GOLOGIN_API_TOKEN.
export function tokenForAccount(gologinAccount?: string | null): string | undefined {
  if (gologinAccount === "klabber") return process.env.GOLOGIN_API_TOKEN_KLABBER;
  return undefined; // undefined -> gologinFetch falls back to GOLOGIN_API_TOKEN (master)
}

// Pick the GoLogin workspace for an account's shares. This MUST match the token:
// sharing with the klabber token but the master workspace id (or vice-versa) fails.
// "klabber" inventory lives in the shared klabber workspace (GOLOGIN_WORKSPACE_ID).
// "master"/ortus (legacy) profiles are personal — no workspace — so we send NO
// currentWorkspace param, unless a master workspace id is explicitly configured.
// Returns null to mean "omit currentWorkspace"; undefined callers keep the default.
export function workspaceForAccount(gologinAccount?: string | null): string | null {
  if (gologinAccount === "klabber") return GOLOGIN_WORKSPACE_ID;
  return process.env.GOLOGIN_WORKSPACE_ID_MASTER ?? null;
}

// Build the ?currentWorkspace= query for share calls. `undefined` (no arg) keeps the
// legacy default workspace; `null` omits it; a string uses that workspace.
function workspaceQuery(workspace: string | null | undefined): string {
  const ws = workspace === undefined ? GOLOGIN_WORKSPACE_ID : workspace;
  return ws ? `?currentWorkspace=${ws}` : "";
}

function headers(token?: string) {
  return {
    Authorization: `Bearer ${token || process.env.GOLOGIN_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function gologinFetch(path: string, options: RequestInit = {}, token?: string) {
  const res = await fetch(`${GOLOGIN_API_BASE}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(20000),
    headers: { ...headers(token), ...options.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GoLogin API error ${res.status}: ${text}`);
  }
  // DELETE/revoke (and some calls) return an empty body — don't choke parsing it.
  return text ? JSON.parse(text) : null;
}

export async function createProfile(options: {
  name: string;
  proxy?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
  };
}, token?: string) {
  return gologinFetch("/browser", {
    method: "POST",
    body: JSON.stringify({
      name: options.name,
      os: "mac",
      browserType: "chrome",
      navigator: {
        language: "en-US,en",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        resolution: "1920x1080",
        platform: "MacIntel",
      },
      // GoLogin rejects create when proxy is null/undefined — send an explicit
      // "none" proxy when we don't have one yet (it gets set right after).
      proxy: options.proxy
        ? {
            mode: "http",
            host: options.proxy.host,
            port: options.proxy.port,
            username: options.proxy.username,
            password: options.proxy.password,
          }
        : { mode: "none" },
    }),
  }, token);
}

// Rename a profile (used when the admin changes the login email — keep the GoLogin
// profile name in sync so the g.camp link and matching keep working). GoLogin's PUT
// needs the whole object, so read-modify-write.
export async function renameProfile(profileId: string, newName: string, token?: string) {
  const prof = await gologinFetch(`/browser/${profileId}`, {}, token);
  if (!prof) throw new Error("Could not read profile to rename");
  (prof as { name?: string }).name = newName;
  return gologinFetch(`/browser/${profileId}`, { method: "PUT", body: JSON.stringify(prof) }, token);
}

export async function findProfileByName(name: string, token?: string): Promise<{ id: string; name: string } | null> {
  const data = await gologinFetch("/browser/v2?limit=100", {}, token) as { profiles?: { id?: string; name?: string }[] } | null;
  const profile = data?.profiles?.find((item) => item.id && item.name === name);
  return profile?.id && profile.name ? { id: profile.id, name: profile.name } : null;
}

export async function deleteProfile(profileId: string, token?: string) {
  return gologinFetch(`/browser/${profileId}`, { method: "DELETE" }, token);
}

export async function updateProxy(
  profileId: string,
  proxy: { host: string; port: number; username?: string; password?: string },
  token?: string
) {
  return gologinFetch(`/browser/${profileId}/proxy`, {
    method: "PATCH",
    body: JSON.stringify({
      mode: "http",
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      password: proxy.password,
    }),
  }, token);
}

export async function addCookies(profileId: string, cookies: object[]) {
  return gologinFetch(`/browser/${profileId}/cookies`, {
    method: "POST",
    body: JSON.stringify(cookies),
  });
}

// Grant a renter access to a profile (role "guest" = can run/view, not edit).
export async function shareProfile(profileId: string, email: string, token?: string, workspace?: string | null) {
  return gologinFetch(`/share/multi${workspaceQuery(workspace)}`, {
    method: "POST",
    body: JSON.stringify({
      type: "browser", // GoLogin uses "browser" here, not "profile"
      instanceIds: [profileId],
      role: "guest",
      recepients: [email], // GoLogin's API spells it "recepients"
    }),
  }, token);
}

// Revoke a renter's access by the SHARE id (returned when the share was created
// via shareProfile). GoLogin exposes an (undocumented) DELETE /share/{shareId}.
export async function unshareProfile(shareId: string, token?: string, workspace?: string | null) {
  return gologinFetch(`/share/${shareId}${workspaceQuery(workspace)}`, { method: "DELETE" }, token);
}

export async function getProfile(profileId: string) {
  return gologinFetch(`/browser/${profileId}`);
}

// ---------------------------------------------------------------------------
// PUBLIC SHARE LINKS (g.camp) — the frictionless rental access mechanism.
// Unlike email shares (/share/multi), a public link works for ANYONE with the
// URL: the recipient does NOT need a registered/active GoLogin account. We can
// create / look up / pause / delete / regenerate them via the (undocumented)
// /share-links/ API, validated 2026-06-24. See gologin-pause-automation memory.
// ---------------------------------------------------------------------------
const GOLOGIN_GCAMP_BASE = "https://g.camp/share/";

export type PublicShareLink = {
  linkId: string;   // the _id used in pause/delete paths
  url: string;      // raw url fragment GoLogin returns (e.g. "name%40x.com/abc123")
  publicUrl: string; // full openable link: https://g.camp/share/<url>
  paused?: boolean;
  role?: string;
};

function toPublicLink(raw: { _id: string; url: string; paused?: boolean; role?: string } | null): PublicShareLink | null {
  if (!raw?._id || !raw?.url) return null;
  return { linkId: raw._id, url: raw.url, publicUrl: `${GOLOGIN_GCAMP_BASE}${raw.url}`, paused: raw.paused, role: raw.role };
}

// The g.camp link embeds the profile's REAL GoLogin name — it must match exactly or
// the link resolves to "link not found". So we always read the name from GoLogin
// itself rather than trusting a caller-supplied label (e.g. the catalogue display name).
async function resolveProfileName(profileId: string, name: string | undefined, token?: string): Promise<string> {
  if (name) return name;
  const p = await gologinFetch(`/browser/${profileId}`, {}, token);
  const real = (p as { name?: string } | null)?.name;
  if (!real) throw new Error("Could not read the GoLogin profile name for the share link");
  return real;
}

// Create a fresh public share link for a profile. Returns the new link.
// Omit `name` to use the profile's real GoLogin name (recommended — see resolveProfileName).
export async function createPublicShareLink(profileId: string, name?: string, token?: string): Promise<PublicShareLink> {
  const n = await resolveProfileName(profileId, name, token);
  const res = await gologinFetch("/share-links/profiles", {
    method: "POST",
    body: JSON.stringify({ profiles: [{ name: n, id: profileId, role: "owner", notes: "" }] }),
  }, token);
  const link = toPublicLink(res as { _id: string; url: string });
  if (!link) throw new Error("GoLogin did not return a share link");
  return link;
}

// Look up the existing public share link for a profile (null if none). Does NOT create.
export async function getPublicShareLink(profileId: string, name?: string, token?: string): Promise<PublicShareLink | null> {
  const n = await resolveProfileName(profileId, name, token);
  const res = await gologinFetch("/share-links/profiles/search", {
    method: "POST",
    body: JSON.stringify({ profiles: [{ name: n, id: profileId, role: "owner", notes: "" }] }),
  }, token);
  const first = (res as { links?: { _id: string; url: string; paused?: boolean; role?: string }[] } | null)?.links?.[0];
  return toPublicLink(first ?? null);
}

// Pause (disable) or unpause a public link without deleting it.
export async function setPublicShareLinkPaused(linkId: string, profileId: string, paused: boolean, token?: string) {
  return gologinFetch(`/share-links/${linkId}/profiles`, {
    method: "PATCH",
    body: JSON.stringify({ paused, profileIds: [profileId] }),
  }, token);
}

// Permanently delete a public link (the URL stops working immediately and can't be revived).
export async function deletePublicShareLink(linkId: string, profileId: string, token?: string) {
  return gologinFetch(`/share-links/${linkId}/profiles`, {
    method: "DELETE",
    body: JSON.stringify({ profileIds: [profileId] }),
  }, token);
}

// Regenerate: delete any existing link for the profile, then create a brand-new one.
// Guarantees a fresh URL per rental — an old renter's saved link can never re-grant access.
export async function regeneratePublicShareLink(profileId: string, name?: string, token?: string): Promise<PublicShareLink> {
  // Resolve the real name ONCE so create + cleanup agree (and we don't double-fetch).
  const n = await resolveProfileName(profileId, name, token);
  try {
    const existing = await getPublicShareLink(profileId, n, token);
    if (existing) await deletePublicShareLink(existing.linkId, profileId, token);
  } catch (e) {
    console.error("regeneratePublicShareLink: cleanup of existing link failed (continuing)", e);
  }
  return createPublicShareLink(profileId, n, token);
}
