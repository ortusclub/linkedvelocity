import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logWarmupActivity } from "@/lib/warmup-activity";
import { list, start, engine } from "@/lib/maturing/service.mjs";
import { categoryResolver, programStages, programLabel } from "@/lib/maturing/programs.mjs";
import { newMaturePlan } from "@/lib/maturing/shared/mature-profile-plan.mjs";

// Build the maturing plan for an account's current stage. Shared by the auto-start cron
// (the 15-min sweep) and the instant stage-change trigger so the two never diverge.
// `recovered` = restricted in the last 30 days (gentle re-warm); `connections === 0`
// starts cold-only (no network to warm into yet).
export function autoMaturePlan(
  gid: string,
  name: string,
  linkedinUrl: string | null,
  recovered: boolean,
  category: string,
  connections: number | null,
) {
  const p = newMaturePlan() as Record<string, unknown>;
  const stages = programStages(category, recovered, connections) as { warmDaily: number; coldDaily: number }[];
  p.warmEnabled = stages.some((s) => s.warmDaily > 0);
  p.coldEnabled = stages.some((s) => s.coldDaily > 0);
  p.warmPool = "linkedvelocity_owned";
  p.coldPoolSource = "default";
  p.warmUntilExhausted = false;
  p.stages = stages;
  p.targetProfileIds = [gid];
  p.accounts = { [gid]: { name, linkedinUrl } };
  return p;
}

const TERMINAL = new Set(["done", "cancelled", "error"]);
const RESTR_WINDOW_MS = 30 * 86400000;
const recentlyRestricted = (log: unknown): boolean => {
  const arr = Array.isArray(log) ? (log as { at?: string }[]) : [];
  return arr.some((e) => e?.at && Date.now() - new Date(e.at).getTime() < RESTR_WINDOW_MS);
};
const sig = (stages?: { fromDay: number; toDay: number; warmDaily: number; coldDaily: number }[]) =>
  JSON.stringify((stages || []).map((s) => [Number(s.fromDay), Number(s.toDay), Number(s.warmDaily), Number(s.coldDaily)]));

type EngineCampaign = { id: string; status?: string; profileIds?: string[] };

// Re-plan ONE account onto its current stage's programme, immediately, if its live campaign
// is on a stale plan. This is the per-account version of the capped sweep in
// auto-start-maturing — fired the moment an account's stage changes (e.g. construction →
// available) so it doesn't wait up to 15 minutes. Self-idempotent: if the live plan already
// matches the current stage, it does nothing. Best-effort — callers run it via `after()` and
// swallow errors; it must never affect the triggering request.
export async function replanAccountIfStale(accountId: string): Promise<void> {
  const a = await prisma.linkedInAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true, gologinProfileId: true, linkedinName: true, linkedinUrl: true, notes: true, loginEmail: true,
      status: true, restrictedAt: true, permanentlyRestricted: true, restrictionLog: true, connectionCount: true,
      twoFactorResetNeeded: true, inventoryPool: true,
      rentals: { where: { status: { in: ["active", "pending_access", "payment_failed"] } }, select: { id: true }, take: 1 },
    },
  });
  if (!a?.gologinProfileId) return;
  // Same hard exclusions as the cron: these must not be (re-)maturing.
  if (["removed", "rented", "retired", "maintenance", "unavailable"].includes(a.status)) return;
  if (a.restrictedAt || a.permanentlyRestricted || a.inventoryPool === "campaign" || a.rentals.length > 0) return;

  const [apps, sessions] = await Promise.all([
    prisma.ambassadorApplication.findMany({
      select: { id: true, verifiedAt: true, status: true, linkedinUrl: true, email: true, applicationReceived: true, paidAt: true, onboardedAt: true },
    }),
    prisma.selfServiceOnboarding.findMany({ select: { accountId: true, applicationId: true, state: true } }),
  ]);
  const category = categoryResolver(apps, sessions)(a) as string;
  if (!["pipeline", "construction", "available"].includes(category)) return; // 'other' isn't an active programme

  let data: { campaigns?: EngineCampaign[]; engineError?: string };
  try { data = (await list()) as typeof data; } catch { return; }
  if (data.engineError) return;
  const live = (data.campaigns || []).filter(
    (c) => String(c.id || "").startsWith("lv_") && !TERMINAL.has(c.status || "") && (c.profileIds || []).includes(a.gologinProfileId!),
  );
  if (!live.length) return; // nothing running to re-plan — the cron will enrol it
  if (live.some((c) => c.status === "needs_review")) return; // parked on a login review; leave the ⚠️ signal

  const recovered = recentlyRestricted(a.restrictionLog);
  const fresh = sig(programStages(category, recovered, a.connectionCount ?? null));
  const warm = live.find((c) => /_warm$/.test(c.id)) || live[0];
  let stored: string;
  try {
    const det = (await engine(`/api/campaign/${warm.id}`)) as { campaign?: { config?: { maturePlan?: { stages?: { fromDay: number; toDay: number; warmDaily: number; coldDaily: number }[] } } } };
    stored = sig(det.campaign?.config?.maturePlan?.stages);
  } catch { return; }
  if (stored === fresh) return; // already on the current plan

  for (const c of live) { try { await engine(`/api/campaign/${c.id}/stop?immediate=1`, {}); } catch { /* best effort */ } }
  await start(
    { accountId: a.id, launchId: randomUUID(), plan: autoMaturePlan(a.gologinProfileId!, a.linkedinName, a.linkedinUrl, recovered, category, a.connectionCount ?? null), timezone: "Asia/Manila" },
    "system",
  );
  await logWarmupActivity(a.id, a.linkedinUrl, a.notes, `🔁 Maturing re-planned (stage change) — now on: ${programLabel(category, recovered, a.connectionCount ?? null)}`, "system").catch(() => {});
}
