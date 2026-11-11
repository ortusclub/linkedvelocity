import { ethers } from "ethers";

// Select a healthy transport BEFORE a user-confirmed sweep. Never retry a
// signed transaction on another provider after broadcast uncertainty.
export async function getBaseSweepProvider(): Promise<ethers.JsonRpcProvider> {
  const urls = [...new Set([process.env.BASE_RPC_URL, "https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.drpc.org"].filter((url): url is string => !!url))];
  for (const url of urls) {
    let provider: ethers.JsonRpcProvider | undefined;
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }), signal: AbortSignal.timeout(3_000), cache: "no-store" });
      const body = await response.json();
      if (!response.ok || body.error || body.result !== "0x2105") throw new Error("Wrong or unavailable network");
      const request = new ethers.FetchRequest(url);
      request.timeout = 5_000;
      request.setThrottleParams({ maxAttempts: 1 });
      provider = new ethers.JsonRpcProvider(request, 8453, { staticNetwork: true, batchMaxCount: 1 });
      await provider.getBlockNumber();
      return provider;
    } catch { provider?.destroy(); }
  }
  throw new Error("Base sweep connection is unavailable. No transfer was submitted. Try again shortly.");
}
