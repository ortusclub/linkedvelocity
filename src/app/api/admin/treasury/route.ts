import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { requireAdmin } from "@/lib/auth";
import { getBaseBalanceProvider } from "@/lib/base-balance-provider";
import { getStripe } from "@/lib/stripe";
import { BASE_CHAIN_ID, BASE_TOKENS, TOKEN_ABI, stripeBalances, type TreasurySnapshot, type TreasuryToken } from "@/lib/treasury";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try { await requireAdmin(); }
  catch (e) { return NextResponse.json({ error: "Admin access required" }, { status: e instanceof Error && e.message === "Forbidden" ? 403 : 401, headers }); }

  const snapshot: TreasurySnapshot = {
    checkedAt: new Date().toISOString(),
    stripe: { status: "unavailable", live: null, balances: [], error: null },
    crypto: { address: null, network: "Base", assets: [], error: null },
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
      // No fallback destination: a treasury must be explicitly configured.
      const address = process.env.TREASURY_WALLET_ADDRESS?.trim();
      if (!address || !ethers.isAddress(address) || address.toLowerCase() === ethers.ZeroAddress) {
        snapshot.crypto.error = "The main treasury wallet address is not configured correctly."; return;
      }
      snapshot.crypto.address = ethers.getAddress(address);
      let provider: ethers.JsonRpcProvider | undefined;
      try {
        provider = await getBaseBalanceProvider();
        const reader = provider;
        if ((await provider.getNetwork()).chainId !== BigInt(BASE_CHAIN_ID)) throw new Error("Wrong network");
        const prices = fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD", { signal: AbortSignal.timeout(5_000), cache: "no-store" })
          .then(async r => r.ok ? (await r.json()).data?.rates as Record<string, string> : null).catch(() => null);
        const assets = await Promise.all((Object.keys(BASE_TOKENS) as TreasuryToken[]).map(async token => {
          try {
            const config = BASE_TOKENS[token];
            const units: bigint = config.contract
              ? await new ethers.Contract(config.contract, TOKEN_ABI, reader).balanceOf(address)
              : await reader.getBalance(address);
            return { token, amount: ethers.formatUnits(units, config.decimals), usdValue: null as number | null, error: null as string | null };
          } catch { return { token, amount: null, usdValue: null, error: "Balance unavailable. Retry to refresh." }; }
        }));
        const rates = await prices;
        snapshot.crypto.assets = assets.map(asset => {
          const rate = Number(rates?.[asset.token]);
          const usdValue = asset.amount !== null && Number.isFinite(rate) && rate > 0 ? Number(asset.amount) / rate : null;
          return { ...asset, usdValue: usdValue !== null && Number.isFinite(usdValue) ? usdValue : null };
        });
      } catch { snapshot.crypto.error = "Base balances could not be loaded. Check the RPC connection and network, then retry."; }
      finally { provider?.destroy(); }
    })(),
  ]);
  snapshot.checkedAt = new Date().toISOString();
  return NextResponse.json(snapshot, { headers });
}
