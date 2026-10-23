import { z } from "zod";

// Official REST v2 ordering flow: https://docs.proxy-cheap.com/
const BASE = "https://api.proxy-cheap.com";
const SERVICE = "static-residential-ipv4";
const PLAN = "standard"; // Dedicated (not Basic/shared).
export const MAX_PROXY_PRICE_USD = 4;
export const PURCHASE_PROXY_COUNTRIES = ["IN", "GB", "US", "PH"] as const;
export class ProxyPurchaseNotSubmitted extends Error {}

export function proxyPurchaseLimits() {
  const perProxy = Math.min(MAX_PROXY_PRICE_USD, Number(process.env.PROXY_CHEAP_MAX_PER_PROXY_USD || MAX_PROXY_PRICE_USD));
  const monthly = Math.min(100, Number(process.env.PROXY_CHEAP_MONTHLY_BUDGET_USD || 100));
  return { perProxy, monthly, enabled: process.env.PROXY_CHEAP_AUTO_BUY === "true" &&
    !!process.env.PROXY_CHEAP_API_KEY && !!process.env.PROXY_CHEAP_API_SECRET &&
    Number.isFinite(perProxy) && perProxy > 0 && (monthly === null || (Number.isFinite(monthly) && monthly > 0)) };
}

async function api(path: string, body?: unknown, authenticated = false): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (authenticated) {
    if (!process.env.PROXY_CHEAP_API_KEY || !process.env.PROXY_CHEAP_API_SECRET) throw new Error("Proxy-Cheap credentials are missing.");
    headers["X-Api-Key"] = process.env.PROXY_CHEAP_API_KEY;
    headers["X-Api-Secret"] = process.env.PROXY_CHEAP_API_SECRET;
  }
  const res = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", headers,
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000), cache: "no-store" });
  if (!res.ok) throw new Error(`Proxy-Cheap request failed (${res.status}).`);
  return res.json();
}

async function quoteStaticProxies(countries: readonly string[]) {
  const limits = proxyPurchaseLimits();
  if (!limits.enabled) throw new Error("Automatic proxy purchasing is not enabled. Ask the team to prepare a proxy.");
  const catalog = z.object({ services: z.array(z.object({ id: z.string(), plans: z.array(z.object({ id: z.string(), label: z.string() })).optional() })) }).parse(await api("/v2/order"));
  if (!catalog.services.find((s) => s.id === SERVICE)?.plans?.some((p) => p.id === PLAN && p.label.toLowerCase() === "dedicated")) {
    throw new Error("Dedicated static residential proxies are unavailable.");
  }
  const setup = z.object({ countries: z.array(z.string()), periods: z.object({ months: z.array(z.number()) }), isps: z.record(z.string(), z.array(z.object({ id: z.string(), label: z.string() }))).optional() })
    .parse(await api(`/v2/order/${SERVICE}`, { planId: PLAN }));
  if (!setup.periods.months.includes(1)) throw new Error("One-month dedicated static residential proxies are unavailable.");
  const available = [...new Set(countries)].filter((country) => setup.countries.includes(country));
  if (!available.length) throw new Error("No one-month dedicated static residential proxy is available for the requested country or permitted countries. Ask the team for help.");
  const quotes = [];
  // The provider rate-limits simultaneous quote requests. Check the four
  // permitted countries sequentially and retain every successful quote.
  for (const country of available) {
    try {
      const ispId = setup.isps?.[country]?.[0]?.id;
      const order = { planId: PLAN, quantity: 1, country, ...(ispId ? { ispId } : {}), period: { unit: "months" as const, value: 1 }, autoExtend: { isEnabled: false } };
      const quote = z.object({ finalPrice: z.number().finite().positive(), currency: z.literal("USD") }).parse(await api(`/v2/order/${SERVICE}/price`, order, true));
      quotes.push({ order, price: quote.finalPrice });
    } catch {}
  }
  if (!quotes.length) throw new Error("Could not check proxy prices in the permitted countries. Please try again.");
  return { quotes, perProxy: limits.perProxy };
}

export async function quoteStaticProxy(country: string) {
  const { quotes, perProxy } = await quoteStaticProxies([country]);
  const quote = quotes[0];
  if (quote.price > perProxy) throw new Error(`The matching proxy costs more than US$${perProxy.toFixed(2)}. Setup is paused; no proxy was purchased.`);
  return quote;
}

export async function quoteCheapestStaticProxy() {
  const { quotes, perProxy } = await quoteStaticProxies(PURCHASE_PROXY_COUNTRIES);
  const quote = quotes.filter((candidate) => candidate.price <= perProxy).sort((a, b) => a.price - b.price)[0];
  if (!quote) throw new Error(`Proxies in the permitted countries cost more than US$${perProxy.toFixed(2)}. Setup is paused; no proxy was purchased.`);
  return quote;
}

export async function purchaseStaticProxy(quote: Awaited<ReturnType<typeof quoteStaticProxy>>) {
  const limits = proxyPurchaseLimits();
  if (!limits.enabled || quote.price > limits.perProxy) throw new ProxyPurchaseNotSubmitted("Proxy purchasing is disabled or exceeds the price limit.");
  // Recheck immediately before charging: a stale quote must not authorize a higher price.
  try {
    const current = z.object({ finalPrice: z.number().finite().positive(), currency: z.literal("USD") })
      .parse(await api(`/v2/order/${SERVICE}/price`, quote.order, true));
    if (current.finalPrice > limits.perProxy || current.finalPrice > quote.price) throw new Error("Price changed");
  } catch {
    throw new ProxyPurchaseNotSubmitted("The proxy price changed or could not be checked. No purchase was submitted. Please retry.");
  }
  // Do not retry execute: the provider does not document an idempotency key.
  return z.object({ id: z.string().min(1), totalPrice: z.coerce.number().finite().positive() }).parse(await api(`/v2/order/${SERVICE}/execute`, quote.order, true));
}

const purchasedProxy = z.object({
  id: z.union([z.number(), z.string()]), status: z.string(), networkType: z.literal("RESIDENTIAL_STATIC"),
  countryCode: z.string(), autoExtendEnabled: z.boolean(),
  authentication: z.object({ username: z.string().min(1), password: z.string().min(1) }),
  connection: z.object({ publicIp: z.ipv4(), connectIp: z.string().min(1), httpPort: z.number().int().min(1).max(65535) }),
});

export async function readPurchasedProxy(orderId: string, country: string) {
  const list = z.array(z.object({ id: z.union([z.number(), z.string()]), status: z.string() })).parse(await api(`/orders/${encodeURIComponent(orderId)}/proxies`, undefined, true));
  if (!list.length || list.some((p) => ["PENDING", "INITIATING"].includes(p.status))) return null;
  if (list.length !== 1) throw new Error("Unexpected proxy order size. A team check is needed.");
  const p = purchasedProxy.parse(await api(`/proxies/${encodeURIComponent(String(list[0].id))}`, undefined, true));
  if (p.status !== "ACTIVE" || p.countryCode.toUpperCase() !== country || p.autoExtendEnabled) throw new Error("The purchased proxy needs a team check before use.");
  return { host: p.connection.connectIp, port: p.connection.httpPort, username: p.authentication.username, password: p.authentication.password };
}

// ── Proxies v2: read provider billing state + toggle auto-renew ──
// These use the live proxy endpoints (not the ordering flow). Auth is required.

// Raw call that forces a method and tolerates an empty (204) body.
async function apiRaw(path: string, method: "GET" | "POST"): Promise<unknown> {
  if (!process.env.PROXY_CHEAP_API_KEY || !process.env.PROXY_CHEAP_API_SECRET) {
    throw new Error("Proxy-Cheap credentials are missing.");
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Api-Key": process.env.PROXY_CHEAP_API_KEY,
      "X-Api-Secret": process.env.PROXY_CHEAP_API_SECRET,
    },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Proxy-Cheap request failed (${res.status}).`);
  const text = await res.text();
  if (!text) return null; // 204
  try { return JSON.parse(text); } catch { return null; }
}

export type ProviderProxyState = {
  id: string;
  publicIp: string | null;
  connectIp: string | null;
  httpPort: number | null;
  autoExtendEnabled: boolean | null;
  expiresAt: string | null; // ISO, best-effort (provider field name varies)
  status: string | null;
  countryCode: string | null;
};

// Pull the first date-looking value from the keys the provider has used for expiry.
function pickExpiry(o: Record<string, unknown>): string | null {
  const direct = o.expiresAt ?? o.expireAt ?? o.expiryDate ?? o.expiresOn ?? o.validUntil;
  const sub = (o.subscription as Record<string, unknown> | undefined)?.expiresAt
    ?? (o.subscription as Record<string, unknown> | undefined)?.endsAt;
  const v = direct ?? sub;
  if (typeof v === "string" && v) return v;
  if (typeof v === "number" && v > 0) return new Date(v).toISOString();
  return null;
}

function parseProviderProxy(raw: unknown): ProviderProxyState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const conn = (o.connection as Record<string, unknown>) || {};
  const auth = o.authentication as Record<string, unknown> | undefined;
  void auth;
  return {
    id: String(o.id ?? ""),
    publicIp: (conn.publicIp as string) ?? null,
    connectIp: (conn.connectIp as string) ?? null,
    httpPort: typeof conn.httpPort === "number" ? conn.httpPort : null,
    autoExtendEnabled: typeof o.autoExtendEnabled === "boolean" ? o.autoExtendEnabled : null,
    expiresAt: pickExpiry(o),
    status: (o.status as string) ?? null,
    countryCode: (o.countryCode as string) ?? null,
  };
}

// GET one proxy's live state by Proxy-Cheap id.
export async function getProviderProxy(id: string): Promise<ProviderProxyState | null> {
  return parseProviderProxy(await apiRaw(`/proxies/${encodeURIComponent(id)}`, "GET"));
}

// GET every proxy on the account (for reconciling provider ids against our rows).
export async function listProviderProxies(): Promise<ProviderProxyState[]> {
  const raw = await apiRaw(`/proxies`, "GET");
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { proxies?: unknown[] })?.proxies) ? (raw as { proxies: unknown[] }).proxies : [];
  return list.map(parseProviderProxy).filter((p): p is ProviderProxyState => !!p && !!p.id);
}

// Turn Proxy-Cheap auto-renew on/off. Returns the fresh state so the caller can store expiry too.
export async function setProviderAutoExtend(id: string, enabled: boolean): Promise<ProviderProxyState | null> {
  await apiRaw(`/proxies/${encodeURIComponent(id)}/auto-extend/${enabled ? "enable" : "disable"}`, "POST");
  return getProviderProxy(id);
}
