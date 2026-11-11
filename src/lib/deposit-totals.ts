import { ethers } from "ethers";
import type { DepositSnapshot } from "./deposit-snapshot";
export type DepositTotals = { wallets: number; fundedWallets: number; unknownWallets: number; usdc: string; usdt: string; reviewUsdc: string; reviewUsdt: string };
export function depositTotals(pages: DepositSnapshot[]): DepositTotals {
  let usdc = BigInt(0), usdt = BigInt(0), reviewUsdc = BigInt(0), reviewUsdt = BigInt(0), fundedWallets = 0, unknownWallets = 0;
  const seen = new Set<string>();
  for (const page of pages) for (const row of page.rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (row.error || row.usdc === null || row.usdt === null) { unknownWallets++; continue; }
    const dc = ethers.parseUnits(row.usdc, 6), dt = ethers.parseUnits(row.usdt, 6);
    usdc += dc; usdt += dt;
    if (dc > BigInt(0) || dt > BigInt(0)) fundedWallets++;
    if (!page.treasury || !page.signingConfigured) continue;
    const ownGas = row.eth !== null && ethers.parseEther(row.eth) > BigInt(0);
    const dcGas = page.gasSponsor?.enabled ? !page.gasSponsor.error && page.gasSponsor.eth !== null && ethers.parseEther(page.gasSponsor.eth) > BigInt(0) : ownGas;
    if (!row.awaitingCredit && dcGas) reviewUsdc += dc;
    if (!row.awaitingCredit && ownGas) reviewUsdt += dt;
  }
  return { wallets: seen.size, fundedWallets, unknownWallets, usdc: ethers.formatUnits(usdc, 6), usdt: ethers.formatUnits(usdt, 6), reviewUsdc: ethers.formatUnits(reviewUsdc, 6), reviewUsdt: ethers.formatUnits(reviewUsdt, 6) };
}
export async function loadDepositTotals(load: (page: number) => Promise<DepositSnapshot>, progress: (totals: DepositTotals) => void) {
  const pages: DepositSnapshot[] = [];
  for (let page = 0; page < 10000; page++) {
    const data = await load(page);
    if (data.page !== page) throw new Error("Wallet pages changed. Calculate the total again.");
    pages.push(data); progress(depositTotals(pages));
    if (!data.hasMore) return depositTotals(pages);
  }
  throw new Error("Not all wallets could be checked. The displayed total is partial.");
}
