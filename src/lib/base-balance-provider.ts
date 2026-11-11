import { ethers } from "ethers";

// Balance displays may fail over without changing the RPC used by signers,
// deposit detection, crediting, or automatic sweeps.
class BalanceProvider extends ethers.JsonRpcProvider {
  async broadcastTransaction(): Promise<ethers.TransactionResponse> {
    throw new Error("Balance provider cannot broadcast transactions");
  }
}
const failedUntil = new Map<string, number>();
export async function getBaseBalanceProvider(): Promise<ethers.JsonRpcProvider> {
  const urls = [...new Set([process.env.BASE_RPC_URL, "https://mainnet.base.org", "https://base.drpc.org"].filter((url): url is string => !!url))];
  for (const url of urls) {
    if ((failedUntil.get(url) || 0) > Date.now()) continue;
    try {
      // Bound network detection before constructing ethers, whose default
      // throttling can otherwise retry an exhausted monthly quota for minutes.
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }), signal: AbortSignal.timeout(3_000), cache: "no-store" });
      const body = await response.json();
      if (!response.ok || body.error || body.result !== "0x2105") throw new Error("Base RPC unavailable");
      const request = new ethers.FetchRequest(url);
      request.timeout = 5_000;
      request.setThrottleParams({ maxAttempts: 1 });
      const provider = new BalanceProvider(request, 8453, { staticNetwork: true });
      // Network-ID alone can work on a provider that rejects data requests.
      try { await provider.getBlockNumber(); } catch { provider.destroy(); throw new Error("Base reads unavailable"); }
      failedUntil.delete(url);
      return provider;
    } catch {
      // Never log RPC URLs or raw transport errors (they can contain API keys).
      failedUntil.set(url, Date.now() + 60_000);
    }
  }
  throw new Error("Base balance providers are unavailable. Retry shortly.");
}
