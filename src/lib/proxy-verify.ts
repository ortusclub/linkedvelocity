import { execCommand } from "@/lib/spawn-browser";

// Reachability + egress-IP/geo check for a raw proxy, usable server-side before we commit a
// swap. NOTE: this proves the proxy is alive and where it claims to be — it does NOT prove
// LinkedIn loads cleanly inside a GoLogin profile (no code anywhere does). That real-world
// check is the renter's "working / still broken" confirmation. See the fix-account-proxy flow.
export type ProxyProbe = {
  ok: boolean;
  ip?: string;
  country?: string | null; // ISO2 when the plain-HTTP ip-api lookup succeeds
  method?: string;
};

export function testProxy(p: {
  host: string;
  port: number | string;
  username?: string | null;
  password?: string | null;
}): ProxyProbe {
  const port = typeof p.port === "string" ? parseInt(p.port, 10) : p.port;
  const auth = p.username && p.password ? `${p.username}:${p.password}@` : "";
  const proxyUrl = `http://${auth}${p.host}:${port}`;

  // ip-api first (returns country), then ipify over HTTPS, then SOCKS5.
  const methods = [
    { name: "HTTP", cmd: `curl -s --max-time 8 --proxy "${proxyUrl}" "http://ip-api.com/json"` },
    { name: "HTTPS", cmd: `curl -s --max-time 8 --proxy "${proxyUrl}" "https://api.ipify.org?format=json"` },
    { name: "SOCKS5", cmd: `curl -s --max-time 8 --proxy "socks5://${auth}${p.host}:${port}" "https://api.ipify.org?format=json"` },
  ];

  for (const m of methods) {
    try {
      const out = execCommand(m.cmd).trim();
      if (out.startsWith("{")) {
        const d = JSON.parse(out) as { ip?: string; query?: string; countryCode?: string };
        const ip = d.ip || d.query || undefined;
        if (ip) return { ok: true, ip, country: d.countryCode ?? null, method: m.name };
      }
    } catch {
      /* try next */
    }
  }

  // Last resort: is the port even open? Reachable but may only work inside GoLogin.
  try {
    execCommand(`nc -z -w 5 ${p.host} ${port}`);
    return { ok: true, method: "port" };
  } catch {
    return { ok: false };
  }
}

// ── Proxies v2: majority-vote geo + LinkedIn reachability ──
// Geo is decided by a MAJORITY across several databases, never one. Our PH Lumina
// IPs read "MY" on ipinfo alone (a known lone outlier) but PH everywhere else, and
// our India IP reads "SG" on ipinfo only — so a single-source check would wrongly
// flag ~15 good IPs. Only flag a mismatch when most databases agree against the label.

function curlJson(proxyUrl: string, url: string): Record<string, unknown> | null {
  try {
    const out = execCommand(`curl -s --max-time 7 --proxy "${proxyUrl}" "${url}"`).trim();
    if (out.startsWith("{")) return JSON.parse(out) as Record<string, unknown>;
  } catch { /* ignore */ }
  return null;
}

const iso2 = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null;

export type GeoVote = { ok: boolean; country: string | null; votes: Record<string, string | null> };

// Query 4 databases through the proxy, return the ISO2 the majority agree on.
export function verifyProxyGeo(p: {
  host: string; port: number | string; username?: string | null; password?: string | null;
}): GeoVote {
  const port = typeof p.port === "string" ? parseInt(p.port, 10) : p.port;
  const auth = p.username && p.password ? `${p.username}:${p.password}@` : "";
  const proxyUrl = `http://${auth}${p.host}:${port}`;

  const sources: Record<string, string | null> = {};
  const ipapi = curlJson(proxyUrl, "http://ip-api.com/json");
  sources.ipapi = iso2(ipapi?.countryCode);
  const ipwho = curlJson(proxyUrl, "https://ipwho.is/");
  sources.ipwho = iso2(ipwho?.country_code);
  const ipinfo = curlJson(proxyUrl, "https://ipinfo.io/json");
  sources.ipinfo = iso2(ipinfo?.country);
  const dbip = curlJson(proxyUrl, "https://api.db-ip.com/v2/free/self");
  sources.dbip = iso2(dbip?.countryCode);

  const tally = new Map<string, number>();
  for (const v of Object.values(sources)) if (v) tally.set(v, (tally.get(v) || 0) + 1);
  let country: string | null = null, best = 0, tie = false;
  for (const [c, n] of tally) { if (n > best) { best = n; country = c; tie = false; } else if (n === best) tie = true; }
  // Need at least one reading and a clear plurality (no tie) to call it.
  const ok = best > 0 && !tie;
  return { ok, country: ok ? country : null, votes: sources };
}

// Does LinkedIn answer at all through this proxy? 000 = the proxy itself is dead
// (connect-level failure). ANY HTTP status back (200/3xx, even 999/403 bot walls)
// means the proxy is passing traffic — datacenter IPs that 502 ip-api still serve
// LinkedIn, so we probe LinkedIn directly, never ip-api, for health.
export function probeProxyLinkedIn(p: {
  host: string; port: number | string; username?: string | null; password?: string | null;
}): { reachable: boolean; code: string } {
  const port = typeof p.port === "string" ? parseInt(p.port, 10) : p.port;
  const auth = p.username && p.password ? `${p.username}:${p.password}@` : "";
  const proxyUrl = `http://${auth}${p.host}:${port}`;
  let code = "000";
  try {
    code = execCommand(`curl -s -o /dev/null -w "%{http_code}" --max-time 10 --proxy "${proxyUrl}" "https://www.linkedin.com"`).trim() || "000";
  } catch { code = "000"; }
  return { reachable: code !== "000" && code !== "", code };
}
