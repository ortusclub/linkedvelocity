// Which GoLogin profiles are currently staffed in a LIVE outreach campaign on the
// shared Ortus engine. Used to flag "⚑ LinkedArmy" on an inventory account so we
// can see at a glance which accounts are in use by a campaign (and are therefore
// double-booked when they get rented/restricted — see the leak sweep).
//
// Read-only and best-effort: it NEVER throws. The engine is a separate system on a
// 25s budget; if it is slow, down, or not configured, we return an empty set and
// the inventory simply shows no live-campaign flags rather than failing to load.
//
// Config (so it works wherever the client campaigns actually run):
//   OUTREACH_ENGINE_URL / OUTREACH_ENGINE_TOKEN  — preferred
//   MATURING_ENGINE_URL / MATURING_ENGINE_TOKEN  — fallback (same engine maturing uses)
// If the client campaigns live on the dev engine, set
//   OUTREACH_ENGINE_URL=https://dev-scraper.ortusclub.com

// A campaign in one of these statuses is finished — its accounts are not sending.
const TERMINAL = new Set(["done", "cancelled", "error"]);
// `lv_`-prefixed campaigns are our own maturing/warm-up runs, not client outreach.
// We skip them so the flag means "doing real outreach" (and highlights the
// rented/restricted double-booking risk), not "currently warming up".
const MATURING_PREFIX = /^lv_/;
const TTL_MS = 60_000;

let cache: { at: number; ids: Set<string> } | null = null;
let inflight: Promise<Set<string>> | null = null;

function engineConfig(): { base: string; token: string } | null {
  const base = (process.env.OUTREACH_ENGINE_URL || process.env.MATURING_ENGINE_URL || "https://scraper.ortusclub.com").replace(/\/$/, "");
  const token = (process.env.OUTREACH_ENGINE_TOKEN || process.env.MATURING_ENGINE_TOKEN || "").trim();
  if (!token) return null;
  return { base, token };
}

async function fetchLiveProfileIds(): Promise<Set<string>> {
  const cfg = engineConfig();
  if (!cfg) return new Set();
  try {
    const r = await fetch(`${cfg.base}/api/campaign/list`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) return new Set();
    const data = (await r.json().catch(() => null)) as { campaigns?: Array<{ id?: string; status?: string; profile_ids?: string[] }> } | null;
    const ids = new Set<string>();
    for (const c of data?.campaigns || []) {
      if (c.status && TERMINAL.has(c.status)) continue;
      if (c.id && MATURING_PREFIX.test(c.id)) continue;
      for (const pid of c.profile_ids || []) if (pid) ids.add(pid);
    }
    return ids;
  } catch {
    return new Set();
  }
}

/**
 * Set of GoLogin profile ids that appear in at least one non-terminal client
 * campaign. Cached for 60s and de-duped across concurrent callers so a burst of
 * inventory loads makes at most one engine call.
 */
export async function liveCampaignProfileIds(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  if (inflight) return inflight;
  inflight = (async () => {
    const ids = await fetchLiveProfileIds();
    // Only cache a real answer; an empty set from a failed/unconfigured call is not
    // cached, so a transient engine blip doesn't blank the flags for a full minute.
    if (ids.size > 0) cache = { at: Date.now(), ids };
    inflight = null;
    return ids;
  })();
  return inflight;
}
