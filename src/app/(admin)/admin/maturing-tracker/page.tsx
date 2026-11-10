"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Bucket = { total: number; maturing: number; stalled: number; startFailed: number; notEnrolled: number };
type Row = { id: string; name: string; email: string; status: string; group: string; level4: boolean; connections: number | null; reason: string; detail: string; since: string | null };
type Data = {
  updatedAt: string;
  buckets: Record<string, Bucket>;
  needsReview: Row[];
  maturing: Row[];
  restrictedCount: number;
  restrictedSample: Row[];
  totals: { eligible: number; maturing: number; needsReview: number };
};

const REASON: Record<string, { label: string; color: string }> = {
  "not-enrolled": { label: "Not enrolled", color: "#1a56db" },
  relogin: { label: "Relogin / identity", color: "#b45309" },
  "start-failed": { label: "Start failed", color: "#b45309" },
  restricted: { label: "Restricted", color: "#c0392b" },
};

const card: React.CSSProperties = { border: "1px solid var(--border,#2a2a2a)", borderRadius: 12, padding: "16px 18px", background: "var(--card,#141414)" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.6, padding: "8px 10px", borderBottom: "1px solid var(--border,#2a2a2a)" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--border,#222)", fontSize: 14, verticalAlign: "top" };

function ago(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const d = Math.floor(ms / 86400000);
  if (d >= 1) return `${d}d ago`;
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `${h}h ago`;
  return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
}

export default function MaturingTrackerPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [recheck, setRecheck] = useState<Record<string, string>>({});

  const doRecheck = useCallback(async (id: string) => {
    setRecheck((s) => ({ ...s, [id]: "…" }));
    try {
      const r = await fetch("/api/admin/maturing-tracker/recheck", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      setRecheck((s) => ({ ...s, [id]: j.rechecked ? `queued ✓` : "no live campaign" }));
    } catch (e) {
      setRecheck((s) => ({ ...s, [id]: `failed: ${(e as Error).message}` }));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/maturing-tracker", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to load");
      setData(j);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const bucketKeys = ["Available", "Construction", "Pipeline"];
  const bucketLabel: Record<string, string> = {
    Available: "Available (inventory)",
    Construction: "Construction (inventory)",
    Pipeline: "Pipeline Maturing (Level 4)",
  };

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px", display: "grid", gap: 20 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Profile Maturing — Tracker</h1>
          <p style={{ margin: "4px 0 0", opacity: 0.65, fontSize: 14 }}>
            Does maturing match the inventory, is everyone eligible actually maturing, and what needs a human.
            {data && <> · updated {ago(data.updatedAt)}</>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void load()} disabled={loading} style={{ ...card, padding: "8px 14px", cursor: "pointer" }}>{loading ? "Loading…" : "Refresh"}</button>
          <Link href="/admin/profile-maturing" style={{ ...card, padding: "8px 14px", textDecoration: "none" }}>Board →</Link>
        </div>
      </header>

      {error && <div style={{ ...card, borderColor: "#c0392b", color: "#ff6b6b" }}>{error}</div>}

      {data && (
        <>
          {/* Reconciliation summary */}
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
            <div style={card}><div style={{ opacity: 0.6, fontSize: 13 }}>Eligible</div><div style={{ fontSize: 30, fontWeight: 700 }}>{data.totals.eligible}</div><div style={{ fontSize: 12, opacity: 0.6 }}>construction + available + level-4</div></div>
            <div style={card}><div style={{ opacity: 0.6, fontSize: 13 }}>🔥 Maturing</div><div style={{ fontSize: 30, fontWeight: 700 }}>{data.totals.maturing}</div><div style={{ fontSize: 12, opacity: 0.6 }}>{data.totals.eligible ? Math.round((data.totals.maturing / data.totals.eligible) * 100) : 0}% of eligible</div></div>
            <div style={{ ...card, borderColor: data.totals.needsReview ? "#b45309" : undefined }}><div style={{ opacity: 0.6, fontSize: 13 }}>Needs review</div><div style={{ fontSize: 30, fontWeight: 700, color: data.totals.needsReview ? "#f59e0b" : undefined }}>{data.totals.needsReview}</div><div style={{ fontSize: 12, opacity: 0.6 }}>eligible but not maturing</div></div>
            <div style={card}><div style={{ opacity: 0.6, fontSize: 13 }}>Restricted</div><div style={{ fontSize: 30, fontWeight: 700, color: "#ff6b6b" }}>{data.restrictedCount}</div><div style={{ fontSize: 12, opacity: 0.6 }}><Link href="/admin/restrictions-v2" style={{ color: "inherit" }}>recovery queue →</Link></div></div>
          </section>

          {/* Per-bucket match table */}
          <section style={card}>
            <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Match by inventory bucket</h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Bucket</th><th style={th}>In inventory</th><th style={th}>🔥 Maturing</th><th style={th}>⚠️ Relogin</th><th style={th}>Start-failed</th><th style={th}>Not enrolled</th><th style={th}>Matched?</th></tr></thead>
              <tbody>
                {bucketKeys.map((k) => {
                  const b = data.buckets[k];
                  if (!b || (!b.total && k === "Pipeline")) return null;
                  const gap = b.stalled + b.startFailed + b.notEnrolled;
                  return (
                    <tr key={k}>
                      <td style={td}>{bucketLabel[k] || k}</td>
                      <td style={td}>{b.total}</td>
                      <td style={td}><b>{b.maturing}</b></td>
                      <td style={{ ...td, color: b.stalled ? "#f59e0b" : undefined }}>{b.stalled}</td>
                      <td style={{ ...td, color: b.startFailed ? "#f59e0b" : undefined }}>{b.startFailed}</td>
                      <td style={{ ...td, color: b.notEnrolled ? "#1a9ad6" : undefined }}>{b.notEnrolled}</td>
                      <td style={td}>{gap === 0 ? "✅ all maturing" : `⚠️ ${gap} to resolve`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* Needs review worklist */}
          <section style={card}>
            <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Needs review <span style={{ opacity: 0.5, fontWeight: 400 }}>({data.needsReview.length})</span></h2>
            {!data.needsReview.length && <p style={{ opacity: 0.6 }}>Nothing to review — every eligible account is maturing. 🎉</p>}
            {!!data.needsReview.length && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Reason</th><th style={th}>Account</th><th style={th}>Status</th><th style={th}>Conns</th><th style={th}>Detail</th><th style={th}>Since</th></tr></thead>
                <tbody>
                  {data.needsReview.map((r) => {
                    const rc = REASON[r.reason] || { label: r.reason, color: "#888" };
                    return (
                      <tr key={r.id}>
                        <td style={td}><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 12, background: rc.color + "22", color: rc.color, fontWeight: 600 }}>{rc.label}</span></td>
                        <td style={td}><Link href={`/admin/accounts/${r.id}`} style={{ fontWeight: 600 }}>{r.email || r.name}</Link>{r.level4 && <span style={{ marginLeft: 6, fontSize: 11, color: "#6d28d9", background: "#ede9fe", borderRadius: 999, padding: "1px 7px", fontWeight: 600 }}>Pipeline · L4</span>}<div style={{ fontSize: 12, opacity: 0.5 }}>{r.name}</div></td>
                        <td style={td}><span style={{ fontSize: 12, padding: "2px 7px", borderRadius: 6, background: "var(--chip,#1f1f1f)" }}>{r.status}</span></td>
                        <td style={td}>{r.connections ?? "—"}</td>
                        <td style={{ ...td, maxWidth: 320, opacity: 0.8 }}>{r.detail}{r.reason === "relogin" && (
                          <div style={{ marginTop: 6 }}>
                            <button onClick={() => void doRecheck(r.id)} disabled={recheck[r.id] === "…"} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border,#2a2a2a)", background: "var(--card,#141414)", cursor: "pointer", fontWeight: 600 }} title="Resume this account's parked campaign on the engine (use after you've logged it back in). If the login works it continues; if not it parks again.">⚡ Re-check / resume</button>
                            {recheck[r.id] && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75 }}>{recheck[r.id]}</span>}
                          </div>
                        )}</td>
                        <td style={td}>{ago(r.since)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {/* Healthy maturing (collapsed) */}
          <details style={card}>
            <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: 600 }}>🔥 Currently maturing ({data.maturing.length})</summary>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
              <thead><tr><th style={th}>Account</th><th style={th}>Bucket</th><th style={th}>Status</th><th style={th}>Started</th></tr></thead>
              <tbody>
                {data.maturing.map((r) => (
                  <tr key={r.id}>
                    <td style={td}><Link href={`/admin/accounts/${r.id}`}>{r.email || r.name}</Link>{r.detail !== "healthy" && <span style={{ marginLeft: 6, fontSize: 11, color: "#22c55e" }}>{r.detail}</span>}</td>
                    <td style={td}>{r.group}</td>
                    <td style={td}>{r.status}</td>
                    <td style={td}>{ago(r.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </main>
  );
}
