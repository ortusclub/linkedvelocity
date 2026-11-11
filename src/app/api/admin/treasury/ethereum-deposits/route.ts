import { ethers } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withEthereumDepositJob, DepositJobBusy } from "@/lib/deposit-job";
import { ethereumProvider, withEthereumRead, previewEthereumSweep, executeEthereumSweep, SweepError } from "@/lib/ethereum-sweep";
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
      try {
        const values = await withEthereumRead(async provider => {
          const result: [string, string][] = [];
          // Bound simultaneous RPC reads; public nodes may reject large batches.
          for (let i = 0; i < rows.length; i += 4) {
            result.push(...await Promise.all(rows.slice(i, i + 4).map(async row => [row.id, ethers.formatEther(await provider.getBalance(row.address))] as [string, string])));
          }
          return result;
        });
        for (const [id, balance] of values) balances.set(id, balance);
      } catch { /* Keep unavailable balances unknown, never zero. */ }
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
  if (input.action === "preview") {
    try { return reply(await withEthereumRead(provider => previewEthereumSweep(provider, input.depositId))); }
    catch (error) { return reply({ error: error instanceof SweepError ? error.message : "Could not review this payment. No transfer was submitted by this review. Please retry." }, 503); }
  }
  const provider = ethereumProvider();
  try {
    return reply(await withEthereumDepositJob(assertActive => executeEthereumSweep(provider, input.review, input.signature, assertActive)));
  } catch (e) { return reply({ error: e instanceof SweepError || e instanceof DepositJobBusy ? e.message : "Ethereum sweep could not complete. Refresh and check transaction history before retrying." }, 409); }
  finally { provider.destroy(); }
}
