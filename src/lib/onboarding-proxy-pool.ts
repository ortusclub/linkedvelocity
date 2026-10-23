import { countryCode } from "@/lib/countries";

export const ACCOUNTS_PER_PROXY = 4;
type PoolProxy = { id: string; host: string; port: number; username: string | null; password: string | null; country: string | null; type: string | null; status: string | null };
type PoolAccount = { id: string; proxyHost: string | null; proxyPort: number | null; proxyUsername: string | null; proxyPassword: string | null; proxyLocation: string | null };
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
    const used = new Set([...linked.map((a) => a.id), ...reserved.map((r) => r.accountId)]).size;
    if (used >= ACCOUNTS_PER_PROXY) return [];
    const country = countryCode(p.country) || countryCode(linked.find((a) => countryCode(a.proxyLocation))?.proxyLocation);

    const source = p.username && p.password ? p : linked.find((a) => a.proxyUsername && a.proxyPassword);
    const username = source && "username" in source ? source.username : source?.proxyUsername;
    const password = source && "password" in source ? source.password : source?.proxyPassword;
    // Onboarding runs on the owner's device, so use portable username/password auth.
    if (!username || !password) return [];
    const slot = [1, 2, 3, 4].find((n) => !reserved.some((r) => r.proxySlot === n));
    if (!slot) return [];
    return [{ ...p, username, password, country, slot, used }];
  // Fill available capacity before opening another proxy.
  }).sort((a, b) => b.used - a.used);
}
