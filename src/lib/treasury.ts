import { ethers } from "ethers";

export const BASE_CHAIN_ID = 8453;
export const BASE_TOKENS = {
  ETH: { decimals: 18, contract: null },
  USDC: { decimals: 6, contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  USDT: { decimals: 6, contract: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2" },
} as const;
export type TreasuryToken = keyof typeof BASE_TOKENS;
export type TransferToken = "ETH" | "USDC";
export const ETH_RESERVE = "0.001";
export const TOKEN_ABI = ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"];

export interface TreasurySnapshot {
  checkedAt: string;
  stripe: {
    status: "ready" | "unavailable";
    live: boolean | null;
    balances: { currency: string; available: string; pending: string }[];
    error: string | null;
  };
  crypto: {
    address: string | null;
    network: "Base" | "Ethereum + Base";
    assets: { network?: "Ethereum" | "Base"; token: TreasuryToken; amount: string | null; usdValue: number | null; error: string | null }[];
    error: string | null;
  };
}

// Stripe uses its own minor-unit convention (not Intl currency formatting).
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf"]);
export function stripeMajorAmount(amount: number, currency: string): string {
  if (!Number.isSafeInteger(amount)) throw new Error("Invalid Stripe amount");
  return ethers.formatUnits(BigInt(amount), ZERO_DECIMAL.has(currency.toLowerCase()) ? 0 : 2);
}

export function stripeBalances(balance: {
  available: { currency: string; amount: number }[];
  pending: { currency: string; amount: number }[];
}) {
  const currencies = [...new Set([...balance.available, ...balance.pending].map(v => v.currency.toLowerCase()))].sort();
  return currencies.map(currency => ({
    currency: currency.toUpperCase(),
    available: stripeMajorAmount(balance.available.filter(v => v.currency.toLowerCase() === currency).reduce((n, v) => n + v.amount, 0), currency),
    pending: stripeMajorAmount(balance.pending.filter(v => v.currency.toLowerCase() === currency).reduce((n, v) => n + v.amount, 0), currency),
  }));
}

export function validateTransfer(input: { token: string; amount: string; destination: string }, source: string) {
  if (input.token !== "USDC" && input.token !== "ETH") throw new Error("Only USDC and ETH on Base can be sent directly from Treasury.");
  if (!ethers.isAddress(input.destination) || input.destination.toLowerCase() === ethers.ZeroAddress) throw new Error("Enter a valid SwissBorg Base deposit address.");
  const destination = ethers.getAddress(input.destination);
  if (destination.toLowerCase() === source.toLowerCase()) throw new Error("The destination must differ from the treasury wallet.");
  if (Object.values(BASE_TOKENS).some(t => t.contract?.toLowerCase() === destination.toLowerCase())) throw new Error("Use your deposit address, not a token contract address.");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.amount) || input.amount.length > 80) throw new Error("Enter a positive amount without commas or exponent notation.");
  const token = input.token as TransferToken;
  let units: bigint;
  try { units = ethers.parseUnits(input.amount, BASE_TOKENS[token].decimals); }
  catch { throw new Error(`Use at most ${BASE_TOKENS[token].decimals} decimal places.`); }
  if (units <= BigInt(0)) throw new Error("The amount must be greater than zero.");
  return { token, destination, units, amount: ethers.formatUnits(units, BASE_TOKENS[token].decimals) };
}

export function assertTransferFunds(token: TransferToken, units: bigint, tokenBalance: bigint, ethBalance: bigint) {
  if (units > tokenBalance) throw new Error("The amount exceeds the current balance.");
  const remainingEth = token === "ETH" ? ethBalance - units : ethBalance;
  if (remainingEth < ethers.parseEther(ETH_RESERVE)) throw new Error(`Keep at least ${ETH_RESERVE} ETH in the treasury for customer sweeps and network fees.`);
}
