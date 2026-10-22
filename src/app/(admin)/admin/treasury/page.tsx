"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ethers, type Eip1193Provider } from "ethers";
import { ArrowUpRight, Building2, CheckCircle2, ExternalLink, RefreshCw, Wallet } from "lucide-react";
import TreasuryDeposits from "@/components/admin/TreasuryDeposits";
import { type TreasurySnapshot, type TransferToken } from "@/lib/treasury";
import { prepareTreasuryTransfer, requestTreasuryTransfer, transferError, type TransferReview } from "@/lib/treasury-transfer";

const card = { background: "var(--card)", border: "1px solid var(--card-border)" };
const inputStyle = { background: "var(--input-bg)", color: "var(--text)", border: "1px solid var(--input-border)" };
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const money = (amount: string, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount));
const amountText = (n: string) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(Number(n));
const pendingKey = "lv-treasury-pending-transfer";
type Pending = { hash: string; source: string; destination: string; amount: string; token: TransferToken };

function walletProvider(): Eip1193Provider {
  const ethereum = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (!ethereum) throw new Error("Open this page in a browser with MetaMask or another Ethereum wallet installed. Your private key is never requested here.");
  return ethereum;
}

export default function TreasuryPage() {
  const [data, setData] = useState<TreasurySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [token, setToken] = useState<TransferToken>("USDC");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [review, setReview] = useState<TransferReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [receiptState, setReceiptState] = useState<"pending" | "confirmed" | "failed">("pending");
  const actionLock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/treasury", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Sign in with an admin account to view Treasury." : "Treasury could not be loaded. Please retry.");
      setData(await response.json());
    } catch (e) { setError(e instanceof Error ? e.message : "Treasury could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(pendingKey) || "null");
      if (saved && /^0x[0-9a-f]{64}$/i.test(saved.hash) && ethers.isAddress(saved.source) && ethers.isAddress(saved.destination) && ["ETH", "USDC"].includes(saved.token) && typeof saved.amount === "string") setPending(saved);
    } catch { /* Optional recovery of a transfer submitted in this browser. */ }
  }, []);
  useEffect(() => {
    if (formOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!formOpen) dialog.current?.close();
  }, [formOpen]);

  const verifyReceipt = useCallback(async (transfer: Pending) => {
    const request = new ethers.FetchRequest("https://mainnet.base.org"); request.timeout = 10_000;
    const provider = new ethers.JsonRpcProvider(request);
    try {
      const receipt = await provider.getTransactionReceipt(transfer.hash);
      if (!receipt) { setReceiptState("pending"); return; }
      setReceiptState(receipt.status === 1 ? "confirmed" : "failed");
      try { localStorage.removeItem(pendingKey); } catch {}
      await refresh();
    } catch { setTransferMessage("Confirmation could not be checked. Follow the BaseScan link before attempting another transfer."); }
    finally { provider.destroy(); }
  }, [refresh]);
  useEffect(() => {
    if (!pending || receiptState !== "pending") return;
    void verifyReceipt(pending);
    const id = setInterval(() => { void verifyReceipt(pending); }, 15_000);
    return () => clearInterval(id);
  }, [pending, receiptState, verifyReceipt]);

  function openTransfer(asset: TransferToken = "USDC") {
    setToken(asset); setAmount(""); setDestination(""); setConfirmed(false); setReview(null); setTransferMessage(""); setFormOpen(true);
  }

  async function prepare() {
    if (actionLock.current || !data?.crypto.address) return;
    actionLock.current = true; setBusy(true); setTransferMessage("");
    try { setReview(await prepareTreasuryTransfer(walletProvider(), data.crypto.address, { token, amount, destination })); }
    catch (e) { setTransferMessage(transferError(e)); }
    finally { actionLock.current = false; setBusy(false); }
  }

  async function send() {
    if (actionLock.current || !review || !confirmed) return;
    actionLock.current = true; setBusy(true); setTransferMessage("");
    try {
      // Recheck admin access and configured source immediately before requesting a signature.
      const response = await fetch("/api/admin/treasury", { cache: "no-store" });
      if (!response.ok) throw new Error("Your admin session expired. Sign in again before transferring.");
      const fresh: TreasurySnapshot = await response.json();
      if (fresh.crypto.error || fresh.crypto.address?.toLowerCase() !== review.source.toLowerCase()) throw new Error("The treasury configuration changed or is unavailable. Refresh and prepare again.");
      const hash = await requestTreasuryTransfer(walletProvider(), review);
      const submitted = { hash, source: review.source, destination: review.destination, amount: review.amount, token: review.token };
      setPending(submitted); setReceiptState("pending"); setFormOpen(false); setReview(null);
      try { localStorage.setItem(pendingKey, JSON.stringify(submitted)); } catch { /* Hash stays visible for manual tracking. */ }
    } catch (e) { setTransferMessage(transferError(e)); setReview(null); setConfirmed(false); }
    finally { actionLock.current = false; setBusy(false); }
  }

  const blocked = loading || !!error || !!data?.crypto.error || !data?.crypto.address || busy || (!!pending && receiptState === "pending");
  const knownValues = data?.crypto.assets.filter(a => a.usdValue !== null) || [];
  const allValued = data?.crypto.assets.length === 3 && knownValues.length === 3;

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-[.2em]" style={{ color: "var(--muted)" }}>Money management</p>
        <h1 className="text-3xl font-bold" style={{ fontFamily: "var(--font-grotesk)" }}>Treasury</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>Stripe funds and the main crypto wallet, in one place.</p></div>
      <div className="flex gap-2">
        <button onClick={() => void refresh()} disabled={loading || busy} className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm disabled:opacity-50" style={card}><RefreshCw size={16} className={loading ? "animate-spin" : ""} />Refresh</button>
        <button onClick={() => openTransfer()} disabled={blocked} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><ArrowUpRight size={17} />Move crypto to SwissBorg</button>
      </div>
    </header>
    {error && <p role="alert" className="rounded-xl p-4" style={{ background: "var(--warn-bg)", color: "var(--warn-num)" }}>{error} {data && "Previously loaded balances below may be stale."}</p>}
    {loading && !data && <p role="status" className="py-12 text-center" style={{ color: "var(--muted)" }}>Loading account balances…</p>}
    {data && <>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl p-6" style={card}>
          <div className="mb-5 flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-semibold"><Building2 size={20} />Stripe</h2>
            {data.stripe.status === "ready" && <span className="rounded-full px-3 py-1 text-xs" style={{ background: "var(--blue-chip-bg)", color: "var(--blue-chip-text)" }}>{data.stripe.live ? "Live account" : "Test account · no real funds"}</span>}</div>
          {data.stripe.error ? <p role="status" style={{ color: "var(--warn-num)" }}>{data.stripe.error}</p> : data.stripe.balances.length === 0 ? <p>No currency balances returned by Stripe.</p> :
            <div className="space-y-5">{data.stripe.balances.map(b => <div key={b.currency} className="grid grid-cols-2 gap-4">
              <div><p className="text-xs" style={{ color: "var(--muted)" }}>Available · {b.currency}</p><p className="mt-1 text-2xl font-semibold">{money(b.available, b.currency)}</p></div>
              <div><p className="text-xs" style={{ color: "var(--muted)" }}>Pending · {b.currency}</p><p className="mt-1 text-2xl" style={{ color: "var(--muted)" }}>{money(b.pending, b.currency)}</p></div>
            </div>)}</div>}
          <p className="mt-5 text-xs" style={{ color: "var(--muted)" }}>Pending funds are not yet available for payout. Currencies are shown separately.</p>
          <a className="mt-4 inline-flex items-center gap-1 text-sm" style={{ color: "var(--link)" }} href="https://dashboard.stripe.com/balance/overview" target="_blank" rel="noreferrer">View in Stripe<ExternalLink size={13} /></a>
        </section>
        <section className="rounded-2xl p-6" style={{ ...card, background: "var(--money-bg)", borderColor: "var(--money-border)" }}>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Wallet size={20} />Crypto treasury <span className="ml-auto text-xs font-normal" style={{ color: "var(--muted)" }}>Base</span></h2>
          <p className="mt-5 text-4xl font-semibold" style={{ color: "var(--money-num)", fontFamily: "var(--font-grotesk)" }}>{allValued ? usd(knownValues.reduce((sum, a) => sum + (a.usdValue || 0), 0)) : "—"}</p>
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>{allValued ? "Indicative USD value · ETH, USDC and USDT" : "USD total unavailable; check individual balances below."}</p>
          {data.crypto.error && <p role="status" className="mt-3" style={{ color: "var(--warn-num)" }}>{data.crypto.error}</p>}
          {data.crypto.address && <a className="mt-5 block break-all font-mono text-xs" style={{ color: "var(--link)" }} target="_blank" rel="noreferrer" href={`https://basescan.org/address/${data.crypto.address}`}>{data.crypto.address} ↗</a>}
          <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>Main wallet only. Customer deposit addresses, other networks, and other tokens are not included.</p>
        </section>
      </div>
      <section className="overflow-hidden rounded-2xl" style={card}>
        <div className="border-b p-5" style={{ borderColor: "var(--divider)" }}><h2 className="font-semibold">Crypto balances</h2><p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>USDC sweeps can use a central gas wallet. Check its status under customer deposits. The receiving wallet needs no private key on the server.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead style={{ color: "var(--muted)" }}><tr><th className="p-5">Asset</th><th className="p-5">Balance</th><th className="p-5">USD estimate</th><th className="p-5">SwissBorg transfer</th></tr></thead>
          <tbody>{data.crypto.assets.map(a => <tr key={a.token} className="border-t" style={{ borderColor: "var(--divider)" }}><th className="p-5 font-semibold">{a.token}<span className="mt-1 block text-xs font-normal" style={{ color: "var(--muted)" }}>Base{a.token === "USDT" ? " · bridged USDT" : ""}</span></th>
            <td className="p-5" title={a.amount ?? undefined}>{a.amount === null ? <span style={{ color: "var(--warn-num)" }}>{a.error}</span> : amountText(a.amount)}</td><td className="p-5">{a.usdValue === null ? "Unavailable" : usd(a.usdValue)}</td>
            <td className="p-5">{a.token === "USDT" ? <span className="text-xs" style={{ color: "var(--muted)" }}>Convert to native USDC in your wallet first.<br />USDT on Base is not supported by this transfer flow.</span> : <button disabled={blocked || a.amount === null || Number(a.amount) <= 0} onClick={() => openTransfer(a.token as TransferToken)} className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40" style={{ background: "var(--blue-chip-bg)", color: "var(--blue-chip-text)" }}>Move {a.token} ↗</button>}</td>
          </tr>)}</tbody></table></div>
      </section>
      <p className="text-xs" style={{ color: "var(--muted)" }}>Checked {new Date(data.checkedAt).toLocaleString()}. USD estimates use Coinbase exchange rates and are not executable quotes. These balances are held funds, not profit.</p>
    </>}
    <TreasuryDeposits onSwept={refresh} />
    {pending && <section role="status" className="rounded-2xl p-5" style={card}>
      <h2 className="flex items-center gap-2 font-semibold">{receiptState === "confirmed" && <CheckCircle2 size={18} style={{ color: "var(--green)" }} />}{receiptState === "confirmed" ? "Transfer confirmed on Base" : receiptState === "failed" ? "Transfer reverted" : "Transfer submitted · awaiting confirmation"}</h2>
      <p className="mt-2 text-sm">{pending.amount} {pending.token} → <span className="break-all font-mono text-xs">{pending.destination}</span></p>
      <a className="mt-3 inline-block text-sm" style={{ color: "var(--link)" }} href={`https://basescan.org/tx/${pending.hash}`} target="_blank" rel="noreferrer">View transaction on BaseScan ↗</a>
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>{receiptState === "confirmed" ? "SwissBorg may need additional confirmations before crediting your account." : receiptState === "failed" ? "The transfer did not complete. Network fees may still apply." : "Do not resend while this transaction is pending. This status is saved in this browser."}</p>
      {transferMessage && <p className="mt-2 text-sm" style={{ color: "var(--warn-num)" }}>{transferMessage}</p>}
    </section>}
    <dialog aria-labelledby="treasury-transfer-title" ref={dialog} onCancel={e => { if (busy) e.preventDefault(); else setFormOpen(false); }} className="m-auto w-[min(94vw,560px)] rounded-2xl p-0 backdrop:bg-black/60" style={{ ...card, color: "var(--text)" }}>
      <div className="p-6"><h2 id="treasury-transfer-title" className="text-xl font-semibold">Move crypto to SwissBorg</h2><p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>Direct transfer on Base. Review and approve it in your wallet.</p>
        {!review ? <form onSubmit={e => { e.preventDefault(); void prepare(); }} className="mt-5 space-y-4">
          <label className="block text-sm">Asset<select value={token} onChange={e => setToken(e.target.value as TransferToken)} disabled={busy} className="mt-1 w-full rounded-lg p-3" style={inputStyle}><option value="USDC">USDC on Base</option><option value="ETH">ETH on Base</option></select></label>
          <label className="block text-sm">Amount ({token})<input required inputMode="decimal" autoComplete="off" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} className="mt-1 w-full rounded-lg p-3" style={inputStyle} placeholder="0.00" /></label>
          <label className="block text-sm">SwissBorg {token} deposit address · Base<input required autoComplete="off" spellCheck={false} value={destination} onChange={e => setDestination(e.target.value.trim())} disabled={busy} className="mt-1 w-full rounded-lg p-3 font-mono text-xs" style={inputStyle} placeholder="0x…" /></label>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Copy a fresh address from SwissBorg → Deposit → {token} → Base. Check any minimum deposit shown there. No swaps or bridges are performed.</p>
          <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setFormOpen(false)} className="rounded-lg px-4 py-2 text-sm">Cancel</button><button disabled={busy} type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking wallet…" : "Connect wallet & review"}</button></div>
        </form> : <div className="mt-5 space-y-4">
          <div className="rounded-xl p-4" style={{ background: "var(--blue-chip-bg)" }}><p className="text-2xl font-semibold">{review.amount} {review.token}</p><p className="mt-2 text-sm">Network: Base</p><p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>From treasury</p><p className="break-all font-mono text-xs">{review.source}</p><p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>To SwissBorg deposit address</p><p className="break-all font-mono text-xs">{review.destination}</p></div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>The final network fee is shown in your wallet. Confirm the amount, network, and full destination there before signing.</p>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />I checked this address in SwissBorg for {review.token} on Base and confirmed its deposit requirements.</label>
          <div className="flex justify-end gap-3"><button disabled={busy} onClick={() => { setReview(null); setConfirmed(false); }} className="rounded-lg px-4 py-2 text-sm">Back</button><button disabled={busy || !confirmed} onClick={() => void send()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Confirm in your wallet…" : "Confirm in wallet"}</button></div>
        </div>}
        {transferMessage && <p role="alert" className="mt-4 text-sm" style={{ color: "var(--warn-num)" }}>{transferMessage}</p>}
      </div>
    </dialog>
  </div>;
}
