import { ethers } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withDepositJob, DepositJobBusy } from "@/lib/deposit-job";
import { ethereumProvider, previewEthereumSweep, executeEthereumSweep, SweepError } from "@/lib/ethereum-sweep";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function authorize() { try { await requireAdmin(); return null; } catch { return reply({ error: "Admin access required" }, 403); } }
export async function GET(req: NextRequest) {
  const denied = await authorize(); if (denied) return denied;
  const search = (req.nextUrl.searchParams.get("search") || "").trim().slice(0, 150);
  try {
    const rows = await prisma.depositAddress.findMany({ where: search ? { user: { OR: [{ email: { contains: search, mode: "insensitive" } }, { fullName: { contains: search, mode: "insensitive" } }] } } : {}, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, address: true, user: { select: { email: true, fullName: true } } } });
    const journals = await prisma.transaction.findMany({ where: { type: "sweep", description: { startsWith: "Ethereum ETH sweep" }, userId: { in: (await prisma.depositAddress.findMany({ where: { id: { in: rows.map(r => r.id) } }, select: { userId: true } })).map(r => r.userId) } }, orderBy: { createdAt: "desc" }, take: 20, select: { txHash: true, description: true } });
    const balances = new Map<string, string>();
    if (rows.length) {
      const provider = ethereumProvider();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            if ((await provider.getNetwork()).chainId !== BigInt(1)) return;
            await Promise.all(rows.map(async row => {
              try { balances.set(row.id, ethers.formatEther(await provider.getBalance(row.address))); }
              catch { /* Keep this balance unavailable, not zero. */ }
            }));
          })(),
          new Promise<void>(resolve => { timer = setTimeout(resolve, 8_000); }),
        ]);
      } catch { /* Wallet search remains available during an RPC outage. */ }
      finally { clearTimeout(timer); provider.destroy(); }
    }
    return reply({ rows: rows.map(row => ({ ...row, eth: balances.get(row.id) ?? null })), journals });
  } catch { return reply({ error: "Could not load Ethereum deposit wallets." }, 503); }
}
export async function POST(req: NextRequest) {
  const denied = await authorize(); if (denied) return denied;
  if (req.headers.get("origin") !== req.nextUrl.origin || !req.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Invalid request origin" }, 403);
  let input; try { input = await req.json(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (!input || !["preview", "confirm"].includes(input.action) || !/^[0-9a-f-]{36}$/i.test(input.action === "preview" ? input.depositId : input.review?.depositId)) return reply({ error: "Choose a deposit wallet and preview the sweep." }, 400);
  if (input.action === "confirm" && input.confirmed !== true) return reply({ error: "Confirm the Ethereum network and destination first." }, 400);
  const provider = ethereumProvider();
  try {
    return reply(await withDepositJob(async assertActive => input.action === "preview" ? previewEthereumSweep(provider, input.depositId) : executeEthereumSweep(provider, input.review, input.signature, assertActive)));
  } catch (e) { return reply({ error: e instanceof SweepError || e instanceof DepositJobBusy ? e.message : "Ethereum sweep could not complete. Refresh and check transaction history before retrying." }, 409); }
  finally { provider.destroy(); }
}
