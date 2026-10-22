import type { DepositRow, DepositSnapshot } from "./deposit-snapshot";

export type SweepResult = { message: string; sweeps: { token: string; amount: string; txHash: string }[]; failures: string[] };
export type SweepPlan = { treasury: string; rows: DepositRow[]; skipped: { address: string; reason: string }[] };

export async function reviewAllDeposits(load: (page: number) => Promise<DepositSnapshot>): Promise<SweepPlan> {
  const plan: SweepPlan = { treasury: "", rows: [], skipped: [] };
  const seen = new Set<string>();
  for (let page = 0; page < 10000; page++) {
    const data = await load(page);
    if (data.page !== page || !data.treasury || !data.signingConfigured) throw new Error("Treasury or signing configuration is unavailable. Refresh before sweeping.");
    if (plan.treasury && plan.treasury !== data.treasury) throw new Error("Main wallet changed during review. Start again.");
    plan.treasury = data.treasury;
    for (const row of data.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const usdc = Number(row.usdc || 0) > 0;
      const usdt = Number(row.usdt || 0) > 0;
      if (!row.error && !usdc && !usdt) continue;
      const reason = row.error || (row.awaitingCredit ? "Waiting for customer credit" :
        usdc && data.gasSponsor?.enabled ? data.gasSponsor.error : Number(row.eth || 0) <= 0 ? "Needs ETH in deposit wallet" : null);
      if (reason) plan.skipped.push({ address: row.address, reason });
      else plan.rows.push(row);
    }
    if (!data.hasMore) return plan;
  }
  throw new Error("Too many deposit pages. No sweeps have been submitted.");
}

// Reuse the individually locked, authenticated endpoint, one wallet at a time.
// Never retry an ambiguous response; preserve confirmations received so far.
export async function executeSweepPlan(plan: SweepPlan, send: (id: string, treasury: string) => Promise<SweepResult>, progress: (completed: number) => void): Promise<SweepResult> {
  const sweeps: SweepResult["sweeps"] = [];
  let completed = 0;
  for (const row of plan.rows) {
    try {
      const result = await send(row.id, plan.treasury);
      sweeps.push(...result.sweeps);
      if (result.failures.length) return { sweeps, failures: result.failures, message: `Stopped at ${row.address}. ${result.message} Remaining wallets were not submitted.` };
      progress(++completed);
    } catch {
      return { sweeps, failures: [row.id], message: `Stopped at ${row.address}: the result could not be confirmed. Check wallet activity before retrying. Remaining wallets were not submitted.` };
    }
  }
  return { sweeps, failures: [], message: `Finished checking ${completed} wallets. ${sweeps.length} transfers confirmed. ${plan.skipped.length} wallets were skipped during review.` };
}
