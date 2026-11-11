import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { withEthereumRead } from "@/lib/ethereum-sweep";
import { getBaseBalanceProvider } from "@/lib/base-balance-provider";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  try { await requireAdmin(); } catch { return reply({ error: "Admin access required" }, 403); }
  const hash = req.nextUrl.searchParams.get("hash") || "";
  const network = req.nextUrl.searchParams.get("network");
  if (!/^0x[0-9a-f]{64}$/i.test(hash) || !["Ethereum", "Base"].includes(network || "")) return reply({ error: "Invalid transaction" }, 400);
  try {
    const receipt = network === "Ethereum" ? await withEthereumRead(p => p.getTransactionReceipt(hash)) : await (async () => { const p = await getBaseBalanceProvider(); try { return await p.getTransactionReceipt(hash); } finally { p.destroy(); } })();
    return reply({ status: !receipt ? "pending" : receipt.status === 1 ? "confirmed" : "failed" });
  } catch { return reply({ error: "Confirmation unavailable; do not resend." }, 503); }
}
