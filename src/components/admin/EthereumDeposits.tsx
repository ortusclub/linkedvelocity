"use client";
import { useEffect, useRef, useState } from "react";
import type { EthereumReview } from "@/lib/ethereum-sweep";
type Row = { id: string; address: string; user: { email: string; fullName: string } };
type Review = { review: EthereumReview; signature: string };
const card = { background: "var(--card)", border: "1px solid var(--card-border)" };
export default function EthereumDeposits() {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [journals, setJournals] = useState<{ txHash: string | null; description: string | null }[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ hash: string; status: string } | null>(null);
  const lock = useRef(false);
  async function load(query: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const r = await fetch(`/api/admin/treasury/ethereum-deposits?search=${encodeURIComponent(query)}`, { cache: "no-store" });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setRows(data.rows); setJournals(data.journals);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load wallets."); }
    finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => { void load(""); }, []);
  async function action(body: object) {
    const r = await fetch("/api/admin/treasury/ethereum-deposits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json(); if (!r.ok) throw new Error(data.error); return data;
  }
  async function preview(depositId: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setReview(null); setConfirmed(false);
    try { setReview(await action({ action: "preview", depositId })); }
    catch (e) { setError(e instanceof Error ? e.message : "Preview unavailable."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function send() {
    if (lock.current || !review || !confirmed) return;
    lock.current = true; setBusy(true); setError("");
    try { setResult(await action({ action: "confirm", ...review, confirmed: true })); }
    catch (e) { setError(e instanceof Error ? e.message : "Check transaction history before retrying."); }
    finally { setReview(null); setConfirmed(false); lock.current = false; setBusy(false); }
  }
  return <section className="rounded-2xl p-5 space-y-4" style={card} aria-labelledby="ethereum-deposits-title">
    <h2 id="ethereum-deposits-title" className="font-semibold">Ethereum customer deposits</h2>
    <p className="text-sm" style={{ color: "var(--muted)" }}>Recover native ETH received on Ethereum mainnet. These wallets are separate from the Base balances above. Sweeping moves funds to treasury without adding customer credit.</p>
    <form onSubmit={e => { e.preventDefault(); setReview(null); void load(search); }} className="flex gap-3">
      <input aria-label="Customer name or email" placeholder="Search customer name or email" value={search} onChange={e => setSearch(e.target.value)} disabled={busy} className="min-w-0 flex-1 rounded-lg border p-2" style={card} />
      <button disabled={busy} className="rounded-lg border px-4 py-2 disabled:opacity-50">{busy ? "Checking…" : "Search / refresh"}</button>
    </form>
    <p className="text-xs" style={{ color: "var(--muted)" }}>Up to 20 matching wallets. Preview checks the current ETH balance and fee.</p>
    {rows.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3" style={{ borderColor: "var(--divider)" }}>
      <div><p className="text-sm font-semibold">{row.user.fullName} · {row.user.email}</p><a className="break-all text-xs" style={{ color: "var(--link)" }} href={`https://etherscan.io/address/${row.address}`} target="_blank" rel="noreferrer">{row.address} ↗</a></div>
      <button disabled={busy} onClick={() => void preview(row.id)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Preview ETH sweep</button>
    </div>)}
    {!busy && !rows.length && <p>No matching customer deposit wallets.</p>}
    {review && <div className="rounded-xl border p-4 space-y-3" role="region" aria-label="Review Ethereum sweep">
      <h3 className="font-semibold">Review sweep · Ethereum mainnet</h3>
      <p className="text-sm">{review.review.customer}</p>
      <p className="break-all text-xs">From: {review.review.source}<br />To treasury: {review.review.destination}</p>
      <dl className="text-sm space-y-2"><div>Wallet balance: {review.review.balance} ETH</div><div>Maximum gas fee: {review.review.maxFee} ETH</div><div className="font-semibold">Treasury receives: {review.review.amount} ETH</div></dl>
      <p className="text-xs">The fee is paid from this deposit. Any unused fee allowance stays in the deposit wallet. Review expires after two minutes.</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />I verified this treasury address accepts ETH on Ethereum mainnet and authorize this transfer.</label>
      <div className="flex gap-3"><button disabled={busy} onClick={() => setReview(null)} className="rounded-lg border px-4 py-2">Cancel</button><button disabled={busy || !confirmed} onClick={() => void send()} className="rounded-lg bg-blue-600 text-white px-4 py-2 disabled:opacity-50">{busy ? "Submitting…" : "Confirm Ethereum sweep"}</button></div>
    </div>}
    {result && <p role="status">{result.status === "submitted" ? "Sweep submitted. Awaiting Ethereum confirmation." : "Submission could not be confirmed. Do not resend; check the transaction first."} <a href={`https://etherscan.io/tx/${result.hash}`} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>View transaction ↗</a></p>}
    {journals.map(entry => <p key={entry.txHash} className="text-xs">{entry.description?.startsWith("Ethereum ETH sweep confirmed:") ? "Confirmed Ethereum sweep" : entry.description?.startsWith("Ethereum ETH sweep reverted:") ? "Reverted Ethereum sweep" : "Ethereum sweep recorded · verify confirmation"} · <a href={`https://etherscan.io/tx/${entry.txHash}`} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>{entry.txHash} ↗</a></p>)}
    {error && <p role="alert" style={{ color: "var(--warn-num)" }}>{error}</p>}
  </section>;
}
