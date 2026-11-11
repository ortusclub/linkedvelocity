import { createHmac, timingSafeEqual } from "node:crypto";
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import { getDepositAddress } from "@/lib/wallet";

export type EthereumReview = {
  depositId: string; source: string; destination: string; customer: string;
  balance: string; amount: string; maxFee: string; nonce: number;
  maxFeePerGas: string; maxPriorityFeePerGas: string; expiresAt: number;
};
export class SweepError extends Error {}
const prefix = "Ethereum ETH sweep pending:";
export function ethereumProvider() {
  const request = new ethers.FetchRequest(process.env.ETH_RPC_URL || "https://eth.drpc.org");
  request.timeout = 12_000;
  return new ethers.JsonRpcProvider(request);
}
function destination() {
  const value = process.env.TREASURY_WALLET_ADDRESS?.trim();
  if (!value || !ethers.isAddress(value) || value.toLowerCase() === ethers.ZeroAddress) throw new SweepError("Configure a valid treasury wallet first.");
  return ethers.getAddress(value);
}
function signature(review: EthereumReview) {
  const seed = process.env.HD_WALLET_SEED_PHRASE;
  if (!seed) throw new SweepError("Deposit wallet signing is not configured.");
  return createHmac("sha256", seed).update("ethereum-sweep-v1:" + JSON.stringify(review)).digest("hex");
}
export function verifyReview(review: EthereumReview, signatureValue: string) {
  if (!review || typeof signatureValue !== "string" || !/^[a-f0-9]{64}$/.test(signatureValue) || !timingSafeEqual(Buffer.from(signature(review), "hex"), Buffer.from(signatureValue, "hex"))) throw new SweepError("Invalid review. Preview the sweep again.");
  if (Date.now() > review.expiresAt) throw new SweepError("Review expired. Preview again for current fees.");
  if (destination() !== review.destination) throw new SweepError("Treasury destination changed. Preview again.");
}
async function checkNetwork(provider: ethers.JsonRpcProvider) {
  if ((await provider.getNetwork()).chainId !== BigInt(1)) throw new SweepError("The RPC must connect to Ethereum mainnet.");
}
async function reconcile(provider: ethers.JsonRpcProvider, depositId: string) {
  const entries = await prisma.transaction.findMany({ where: { type: "sweep", description: { startsWith: prefix + depositId + ":" } } });
  for (const entry of entries) {
    const receipt = entry.txHash ? await provider.getTransactionReceipt(entry.txHash) : null;
    if (!receipt) throw new SweepError("An Ethereum sweep is pending or unconfirmed. Check its transaction before retrying.");
    await prisma.transaction.update({ where: { id: entry.id }, data: { description: (entry.description || "").replace(prefix, receipt.status === 1 ? "Ethereum ETH sweep confirmed:" : "Ethereum ETH sweep reverted:") } });
  }
}
export async function previewEthereumSweep(provider: ethers.JsonRpcProvider, depositId: string) {
  await checkNetwork(provider);
  await reconcile(provider, depositId);
  const deposit = await prisma.depositAddress.findUnique({ where: { id: depositId }, include: { user: { select: { email: true } } } });
  if (!deposit) throw new SweepError("Deposit wallet not found.");
  const to = destination();
  if (to.toLowerCase() === deposit.address.toLowerCase()) throw new SweepError("Cannot sweep a wallet to itself.");
  if (await provider.getCode(to) !== "0x") throw new SweepError("This ETH sweep requires a regular treasury wallet, not a contract address.");
  const [balance, latest, pending, fees] = await Promise.all([provider.getBalance(deposit.address, "pending"), provider.getTransactionCount(deposit.address, "latest"), provider.getTransactionCount(deposit.address, "pending"), provider.getFeeData()]);
  if (latest !== pending) throw new SweepError("This deposit wallet already has a pending Ethereum transaction.");
  if (!fees.maxFeePerGas || fees.maxPriorityFeePerGas === null) throw new SweepError("Ethereum fees are unavailable. Retry later.");
  const maxFee = BigInt(21_000) * fees.maxFeePerGas;
  if (balance <= maxFee) throw new SweepError("Not enough ETH to cover the network fee.");
  const review: EthereumReview = { depositId, source: ethers.getAddress(deposit.address), destination: to, customer: deposit.user.email, balance: ethers.formatEther(balance), amount: ethers.formatEther(balance - maxFee), maxFee: ethers.formatEther(maxFee), nonce: latest, maxFeePerGas: String(fees.maxFeePerGas), maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas), expiresAt: Date.now() + 120_000 };
  return { review, signature: signature(review) };
}
export async function executeEthereumSweep(provider: ethers.JsonRpcProvider, review: EthereumReview, signatureValue: string, assertActive: () => Promise<void>) {
  verifyReview(review, signatureValue);
  await checkNetwork(provider);
  await reconcile(provider, review.depositId);
  const deposit = await prisma.depositAddress.findUnique({ where: { id: review.depositId } });
  if (!deposit || deposit.address.toLowerCase() !== review.source.toLowerCase()) throw new SweepError("Deposit wallet changed. Preview again.");
  const [balance, latest, pending, code, fees] = await Promise.all([provider.getBalance(review.source, "pending"), provider.getTransactionCount(review.source, "latest"), provider.getTransactionCount(review.source, "pending"), provider.getCode(review.destination), provider.getFeeData()]);
  if (balance !== ethers.parseEther(review.balance) || latest !== review.nonce || pending !== latest || code !== "0x") throw new SweepError("Wallet state changed. Preview again before sending.");
  if (!fees.maxFeePerGas || fees.maxFeePerGas > BigInt(review.maxFeePerGas)) throw new SweepError("Network fees increased. Preview again.");
  const derived = getDepositAddress(deposit.derivationIndex);
  if (derived.address.toLowerCase() !== review.source.toLowerCase()) throw new SweepError("Deposit wallet signing identity does not match.");
  const signer = new ethers.Wallet(derived.privateKey);
  const raw = await signer.signTransaction({ chainId: 1, type: 2, nonce: review.nonce, to: review.destination, value: ethers.parseEther(review.amount), gasLimit: 21_000, maxFeePerGas: BigInt(review.maxFeePerGas), maxPriorityFeePerGas: BigInt(review.maxPriorityFeePerGas) });
  const hash = ethers.keccak256(raw);
  await assertActive();
  // Ledger amounts are USD-denominated. Exact ETH is kept in journal metadata;
  // sweeping never alters customer credit or Base deposit tracking.
  await prisma.transaction.create({ data: { userId: deposit.userId, type: "sweep", amount: "0", txHash: hash, description: prefix + deposit.id + ":" + JSON.stringify({ chainId: 1, token: "ETH", amount: review.amount, maxFee: review.maxFee, destination: review.destination }) } });
  try {
    await assertActive();
    await provider.broadcastTransaction(raw);
    return { hash, status: "submitted" };
  } catch {
    // Never erase this journal or blindly retry after an ambiguous broadcast.
    return { hash, status: "unconfirmed" };
  }
}
