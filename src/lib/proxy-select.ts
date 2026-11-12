import { getProxies } from "@/lib/proxies";

// Pick an available proxy from OUR pool for an account, by tier + capacity + country.
// Reuses getProxies() (the single source of truth) so capacity/country reflect exactly
// what /admin/proxies shows. Never buys — returns null when nothing fits, and the caller
// flags the account for a purchase.
//
// Capacity per IP: four accounts, any provider/type; prefer matching country.
// The cap counts activeAccountCount (non-restricted accounts) from getProxies: a restricted
// account stays attached to its proxy for same-IP recovery but no longer occupies a slot.
// Subnet-spread and tiebreak still use the true total (accountCount) so genuinely emptier
// IPs/subnets are preferred first.

const CAP: Record<string, number> = { residential: 4, datacenter: 4 };

// Map the countries we actually stock (+ common variants) to an ISO2 code so a
// free-text account location can be compared to a proxy's country. Unknown strings
// yield null → treated as "no usable country" (assign any proxy of the tier).
const COUNTRY_ALIASES: Record<string, string> = {
  ph: "PH", philippines: "PH", manila: "PH", "metro manila": "PH",
  us: "US", usa: "US", "united states": "US", "united states of america": "US", america: "US",
  uk: "GB", gb: "GB", "united kingdom": "GB", "great britain": "GB", britain: "GB", england: "GB",
  sg: "SG", singapore: "SG",
  in: "IN", india: "IN",
  kh: "KH", cambodia: "KH",
  fr: "FR", france: "FR",
};

export function canonCountry(v?: string | null): string | null {
  if (!v) return null;
  const segs = v
    .split("·")[0]
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const s of [...segs].reverse()) {
    if (COUNTRY_ALIASES[s]) return COUNTRY_ALIASES[s];
    if (/^[a-z]{2}$/.test(s) && Object.values(COUNTRY_ALIASES).includes(s.toUpperCase())) return s.toUpperCase();
  }
  const whole = v.trim().toLowerCase();
  return COUNTRY_ALIASES[whole] ?? null;
}

export type PickedProxy = {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  country: string | null;
};

// The /24 of an IPv4 host (its first three octets). Subnet concentration — too many
// accounts on one /24 — is the dominant LinkedIn restriction driver, so assignment
// steers toward the least-populated subnet, not just the least-full IP.
function subnetOf(host: string): string {
  return host.split(".").slice(0, 3).join(".");
}

export async function pickAvailableProxy(opts: {
  provider: string; // "proxy-cheap" | "Proxy 6"
  type: string; // "residential" | "datacenter"
  country?: string | null; // the account's free-text location
  claimed?: Set<string>; // host:port already assigned earlier in this same run
  exclude?: Set<string>; // host:port to skip entirely (e.g. the dead proxy we're swapping off)
}): Promise<PickedProxy | null> {
  const rows = await getProxies();
  const cap = CAP[opts.type.toLowerCase()] ?? 4;
  const wantCountry = canonCountry(opts.country);
  const claimed = opts.claimed ?? new Set<string>();
  const exclude = opts.exclude ?? new Set<string>();

  // Hard geo-match: a PH persona on a US IP (and vice-versa) is a top restriction cause,
  // so if we know the account's country AND stock any proxy of that country, only assign
  // that country — return null (caller flags for purchase) rather than a mismatched IP.
  // If we stock nothing for that country, fall back to any (unchanged behaviour).
  const stockForCountry =
    !!wantCountry && rows.some((r) => canonCountry(r.country) === wantCountry);

  // Live per-/24 population, so we can send new accounts to the emptiest subnet first.
  const subnetLoad = new Map<string, number>();
  for (const r of rows) {
    const s = subnetOf(r.host);
    subnetLoad.set(s, (subnetLoad.get(s) || 0) + r.accountCount);
  }
  // Fold in assignments already made earlier in this same run.
  for (const key of claimed) {
    const s = subnetOf(key.split(":")[0]);
    subnetLoad.set(s, (subnetLoad.get(s) || 0) + 1);
  }

  const candidates = rows.filter((r) => {
    if (r.proxyString.split(":").length < 4) return false;
    if (r.status && ["retired", "error"].includes(r.status.toLowerCase())) return false;
    const key = `${r.host}:${r.port}`;
    if (exclude.has(key)) return false;
    // Enforce geo-match when we have stock for the account's country.
    if (stockForCountry && canonCountry(r.country) !== wantCountry) return false;
    // Cap counts only ACTIVE (non-restricted) accounts: a restricted account keeps its
    // proxy for same-IP recovery but frees its slot so new accounts can use the IP.
    const used = r.activeAccountCount + (claimed.has(key) ? 1 : 0);
    return used < cap;
  });

  const pool = candidates;
  if (pool.length === 0) return null;
  // Spread, don't stack: least-populated /24 first (de-concentrate), then the least-full
  // IP within it. Country is already hard-filtered above when stock exists, so when it
  // doesn't we still prefer a matching-country IP as a soft tiebreak.
  pool.sort(
    (a, b) =>
      Number(canonCountry(b.country) === wantCountry) - Number(canonCountry(a.country) === wantCountry) ||
      (subnetLoad.get(subnetOf(a.host)) || 0) - (subnetLoad.get(subnetOf(b.host)) || 0) ||
      a.accountCount - b.accountCount,
  );
  const chosen = pool[0];
  claimed.add(`${chosen.host}:${chosen.port}`);

  const parts = chosen.proxyString.split(":");
  const username = parts.length >= 4 ? parts[2] : null;
  const password = parts.length >= 4 ? parts.slice(3).join(":") : null;
  return { host: chosen.host, port: chosen.port, username, password, country: chosen.country };
}
