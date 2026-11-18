import { NextRequest, NextResponse } from "next/server";
import { withBscDepositJob, DepositJobBusy } from "@/lib/deposit-job";
import { getBscProvider, reconcileBscSweeps, detectBscDeposits, sweepBscDeposits } from "@/lib/bsc-deposits";

export const maxDuration = 300;

// Wrong-network payments: USDT/USDC sent on BNB Smart Chain to a customer's
// Base deposit address. Credits them and sweeps them to the treasury on BSC.
async function run(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let provider;
  try {
    // Do not hold the financial lock while an unavailable RPC retries.
    provider = await getBscProvider();
    const out = await withBscDepositJob(async assertActive => {
      const blocked = await reconcileBscSweeps(provider!, assertActive);
      const deposits = await detectBscDeposits(provider!, blocked, assertActive);
      const sweeps = await sweepBscDeposits(provider!, blocked, assertActive);
      return { deposits, sweeps };
    });
    return NextResponse.json({ deposits: out.deposits.length, sweeps: out.sweeps.length, details: out });
  } catch (error) {
    if (error instanceof DepositJobBusy) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("BSC deposit detection failed; check RPC availability and job status");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally { provider?.destroy(); }
}

export const GET = run;
export const POST = run;
