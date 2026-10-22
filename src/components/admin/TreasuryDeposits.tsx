"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DepositRow, DepositSnapshot } from "@/lib/deposit-snapshot";

const card = { background: "var(--card)", border: "1px solid var(--card-border)" };
const muted = { color: "var(--muted)" };
type SweepResult = { message: string; sweeps: { token: string; amount: string; txHash: string }[]; failures: string[] };

export default function TreasuryDeposits({ onSwept }: { onSwept: () => Promise<void> }) {
  const [data, setData] = useState<DepositSnapshot | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<DepositRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SweepResult | null>(null);
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/admin/treasury/deposits?page=${page}`, { cache: "no-store" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Could not load deposit wallets.");
      setData(body);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load deposit wallets."); }
    finally { setLoading(false); }
  }, [page]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected) dialog.current?.close();
  }, [selected]);

  async function sweep() {
    if (!selected || !data?.treasury || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/admin/treasury/deposits", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depositId: selected.id, treasury: data.treasury, confirmed: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Sweep request failed. Check wallet activity before retrying.");
      setResult(body); setSelected(null);
      await Promise.all([refresh(), onSwept()]);
    } catch (e) { setError(e instanceof Error ? e.message : "Request interrupted. Check wallet activity before retrying."); setSelected(null); }
    finally { lock.current = false; setBusy(false); }
  }

  return <section className="rounded-2xl p-5" style={card}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Customer deposits · awaiting sweep</h2>
        <p className="mt-1 text-sm" style={muted}>USDC and bridged USDT on Base, held in customer deposit wallets. These are separate from the main wallet balance.</p></div>
      <button disabled={loading || busy} onClick={() => void refresh()} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">{loading ? "Checking deposits…" : "Refresh deposits"}</button>
    </div>
    <p className="mt-3 text-xs" style={muted}>USDC must be credited first. With central gas enabled, you submit USDC sweeps here and one gas wallet pays the fee. No ETH top-ups are sent to customer wallets. USDT still needs ETH in its deposit wallet and does not add customer credit.</p>
    {data?.gasSponsor?.enabled && <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--divider)" }}>
      <p className="font-semibold">Central gas wallet · Base</p>
      {data.gasSponsor.address && <a href={`https://basescan.org/address/${data.gasSponsor.address}`} target="_blank" rel="noreferrer" className="break-all font-mono text-xs" style={{ color: "var(--link)" }}>{data.gasSponsor.address} ↗</a>}
      <p className="mt-2 text-sm">{data.gasSponsor.eth ?? "Unavailable"} ETH · pays USDC sweep fees</p>
      {data.gasSponsor.error && <p role="status" className="mt-2 text-sm">{data.gasSponsor.error}</p>}
    </div>}
    {error && <p role="alert" className="mt-4" style={{ color: "var(--warn-num)" }}>{error}</p>}
    {data && !data.signingConfigured && <p className="mt-4" role="status">Sweep signing is not configured for this environment.</p>}
    {data && <>
      <div className="mt-4 space-y-3">{data.rows.map(row => {
        const funded = Number(row.usdc || 0) > 0 || Number(row.usdt || 0) > 0;
        const sponsored = !!data.gasSponsor?.enabled;
        const usdcWaiting = Number(row.usdc || 0) > 0;
        const gasBlocked = usdcWaiting && sponsored ? !!data.gasSponsor?.error : Number(row.eth || 0) === 0;
        return <div key={row.id} className="rounded-xl border p-4" style={{ borderColor: "var(--divider)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><p className="break-all font-semibold">{row.customer}</p>
              <a href={`https://basescan.org/address/${row.address}`} target="_blank" rel="noreferrer" className="break-all font-mono text-xs" style={{ color: "var(--link)" }}>{row.address} ↗</a></div>
            <button disabled={loading || busy || !!error || !!row.error || !funded || row.awaitingCredit || !data.treasury || !data.signingConfigured || gasBlocked}
              onClick={() => { setSelected(row); setResult(null); }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Sweep to main wallet</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm"><span>{row.usdc ?? "Unavailable"} USDC</span><span>{row.usdt ?? "Unavailable"} USDT</span><span style={muted}>{row.eth ?? "Unavailable"} ETH for gas</span></div>
          <p className="mt-2 text-xs" style={muted}>{row.error || (row.awaitingCredit ? "USDC is awaiting customer credit. The scheduled deposit check must complete before sweeping." : funded ? (usdcWaiting && sponsored ? (data.gasSponsor?.error || "USDC ready for review · fee paid by the central gas wallet. USDT, if present, still needs deposit-wallet ETH.") : Number(row.eth) === 0 ? "Funds waiting · this deposit wallet needs ETH on Base for fees." : "Funds waiting · ready for sweep review.") : "No supported tokens waiting to be swept.")}</p>
        </div>;
      })}</div>
      {!data.rows.length && <p className="mt-4" style={muted}>No customer deposit wallets on this page.</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs" style={muted}>
        <span>Page {page + 1} · checked {new Date(data.checkedAt).toLocaleTimeString()}. Refresh to check for new arrivals.</span>
        <div className="flex gap-4"><button disabled={page === 0 || loading || busy} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40">Previous</button><button disabled={!data.hasMore || loading || busy} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40">Next</button></div>
      </div>
    </>}
    {result && <div role="status" className="mt-4 rounded-xl border p-4"><p>{result.message}</p>{result.sweeps.map(tx => <a key={tx.txHash} className="mt-2 block text-sm" style={{ color: "var(--link)" }} href={`https://basescan.org/tx/${tx.txHash}`} target="_blank" rel="noreferrer">{tx.amount} {tx.token} · View confirmed transaction ↗</a>)}</div>}
    <dialog ref={dialog} aria-labelledby="sweep-title" onCancel={e => { if (busy) e.preventDefault(); else setSelected(null); }} className="m-auto w-[min(94vw,560px)] rounded-2xl p-6 backdrop:bg-black/60" style={{ ...card, color: "var(--text)" }}>
      <h2 id="sweep-title" className="text-xl font-semibold">Sweep to main wallet</h2>
      <p className="mt-3">Move all currently available USDC and USDT from this deposit wallet to the configured main wallet on Base.</p>
      <p className="mt-4 text-xs" style={muted}>From</p><p className="break-all font-mono text-xs">{selected?.address}</p>
      <p className="mt-3 text-xs" style={muted}>To main wallet</p><p className="break-all font-mono text-xs">{data?.treasury}</p>
      <p className="mt-4 font-semibold">Last checked: {selected?.usdc} USDC + {selected?.usdt} USDT</p>
      <p className="mt-3 text-sm" style={muted}>Balances are rechecked before sending. {data?.gasSponsor?.enabled ? "USDC fees are paid by the central gas wallet; no ETH is sent to the deposit wallet. USDT fees are paid by the deposit wallet." : "Fees are paid by the deposit wallet."} The website uses its stored signing keys. This does not credit the customer again.</p>
      <div className="mt-5 flex justify-end gap-3"><button disabled={busy} onClick={() => setSelected(null)} className="px-4 py-2">Cancel</button><button disabled={busy} onClick={() => void sweep()} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? "Sweeping… keep this page open" : "Confirm sweep"}</button></div>
    </dialog>
  </section>;
}
