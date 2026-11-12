import { programStages } from "@/lib/maturing/programs.mjs";
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

// Stage changes affect the next cycle. Never stop a healthy live plan merely to
// replace its programme: replacement setup can fail after the stop, stranding it.
export async function replanAccountIfStale(_accountId: string): Promise<void> {
  return;
}
