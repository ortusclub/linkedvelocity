"use client";
import { useEffect, useMemo, useState } from "react";
import {
  isReferralOnboarded, isReferralEarned, isReferralReadyToPay, referralCommissionAmount,
  type ReferralGate,
} from "@/lib/referrals";
import { referralCurrency, CURRENCY_CONFIG, formatMoney, type Currency } from "@/lib/referral-currency";

// Referrals v2 — READ-ONLY referrer leaderboard, styled to the LV admin design (Plus Jakarta
// Sans / Space Grotesk, light palette). Reuses lib/referrals + lib/referral-currency unchanged
// so owed/earned match /admin/referrals. No payout is written here — recording a payment stays
// on /admin/referrals (phase 2 brings the Payments ledger in via payouts-ii/mark-referral).

const F = "'Plus Jakarta Sans',system-ui,sans-serif";
const FN = "'Space Grotesk',system-ui,sans-serif";
const AV = ["#2563eb", "#0f7a3d", "#7c3aed", "#c2410c", "#0e7490", "#be185d", "#475569"];
const ini = (s: string) => (s || "?").replace(/\(.*\)/, "").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const avc = (s: string) => AV[hash(s) % AV.length];

type Referrer = { id: string; slug: string; name: string; type: string; email: string | null; paymentMethod: string | null; paymentDetails: string | null; paymentName: string | null; createdAt: string };
type App = {
  id: string; fullName: string; referredBy: string | null; status: string; createdAt: string;
  verifiedAt: string | null; accountIssue: string | null; onboardedAt: string | null; paidAt: string | null;
  monthlyPayouts: unknown; referralSource: string | null; onboardingMethod: string | null; onboardingVerified: boolean | null;
  referralHoldReason: string | null; accountFreshness: string | null;
  accountRestrictedAt: string | null; accountPermanentlyRestricted: boolean; accountStatus: string | null;
};
type Payout = { id: string; referrerId: string; type: string; ambassadorApplicationId: string | null; amount: number; description: string | null; method: string | null; reference: string | null; paidAt: string | null; confirmedAt: string | null; notifiedAt: string | null; createdAt: string; referrer?: { name: string; slug: string } | null };

const DAY = 86400000;
const money = (cur: Currency, n: number) => formatMoney(n, cur);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "—");
const norm = (s?: string | null) => (s || "").trim().toLowerCase();
const teamOf = (t: string) => (t === "ortus" ? "Ortus" : t === "apex" ? "Apex" : "Standard");
const isRestricted = (a: App) => !!a.accountRestrictedAt || a.accountPermanentlyRestricted || norm(a.accountIssue).includes("restricted");

function pathInfo(a: App, tiers: typeof CURRENCY_CONFIG["PHP"]["referralTiers"]) {
  if (a.referralSource !== "self-service" || a.onboardingMethod === "team_meeting") return { label: "Refer · LV onboards", amt: tiers.referral };
  const band = a.onboardingMethod === "phone" ? tiers.phone : tiers.computer;
  const where = a.onboardingMethod === "phone" ? "phone" : "PC";
  return { label: `You ran it · ${where}${a.onboardingVerified ? " · verified" : ""}`, amt: a.onboardingVerified ? band.verified : band.base };
}

function weekly(apps: App[], now: number) {
  const w = [0, 0, 0, 0, 0, 0, 0, 0];
  let lastDays = Infinity;
  for (const a of apps) {
    const age = (now - new Date(a.createdAt).getTime()) / DAY;
    if (age < lastDays) lastDays = age;
    const wk = Math.floor(age / 7);
    if (wk >= 0 && wk <= 7) w[7 - wk]++;
  }
  return { w, lastDays: apps.length ? lastDays : Infinity };
}
function trendOf(w: number[], lastDays: number) {
  const rec = w[6] + w[7], pri = w[4] + w[5];
  let k: "up" | "steady" | "down" | "dormant";
  if (lastDays > 30) k = "dormant";
  else if (pri >= 1 && rec <= pri * 0.5) k = "down";
  else if ((pri === 0 && rec >= 2) || (rec >= pri + 2 && rec >= pri * 1.4)) k = "up";
  else k = "steady";
  const meta = { up: { lbl: "↑ picking up", fg: "#0f7a3d" }, steady: { lbl: "→ steady", fg: "#8a93a3" }, down: { lbl: "↓ slowing", fg: "#c2410c" }, dormant: { lbl: "· dormant", fg: "#9aa0a6" } }[k];
  return { k, rec, pri, ...meta };
}
function spark(w: number[], width: number, height: number) {
  const max = Math.max(1, ...w);
  const step = width / (w.length - 1);
  return w.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 2) - 1).toFixed(1)}`).join(" ");
}

type Row = {
  id: string; slug: string; name: string; team: string; cur: Currency; sym: string;
  sign: number; onb: number; res: number; ver: number; earned: number; ready: number; held: number; paid: number; owed: number;
  w: number[]; lastDays: number; trend: ReturnType<typeof trendOf>; apps: App[];
};

export default function ReferralsV2Page() {
  const [refs, setRefs] = useState<Referrer[] | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [pays, setPays] = useState<Payout[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"board" | "pay">("board");
  const [filter, setFilter] = useState("all");
  const [team, setTeam] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("onb");
  const [sel, setSel] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [np, setNp] = useState({ who: "", type: "Commission", method: "GCash", amount: "", desc: "" });

  const load = () => Promise.all([
    fetch("/api/admin/referrers", { cache: "no-store" }).then(r => r.json()),
    fetch("/api/admin/ambassadors", { cache: "no-store" }).then(r => r.json()),
    fetch("/api/admin/payouts", { cache: "no-store" }).then(r => r.json()),
  ]).then(([r, a, p]) => {
    if (r.error || a.error || p.error) { setError(r.error || a.error || p.error); return; }
    setRefs(r.referrers || []); setApps(a.applications || []); setPays(p.payouts || []);
  });
  useEffect(() => { load().catch(e => setError(e.message)); }, []);

  const now = Date.now();

  const rows: Row[] = useMemo(() => {
    if (!refs) return [];
    const byRef = new Map<string, App[]>();
    for (const a of apps) { const k = norm(a.referredBy); if (!k) continue; (byRef.get(k) || byRef.set(k, []).get(k)!).push(a); }
    const refBySlug = new Map(refs.map(r => [norm(r.slug), r]));
    const refByName = new Map(refs.map(r => [norm(r.name), r]));
    const paidByRef = new Map<string, number>();
    for (const p of pays) { if (p.type !== "commission" || !p.paidAt) continue; paidByRef.set(p.referrerId, (paidByRef.get(p.referrerId) || 0) + Number(p.amount || 0)); }

    const out: Row[] = [];
    for (const [key, group] of byRef) {
      const r = refBySlug.get(key) || refByName.get(key);
      if (!r) continue;
      const cur = referralCurrency(r.slug);
      const cfg = CURRENCY_CONFIG[cur];
      const tiers = cfg.referralTiers;
      let onb = 0, res = 0, ver = 0, earned = 0, ready = 0;
      for (const a of group) {
        const gate = a as unknown as ReferralGate;
        const on = isReferralOnboarded(gate);
        if (on) onb++;
        if (on && isRestricted(a)) res++;
        const isEarned = isReferralEarned(gate);
        if (on && !isEarned) ver++;
        if (isEarned) { const c = referralCommissionAmount(gate, tiers); earned += c; if (isReferralReadyToPay(gate)) ready += c; }
      }
      const held = Math.max(0, earned - ready);
      const paid = paidByRef.get(r.id) || 0;
      const owed = Math.max(0, ready - paid);
      const { w, lastDays } = weekly(group, now);
      out.push({ id: r.id, slug: r.slug, name: r.name, team: teamOf(r.type), cur, sym: cfg.symbol, sign: group.length, onb, res, ver, earned, ready, held, paid, owed, w, lastDays, trend: trendOf(w, lastDays), apps: group });
    }
    return out;
  }, [refs, apps, pays, now]);

  const inactive = (r: Row) => r.lastDays > 30 && r.owed === 0 && r.held === 0;
  const qualifying = rows.filter(r => r.onb >= 3);
  const baseOnb = qualifying.reduce((a, r) => a + r.onb, 0);
  const baseRes = qualifying.reduce((a, r) => a + r.res, 0);
  const baselineRate = baseOnb ? baseRes / baseOnb : 0;
  const riskCut = Math.max(0.5, baselineRate * 1.4);
  const isRisk = (r: Row) => r.onb >= 3 && r.res / r.onb >= riskCut;
  const top5 = useMemo(() => [...rows].sort((a, b) => b.onb - a.onb).slice(0, 5).map(r => r.id), [rows]);

  const FILTERS: Record<string, (r: Row) => boolean> = {
    all: () => true, top: r => top5.includes(r.id), owed: r => r.owed > 0 || r.held > 0,
    risk: isRisk, slow: r => !inactive(r) && r.trend.k === "down", ver: r => r.ver > 0,
  };
  const SORTS: Record<string, (r: Row) => number> = {
    onb: r => -r.onb, sign: r => -r.sign, rate: r => -(r.sign ? r.onb / r.sign : 0),
    restr: r => -(r.onb ? r.res / r.onb : 0), owed: r => -(r.owed + r.held), recent: r => r.lastDays,
  };

  const base = rows.filter(r => (team === "all" || r.team === team) && (!q.trim() || (r.name + " " + r.slug).toLowerCase().includes(q.trim().toLowerCase()) || (q.trim().length > 2 && r.apps.some(a => norm(a.fullName).includes(q.trim().toLowerCase())))));
  const filtered = base.filter(FILTERS[filter]);
  const active = filtered.filter(r => !inactive(r));
  const inact = filtered.filter(inactive);
  const visible = [...(showInactive ? filtered : active)].sort((a, b) => SORTS[sort](a) - SORTS[sort](b));

  const php = rows.filter(r => r.cur === "PHP");
  const sum = (k: "sign" | "onb" | "res" | "ver" | "earned" | "ready" | "held" | "paid" | "owed", l: Row[] = rows) => l.reduce((a, r) => a + r[k], 0);
  const tiles = [
    { label: "Active referrers", n: String(rows.filter(r => r.lastDays <= 30 && r.sign > 0).length), sub: "signup in last 30 days", fg: "#0b1220" },
    { label: "Signups", n: String(sum("sign")), sub: sum("ver") + " verifying now", fg: "#0b1220" },
    { label: "Onboarded", n: String(sum("onb")), sub: pct(sum("onb"), sum("sign")) + " of signups", fg: "#0f7a3d" },
    { label: "Restricted", n: String(sum("res")), sub: pct(sum("res"), sum("onb")) + " of onboarded", fg: "#b91c1c" },
    { label: "Owed", n: money("PHP", sum("owed", php) + sum("held", php)), sub: money("PHP", sum("owed", php)) + " ready · " + money("PHP", sum("held", php)) + " hold", fg: "#b45309" },
    { label: "Paid to date", n: money("PHP", sum("paid", php)), sub: "commission paid", fg: "#0f7a3d" },
  ];

  const filterDefs: Array<[string, string, string, string]> = [
    ["all", "All", "#0b1220", "Everyone"],
    ["top", "Top 5", "#16a34a", "Most onboarded"],
    ["owed", "Owed money", "#d97706", "Ready or in hold"],
    ["risk", "Quality risk", "#dc2626", `Restriction rate over ${Math.round(riskCut * 100)}% (cohort avg ~${Math.round(baselineRate * 100)}%) · min 3 onboarded · a signal, not proof`],
    ["slow", "Slowing down", "#f59e0b", "Was active, signups dropped to half or less of the prior 2 weeks"],
    ["ver", "Verifying", "#60a5fa", "Has onboarded signups awaiting QC"],
  ];

  const exportCsv = () => {
    const head = ["Referrer", "Ref code", "Team", "Currency", "Signups", "Onboarded", "Conversion", "Restricted", "Restriction rate", "Paid", "Owed ready", "In hold", "Trend"];
    const lines = [head.join(",")];
    for (const r of visible) lines.push([r.name, r.slug, r.team, r.cur, r.sign, r.onb, pct(r.onb, r.sign), r.res, pct(r.res, r.onb), r.paid, r.owed, r.held, r.trend.lbl.replace(/[^\w ]/g, "").trim()].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "referrals-v2.csv"; a.click(); URL.revokeObjectURL(url);
  };

  // --- payment writes (same endpoints as /admin/referrals; mark-referral is app-tied + deduped) ---
  const TYPE_MAP: Record<string, string> = { Commission: "commission", "Day rate": "day_rate", Bonus: "bonus", Other: "other" };
  const recordPayment = async () => {
    if (!np.who) { setMsg("Pick who the payment is for."); return; }
    if (!(Number(np.amount) > 0)) { setMsg("Enter an amount greater than zero."); return; }
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/admin/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ referrerId: np.who, type: TYPE_MAP[np.type] || "other", amount: Number(np.amount), description: np.desc || null }) });
      const d = await res.json(); if (!res.ok) throw new Error(d.error);
      await fetch(`/api/admin/payouts/${d.payout.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markPaid: true, method: np.method }) });
      setNp({ who: "", type: "Commission", method: "GCash", amount: "", desc: "" });
      await load(); setMsg("Payment recorded as sent.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not record."); } finally { setBusy(false); }
  };
  const patchPayout = async (id: string, body: Record<string, unknown>, ok: string) => {
    setBusy(true); setMsg("");
    try { const res = await fetch(`/api/admin/payouts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) throw new Error((await res.json()).error); await load(); setMsg(ok); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  };
  const addReceipt = (id: string) => { const url = window.prompt("Paste the receipt link (a Wise/transfer URL also emails the referrer):", ""); if (!url) return; patchPayout(id, { reference: url }, "Receipt added."); };
  const undoPayout = (id: string) => { if (!window.confirm("Undo this payment? It will no longer count as paid, and any marketer confirmation is dropped.")) return; patchPayout(id, { markPaid: false }, "Payment undone."); };
  const delPayout = async (id: string) => {
    if (!window.confirm("Delete this payout row permanently? This cannot be undone.")) return;
    setBusy(true); setMsg("");
    try { const res = await fetch(`/api/admin/payouts/${id}`, { method: "DELETE" }); if (!res.ok) throw new Error((await res.json()).error); await load(); setMsg("Payout deleted."); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  };
  // Per-ambassador commission (app-tied, server computes the amount, deduped against double-pay).
  const payAmbassador = async (applicationId: string, name: string) => {
    if (!window.confirm(`Record the referral commission for ${name} as paid?`)) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/admin/payouts-ii/mark-referral", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId }) });
      const d = await res.json(); if (!res.ok) throw new Error(d.error);
      await load(); setMsg(d.alreadyPaid ? "Already recorded." : `Commission for ${name} recorded.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  };

  const sel_ = sel ? rows.find(r => r.id === sel) || null : null;
  const refName = (p: Payout) => p.referrer?.name || refs?.find(r => r.id === p.referrerId)?.name || "—";
  const pill: React.CSSProperties = { border: "1px solid #dde1e8", background: "#fff", color: "#0b1220", borderRadius: 10, padding: "8px 12px", font: `600 12.5px ${F}`, cursor: "pointer", whiteSpace: "nowrap" };

  return (
    <div style={{ minHeight: "100vh", padding: "28px 26px 80px", background: "#eef0f4", font: `400 13px ${F}`, color: "#0b1220" }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div style={{ maxWidth: 700 }}>
            <h1 style={{ font: `700 30px ${FN}`, color: "#0b1220", margin: "0 0 4px", letterSpacing: "-.01em" }}>Referrals <span style={{ font: `600 12px ${F}`, color: "#8a93a3" }}>v2 · read-only</span></h1>
            <p style={{ font: `500 14px/1.5 ${F}`, color: "#5b6779", margin: 0 }}>Who brings in ambassadors, how many onboard, how many get restricted, who&apos;s slowing down, and what we owe. To record a payment, use <a href="/admin/referrals" style={{ color: "#2563eb" }}>Referrals</a>.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={exportCsv} style={pill}>Export CSV</button>
          </div>
        </div>

        {error && <p style={{ color: "#c0392b" }}>{error}</p>}
        {!refs && !error && <p style={{ color: "#5b6779" }}>Loading…</p>}

        {refs && <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
            {tiles.map(t => (
              <div key={t.label} style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ font: `700 11px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: "#5b6779", whiteSpace: "nowrap" }}>{t.label}</span>
                <span style={{ font: `700 26px ${FN}`, color: t.fg }}>{t.n}</span>
                <span style={{ font: `600 12px ${F}`, color: "#5b6779", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.sub}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: "#eef4ff", border: "1px solid #d3e0fb", borderRadius: 12, padding: "10px 14px" }}>
            <span style={{ flex: "none", width: 8, height: 8, borderRadius: "50%", background: "#2563eb" }} />
            <span style={{ flex: 1, minWidth: 240, font: `500 13px/1.45 ${F}`, color: "#1e3a8a" }}><b>Referral payouts run after account owners are paid.</b> {money("PHP", sum("owed", php))} ready to pay across {php.filter(r => r.owed > 0).length} referrers · {money("PHP", sum("held", php))} still in hold.</span>
            <a href="/admin/referrals" style={{ border: "none", background: "#2563eb", color: "#fff", borderRadius: 9, padding: "7px 12px", font: `700 12.5px ${F}`, cursor: "pointer", textDecoration: "none" }}>Pay in Referrals →</a>
          </div>

          <div style={{ display: "flex", background: "#fff", border: "1px solid #e3e6ec", borderRadius: 11, padding: 3, gap: 2, alignSelf: "flex-start" }}>
            {([["board", "Leaderboard"], ["pay", "Payments"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} style={{ border: "none", background: tab === k ? "#0b1220" : "transparent", color: tab === k ? "#fff" : "#0b1220", borderRadius: 8, padding: "7px 14px", font: `700 13px ${F}`, cursor: "pointer" }}>{label}</button>
            ))}
          </div>

          {msg && <p role="status" style={{ font: `600 12.5px ${F}`, color: "#2563eb", margin: "-4px 0 0" }}>{msg}</p>}

          {tab === "board" && <>
            <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {filterDefs.map(([k, label, dot, tip]) => {
                  const on = filter === k;
                  const n = base.filter(FILTERS[k]).filter(r => k !== "all" || !inactive(r)).length;
                  return <button key={k} title={tip} onClick={() => setFilter(k)} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", border: `1.5px solid ${on ? dot : "#e3e6ec"}`, background: on ? "#eef4ff" : "#fff", borderRadius: 999, padding: "5px 12px 5px 10px", font: `700 12.5px ${F}`, color: "#0b1220", whiteSpace: "nowrap" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot }} />{label}
                    <span style={{ font: `700 11px ${FN}`, color: "#5b6779", background: "#eef0f4", borderRadius: 999, padding: "1px 7px" }}>{n}</span>
                  </button>;
                })}
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", background: "#eef0f4", borderRadius: 10, padding: 3, gap: 2 }}>
                  {["all", "Standard", "Ortus", "Apex"].map(t => (
                    <button key={t} onClick={() => setTeam(t)} style={{ border: "none", background: team === t ? "#fff" : "transparent", color: "#0b1220", boxShadow: team === t ? "0 1px 2px rgba(11,18,32,.12)" : "none", borderRadius: 8, padding: "5px 11px", font: `700 12px ${F}`, cursor: "pointer" }}>{t === "all" ? "All teams" : t}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid #f0f2f5", paddingTop: 10 }}>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search referrer, ref code or ambassador name…" style={{ flex: 1, minWidth: 220, border: "1px solid #dde1e8", background: "#f8f9fb", borderRadius: 10, padding: "9px 12px", font: `500 13.5px ${F}`, color: "#0b1220", outline: "none" }} />
                <select value={sort} onChange={e => setSort(e.target.value)} style={{ border: "1px solid #dde1e8", background: "#fff", borderRadius: 10, padding: "9px 10px", font: `600 13px ${F}`, color: "#0b1220" }}>
                  <option value="onb">Most onboarded</option><option value="sign">Most signups</option><option value="rate">Best conversion</option><option value="restr">Highest restriction rate</option><option value="owed">Most owed</option><option value="recent">Latest signup</option>
                </select>
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 14, overflowX: "auto" }}>
              <div style={{ minWidth: 1140 }}>
                <div style={{ display: "grid", gridTemplateColumns: "36px minmax(210px,1.7fr) 150px 72px 100px 104px 96px 128px 130px", gap: 14, padding: "11px 18px", borderBottom: "1px solid #eef0f4", font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>
                  <span>#</span><span>Referrer</span><span>Funnel</span><span>Signups</span><span>Onboarded</span><span>Restricted</span><span>Paid</span><span>Owed</span><span>Trend</span>
                </div>
                {visible.map((r, i) => {
                  const total = r.onb + r.ver || 1;
                  const edge = isRisk(r) ? "#dc2626" : r.trend.k === "down" ? "#f59e0b" : "transparent";
                  return <div key={r.id} onClick={() => { setSel(r.id); setCopied(false); }} style={{ display: "grid", gridTemplateColumns: "36px minmax(210px,1.7fr) 150px 72px 100px 104px 96px 128px 130px", gap: 14, alignItems: "center", padding: "12px 18px", borderBottom: "1px solid #eef0f4", boxShadow: `inset 3px 0 0 ${edge}`, cursor: "pointer", background: "#fff" }}>
                    <span style={{ font: `700 14px ${FN}`, color: "#8a93a3" }}>{i + 1}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span style={{ flex: "none", width: 32, height: 32, borderRadius: "50%", background: avc(r.slug), color: "#fff", display: "grid", placeItems: "center", font: `700 11px ${F}` }}>{ini(r.name)}</span>
                      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ font: `700 14px ${F}`, color: "#0b1220" }}>{r.name}</span>
                          {r.team !== "Standard" && <span style={{ font: `700 10.5px ${F}`, padding: "2px 8px", borderRadius: 999, background: r.team === "Ortus" ? "#f3e8ff" : "#e0f2fe", color: r.team === "Ortus" ? "#7c3aed" : "#0369a1" }}>{r.team}</span>}
                          {isRisk(r) && <span style={{ font: `700 10.5px ${F}`, padding: "2px 8px", borderRadius: 999, background: "#fde8e8", color: "#b91c1c" }}>quality risk</span>}
                        </div>
                        <span style={{ font: `500 12px ${F}`, color: "#5b6779", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>ref {r.slug}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                      <div style={{ display: "flex", height: 8, borderRadius: 999, background: "#eef0f4", overflow: "hidden" }}>
                        <div style={{ width: `${((r.onb - r.res) / total) * 100}%`, background: "#16a34a" }} />
                        <div style={{ width: `${(r.res / total) * 100}%`, background: "#dc2626" }} />
                        <div style={{ width: `${(r.ver / total) * 100}%`, background: "#60a5fa" }} />
                      </div>
                      <span style={{ font: `500 11px ${F}`, color: "#8a93a3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.onb - r.res} ok · {r.res} restr · {r.ver} verifying</span>
                    </div>
                    <span style={{ font: `700 15px ${FN}`, color: "#0b1220" }}>{r.sign}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}><span style={{ font: `700 15px ${FN}`, color: "#0f7a3d" }}>{r.onb}</span><span style={{ font: `500 11px ${F}`, color: "#8a93a3" }}>{pct(r.onb, r.sign)}</span></div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}><span style={{ font: `700 15px ${FN}`, color: r.res ? "#b91c1c" : "#0b1220" }}>{r.res}</span><span style={{ font: `500 11px ${F}`, color: isRisk(r) ? "#b91c1c" : "#8a93a3" }}>{pct(r.res, r.onb)}</span></div>
                    <span style={{ font: `700 14px ${FN}`, color: "#0b1220" }}>{money(r.cur, r.paid)}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}><span style={{ font: `700 14px ${FN}`, color: r.owed ? "#b45309" : "#8a93a3" }}>{money(r.cur, r.owed)}</span><span style={{ font: `500 11px ${F}`, color: "#8a93a3" }}>{r.held ? money(r.cur, r.held) + " hold" : "—"}</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <svg width={52} height={18} viewBox="0 0 52 18" preserveAspectRatio="none"><polyline points={spark(r.w, 52, 18)} fill="none" stroke={r.trend.fg} strokeWidth={1.6} /></svg>
                      <span style={{ font: `700 10.5px ${F}`, color: r.trend.fg, whiteSpace: "nowrap" }}>{r.trend.lbl}</span>
                    </div>
                  </div>;
                })}
                {!showInactive && inact.length > 0 && <button onClick={() => setShowInactive(true)} style={{ width: "100%", border: "none", background: "#f8f9fb", padding: "12px 18px", textAlign: "left", font: `700 12.5px ${F}`, color: "#5b6779", cursor: "pointer" }}>Show {inact.length} inactive (30d+ idle, nothing owed) →</button>}
                {showInactive && inact.length > 0 && <button onClick={() => setShowInactive(false)} style={{ width: "100%", border: "none", background: "#f8f9fb", padding: "12px 18px", textAlign: "left", font: `700 12.5px ${F}`, color: "#5b6779", cursor: "pointer" }}>Hide inactive</button>}
                {!visible.length && <div style={{ padding: 40, textAlign: "center", font: `500 13.5px ${F}`, color: "#8a93a3" }}>No referrers match.</div>}
              </div>
            </div>
          </>}

          {tab === "pay" && (() => {
            const ledger = [...pays].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            const whoOpts = [...(refs || [])].sort((a, b) => a.name.localeCompare(b.name));
            const inp: React.CSSProperties = { border: "1px solid #dde1e8", background: "#fff", borderRadius: 10, padding: "9px 10px", font: `600 13px ${F}`, color: "#0b1220", outline: "none" };
            return <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 14, overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid #eef0f4", background: "#f8f9fb" }}>
                <select value={np.who} onChange={e => setNp({ ...np, who: e.target.value })} style={{ ...inp, minWidth: 170 }}>
                  <option value="">Who…</option>
                  {whoOpts.map(r => <option key={r.id} value={r.id}>{r.name} ({r.slug})</option>)}
                </select>
                <select value={np.type} onChange={e => setNp({ ...np, type: e.target.value })} style={inp}><option>Commission</option><option>Day rate</option><option>Bonus</option><option>Other</option></select>
                <select value={np.method} onChange={e => setNp({ ...np, method: e.target.value })} style={inp}><option>GCash</option><option>Maya</option><option>Maribank</option><option>GoTyme</option><option>Cash</option><option>Wise</option></select>
                <input value={np.amount} onChange={e => setNp({ ...np, amount: e.target.value })} placeholder="Amount" inputMode="numeric" style={{ ...inp, width: 110, fontFamily: FN }} />
                <input value={np.desc} onChange={e => setNp({ ...np, desc: e.target.value })} placeholder="What it's for (names, e.g. 3 onboarded)" style={{ ...inp, flex: 1, minWidth: 200, fontWeight: 500 }} />
                <button onClick={recordPayment} disabled={busy} style={{ border: "none", background: busy ? "#9aa7bd" : "#0f7a3d", color: "#fff", borderRadius: 10, padding: "9px 14px", font: `700 12.5px ${F}`, cursor: busy ? "default" : "pointer", whiteSpace: "nowrap" }}>+ Record payment</button>
              </div>
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 1000 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "150px 100px minmax(240px,2fr) minmax(190px,1.2fr) 150px 150px", gap: 14, padding: "10px 18px", borderBottom: "1px solid #eef0f4", font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>
                    <span>Who</span><span>Amount</span><span>For</span><span>Status</span><span>Receipt</span><span></span>
                  </div>
                  {ledger.map(p => {
                    const st = p.confirmedAt ? { l: "Confirmed", fg: "#0f7a3d", sub: "marketer confirmed" } : p.paidAt ? { l: "Sent", fg: "#2563eb", sub: "awaiting confirmation" } : { l: "Unpaid", fg: "#b45309", sub: "not sent" };
                    return <div key={p.id} style={{ display: "grid", gridTemplateColumns: "150px 100px minmax(240px,2fr) minmax(190px,1.2fr) 150px 150px", gap: 14, alignItems: "center", padding: "11px 18px", borderBottom: "1px solid #f0f2f5" }}>
                      <span style={{ font: `700 13px ${F}`, color: "#0b1220", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{refName(p)}</span>
                      <span style={{ font: `700 14px ${FN}`, color: "#0b1220" }}>₱{Math.round(p.amount).toLocaleString()}</span>
                      <span title={p.description || ""} style={{ font: `500 12.5px/1.4 ${F}`, color: "#334155", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.description || <span style={{ color: "#8a93a3" }}>{p.type}</span>}{p.method ? ` · ${p.method}` : ""}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}><span style={{ font: `700 12px ${F}`, color: st.fg }}>{st.l}</span><span style={{ font: `500 11px ${F}`, color: "#8a93a3" }}>{st.sub}</span></div>
                      <div>
                        {p.reference ? <span title={p.reference} style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `600 12px ${F}`, color: "#2563eb", background: "#eef4ff", borderRadius: 8, padding: "4px 9px", maxWidth: "100%" }}><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.notifiedAt ? "✉ emailed" : "receipt"}</span></span>
                          : p.paidAt ? <button onClick={() => addReceipt(p.id)} disabled={busy} style={{ border: "1px dashed #f0c98a", background: "#fff", color: "#b45309", borderRadius: 8, padding: "4px 9px", font: `700 12px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>+ Attach receipt</button>
                            : <span style={{ font: `500 11.5px ${F}`, color: "#b4bccb" }}>—</span>}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        {p.paidAt && <button onClick={() => undoPayout(p.id)} disabled={busy} style={{ border: "1px solid #dde1e8", background: "#fff", color: "#0b1220", borderRadius: 8, padding: "5px 9px", font: `700 11.5px ${F}`, cursor: "pointer" }}>Undo</button>}
                        <button onClick={() => delPayout(p.id)} disabled={busy} title="Delete row" style={{ border: "1px solid #f5c2c2", background: "#fff", color: "#dc2626", borderRadius: 8, padding: "5px 9px", font: `700 11.5px ${F}`, cursor: "pointer" }}>Delete</button>
                      </div>
                    </div>;
                  })}
                  {!ledger.length && <div style={{ padding: 40, textAlign: "center", font: `500 13.5px ${F}`, color: "#8a93a3" }}>No payments recorded yet.</div>}
                </div>
              </div>
            </div>;
          })()}
        </>}
      </div>

      {sel_ && <Drawer r={sel_} pays={pays} copied={copied} setCopied={setCopied} onClose={() => setSel(null)} onPay={payAmbassador} busy={busy} />}
    </div>
  );
}

function Drawer({ r, pays, copied, setCopied, onClose, onPay, busy }: { r: Row; pays: Payout[]; copied: boolean; setCopied: (v: boolean) => void; onClose: () => void; onPay: (id: string, name: string) => void; busy: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const paidApp = new Set(pays.filter(p => p.type === "commission" && p.paidAt && p.ambassadorApplicationId).map(p => p.ambassadorApplicationId!));
  const tiers = CURRENCY_CONFIG[r.cur].referralTiers;
  const link = `https://linkedvelocity.com/r/${r.slug}`;
  const best = r.w.reduce((b, v, i) => (v > r.w[b] ? i : b), 0);
  const stats = [
    { l: "Signups", v: String(r.sign), fg: "#0b1220" as string, sub: "" },
    { l: "Onboarded", v: `${r.onb}`, fg: "#0f7a3d", sub: pct(r.onb, r.sign) },
    { l: "Restricted", v: `${r.res}`, fg: r.res ? "#b91c1c" : "#0b1220", sub: pct(r.res, r.onb) },
    { l: "Verifying", v: String(r.ver), fg: "#2563eb", sub: "" },
    { l: "Earned", v: money(r.cur, r.earned), fg: "#0b1220", sub: "" },
    { l: "Ready", v: money(r.cur, r.owed), fg: "#0f7a3d", sub: "" },
    { l: "In hold", v: money(r.cur, r.held), fg: "#b45309", sub: "" },
    { l: "Paid", v: money(r.cur, r.paid), fg: "#0f7a3d", sub: "" },
  ];
  const ams = [...r.apps].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(a => {
    const gate = a as unknown as ReferralGate;
    const on = isReferralOnboarded(gate), earned = isReferralEarned(gate), restr = isRestricted(a);
    const p = pathInfo(a, tiers);
    let st = "Not onboarded", stBg = "#eef0f4", stFg = "#5b6779";
    if (restr) { st = "Restricted"; stBg = "#fde8e8"; stFg = "#b91c1c"; }
    else if (earned) { st = "Onboarded"; stBg = "#e7f6ee"; stFg = "#0f7a3d"; }
    else if (on) { st = "Verifying"; stBg = "#e8f0fe"; stFg = "#2563eb"; }
    const ready = earned && !paidApp.has(a.id) && isReferralReadyToPay(gate);
    const pay = paidApp.has(a.id) ? "Paid" : earned ? (isReferralReadyToPay(gate) ? "Ready" : "In hold") : "";
    return { id: a.id, name: a.fullName, when: new Date(a.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }), st, stBg, stFg, path: on ? p.label : "—", amt: earned ? money(r.cur, p.amt) : "", pay, canPay: ready, payFg: pay === "In hold" ? "#b45309" : "#0f7a3d" };
  });

  return <>
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,.28)", zIndex: 40 }} />
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(600px,100vw)", background: "#fff", color: "#0b1220", zIndex: 41, display: "flex", flexDirection: "column", boxShadow: "-12px 0 40px rgba(11,18,32,.14)", font: `400 13px ${F}` }}>
      <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #eef0f4", display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ flex: "none", width: 42, height: 42, borderRadius: "50%", background: avc(r.slug), color: "#fff", display: "grid", placeItems: "center", font: `700 14px ${F}` }}>{ini(r.name)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ font: `700 19px ${FN}`, color: "#0b1220" }}>{r.name}</span>
            {r.team !== "Standard" && <span style={{ font: `700 10.5px ${F}`, padding: "2px 8px", borderRadius: 999, background: r.team === "Ortus" ? "#f3e8ff" : "#e0f2fe", color: r.team === "Ortus" ? "#7c3aed" : "#0369a1" }}>{r.team}</span>}
            <span style={{ font: `700 10.5px ${F}`, color: r.trend.fg }}>{r.trend.lbl}</span>
          </div>
          <div style={{ font: `500 12px ${F}`, color: "#5b6779", marginTop: 3 }}>ref {r.slug} · {r.cur}</div>
        </div>
        <button onClick={onClose} style={{ flex: "none", border: "none", background: "#eef0f4", width: 30, height: 30, borderRadius: 8, font: `700 14px ${F}`, color: "#5b6779", cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
          {stats.map(s => (
            <div key={s.l} style={{ background: "#f8f9fb", border: "1px solid #eef0f4", borderRadius: 10, padding: "9px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ font: `700 10px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: "#8a93a3", whiteSpace: "nowrap" }}>{s.l}</span>
              <span style={{ font: `700 18px ${FN}`, color: s.fg }}>{s.v}</span>
              {s.sub && <span style={{ font: `500 10.5px ${F}`, color: "#8a93a3" }}>{s.sub}</span>}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ font: `700 11px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Momentum · last 8 weeks</span>
          <div style={{ border: "1px solid #e3e6ec", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 16 }}>
            <svg width={240} height={56} viewBox="0 0 240 56" preserveAspectRatio="none" style={{ flex: "none" }}>
              <polyline points={`0,56 ${spark(r.w, 240, 56)} 240,56`} fill={r.trend.fg + "1f"} stroke="none" />
              <polyline points={spark(r.w, 240, 56)} fill="none" stroke={r.trend.fg} strokeWidth={2} />
            </svg>
            <div style={{ font: `500 12px ${F}`, color: "#5b6779" }}>
              <div>Last 14d: <b style={{ color: "#0b1220" }}>{r.trend.rec}</b> · prior 14d: <b style={{ color: "#0b1220" }}>{r.trend.pri}</b></div>
              <div>Best week: <b style={{ color: "#0b1220" }}>{r.w[best]}</b> · this week: <b style={{ color: "#0b1220" }}>{r.w[7]}</b></div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ font: `700 11px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Portal · ref {r.slug}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #dde1e8", background: "#f8f9fb", borderRadius: 10, padding: "8px 10px" }}>
            <span style={{ flex: 1, minWidth: 0, font: `500 12.5px ${F}`, color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{link}</span>
            <button onClick={() => { navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }} style={{ flex: "none", border: "none", background: "#0b1220", color: "#fff", borderRadius: 7, padding: "5px 10px", font: `700 11.5px ${F}`, cursor: "pointer" }}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ font: `700 11px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Referred ambassadors · {ams.length}</span>
          <div style={{ border: "1px solid #e3e6ec", borderRadius: 12, overflow: "hidden" }}>
            {ams.map(a => (
              <div key={a.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) 104px 116px 56px 84px", gap: 9, alignItems: "center", padding: "9px 12px", borderBottom: "1px solid #f0f2f5" }}>
                <div style={{ minWidth: 0 }}><div style={{ font: `600 13px ${F}`, color: "#0b1220", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div><div style={{ font: `500 11px ${F}`, color: "#8a93a3" }}>{a.when}</div></div>
                <span><span style={{ font: `700 10.5px ${F}`, padding: "2px 8px", borderRadius: 999, background: a.stBg, color: a.stFg, whiteSpace: "nowrap" }}>{a.st}</span></span>
                <span style={{ font: `500 11.5px ${F}`, color: "#5b6779", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.path}</span>
                <span style={{ font: `700 12.5px ${FN}`, color: "#0b1220" }}>{a.amt}</span>
                {a.canPay
                  ? <button onClick={() => onPay(a.id, a.name)} disabled={busy} style={{ border: "none", background: "#0f7a3d", color: "#fff", borderRadius: 7, padding: "5px 8px", font: `700 11px ${F}`, cursor: busy ? "default" : "pointer", justifySelf: "end" }}>Pay</button>
                  : <span style={{ font: `700 11.5px ${F}`, color: a.payFg, textAlign: "right" }}>{a.pay}</span>}
              </div>
            ))}
            {!ams.length && <div style={{ padding: 18, textAlign: "center", color: "#8a93a3", font: `500 12px ${F}` }}>No referred ambassadors yet.</div>}
          </div>
        </div>
      </div>
    </div>
  </>;
}
