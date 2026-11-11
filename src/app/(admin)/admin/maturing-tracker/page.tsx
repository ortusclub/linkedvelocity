"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Space_Grotesk } from "next/font/google";
import { jakartaSans as jakarta } from "@/lib/jakarta-font";

const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"] });
const F = jakarta.style.fontFamily;
const G = grotesk.style.fontFamily;

type Bucket = { key: string; name: string; inv: number; mat: number; relogin: number; fail: number; ne: number };
type Fact = { l: string; v: string };
type Review = { id: string; kind: string; label: string; email: string; name: string; bucket: string; status: string; conns: number | null; detail: string; sub: string; facts: Fact[]; since: string; sinceDays: number; canRecheck: boolean; canRestrict: boolean; isFlag: boolean };
type MatRow = { id: string; email: string; name: string; bucket: string; status: string; conns: number | null; day: number; started: string; re: boolean; flagKind: string | null; flagLabel: string | null };
type Data = { updatedAt: string; kpis: { eligible: number; maturing: number; maturingPct: number; needsReview: number; restricted: number }; buckets: Bucket[]; review: Review[]; rows: MatRow[] };
type Health = { checkedAt: string; summary: { sending: number; starting: number; attention: number; queued: number; accounts: number }; attention: { email: string; reason: string }[]; starting: { email: string; reason: string }[] };

const FLAG_OPTS: { kind: string; label: string; dot: string }[] = [
  { kind: "logged_out", label: "Logged out", dot: "#f59e0b" },
  { kind: "relogin", label: "Needs relogin", dot: "#f59e0b" },
  { kind: "identity", label: "Identity check", dot: "#d97706" },
  { kind: "restricted", label: "Restricted", dot: "#ef4444" },
  { kind: "paused", label: "Paused", dot: "#8a93a3" },
  { kind: "other", label: "Other", dot: "#5b6779" },
];
const FLAG_DOT: Record<string, string> = Object.fromEntries(FLAG_OPTS.map((o) => [o.kind, o.dot]));

function reasonColor(kind: string): { bg: string; fg: string; edge: string } {
  if (kind === "not-enrolled") return { bg: "#eaf1ff", fg: "#1d4ed8", edge: "transparent" };
  if (kind === "flag:paused" || kind === "flag:other") return { bg: "#eef0f4", fg: "#334155", edge: FLAG_DOT[kind.slice(5)] };
  if (kind.startsWith("flag:")) return { bg: "#fffbeb", fg: "#92400e", edge: FLAG_DOT[kind.slice(5)] };
  return { bg: "#fff1e6", fg: "#9a3412", edge: "#f59e0b" }; // relogin / start-failed
}

const C = { bg: "#eef0f4", card: "#fff", border: "#e3e6ec", ink: "#0b1220", mut: "#5b6779", faint: "#8a93a3" };
const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 };
const hcell: React.CSSProperties = { font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: C.faint };

export default function MaturingTrackerPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, string>>({});
  // currently-maturing controls
  const [bucket, setBucket] = useState("all");
  const [reOnly, setReOnly] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(25);
  // flag editor
  const [openId, setOpenId] = useState<string | null>(null);
  const [draftKind, setDraftKind] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // "is it actually sending?" health check (on demand — reads real send logs from the engine)
  const [health, setHealth] = useState<Health | null>(null);
  const [hBusy, setHBusy] = useState(false);
  const [hErr, setHErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/maturing-tracker", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to load");
      setData(j); setError("");
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = useCallback(async (path: string, body: object, id: string, label: string) => {
    setBusy((s) => ({ ...s, [id]: "…" }));
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      setBusy((s) => ({ ...s, [id]: label }));
      await load();
    } catch (e) { setBusy((s) => ({ ...s, [id]: `failed: ${(e as Error).message}` })); }
  }, [load]);

  const checkHealth = useCallback(async () => {
    setHBusy(true); setHErr("");
    try {
      const r = await fetch("/api/admin/maturing-tracker/health", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Check failed");
      setHealth(j);
    } catch (e) { setHErr((e as Error).message); } finally { setHBusy(false); }
  }, []);

  const recheck = (id: string) => post("/api/admin/maturing-tracker/recheck", { accountId: id }, id, "queued ✓");
  const restrict = (id: string) => post("/api/admin/maturing-tracker/flag", { accountId: id, action: "restrict" }, id, "restricted ✓");
  const clearFlag = (id: string) => post("/api/admin/maturing-tracker/flag", { accountId: id, action: "clear" }, id, "cleared ✓");
  const saveFlag = (id: string) => {
    if (!draftKind) return;
    const body = draftKind === "restricted" ? { accountId: id, action: "restrict", note } : { accountId: id, action: "flag", kind: draftKind, note };
    setOpenId(null); setDraftKind(null); setNote("");
    void post("/api/admin/maturing-tracker/flag", body, id, "saved ✓");
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const ql = q.trim().toLowerCase();
    return data.rows.filter((a) => (bucket === "all" || a.bucket.startsWith(bucket)) && (!reOnly || a.re) && (!ql || `${a.email} ${a.name}`.toLowerCase().includes(ql)));
  }, [data, bucket, reOnly, q]);

  const bucketTabs = useMemo(() => {
    if (!data) return [];
    const count = (k: string) => (k === "all" ? data.rows.length : data.rows.filter((a) => a.bucket.startsWith(k)).length);
    return [["all", "All"], ["Available", "Available"], ["Construction", "Construction"], ["Pipeline", "Pipeline L4"]].map(([k, l]) => ({ k, l, n: count(k) }));
  }, [data]);

  const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({ border: `1px solid ${C.border}`, background: "#fff", color: C.ink, borderRadius: 8, padding: "6px 10px", font: `700 12px ${F}`, cursor: "pointer", whiteSpace: "nowrap", ...extra });

  return (
    <main className={jakarta.className} style={{ minHeight: "100vh", background: C.bg, padding: "28px 20px 80px" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ font: `700 30px ${G}`, color: C.ink, margin: "0 0 4px", letterSpacing: "-.01em" }}>Profile maturing</h1>
            <p style={{ font: `500 14px ${F}`, color: C.mut, margin: 0 }}>Is every eligible profile maturing, does it match inventory, and what needs a human.{data && <span style={{ color: C.faint }}> Updated {new Date(data.updatedAt).toLocaleTimeString()}</span>}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => void load()} disabled={loading} style={{ border: `1px solid ${C.border}`, background: "#fff", color: C.ink, borderRadius: 10, padding: "9px 14px", font: `700 12.5px ${F}`, cursor: "pointer" }}>{loading ? "Loading…" : "Refresh"}</button>
            <Link href="/admin/profile-maturing" style={{ border: "none", background: C.ink, color: "#fff", borderRadius: 10, padding: "9px 14px", font: `700 12.5px ${F}`, textDecoration: "none" }}>Board →</Link>
          </div>
        </div>

        {error && <div style={{ ...card, padding: 16, borderColor: "#f5c2c2", color: "#b91c1c" }}>{error}</div>}

        {data && (
          <>
            {/* KPI cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
              <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={hcell}>Eligible</span>
                <span style={{ font: `700 32px ${G}`, color: C.ink }}>{data.kpis.eligible}</span>
                <span style={{ font: `500 12.5px ${F}`, color: C.mut }}>Construction + available + level 4</span>
              </div>
              <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={hcell}>Maturing</span>
                <span style={{ font: `700 32px ${G}`, color: "#0f7a3d" }}>{data.kpis.maturing}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, height: 6, borderRadius: 999, background: C.bg, overflow: "hidden", display: "flex" }}><span style={{ width: `${data.kpis.maturingPct}%`, background: "#12a150", borderRadius: 999 }} /></span>
                  <span style={{ font: `600 12.5px ${F}`, color: C.mut }}>{data.kpis.maturingPct}% of eligible</span>
                </div>
              </div>
              <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4, background: "#fffbeb", borderColor: "#f5dcae" }}>
                <span style={{ ...hcell, color: "#92400e" }}>Needs review</span>
                <span style={{ font: `700 32px ${G}`, color: "#92400e" }}>{data.kpis.needsReview}</span>
                <span style={{ font: `500 12.5px ${F}`, color: "#92400e" }}>Eligible but not maturing, or flagged</span>
              </div>
              <Link href="/admin/restrictions-v2" style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4, color: "inherit", textDecoration: "none" }}>
                <span style={hcell}>Restricted</span>
                <span style={{ font: `700 32px ${G}`, color: "#b91c1c" }}>{data.kpis.restricted}</span>
                <span style={{ font: `600 12.5px ${F}`, color: "#2563eb" }}>Recovery queue →</span>
              </Link>
            </div>

            {/* Is it actually sending? — plain green/amber/red health check for anyone, no numbers to read */}
            <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ font: `700 16px ${G}`, color: C.ink }}>Is maturing actually sending?</div>
                  <div style={{ font: `500 12.5px ${F}`, color: C.mut, marginTop: 2 }}>The counts above only show which accounts are <i>meant</i> to mature. This checks the engine for accounts that are <b>actually sending connection requests</b> right now.</div>
                </div>
                <button onClick={() => void checkHealth()} disabled={hBusy} style={{ border: "none", background: C.ink, color: "#fff", borderRadius: 10, padding: "10px 16px", font: `700 13px ${F}`, cursor: hBusy ? "default" : "pointer", opacity: hBusy ? 0.6 : 1 }}>{hBusy ? "Checking… (takes ~20s)" : health ? "Check again" : "Check now"}</button>
              </div>

              {hErr && <div style={{ font: `600 13px ${F}`, color: "#b91c1c" }}>{hErr}</div>}

              {health && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                    {[
                      { n: health.summary.sending, lbl: "Sending normally", sub: "working", bg: "#e7f7ee", fg: "#0f7a3d", dot: "🟢" },
                      { n: health.summary.starting, lbl: "Just started", sub: "give it a day", bg: "#fffbeb", fg: "#92400e", dot: "🟡" },
                      { n: health.summary.attention, lbl: "Not sending", sub: "needs attention", bg: "#fef2f2", fg: "#b91c1c", dot: "🔴" },
                      { n: health.summary.queued, lbl: "Queued", sub: "waiting their turn", bg: "#eef0f4", fg: "#334155", dot: "⚪" },
                    ].map((s) => (
                      <div key={s.lbl} style={{ background: s.bg, borderRadius: 12, padding: "12px 14px" }}>
                        <div style={{ font: `700 26px ${G}`, color: s.fg }}>{s.dot} {s.n}</div>
                        <div style={{ font: `700 13px ${F}`, color: s.fg }}>{s.lbl}</div>
                        <div style={{ font: `500 11.5px ${F}`, color: s.fg, opacity: 0.8 }}>{s.sub}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ font: `600 13px ${F}`, color: health.summary.attention ? "#b91c1c" : "#0f7a3d" }}>
                    {health.summary.attention === 0
                      ? "✓ Everything that should be sending is sending. Nothing to do."
                      : `${health.summary.attention} account${health.summary.attention === 1 ? "" : "s"} ${health.summary.attention === 1 ? "is" : "are"} not sending and need a look (listed below). If this stays high, tell Sam.`}
                  </div>

                  {!!health.attention.length && (
                    <div style={{ border: `1px solid #f5c2c2`, borderRadius: 10, overflow: "hidden" }}>
                      {health.attention.map((a, i) => (
                        <div key={a.email} style={{ display: "flex", gap: 10, padding: "9px 12px", background: i % 2 ? "#fff" : "#fff8f8", alignItems: "baseline" }}>
                          <span style={{ font: `700 12.5px ${F}`, color: C.ink, minWidth: 220 }}>🔴 {a.email}</span>
                          <span style={{ font: `500 12.5px ${F}`, color: "#9a3412" }}>{a.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!!health.starting.length && (
                    <details style={{ font: `500 12.5px ${F}`, color: C.mut }}>
                      <summary style={{ cursor: "pointer", font: `700 12.5px ${F}`, color: "#92400e" }}>{health.starting.length} just started (normal — no action)</summary>
                      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                        {health.starting.map((a) => <span key={a.email}>🟡 {a.email} — {a.reason}</span>)}
                      </div>
                    </details>
                  )}

                  <div style={{ font: `500 11px ${F}`, color: C.faint }}>Checked {new Date(health.checkedAt).toLocaleTimeString()} · reads the real send log (sent / errors) from the engine, not just the status label.</div>
                </>
              )}
            </div>

            {/* Match by inventory bucket */}
            <div style={{ ...card, overflowX: "auto" }}>
              <div style={{ minWidth: 820 }}>
                <div style={{ padding: "14px 18px 10px", font: `700 16px ${G}`, color: C.ink }}>Match by inventory bucket</div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.6fr) repeat(5,minmax(80px,1fr)) minmax(140px,1.2fr)", gap: 14, padding: "9px 18px", borderTop: `1px solid ${C.bg}`, borderBottom: `1px solid ${C.bg}` }}>
                  {["Bucket", "In inventory", "Maturing", "Relogin", "Start failed", "Not enrolled", "Matched"].map((h) => <span key={h} style={hcell}>{h}</span>)}
                </div>
                {data.buckets.filter((b) => b.inv || b.key !== "pipeline").map((b) => {
                  const todo = b.inv - b.mat;
                  return (
                    <div key={b.key} style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.6fr) repeat(5,minmax(80px,1fr)) minmax(140px,1.2fr)", gap: 14, alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${C.bg}` }}>
                      <span style={{ font: `700 14px ${F}`, color: C.ink }}>{b.name}</span>
                      <span style={{ font: `600 15px ${G}`, color: C.mut }}>{b.inv}</span>
                      <span style={{ font: `700 15px ${G}`, color: C.ink }}>{b.mat}</span>
                      <span style={{ font: `700 15px ${G}`, color: b.relogin ? "#92400e" : "#b4bccb" }}>{b.relogin}</span>
                      <span style={{ font: `700 15px ${G}`, color: b.fail ? "#b91c1c" : "#b4bccb" }}>{b.fail}</span>
                      <span style={{ font: `700 15px ${G}`, color: b.ne ? "#1d4ed8" : "#b4bccb" }}>{b.ne}</span>
                      <span><span style={{ font: `700 11.5px ${F}`, padding: "3px 10px", borderRadius: 999, background: todo ? "#fffbeb" : "#e7f7ee", color: todo ? "#92400e" : "#0f7a3d", whiteSpace: "nowrap" }}>{todo ? `${todo} to resolve` : "All maturing"}</span></span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Needs review */}
            <div style={{ ...card, overflowX: "auto" }}>
              <div style={{ minWidth: 980 }}>
                <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ font: `700 16px ${G}`, color: C.ink }}>Needs review</span>
                  <span style={{ font: `700 11px ${G}`, color: "#92400e", background: "#fffbeb", borderRadius: 999, padding: "2px 8px" }}>{data.review.length}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "150px minmax(240px,1.4fr) 150px 70px minmax(260px,2fr) 70px 160px", gap: 14, padding: "9px 18px", borderTop: `1px solid ${C.bg}`, borderBottom: `1px solid ${C.bg}` }}>
                  {["Reason", "Account", "Status", "Conns", "Detail", "Waiting", ""].map((h, i) => <span key={i} style={hcell}>{h}</span>)}
                </div>
                {!data.review.length && <div style={{ padding: 18, font: `500 13px ${F}`, color: C.mut }}>Nothing to review — every eligible account is maturing. 🎉</div>}
                {data.review.map((r) => {
                  const rc = reasonColor(r.kind);
                  return (
                    <div key={r.id + r.kind} style={{ display: "grid", gridTemplateColumns: "150px minmax(240px,1.4fr) 150px 70px minmax(260px,2fr) 70px 160px", gap: 14, alignItems: "start", padding: "13px 18px", borderBottom: `1px solid ${C.bg}`, boxShadow: `inset 3px 0 0 ${rc.edge}` }}>
                      <span><span style={{ font: `700 11.5px ${F}`, padding: "3px 10px", borderRadius: 999, background: rc.bg, color: rc.fg, whiteSpace: "nowrap" }}>{r.label}</span></span>
                      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        <Link href={`/admin/accounts/${r.id}`} style={{ font: `700 13.5px ${F}`, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email || r.name}</Link>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><span style={{ font: `500 12px ${F}`, color: C.mut }}>{r.name}</span><span style={{ font: `700 10.5px ${F}`, color: "#334155", background: C.bg, borderRadius: 6, padding: "1px 7px" }}>{r.bucket}</span></div>
                      </div>
                      <span><span style={{ font: `600 11.5px ${F}`, padding: "3px 9px", borderRadius: 999, background: "#f1f5f9", color: "#334155", whiteSpace: "nowrap" }}>{r.status}</span></span>
                      <span style={{ font: `600 14px ${G}`, color: C.ink }}>{r.conns ?? "—"}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ font: `500 13px/1.5 ${F}`, color: C.ink }}>{r.detail}</span>
                        {r.sub && <span style={{ font: `600 12px ${F}`, color: C.mut }}>{r.sub}</span>}
                        {!!r.facts.length && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>{r.facts.map((fc, i) => <span key={i} style={{ font: `600 11.5px ${F}`, color: C.mut, background: "#f8f9fb", border: `1px solid ${C.border}`, borderRadius: 8, padding: "3px 8px", whiteSpace: "nowrap" }}>{fc.l} <b style={{ font: `700 12px ${G}`, color: C.ink }}>{fc.v}</b></span>)}</div>}
                      </div>
                      <span style={{ font: `700 13px ${G}`, color: r.sinceDays >= 10 ? "#b91c1c" : r.sinceDays >= 7 ? "#92400e" : C.ink }}>{r.since || "—"}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                        {r.canRecheck && <button onClick={() => void recheck(r.id)} disabled={busy[r.id] === "…"} style={btn()}>⚡ Re-check / resume</button>}
                        {r.canRestrict && <button onClick={() => void restrict(r.id)} disabled={busy[r.id] === "…"} style={btn({ border: "1px solid #f5c2c2", background: "#fef2f2", color: "#b91c1c" })}>Mark restricted</button>}
                        {r.isFlag && <button onClick={() => void clearFlag(r.id)} disabled={busy[r.id] === "…"} style={btn({ border: "1px solid #bfe6cd", background: "#e7f7ee", color: "#0f7a3d" })}>Clear flag</button>}
                        {busy[r.id] && busy[r.id] !== "…" && <span style={{ font: `600 11px ${F}`, color: C.faint }}>{busy[r.id]}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Currently maturing */}
            <div style={{ ...card, overflowX: "auto" }}>
              <div style={{ minWidth: 980 }}>
                <div style={{ padding: "14px 18px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ font: `700 16px ${G}`, color: C.ink }}>Currently maturing</span>
                  <span style={{ font: `700 11px ${G}`, color: "#0f7a3d", background: "#e7f7ee", borderRadius: 999, padding: "2px 8px" }}>{data.rows.length}</span>
                  <span style={{ flex: 1 }} />
                  {bucketTabs.map((t) => <button key={t.k} onClick={() => { setBucket(t.k); setLimit(25); }} style={{ border: `1.5px solid ${bucket === t.k ? C.ink : C.border}`, background: bucket === t.k ? "#f4f6f9" : "#fff", borderRadius: 999, padding: "4px 11px", font: `700 12px ${F}`, color: C.ink, cursor: "pointer", whiteSpace: "nowrap" }}>{t.l} <span style={{ font: `700 11px ${G}`, color: C.mut }}>{t.n}</span></button>)}
                  <button onClick={() => { setReOnly((v) => !v); setLimit(25); }} style={{ border: `1.5px solid ${reOnly ? "#0f7a3d" : C.border}`, background: reOnly ? "#e7f7ee" : "#fff", borderRadius: 999, padding: "4px 11px", font: `700 12px ${F}`, color: "#0f7a3d", cursor: "pointer", whiteSpace: "nowrap" }}>Re-maturing only</button>
                  <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(25); }} placeholder="Search email or name…" style={{ width: 220, border: `1px solid ${C.border}`, background: "#f8f9fb", borderRadius: 10, padding: "7px 12px", font: `500 13px ${F}`, color: C.ink, outline: "none" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,2fr) 150px 90px 150px 70px 90px 160px", gap: 14, padding: "9px 18px", borderTop: `1px solid ${C.bg}`, borderBottom: `1px solid ${C.bg}` }}>
                  {["Account", "Inventory", "Day", "Status", "Conns", "Started", "Flag"].map((h, i) => <span key={i} style={{ ...hcell, textAlign: i === 6 ? "right" : "left" }}>{h}</span>)}
                </div>
                {filtered.slice(0, limit).map((a) => {
                  const m = a.flagKind;
                  return (
                    <div key={a.id} style={{ borderBottom: `1px solid ${C.bg}`, boxShadow: `inset 3px 0 0 ${m ? FLAG_DOT[m] : "transparent"}`, background: "#fff" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,2fr) 150px 90px 150px 70px 90px 160px", gap: 14, alignItems: "center", padding: "10px 18px" }}>
                        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            <Link href={`/admin/accounts/${a.id}`} style={{ font: `600 13.5px ${F}`, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.email || a.name}</Link>
                            {a.re && <span style={{ flex: "none", font: `700 10.5px ${F}`, color: "#0f7a3d", background: "#e7f7ee", borderRadius: 999, padding: "1px 8px" }}>Re-maturing</span>}
                          </div>
                          <span style={{ font: `500 12px ${F}`, color: C.faint }}>{a.name}</span>
                        </div>
                        <span style={{ font: `600 12.5px ${F}`, color: "#334155" }}>{a.bucket.replace(/ \(.*\)| \(level 4\)/, "")}</span>
                        <span style={{ font: `600 13px ${G}`, color: C.ink }}>Day {a.day}</span>
                        <span><span style={{ font: `600 11.5px ${F}`, padding: "3px 9px", borderRadius: 999, background: "#f1f5f9", color: "#334155", whiteSpace: "nowrap" }}>{a.status}</span></span>
                        <span style={{ font: `600 14px ${G}`, color: C.ink }}>{a.conns ?? "—"}</span>
                        <span style={{ font: `500 12.5px ${F}`, color: C.mut }}>{a.started}</span>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <button onClick={() => { const open = openId === a.id; setOpenId(open ? null : a.id); setDraftKind(open ? null : a.flagKind); setNote(""); }} style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${m ? FLAG_DOT[m] : C.border}`, background: m ? "#fffbeb" : "#fff", color: m ? "#92400e" : C.mut, borderRadius: 999, padding: "4px 11px", font: `700 12px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: m ? FLAG_DOT[m] : "#12a150" }} />{a.flagLabel || "OK"}</button>
                        </div>
                      </div>
                      {openId === a.id && (
                        <div style={{ margin: "0 18px 12px", padding: 12, border: `1px solid ${C.border}`, borderRadius: 12, background: "#f8f9fb", display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ ...hcell, marginRight: 4 }}>Flag as</span>
                            {FLAG_OPTS.map((o) => <button key={o.kind} onClick={() => setDraftKind(o.kind)} style={{ display: "flex", alignItems: "center", gap: 6, border: `1.5px solid ${draftKind === o.kind ? o.dot : C.border}`, background: draftKind === o.kind ? "#fff" : "#fff", color: C.ink, borderRadius: 999, padding: "4px 11px", font: `700 12px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: o.dot }} />{o.label}</button>)}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional): what you saw, e.g. asked for phone verification" style={{ flex: 1, minWidth: 240, border: `1px solid ${C.border}`, background: "#fff", borderRadius: 10, padding: "8px 12px", font: `500 13px ${F}`, color: C.ink, outline: "none" }} />
                            <button onClick={() => { setOpenId(null); setDraftKind(null); }} style={{ border: `1px solid ${C.border}`, background: "#fff", color: C.ink, borderRadius: 10, padding: "8px 12px", font: `700 12.5px ${F}`, cursor: "pointer" }}>Cancel</button>
                            {a.flagKind && <button onClick={() => void clearFlag(a.id)} style={{ border: "1px solid #bfe6cd", background: "#e7f7ee", color: "#0f7a3d", borderRadius: 10, padding: "8px 12px", font: `700 12.5px ${F}`, cursor: "pointer" }}>Clear flag</button>}
                            <button onClick={() => saveFlag(a.id)} disabled={!draftKind} style={{ border: "none", background: draftKind ? C.ink : "#a3abb8", color: "#fff", borderRadius: 10, padding: "8px 14px", font: `700 12.5px ${F}`, cursor: draftKind ? "pointer" : "default" }}>Save flag</button>
                          </div>
                          <span style={{ font: `500 11.5px ${F}`, color: C.faint }}>Flagged accounts show in Needs review and drop out of the maturing count (except “Other”). “Restricted” sends it to the recovery queue.</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div style={{ padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ font: `500 12.5px ${F}`, color: C.mut }}>Showing {Math.min(limit, filtered.length)} of {filtered.length}</span>
                  {filtered.length > limit && <button onClick={() => setLimit((n) => n + 25)} style={{ border: `1px solid ${C.border}`, background: "#fff", color: C.ink, borderRadius: 10, padding: "7px 12px", font: `700 12.5px ${F}`, cursor: "pointer" }}>Show 25 more</button>}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
