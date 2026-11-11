import { prisma } from "@/lib/prisma";

export class DepositJobBusy extends Error {}

// Base cron/admin jobs share the original lock. Ethereum has an independent
// chain-specific lock: its nonces and journals do not overlap Base.
// This transaction holds only the lock; deposit ledger writes commit separately.
export async function withDepositJob<T>(work: (assertActive: () => Promise<void>) => Promise<T>): Promise<T> {
  return withNetworkDepositJob(8453, work);
}

export async function withEthereumDepositJob<T>(work: (assertActive: () => Promise<void>) => Promise<T>): Promise<T> {
  return withNetworkDepositJob(1, work);
}

async function withNetworkDepositJob<T>(chainId: 1 | 8453, work: (assertActive: () => Promise<void>) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(${chainId}::integer, 17001) AS acquired`;
    if (!rows[0]?.acquired) throw new DepositJobBusy(chainId === 1 ? "Another Ethereum sweep is already running. Wait for it to finish, then review again." : "A deposit check or sweep is already running. Refresh shortly.");
    const started = Date.now();
    return work(async () => {
      if (Date.now() - started > 150_000) throw new Error("Deposit job time limit reached");
      // Detect a lost/expired lock transaction before any new credit or transfer.
      await tx.$queryRaw`SELECT 1`;
    });
  }, { timeout: 240_000, maxWait: 5_000 });
}
