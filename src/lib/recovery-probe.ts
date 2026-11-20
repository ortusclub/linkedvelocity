// Automated recovery recheck reported by the LV Agent (droplet lv-agent). For a RESTRICTED account
// the agent loads the account's own linkedinUrl from a healthy, logged-in LV session and reports
// whether the profile still renders ("loaded"). Pure rules, kept separate from the route so they
// can be tested. Sam, 2026-11-19: double-check restricted accounts for recovery, but never auto-clear
// a restriction — a loaded profile only raises a "verify" flag on Restrictions v2 for a human.

export type RecoveryProbe = { loaded: boolean; at: string; from?: string };

// What the agent probes and the route reads back.
type ProbeAccount = {
  restrictedAt: Date | string | null;
  permanentlyRestricted: boolean;
  status: string;
};

// Decide whether to record an incoming probe result. We only track probes for accounts that are
// genuinely in the recoverable-restricted state: a live `restrictedAt`, not permanently restricted,
// not retired. Anything else is a stale/irrelevant read and is skipped (so a "loaded" result can
// never attach to an account that isn't actually being recovered).
export function decideRecoveryProbe(
  account: ProbeAccount,
  loaded: boolean,
  from?: string,
  now = Date.now(),
): { action: "record"; probe: RecoveryProbe } | { action: "skip"; reason: string } {
  if (typeof loaded !== "boolean") return { action: "skip", reason: "loaded must be boolean" };
  if (account.permanentlyRestricted) return { action: "skip", reason: "permanently restricted" };
  if (account.status === "retired") return { action: "skip", reason: "retired" };
  if (!account.restrictedAt) return { action: "skip", reason: "not restricted" };
  const probe: RecoveryProbe = { loaded, at: new Date(now).toISOString() };
  const f = typeof from === "string" ? from.trim().slice(0, 120) : "";
  if (f) probe.from = f;
  return { action: "record", probe };
}

// Whether a stored probe should raise the "profile loads — verify" flag on Restrictions v2.
// Gated on the account still being restricted (and not permanent) so a recovered account's stale
// probe is ignored without needing to be cleared on every recover path.
export function probeSuggestsRecovery(
  probe: unknown,
  stillRestricted: boolean,
  permanentlyRestricted: boolean,
): RecoveryProbe | null {
  if (!stillRestricted || permanentlyRestricted) return null;
  const p = probe as RecoveryProbe | null;
  if (!p || p.loaded !== true || typeof p.at !== "string" || Number.isNaN(Date.parse(p.at))) return null;
  return p;
}
