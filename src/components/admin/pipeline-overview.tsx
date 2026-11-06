"use client";

// Pipeline → Overview. A read-only dashboard rendered as the "Overview" view of
// /admin/pipeline, computed CLIENT-SIDE from the exact same Row[] the Queue uses, so
// every number stays in lock-step with the live pipeline (same level/turn/type logic
// from pipeline-model — no separate server aggregation to drift out of sync).
//
// Timestamp notes (what we actually store):
//  • "Applied" = Row.createdAt.
//  • "Onboarded" population = levelOf(r)===5. The closest stage-5 timestamp we keep is
//    onboardedAt (stamped at sign-in/approval), so onboarded-in-range and time-to-onboard
//    use it; it slightly predates the final onboarded mark but is consistent across rows.
//  • Referrer origin (existing/former/outside) is the referrer's status NOW, used as a
//    proxy for "at time of referral" — we don't store per-referral history.
//  • Handler "response" = median gap from an applicant reply to the next outbound touch
//    in that row's outreach log (a proxy for time-to-respond; we have no turn history).
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  type Row, levelOf, effectiveTypeKey, turnOf, setupPaid, idleDays, lastActivityAt,
  F_SANS, F_GRO,
} from "@/lib/pipeline-model";
import { isApplicationReceived } from "@/lib/pipeline-received";
import { isLikelyTestEmail } from "@/lib/test-mode";

const DAY = 86400000;
const INK = "#0b1220", MUT = "#5b6779", FAINT = "#8a93a3", ACC = "#2563eb", LINE = "#e3e6ec", BAND = "#fafbfc";
const GOOD = { fg: "#0f7a3d", bg: "#e7f7ee" }, BAD = { fg: "#b91c1c", bg: "#fef2f2" }, NEU = { fg: MUT, bg: "#f1f3f6" };
const card = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14 } as const;

type Range = "7" | "30" | "90" | "all";
const K: Record<Range, number> = { "7": 1, "30": 4, "90": 13, all: 26 };

const parse = (s: string | null | undefined) => (s ? +new Date(s) : null);
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const startOfWeek = (d: Date) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x; };
const fmtD = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "—");
const peso = (n: number) => "₱" + Math.round(n).toLocaleString("en-US");
const dead = (r: Row) => r.status === "rejected" || r.status === "unreachable" || r.accountStatus === "removed" || r.accountStatus === "retired";

// Delta pill. goodUp=true → a rise is good (green). days=true → format as "+Nd" and lower is better.
function delta(cur: number, prev: number | null, goodUp: boolean, days = false) {
  if (prev == null) return { d: "—", fg: NEU.fg, bg: NEU.bg };
  if (cur === prev) return { d: days ? "±0d" : "0%", fg: NEU.fg, bg: NEU.bg };
  const s = (cur > prev) === goodUp ? GOOD : BAD;
  const t = days ? (cur - prev > 0 ? "+" : "") + (cur - prev).toFixed(1) + "d"
    : prev ? (cur > prev ? "+" : "") + Math.round(((cur - prev) / prev) * 100) + "%" : "new";
  return { d: t, fg: s.fg, bg: s.bg };
}

// Furthest stage a row reached, from milestone stamps (ignores later regression to Stopped).
const reach = (r: Row): number => {
  let m = 0.5;
  if (isApplicationReceived(r)) m = 1;
  if (r.emailPrimaryAt) m = Math.max(m, 2);
  if (r.onboardedAt || r.status === "approved" || r.status === "onboarded") m = Math.max(m, 3);
  if (r.verifiedAt || r.status === "onboarded") m = Math.max(m, 4);
  if (levelOf(r) === 5) m = 5;
  return m;
};
const referred = (r: Row) => !!r.referredBy && r.referredBy.toLowerCase() !== "diy";
const onbUniverse = (r: Row) => levelOf(r) === 5;
const onbAt = (r: Row) => parse(r.onboardedAt) ?? parse(r.verifiedAt) ?? parse(r.paidAt);

const HANDLER_COLOR: Record<string, string> = { milee: "#7c3aed", ardi: "#2563eb", giana: "#db2777", sam: "#059669", ton: "#d97706" };
const PALETTE = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626"];
const handlerColor = (name: string) => {
  const k = (name || "").trim().toLowerCase().split(/\s+/)[0];
  if (HANDLER_COLOR[k]) return HANDLER_COLOR[k];
  let h = 0; for (const c of k) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const initials = (n: string) => { const p = (n || "?").trim().split(/\s+/); return (p.length > 1 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase() || "?"; };
const dur = (ms: number) => (ms >= DAY ? (ms / DAY).toFixed(1) + "d" : Math.round(ms / 3600000) + "h");

export default function PipelineOverview({ rows }: { rows: Row[] }) {
  const [range, setRange] = useState<Range>("7");
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);
  useEffect(() => { const on = () => setW(window.innerWidth); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
  const narrow = w < 960;

  // Referrer origin (existing/former/outside) matched server-side at request time — see
  // /api/admin/referrer-origins. Null until it loads; the memo falls back to the in-rows
  // asReferrer heuristic meanwhile so the section is never blank.
  const [originMap, setOriginMap] = useState<Record<string, "existing" | "former" | "outside"> | null>(null);
  useEffect(() => {
    let off = false;
    fetch("/api/admin/referrer-origins", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!off && d?.origins) setOriginMap(d.origins); })
      .catch(() => {});
    return () => { off = true; };
  }, []);

  const v = useMemo(() => {
    const k = K[range];
    const curWeekStart = startOfWeek(new Date());
    const rangeStart = new Date(curWeekStart); rangeStart.setDate(rangeStart.getDate() - (k - 1) * 7);
    const sMs = +rangeStart, eMs = Date.now() + 1;
    const hasPrev = range !== "all";
    const pStart = sMs - k * 7 * DAY, pEnd = sMs;
    const inCur = (t: number | null) => t != null && t >= sMs && t < eMs;
    const inPrev = (t: number | null) => hasPrev && t != null && t >= pStart && t < pEnd;

    const U = rows.filter(r => !r.accountOnly && !isLikelyTestEmail(r.email));
    const curApps = U.filter(r => inCur(parse(r.createdAt)));
    const prevApps = U.filter(r => inPrev(parse(r.createdAt)));
    const curOnb = U.filter(r => onbUniverse(r) && inCur(onbAt(r)));
    const prevOnb = U.filter(r => onbUniverse(r) && inPrev(onbAt(r)));
    const refsCur = curApps.filter(referred), refsPrev = prevApps.filter(referred);
    const daysToOnb = (r: Row) => { const a = parse(r.createdAt), o = onbAt(r); return a && o ? (o - a) / DAY : null; };
    const medOnb = median(curOnb.map(daysToOnb).filter((x): x is number => x != null));
    const medOnbPrev = median(prevOnb.map(daysToOnb).filter((x): x is number => x != null));

    // ── restrictions ────────────────────────────────────────────────────────
    type RE = { rAt: number; recAt: number | null; r: Row };
    const events: RE[] = [];
    for (const r of U) {
      const log = r.accountRestrictionLog || [];
      if (log.length) {
        let pend: number | null = null;
        for (const e of log) {
          const t = +new Date(e.at);
          if (e.event === "restricted") { if (pend != null) events.push({ rAt: pend, recAt: null, r }); pend = t; }
          else if (e.event === "recovered" && pend != null) { events.push({ rAt: pend, recAt: t, r }); pend = null; }
        }
        if (pend != null) events.push({ rAt: pend, recAt: null, r });
      } else if (r.accountRestrictedAt) events.push({ rAt: +new Date(r.accountRestrictedAt), recAt: null, r });
    }
    const curRE = events.filter(e => inCur(e.rAt)), prevRE = events.filter(e => inPrev(e.rAt));
    const rec = curRE.filter(e => e.recAt != null);
    const medRec = median(rec.map(e => (e.recAt! - e.rAt) / DAY));
    const medRecPrev = median(prevRE.filter(e => e.recAt != null).map(e => (e.recAt! - e.rAt) / DAY));
    const lost = curRE.filter(e => e.recAt == null && dead(e.r)).length;

    // ── KPIs ────────────────────────────────────────────────────────────────
    const unpaid = U.filter(r => onbUniverse(r) && !setupPaid(r));
    const unpaidPrev = prevOnb.filter(r => !setupPaid(r)).length;
    const kpis = [
      { label: "Applications", v: String(curApps.length), sub: "New ambassador signups", ...delta(curApps.length, hasPrev ? prevApps.length : null, true) },
      { label: "Referred", v: String(refsCur.length), sub: `${pct(refsCur.length, curApps.length)} of applications came via a referrer`, ...delta(refsCur.length, hasPrev ? refsPrev.length : null, true) },
      { label: "Onboarded", v: String(curOnb.length), sub: "Reached stage 5 in the range", ...delta(curOnb.length, hasPrev ? prevOnb.length : null, true) },
      { label: "Days to onboard", v: medOnb != null ? medOnb.toFixed(1) : "—", sub: "Median, signup → onboarded", ...delta(medOnb ?? 0, hasPrev ? medOnbPrev : null, false, true) },
      { label: "Restricted", v: String(curRE.length), sub: `${rec.length} recovered · ${medRec != null ? medRec.toFixed(1) + "d median to recover" : "none recovered yet"}`, ...delta(curRE.length, hasPrev ? prevRE.length : null, false) },
      { label: "Setup fees owed", v: peso(unpaid.length * 1000), sub: `${unpaid.length} onboarded, not yet paid`, ...delta(unpaid.length, hasPrev ? unpaidPrev : null, false) },
    ];

    // ── weekly table ─────────────────────────────────────────────────────────
    const nWeeks = k >= 13 ? 13 : 8;
    const weekAgg = (a: number, b: number) => {
      const apps = U.filter(r => { const t = parse(r.createdAt); return t != null && t >= a && t < b; });
      const onb = U.filter(r => onbUniverse(r) && (() => { const t = onbAt(r); return t != null && t >= a && t < b; })());
      const stopped = U.filter(r => dead(r) && (() => { const t = parse(lastActivityAt(r)); return t != null && t >= a && t < b; })());
      return { apps: apps.length, refs: apps.filter(referred).length, onb: onb.length, stopped: stopped.length };
    };
    const weeks = Array.from({ length: nWeeks }, (_, i) => {
      const ws = new Date(curWeekStart); ws.setDate(ws.getDate() - i * 7);
      const we = new Date(ws); we.setDate(we.getDate() + 7);
      const g = weekAgg(+ws, +we), prev = weekAgg(+ws - 7 * DAY, +ws);
      const inR = i < k;
      return {
        label: `${fmtD(+ws)} – ${fmtD(+we - DAY)}`, now: i === 0, inR,
        ...g, refPct: pct(g.refs, g.apps),
        ...(i === 0 ? { d: "partial", dFg: NEU.fg, dBg: NEU.bg } : (() => { const dd = delta(g.apps, prev.apps, true); return { d: dd.d, dFg: dd.fg, dBg: dd.bg }; })()),
      };
    });
    const tot = { apps: curApps.length, refs: refsCur.length, refPct: pct(refsCur.length, curApps.length), onb: curOnb.length, stopped: U.filter(r => dead(r) && inCur(parse(lastActivityAt(r)))).length };

    // ── funnel ────────────────────────────────────────────────────────────────
    const stages: { key: number; name: string }[] = [
      { key: 0.5, name: "0.5 · Setup" }, { key: 1, name: "1 · Received" }, { key: 2, name: "2 · Email & 2FA" },
      { key: 3, name: "3 · Logged in / QC" }, { key: 4, name: "4 · Maturing" }, { key: 5, name: "5 · Onboarded" },
    ];
    const reached = stages.map(s => curApps.filter(r => reach(r) >= s.key).length);
    const base = reached[0] || curApps.length || 1;
    // median days spent in each stage, from the stamps we have
    const stageDur = (from: (r: Row) => number | null, to: (r: Row) => number | null) =>
      median(curApps.map(r => { const a = from(r), b = to(r); return a != null && b != null && b >= a ? (b - a) / DAY : null; }).filter((x): x is number => x != null));
    const stageDays = [
      null,
      stageDur(r => parse(r.createdAt), r => parse(r.emailPrimaryAt)),
      stageDur(r => parse(r.emailPrimaryAt), r => parse(r.onboardedAt)),
      stageDur(r => parse(r.onboardedAt), r => parse(r.verifiedAt)),
      7, null,
    ];
    const liveLevel = (lvl: number) => rows.filter(r => !r.accountOnly && !dead(r) && levelOf(r) === lvl && levelOf(r) !== 5);
    let worst = 1; const convs = reached.map((n, i) => (i ? n / (reached[i - 1] || 1) : 1));
    convs.forEach((c, i) => { if (i && c < convs[worst]) worst = i; });
    const funnel = stages.map((s, i) => {
      const now = i === 0 || i === 5 ? [] : liveLevel(s.key);
      const stall = now.filter(r => idleDays(r) >= 7 && turnOf(r).turn === "us").length;
      const stoppedHere = curApps.filter(r => dead(r) && reach(r) === s.key).length;
      return {
        name: s.name, reached: reached[i], w: ((reached[i] / base) * 100).toFixed(0) + "%",
        dot: i === 5 ? "#12a150" : ACC, conv: i ? Math.round(convs[i] * 100) + "%" : "—", worst: i === worst && i > 0,
        days: stageDays[i] == null ? "—" : (stageDays[i] as number).toFixed(1), now: i === 0 || i === 5 ? "—" : String(now.length),
        stall: i === 0 || i === 5 ? "—" : String(stall), stallAmber: stall >= 2, stopped: i === 5 ? "—" : String(stoppedHere),
      };
    });

    // ── application type & source ─────────────────────────────────────────────
    const groupBuckets = (keyer: (r: Row) => string, order: string[], colors: string[]) => {
      const map = new Map<string, Row[]>();
      for (const r of curApps) { const key = keyer(r); if (!map.has(key)) map.set(key, []); map.get(key)!.push(r); }
      const keys = order.filter(k => map.has(k)).concat([...map.keys()].filter(k => !order.includes(k)));
      return keys.map((key, i) => {
        const g = map.get(key)!; const onb = g.filter(r => reach(r) === 5);
        const md = median(onb.map(daysToOnb).filter((x): x is number => x != null));
        return { name: key, n: g.length, share: pct(g.length, curApps.length), w: pct(g.length, curApps.length), c: colors[i % colors.length], onb: onb.length, conv: pct(onb.length, g.length), days: md != null ? md.toFixed(1) : "—" };
      });
    };
    const TYPE_LABEL: Record<string, string> = { full: "Full", partial: "Email only", standard: "Form only", unknown: "Not recorded" };
    const types = groupBuckets(r => TYPE_LABEL[effectiveTypeKey(r)] || "Not recorded", ["Full", "Email only", "Form only", "Not recorded"], ["#2563eb", "#60a5fa", "#bfdbfe", "#e2e8f0"]);
    const sourceOf = (r: Row) => {
      if (referred(r)) return "Referral";
      const s = (r.referralSource || "").toLowerCase();
      if (s.includes("facebook")) return "Facebook group";
      if (s.includes("social") || s.includes("instagram") || s.includes("tiktok")) return "Social media";
      return "Other";
    };
    const sources = groupBuckets(sourceOf, ["Referral", "Social media", "Facebook group", "Other"], ["#12a150", "#2563eb", "#8a93a3", "#cbd5e1"]);

    // ── referrers ──────────────────────────────────────────────────────────────
    const refAny = new Set<string>(), refLive = new Set<string>();
    for (const r of U) { const s = r.asReferrer?.slug; if (!s) continue; refAny.add(s); if (levelOf(r) === 5) refLive.add(s); }
    const originOf = (slug: string | null) => {
      const s = (slug || "").toLowerCase();
      if (originMap && originMap[s]) return originMap[s];            // server match (email/phone → account)
      return refLive.has(s) ? "existing" : refAny.has(s) ? "former" : "outside"; // fallback until it loads
    };
    const OC: Record<string, { name: string; c: string; bg: string; fg: string }> = {
      existing: { name: "Existing ambassador", c: "#12a150", bg: "#e7f7ee", fg: "#0f7a3d" },
      former: { name: "Former ambassador", c: "#d97706", bg: "#fffbeb", fg: "#92400e" },
      outside: { name: "Outside referrer", c: "#8a93a3", bg: "#f1f3f6", fg: MUT },
    };
    const originAgg = new Map<string, { signups: number; refSet: Set<string>; onb: number }>();
    const leaderMap = new Map<string, { name: string; origin: string; signups: number; onb: number }>();
    for (const r of refsCur) {
      const o = originOf(r.referredBy); const slug = (r.referredBy || "").toLowerCase();
      if (!originAgg.has(o)) originAgg.set(o, { signups: 0, refSet: new Set(), onb: 0 });
      const oa = originAgg.get(o)!; oa.signups++; oa.refSet.add(slug); if (reach(r) === 5) oa.onb++;
      if (!leaderMap.has(slug)) leaderMap.set(slug, { name: r.referrer?.name || slug, origin: o, signups: 0, onb: 0 });
      const lm = leaderMap.get(slug)!; lm.signups++; if (reach(r) === 5) lm.onb++;
    }
    const origins = ["existing", "former", "outside"].filter(o => originAgg.has(o)).map(o => { const a = originAgg.get(o)!; return { ...OC[o], signups: a.signups, referrers: a.refSet.size, onb: a.onb, conv: pct(a.onb, a.signups) }; });
    const leaders = [...leaderMap.values()].sort((a, b) => b.signups - a.signups).slice(0, 6).map((l, i) => ({ rank: i + 1, name: l.name, signups: l.signups, onb: l.onb, originLabel: OC[l.origin].name, bg: OC[l.origin].bg, fg: OC[l.origin].fg }));

    // ── handlers ────────────────────────────────────────────────────────────────
    const respGaps = (r: Row): number[] => {
      const log = (r.outreachLog || []).slice().sort((a, b) => +new Date(a.at) - +new Date(b.at));
      const out: number[] = [];
      for (let i = 0; i < log.length; i++) {
        if (!["reply", "booked", "done"].includes(log[i].ch)) continue;
        for (let j = i + 1; j < log.length; j++) { if (!["reply", "booked", "done", "note"].includes(log[j].ch)) { out.push(+new Date(log[j].at) - +new Date(log[i].at)); break; } }
      }
      return out;
    };
    const hMap = new Map<string, Row[]>();
    for (const r of U) { const h = (r.poc || "").trim(); if (!h) continue; if (!hMap.has(h)) hMap.set(h, []); hMap.get(h)!.push(r); }
    const handlers = [...hMap.entries()].map(([name, rs]) => {
      const open = rs.filter(r => !dead(r) && levelOf(r) !== 5);
      const act = open.filter(r => turnOf(r).turn === "us").length;
      const gaps = rs.flatMap(respGaps); const resp = median(gaps);
      const onb = curOnb.filter(r => (r.poc || "").trim() === name).length;
      return { name, ini: initials(name), c: handlerColor(name), open: open.length, act, resp, onb };
    }).sort((a, b) => b.open - a.open);

    // ── fees ────────────────────────────────────────────────────────────────────
    const liveCount = U.filter(r => levelOf(r) === 5).length;
    let paidInRange = 0;
    for (const r of U) for (const p of r.monthlyPayouts || []) if (p.kind === "setup" && inCur(parse(p.paidAt))) paidInRange++;
    const rangeLabel = { "7": "This week", "30": "Last 30 days", "90": "Last 90 days", all: "Last 6 months" }[range];
    const prevLabel = hasPrev ? ({ "7": "last week", "30": "the 30 days before", "90": "the 90 days before" } as Record<string, string>)[range] : "no earlier period";
    const fees = [
      { label: "Setup fees owed", sub: `${unpaid.length} onboarded, not yet paid`, v: peso(unpaid.length * 1000), fg: "#92400e" },
      { label: "Setup fees paid", sub: "in " + (rangeLabel || "").toLowerCase(), v: peso(paidInRange * 1000), fg: INK },
      { label: "Committed monthly", sub: `${liveCount} live ambassadors × ₱500`, v: peso(liveCount * 500) + "/mo", fg: INK },
    ];

    return {
      kpis, weeks, tot, funnel, types, sources, origins, leaders, handlers, fees,
      restr: [
        { label: "Restricted", v: String(curRE.length), sub: "in the range", bg: "#fef2f2", fg: "#b91c1c" },
        { label: "Recovered", v: String(rec.length), sub: pct(rec.length, curRE.length) + " of restricted", bg: "#e7f7ee", fg: "#0f7a3d" },
        { label: "Median to recover", v: medRec != null ? medRec.toFixed(1) + "d" : "—", sub: medRecPrev != null ? "was " + medRecPrev.toFixed(1) + "d" : "no earlier period", bg: "#f5f8ff", fg: "#1d4ed8" },
        { label: "Lost", v: String(lost), sub: "stopped after restriction", bg: "#f6f7f9", fg: MUT },
      ],
      medOnb: medOnb != null ? medOnb.toFixed(1) : "—", overallConv: pct(curOnb.length, curApps.length),
      rangeLabel, prevLabel,
    };
  }, [rows, range, originMap]);

  // ── styles ──────────────────────────────────────────────────────────────────
  const th: CSSProperties = { font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: FAINT };
  const num: CSSProperties = { fontFamily: F_GRO, fontVariantNumeric: "tabular-nums" };
  const secTitle = (t: string, s: string) => (
    <div><div style={{ font: `700 15px ${F_SANS}`, color: INK }}>{t}</div><div style={{ font: `500 12.5px ${F_SANS}`, color: MUT }}>{s}</div></div>
  );
  const link = (href: string, label: string) => <a href={href} style={{ flex: "none", font: `700 12.5px ${F_SANS}`, color: ACC, textDecoration: "none", whiteSpace: "nowrap" }}>{label}</a>;
  const rangeOpts: [Range, string][] = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All time"]];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ font: `500 12.5px ${F_SANS}`, color: MUT }}><b style={{ color: INK }}>{v.rangeLabel}</b> · compared with {v.prevLabel}.</div>
        <div style={{ display: "flex", gap: 3, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 3 }}>
          {rangeOpts.map(([val, label]) => {
            const on = val === range;
            return <button key={val} onClick={() => setRange(val)} style={{ border: "none", cursor: "pointer", borderRadius: 7, padding: "6px 12px", whiteSpace: "nowrap", font: `700 12.5px ${F_SANS}`, background: on ? INK : "transparent", color: on ? "#fff" : MUT }}>{label}</button>;
          })}
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
        {v.kpis.map(t => (
          <div key={t.label} style={{ ...card, padding: "13px 15px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={th}>{t.label}</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ font: `700 26px ${F_GRO}`, color: INK, ...num }}>{t.v}</span>
              <span style={{ font: `700 11.5px ${F_SANS}`, padding: "2px 8px", borderRadius: 999, background: t.bg, color: t.fg }}>{t.d}</span>
            </div>
            <span style={{ font: `500 12px ${F_SANS}`, color: MUT }}>{t.sub}</span>
          </div>
        ))}
      </div>

      {/* weekly table */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px 10px" }}>{secTitle("Applications and referrals by week", "Weeks run Mon–Sun. Highlighted weeks are in the selected range.")}</div>
        <div style={{ overflowX: "auto" }}><div style={{ minWidth: 640 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(130px,1.4fr) repeat(5,minmax(70px,1fr)) 90px", gap: 10, padding: "8px 18px", background: BAND, borderTop: `1px solid #eef0f4`, borderBottom: `1px solid #eef0f4`, ...th }}>
            <span>Week</span><span style={{ textAlign: "right" }}>Applications</span><span style={{ textAlign: "right" }}>Referred</span><span style={{ textAlign: "right" }}>Referred %</span><span style={{ textAlign: "right" }}>Onboarded</span><span style={{ textAlign: "right" }}>Stopped</span><span style={{ textAlign: "right" }}>Apps vs prev</span>
          </div>
          {v.weeks.map((wk, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(130px,1.4fr) repeat(5,minmax(70px,1fr)) 90px", gap: 10, alignItems: "center", padding: "8px 18px", borderBottom: "1px solid #f0f2f5", background: wk.inR ? "#f5f8ff" : "#fff", boxShadow: wk.inR ? "inset 3px 0 0 #2563eb" : "inset 3px 0 0 transparent" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, font: `600 13px ${F_SANS}`, color: INK, whiteSpace: "nowrap" }}>{wk.label}{wk.now && <span style={{ font: `700 10.5px ${F_SANS}`, padding: "2px 7px", borderRadius: 999, background: "#e8efff", color: "#1d4ed8" }}>To date</span>}</span>
              <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, ...num }}>{wk.apps}</span>
              <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, ...num }}>{wk.refs}</span>
              <span style={{ textAlign: "right", font: `500 13px ${F_GRO}`, color: MUT, ...num }}>{wk.refPct}</span>
              <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, ...num }}>{wk.onb}</span>
              <span style={{ textAlign: "right", font: `500 14px ${F_GRO}`, color: MUT, ...num }}>{wk.stopped}</span>
              <span style={{ justifySelf: "end", font: `700 11.5px ${F_SANS}`, padding: "2px 8px", borderRadius: 999, background: wk.dBg, color: wk.dFg }}>{wk.d}</span>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(130px,1.4fr) repeat(5,minmax(70px,1fr)) 90px", gap: 10, alignItems: "center", padding: "10px 18px", background: BAND }}>
            <span style={{ font: `700 13px ${F_SANS}`, color: INK }}>{v.rangeLabel}</span>
            <span style={{ textAlign: "right", font: `700 14px ${F_GRO}`, ...num }}>{v.tot.apps}</span>
            <span style={{ textAlign: "right", font: `700 14px ${F_GRO}`, ...num }}>{v.tot.refs}</span>
            <span style={{ textAlign: "right", font: `600 13px ${F_GRO}`, color: MUT, ...num }}>{v.tot.refPct}</span>
            <span style={{ textAlign: "right", font: `700 14px ${F_GRO}`, ...num }}>{v.tot.onb}</span>
            <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, color: MUT, ...num }}>{v.tot.stopped}</span>
            <span />
          </div>
        </div></div>
      </div>

      {/* funnel */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>{secTitle("Funnel and time to onboard", "People who applied in the range, by the furthest stage they reached. “In stage now” and “Stalled” are live counts.")}{link("/admin/pipeline", "Open Queue →")}</div>
        <div style={{ overflowX: "auto" }}><div style={{ minWidth: 660 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(230px,1.6fr) minmax(150px,1.6fr) repeat(5,minmax(62px,.8fr))", gap: 10, padding: "8px 18px", background: BAND, borderTop: "1px solid #eef0f4", borderBottom: "1px solid #eef0f4", ...th }}>
            <span>Stage</span><span>Reached</span><span style={{ textAlign: "right" }}>Conv.</span><span style={{ textAlign: "right" }}>Median days</span><span style={{ textAlign: "right" }}>In stage now</span><span style={{ textAlign: "right" }}>Stalled 7d+</span><span style={{ textAlign: "right" }}>Stopped here</span>
          </div>
          {v.funnel.map((f, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(230px,1.6fr) minmax(150px,1.6fr) repeat(5,minmax(62px,.8fr))", gap: 10, alignItems: "center", padding: "9px 18px", borderBottom: "1px solid #f0f2f5" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, font: `600 13px ${F_SANS}`, color: INK, whiteSpace: "nowrap" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: f.dot }} />{f.name}{f.worst && <span style={{ font: `700 10.5px ${F_SANS}`, padding: "2px 7px", borderRadius: 999, background: "#fffbeb", color: "#92400e" }}>Biggest drop</span>}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><div style={{ flex: 1, height: 8, background: "#f1f3f6", borderRadius: 999, overflow: "hidden" }}><div style={{ height: "100%", width: f.w, background: f.dot, borderRadius: 999 }} /></div><span style={{ font: `600 14px ${F_GRO}`, minWidth: 28, textAlign: "right", ...num }}>{f.reached}</span></div>
              <span style={{ textAlign: "right", font: `600 13px ${F_GRO}`, color: f.worst ? "#92400e" : INK, ...num }}>{f.conv}</span>
              <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, color: INK, ...num }}>{f.days}</span>
              <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, color: INK, ...num }}>{f.now}</span>
              <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, color: f.stallAmber ? "#b45309" : INK, ...num }}>{f.stall}</span>
              <span style={{ textAlign: "right", font: `500 14px ${F_GRO}`, color: MUT, ...num }}>{f.stopped}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "11px 18px", background: BAND, font: `500 12.5px ${F_SANS}`, color: MUT }}>
            <span>Signup → onboarded: <b style={{ color: INK, fontFamily: F_GRO }}>{v.medOnb} days</b> median</span>
            <span>Overall conversion: <b style={{ color: INK, fontFamily: F_GRO }}>{v.overallConv}</b></span>
          </div>
        </div></div>
      </div>

      {/* type / source / restrictions */}
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(3,1fr)", gap: 14 }}>
        <div style={{ ...card, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {secTitle("Application type", "Full, email-only and form-only signups.")}
          {v.types.map(t => (
            <div key={t.name} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}><span style={{ font: `700 13px ${F_SANS}`, color: INK }}>{t.name}</span><span style={{ font: `600 14px ${F_GRO}`, ...num }}>{t.n} <span style={{ font: `500 12px ${F_SANS}`, color: FAINT }}>{t.share}</span></span></div>
              <div style={{ height: 6, background: "#f1f3f6", borderRadius: 999, overflow: "hidden" }}><div style={{ height: "100%", width: t.w, background: t.c, borderRadius: 999 }} /></div>
              <span style={{ font: `500 12px ${F_SANS}`, color: MUT }}>{t.onb} onboarded · {t.conv} conv. · {t.days}d median to onboard</span>
            </div>
          ))}
        </div>
        <div style={{ ...card, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {secTitle("Where they came from", "Source given at signup.")}
          {v.sources.map(t => (
            <div key={t.name} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}><span style={{ font: `700 13px ${F_SANS}`, color: INK }}>{t.name}</span><span style={{ font: `600 14px ${F_GRO}`, ...num }}>{t.n} <span style={{ font: `500 12px ${F_SANS}`, color: FAINT }}>{t.share}</span></span></div>
              <div style={{ height: 6, background: "#f1f3f6", borderRadius: 999, overflow: "hidden" }}><div style={{ height: "100%", width: t.w, background: t.c, borderRadius: 999 }} /></div>
              <span style={{ font: `500 12px ${F_SANS}`, color: MUT }}>{t.onb} onboarded · {t.conv} conv.</span>
            </div>
          ))}
        </div>
        <div style={{ ...card, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>{secTitle("Restrictions during onboarding", "Accounts restricted before going live.")}{link("/admin/restrictions", "Open Recovery →")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {v.restr.map(r => (
              <div key={r.label} style={{ background: r.bg, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: r.fg }}>{r.label}</span>
                <span style={{ font: `700 22px ${F_GRO}`, color: INK, ...num }}>{r.v}</span>
                <span style={{ font: `500 11.5px ${F_SANS}`, color: MUT }}>{r.sub}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* referrers + handlers + fees */}
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "2fr 1fr", gap: 14, alignItems: "start" }}>
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>{secTitle("Referrers", "Who referred the applications in this range, and whether they’re an ambassador.")}{link("/admin/referrals-v2", "Open Referrals →")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8, padding: "0 18px 14px" }}>
            {v.origins.map(o => (
              <div key={o.name} style={{ border: "1px solid #e6e9ee", borderRadius: 12, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, font: `700 12px ${F_SANS}`, color: INK }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: o.c }} />{o.name}</span>
                <span style={{ font: `700 22px ${F_GRO}`, color: INK, ...num }}>{o.signups} <span style={{ font: `500 12px ${F_SANS}`, color: FAINT }}>signups</span></span>
                <span style={{ font: `500 12px ${F_SANS}`, color: MUT }}>{o.referrers} referrers · {o.onb} onboarded ({o.conv})</span>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1.6fr) minmax(0,1.3fr) 70px 80px", gap: 10, padding: "8px 18px", background: BAND, borderTop: "1px solid #eef0f4", borderBottom: "1px solid #eef0f4", ...th }}>
            <span>#</span><span>Top referrers</span><span>Type</span><span style={{ textAlign: "right" }}>Signups</span><span style={{ textAlign: "right" }}>Onboarded</span>
          </div>
          {v.leaders.length === 0 && <div style={{ padding: "14px 18px", font: `500 13px ${F_SANS}`, color: MUT }}>No referred signups in this range.</div>}
          {v.leaders.map(l => (
            <div key={l.rank} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1.6fr) minmax(0,1.3fr) 70px 80px", gap: 10, alignItems: "center", padding: "8px 18px", borderBottom: "1px solid #f0f2f5" }}>
              <span style={{ font: `600 13px ${F_GRO}`, color: FAINT }}>{l.rank}</span>
              <span style={{ font: `600 13px ${F_SANS}`, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
              <span style={{ justifySelf: "start", font: `700 11px ${F_SANS}`, padding: "3px 9px", borderRadius: 999, background: l.bg, color: l.fg, whiteSpace: "nowrap" }}>{l.originLabel}</span>
              <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, ...num }}>{l.signups}</span>
              <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, ...num }}>{l.onb}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ ...card, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px 10px" }}>{secTitle("Handler workload", "Open = claimed and not onboarded. Response = time from an applicant reply to the next action.")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) repeat(4,minmax(46px,1fr))", gap: 8, padding: "8px 18px", background: BAND, borderTop: "1px solid #eef0f4", borderBottom: "1px solid #eef0f4", ...th }}>
              <span>Handler</span><span style={{ textAlign: "right" }}>Open</span><span style={{ textAlign: "right" }}>Action</span><span style={{ textAlign: "right" }}>Response</span><span style={{ textAlign: "right" }}>Onboarded</span>
            </div>
            {v.handlers.length === 0 && <div style={{ padding: "14px 18px", font: `500 13px ${F_SANS}`, color: MUT }}>No claimed rows.</div>}
            {v.handlers.map(h => (
              <div key={h.name} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) repeat(4,minmax(46px,1fr))", gap: 8, alignItems: "center", padding: "8px 18px", borderBottom: "1px solid #f0f2f5" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, font: `600 13px ${F_SANS}`, color: INK, minWidth: 0 }}><span style={{ flex: "none", width: 22, height: 22, borderRadius: "50%", background: h.c, color: "#fff", font: `700 10px ${F_SANS}`, display: "flex", alignItems: "center", justifyContent: "center" }}>{h.ini}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span></span>
                <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, ...num }}>{h.open}</span>
                <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, color: h.act >= 4 ? "#b45309" : INK, ...num }}>{h.act}</span>
                <span style={{ textAlign: "right", font: `600 13px ${F_GRO}`, color: h.resp != null && h.resp >= 6 * 3600000 ? "#b91c1c" : INK, ...num }}>{h.resp != null ? dur(h.resp) : "—"}</span>
                <span style={{ textAlign: "right", font: `600 14px ${F_GRO}`, ...num }}>{h.onb}</span>
              </div>
            ))}
          </div>
          <div style={{ ...card, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            {secTitle("Setup fees and committed spend", "₱1,000 setup fee per onboarded account, ₱500/mo after.")}
            {v.fees.map(f => (
              <div key={f.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "8px 0", borderTop: "1px solid #f0f2f5" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}><span style={{ font: `700 13px ${F_SANS}`, color: INK }}>{f.label}</span><span style={{ font: `500 12px ${F_SANS}`, color: MUT }}>{f.sub}</span></div>
                <span style={{ font: `700 18px ${F_GRO}`, color: f.fg, whiteSpace: "nowrap", ...num }}>{f.v}</span>
              </div>
            ))}
            {link("/admin/balances", "Open Payouts →")}
          </div>
        </div>
      </div>
    </div>
  );
}
