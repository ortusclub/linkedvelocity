import { prisma } from "@/lib/prisma";
import { isCompanyEmail } from "@/lib/company";

// ── Single source of truth for the Proxies view ──
// Both the admin page (/api/admin/proxies) and the Google-Sheets CSV export
// (/api/admin/proxies/export) call getProxies(), so the proxy tab can never
// drift from what the admin sees.
//
// A proxy is keyed by host:port. The account→proxy mapping lives on
// LinkedInAccount (proxyHost/Port/Username/Password/proxyLocation); the Proxy
// table only holds what ISN'T derivable from an account — friendly label,
// provider, residential/datacenter type, a country override, and a manual
// status flag. getProxies() unions the two: every distinct proxy in use by an
// account PLUS every standalone Proxy row (spare/dead proxies with no account),
// then joins the metadata on.

export interface ProxyRow {
  // host:port key.
  host: string;
  port: number;
  // Full connection string host:port:user:pass (creds pulled from a linked
  // account); host:port when no creds are known.
  proxyString: string;
  // Metadata (from the Proxy lookup table; null until Sam sets it).
  label: string | null;
  provider: string | null;
  type: string | null; // "residential" | "datacenter"
  country: string | null; // override, else derived from linked accounts
  status: string | null; // manual flag, e.g. "error" / "retired"
  notes: string | null;
  hasRow: boolean; // whether a Proxy metadata row exists yet
  // Derived from live accounts.
  accounts: string[]; // login/personal emails (or name) of linked accounts
  accountCount: number;
  // Non-restricted accounts only. accountCount is the true display count; this is what
  // the assignment cap uses, so a restricted account stays attached to its proxy (same IP
  // for recovery) but no longer blocks a slot on that IP.
  activeAccountCount: number;
  // Per-IP account cap override (null = default of 4). Set for the accounts-per-IP A/B/C
  // test so some IPs hold 1, some 2, some 3 accounts.
  maxAccounts: number | null;
}

// Country of a proxy's egress. proxyLocation may be "Germany" or richer like
// "United States · New York" — we want just the country-ish head segment.
function headSegment(v: string | null | undefined): string | null {
  if (!v) return null;
  const seg = v.split("·")[0]?.trim();
  return seg || null;
}

// Human label for a linked account in the LinkedIn Account cell. Always prefer the
// company (@klabber.co / @ortus.solutions / …) email — the address we log in with —
// wherever it's stored, even if it ended up in the work/recovery field rather than
// loginEmail. Never surface the ambassador's personal email when a company one exists.
// Falls back to loginEmail, then personal, then the profile name.
function accountLabel(a: {
  loginEmail: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  linkedinName: string | null;
}): string {
  const company = [a.loginEmail, a.workEmail, a.personalEmail].find((e) => isCompanyEmail(e));
  return company || a.loginEmail || a.personalEmail || a.linkedinName || "(unnamed)";
}

const NA_COUNTRY = "Unassigned";

export async function getProxies(): Promise<ProxyRow[]> {
  // Live account→proxy links. Removed/showcase accounts don't count toward a
  // proxy's usage (they mirror the inventory export's exclusions).
  const accounts = await prisma.linkedInAccount.findMany({
    where: {
      proxyHost: { not: null },
      status: { notIn: ["removed"] },
    },
    select: {
      proxyHost: true,
      proxyPort: true,
      proxyUsername: true,
      proxyPassword: true,
      proxyLocation: true,
      location: true,
      loginEmail: true,
      workEmail: true,
      personalEmail: true,
      linkedinName: true,
      notes: true,
      restrictedAt: true,
    },
  });

  const metaRows = await prisma.proxy.findMany();
  const metaByKey = new Map(metaRows.map((m) => [`${m.host}:${m.port}`, m]));

  // Fold accounts into per-proxy buckets keyed by host:port.
  type Bucket = {
    host: string;
    port: number;
    username: string | null;
    password: string | null;
    countries: Map<string, number>; // derived-country tally, for a best guess
    accounts: string[];
    activeCount: number; // non-restricted accounts (what the assignment cap counts)
  };
  const buckets = new Map<string, Bucket>();

  for (const a of accounts) {
    if ((a.notes || "").includes("[SHOWCASE]")) continue;
    const host = a.proxyHost as string;
    const port = a.proxyPort ?? 0;
    const key = `${host}:${port}`;
    let b = buckets.get(key);
    if (!b) {
      b = { host, port, username: a.proxyUsername, password: a.proxyPassword, countries: new Map(), accounts: [], activeCount: 0 };
      buckets.set(key, b);
    }
    // Keep the first non-empty credentials we see for the proxy string.
    if (!b.username && a.proxyUsername) b.username = a.proxyUsername;
    if (!b.password && a.proxyPassword) b.password = a.proxyPassword;
    const c = headSegment(a.proxyLocation) || headSegment(a.location);
    if (c) b.countries.set(c, (b.countries.get(c) || 0) + 1);
    b.accounts.push(accountLabel(a));
    if (!a.restrictedAt) b.activeCount += 1;
  }

  // Ensure every standalone Proxy row appears even with no linked accounts.
  for (const m of metaRows) {
    const key = `${m.host}:${m.port}`;
    if (!buckets.has(key)) {
      buckets.set(key, { host: m.host, port: m.port, username: m.username, password: m.password, countries: new Map(), accounts: [], activeCount: 0 });
    }
  }

  const rows: ProxyRow[] = [];
  for (const [key, b] of buckets) {
    const meta = metaByKey.get(key);
    // Most common derived country among the linked accounts.
    let derivedCountry: string | null = null;
    let best = 0;
    for (const [c, n] of b.countries) if (n > best) { best = n; derivedCountry = c; }
    const country = meta?.country || derivedCountry || null;
    const creds = b.username && b.password ? `:${b.username}:${b.password}` : "";
    rows.push({
      host: b.host,
      port: b.port,
      proxyString: `${b.host}:${b.port}${creds}`,
      label: meta?.label ?? null,
      provider: meta?.provider ?? null,
      type: meta?.type ?? null,
      country,
      status: meta?.status ?? null,
      notes: meta?.notes ?? null,
      hasRow: !!meta,
      accounts: b.accounts,
      accountCount: b.accounts.length,
      activeAccountCount: b.activeCount,
      maxAccounts: meta?.maxAccounts ?? null,
    });
  }

  // Sort by country (Unassigned last), then provider (untagged last), then label,
  // then host:port — so both the page and the sheet cluster same-provider proxies
  // together within each country.
  rows.sort((a, b) => {
    const ca = a.country || NA_COUNTRY;
    const cb = b.country || NA_COUNTRY;
    if (ca !== cb) {
      if (ca === NA_COUNTRY) return 1;
      if (cb === NA_COUNTRY) return -1;
      return ca.localeCompare(cb);
    }
    // Provider sub-order; blank/untagged sinks to the bottom of the country.
    const pa = a.provider || "￿";
    const pb = b.provider || "￿";
    if (pa !== pb) return pa.localeCompare(pb, undefined, { sensitivity: "base" });
    const la = a.label || "";
    const lb = b.label || "";
    if (la !== lb) return la.localeCompare(lb, undefined, { numeric: true });
    return `${a.host}:${a.port}`.localeCompare(`${b.host}:${b.port}`);
  });

  return rows;
}
