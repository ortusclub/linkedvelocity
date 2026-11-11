import type { DepositSnapshot } from "./deposit-snapshot";
import type { EthereumReview } from "./ethereum-sweep";
export type Payment = { key: string; id: string; network: "Ethereum" | "Base"; customer: string; name: string; address: string; receivedAt: string | null; amount: string; blocked: string | null; unknown: boolean; dust?: boolean; treasury: string | null };
export type EthPage = { rows: { id: string; address: string; eth: string | null; belowFee?: boolean; receivedAt?: string | null; user: { email: string; fullName: string } }[]; page: number; hasMore: boolean };
export type PaymentPlan = { payment: Payment; eth?: { review: EthereumReview; signature: string } };
export function paymentsFromBase(data: DepositSnapshot): Payment[] {
  return data.rows.filter(r => r.usdc === null || r.usdt === null || Number(r.usdc) > 0 || Number(r.usdt) > 0).map(r => {
    const unknown = r.usdc === null || r.usdt === null;
    const blocked = r.error || (unknown ? "Unable to check balance" : !data.treasury || !data.signingConfigured ? "Sweep configuration unavailable" : r.awaitingCredit ? "Waiting for customer credit" : Number(r.usdc) > 0 && data.gasSponsor?.enabled ? data.gasSponsor.error : Number(r.eth || 0) <= 0 ? "Needs ETH for network fees" : null);
    return {key:`Base:${r.id}`,id:r.id,network:"Base",customer:r.customer,name:r.name || r.customer,address:r.address,receivedAt:r.receivedAt || null,amount:unknown ? "Unable to check" : [Number(r.usdc)>0 ? `${r.usdc} USDC` : "",Number(r.usdt)>0 ? `${r.usdt} USDT` : ""].filter(Boolean).join(" + "),blocked,unknown,treasury:data.treasury};
  });
}
export function paymentsFromEthereum(data: EthPage): Payment[] {
  return data.rows.filter(r => r.eth === null || Number(r.eth) > 0).map(r => ({key:`Ethereum:${r.id}`,id:r.id,network:"Ethereum",customer:r.user.email,name:r.user.fullName || r.user.email,address:r.address,receivedAt:r.receivedAt || null,amount:r.eth === null ? "Unable to check" : `${r.eth} ETH`,blocked:r.eth === null ? "Unable to check balance" : r.belowFee ? "Below network fee" : null,unknown:r.eth === null,dust:!!r.belowFee,treasury:null}));
}
// Only explicit confirmation calls this. Stop on any uncertain/failed response;
// retain every previously received hash and never retry a send automatically.
export async function executePayments(plans: PaymentPlan[], send: (plan: PaymentPlan) => Promise<{ hashes: string[]; uncertain: boolean }>, progress: (key: string, hashes: string[], uncertain: boolean) => void) {
  for (const plan of plans) {
    if (plan.eth && Date.now() > plan.eth.review.expiresAt) throw new Error("Fee review expired. Remaining payments were not submitted; review again.");
    const result = await send(plan);
    progress(plan.payment.key, result.hashes, result.uncertain);
    if (result.uncertain) throw new Error("Stopped: a transfer needs confirmation. Check its transaction before retrying. Remaining payments were not submitted.");
  }
}
