import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import { getDepositAddress } from "@/lib/wallet";
import { sendTopUpConfirmation, sendTopUpNotification } from "@/services/email";

// Customers are asked to pay USDC on Base, but some send USDT (or USDC) on
// BNB Smart Chain to the same deposit address. EVM addresses are identical on
// every chain, so the funds land safely — but the Base-only detector never saw
// them (Nov 2026: Alberto 110 USDT, Alan 90 USDT sat uncredited and unswept).
// This module credits those BEP-20 payments 1:1 and sweeps them to the same
// treasury address on BSC, topping up each deposit wallet's BNB gas from the
// central gas wallet (GAS_SPONSOR_PRIVATE_KEY, the same key on every EVM chain).

export const BSC_CHAIN_ID = 56;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const BSC_TOKENS = [
  { symbol: "USDT", contract: "0x55d398326f99059ff775485246999027b3197955", field: "bscUsdtLastSeen" },
  { symbol: "USDC", contract: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", field: "bscUsdcLastSeen" },
] as const;
type BscToken = (typeof BSC_TOKENS)[number];
const DECIMALS = 18; // Both Binance-Peg USDT and USDC use 18 decimals on BSC.
const MIN_CREDIT = ethers.parseUnits("0.01", DECIMALS); // ignore dust / address-poisoning transfers
const MIN_SWEEP = ethers.parseUnits("1", DECIMALS); // not worth gas below $1
const pendingPrefix = "Pending BSC sweep:";
const ERC20 = new ethers.Interface([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export function bscLabel(symbol: string) { return `${symbol} on BNB Smart Chain (BEP-20)`; }

/** Ledger amounts are Decimal(18,6): truncate (never round up) an 18-decimal token amount. */
export function toLedgerAmount(units: bigint): string {
  const whole = ethers.formatUnits(units - (units % BigInt(10 ** (DECIMALS - 6))), DECIMALS);
  return whole.includes(".") ? whole : whole + ".0";
}

export async function getBscProvider(): Promise<ethers.JsonRpcProvider> {
  // publicnode rejects some receipt reads without a token, so it is not used here.
  const urls = [...new Set([process.env.BSC_RPC_URL, "https://bsc-dataseed1.bnbchain.org", "https://bsc-dataseed2.bnbchain.org", "https://bsc.drpc.org"].filter((u): u is string => !!u))];
  for (const url of urls) {
    const request = new ethers.FetchRequest(url);
    request.timeout = 8_000;
    request.setThrottleParams({ maxAttempts: 1 });
    const provider = new ethers.JsonRpcProvider(request, BSC_CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
    try {
      if (BigInt(await provider.send("eth_chainId", [])) === BigInt(BSC_CHAIN_ID)) return provider;
    } catch { /* RPC URLs can contain credentials; never log them. */ }
    provider.destroy();
  }
  throw new Error("BNB Smart Chain RPC unavailable. No transfer was submitted.");
}

async function balancesOf(provider: ethers.Provider, token: BscToken, addresses: string[]): Promise<Map<string, bigint>> {
  const multicall = new ethers.Contract(MULTICALL3, ["function aggregate3((address target,bool allowFailure,bytes callData)[]) view returns ((bool success,bytes returnData)[])"], provider);
  const out = new Map<string, bigint>();
  for (let i = 0; i < addresses.length; i += 200) {
    const chunk = addresses.slice(i, i + 200);
    const results: { success: boolean; returnData: string }[] = await multicall.aggregate3(chunk.map(a => ({ target: token.contract, allowFailure: true, callData: ERC20.encodeFunctionData("balanceOf", [a]) })));
    // A failed read stays unknown (absent), never zero.
    results.forEach((r, j) => { if (r.success && r.returnData !== "0x") out.set(chunk[j].toLowerCase(), BigInt(r.returnData)); });
  }
  return out;
}

function lastSeenOf(deposit: Record<string, unknown>, token: BscToken): bigint {
  const value = deposit[token.field] as { toFixed?: () => string } | string | null | undefined;
  // Prisma Decimal.toString() can use exponent notation for tiny values; toFixed() never does.
  const text = value && typeof value === "object" && typeof value.toFixed === "function" ? value.toFixed() : String(value ?? "0");
  return ethers.parseUnits(text, DECIMALS);
}

/** Settle sweeps journalled by an earlier run. Deposits with an unresolved hash are skipped this run. */
export async function reconcileBscSweeps(provider: ethers.Provider, assertActive: () => Promise<void>): Promise<Set<string>> {
  const pending = await prisma.transaction.findMany({ where: { type: "sweep", description: { startsWith: pendingPrefix } } });
  const blocked = new Set<string>();
  for (const entry of pending) {
    const [symbol, depositId, units] = (entry.description || "").slice(pendingPrefix.length).split(":");
    const token = BSC_TOKENS.find(t => t.symbol === symbol);
    if (!depositId || !token || !units) continue;
    try {
      const receipt = entry.txHash ? await provider.getTransactionReceipt(entry.txHash) : null;
      if (!receipt) { blocked.add(depositId); continue; }
      await assertActive();
      await settleSweep(entry.id, depositId, token, BigInt(units), receipt.status === 1);
    } catch { blocked.add(depositId); }
  }
  return blocked;
}

async function settleSweep(journalId: string, depositId: string, token: BscToken, units: bigint, ok: boolean) {
  await prisma.$transaction(async tx => {
    await tx.transaction.update({ where: { id: journalId }, data: { description: ok ? `Swept ${ethers.formatUnits(units, DECIMALS)} ${token.symbol} (BSC) to treasury` : `Failed ${token.symbol} (BSC) sweep (reverted)` } });
    if (!ok) return;
    const deposit = await tx.depositAddress.findUnique({ where: { id: depositId } });
    if (!deposit) return;
    const seen = lastSeenOf(deposit as unknown as Record<string, unknown>, token);
    const next = seen > units ? seen - units : BigInt(0);
    await tx.depositAddress.update({ where: { id: depositId }, data: { [token.field]: ethers.formatUnits(next, DECIMALS) } });
  });
}

/** Credit new BEP-20 USDT/USDC at customer deposit addresses to their balance, 1:1 in USD. */
export async function detectBscDeposits(provider: ethers.Provider, blocked: Set<string>, assertActive: () => Promise<void>) {
  const deposits = await prisma.depositAddress.findMany({ include: { user: true } });
  const results: { userId: string; email: string; token: string; amount: string; address: string }[] = [];
  for (const token of BSC_TOKENS) {
    const balances = await balancesOf(provider, token, deposits.map(d => d.address));
    for (const deposit of deposits) {
      if (blocked.has(deposit.id)) continue;
      const balance = balances.get(deposit.address.toLowerCase());
      if (balance === undefined) continue;
      const seen = lastSeenOf(deposit as unknown as Record<string, unknown>, token);
      await assertActive();
      if (balance < seen) {
        // Funds left outside this job (e.g. a manual sweep): follow the balance down
        // so the next payment is not hidden below a stale high-water mark.
        await prisma.depositAddress.update({ where: { id: deposit.id }, data: { [token.field]: ethers.formatUnits(balance, DECIMALS) } });
        continue;
      }
      const delta = balance - seen;
      if (delta < MIN_CREDIT) continue;
      const amount = toLedgerAmount(delta);
      await prisma.$transaction(async tx => {
        await tx.user.update({ where: { id: deposit.userId }, data: { usdcBalance: { increment: amount } } });
        await tx.transaction.create({ data: { userId: deposit.userId, type: "deposit", amount, description: `${bscLabel(token.symbol)} deposit detected at ${deposit.address}` } });
        await tx.depositAddress.update({ where: { id: deposit.id }, data: { [token.field]: ethers.formatUnits(balance, DECIMALS) } });
      });
      results.push({ userId: deposit.userId, email: deposit.user.email, token: token.symbol, amount, address: deposit.address });
      try { await sendTopUpConfirmation({ email: deposit.user.email, amount, method: "crypto" }); } catch (e) { console.error("Failed to send BSC top-up confirmation:", e); }
      try { await sendTopUpNotification({ customerEmail: deposit.user.email, customerName: deposit.user.fullName, amount, method: "crypto", cryptoLabel: bscLabel(token.symbol) }); } catch (e) { console.error("Failed to send BSC top-up notification:", e); }
    }
  }
  return results;
}

function treasuryAddress() {
  const value = process.env.TREASURY_WALLET_ADDRESS?.trim();
  if (!value || !ethers.isAddress(value) || value.toLowerCase() === ethers.ZeroAddress) throw new Error("Configure the treasury destination before sweeping");
  return ethers.getAddress(value);
}

function gasWallet(provider: ethers.Provider) {
  const key = process.env.GAS_SPONSOR_PRIVATE_KEY?.trim();
  if (!key) throw new Error("GAS_SPONSOR_PRIVATE_KEY is not configured; BSC sweeps need BNB for gas");
  const wallet = new ethers.Wallet(key, provider);
  const expected = process.env.GAS_SPONSOR_ADDRESS?.trim();
  if (expected && expected.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("GAS_SPONSOR_ADDRESS does not match GAS_SPONSOR_PRIVATE_KEY");
  return wallet;
}

/** Sweep credited BEP-20 balances to the treasury address on BSC. */
export async function sweepBscDeposits(provider: ethers.Provider, blocked: Set<string>, assertActive: () => Promise<void>) {
  const treasury = treasuryAddress();
  const maxGasPrice = ethers.parseUnits(process.env.BSC_MAX_GAS_GWEI || "1", "gwei");
  const deposits = await prisma.depositAddress.findMany();
  const results: { address: string; token: string; amount: string; txHash?: string; status: "swept" | "pending" | "error"; error?: string }[] = [];
  for (const token of BSC_TOKENS) {
    const balances = await balancesOf(provider, token, deposits.map(d => d.address));
    for (const deposit of deposits) {
      if (blocked.has(deposit.id)) continue;
      const balance = balances.get(deposit.address.toLowerCase()) ?? BigInt(0);
      const seen = lastSeenOf(deposit as unknown as Record<string, unknown>, token);
      // Never move funds the detector has not credited yet.
      const amount = balance < seen ? balance : seen;
      if (amount < MIN_SWEEP) continue;
      const row = { address: deposit.address, token: token.symbol, amount: ethers.formatUnits(amount, DECIMALS) };
      try {
        await assertActive();
        if (treasury.toLowerCase() === deposit.address.toLowerCase()) throw new Error("Cannot sweep a deposit to itself");
        const derived = getDepositAddress(deposit.derivationIndex);
        if (derived.address.toLowerCase() !== deposit.address.toLowerCase()) throw new Error("Derived wallet does not match deposit address");
        const child = new ethers.Wallet(derived.privateKey, provider);
        const [latest, pendingNonce, fees] = await Promise.all([provider.getTransactionCount(child.address, "latest"), provider.getTransactionCount(child.address, "pending"), provider.getFeeData()]);
        if (latest !== pendingNonce) throw new Error("Deposit wallet has a pending BSC transaction");
        const gasPrice = fees.gasPrice;
        if (!gasPrice || gasPrice > maxGasPrice) throw new Error("BSC gas price unavailable or above BSC_MAX_GAS_GWEI");
        const data = ERC20.encodeFunctionData("transfer", [treasury, amount]);
        let gasLimit = BigInt(60_000);
        try { gasLimit = ((await provider.estimateGas({ from: child.address, to: token.contract, data })) * BigInt(13)) / BigInt(10); } catch { /* keep default */ }
        const need = gasLimit * gasPrice;
        const have = await provider.getBalance(child.address);
        if (have < need) {
          const sponsor = gasWallet(provider);
          const [sLatest, sPending, sBalance] = await Promise.all([provider.getTransactionCount(sponsor.address, "latest"), provider.getTransactionCount(sponsor.address, "pending"), provider.getBalance(sponsor.address)]);
          if (sLatest !== sPending) throw new Error("Gas wallet has a pending BSC transaction");
          const topUp = need - have;
          if (sBalance < topUp + BigInt(21_000) * gasPrice) throw new Error(`Gas wallet ${sponsor.address} needs BNB on BNB Smart Chain`);
          await assertActive();
          const funding = await sponsor.sendTransaction({ to: child.address, value: topUp, gasLimit: 21_000, gasPrice, type: 0, chainId: BSC_CHAIN_ID });
          const fundingReceipt = await funding.wait(1, 60_000);
          if (!fundingReceipt || fundingReceipt.status !== 1) throw new Error("BNB gas top-up did not confirm");
        }
        const raw = await child.signTransaction({ chainId: BSC_CHAIN_ID, type: 0, nonce: latest, to: token.contract, data, gasLimit, gasPrice });
        const hash = ethers.keccak256(raw);
        await assertActive();
        // Journal BEFORE broadcast so a timeout or crash can be reconciled, never blindly resent.
        const journal = await prisma.transaction.create({ data: { userId: deposit.userId, type: "sweep", amount: toLedgerAmount(amount), txHash: hash, description: `${pendingPrefix}${token.symbol}:${deposit.id}:${amount}` } });
        try {
          await assertActive();
          await provider.broadcastTransaction(raw);
          const receipt = await provider.waitForTransaction(hash, 1, 45_000);
          if (!receipt) { results.push({ ...row, txHash: hash, status: "pending" }); continue; }
          await settleSweep(journal.id, deposit.id, token, amount, receipt.status === 1);
          results.push({ ...row, txHash: hash, status: receipt.status === 1 ? "swept" : "error", ...(receipt.status === 1 ? {} : { error: "reverted" }) });
        } catch {
          // Ambiguous broadcast: the journal stays pending and is reconciled next run.
          results.push({ ...row, txHash: hash, status: "pending" });
        }
      } catch (error) {
        const message = error instanceof Error && !("code" in error) ? error.message : "BSC RPC operation failed";
        console.error(`BSC ${token.symbol} sweep skipped for ${deposit.address}: ${message}`);
        results.push({ ...row, status: "error", error: message });
      }
    }
  }
  return results;
}
