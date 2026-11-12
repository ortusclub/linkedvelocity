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
// `lv_`-prefixed campaigns are our own maturing/warm-up runs, not outreach. We
// skip them so the flag means "doing real outreach", not "currently warming up".
const MATURING_PREFIX = /^lv_/;
// Only OUR OWN outreach campaigns count as LinkedArmy. On the shared engine each
// campaign carries an `owner` email; ours are @linkedvelocity.com / @linkedarmy.com,
// while client campaigns (Primo stays ours, but APHI/OUTB/GGLx… ) are owned by
// @ortusclub.com / @apexstrategy.io etc. We match by owner domain so a client's
// rented account never gets a ⚑ LinkedArmy flag. Override with OUTREACH_OWNER_DOMAINS.
const OWNER_DOMAINS = (process.env.OUTREACH_OWNER_DOMAINS || "linkedvelocity.com,linkedarmy.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
function ownedByUs(owner: string | undefined): boolean {
  const at = (owner || "").toLowerCase().lastIndexOf("@");
  return at >= 0 && OWNER_DOMAINS.includes(owner!.toLowerCase().slice(at + 1));
}
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
    const data = (await r.json().catch(() => null)) as { campaigns?: Array<{ id?: string; status?: string; owner?: string; profile_ids?: string[] }> } | null;
    const ids = new Set<string>();
    for (const c of data?.campaigns || []) {
      if (c.status && TERMINAL.has(c.status)) continue;
      if (c.id && MATURING_PREFIX.test(c.id)) continue;
      if (!ownedByUs(c.owner)) continue;
      for (const pid of c.profile_ids || []) if (pid) ids.add(pid);
    }
    return ids;
  } catch {
    return new Set();
  }
}

/**
 * Set of GoLogin profile ids staffed in at least one of OUR OWN live outreach
 * campaigns (non-terminal, non-`lv_`, owned by us). Cached for 60s and de-duped
 * across concurrent callers so a burst of inventory loads makes one engine call.
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
