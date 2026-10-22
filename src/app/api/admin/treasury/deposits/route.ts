import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBaseProvider, getUsdcContract, getUsdtContract, formatUsdc, parseUsdc } from "@/lib/wallet";
import { sweepDeposits } from "@/lib/deposit-detector";
import { DepositJobBusy, withDepositJob } from "@/lib/deposit-job";
import type { DepositRow, DepositSnapshot } from "@/lib/deposit-snapshot";
import { gasSponsorStatus } from "@/lib/usdc-gas-sponsor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
async function authorize() {
  try { await requireAdmin(); return null; }
  catch (e) { return reply({ error: "Admin access required" }, e instanceof Error && e.message === "Forbidden" ? 403 : 401); }
}
function destination() {
  const value = process.env.TREASURY_WALLET_ADDRESS;
  return value && ethers.isAddress(value) && value !== ethers.ZeroAddress ? ethers.getAddress(value) : null;
}

export async function GET(req: NextRequest) {
  const denied = await authorize(); if (denied) return denied;
  const page = Number(req.nextUrl.searchParams.get("page") || 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000) return reply({ error: "Invalid page" }, 400);
  try {
    const deposits = await prisma.depositAddress.findMany({
      orderBy: { id: "asc" }, skip: page * 20, take: 21,
      include: { user: { select: { email: true } } },
    });
    const provider = getBaseProvider();
    if ((await provider.getNetwork()).chainId !== BigInt(8453)) throw new Error("Wrong network");
    const usdc = getUsdcContract(provider), usdt = getUsdtContract(provider);
    const rows: DepositRow[] = [];
    const visible = deposits.slice(0, 20);
    // Bound RPC concurrency and paginate rather than scanning every customer per refresh.
    for (let offset = 0; offset < visible.length; offset += 4) {
      rows.push(...await Promise.all(visible.slice(offset, offset + 4).map(async deposit => {
        const row: DepositRow = { id: deposit.id, address: deposit.address, customer: deposit.user.email,
          eth: null, usdc: null, usdt: null, awaitingCredit: false, error: null };
        try {
          const [eth, dc, dt]: bigint[] = await Promise.all([provider.getBalance(deposit.address), usdc.balanceOf(deposit.address), usdt.balanceOf(deposit.address)]);
          row.eth = ethers.formatEther(eth); row.usdc = formatUsdc(dc); row.usdt = formatUsdc(dt);
          row.awaitingCredit = dc > parseUsdc(String(deposit.lastSeenBalance));
        } catch { row.error = "Balance unavailable. Refresh before sweeping."; }
        return row;
      })));
    }
    const snapshot: DepositSnapshot = { rows, page, hasMore: deposits.length > 20, checkedAt: new Date().toISOString(), treasury: destination(),
      signingConfigured: !!process.env.HD_WALLET_SEED_PHRASE, gasSponsor: await gasSponsorStatus(provider) };
    return reply(snapshot);
  } catch { return reply({ error: "Customer deposit balances could not be loaded. Please retry." }, 503); }
}

export async function POST(req: NextRequest) {
  const denied = await authorize(); if (denied) return denied;
  // Cookie-authenticated mutation: require same-origin JSON requests.
  if (req.headers.get("origin") !== req.nextUrl.origin || !req.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Invalid request origin" }, 403);
  let input: { depositId?: string; treasury?: string; confirmed?: boolean };
  try { input = await req.json(); } catch { return reply({ error: "Invalid request" }, 400); }
  const treasury = destination();
  if (!input || typeof input.depositId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.depositId) || input.confirmed !== true) return reply({ error: "Select a deposit and confirm the sweep" }, 400);
  if (!treasury || input.treasury?.toLowerCase() !== treasury.toLowerCase()) return reply({ error: "Treasury destination changed. Refresh and review again." }, 409);
  if (!process.env.HD_WALLET_SEED_PHRASE) return reply({ error: "Server wallet signing is not configured." }, 503);
  try {
    const result = await withDepositJob(async assertActive => {
      const deposit = await prisma.depositAddress.findUnique({ where: { id: input.depositId } });
      if (!deposit) return null;
      const failures: string[] = [];
      const sweeps = await sweepDeposits(deposit.id, token => { failures.push(token); }, assertActive, { allowSponsored: true });
      return { sweeps, failures };
    });
    if (!result) return reply({ error: "Deposit address not found" }, 404);
    return reply({ ...result, message: result.failures.length
      ? "Some tokens could not be swept. Check the gas wallet balance and fee limit for sponsored USDC; other transfers need ETH in the deposit wallet. Refresh balances and check wallet activity before retrying; a transaction may still be pending."
      : result.sweeps.length ? "Sweep confirmed on Base. Funds moved to the main wallet."
      : "No funds were swept. The scheduled job may already have moved them. Refresh balances." });
  } catch (e) {
    if (e instanceof DepositJobBusy) return reply({ error: e.message }, 409);
    return reply({ error: "Sweep could not complete. Check wallet activity and refresh before retrying." }, 503);
  }
}
