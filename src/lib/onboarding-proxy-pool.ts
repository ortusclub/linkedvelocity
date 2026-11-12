import { countryCode } from "@/lib/countries";

export const ACCOUNTS_PER_PROXY = 4;
type PoolProxy = { id: string; host: string; port: number; username: string | null; password: string | null; country: string | null; type: string | null; status: string | null; maxAccounts?: number | null };
type PoolAccount = { id: string; proxyHost: string | null; proxyPort: number | null; proxyUsername: string | null; proxyPassword: string | null; proxyLocation: string | null; restrictedAt?: Date | null };
type Reservation = { accountId: string; proxyId: string | null; proxySlot: number | null };

// Count each account once, whether it is already in inventory, reserved, or both.
// Retain reservations even if an administrator edits the account's proxy fields.
export function availableProxySlots(proxies: PoolProxy[], accounts: PoolAccount[], reservations: Reservation[]) {
  return proxies.flatMap((p) => {
    const status = p.status?.toLowerCase() || null;
    // Residential only. Proxy 6 / datacenter is legacy Ortus infrastructure being retired —
    // never offer it as onboarding capacity (new accounts must land on residential).
    if (["retired", "error", "inactive", "expired"].includes(status || "") || (p.type || "").toLowerCase() === "datacenter" || p.port < 1 || p.port > 65535) return [];
    const linked = accounts.filter((a) => a.proxyHost === p.host && a.proxyPort === p.port);
    const reserved = reservations.filter((r) => r.proxyId === p.id);
    // Restricted accounts keep their proxy (for same-IP recovery) but don't occupy a slot,
    // so only active (non-restricted) linked accounts count toward the per-proxy cap.
    const activeLinked = linked.filter((a) => !a.restrictedAt);
    const used = new Set([...activeLinked.map((a) => a.id), ...reserved.map((r) => r.accountId)]).size;
    // Per-IP cap: a proxy may override the default (the accounts-per-IP A/B/C test puts
    // some IPs at 1, 2 or 3). null = default of 4.
    const cap = p.maxAccounts ?? ACCOUNTS_PER_PROXY;
    if (used >= cap) return [];
    const country = countryCode(p.country) || countryCode(linked.find((a) => countryCode(a.proxyLocation))?.proxyLocation);

    const source = p.username && p.password ? p : linked.find((a) => a.proxyUsername && a.proxyPassword);
    const username = source && "username" in source ? source.username : source?.proxyUsername;
    const password = source && "password" in source ? source.password : source?.proxyPassword;
    // Onboarding runs on the owner's device, so use portable username/password auth.
    if (!username || !password) return [];
    const slot = Array.from({ length: cap }, (_, i) => i + 1).find((n) => !reserved.some((r) => r.proxySlot === n));
    if (!slot) return [];
    return [{ ...p, username, password, country, slot, used }];
  // Fill available capacity before opening another proxy.
  }).sort((a, b) => b.used - a.used);
}
