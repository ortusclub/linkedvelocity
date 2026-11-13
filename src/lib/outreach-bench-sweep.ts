// Auto-bench sweep: pull every rented / restricted / unavailable LV account out
// of any live Ortus outreach campaign (bench = out of rotation, reversible; the
// campaign keeps running on its other senders). This is the automated version of
// the manual autobench sweep — nothing stops a rented account from firing a
// campaign on its own, so a paying renter's account can end up double-booked.
//
// Scope: non-terminal campaigns, EXCLUDING our `lv_` maturing/warm-up runs (those
// legitimately hold under_construction accounts; maturing is governed by its own
// reconcile). Bench-only — it never un-benches, so a manual bench or a recovered
// account is left for a human to retry.
//
// Engine config (same as the inventory flag):
//   OUTREACH_ENGINE_URL / OUTREACH_ENGINE_TOKEN  — preferred
//   MATURING_ENGINE_URL / MATURING_ENGINE_TOKEN  — fallback
import { prisma } from "@/lib/prisma";

const TERMINAL = new Set(["done", "cancelled", "error"]);
const MATURING_PREFIX = /^lv_/;

type Campaign = { id?: string; status?: string; name?: string; profile_ids?: string[] };

function engineConfig(): { base: string; token: string } | null {
  const base = (process.env.OUTREACH_ENGINE_URL || process.env.MATURING_ENGINE_URL || "https://scraper.ortusclub.com").replace(/\/$/, "");
  const token = (process.env.OUTREACH_ENGINE_TOKEN || process.env.MATURING_ENGINE_TOKEN || "").trim();
  if (!token) return null;
  return { base, token };
}

export type BenchSweepResult = {
  ran: boolean;
  reason?: string;
  ineligibleAccounts: number;
  placementsFound: number;
  benched: number;
  failed: number;
  details: Array<{ campaign: string; email: string; flags: string; ok: boolean }>;
};

/**
 * Find every ineligible (rented/restricted/unavailable) LV account that is staffed
 * in a live, non-maturing campaign and bench it on the engine. Idempotent.
 */
export async function runBenchSweep(): Promise<BenchSweepResult> {
  const cfg = engineConfig();
  const empty: BenchSweepResult = { ran: false, ineligibleAccounts: 0, placementsFound: 0, benched: 0, failed: 0, details: [] };
  if (!cfg) return { ...empty, reason: "engine not configured (OUTREACH_ENGINE_TOKEN unset)" };

  // 1. Ineligible accounts, keyed by GoLogin profile id.
  const accounts = await prisma.linkedInAccount.findMany({
    where: { status: { not: "removed" }, gologinProfileId: { not: null } },
    select: {
      gologinProfileId: true, loginEmail: true, status: true, restrictedAt: true, permanentlyRestricted: true,
      rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] }, isShadow: false }, select: { id: true }, take: 1 },
    },
  });
  const ineligible = new Map<string, { email: string; flags: string }>();
  for (const a of accounts) {
    if (!a.gologinProfileId) continue;
    const rented = a.status === "rented" || a.rentals.length > 0;
    const restricted = !!a.restrictedAt || a.permanentlyRestricted || a.status === "retired";
    const unavailable = a.status === "unavailable" || a.status === "maintenance";
    if (!(rented || restricted || unavailable)) continue;
    const flags = [rented && "RENTED", restricted && "RESTRICTED", unavailable && "UNAVAIL"].filter(Boolean).join("+");
    ineligible.set(a.gologinProfileId, { email: a.loginEmail || a.gologinProfileId, flags });
  }

  // 2. Live client/outreach campaigns (skip terminal + lv_ maturing).
  let camps: Campaign[] = [];
  try {
    const r = await fetch(`${cfg.base}/api/campaign/list`, { headers: { Authorization: `Bearer ${cfg.token}` }, cache: "no-store", signal: AbortSignal.timeout(25_000) });
    if (!r.ok) return { ...empty, reason: `campaign list HTTP ${r.status}`, ineligibleAccounts: ineligible.size };
    camps = ((await r.json().catch(() => null)) as { campaigns?: Campaign[] } | null)?.campaigns || [];
  } catch (e) {
    return { ...empty, reason: `campaign list failed: ${(e as Error).message}`, ineligibleAccounts: ineligible.size };
  }

  // 3. Bench each ineligible placement.
  const details: BenchSweepResult["details"] = [];
  let benched = 0, failed = 0, placementsFound = 0;
  for (const cam of camps) {
    if (cam.status && TERMINAL.has(cam.status)) continue;
    if (cam.id && MATURING_PREFIX.test(cam.id)) continue;
    for (const pid of cam.profile_ids || []) {
      const hit = ineligible.get(pid);
      if (!hit) continue;
      placementsFound++;
      try {
        const res = await fetch(`${cfg.base}/api/campaign/${cam.id}/accounts/${pid}/bench`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ benched: true, reason: `Ineligible on LinkedVelocity (${hit.flags}) — auto-benched`, by: "linkedvelocity-cron" }),
          signal: AbortSignal.timeout(25_000),
        });
        const d = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        const ok = res.ok && d?.ok !== false;
        ok ? benched++ : failed++;
        details.push({ campaign: cam.name || cam.id || "?", email: hit.email, flags: hit.flags, ok });
      } catch {
        failed++;
        details.push({ campaign: cam.name || cam.id || "?", email: hit.email, flags: hit.flags, ok: false });
      }
    }
  }

  return { ran: true, ineligibleAccounts: ineligible.size, placementsFound, benched, failed, details };
}
