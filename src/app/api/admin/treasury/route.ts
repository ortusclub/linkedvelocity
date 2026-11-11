import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { requireAdmin } from "@/lib/auth";
import { getBaseBalanceProvider } from "@/lib/base-balance-provider";
import { withEthereumRead } from "@/lib/ethereum-sweep";
import { getStripe } from "@/lib/stripe";
import { BASE_CHAIN_ID, BASE_TOKENS, TOKEN_ABI, stripeBalances, type TreasurySnapshot, type TreasuryToken } from "@/lib/treasury";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const ETHEREUM_TOKENS = {
  ETH: { decimals: 18, contract: null },
  USDC: { decimals: 6, contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  USDT: { decimals: 6, contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
} as const;
type Asset = TreasurySnapshot["crypto"]["assets"][number];
async function readAssets(provider: ethers.JsonRpcProvider, address: string, network: "Ethereum" | "Base"): Promise<Asset[]> {
  const tokens = network === "Base" ? BASE_TOKENS : ETHEREUM_TOKENS;
  const assets = await Promise.all((Object.keys(tokens) as TreasuryToken[]).map(async token => {
    try {
      const config = tokens[token];
      const units: bigint = config.contract ? await new ethers.Contract(config.contract, TOKEN_ABI, provider).balanceOf(address) : await provider.getBalance(address);
      return { network, token, amount: ethers.formatUnits(units, config.decimals), usdValue: null, error: null };
    } catch { return { network, token, amount: null, usdValue: null, error: "Balance unavailable. Retry to refresh." }; }
  }));
  if (assets.every(a => a.amount === null)) throw new Error("Network balance reads unavailable");
  return assets;
}
function unknownAssets(network: "Ethereum" | "Base"): Asset[] {
  return (["ETH", "USDC", "USDT"] as const).map(token => ({ network, token, amount: null, usdValue: null, error: `${network} balance unavailable` }));
}
export async function GET() {
  try { await requireAdmin(); }
  catch (e) { return NextResponse.json({ error: "Admin access required" }, { status: e instanceof Error && e.message === "Forbidden" ? 403 : 401, headers }); }
  const snapshot: TreasurySnapshot = {
    checkedAt: new Date().toISOString(),
    stripe: { status: "unavailable", live: null, balances: [], error: null },
    crypto: { address: null, network: "Ethereum + Base", assets: [], error: null },
  };
  await Promise.allSettled([
    (async () => {
      if (!process.env.STRIPE_SECRET_KEY) { snapshot.stripe.error = "Stripe is not configured for this environment."; return; }
      try {
        const b = await getStripe().balance.retrieve({}, { timeout: 10_000, maxNetworkRetries: 0 });
        snapshot.stripe = { status: "ready", live: b.livemode, balances: stripeBalances(b), error: null };
      } catch { snapshot.stripe.error = "Stripe balance could not be loaded. Check the connection and balance-read permission, then retry."; }
    })(),
    (async () => {
      const address = process.env.TREASURY_WALLET_ADDRESS?.trim();
      if (!address || !ethers.isAddress(address) || address.toLowerCase() === ethers.ZeroAddress) {
        snapshot.crypto.error = "The main treasury wallet address is not configured correctly."; return;
      }
      snapshot.crypto.address = ethers.getAddress(address);
      const prices = fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD", { signal: AbortSignal.timeout(5_000), cache: "no-store" })
        .then(async r => r.ok ? (await r.json()).data?.rates as Record<string, string> : null).catch(() => null);
      const [base, ethereum, rates] = await Promise.all([
        (async () => {
          let provider: ethers.JsonRpcProvider | undefined;
          try { provider = await getBaseBalanceProvider(); if ((await provider.getNetwork()).chainId !== BigInt(BASE_CHAIN_ID)) throw new Error("Wrong network"); return await readAssets(provider, address, "Base"); }
          catch { return unknownAssets("Base"); } finally { provider?.destroy(); }
        })(),
        withEthereumRead(provider => readAssets(provider, address, "Ethereum")).catch(() => unknownAssets("Ethereum")),
        prices,
      ]);
      snapshot.crypto.assets = [...ethereum, ...base].map(asset => {
        const rate = Number(rates?.[asset.token]);
        const value = asset.amount !== null && Number.isFinite(rate) && rate > 0 ? Number(asset.amount) / rate : null;
        return { ...asset, usdValue: value !== null && Number.isFinite(value) ? value : null };
      });
      if (snapshot.crypto.assets.some(a => a.amount === null)) snapshot.crypto.error = "Some wallet balances could not be checked. The displayed subtotal excludes them.";
    })(),
  ]);
  snapshot.checkedAt = new Date().toISOString();
  return NextResponse.json(snapshot, { headers });
}
