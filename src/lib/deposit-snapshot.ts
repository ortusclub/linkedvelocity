export type DepositRow = {
  name?: string; receivedAt?: string | null;
  id: string; address: string; customer: string; eth: string | null;
  usdc: string | null; usdt: string | null; awaitingCredit: boolean; error: string | null;
};
export type DepositSnapshot = {
  rows: DepositRow[]; page: number; hasMore: boolean; checkedAt: string;
  treasury: string | null; signingConfigured: boolean;
  gasSponsor?: { enabled: boolean; address: string | null; eth: string | null; error: string | null };
};
