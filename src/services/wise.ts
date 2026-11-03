// Server-only Wise full-access client (write-capable token), for the payout prepare/send
// flow. The Linked Velocity business is UK-registered, so Wise CANNOT fund transfers via
// API — this client prepares a transfer (quote → recipient → draft) and a human taps Pay
// in Wise. Token in WISE_API_TOKEN_FULL, separate from the read-only WISE_API_TOKEN.
//
// This module currently implements the connectivity check only; recipient + transfer
// creation land once connectivity is confirmed against the live token.

const BASE = "https://api.wise.com/2026Q3/";

export class WiseError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

function fullToken(): string {
  const t = process.env.WISE_API_TOKEN_FULL?.trim();
  if (!t) throw new WiseError("not_configured", "WISE_API_TOKEN_FULL is not set.");
  return t;
}

async function wiseGet(path: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${fullToken()}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new WiseError("unreachable", "Couldn't reach Wise. Try again in a minute.");
  }
  if (!res.ok) {
    const help: Record<number, string> = { 401: "token rejected", 403: "token lacks access", 429: "rate limited" };
    throw new WiseError(`http_${res.status}`, `Wise returned HTTP ${res.status}${help[res.status] ? ` (${help[res.status]})` : ""}.`);
  }
  try { return await res.json(); } catch { throw new WiseError("bad_json", "Wise returned invalid JSON."); }
}

// POST to Wise, surfacing its descriptive error body (errors[].message) so recipient/quote
// field problems are legible rather than a bare HTTP code.
async function wisePost(path: string, body: unknown): Promise<unknown> {
  const url = new URL(path, BASE);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${fullToken()}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(25000),
    });
  } catch { throw new WiseError("unreachable", "Couldn't reach Wise. Try again in a minute."); }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const j = json as { errors?: { message?: string }[]; message?: string } | null;
    const msg = j?.errors?.[0]?.message || j?.message || `Wise returned HTTP ${res.status}.`;
    throw new WiseError(`http_${res.status}`, msg);
  }
  return json;
}

interface WiseProfile { id?: number; type?: string; businessName?: string; fullName?: string; details?: { name?: string } }
const profileName = (p: WiseProfile | undefined) => p?.businessName ?? p?.details?.name ?? p?.fullName ?? null;
// A profile is the business one if its type says so, OR it carries a business name — Wise's
// /profiles can label the business type differently across API versions, but only business
// profiles have a businessName / details.name (personal profiles carry first+last name).
const isBusinessType = (p: WiseProfile | undefined) =>
  (p?.type ?? "").toLowerCase().includes("business") ||
  !!(p?.businessName && p.businessName.trim()) ||
  !!(p?.details?.name && p.details.name.trim() && !p?.fullName);

export interface WiseProfileLite { id: number | null; type: string | null; name: string | null }
export interface WiseStatus {
  connected: boolean;
  profileId: number | null;
  name: string | null;
  type: string | null;
  isBusiness: boolean;         // whether the chosen (payout) profile is the business one
  profiles: WiseProfileLite[]; // every profile this token can access, for diagnosis
}

// Confirm the full-access token authenticates and resolve the profile payouts will send
// from. Prefers WISE_PROFILE_ID, then a business profile, then the first one.
export async function wiseStatus(): Promise<WiseStatus> {
  const rows = await wiseGet("profiles");
  if (!Array.isArray(rows)) throw new WiseError("unexpected", "Unexpected Wise profiles response.");
  const profiles = rows as WiseProfile[];
  const wantId = process.env.WISE_PROFILE_ID ? Number(process.env.WISE_PROFILE_ID) : null;
  const chosen = (wantId ? profiles.find((p) => p.id === wantId) : undefined)
    ?? profiles.find(isBusinessType)
    ?? profiles[0];
  return {
    connected: true,
    profileId: chosen?.id ?? null,
    name: profileName(chosen),
    type: chosen?.type ?? null,
    isBusiness: isBusinessType(chosen),
    profiles: profiles.map((p) => ({ id: p.id ?? null, type: p.type ?? null, name: profileName(p) })),
  };
}

// The business profile id payouts send from — WISE_PROFILE_ID if set (pinned to Linked
// Velocity), else resolved by wiseStatus.
async function businessProfileId(): Promise<number> {
  const pinned = process.env.WISE_PROFILE_ID ? Number(process.env.WISE_PROFILE_ID) : null;
  if (pinned && Number.isFinite(pinned)) return pinned;
  const s = await wiseStatus();
  if (!s.profileId) throw new WiseError("no_profile", "No Wise business profile is available to this token.");
  return s.profileId;
}

export interface WiseQuote {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number | null;  // what leaves the balance (incl. fee)
  targetAmount: number | null;  // what the payee receives
  fee: number | null;
  rate: number | null;
  expirationTime: string | null;
}

// Create a quote in the business profile. A domestic PHP payout is PHP→PHP, funded from the
// Wise balance. Moves no money and reserves nothing — it only prices the payout and expires.
export async function createQuote(targetAmount: number, currency = "PHP"): Promise<WiseQuote> {
  const profileId = await businessProfileId();
  const q = await wisePost(`profiles/${profileId}/quotes`, {
    sourceCurrency: currency, targetCurrency: currency, targetAmount, payOut: "BALANCE",
  }) as Record<string, unknown>;
  const opts = Array.isArray(q.paymentOptions) ? q.paymentOptions as Array<Record<string, unknown>> : [];
  const opt = opts.find((o) => o.payIn === "BALANCE") || opts[0] || {};
  const feeObj = opt.fee as { total?: number } | undefined;
  return {
    id: String(q.id ?? ""),
    sourceCurrency: String(q.sourceCurrency ?? currency),
    targetCurrency: String(q.targetCurrency ?? currency),
    sourceAmount: (opt.sourceAmount as number) ?? (q.sourceAmount as number) ?? null,
    targetAmount: (q.targetAmount as number) ?? targetAmount,
    fee: feeObj?.total ?? null,
    rate: (q.rate as number) ?? null,
    expirationTime: (q.expirationTime as string) ?? null,
  };
}

// The Wise send page for a quote/profile — where the human finishes the payout (picks the
// recipient and taps Pay). Used until API recipient+transfer creation is wired (phase 2).
export function wiseSendUrl(): string {
  return "https://wise.com/send";
}
