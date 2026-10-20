import { prisma } from "@/lib/prisma";
import { verifyProxyGeo, probeProxyLinkedIn } from "@/lib/proxy-verify";
import { getProviderProxy } from "@/services/proxy-cheap";

// ── Proxies v2 health / geo / billing check runner ──
// Shared by the daily cron and the admin "Run check now" button. Health probes
// LinkedIn (never ip-api — datacenter IPs 502 ip-api but serve LinkedIn), geo uses
// the majority-vote verifier, and Proxy-Cheap rows sync their auto-extend + expiry.
// Stalest-first and bounded so one invocation can't run away; repeated runs
// converge over the fleet.

type Candidate = {
  host: string; port: number;
  username: string | null; password: string | null;
  providerProxyId: string | null; isProxyCheap: boolean;
  consecutiveFails: number;
  lastCheckedMs: number;
};

export type CheckSummary = {
  checked: number; healthy: number; failing: number; geoChecked: number; geoMismatch: number;
  lapsingSoon: number; alerts: string[];
};

async function bestEffortSlack(lines: string[]) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url || !lines.length) return;
  try {
    await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `*Proxy check*\n${lines.join("\n")}` }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* alerting is best-effort */ }
}

const norm = (c: string | null | undefined) => (c || "").trim().toUpperCase();
const ALIAS: Record<string, string> = { SG: "SINGAPORE", PH: "PHILIPPINES", UK: "UNITED KINGDOM", US: "UNITED STATES" };
const canon = (c: string | null | undefined) => { const n = norm(c); return ALIAS[n] || n; };

export async function runProxyChecks(limit = 60): Promise<CheckSummary> {
  const [accounts, metaRows] = await Promise.all([
    prisma.linkedInAccount.findMany({
      where: { proxyHost: { not: null }, status: { notIn: ["removed"] } },
      select: { proxyHost: true, proxyPort: true, proxyUsername: true, proxyPassword: true },
    }),
    prisma.proxy.findMany(),
  ]);

  const cand = new Map<string, Candidate>();
  const metaByKey = new Map(metaRows.map((m) => [`${m.host}:${m.port}`, m]));
  for (const m of metaRows) {
    cand.set(`${m.host}:${m.port}`, {
      host: m.host, port: m.port, username: m.username, password: m.password,
      providerProxyId: m.providerProxyId, isProxyCheap: /proxy.?cheap/i.test(m.provider || ""),
      consecutiveFails: m.consecutiveFails, lastCheckedMs: m.lastCheckedAt ? m.lastCheckedAt.getTime() : 0,
    });
  }
  for (const a of accounts) {
    if (!a.proxyHost) continue;
    const key = `${a.proxyHost}:${a.proxyPort ?? 0}`;
    const c = cand.get(key);
    if (c) { if (!c.username && a.proxyUsername) c.username = a.proxyUsername; if (!c.password && a.proxyPassword) c.password = a.proxyPassword; }
    else cand.set(key, { host: a.proxyHost, port: a.proxyPort ?? 0, username: a.proxyUsername, password: a.proxyPassword, providerProxyId: null, isProxyCheap: false, consecutiveFails: 0, lastCheckedMs: 0 });
  }

  // Need real credentials to probe. Stalest-first, bounded.
  const queue = [...cand.values()].filter((c) => c.username && c.password).sort((a, b) => a.lastCheckedMs - b.lastCheckedMs).slice(0, limit);

  const geoByHost = new Map<string, { country: string | null; ok: boolean }>();
  const summary: CheckSummary = { checked: 0, healthy: 0, failing: 0, geoChecked: 0, geoMismatch: 0, lapsingSoon: 0, alerts: [] };
  const now = new Date();

  for (const c of queue) {
    const key = `${c.host}:${c.port}`;
    const meta = metaByKey.get(key);

    // 1. Health (LinkedIn).
    const { reachable } = probeProxyLinkedIn(c);
    const fails = reachable ? 0 : c.consecutiveFails + 1;
    const wasFailing = meta?.health === "failing";
    const health = fails >= 3 ? "failing" : "healthy";
    if (reachable) summary.healthy++; else if (health === "failing") summary.failing++;
    if (health === "failing" && !wasFailing) summary.alerts.push(`❌ ${c.host}:${c.port} now failing (${fails} consecutive)`);

    // 2. Geo (once per host).
    let geo = geoByHost.get(c.host);
    if (!geo) {
      const g = verifyProxyGeo(c);
      geo = { country: g.country, ok: g.ok };
      geoByHost.set(c.host, geo);
      if (g.ok) summary.geoChecked++;
    }

    const data: Record<string, unknown> = { health, consecutiveFails: fails, lastCheckedAt: now };
    if (geo.ok && geo.country) {
      data.verifiedCountry = geo.country;
      data.geoCheckedAt = now;
      const labels = new Set<string>();
      if (meta?.country) labels.add(canon(meta.country));
      if (labels.size && ![...labels].some((l) => l === canon(geo!.country) || l === norm(geo!.country))) {
        summary.geoMismatch++;
        summary.alerts.push(`⚠ ${c.host} reads ${geo.country} but labeled ${[...labels].join("/")}`);
      }
    }

    // 3. Proxy-Cheap billing sync.
    if (c.isProxyCheap && c.providerProxyId) {
      try {
        const pc = await getProviderProxy(c.providerProxyId);
        if (pc) {
          if (typeof pc.autoExtendEnabled === "boolean") data.autoExtend = pc.autoExtendEnabled;
          if (pc.expiresAt) data.expiresAt = new Date(pc.expiresAt);
          const accts = metaRows.find((m) => m.host === c.host && m.port === c.port);
          void accts;
          const days = pc.expiresAt ? Math.round((new Date(pc.expiresAt).getTime() - Date.now()) / 86400000) : null;
          if (pc.autoExtendEnabled === false && days != null && days <= 3) {
            summary.lapsingSoon++;
            summary.alerts.push(`💳 ${c.host}:${c.port} auto-extend OFF, expires in ${days}d`);
          }
        }
      } catch { /* provider read is best-effort */ }
    }

    await prisma.proxy.upsert({
      where: { host_port: { host: c.host, port: c.port } },
      create: { host: c.host, port: c.port, ...data },
      update: data,
    });
    summary.checked++;
  }

  if (summary.alerts.length) {
    console.warn("[proxy-check]", JSON.stringify(summary.alerts));
    await bestEffortSlack(summary.alerts);
  }
  return summary;
}
