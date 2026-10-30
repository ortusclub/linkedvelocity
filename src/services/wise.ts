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

interface WiseProfile { id?: number; type?: string; businessName?: string; fullName?: string; details?: { name?: string } }

export interface WiseStatus {
  connected: boolean;
  profileId: number | null;
  name: string | null;
  type: string | null;
  profiles: number;
}

// Confirm the full-access token authenticates and resolve the business profile.
export async function wiseStatus(): Promise<WiseStatus> {
  const rows = await wiseGet("profiles");
  if (!Array.isArray(rows)) throw new WiseError("unexpected", "Unexpected Wise profiles response.");
  const profiles = rows as WiseProfile[];
  const biz = profiles.find((p) => p.type === "business") ?? profiles[0];
  return {
    connected: true,
    profileId: biz?.id ?? null,
    name: biz?.businessName ?? biz?.details?.name ?? biz?.fullName ?? null,
    type: biz?.type ?? null,
    profiles: profiles.length,
  };
}
