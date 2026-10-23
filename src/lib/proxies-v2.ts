import { prisma } from "@/lib/prisma";
import { isCompanyEmail } from "@/lib/company";

// ── Proxies v2 data layer ──
// One row per egress IP (that's what LinkedIn sees). A proxy is still keyed by
// host:port in the `proxies` table; accounts still link by host:port value (no FK).
// This groups the port rows by host into egress IPs, folds in the live account
// flags from Inventory (joined, never copied), and surfaces the v2 columns
// (verified geo, Proxy-Cheap auto-extend/expiry, health) the cron keeps fresh.
// Presentation (caps, mismatch, flag colours) is computed in the page, mirroring
// the mock; this layer stays the single source of the raw, enriched data.

export type AcctFlagKey = "restricted" | "gologin" | "rotate" | "mail" | "held" | "inactive" | "retired";

export interface V2Account {
  email: string;
  flags: AcctFlagKey[];
}

export interface V2Port {
  port: number;
  username: string | null;
  hasPassword: boolean;
  provider: string | null;
  type: string | null; // stored lowercase: "residential" | "datacenter" | "mobile" | null
  label: string | null;
  labelCountry: string | null; // manual country override, else derived from linked accounts
  providerProxyId: string | null;
  isProxyCheap: boolean;
  status: string | null; // manual flag: active | self_service | error | retired
  health: string | null; // "healthy" | "failing"
  lastCheckedAt: string | null;
  accounts: V2Account[];
}

export interface V2Ip {
  ip: string;
  verifiedCountry: string | null; // ISO2, majority-vote
  geoCheckedAt: string | null;
  autoExtend: boolean | null; // null = N/A (no Proxy-Cheap proxy on this IP)
  expiresAt: string | null;
  ports: V2Port[];
}

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

function headSegment(v: string | null | undefined): string | null {
  if (!v) return null;
  const seg = v.split("·")[0]?.trim();
  return seg || null;
}

function accountLabel(a: {
  loginEmail: string | null; workEmail: string | null; personalEmail: string | null; linkedinName: string | null;
}): string {
  const company = [a.loginEmail, a.workEmail, a.personalEmail].find((e) => isCompanyEmail(e));
  return company || a.loginEmail || a.personalEmail || a.linkedinName || "(unnamed)";
}

export async function getProxiesV2(): Promise<V2Ip[]> {
  const now = Date.now();

  const accounts = await prisma.linkedInAccount.findMany({
    where: { proxyHost: { not: null }, status: { notIn: ["removed"] } },
    select: {
      id: true,
      proxyHost: true, proxyPort: true, proxyUsername: true, proxyPassword: true,
      proxyLocation: true, location: true,
      loginEmail: true, workEmail: true, personalEmail: true, linkedinName: true, notes: true,
      status: true, restrictedAt: true, permanentlyRestricted: true,
      twoFactorResetNeeded: true, heldUntil: true, updatedAt: true,
    },
  });

  const liveIds = accounts.map((a) => a.id);

  // "GoLogin still shared" — a leak: an ENDED rental (not active/pending) that was never
  // revoked yet still lists a share, so the ex-renter keeps access. An active/pending
  // rental's share is legitimate and must NOT flag (that falsely tripped live renters).
  const rentals = liveIds.length
    ? await prisma.rental.findMany({
        where: {
          linkedinAccountId: { in: liveIds },
          status: { notIn: ["active", "pending_access"] },
          accessRevokedAt: null,
        },
        select: { linkedinAccountId: true, gologinShareIds: true },
      })
    : [];
  const stillShared = new Set<string>();
  for (const r of rentals) {
    const ids = Array.isArray(r.gologinShareIds) ? r.gologinShareIds : [];
    if (ids.length > 0) stillShared.add(r.linkedinAccountId);
  }

  // Mail needing attention (review or open incident).
  const mail = liveIds.length
    ? await prisma.accountMailEvent.groupBy({
        by: ["linkedinAccountId"],
        where: { linkedinAccountId: { in: liveIds }, status: { in: ["needs_review", "incident"] } },
        _count: { _all: true },
      })
    : [];
  const hasMail = new Set(mail.map((m) => m.linkedinAccountId));

  const metaRows = await prisma.proxy.findMany();
  const metaByKey = new Map(metaRows.map((m) => [`${m.host}:${m.port}`, m]));

  // Fold accounts into port buckets keyed by host:port.
  type PortBucket = {
    host: string; port: number;
    username: string | null; hasPassword: boolean;
    countries: Map<string, number>;
    accounts: V2Account[];
  };
  const buckets = new Map<string, PortBucket>();

  for (const a of accounts) {
    if ((a.notes || "").includes("[SHOWCASE]")) continue;
    const host = a.proxyHost as string;
    const port = a.proxyPort ?? 0;
    const key = `${host}:${port}`;
    let b = buckets.get(key);
    if (!b) {
      b = { host, port, username: a.proxyUsername, hasPassword: !!a.proxyPassword, countries: new Map(), accounts: [] };
      buckets.set(key, b);
    }
    if (!b.username && a.proxyUsername) b.username = a.proxyUsername;
    if (!b.hasPassword && a.proxyPassword) b.hasPassword = true;
    const c = headSegment(a.proxyLocation) || headSegment(a.location);
    if (c) b.countries.set(c, (b.countries.get(c) || 0) + 1);

    const retired = a.status === "retired";
    const flags: AcctFlagKey[] = [];
    if (retired) flags.push("retired");
    if (a.restrictedAt && !retired) flags.push("restricted");
    if (stillShared.has(a.id)) flags.push("gologin");
    if (a.twoFactorResetNeeded) flags.push("rotate");
    if (hasMail.has(a.id)) flags.push("mail");
    if (a.heldUntil && new Date(a.heldUntil).getTime() > now) flags.push("held");
    if (!retired && a.status !== "rented" && now - new Date(a.updatedAt).getTime() > THIRTY_DAYS) flags.push("inactive");

    b.accounts.push({ email: accountLabel(a), flags });
  }

  // Include standalone proxies (no linked accounts).
  for (const m of metaRows) {
    const key = `${m.host}:${m.port}`;
    if (!buckets.has(key)) buckets.set(key, { host: m.host, port: m.port, username: m.username, hasPassword: !!m.password, countries: new Map(), accounts: [] });
  }

  // Build ports, then group ports by host into egress IPs.
  const ipMap = new Map<string, V2Ip>();
  for (const [key, b] of buckets) {
    const meta = metaByKey.get(key);
    let derivedCountry: string | null = null;
    let best = 0;
    for (const [c, n] of b.countries) if (n > best) { best = n; derivedCountry = c; }
    const isProxyCheap = /proxy.?cheap/i.test(meta?.provider || "");

    const port: V2Port = {
      port: b.port,
      username: b.username,
      hasPassword: b.hasPassword || !!(meta?.username && meta?.password),
      provider: meta?.provider ?? null,
      type: meta?.type ?? null,
      label: meta?.label ?? null,
      labelCountry: meta?.country || derivedCountry || null,
      providerProxyId: meta?.providerProxyId ?? null,
      isProxyCheap,
      status: meta?.status ?? null,
      health: meta?.health ?? null,
      lastCheckedAt: meta?.lastCheckedAt ? meta.lastCheckedAt.toISOString() : null,
      accounts: b.accounts,
    };

    let ip = ipMap.get(b.host);
    if (!ip) {
      ip = { ip: b.host, verifiedCountry: null, geoCheckedAt: null, autoExtend: null, expiresAt: null, ports: [] };
      ipMap.set(b.host, ip);
    }
    ip.ports.push(port);

    // Roll IP-level geo/billing up from the port rows.
    if (meta?.verifiedCountry) {
      const prev = ip.geoCheckedAt ? new Date(ip.geoCheckedAt).getTime() : 0;
      const cur = meta.geoCheckedAt ? meta.geoCheckedAt.getTime() : 0;
      if (!ip.verifiedCountry || cur >= prev) { ip.verifiedCountry = meta.verifiedCountry; ip.geoCheckedAt = meta.geoCheckedAt?.toISOString() ?? ip.geoCheckedAt; }
    }
    // Auto-extend/expiry only comes from a Proxy-Cheap port.
    if (isProxyCheap && meta) {
      if (typeof meta.autoExtend === "boolean") ip.autoExtend = meta.autoExtend;
      if (meta.expiresAt) ip.expiresAt = meta.expiresAt.toISOString();
    }
  }

  const ips = [...ipMap.values()];
  for (const ip of ips) ip.ports.sort((a, b) => a.port - b.port);
  ips.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  return ips;
}
