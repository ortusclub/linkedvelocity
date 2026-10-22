"use client";
import { useEffect, useMemo, useState } from "react";
import {
  isReferralOnboarded, isReferralEarned, isReferralReadyToPay, referralCommissionAmount,
  type ReferralGate,
} from "@/lib/referrals";
import { referralCurrency, CURRENCY_CONFIG, formatMoney, type Currency } from "@/lib/referral-currency";

// Referrals v2 — READ-ONLY leaderboard. Reuses lib/referrals + lib/referral-currency unchanged
// so the owed/earned numbers match /admin/referrals. Adds a funnel bar, a signup momentum/trend
// signal, a quality-risk filter (correct account-level restriction count), teams + search/sort.
// No payouts are written here; use /admin/referrals to record a payment (phase 2 brings it here).

const F = "system-ui,-apple-system,sans-serif";

// Referrers whose restriction rate should NOT be flagged as quality-risk (known family buckets
// where relatives share a surname, not fraud). Edit this list as needed. Slugs, lowercased.
const FAMILY_EXCLUDE = new Set<string>(["omblero", "virrey"]);

type Referrer = { id: string; slug: string; name: string; type: string; email: string | null; paymentMethod: string | null; paymentDetails: string | null; paymentName: string | null; createdAt: string };
type App = {
  id: string; fullName: string; referredBy: string | null; status: string; createdAt: string;
  verifiedAt: string | null; accountIssue: string | null; onboardedAt: string | null; paidAt: string | null;
  monthlyPayouts: unknown; referralSource: string | null; onboardingMethod: string | null; onboardingVerified: boolean | null;
  referralHoldReason: string | null; accountFreshness: string | null;
  accountRestrictedAt: string | null; accountPermanentlyRestricted: boolean; accountStatus: string | null;
};
type Payout = { id: string; referrerId: string; type: string; ambassadorApplicationId: string | null; amount: number; paidAt: string | null };

const DAY = 86400000;
const money = (cur: Currency, n: number) => formatMoney(n, cur);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "—");
const norm = (s?: string | null) => (s || "").trim().toLowerCase();
const teamOf = (t: string) => (t === "ortus" ? "Ortus" : t === "apex" ? "Apex" : "Standard");
const isRestricted = (a: App) => !!a.accountRestrictedAt || a.accountPermanentlyRestricted || norm(a.accountIssue).includes("restricted");

// The three onboarding paths + the amount that path earns, mirroring referralCommissionAmount.
function pathInfo(a: App, tiers: typeof CURRENCY_CONFIG["PHP"]["referralTiers"]) {
  if (a.referralSource !== "self-service" || a.onboardingMethod === "team_meeting") return { label: "Refer · LV onboards", amt: tiers.referral };
  const band = a.onboardingMethod === "phone" ? tiers.phone : tiers.computer;
  const where = a.onboardingMethod === "phone" ? "phone" : "PC";
  return { label: `You ran it · ${where}${a.onboardingVerified ? " · verified" : ""}`, amt: a.onboardingVerified ? band.verified : band.base };
}

// 8 weekly signup buckets, oldest -> this week; plus days since the most recent signup.
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
// Momentum: compare last 14d vs prior 14d.
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
// Tiny sparkline path for the weekly buckets.
function spark(w: number[], width: number, height: number) {
  const max = Math.max(1, ...w);
  const step = width / (w.length - 1);
  return w.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`).join(" ");
}

type Row = {
  id: string; slug: string; name: string; team: string; cur: Currency; sym: string;
  sign: number; onb: number; res: number; ver: number; earned: number; ready: number; held: number; paid: number; owed: number;
  w: number[]; lastDays: number; trend: ReturnType<typeof trendOf>; apps: App[]; fam: boolean;
};

export default function ReferralsV2Page() {
  const [refs, setRefs] = useState<Referrer[] | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [pays, setPays] = useState<Payout[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [team, setTeam] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("onb");
  const [sel, setSel] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/referrers", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/admin/ambassadors", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/admin/payouts", { cache: "no-store" }).then(r => r.json()),
    ]).then(([r, a, p]) => {
      if (r.error || a.error || p.error) { setError(r.error || a.error || p.error); return; }
      setRefs(r.referrers || []); setApps(a.applications || []); setPays(p.payouts || []);
    }).catch(e => setError(e.message));
  }, []);

  const now = Date.now();

  const rows: Row[] = useMemo(() => {
    if (!refs) return [];
    // Referred apps grouped by the referrer slug stored in referredBy.
    const byRef = new Map<string, App[]>();
    for (const a of apps) { const k = norm(a.referredBy); if (!k) continue; (byRef.get(k) || byRef.set(k, []).get(k)!).push(a); }
    const refBySlug = new Map(refs.map(r => [norm(r.slug), r]));
    const refByName = new Map(refs.map(r => [norm(r.name), r]));
    // Paid commission per referrer, and the set of apps with a paid, app-tied commission.
    const paidByRef = new Map<string, number>();
    const paidApp = new Set<string>();
    for (const p of pays) {
      if (p.type !== "commission" || !p.paidAt) continue;
      paidByRef.set(p.referrerId, (paidByRef.get(p.referrerId) || 0) + Number(p.amount || 0));
      if (p.ambassadorApplicationId) paidApp.add(p.ambassadorApplicationId);
    }

    const out: Row[] = [];
    for (const [key, group] of byRef) {
      const r = refBySlug.get(key) || refByName.get(key);
      if (!r) continue; // referredBy that matches no referrer row (rare legacy) is skipped
      const cur = referralCurrency(r.slug);
      const cfg = CURRENCY_CONFIG[cur];
      const tiers = cfg.referralTiers;
      let onb = 0, res = 0, ver = 0, earned = 0, ready = 0;
      for (const a of group) {
        const gate = a as unknown as ReferralGate;
        const on = isReferralOnboarded(gate);
        if (on) onb++;
        const restricted = isRestricted(a);
        if (on && restricted) res++;
        const isEarned = isReferralEarned(gate);
        if (on && !isEarned) ver++;
        if (isEarned) {
          const c = referralCommissionAmount(gate, tiers);
          earned += c;
          if (isReferralReadyToPay(gate)) ready += c;
        }
      }
      const held = Math.max(0, earned - ready);
      const paid = paidByRef.get(r.id) || 0;
      const owed = Math.max(0, ready - paid);
      const { w, lastDays } = weekly(group, now);
      out.push({
        id: r.id, slug: r.slug, name: r.name, team: teamOf(r.type), cur, sym: cfg.symbol,
        sign: group.length, onb, res, ver, earned, ready, held, paid, owed,
        w, lastDays, trend: trendOf(w, lastDays), apps: group, fam: FAMILY_EXCLUDE.has(norm(r.slug)),
      });
    }
    return out;
  }, [refs, apps, pays, now]);

  const inactive = (r: Row) => r.lastDays > 30 && r.owed === 0 && r.held === 0;
  const isRisk = (r: Row) => !r.fam && r.onb >= 3 && r.res / r.onb >= 0.15;
  const top5 = useMemo(() => [...rows].sort((a, b) => b.onb - a.onb).slice(0, 5).map(r => r.id), [rows]);

  const FILTERS: Record<string, (r: Row) => boolean> = {
    all: () => true,
    top: r => top5.includes(r.id),
    owed: r => r.owed > 0 || r.held > 0,
    risk: isRisk,
    slow: r => !inactive(r) && r.trend.k === "down",
    ver: r => r.ver > 0,
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

  // Summary across PHP referrers (money) + all (counts).
  const php = rows.filter(r => r.cur === "PHP");
  const sum = (k: keyof Row, l: Row[] = rows) => l.reduce((a, r) => a + (r[k] as number), 0);
  const tiles = [
    { label: "Active referrers", n: String(rows.filter(r => r.lastDays <= 30 && r.sign > 0).length), sub: "signup in last 30 days", fg: "var(--fg,#111)" },
    { label: "Signups", n: String(sum("sign")), sub: sum("ver") + " verifying", fg: "var(--fg,#111)" },
    { label: "Onboarded", n: String(sum("onb")), sub: pct(sum("onb"), sum("sign")) + " of signups", fg: "#0f7a3d" },
    { label: "Restricted", n: String(sum("res")), sub: pct(sum("res"), sum("onb")) + " of onboarded", fg: "#b91c1c" },
    { label: "Owed", n: money("PHP", sum("owed", php) + sum("held", php)), sub: money("PHP", sum("owed", php)) + " ready · " + money("PHP", sum("held", php)) + " hold", fg: "#b45309" },
    { label: "Paid to date", n: money("PHP", sum("paid", php)), sub: "commission paid", fg: "#0f7a3d" },
  ];

  const filterDefs: Array<[string, string, string, string]> = [
    ["all", "All", "#64748b", "Everyone"],
    ["top", "Top 5", "#16a34a", "Most onboarded"],
    ["owed", "Owed money", "#d97706", "Ready or in hold"],
    ["risk", "Quality risk", "#dc2626", "≥15% of onboarded restricted · min 3 · family buckets excluded · a signal, not proof"],
    ["slow", "Slowing down", "#f59e0b", "Was active, signups dropped to half or less of the prior 2 weeks"],
    ["ver", "Verifying", "#60a5fa", "Has onboarded signups awaiting QC"],
  ];

  const btn: React.CSSProperties = { border: "1px solid var(--line,#d6e4fb)", borderRadius: 9, padding: "6px 11px", background: "var(--card,#fff)", color: "var(--fg,#111)", cursor: "pointer", font: `600 12.5px ${F}` };
  const card: React.CSSProperties = { background: "var(--card,#fff)", border: "1px solid var(--card-border,#e7ebf0)", borderRadius: 12 };
  const sel_ = sel ? rows.find(r => r.id === sel) || null : null;

  return (
    <div style={{ padding: "20px 22px 80px", font: `400 13px ${F}`, color: "var(--fg,#111)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h1 style={{ font: `800 24px ${F}`, margin: "0 0 3px" }}>Referrals <span style={{ font: `700 11px ${F}`, color: "var(--muted,#8a97ad)", verticalAlign: "middle" }}>v2 · read-only</span></h1>
          <p style={{ color: "var(--muted,#647189)", margin: 0, maxWidth: 680 }}>Who brings in ambassadors, how many onboard, how many get restricted, who is slowing down, and what we owe. To record a payment, use <a href="/admin/referrals" style={{ color: "var(--link,#0a66c2)" }}>Referrals</a>.</p>
        </div>
      </div>

      {error && <p style={{ color: "#c0392b" }}>{error}</p>}
      {!refs && !error && <p style={{ color: "var(--muted,#647189)" }}>Loading…</p>}

      {refs && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
          {tiles.map(t => (
            <div key={t.label} style={{ ...card, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ font: `700 10.5px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted,#5b6779)" }}>{t.label}</span>
              <span style={{ font: `800 23px ${F}`, color: t.fg }}>{t.n}</span>
              <span style={{ font: `600 11.5px ${F}`, color: "var(--muted,#8a93a3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.sub}</span>
            </div>
          ))}
        </div>

        <div style={{ ...card, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            {filterDefs.map(([k, label, dot, tip]) => {
              const on = filter === k;
              const n = base.filter(FILTERS[k]).filter(r => k !== "all" || !inactive(r)).length;
              return <button key={k} title={tip} onClick={() => setFilter(k)} style={{ ...btn, display: "flex", alignItems: "center", gap: 7, borderRadius: 999, borderWidth: 1.5, borderColor: on ? dot : "var(--line,#d6e4fb)", background: on ? "var(--chip-on,#eef4ff)" : "var(--card,#fff)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot }} />{label}
                <span style={{ font: `700 11px ${F}`, color: "var(--muted,#5b6779)", background: "var(--chip,#eef0f4)", borderRadius: 999, padding: "1px 7px" }}>{n}</span>
              </button>;
            })}
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", background: "var(--chip,#eef0f4)", borderRadius: 9, padding: 3, gap: 2 }}>
              {["all", "Standard", "Ortus", "Apex"].map(t => (
                <button key={t} onClick={() => setTeam(t)} style={{ border: "none", background: team === t ? "var(--card,#fff)" : "transparent", color: "var(--fg,#111)", borderRadius: 7, padding: "5px 11px", font: `700 12px ${F}`, cursor: "pointer" }}>{t === "all" ? "All teams" : t}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--card-border,#f0f2f5)", paddingTop: 10 }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search referrer, ref code or ambassador name…" style={{ flex: 1, minWidth: 220, border: "1px solid var(--line,#dde1e8)", background: "var(--card,#f8f9fb)", color: "var(--fg,#111)", borderRadius: 9, padding: "9px 12px", font: `500 13px ${F}`, outline: "none" }} />
            <select value={sort} onChange={e => setSort(e.target.value)} style={{ ...btn, padding: "9px 10px" }}>
              <option value="onb">Most onboarded</option><option value="sign">Most signups</option><option value="rate">Best conversion</option><option value="restr">Highest restriction rate</option><option value="owed">Most owed</option><option value="recent">Latest signup</option>
            </select>
          </div>
        </div>

        <div style={{ ...card, overflowX: "auto" }}>
          <div style={{ minWidth: 1040 }}>
            <div style={{ display: "grid", gridTemplateColumns: "32px minmax(200px,1.6fr) 150px 70px 96px 100px 96px 130px 90px", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--card-border,#eef0f4)", font: `700 10px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted,#8a93a3)" }}>
              <span>#</span><span>Referrer</span><span>Funnel</span><span>Signups</span><span>Onboarded</span><span>Restricted</span><span>Paid</span><span>Owed</span><span>Trend</span>
            </div>
            {visible.map((r, i) => {
              const total = r.onb + r.res + r.ver || 1;
              return <div key={r.id} onClick={() => { setSel(r.id); setCopied(false); }} style={{ display: "grid", gridTemplateColumns: "32px minmax(200px,1.6fr) 150px 70px 96px 100px 96px 130px 90px", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: "1px solid var(--card-border,#eef0f4)", cursor: "pointer" }}>
                <span style={{ font: `700 13px ${F}`, color: "var(--muted,#8a93a3)" }}>{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ font: `700 13.5px ${F}` }}>{r.name}</span>
                    {r.team !== "Standard" && <span style={{ font: `700 10px ${F}`, padding: "1px 7px", borderRadius: 999, background: "var(--chip,#eef0f4)", color: "var(--muted,#5b6779)" }}>{r.team}</span>}
                    {r.fam && <span style={{ font: `700 10px ${F}`, padding: "1px 7px", borderRadius: 999, background: "var(--chip,#eef0f4)", color: "var(--muted,#5b6779)" }}>family</span>}
                    {isRisk(r) && <span style={{ font: `700 10px ${F}`, padding: "1px 7px", borderRadius: 999, background: "#fde8e8", color: "#b91c1c" }}>quality risk</span>}
                  </div>
                  <span style={{ font: `500 11.5px ${F}`, color: "var(--muted,#8a93a3)" }}>ref {r.slug}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <div style={{ display: "flex", height: 7, borderRadius: 999, background: "var(--chip,#eef0f4)", overflow: "hidden" }}>
                    <div style={{ width: `${((r.onb - r.res) / total) * 100}%`, background: "#16a34a" }} />
                    <div style={{ width: `${(r.res / total) * 100}%`, background: "#dc2626" }} />
                    <div style={{ width: `${(r.ver / total) * 100}%`, background: "#60a5fa" }} />
                  </div>
                  <span style={{ font: `500 10.5px ${F}`, color: "var(--muted,#8a93a3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.onb - r.res} ok · {r.res} restr · {r.ver} verifying</span>
                </div>
                <span style={{ font: `700 14px ${F}` }}>{r.sign}</span>
                <div><div style={{ font: `700 14px ${F}`, color: "#0f7a3d" }}>{r.onb}</div><div style={{ font: `500 11px ${F}`, color: "var(--muted,#8a93a3)" }}>{pct(r.onb, r.sign)}</div></div>
                <div><div style={{ font: `700 14px ${F}`, color: r.res ? "#b91c1c" : "var(--fg,#111)" }}>{r.res}</div><div style={{ font: `500 11px ${F}`, color: isRisk(r) ? "#b91c1c" : "var(--muted,#8a93a3)" }}>{pct(r.res, r.onb)}</div></div>
                <span style={{ font: `700 13px ${F}` }}>{money(r.cur, r.paid)}</span>
                <div><div style={{ font: `700 13px ${F}`, color: r.owed ? "#b45309" : "var(--muted,#8a93a3)" }}>{money(r.cur, r.owed)}</div><div style={{ font: `500 11px ${F}`, color: "var(--muted,#8a93a3)" }}>{r.held ? money(r.cur, r.held) + " hold" : "—"}</div></div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width={46} height={16} viewBox="0 0 46 16" preserveAspectRatio="none"><polyline points={spark(r.w, 46, 16)} fill="none" stroke={r.trend.fg} strokeWidth={1.5} /></svg>
                  <span style={{ font: `700 10.5px ${F}`, color: r.trend.fg, whiteSpace: "nowrap" }}>{r.trend.lbl}</span>
                </div>
              </div>;
            })}
            {!showInactive && inact.length > 0 && <button onClick={() => setShowInactive(true)} style={{ width: "100%", border: "none", background: "var(--card,#f8f9fb)", padding: "11px 16px", textAlign: "left", font: `700 12px ${F}`, color: "var(--muted,#5b6779)", cursor: "pointer" }}>Show {inact.length} inactive (30d+ idle, nothing owed) →</button>}
            {showInactive && inact.length > 0 && <button onClick={() => setShowInactive(false)} style={{ width: "100%", border: "none", background: "var(--card,#f8f9fb)", padding: "11px 16px", textAlign: "left", font: `700 12px ${F}`, color: "var(--muted,#5b6779)", cursor: "pointer" }}>Hide inactive</button>}
            {!visible.length && <div style={{ padding: 40, textAlign: "center", color: "var(--muted,#8a93a3)" }}>No referrers match.</div>}
          </div>
        </div>
      </>}

      {sel_ && <Drawer r={sel_} pays={pays} copied={copied} setCopied={setCopied} onClose={() => setSel(null)} />}
    </div>
  );
}

function Drawer({ r, pays, copied, setCopied, onClose }: { r: Row; pays: Payout[]; copied: boolean; setCopied: (v: boolean) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const paidApp = new Set(pays.filter(p => p.type === "commission" && p.paidAt && p.ambassadorApplicationId).map(p => p.ambassadorApplicationId!));
  const tiers = CURRENCY_CONFIG[r.cur].referralTiers;
  const link = `https://linkedvelocity.com/r/${r.slug}`;
  const best = r.w.reduce((b, v, i) => (v > r.w[b] ? i : b), 0);
  const stats = [
    { l: "Signups", v: String(r.sign), fg: "var(--fg,#111)" },
    { l: "Onboarded", v: `${r.onb}`, fg: "#0f7a3d", sub: pct(r.onb, r.sign) },
    { l: "Restricted", v: `${r.res}`, fg: r.res ? "#b91c1c" : "var(--fg,#111)", sub: pct(r.res, r.onb) },
    { l: "Verifying", v: String(r.ver), fg: "#2563eb" },
    { l: "Earned", v: money(r.cur, r.earned), fg: "var(--fg,#111)" },
    { l: "Ready", v: money(r.cur, r.owed), fg: "#0f7a3d" },
    { l: "In hold", v: money(r.cur, r.held), fg: "#b45309" },
    { l: "Paid", v: money(r.cur, r.paid), fg: "#0f7a3d" },
  ];
  const ams = [...r.apps].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(a => {
    const gate = a as unknown as ReferralGate;
    const on = isReferralOnboarded(gate), earned = isReferralEarned(gate), restr = isRestricted(a);
    const p = pathInfo(a, tiers);
    let st = "Not onboarded", stBg = "var(--chip,#eef0f4)", stFg = "var(--muted,#5b6779)";
    if (restr) { st = "Restricted"; stBg = "#fde8e8"; stFg = "#b91c1c"; }
    else if (earned) { st = "Onboarded"; stBg = "#e7f6ee"; stFg = "#0f7a3d"; }
    else if (on) { st = "Verifying"; stBg = "#e8f0fe"; stFg = "#2563eb"; }
    const pay = paidApp.has(a.id) ? "Paid" : earned ? (isReferralReadyToPay(gate) ? "Ready" : "In hold") : "";
    return { id: a.id, name: a.fullName, when: new Date(a.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }), st, stBg, stFg, path: on ? p.label : "—", amt: earned ? money(r.cur, p.amt) : "", pay, payFg: pay === "Paid" ? "#0f7a3d" : pay === "Ready" ? "#0f7a3d" : "#b45309" };
  });

  return <>
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,.3)", zIndex: 40 }} />
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(560px,100vw)", background: "var(--card,#fff)", color: "var(--fg,#111)", zIndex: 41, display: "flex", flexDirection: "column", boxShadow: "-12px 0 40px rgba(11,18,32,.14)" }}>
      <div style={{ padding: "16px 18px 13px", borderBottom: "1px solid var(--card-border,#eef0f4)", display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ font: `800 18px ${F}` }}>{r.name}</span>
            {r.team !== "Standard" && <span style={{ font: `700 10px ${F}`, padding: "1px 7px", borderRadius: 999, background: "var(--chip,#eef0f4)", color: "var(--muted,#5b6779)" }}>{r.team}</span>}
            <span style={{ font: `700 10.5px ${F}`, color: r.trend.fg }}>{r.trend.lbl}</span>
          </div>
          <div style={{ font: `500 12px ${F}`, color: "var(--muted,#5b6779)", marginTop: 2 }}>ref {r.slug} · {r.cur}</div>
        </div>
        <button onClick={onClose} style={{ border: "none", background: "var(--chip,#eef0f4)", width: 30, height: 30, borderRadius: 8, font: `700 14px ${F}`, color: "var(--muted,#5b6779)", cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "15px 18px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
          {stats.map(s => (
            <div key={s.l} style={{ background: "var(--card2,#f8f9fb)", border: "1px solid var(--card-border,#eef0f4)", borderRadius: 10, padding: "8px 9px", display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ font: `700 9.5px ${F}`, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted,#8a93a3)" }}>{s.l}</span>
              <span style={{ font: `800 16px ${F}`, color: s.fg }}>{s.v}</span>
              {s.sub && <span style={{ font: `500 10px ${F}`, color: "var(--muted,#8a93a3)" }}>{s.sub}</span>}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ font: `700 10.5px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted,#8a93a3)" }}>Momentum · last 8 weeks</span>
          <div style={{ border: "1px solid var(--card-border,#eef0f4)", borderRadius: 11, padding: "10px 12px", display: "flex", alignItems: "center", gap: 14 }}>
            <svg width={200} height={46} viewBox="0 0 200 46" preserveAspectRatio="none" style={{ flex: "none" }}><polyline points={spark(r.w, 200, 46)} fill="none" stroke={r.trend.fg} strokeWidth={2} /></svg>
            <div style={{ font: `500 12px ${F}`, color: "var(--muted,#5b6779)" }}>
              <div>Last 14d: <b style={{ color: "var(--fg,#111)" }}>{r.trend.rec}</b> · prior 14d: <b style={{ color: "var(--fg,#111)" }}>{r.trend.pri}</b></div>
              <div>Best week: <b style={{ color: "var(--fg,#111)" }}>{r.w[best]}</b> · this week: <b style={{ color: "var(--fg,#111)" }}>{r.w[7]}</b></div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ font: `700 10.5px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted,#8a93a3)" }}>Portal</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--line,#dde1e8)", background: "var(--card2,#f8f9fb)", borderRadius: 10, padding: "8px 10px" }}>
            <span style={{ flex: 1, minWidth: 0, font: `500 12px ${F}`, color: "var(--muted,#334155)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{link}</span>
            <button onClick={() => { navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }} style={{ flex: "none", border: "none", background: "var(--fg,#0b1220)", color: "var(--card,#fff)", borderRadius: 7, padding: "5px 10px", font: `700 11.5px ${F}`, cursor: "pointer" }}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ font: `700 10.5px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted,#8a93a3)" }}>Referred ambassadors · {ams.length}</span>
          <div style={{ border: "1px solid var(--card-border,#e3e6ec)", borderRadius: 11, overflow: "hidden" }}>
            {ams.map(a => (
              <div key={a.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) 100px 120px 56px 64px", gap: 9, alignItems: "center", padding: "8px 11px", borderBottom: "1px solid var(--card-border,#f0f2f5)" }}>
                <div style={{ minWidth: 0 }}><div style={{ font: `600 12.5px ${F}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div><div style={{ font: `500 10.5px ${F}`, color: "var(--muted,#8a93a3)" }}>{a.when}</div></div>
                <span><span style={{ font: `700 10px ${F}`, padding: "2px 7px", borderRadius: 999, background: a.stBg, color: a.stFg, whiteSpace: "nowrap" }}>{a.st}</span></span>
                <span style={{ font: `500 11px ${F}`, color: "var(--muted,#5b6779)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.path}</span>
                <span style={{ font: `700 12px ${F}` }}>{a.amt}</span>
                <span style={{ font: `700 11px ${F}`, color: a.payFg, textAlign: "right" }}>{a.pay}</span>
              </div>
            ))}
            {!ams.length && <div style={{ padding: 18, textAlign: "center", color: "var(--muted,#8a93a3)", font: `500 12px ${F}` }}>No referred ambassadors yet.</div>}
          </div>
        </div>
      </div>
    </div>
  </>;
}
