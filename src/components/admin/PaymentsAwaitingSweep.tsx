"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { executePayments, paymentsFromBase, paymentsFromEthereum, type Payment, type PaymentPlan } from "@/lib/payment-queue";
import type { DepositSnapshot } from "@/lib/deposit-snapshot";
import type { EthPage } from "@/lib/payment-queue";
const card = { background: "var(--card)", borderColor: "var(--card-border)", color: "var(--text)" };
const storageKey = "lv-payment-sweeps-v1";
type Submitted = { key: string; network: Payment["network"]; hashes: string[]; status: "pending" | "confirmed" | "needs-check" };
async function request(url: string, body?: object) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "Request failed. Refresh before retrying."), { status: response.status });
  return data;
}
function dateText(value: string | null) {
  if (!value) return "Date not recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(value)).replace(/(\d{2}) (\w{3}) (\d{4})/, "$1-$2-$3");
}
export default function PaymentsAwaitingSweep({ onSwept }: { onSwept: () => Promise<void> }) {
  const [rows, setRows] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted[]>([]);
  const [filter, setFilter] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const actionLock = useRef(false);
  const loadLock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const submittedRef = useRef<Submitted[]>([]);
  const saveSubmitted = useCallback((items: Submitted[]) => {
    submittedRef.current = items; setSubmitted(items);
    try { localStorage.setItem(storageKey, JSON.stringify(items)); } catch { /* Current results stay visible. */ }
  }, []);
  const refresh = useCallback(async () => {
    if (loadLock.current || actionLock.current) return;
    loadLock.current = true; setLoading(true); setError("");
    try {
      let checked = 0;
      const networks = ["Base", "Ethereum"] as const;
      const checks = await Promise.allSettled(networks.map(async network => {
        const all: Payment[] = [];
        for (let page = 0; page < 10000; page++) {
          const data = await request(`/api/admin/treasury/${network === "Base" ? "deposits" : "ethereum-deposits"}?page=${page}`);
          if (data.page !== page) throw new Error("Wallet list changed. Refresh to check all payments.");
          const pageRows = network === "Base" ? paymentsFromBase(data as DepositSnapshot) : paymentsFromEthereum(data as EthPage);
          all.push(...pageRows);
          const checkedIds = new Set(data.rows.map((r: { id: string }) => r.id));
          setRows(previous => [...previous.filter(r => r.network !== network || !checkedIds.has(r.id)), ...pageRows].sort((a,b) => (b.receivedAt || "").localeCompare(a.receivedAt || "")));
          checked += data.rows.length; setProgress(`Checking payments · ${checked} wallet balances checked`);
          if (!data.hasMore) return all;
        }
        throw new Error("Payment check incomplete. Please refresh.");
      }));
      const successful = networks.filter((_,i) => checks[i].status === "fulfilled");
      const all = checks.flatMap(c => c.status === "fulfilled" ? c.value : []);
      setRows(previous => [...new Map([...previous.filter(r => !successful.includes(r.network)), ...all].map(row => [row.key, row])).values()].sort((a,b) => (b.receivedAt || "").localeCompare(a.receivedAt || "")));
      const failed = networks.filter((_,i) => checks[i].status === "rejected");
      if (failed.length) setError(`Could not finish checking ${failed.join(" and ")}. Refresh to retry; those balances may be stale.`);
      setLoaded(true); setCheckedAt(new Date().toISOString());
    } catch (e) { setError(e instanceof Error ? e.message : "Could not check payments."); }
    finally { loadLock.current = false; setLoading(false); setProgress(""); }
  }, []);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || "[]"); if (Array.isArray(saved)) saveSubmitted(saved.filter(s => s && typeof s.key === "string" && ["Base","Ethereum"].includes(s.network) && Array.isArray(s.hashes) && s.hashes.every((h: unknown) => typeof h === "string" && /^0x[0-9a-f]{64}$/i.test(h)) && ["pending","confirmed","needs-check"].includes(s.status))); } catch {}
    void refresh();
    const timer = setInterval(() => { if (!dialog.current?.open) void refresh(); }, 120_000);
    return () => clearInterval(timer);
  }, [refresh, saveSubmitted]);
  useEffect(() => {
    let checking = false;
    const timer = setInterval(async () => {
      if (checking || actionLock.current) return;
      checking = true;
      try {
        const entries = submittedRef.current;
        let changed = false;
        const next = await Promise.all(entries.map(async entry => {
          if (entry.status !== "pending" || !entry.hashes.length) return entry;
          try {
            const statuses = await Promise.all(entry.hashes.map(hash => request(`/api/admin/treasury/sweep-status?network=${entry.network}&hash=${hash}`)));
            if (statuses.every(s => s.status === "confirmed")) { changed = true; return { ...entry, status: "confirmed" as const }; }
            if (statuses.some(s => s.status === "failed")) { changed = true; return { ...entry, status: "needs-check" as const }; }
          } catch { /* Keep pending: a failed check is not a failed transfer. */ }
          return entry;
        }));
        if (changed) { saveSubmitted(next); await refresh(); await onSwept(); }
      } finally { checking = false; }
    }, 15_000);
    return () => clearInterval(timer);
  }, [onSwept, refresh, saveSubmitted]);
  function held(row: Payment) { return submittedRef.current.find(s => s.key === row.key && s.status !== "confirmed"); }
  async function prepare(payments: Payment[], retry = false) {
    if (actionLock.current || loadLock.current) return;
    actionLock.current = true; setBusy(true); setPlans([]); setSkipped([]); setConfirmed(false); setReviewError(""); dialog.current?.showModal();
    try {
      const next: PaymentPlan[] = [], omit: string[] = [];
      for (const payment of payments) {
        if (payment.blocked || (held(payment) && !(retry && held(payment)?.status === "needs-check"))) { omit.push(`${payment.name}: ${payment.blocked || "Previous transfer awaiting confirmation"}`); continue; }
        setProgress(`Reviewing ${payment.name}…`);
        if (payment.network === "Ethereum") {
          try { next.push({ payment, eth: await request("/api/admin/treasury/ethereum-deposits", { action: "preview", depositId: payment.id }) }); }
          catch (e) { omit.push(`${payment.name}: ${e instanceof Error ? e.message : "Review unavailable"}`); }
        } else next.push({ payment });
      }
      setPlans(next); setSkipped(omit);
    } finally { actionLock.current = false; setBusy(false); setProgress(""); }
  }
  async function send() {
    if (actionLock.current || !confirmed || !plans.length) return;
    actionLock.current = true; setBusy(true); setReviewError("");
    try {
      await executePayments(plans, async plan => {
        const p = plan.payment;
        setProgress(`Sweeping ${p.name}…`);
        try {
          if (plan.eth) {
            const result = await request("/api/admin/treasury/ethereum-deposits", { action: "confirm", ...plan.eth, confirmed: true });
            return { hashes: result.hash ? [result.hash] : [], uncertain: result.status !== "submitted" || !result.hash };
          }
          const result = await request("/api/admin/treasury/deposits", { depositId: p.id, treasury: p.treasury, confirmed: true });
          return { hashes: result.sweeps.map((s: { txHash: string }) => s.txHash), uncertain: result.failures.length > 0 };
        } catch (e) {
          if (![400,401,403,409].includes(Number((e as {status?:number})?.status))) saveSubmitted([...submittedRef.current.filter(s => s.key !== p.key), { key:p.key, network:p.network, hashes:[], status:"needs-check" }]);
          throw e;
        }
      }, (key, hashes, uncertain) => {
        const p = plans.find(plan => plan.payment.key === key)!.payment;
        saveSubmitted([...submittedRef.current.filter(s => s.key !== key), { key, network:p.network, hashes, status:uncertain && !hashes.length ? "needs-check" : p.network === "Ethereum" ? "pending" : uncertain ? "needs-check" : "confirmed" }]);
      });
      setPlans([]); setConfirmed(false); dialog.current?.close();
    } catch (e) { setReviewError(e instanceof Error ? e.message : "Result uncertain. Check wallet activity before retrying."); setPlans([]); setConfirmed(false); }
    finally { actionLock.current = false; setBusy(false); setProgress(""); await refresh(); await onSwept(); }
  }
  const known = rows.filter(r => !r.unknown && !r.dust);
  const dust = rows.filter(r => r.dust);
  const unknown = rows.filter(r => r.unknown);
  const visible = known.filter(r => `${r.name} ${r.customer}`.toLowerCase().includes(filter.toLowerCase()));
  const ready = known.filter(r => !r.blocked && !held(r));
  return <section className="rounded-2xl border p-6 space-y-5" style={card}>
    <div className="flex flex-wrap justify-between items-center gap-3"><div><h2 className="text-xl font-semibold">Payments awaiting sweep</h2><p className="text-sm mt-1" style={{color:"var(--muted)"}}>Move customer payments to your treasury. Empty wallets are hidden.</p></div><div className="flex gap-2"><button disabled={loading || busy} onClick={() => void refresh()} className="border rounded-lg px-4 py-2 disabled:opacity-50">Refresh</button><button disabled={loading || busy || !!error || !ready.length} onClick={() => void prepare(known)} className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">Sweep all{ready.length ? ` (${ready.length})` : ""}</button></div></div>
    {known.length > 5 && <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Find customer" aria-label="Find customer payment" className="w-full border rounded-lg p-3" style={card}/>}
    {loading && <p role="status" className="text-sm">{progress || "Checking for payments…"}</p>}
    {error && <p role="alert" style={{color:"var(--warn-num)"}}>{error} {loaded && "Previously checked payments remain below."}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead style={{color:"var(--muted)"}}><tr><th className="py-3 pr-4">Customer</th><th className="py-3 pr-4">Received (recorded)</th><th className="py-3 pr-4">Amount to sweep</th><th className="py-3">Action</th></tr></thead><tbody>{visible.map(row=>{const pending=held(row);return <tr key={row.key} className="border-t" style={{borderColor:"var(--divider)"}}><td className="py-4 pr-4"><p className="font-semibold">{row.name}</p><p className="text-xs" style={{color:"var(--muted)"}}>{row.customer}</p></td><td className="py-4 pr-4" title="Latest payment recorded by LinkedVelocity; this may be later than the blockchain receipt.">{dateText(row.receivedAt)}</td><td className="py-4 pr-4"><p className="font-semibold">{row.amount}</p><p className="text-xs" style={{color:"var(--muted)"}}>{row.network}</p></td><td className="py-4"><button disabled={loading || busy || !!row.blocked || pending?.status === "pending"} onClick={()=>void prepare([row], true)} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{pending?.status === "pending" ? "Confirming…" : pending ? "Review again" : "Sweep"}</button>{row.blocked && <p className="text-xs mt-1">{row.blocked}</p>}</td></tr>})}</tbody></table></div>
    {loaded && !loading && !known.length && !error && <p>{unknown.length ? "Some balances could not be checked. Open Details or refresh to retry." : "No payments awaiting sweep."}</p>}
    {loaded && <p className="text-xs" style={{color:"var(--muted)"}}>Received dates show the latest recorded payment. Amounts are current wallet balances before fees. Updates every 2 minutes{checkedAt ? ` · checked ${dateText(checkedAt)}` : ""}.</p>}
    {(unknown.length>0 || dust.length>0 || submitted.length>0) && <details className="text-sm"><summary className="cursor-pointer">Details{unknown.length ? ` · ${unknown.length} balances could not be checked` : " · recent sweeps"}</summary><div className="space-y-3 mt-3">{dust.length>0 && <p>{dust.length} small ETH balances are below the estimated network fee and are hidden from the sweep list.</p>}{unknown.map(r=><p key={r.key}>{r.name} · {r.network} · Unable to check balance</p>)}{submitted.map(s=><div key={s.key}><p>{rows.find(r=>r.key===s.key)?.name || s.network} · {s.status === "confirmed" ? "Confirmed" : s.status === "pending" ? "Awaiting confirmation" : "Check wallet activity before retrying"}</p>{s.hashes.map(h=><a key={h} className="block break-all text-xs text-blue-600" href={`https://${s.network === "Ethereum" ? "etherscan.io" : "basescan.org"}/tx/${h}`} target="_blank" rel="noreferrer">View transaction ↗</a>)}</div>)}</div></details>}
    <dialog ref={dialog} aria-labelledby="payments-review-title" onCancel={e=>{if(busy)e.preventDefault()}} className="m-auto w-[min(95vw,680px)] max-h-[90vh] overflow-y-auto rounded-2xl border p-6 backdrop:bg-black/50" style={card}>
      <h2 id="payments-review-title" className="text-xl font-semibold">Review {plans.length>1 ? "payments" : "payment"}</h2>
      {busy && <p role="status" className="mt-4">{progress || "Preparing review…"}</p>}
      {reviewError && <p role="alert" className="mt-4" style={{color:"var(--warn-num)"}}>{reviewError}</p>}
      <div className="space-y-4 my-5">{plans.map(({payment:p,eth})=><div className="border rounded-lg p-3" key={p.key}><p className="font-semibold">{p.name} · {p.network}</p><p>{eth ? `${eth.review.amount} ETH to treasury` : p.amount}</p>{eth && <p className="text-xs">Maximum network fee: {eth.review.maxFee} ETH</p>}<p className="text-xs break-all mt-2">To: {eth?.review.destination || p.treasury}</p></div>)}</div>
      {skipped.length>0 && <details className="text-sm mb-4" open={!plans.length}><summary>{skipped.length} payments need attention</summary>{skipped.map((s,i)=><p key={i} className="mt-2">{s}</p>)}</details>}
      {plans.length>0 && <><p className="text-xs mb-3">Each wallet is swept separately. Base network fees apply. Ethereum fee reviews expire after two minutes. Processing stops on an error; confirmed transfers are never retried automatically.</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I checked the amounts, networks and treasury addresses and authorize these transfers.</label></>}
      <div className="flex justify-end gap-3 mt-5"><button disabled={busy} onClick={()=>dialog.current?.close()} className="border rounded-lg px-4 py-2">{plans.length ? "Cancel" : "Close"}</button>{plans.length>0 && <button disabled={busy || !confirmed} onClick={()=>void send()} className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Sweeping…" : plans.length>1 ? "Confirm sweep all" : "Confirm sweep"}</button>}</div>
    </dialog>
  </section>;
}
