"use client";

// Unified Payouts console — ONE place to pay everyone: referral commissions + ambassador
// setup fees + monthlies, merged from both payout stores via /api/admin/payouts/unified.
// Two tabs: "This pay run" (everyone owed + already-paid this cycle, with the Wise send
// flow) and "All payees" (every payee + their full merged payment history). Translated
// from the "Payouts v2" design mockup onto the admin CSS-var theme tokens (dark/light).
//
// Wise approve-&-send goes live when the full-access token is set (wiseEnabled from the
// API). Until then the Send buttons render but are inert.

import { useEffect, useMemo, useState } from "react";

const F_SANS = "var(--font-sans),system-ui,sans-serif";
const F_GRO = "var(--font-grotesk),system-ui,sans-serif";

type Kind = "referral" | "setup" | "monthly";
type State = "ready" | "upcoming" | "hold" | "needs_details" | "manual" | "paid";

interface Row {
  id: string; kind: Kind; payeeKey: string; payeeName: string; payeeSub: string | null;
  referredBy: string | null; description: string; amount: number; currency: "PHP" | "USD";
  method: string | null; rail: "wallet" | "bank" | null; dueDate: string; overdue: boolean;
  state: State; holdReason: string | null; masked: string | null;
  receipt: string | null; paidAt: string | null; confirmed: boolean; sentViaWise: boolean;
}
interface Payment { date: string | null; amount: number; kind: Kind; label: string; by: string | null; receipt: string | null; notified: boolean; acknowledged: boolean; }
interface Payee { key: string; name: string; sub: string | null; kinds: Kind[]; referredBy: string | null; method: string | null; totalPaid: number; lastPaidAt: string | null; masked: string | null; history: Payment[]; }
interface Feed { ready: Row[]; payees: Payee[]; wiseEnabled: boolean; }

const money = (n: number, c: "PHP" | "USD" = "PHP") =>
  c === "USD" ? `$${(n || 0).toLocaleString()}` : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const KIND_GROUP: { k: Kind; label: string; dot: string }[] = [
  { k: "referral", label: "Referral fees", dot: "var(--st-replied-fg,#7c5cff)" },
  { k: "monthly", label: "Monthly fees", dot: "var(--st-active-fg,#1a8a4a)" },
  { k: "setup", label: "Setup fees", dot: "var(--blue-chip-text,#2b5fd0)" },
];

function Pill({ bg, fg, children, title }: { bg: string; fg: string; children: React.ReactNode; title?: string }) {
  return <span title={title} style={{ display: "inline-flex", font: `700 11.5px ${F_SANS}`, padding: "3px 10px", borderRadius: 999, background: bg, color: fg, whiteSpace: "nowrap" }}>{children}</span>;
}

export default function PayoutsPage() {
  const [data, setData] = useState<Feed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"run" | "dir">("run");

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/payouts/unified")
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e.message || "Failed to load"); });
    return () => { alive = false; };
  }, []);

  const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 0 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 680 }}>
          <h1 style={{ font: `700 26px ${F_GRO}`, color: "var(--fg,#111)", margin: "0 0 4px", letterSpacing: "-.01em" }}>Payouts</h1>
          <p style={{ font: `500 14px/1.5 ${F_SANS}`, color: "var(--muted,#5b6779)", margin: 0 }}>
            Pay everyone from one place — referral commissions, setup fees and monthlies. A quote moves no money; nothing is sent until you click <b style={{ color: "var(--fg,#111)" }}>Approve &amp; send</b>.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 150 }}>
          <span style={{ font: `700 15px ${F_GRO}`, color: "var(--fg,#111)" }}>{monthLabel}</span>
          <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted,#8a93a3)" }}>Pay run · {today}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, background: "var(--band,#eef0f3)", borderRadius: 999, padding: 3, alignSelf: "flex-start" }}>
        {([["run", "This pay run", data?.ready.filter((r) => r.state !== "upcoming").length], ["dir", "All payees", data?.payees.length]] as const).map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            border: "none", cursor: "pointer", borderRadius: 999, padding: "7px 16px", font: `700 13px ${F_SANS}`, display: "flex", alignItems: "center", gap: 7,
            background: tab === k ? "var(--card,#fff)" : "transparent", color: tab === k ? "var(--fg,#111)" : "var(--muted,#5b6779)",
          }}>{label}{n != null && <span style={{ font: `700 11px ${F_GRO}`, color: "var(--muted,#5b6779)", background: "var(--card,#e9ecf1)", borderRadius: 999, padding: "1px 7px" }}>{n}</span>}</button>
        ))}
      </div>

      {err && <div style={{ padding: 16, borderRadius: 12, background: "var(--st-cancel-bg,#fdecea)", color: "var(--st-cancel-fg,#c0392b)", font: `600 13px ${F_SANS}` }}>Couldn’t load payouts: {err}</div>}
      {!data && !err && <div style={{ padding: 40, textAlign: "center", color: "var(--muted,#999)", font: `500 14px ${F_SANS}` }}>Loading…</div>}

      {data && tab === "run" && <PayRun rows={data.ready} wiseEnabled={data.wiseEnabled} />}
      {data && tab === "dir" && <Directory payees={data.payees} />}
    </div>
  );
}

// ── This pay run ────────────────────────────────────────────────────────
type Card = "owed" | "ready" | "sent" | "failed" | "cant";

function PayRun({ rows, wiseEnabled }: { rows: Row[]; wiseEnabled: boolean }) {
  const [q, setQ] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());

  // The pay run excludes not-yet-due (upcoming) items.
  const run = useMemo(() => rows.filter((r) => r.state !== "upcoming"), [rows]);

  const inCard = (r: Row, c: Card) => {
    if (c === "owed") return r.state === "ready" || r.state === "manual" || r.state === "needs_details" || r.state === "hold";
    if (c === "ready") return r.state === "ready";
    if (c === "sent") return r.state === "paid" && r.sentViaWise;
    if (c === "failed") return false; // live-send failures tracked once sending is on
    if (c === "cant") return r.state === "needs_details" || r.state === "manual" || r.state === "hold";
    return true;
  };

  const stats = useMemo(() => {
    const sum = (f: (r: Row) => boolean) => run.filter(f).reduce((s, r) => s + r.amount, 0);
    const cnt = (f: (r: Row) => boolean) => run.filter(f).length;
    return {
      owed: { total: sum((r) => inCard(r, "owed")), count: cnt((r) => inCard(r, "owed")) },
      ready: { total: sum((r) => inCard(r, "ready")), count: cnt((r) => inCard(r, "ready")) },
      sent: { total: sum((r) => inCard(r, "sent")), count: cnt((r) => inCard(r, "sent")) },
      failed: { total: 0, count: 0 },
      cant: { count: cnt((r) => inCard(r, "cant")), miss: cnt((r) => r.state === "needs_details"), man: cnt((r) => r.state === "manual"), hold: cnt((r) => r.state === "hold") },
    };
  }, [run]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return run.filter((r) => {
      if (card && !inCard(r, card)) return false;
      if (!needle) return true;
      return [r.payeeName, r.payeeSub, r.description, r.method, r.referredBy].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [run, q, card]);

  const groups = useMemo(() => KIND_GROUP.map((g) => {
    const gr = filtered.filter((r) => r.kind === g.k);
    return { ...g, rows: gr, total: gr.reduce((s, r) => s + r.amount, 0), sent: gr.filter((r) => r.state === "paid").length, ready: gr.filter((r) => r.state === "ready").length };
  }).filter((g) => g.rows.length > 0), [filtered]);

  const selectable = filtered.filter((r) => r.state === "ready");
  const selRows = selectable.filter((r) => sel.has(r.id));
  const selTotal = selRows.reduce((s, r) => s + r.amount, 0);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const CARDS: { c: Card; label: string; dot: string; fg: string; value: string; hint: string }[] = [
    { c: "owed", label: "Owed this cycle", dot: "var(--blue-chip-text,#2b5fd0)", fg: "var(--blue-chip-text,#2b5fd0)", value: money(stats.owed.total), hint: `${stats.owed.count} payout${stats.owed.count === 1 ? "" : "s"}` },
    { c: "ready", label: "Ready to send", dot: "var(--warn-badge-text,#b7791f)", fg: "var(--warn-badge-text,#b7791f)", value: money(stats.ready.total), hint: `${stats.ready.count} payout${stats.ready.count === 1 ? "" : "s"}` },
    { c: "sent", label: "Sent via Wise", dot: "var(--st-active-fg,#1a8a4a)", fg: "var(--st-active-fg,#1a8a4a)", value: money(stats.sent.total), hint: `${stats.sent.count} sent · receipts emailed` },
    { c: "failed", label: "Failed", dot: "var(--st-cancel-fg,#c0392b)", fg: "var(--st-cancel-fg,#c0392b)", value: money(stats.failed.total), hint: `${stats.failed.count} to retry` },
    { c: "cant", label: "Can’t send", dot: "var(--warn-badge-text,#b7791f)", fg: "var(--warn-badge-text,#b7791f)", value: String(stats.cant.count), hint: `${stats.cant.miss} missing details · ${stats.cant.man} manual · ${stats.cant.hold} on hold` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
        {CARDS.map((c) => {
          const active = card === c.c;
          return (
            <button key={c.c} onClick={() => setCard(active ? null : c.c)} style={{
              textAlign: "left", cursor: "pointer", background: "var(--card,#fff)", borderRadius: 14, padding: "12px 14px",
              border: `2px solid ${active ? c.fg : "var(--border,#e3e6ec)"}`, display: "flex", flexDirection: "column", gap: 4,
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, font: `700 11px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: c.fg }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot }} />{c.label}
              </span>
              <span style={{ font: `700 24px ${F_GRO}`, color: "var(--fg,#111)" }}>{c.value}</span>
              <span style={{ font: `600 12px/1.4 ${F_SANS}`, color: "var(--muted,#5b6779)" }}>{c.hint}</span>
            </button>
          );
        })}
      </div>

      <div style={{ background: "var(--card,#fff)", border: "1px solid var(--border,#e3e6ec)", borderRadius: 14, padding: "12px 14px" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, slug or method…" style={{ width: "100%", border: "1px solid var(--border,#dde1e8)", background: "var(--band,#f8f9fb)", borderRadius: 10, padding: "9px 12px", font: `500 13.5px ${F_SANS}`, color: "var(--fg,#111)", outline: "none" }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: selRows.length ? "var(--st-active-bg,#e6f6ec)" : "var(--card,#fff)", border: "1px solid var(--border,#e3e6ec)", borderRadius: 12, padding: "10px 12px 10px 16px" }}>
        <span style={{ flex: "1 1 300px", font: `${selRows.length ? "700 13.5px" : "500 12.5px"} ${F_SANS}`, color: selRows.length ? "var(--fg,#111)" : "var(--muted,#5b6779)" }}>
          {selRows.length ? <>Selected {selRows.length} · {money(selTotal)}<button onClick={() => setSel(new Set())} style={{ border: "none", background: "none", marginLeft: 12, font: `600 12px ${F_SANS}`, color: "var(--muted,#8a93a3)", cursor: "pointer" }}>Clear</button></> : "Tick payouts to send several at once, or send them one at a time from each row."}
        </span>
        <button disabled={!selRows.length || !wiseEnabled} title={!wiseEnabled ? "Wise sending switches on once the full-access token is added" : undefined}
          style={{ border: "none", borderRadius: 8, padding: "8px 14px", font: `700 12.5px ${F_SANS}`, whiteSpace: "nowrap", cursor: selRows.length && wiseEnabled ? "pointer" : "not-allowed", background: selRows.length && wiseEnabled ? "var(--st-active-fg,#12a150)" : "var(--band,#e3e6ec)", color: selRows.length && wiseEnabled ? "#fff" : "var(--muted,#8a93a3)" }}>
          Review &amp; send{selRows.length ? ` (${money(selTotal)})` : ""}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {groups.map((g) => (
          <div key={g.k} style={{ background: "var(--card,#fff)", border: "1px solid var(--border,#e3e6ec)", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", background: "var(--band,#fafbfc)", borderBottom: "1px solid var(--border,#eef0f4)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.dot }} />
              <span style={{ font: `700 13.5px ${F_SANS}`, color: "var(--fg,#111)" }}>{g.label}</span>
              <span style={{ font: `700 11.5px ${F_GRO}`, color: "var(--muted,#5b6779)", background: "var(--card,#e9ecf1)", borderRadius: 999, padding: "1px 8px" }}>{g.rows.length}</span>
              <span style={{ font: `500 12px ${F_SANS}`, color: "var(--muted,#8a93a3)" }}>{g.sent} sent · {g.ready} ready</span>
              <span style={{ marginLeft: "auto", font: `700 13.5px ${F_GRO}`, color: "var(--fg,#111)" }}>{money(g.total)}</span>
            </div>
            {g.rows.map((r) => <RunRow key={r.id} r={r} wiseEnabled={wiseEnabled} selected={sel.has(r.id)} onToggle={() => toggle(r.id)} />)}
          </div>
        ))}
        {groups.length === 0 && <div style={{ padding: 44, textAlign: "center", font: `500 13.5px ${F_SANS}`, color: "var(--muted,#5b6779)" }}>No payouts match these filters.</div>}
      </div>
    </div>
  );
}

function RunRow({ r, wiseEnabled, selected, onToggle }: { r: Row; wiseEnabled: boolean; selected: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1.1fr) minmax(0,1.3fr) 90px 140px 240px", gap: 12, alignItems: "center", padding: "11px 16px", borderTop: "1px solid var(--border,#f0f1f4)" }}>
      <div>
        {r.state === "ready" && <button onClick={onToggle} aria-label="select" style={{ width: 16, height: 16, borderRadius: 4, cursor: "pointer", border: `1.5px solid ${selected ? "var(--st-active-fg,#12a150)" : "var(--border,#c7ccd6)"}`, background: selected ? "var(--st-active-fg,#12a150)" : "var(--card,#fff)", color: "#fff", font: "800 10px/1 sans-serif", padding: 0, display: "grid", placeItems: "center" }}>{selected ? "✓" : ""}</button>}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ font: `700 13.5px ${F_SANS}`, color: "var(--fg,#111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.payeeName}</div>
        <div style={{ font: `500 12px ${F_SANS}`, color: "var(--muted,#8a93a3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.payeeSub}</div>
      </div>
      <div title={r.description} style={{ font: `500 13px ${F_SANS}`, color: "var(--fg,#3b4657)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description}</div>
      <div style={{ font: `700 15px ${F_GRO}`, color: "var(--fg,#111)", textAlign: "right" }}>{money(r.amount, r.currency)}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ font: `600 13px ${F_SANS}`, color: "var(--fg,#111)" }}>{r.method || "—"}</div>
        <div style={{ font: `500 12px ${F_GRO}`, color: "var(--muted,#8a93a3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.masked || ""}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0, overflow: "hidden" }}><WiseCell r={r} wiseEnabled={wiseEnabled} /></div>
    </div>
  );
}

function WiseCell({ r, wiseEnabled }: { r: Row; wiseEnabled: boolean }) {
  const link = { font: `700 12px ${F_SANS}`, color: "var(--link,#1d4ed8)" } as const;
  switch (r.state) {
    case "ready":
      return <>
        {r.overdue && <Pill bg="var(--st-cancel-bg,#fdecea)" fg="var(--st-cancel-fg,#c0392b)">Overdue</Pill>}
        <button disabled={!wiseEnabled} title={!wiseEnabled ? "Wise sending switches on once the full-access token is added" : undefined}
          style={{ border: "none", borderRadius: 8, padding: "7px 12px", font: `700 12.5px ${F_SANS}`, whiteSpace: "nowrap", cursor: wiseEnabled ? "pointer" : "not-allowed", background: wiseEnabled ? "var(--fg,#0b1220)" : "var(--band,#e3e6ec)", color: wiseEnabled ? "var(--card,#fff)" : "var(--muted,#8a93a3)" }}>
          Send {money(r.amount, r.currency)} via Wise
        </button>
      </>;
    case "paid":
      return <>
        <Pill bg="var(--st-active-bg,#e6f6ec)" fg="var(--st-active-fg,#1a8a4a)">Paid</Pill>
        {r.receipt && <a href={r.receipt} target="_blank" rel="noreferrer" style={link}>Receipt ↗</a>}
        {r.confirmed && <span style={{ font: `500 12px ${F_SANS}`, color: "var(--muted,#8a93a3)" }}>payee confirmed</span>}
      </>;
    case "needs_details":
      return <><Pill bg="var(--neutral-chip-bg,#eef0f3)" fg="var(--neutral-chip-text,#5b6779)">No payment details</Pill><a href="/admin/payouts-ii" style={link}>Add details →</a></>;
    case "manual":
      return <><Pill bg="var(--blue-chip-bg,#eaf1ff)" fg="var(--blue-chip-text,#2b5fd0)">Not on Wise</Pill><a href="/admin/payouts-ii" style={link}>Pay manually →</a></>;
    case "hold":
      return <>
        <Pill bg="var(--warn-badge-bg,#fef3e2)" fg="var(--warn-badge-text,#b7791f)">On hold</Pill>
        {r.holdReason && <span title={r.holdReason} style={{ font: `500 12px ${F_SANS}`, color: "var(--muted,#8a93a3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: "0 1 auto" }}>{r.holdReason}</span>}
      </>;
    default:
      return <Pill bg="var(--neutral-chip-bg,#eef0f3)" fg="var(--neutral-chip-text,#5b6779)">Due {fmtDate(r.dueDate)}</Pill>;
  }
}

// ── All payees ──────────────────────────────────────────────────────────
function Directory({ payees }: { payees: Payee[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return payees;
    return payees.filter((p) => [p.name, p.sub, p.referredBy, p.method].some((v) => v?.toLowerCase().includes(needle)));
  }, [payees, q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: "var(--card,#fff)", border: "1px solid var(--border,#e3e6ec)", borderRadius: 14, padding: "12px 14px" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any payee: name, email, slug, referrer, method…" style={{ width: "100%", border: "1px solid var(--border,#dde1e8)", background: "var(--band,#f8f9fb)", borderRadius: 10, padding: "9px 12px", font: `500 13.5px ${F_SANS}`, color: "var(--fg,#111)", outline: "none" }} />
      </div>
      <div style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted,#5b6779)", margin: "0 4px" }}>
        <b style={{ color: "var(--fg,#111)", fontFamily: "var(--font-grotesk)" }}>{filtered.length}</b> of {payees.length} payees · click a name for the payment record
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((p) => <PayeeCard key={p.key} p={p} />)}
        {filtered.length === 0 && <div style={{ padding: 44, textAlign: "center", font: `500 13.5px ${F_SANS}`, color: "var(--muted,#5b6779)" }}>No payees match.</div>}
      </div>
    </div>
  );
}

function PayeeCard({ p }: { p: Payee }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "var(--card,#fff)", border: "1px solid var(--border,#e3e6ec)", borderRadius: 14, overflow: "hidden" }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr) 160px 150px 110px", gap: 12, alignItems: "center", padding: "12px 16px", cursor: "pointer" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, font: `700 13.5px ${F_SANS}`, color: "var(--fg,#111)" }}>
            <span style={{ font: `700 12px ${F_SANS}`, color: "var(--muted,#8a93a3)", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
          </div>
          <div style={{ paddingLeft: 18, font: `500 12px ${F_SANS}`, color: "var(--muted,#8a93a3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.sub}</div>
        </div>
        <span style={{ font: `500 13px ${F_SANS}`, color: "var(--muted,#3b4657)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.referredBy || "—"}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: `600 13px ${F_SANS}`, color: "var(--fg,#111)" }}>{p.method || "—"}</div>
          <div style={{ font: `500 12px ${F_GRO}`, color: "var(--muted,#8a93a3)" }}>{p.masked || ""}</div>
        </div>
        <div style={{ font: `500 12px ${F_SANS}`, color: "var(--muted,#8a93a3)" }}>Last {fmtDate(p.lastPaidAt)}</div>
        <span style={{ font: `700 14px ${F_GRO}`, color: "var(--fg,#111)", textAlign: "right" }}>{money(p.totalPaid)}</span>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid var(--border,#eef0f4)", padding: 14 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {p.kinds.map((k) => <Pill key={k} bg="var(--neutral-chip-bg,#eef0f3)" fg="var(--neutral-chip-text,#5b6779)">{k === "referral" ? "Referral" : k === "setup" ? "Setup" : "Monthly"}</Pill>)}
          </div>
          {p.history.length === 0
            ? <div style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted,#8a93a3)" }}>No payments yet.</div>
            : (
              <div style={{ border: "1px solid var(--border,#eef0f4)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr) 90px 100px 110px", gap: 12, padding: "8px 12px", background: "var(--band,#fafbfc)", font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--muted,#8a93a3)" }}>
                  <span>Date</span><span>Payment</span><span>Proof</span><span>Notified</span><span>Acknowledged</span>
                </div>
                {p.history.map((h, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr) 90px 100px 110px", gap: 12, alignItems: "center", padding: "10px 12px", borderTop: "1px solid var(--border,#eef0f4)" }}>
                    <span style={{ font: `600 13px ${F_SANS}`, color: "var(--fg,#111)" }}>{fmtDate(h.date)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: `500 13px ${F_SANS}`, color: "var(--muted,#5b6779)" }}><b style={{ fontFamily: "var(--font-grotesk)", color: "var(--fg,#111)" }}>{money(h.amount)}</b> · {h.label}</div>
                      {h.by && <div style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted,#8a93a3)" }}>{h.by}</div>}
                    </div>
                    {h.receipt ? <a href={h.receipt} target="_blank" rel="noreferrer" style={{ font: `700 11.5px ${F_SANS}`, color: "var(--link,#1d4ed8)" }}>↗ Receipt</a> : <span style={{ color: "var(--muted,#c0c4cc)" }}>—</span>}
                    <Pill bg={h.notified ? "var(--st-active-bg,#e6f6ec)" : "var(--neutral-chip-bg,#eef0f3)"} fg={h.notified ? "var(--st-active-fg,#1a8a4a)" : "var(--neutral-chip-text,#5b6779)"}>{h.notified ? "Emailed" : "—"}</Pill>
                    <Pill bg={h.acknowledged ? "var(--st-active-bg,#e6f6ec)" : "var(--neutral-chip-bg,#eef0f3)"} fg={h.acknowledged ? "var(--st-active-fg,#1a8a4a)" : "var(--neutral-chip-text,#5b6779)"}>{h.acknowledged ? "Confirmed" : "—"}</Pill>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}
