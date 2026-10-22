"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"] });
const F = jakarta.style.fontFamily;
const G = grotesk.style.fontFamily;

type Episode = { at: string; recovDays: number | null };
type Acct = {
  id: string; name: string; url: string | null; status: string; verified: boolean;
  createdAt: string | null; everRestricted: boolean; open: boolean; recovered: boolean; perma: boolean;
  restrictCount: number; firstRestrictedAt: string | null; lastRestrictedAt: string | null; episodes: Episode[];
  proxyHost: string | null; proxyType: "datacenter" | "residential" | "none"; geo: "match" | "mismatch" | "unknown" | "none";
  ageMonths: number | null; rentedEver: boolean; renters: string[]; emailDomain: string | null; cause: string; wave: boolean;
};
type Data = { now: number; waveHost: string; accounts: Acct[] };

const DAY = 86400000;
const pct = (x: number | null | undefined, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const fmtDay = (iso: string | null) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
const gapDays = (createdISO: string | null, hitISO: string | null) => (createdISO && hitISO ? (Date.parse(hitISO) - Date.parse(createdISO)) / DAY : null);
const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (k: string) => { const [y, m] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }); };
const halfOf = (iso: string) => { const d = new Date(iso); return `${d.getUTCFullYear()} ${d.getUTCMonth() < 6 ? "H1" : "H2"}`; };
const ageBucket = (m: number | null) => (m == null ? "Unknown age" : m < 12 ? "< 1 yr" : m < 36 ? "1–3 yr" : m < 60 ? "3–5 yr" : "5+ yr");

type Seg = { key: string; label: string; n: number; restricted: number; rate: number };
type Metrics = ReturnType<typeof metricsOf>;

function metricsOf(list: Acct[], now: number) {
  const n = list.length;
  const ever = list.filter((a) => a.everRestricted).length;
  const eps = list.flatMap((a) => a.episodes);
  const elig30 = eps.filter((e) => (now - Date.parse(e.at)) / DAY >= 30);
  const rec30 = elig30.filter((e) => e.recovDays != null && e.recovDays <= 30).length;
  const aged = list.filter((a) => a.createdAt && (now - Date.parse(a.createdAt)) / DAY >= 30);
  const fm = aged.filter((a) => { const g = gapDays(a.createdAt, a.firstRestrictedAt); return g != null && g <= 30 && g >= -1; }).length;
  const recDays = eps.filter((e) => e.recovDays != null).map((e) => e.recovDays!).sort((x, y) => x - y);
  return {
    n, ever, everRate: n ? ever / n : 0,
    now: list.filter((a) => a.open).length, perma: list.filter((a) => a.perma).length,
    recovered: list.filter((a) => a.recovered).length, recoveredRate: ever ? list.filter((a) => a.recovered).length / ever : null,
    repeat: list.filter((a) => a.restrictCount >= 2).length,
    firstMonthRate: aged.length ? fm / aged.length : null, firstMonthNum: fm, firstMonthDen: aged.length,
    rec30Rate: elig30.length ? rec30 / elig30.length : null, rec30Num: rec30, rec30Den: elig30.length,
    medianRecovery: recDays.length ? recDays[Math.floor(recDays.length / 2)] : null,
  };
}

// A driver dimension: segments with their ever-restricted rate, plus the gap (worst − best among
// segments with 10+ accounts). keyFn returns a segment label, or null to drop the account.
function dimension(list: Acct[], keyFn: (a: Acct) => string | null): { segs: Seg[]; gap: number } {
  const map = new Map<string, { n: number; r: number }>();
  for (const a of list) { const k = keyFn(a); if (k == null) continue; const row = map.get(k) || { n: 0, r: 0 }; row.n += 1; if (a.everRestricted) row.r += 1; map.set(k, row); }
  const segs = [...map.entries()].map(([key, v]) => ({ key, label: key, n: v.n, restricted: v.r, rate: v.n ? v.r / v.n : 0 })).sort((x, y) => y.rate - x.rate);
  const big = segs.filter((s) => s.n >= 10);
  const gap = big.length >= 2 ? big[0].rate - big[big.length - 1].rate : 0;
  return { segs, gap };
}

// Styling atoms ------------------------------------------------------------
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e3e6ec", borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 };
const h3: React.CSSProperties = { font: `600 17px ${G}`, color: "#0b1220", margin: 0 };
const sub: React.CSSProperties = { font: `500 12.5px ${F}`, color: "#5b6779", margin: 0, lineHeight: 1.45 };
const rateColor = (r: number | null) => (r == null ? "#8a93a3" : r > 0.4 ? "#b91c1c" : r > 0.2 ? "#b45309" : "#0b1220");

function Bar({ w, color = "#dc2626" }: { w: string; color?: string }) {
  return <div style={{ flex: 1, height: 8, borderRadius: 999, background: "#eef0f4", overflow: "hidden", minWidth: 40 }}><div style={{ width: w, height: "100%", background: color, borderRadius: 999 }} /></div>;
}

// Dimension defs (label + accessor + optional caveat) ----------------------
const DIMS: { key: string; label: string; fn: (a: Acct) => string | null; note?: string }[] = [
  { key: "proxyType", label: "Proxy type", fn: (a) => (a.proxyType === "datacenter" ? "Datacenter (Proxy6)" : a.proxyType === "residential" ? "Residential (proxy-cheap)" : "No proxy") },
  { key: "proxyHost", label: "Proxy host", fn: (a) => a.proxyHost || "No proxy" },
  { key: "geo", label: "Proxy geo vs home region", fn: (a) => (a.geo === "match" ? "Geo matches (PH)" : a.geo === "mismatch" ? "Geo mismatch" : a.geo === "unknown" ? "Proxy · geo unknown" : "No proxy") },
  { key: "age", label: "Account age", fn: (a) => ageBucket(a.ageMonths) },
  { key: "rented", label: "Rented vs never rented", fn: (a) => (a.rentedEver ? "Rented at least once" : "Never rented") },
  { key: "renter", label: "Renter", fn: (a) => (a.renters.length ? a.renters[0] : null), note: "An account rented by several renters counts under the first. Renters get accounts after provisioning — read this alongside Rented vs never." },
  { key: "email", label: "Login email domain", fn: (a) => a.emailDomain || "No login email" },
  { key: "cohort", label: "Creation cohort", fn: (a) => (a.createdAt ? halfOf(a.createdAt) : null) },
  { key: "cause", label: "Restriction cause", fn: (a) => (a.everRestricted ? a.cause : null), note: "Cause comes from captured LinkedIn security email. Most restrictions are phone/Persona checkpoints with no email, so Unknown dominates." },
];

type DrawerState = { title: string; sub: string; rows: Acct[] } | null;

export default function RestrictionAnalysisPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"ov" | "dr" | "cmp" | "coh">("ov");
  const [exOn, setExOn] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [cmpA, setCmpA] = useState("proxyType:Datacenter (Proxy6)");
  const [cmpB, setCmpB] = useState("proxyType:Residential (proxy-cheap)");

  useEffect(() => { fetch("/api/admin/restriction-analysis").then((r) => r.json()).then((d) => (d.error ? setError(d.error) : setData(d))).catch((e) => setError(String(e))); }, []);

  const now = data?.now ?? Date.now();
  const allAccts = data?.accounts ?? [];
  const base = useMemo(() => (exOn ? allAccts.filter((a) => !a.wave) : allAccts), [allAccts, exOn]);
  const waveCount = useMemo(() => allAccts.filter((a) => a.wave).length, [allAccts]);

  const m = useMemo(() => metricsOf(base, now), [base, now]);

  // Monthly trend (rate = restrictions ÷ accounts live by then). Wave split for the striped bar.
  const monthly = useMemo(() => {
    const created = allAccts.map((a) => a.createdAt).filter((x): x is string => !!x);
    if (!created.length) return [] as { k: string; label: string; active: number; total: number; wave: number; rate: number; partial: boolean }[];
    const min = created.reduce((a, b) => (a < b ? a : b));
    const months: string[] = [];
    for (let cur = new Date(Date.UTC(+min.slice(0, 4), +min.slice(5, 7) - 1, 1)); cur <= new Date(now); cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1))) months.push(cur.toISOString().slice(0, 7));
    const nowK = new Date(now).toISOString().slice(0, 7);
    return months.map((k) => {
      const [y, mo] = k.split("-").map(Number);
      const endMs = Date.UTC(y, mo, 0, 23, 59, 59);
      const active = base.filter((a) => a.createdAt && Date.parse(a.createdAt) <= endMs).length;
      let total = 0, wave = 0;
      for (const a of base) for (const e of a.episodes) if (monthKey(e.at) === k) { total += 1; if (a.wave) wave += 1; }
      return { k, label: monthLabel(k), active, total, wave, rate: active ? total / active : 0, partial: k === nowK };
    });
  }, [base, allAccts, now]);
  const maxRate = Math.max(0.0001, ...monthly.map((x) => x.rate));

  // Recovery within 30 days, by month restricted.
  const recovery = useMemo(() => monthly.map((mm) => {
    const eps = base.flatMap((a) => a.episodes).filter((e) => monthKey(e.at) === mm.k);
    const elig = eps.filter((e) => (now - Date.parse(e.at)) / DAY >= 30);
    const rec = elig.filter((e) => e.recovDays != null && e.recovDays <= 30).length;
    return { k: mm.k, label: mm.label, has: elig.length > 0, pending: eps.length > 0 && elig.length === 0, rate: elig.length ? rec / elig.length : 0, n: elig.length };
  }), [monthly, base, now]);
  const maxRec = Math.max(0.0001, ...recovery.filter((r) => r.has).map((r) => r.rate));

  // Six-month buckets: metric × half, with change.
  const halves = useMemo(() => {
    const keys = [...new Set(base.map((a) => (a.createdAt ? halfOf(a.createdAt) : null)).filter((x): x is string => !!x))].sort();
    const byHalf = keys.map((k) => ({ k, mx: metricsOf(base.filter((a) => a.createdAt && halfOf(a.createdAt) === k), now) }));
    const rows: { label: string; fmt: (x: Metrics) => string; val: (x: Metrics) => number | null; worseUp: boolean }[] = [
      { label: "Restricted in first month", fmt: (x) => pct(x.firstMonthRate, 0), val: (x) => x.firstMonthRate, worseUp: true },
      { label: "Ever restricted", fmt: (x) => pct(x.everRate, 0), val: (x) => x.everRate, worseUp: true },
      { label: "Recovered ≤30 days", fmt: (x) => pct(x.rec30Rate, 0), val: (x) => x.rec30Rate, worseUp: false },
    ];
    return { keys, byHalf, rows };
  }, [base, now]);

  // Proxy type summary (our real stand-in for pool vs non-pool).
  const proxySummary = useMemo(() => ["datacenter", "residential", "none"].map((t) => {
    const list = base.filter((a) => a.proxyType === t);
    return { t, label: t === "datacenter" ? "Datacenter (Proxy6)" : t === "residential" ? "Residential (proxy-cheap)" : "No proxy", n: list.length, ever: list.filter((a) => a.everRestricted).length, now: list.filter((a) => a.open).length, lost: list.filter((a) => a.perma).length };
  }), [base]);

  // Drivers ranked by gap.
  const drivers = useMemo(() => DIMS.map((d) => ({ ...d, ...dimension(base, d.fn) })).sort((a, b) => b.gap - a.gap), [base]);

  // Hypothesis checks (provisioning vs renters).
  const checks = useMemo(() => {
    const rateOf = (fn: (a: Acct) => boolean) => { const l = base.filter(fn); return l.length ? l.filter((a) => a.everRestricted).length / l.length : 0; };
    const mk = (label: string, aFn: (a: Acct) => boolean, bFn: (a: Acct) => boolean, aL: string, bL: string) => { const ra = rateOf(aFn), rb = rateOf(bFn); const g = ra - rb; return { label, gap: g, detail: `${aL} ${pct(ra, 0)} vs ${bL} ${pct(rb, 0)}`, strong: Math.abs(g) >= 0.1 }; };
    return [
      mk("Rented vs never rented", (a) => a.rentedEver, (a) => !a.rentedEver, "rented", "never"),
      mk("Datacenter vs residential", (a) => a.proxyType === "datacenter", (a) => a.proxyType === "residential", "datacenter", "residential"),
      mk("Geo mismatch vs match", (a) => a.geo === "mismatch", (a) => a.geo === "match", "mismatch", "match"),
      mk("Young (<1yr) vs aged (3yr+)", (a) => a.ageMonths != null && a.ageMonths < 12, (a) => a.ageMonths != null && a.ageMonths >= 36, "young", "aged"),
    ];
  }, [base]);

  // Cause table (episodes attributed by the restricted account's cause).
  const causes = useMemo(() => {
    const names = [...new Set(base.filter((a) => a.everRestricted).map((a) => a.cause))];
    const total = base.filter((a) => a.everRestricted).length || 1;
    return names.map((name) => {
      const list = base.filter((a) => a.everRestricted && a.cause === name);
      const eps = list.flatMap((a) => a.episodes);
      const elig = eps.filter((e) => (now - Date.parse(e.at)) / DAY >= 30);
      const rec = elig.filter((e) => e.recovDays != null && e.recovDays <= 30).length;
      const recDays = eps.filter((e) => e.recovDays != null).map((e) => e.recovDays!).sort((x, y) => x - y);
      return { name, n: list.length, share: list.length / total, recRate: elig.length ? rec / elig.length : null, med: recDays.length ? recDays[Math.floor(recDays.length / 2)] : null, perma: list.filter((a) => a.perma).length };
    }).sort((a, b) => b.n - a.n);
  }, [base, now]);

  // Compare options + sides.
  const cmpOptions = useMemo(() => {
    const opts: { v: string; l: string }[] = [{ v: "all:All accounts", l: "All accounts" }];
    for (const d of DIMS) for (const s of dimension(base, d.fn).segs) if (s.n >= 5) opts.push({ v: `${d.key}:${s.label}`, l: `${d.label} · ${s.label}` });
    return opts;
  }, [base]);
  const subsetFor = (v: string): Acct[] => { const [k, ...rest] = v.split(":"); const val = rest.join(":"); if (k === "all") return base; const d = DIMS.find((x) => x.key === k); return d ? base.filter((a) => d.fn(a) === val) : base; };
  const labelFor = (v: string) => cmpOptions.find((o) => o.v === v)?.l || v;
  const mA = useMemo(() => metricsOf(subsetFor(cmpA), now), [cmpA, base, now]);
  const mB = useMemo(() => metricsOf(subsetFor(cmpB), now), [cmpB, base, now]);

  // Cohort windows (N days of joining), censored.
  const WINDOWS = [30, 60, 90, 180];
  const cohortRows = useMemo(() => {
    const keyer = (fmt: "half" | "month") => { const map = new Map<string, Acct[]>(); for (const a of base) { if (!a.createdAt) continue; const k = fmt === "half" ? halfOf(a.createdAt) : monthKey(a.createdAt); const l = map.get(k) || []; l.push(a); map.set(k, l); } return map; };
    const build = (map: Map<string, Acct[]>, isHalf: boolean) => [...map.entries()].map(([k, list]) => ({
      key: k, label: isHalf ? `${k.slice(5)} ${k.slice(0, 4)}` : `${monthLabel(k)} ${k.slice(0, 4)}`, isHalf, order: isHalf ? `${k.slice(0, 4)}-${k.slice(5) === "H1" ? "00" : "06"}` : k, total: list.length,
      cells: WINDOWS.map((w) => { const elig = list.filter((a) => a.createdAt && (now - Date.parse(a.createdAt)) / DAY >= w); const r = elig.filter((a) => { const g = gapDays(a.createdAt, a.firstRestrictedAt); return g != null && g <= w && g >= -1; }).length; return { days: w, eligible: elig.length, restricted: r, rate: elig.length ? r / elig.length : null }; }),
    }));
    return [...build(keyer("half"), true), ...build(keyer("month"), false)].sort((a, b) => a.order.localeCompare(b.order) || (a.isHalf === b.isHalf ? 0 : a.isHalf ? -1 : 1));
  }, [base, now]);

  const openDrawer = (title: string, sub2: string, rows: Acct[]) => setDrawer({ title, sub: sub2, rows: rows.slice(0, 400) });

  if (error) return <div style={{ ...card, color: "#b91c1c", fontFamily: F }}>Couldn&apos;t load: {error}</div>;
  if (!data) return <div style={{ fontFamily: F, color: "#8a93a3", padding: 24 }}>Loading restriction analysis…</div>;

  const TABS: [typeof tab, string][] = [["ov", "Overview"], ["dr", "Drivers"], ["cmp", "Compare"], ["coh", "Cohorts"]];

  return (
    <div style={{ fontFamily: F, color: "#0b1220", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 720 }}>
          <h1 style={{ font: `600 28px ${G}`, margin: "0 0 4px", letterSpacing: "-.01em" }}>Restriction analysis</h1>
          <p style={{ ...sub, fontSize: 13.5 }}>Is it getting worse, what is driving it, and which segments to fix or retire. {allAccts.length} accounts · events logged since Mar 2026.</p>
        </div>
        <button onClick={() => setExOn((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 9, border: `1px solid ${exOn ? "#fde68a" : "#dde1e8"}`, background: exOn ? "#fffbeb" : "#fff", borderRadius: 10, padding: "7px 12px", font: `600 12.5px ${F}`, color: "#0b1220", cursor: "pointer", whiteSpace: "nowrap" }}>
          <span style={{ width: 30, height: 18, borderRadius: 999, background: exOn ? "#f59e0b" : "#cbd2dc", display: "flex", alignItems: "center", padding: 2, justifyContent: exOn ? "flex-end" : "flex-start" }}><span style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff" }} /></span>
          Exclude Oct-20 proxy wave · {waveCount} accounts
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", background: "#fff", border: "1px solid #e3e6ec", borderRadius: 11, padding: 3, gap: 2, flexWrap: "wrap" }}>
          {TABS.map(([k, label]) => <button key={k} onClick={() => setTab(k)} style={{ border: "none", background: tab === k ? "#0b1220" : "transparent", color: tab === k ? "#fff" : "#5b6779", borderRadius: 8, padding: "7px 14px", font: `700 13px ${F}`, cursor: "pointer" }}>{label}</button>)}
        </div>
        {exOn && <span style={{ font: `600 12.5px ${F}`, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 999, padding: "5px 12px" }}>Oct-20 wave excluded: {waveCount} accounts removed from counts & rates</span>}
      </div>

      {/* ===== OVERVIEW ===== */}
      {tab === "ov" && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(168px,1fr))", gap: 10 }}>
          {[
            { label: "Accounts", v: String(m.n), sub: "tracked", fg: "#0b1220", go: () => openDrawer("All accounts", `${m.n} accounts`, base) },
            { label: "Ever restricted", v: pct(m.everRate, 0), sub: `${m.ever} accounts`, fg: "#b91c1c", go: () => openDrawer("Ever restricted", `${m.ever} accounts`, base.filter((a) => a.everRestricted)) },
            { label: "Restricted now", v: String(m.now), sub: "currently down", fg: "#b45309", go: () => openDrawer("Currently restricted", `${m.now} accounts`, base.filter((a) => a.open)) },
            { label: "First-month rate", v: pct(m.firstMonthRate, 0), sub: `${m.firstMonthNum}/${m.firstMonthDen} aged 30d+`, fg: "#b91c1c", go: () => openDrawer("Restricted in first month", "accounts 30d+ old, hit within 30d of joining", base.filter((a) => a.createdAt && (now - Date.parse(a.createdAt)) / DAY >= 30 && (() => { const g = gapDays(a.createdAt, a.firstRestrictedAt); return g != null && g <= 30 && g >= -1; })())) },
            { label: "Retrieved ≤30d", v: pct(m.rec30Rate, 0), sub: `${m.rec30Num}/${m.rec30Den} episodes`, fg: "#0f7a3d", go: () => openDrawer("Recovered within 30 days", `${m.rec30Num} of ${m.rec30Den} eligible episodes`, base.filter((a) => a.recovered)) },
            { label: "Permanent loss", v: String(m.perma), sub: `${pct(m.ever ? m.perma / m.ever : 0, 0)} of restricted`, fg: "#0b1220", go: () => openDrawer("Permanently restricted", `${m.perma} accounts`, base.filter((a) => a.perma)) },
          ].map((t) => (
            <button key={t.label} onClick={t.go} style={{ textAlign: "left", cursor: "pointer", background: "#fff", border: "1px solid #e3e6ec", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ font: `700 11px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: "#5b6779" }}>{t.label}</span>
              <span style={{ font: `700 26px ${G}`, color: t.fg }}>{t.v}</span>
              <span style={{ font: `600 12px ${F}`, color: "#5b6779" }}>{t.sub}</span>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
          {/* Monthly trend */}
          <div style={{ ...card, flex: "2 1 560px", minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div><span style={h3}>Restricted each month</span><p style={sub}>Restrictions ÷ accounts live by then, so a growing book doesn&apos;t inflate the trend. Click a count to see the accounts.</p></div>
              {!exOn && waveCount > 0 && <div style={{ display: "flex", gap: 12, font: `600 11.5px ${F}`, color: "#5b6779" }}><span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "#dc2626" }} />Restrictions</span><span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "repeating-linear-gradient(135deg,#f59e0b 0 3px,#fde68a 3px 6px)" }} />Oct-20 wave</span></div>}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height: 190, borderBottom: "1px solid #e6e9ee" }}>
              {monthly.map((mm) => (
                <div key={mm.k} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 5 }}>
                  <span style={{ font: `700 11.5px ${G}`, color: "#0b1220" }}>{pct(mm.rate, 0)}</span>
                  <div style={{ width: "100%", maxWidth: 44, height: `${Math.max(2, (mm.rate / maxRate) * 100)}%`, display: "flex", flexDirection: "column", borderRadius: "6px 6px 0 0", overflow: "hidden" }}>
                    {!exOn && mm.wave > 0 && <div style={{ height: `${(mm.wave / mm.total) * 100}%`, background: "repeating-linear-gradient(135deg,#f59e0b 0 4px,#fde68a 4px 8px)" }} />}
                    <div style={{ flex: 1, background: mm.partial ? "repeating-linear-gradient(135deg,#dc2626 0 6px,rgba(220,38,38,.5) 6px 12px)" : "#dc2626" }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {monthly.map((mm) => (
                <div key={mm.k} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ font: `700 11.5px ${F}`, color: "#0b1220" }}>{mm.label}{mm.partial && <span style={{ color: "#8a93a3" }}>*</span>}</span>
                  <button onClick={() => openDrawer(`Restricted in ${mm.label}`, `${mm.total} restrictions`, base.filter((a) => a.episodes.some((e) => monthKey(e.at) === mm.k)))} style={{ border: "none", background: "none", padding: 0, font: `600 11px ${F}`, color: "#2563eb", cursor: "pointer" }}>{mm.total}</button>
                </div>
              ))}
            </div>
            <span style={{ font: `500 11px ${F}`, color: "#8a93a3" }}>* current month is partial. {!exOn && waveCount > 0 ? "Striped = the Oct-20 dead-proxy wave — toggle it off above to see the organic trend." : "Organic trend (wave excluded)."}</span>
          </div>

          {/* Six-month buckets */}
          <div style={{ ...card, flex: "1 1 340px", minWidth: 0 }}>
            <div><span style={h3}>Six-month buckets</span><p style={sub}>Before and after, half-year by half-year.</p></div>
            <div style={{ display: "grid", gridTemplateColumns: `minmax(0,1.4fr) repeat(${halves.keys.length},1fr)`, gap: 10, paddingBottom: 6, borderBottom: "1px solid #eef0f4", font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>
              <span></span>{halves.keys.map((k) => <span key={k}>{k.slice(5)} {k.slice(0, 4)}</span>)}
            </div>
            {halves.rows.map((row) => {
              const vals = halves.byHalf.map((h) => row.val(h.mx));
              const first = vals[0], last = vals[vals.length - 1];
              const chg = first != null && last != null ? last - first : null;
              const bad = chg != null && (row.worseUp ? chg > 0 : chg < 0);
              return (
                <div key={row.label} style={{ display: "grid", gridTemplateColumns: `minmax(0,1.4fr) repeat(${halves.keys.length},1fr)`, gap: 10, alignItems: "center", padding: "3px 0" }}>
                  <span style={{ font: `600 12.5px ${F}`, color: "#0b1220" }}>{row.label}</span>
                  {halves.byHalf.map((h, i) => (
                    <span key={h.k} style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ font: `700 15px ${G}`, color: i === vals.length - 1 ? "#0b1220" : "#5b6779" }}>{row.fmt(h.mx)}</span>
                      {i === vals.length - 1 && chg != null && <span style={{ font: `700 10px ${F}`, color: bad ? "#b91c1c" : "#0f7a3d" }}>{chg > 0 ? "▲" : chg < 0 ? "▼" : "—"} {pct(Math.abs(chg), 0)}</span>}
                    </span>
                  ))}
                </div>
              );
            })}
            <span style={{ font: `500 11px ${F}`, color: "#8a93a3" }}>First-month & ever use accounts aged enough; recovery excludes windows still open.</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
          {/* Recovery by month */}
          <div style={{ ...card, flex: "1.4 1 420px", minWidth: 0 }}>
            <div><span style={h3}>Recovered within 30 days</span><p style={sub}>By month of restriction. October stays pending until 30 days pass.</p></div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height: 130, borderBottom: "1px solid #e6e9ee" }}>
              {recovery.map((r) => (
                <div key={r.k} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 5 }}>
                  {r.has ? <><span style={{ font: `700 11.5px ${G}`, color: "#0b1220", opacity: r.n < 10 ? 0.5 : 1 }}>{pct(r.rate, 0)}</span><div style={{ width: "100%", maxWidth: 40, height: `${Math.max(3, (r.rate / maxRec) * 100)}%`, background: "#16a34a", borderRadius: "6px 6px 0 0", opacity: r.n < 10 ? 0.5 : 1 }} /></>
                    : r.pending ? <><span style={{ font: `600 11px ${F}`, color: "#8a93a3" }}>pending</span><div style={{ width: "100%", maxWidth: 40, height: "55%", border: "1.5px dashed #cbd2dc", borderBottom: "none", borderRadius: "6px 6px 0 0" }} /></> : null}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>{recovery.map((r) => <div key={r.k} style={{ flex: 1, minWidth: 0, textAlign: "center", font: `700 11.5px ${F}`, color: "#0b1220" }}>{r.label}</div>)}</div>
            <span style={{ font: `500 11px ${F}`, color: "#8a93a3" }}>Faded bars have under 10 restrictions. Median recovery {m.medianRecovery != null ? `${m.medianRecovery.toFixed(1)}d` : "—"}.</span>
          </div>

          {/* Proxy type summary */}
          <div style={{ ...card, flex: "1 1 320px", minWidth: 0 }}>
            <div><span style={h3}>Datacenter vs residential</span><p style={sub}>Our real split (LV has no pool/non-pool — that&apos;s an Ortus concept). All time.</p></div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) 54px 64px 54px 46px", gap: 8, paddingBottom: 6, borderBottom: "1px solid #eef0f4", font: `700 10.5px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: "#8a93a3" }}>
              <span></span><span>Accts</span><span>Ever</span><span>Now</span><span>Lost</span>
            </div>
            {proxySummary.map((p) => (
              <div key={p.t} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) 54px 64px 54px 46px", gap: 8, alignItems: "center", padding: "4px 0" }}>
                <span style={{ font: `600 12.5px ${F}`, color: "#0b1220" }}>{p.label}</span>
                <span style={{ font: `700 14px ${G}`, color: "#5b6779" }}>{p.n}</span>
                <button onClick={() => openDrawer(`${p.label} · ever restricted`, `${p.ever} of ${p.n}`, base.filter((a) => a.proxyType === p.t && a.everRestricted))} style={{ border: "none", background: "none", padding: 0, textAlign: "left", font: `700 14px ${G}`, color: "#b91c1c", cursor: "pointer" }}>{p.ever} · {pct(p.n ? p.ever / p.n : 0, 0)}</button>
                <span style={{ font: `700 14px ${G}`, color: "#92400e" }}>{p.now}</span>
                <span style={{ font: `700 14px ${G}`, color: "#0b1220" }}>{p.lost}</span>
              </div>
            ))}
            <span style={{ font: `500 12px ${F}`, color: "#5b6779", lineHeight: 1.45 }}>Datacenter is a best-effort flag from known Proxy6 ranges (45.32.117.124 + 168.227.142.x).</span>
          </div>
        </div>
      </>}

      {/* ===== DRIVERS ===== */}
      {tab === "dr" && <>
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ maxWidth: 640 }}><span style={h3}>Provisioning or renters?</span><p style={sub}>Rented and never-rented accounts restrict at about the same rate — so renter use probably isn&apos;t the driver. These checks test whether proxy, geo and age separate restricted accounts better.</p></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 10 }}>
            {checks.map((c) => (
              <div key={c.label} style={{ border: "1px solid #eef0f4", background: "#f8f9fb", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ font: `700 13px ${F}`, color: "#0b1220" }}>{c.label}</span>
                <span style={{ font: `700 22px ${G}`, color: c.strong ? "#b91c1c" : "#0b1220" }}>{c.gap >= 0 ? "+" : ""}{pct(c.gap, 0)}</span>
                <span style={{ font: `500 12px ${F}`, color: "#5b6779" }}>{c.detail}</span>
                <span style={{ font: `700 11px ${F}`, padding: "3px 9px", borderRadius: 999, alignSelf: "flex-start", background: c.strong ? "#fef2f2" : "#f1f5f9", color: c.strong ? "#b91c1c" : "#475569" }}>{c.strong ? "separates" : "weak signal"}</span>
              </div>
            ))}
          </div>
        </div>

        <div><span style={h3}>Variables ranked by gap</span><p style={sub}>Gap = worst segment&apos;s ever-restricted rate minus the best, counting only segments with 10+ accounts. Red = worst, green = best. Click a rate to see its accounts.</p></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,460px),1fr))", gap: 16, alignItems: "start" }}>
          {drivers.map((d, i) => {
            const shown = d.segs.filter((s) => s.n >= 5);
            const big = d.segs.filter((s) => s.n >= 10);
            const worst = big[0]?.key, best = big[big.length - 1]?.key;
            const maxR = Math.max(0.0001, ...shown.map((s) => s.rate));
            return (
              <div key={d.key} style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 26, height: 26, borderRadius: "50%", background: i < 3 ? "#0b1220" : "#eef0f4", color: i < 3 ? "#fff" : "#5b6779", display: "grid", placeItems: "center", font: `700 12.5px ${G}` }}>{i + 1}</span>
                  <span style={{ flex: 1, font: `600 16px ${G}` }}>{d.label}</span>
                  <span style={{ font: `700 12px ${F}`, padding: "3px 10px", borderRadius: 999, background: d.gap > 0.2 ? "#fef2f2" : "#f1f5f9", color: d.gap > 0.2 ? "#b91c1c" : "#475569" }}>gap {pct(d.gap, 0)}</span>
                </div>
                {d.note && <span style={{ font: `500 12px ${F}`, color: "#92400e", background: "#fffbeb", borderRadius: 9, padding: "8px 10px", lineHeight: 1.45 }}>{d.note}</span>}
                {shown.map((s) => (
                  <div key={s.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) 42px minmax(70px,1fr) 46px", gap: 10, alignItems: "center", opacity: s.n < 10 ? 0.55 : 1 }}>
                    <span title={s.label} style={{ font: `600 12.5px ${F}`, color: "#0b1220", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
                    <button onClick={() => openDrawer(`${d.label}: ${s.label}`, `${s.n} accounts`, base.filter((a) => d.fn(a) === s.key))} style={{ border: "none", background: "none", padding: 0, textAlign: "left", font: `600 12.5px ${G}`, color: "#5b6779", cursor: "pointer" }}>{s.n}</button>
                    <Bar w={`${(s.rate / maxR) * 100}%`} color={s.key === worst ? "#dc2626" : s.key === best ? "#16a34a" : "#94a3b8"} />
                    <button onClick={() => openDrawer(`${d.label}: ${s.label} · restricted`, `${s.restricted} of ${s.n}`, base.filter((a) => d.fn(a) === s.key && a.everRestricted))} style={{ border: "none", background: "none", padding: 0, textAlign: "right", font: `700 13.5px ${G}`, color: rateColor(s.rate), cursor: "pointer" }}>{pct(s.rate, 0)}</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Cause table */}
        <div style={card}>
          <div><span style={h3}>Restriction cause</span><p style={sub}>From captured LinkedIn security email. Compared on outcome: how often and how fast accounts come back.</p></div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 620, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(170px,1.3fr) minmax(150px,1.3fr) 100px 90px 70px", gap: 12, paddingBottom: 6, borderBottom: "1px solid #eef0f4", font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>
                <span>Cause</span><span>Share</span><span>Back ≤30d</span><span>Median</span><span>Lost</span>
              </div>
              {causes.map((c) => (
                <div key={c.name} style={{ display: "grid", gridTemplateColumns: "minmax(170px,1.3fr) minmax(150px,1.3fr) 100px 90px 70px", gap: 12, alignItems: "center" }}>
                  <span style={{ font: `700 13px ${F}`, color: "#0b1220" }}>{c.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Bar w={`${c.share * 100}%`} color="#475569" /><button onClick={() => openDrawer(`Cause: ${c.name}`, `${c.n} accounts`, base.filter((a) => a.everRestricted && a.cause === c.name))} style={{ border: "none", background: "none", padding: 0, font: `600 12px ${F}`, color: "#2563eb", cursor: "pointer", whiteSpace: "nowrap" }}>{c.n} · {pct(c.share, 0)}</button></div>
                  <span style={{ font: `700 14px ${G}`, color: "#0f7a3d" }}>{pct(c.recRate, 0)}</span>
                  <span style={{ font: `700 14px ${G}`, color: "#0b1220" }}>{c.med != null ? `${c.med.toFixed(1)}d` : "—"}</span>
                  <span style={{ font: `700 14px ${G}`, color: c.perma ? "#b91c1c" : "#0b1220" }}>{c.perma}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>}

      {/* ===== COMPARE ===== */}
      {tab === "cmp" && <>
        <div style={card}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#0b1220" }} />
            <select value={cmpA} onChange={(e) => setCmpA(e.target.value)} style={{ flex: 1, minWidth: 220, border: "1px solid #dde1e8", background: "#fff", borderRadius: 10, padding: "9px 10px", font: `600 13px ${F}`, color: "#0b1220" }}>{cmpOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
            <button onClick={() => { const a = cmpA; setCmpA(cmpB); setCmpB(a); }} style={{ border: "1px solid #dde1e8", background: "#f8f9fb", borderRadius: 9, padding: "8px 10px", font: `700 12.5px ${F}`, color: "#5b6779", cursor: "pointer" }}>⇄</button>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#2563eb" }} />
            <select value={cmpB} onChange={(e) => setCmpB(e.target.value)} style={{ flex: 1, minWidth: 220, border: "1px solid #dde1e8", background: "#fff", borderRadius: 10, padding: "9px 10px", font: `600 13px ${F}`, color: "#0b1220" }}>{cmpOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid #f0f2f5", paddingTop: 10 }}>
            <span style={{ font: `600 12px ${F}`, color: "#8a93a3", marginRight: 2 }}>Quick picks</span>
            {[["proxyType:Datacenter (Proxy6)", "proxyType:Residential (proxy-cheap)", "DC vs residential"], ["rented:Rented at least once", "rented:Never rented", "Rented vs never"], ["cohort:2026 H1", "cohort:2026 H2", "H1 vs H2"], ["geo:Geo mismatch", "geo:Geo matches (PH)", "Geo mismatch vs match"]].map(([a, b, l]) => (
              <button key={l} onClick={() => { setCmpA(a); setCmpB(b); }} style={{ border: "1.5px solid #dde1e8", background: "#fff", borderRadius: 999, padding: "4px 11px", font: `700 12px ${F}`, color: "#0b1220", cursor: "pointer" }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 14, overflowX: "auto" }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(170px,1fr) minmax(200px,1.3fr) minmax(200px,1.3fr) 90px", gap: 16, padding: "12px 18px", borderBottom: "1px solid #eef0f4", alignItems: "end" }}>
              <span style={{ font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Metric</span>
              <span style={{ font: `700 13px ${F}`, color: "#0b1220" }}>{labelFor(cmpA)} · {mA.n}</span>
              <span style={{ font: `700 13px ${F}`, color: "#2563eb" }}>{labelFor(cmpB)} · {mB.n}</span>
              <span style={{ font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3", textAlign: "right" }}>Gap</span>
            </div>
            {([
              ["Ever restricted", mA.everRate, mB.everRate, true],
              ["First-month rate", mA.firstMonthRate, mB.firstMonthRate, true],
              ["Restricted now", mA.n ? mA.now / mA.n : 0, mB.n ? mB.now / mB.n : 0, true],
              ["Recovered ≤30d", mA.rec30Rate, mB.rec30Rate, false],
              ["Permanent loss", mA.n ? mA.perma / mA.n : 0, mB.n ? mB.perma / mB.n : 0, true],
              ["Repeat restricted", mA.n ? mA.repeat / mA.n : 0, mB.n ? mB.repeat / mB.n : 0, true],
            ] as [string, number | null, number | null, boolean][]).map(([label, a, b, worseUp]) => {
              const d = a != null && b != null ? a - b : null;
              const bad = d != null && (worseUp ? d > 0 : d < 0);
              const mx = Math.max(0.0001, a || 0, b || 0);
              return (
                <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(170px,1fr) minmax(200px,1.3fr) minmax(200px,1.3fr) 90px", gap: 16, padding: "12px 18px", borderBottom: "1px solid #f0f2f5", alignItems: "center" }}>
                  <span style={{ font: `700 13px ${F}`, color: "#0b1220" }}>{label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 54, font: `700 16px ${G}`, color: "#0b1220" }}>{pct(a, 0)}</span><Bar w={`${((a || 0) / mx) * 100}%`} color="#0b1220" /></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 54, font: `700 16px ${G}`, color: "#2563eb" }}>{pct(b, 0)}</span><Bar w={`${((b || 0) / mx) * 100}%`} color="#2563eb" /></div>
                  <span style={{ font: `700 13.5px ${G}`, color: d == null ? "#8a93a3" : bad ? "#b91c1c" : "#0f7a3d", textAlign: "right" }}>{d == null ? "—" : `${d > 0 ? "+" : ""}${pct(d, 0)}`}</span>
                </div>
              );
            })}
          </div>
        </div>
        <span style={{ font: `500 12px ${F}`, color: "#8a93a3" }}>Gap = black minus blue. Red means the black side does worse on that metric.</span>
      </>}

      {/* ===== COHORTS ===== */}
      {tab === "coh" && (
        <div style={card}>
          <div><span style={h3}>Restricted within N days of joining</span><p style={sub}>Each row is the accounts added that period. Read down a column to compare cohorts at the same age — the fair test of whether provisioning got worse. Cells are censored (&ldquo;too new&rdquo; until a cohort reaches the window).</p></div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 640, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(150px,1.3fr) 76px repeat(4,minmax(84px,1fr))", gap: 8, paddingBottom: 6, borderBottom: "1px solid #eef0f4", font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>
                <span>Cohort</span><span>Accts</span>{WINDOWS.map((w) => <span key={w}>{w} days</span>)}
              </div>
              {cohortRows.map((r) => (
                <div key={r.key + (r.isHalf ? "h" : "m")} style={{ display: "grid", gridTemplateColumns: "minmax(150px,1.3fr) 76px repeat(4,minmax(84px,1fr))", gap: 8, alignItems: "center", padding: "3px 0", background: r.isHalf ? "#f8f9fb" : undefined, borderRadius: 6 }}>
                  <span style={{ font: `${r.isHalf ? 700 : 600} 13px ${F}`, color: "#0b1220", paddingLeft: r.isHalf ? 0 : 6 }}>{r.label}</span>
                  <span style={{ font: `600 13px ${G}`, color: "#5b6779" }}>{r.total}</span>
                  {r.cells.map((c) => (
                    <button key={c.days} disabled={c.rate == null} onClick={() => openDrawer(`${r.label} · restricted ≤${c.days}d`, `${c.restricted} of ${c.eligible} eligible`, base.filter((a) => a.createdAt && (r.isHalf ? halfOf(a.createdAt) === r.key : monthKey(a.createdAt) === r.key) && (now - Date.parse(a.createdAt)) / DAY >= c.days && (() => { const g = gapDays(a.createdAt, a.firstRestrictedAt); return g != null && g <= c.days && g >= -1; })()))} style={{ border: "none", background: "none", padding: "4px 2px", textAlign: "left", cursor: c.rate == null ? "default" : "pointer" }}>
                      {c.rate == null ? <span style={{ font: `500 11px ${F}`, color: "#8a93a3" }}>too new</span> : <span style={{ font: `700 13px ${G}`, color: rateColor(c.rate) }}>{pct(c.rate, 0)}{c.eligible < r.total && <span style={{ font: `500 10px ${F}`, color: "#8a93a3" }}> ·{c.eligible}</span>}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <span style={{ font: `500 11px ${F}`, color: "#8a93a3" }}>&ldquo;·N&rdquo; = only N of the cohort are old enough for that window. The 30-day column is the first-month rate.</span>
        </div>
      )}

      {/* ===== DRAWER ===== */}
      {drawer && <>
        <div onClick={() => setDrawer(null)} style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,.28)", zIndex: 40 }} />
        <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(820px,100vw)", background: "#fff", zIndex: 41, display: "flex", flexDirection: "column", boxShadow: "-12px 0 40px rgba(11,18,32,.14)", fontFamily: F }}>
          <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #eef0f4", display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}><span style={{ font: `700 19px ${G}`, color: "#0b1220" }}>{drawer.title}</span><div style={{ font: `500 12.5px ${F}`, color: "#5b6779" }}>{drawer.sub} · {drawer.rows.length} shown</div></div>
            <button onClick={() => setDrawer(null)} style={{ border: "none", background: "#eef0f4", width: 30, height: 30, borderRadius: 8, font: `700 14px ${F}`, color: "#5b6779", cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <div style={{ minWidth: 680 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(150px,1.4fr) 110px minmax(130px,1fr) minmax(120px,1fr) 70px", gap: 12, padding: "10px 20px", borderBottom: "1px solid #eef0f4", font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3", position: "sticky", top: 0, background: "#fff" }}>
                <span>Account</span><span>Status</span><span>Proxy</span><span>Cause</span><span>Hit</span>
              </div>
              {drawer.rows.map((a) => (
                <div key={a.id} style={{ display: "grid", gridTemplateColumns: "minmax(150px,1.4fr) 110px minmax(130px,1fr) minmax(120px,1fr) 70px", gap: 12, padding: "9px 20px", borderBottom: "1px solid #f0f2f5", alignItems: "center" }}>
                  <span style={{ minWidth: 0, font: `600 13px ${F}`, color: "#0b1220", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.url ? <a href={a.url.startsWith("http") ? a.url : `https://${a.url}`} target="_blank" rel="noreferrer" style={{ color: "#0b1220" }}>{a.name}</a> : a.name}</span>
                  <span style={{ font: `700 10.5px ${F}`, padding: "2px 8px", borderRadius: 999, background: a.open ? "#fef2f2" : a.perma ? "#f1f5f9" : "#ecfdf3", color: a.open ? "#b91c1c" : a.perma ? "#475569" : "#0f7a3d", whiteSpace: "nowrap", justifySelf: "start" }}>{a.open ? "restricted" : a.perma ? "lost" : a.everRestricted ? "recovered" : a.status}</span>
                  <span style={{ font: `500 12px ${F}`, color: a.proxyType === "datacenter" ? "#b91c1c" : "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.proxyHost || "—"}</span>
                  <span style={{ font: `500 12px ${F}`, color: "#5b6779", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.cause}</span>
                  <span style={{ font: `500 12px ${F}`, color: "#5b6779", whiteSpace: "nowrap" }}>{fmtDay(a.lastRestrictedAt)}</span>
                </div>
              ))}
              {!drawer.rows.length && <div style={{ padding: 20, font: `500 13px ${F}`, color: "#8a93a3" }}>No accounts.</div>}
            </div>
          </div>
        </div>
      </>}

      <p style={{ font: `500 11px ${F}`, color: "#8a93a3", margin: 0, textAlign: "right" }}>Generated {new Date(now).toLocaleString()}</p>
    </div>
  );
}
