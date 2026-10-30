"use client";

// Unified Payouts console — ONE place to pay everyone: referral commissions + ambassador
// setup fees + monthlies, merged from both payout stores via /api/admin/payouts/unified.
// Two tabs: "Pay run" (everyone owed now, with the Wise send flow) and "Directory" (every
// payee + their full merged payment history). Translated from the "Payouts v2" design
// mockup onto the admin CSS-var theme tokens (dark/light) — no hardcoded mockup hex.
//
// Wise approve-&-send is behind WISE_SEND (off until the prepare/send routes + full-access
// token land); until then the page is the unified VIEW with amounts, states and history,
// and "ready" rows link to the manual pay flow.

import { useEffect, useMemo, useState } from "react";

const F_SANS = "var(--font-sans),system-ui,sans-serif";
const F_GRO = "var(--font-grotesk),system-ui,sans-serif";
const WISE_SEND = false; // flip on when /api/admin/payouts/wise/* + the token are live

type Kind = "referral" | "setup" | "monthly";
type State = "ready" | "upcoming" | "hold" | "needs_details" | "manual";

interface ReadyRow {
  id: string; kind: Kind; payeeKey: string; payeeName: string; payeeSub: string | null;
  referredBy: string | null; description: string; amount: number; currency: "PHP" | "USD";
  method: string | null; rail: "wallet" | "bank" | null; dueDate: string; overdue: boolean;
  state: State; holdReason: string | null; masked: string | null;
}
interface Payment { date: string | null; amount: number; kind: Kind; label: string; by: string | null; receipt: string | null; notified: boolean; acknowledged: boolean; }
interface Payee { key: string; name: string; sub: string | null; kinds: Kind[]; referredBy: string | null; method: string | null; rail: "wallet" | "bank" | null; totalPaid: number; lastPaidAt: string | null; masked: string | null; history: Payment[]; }

const money = (n: number, c: "PHP" | "USD" = "PHP") =>
  c === "USD" ? `$${(n || 0).toLocaleString()}` : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const KIND_LABEL: Record<Kind, string> = { referral: "Referral", setup: "Setup", monthly: "Monthly" };

const STATE_CHIP: Record<State, { bg: string; fg: string; label: string }> = {
  ready: { bg: "var(--st-active-bg,#e6f6ec)", fg: "var(--st-active-fg,#1a8a4a)", label: "Ready to pay" },
  upcoming: { bg: "var(--neutral-chip-bg,#eef0f3)", fg: "var(--neutral-chip-text,#5b6779)", label: "Upcoming" },
  hold: { bg: "var(--warn-badge-bg,#fef3e2)", fg: "var(--warn-badge-text,#b7791f)", label: "On hold" },
  needs_details: { bg: "var(--neutral-chip-bg,#eef0f3)", fg: "var(--neutral-chip-text,#5b6779)", label: "No payment details" },
  manual: { bg: "var(--blue-chip-bg,#eaf1ff)", fg: "var(--blue-chip-text,#2b5fd0)", label: "Not on Wise" },
};

function Pill({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return <span style={{ display: "inline-flex", font: `700 11.5px ${F_SANS}`, padding: "3px 10px", borderRadius: 999, background: bg, color: fg, whiteSpace: "nowrap" }}>{children}</span>;
}

export default function PayoutsPage() {
  const [data, setData] = useState<{ ready: ReadyRow[]; payees: Payee[] } | null>(null);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 0 80px" }}>
      <div style={{ maxWidth: 720 }}>
        <h1 style={{ font: `700 26px ${F_GRO}`, color: "var(--fg,#111)", margin: "0 0 4px", letterSpacing: "-.01em" }}>Payouts</h1>
        <p style={{ font: `500 14px/1.5 ${F_SANS}`, color: "var(--muted,#5b6779)", margin: 0 }}>
          Everyone we pay — referral commissions, setup fees and monthlies — in one place.
          {WISE_SEND ? <> Sending via Wise moves no money until you click <b style={{ color: "var(--fg,#111)" }}>Approve &amp; send</b>.</> : null}
        </p>
      </div>

      <div style={{ display: "flex", gap: 4, background: "var(--band,#eef0f3)", borderRadius: 999, padding: 3, alignSelf: "flex-start" }}>
        {([["run", "Pay run"], ["dir", "Directory"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            border: "none", cursor: "pointer", borderRadius: 999, padding: "7px 16px", font: `700 13px ${F_SANS}`,
            background: tab === k ? "var(--card,#fff)" : "transparent", color: tab === k ? "var(--fg,#111)" : "var(--muted,#5b6779)",
          }}>{label}</button>
        ))}
      </div>

      {err && <div style={{ padding: 16, borderRadius: 12, background: "var(--st-cancel-bg,#fdecea)", color: "var(--st-cancel-fg,#c0392b)", font: `600 13px ${F_SANS}` }}>Couldn’t load payouts: {err}</div>}
      {!data && !err && <div style={{ padding: 40, textAlign: "center", color: "var(--muted,#999)", font: `500 14px ${F_SANS}` }}>Loading…</div>}

      {data && tab === "run" && <PayRun rows={data.ready} />}
      {data && tab === "dir" && <Directory payees={data.payees} />}
    </div>
  );
}

// ── Pay run ─────────────────────────────────────────────────────────────
function PayRun({ rows }: { rows: ReadyRow[] }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [stateFilter, setStateFilter] = useState<State | null>(null);

  const stats = useMemo(() => {
    const by: Record<State, { count: number; total: number }> = {
      ready: { count: 0, total: 0 }, upcoming: { count: 0, total: 0 }, hold: { count: 0, total: 0 },
      needs_details: { count: 0, total: 0 }, manual: { count: 0, total: 0 },
    };
    for (const r of rows) { by[r.state].count++; by[r.state].total += r.amount; }
    return by;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (stateFilter && r.state !== stateFilter) return false;
      if (!needle) return true;
      return [r.payeeName, r.payeeSub, r.description, r.method, r.referredBy].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [rows, q, kind, stateFilter]);

  // Group by payee.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; sub: string | null; referredBy: string | null; rows: ReadyRow[]; total: number; currency: "PHP" | "USD" }>();
    for (const r of filtered) {
      let g = m.get(r.payeeKey);
      if (!g) { g = { key: r.payeeKey, name: r.payeeName, sub: r.payeeSub, referredBy: r.referredBy, rows: [], total: 0, currency: r.currency }; m.set(r.payeeKey, g); }
      g.rows.push(r);
      if (r.state === "ready") g.total += r.amount;
    }
    return [...m.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [filtered]);

  const STAT_ORDER: State[] = ["ready", "upcoming", "manual", "needs_details", "hold"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
        {STAT_ORDER.map((s) => {
          const active = stateFilter === s;
          const chip = STATE_CHIP[s];
          return (
            <button key={s} onClick={() => setStateFilter(active ? null : s)} style={{
              textAlign: "left", cursor: "pointer", background: "var(--card,#fff)", borderRadius: 14, padding: "12px 14px",
              border: `2px solid ${active ? chip.fg : "var(--border,#e3e6ec)"}`, display: "flex", flexDirection: "column", gap: 3,
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, font: `700 11px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: chip.fg }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: chip.fg }} />{chip.label}
              </span>
              <span style={{ font: `700 24px ${F_GRO}`, color: "var(--fg,#111)" }}>{stats[s].count}</span>
              <span style={{ font: `600 12px ${F_SANS}`, color: "var(--muted,#5b6779)" }}>{stats[s].total > 0 ? money(stats[s].total) : "—"}</span>
            </button>
          );
        })}
      </div>

      <div style={{ background: "var(--card,#fff)", border: "1px solid var(--border,#e3e6ec)", borderRadius: 14, padding: "12px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee, referrer, method, who it's for…" style={{ flex: 1, minWidth: 220, border: "1px solid var(--border,#dde1e8)", background: "var(--band,#f8f9fb)", borderRadius: 10, padding: "9px 12px", font: `500 13.5px ${F_SANS}`, color: "var(--fg,#111)", outline: "none" }} />
        <select value={kind} onChange={(e) => setKind(e.target.value as "all" | Kind)} style={{ border: "1px solid var(--border,#dde1e8)", background: "var(--card,#fff)", borderRadius: 10, padding: "9px 10px", font: `600 13px ${F_SANS}`, color: "var(--fg,#111)" }}>
          <option value="all">All payout types</option>
          <option value="referral">Referral</option>
          <option value="monthly">Monthly</option>
          <option value="setup">Setup</option>
        </select>
      </div>

      <div style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted,#5b6779)", margin: "0 4px" }}>
        <b style={{ color: "var(--fg,#111)", fontFamily: "var(--font-grotesk)" }}>{filtered.length}</b> payout{filtered.length === 1 ? "" : "s"} · {groups.length} payee{groups.length === 1 ? "" : "s"}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {groups.map((g) => <PayeeGroup key={g.key} g={g} />)}
        {groups.length === 0 && <div style={{ padding: 44, textAlign: "center", font: `500 13.5px ${F_SANS}`, color: "var(--muted,#5b6779)" }}>No payouts match these filters.</div>}
      </div>
    </div>
  );
}

function PayeeGroup({ g }: { g: { name: string; sub: string | null; referredBy: string | null; rows: ReadyRow[]; total: number } }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ background: "var(--card,#fff)", border: "1px solid var(--border,#e3e6ec)", borderRadius: 14, overflow: "hidden" }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", cursor: "pointer", background: "var(--band,#fafbfc)", borderBottom: open ? "1px solid var(--border,#eef0f4)" : "none" }}>
        <span style={{ font: `700 12px ${F_SANS}`, color: "var(--muted,#8a93a3)", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: `700 14px ${F_SANS}`, color: "var(--fg,#111)" }}>{g.name}</div>
          <div style={{ font: `500 12px ${F_SANS}`, color: "var(--muted,#8a93a3)" }}>{g.sub}{g.referredBy ? ` · ref by ${g.referredBy}` : ""}</div>
        </div>
        <span style={{ font: `700 11.5px ${F_SANS}`, color: "var(--muted,#5b6779)", background: "var(--band,#e9ecf1)", borderRadius: 999, padding: "1px 8px" }}>{g.rows.length}</span>
        <span style={{ marginLeft: "auto", font: `700 15px ${F_GRO}`, color: "var(--fg,#111)" }}>{g.total > 0 ? money(g.total) : "—"}</span>
      </div>
      {open && g.rows.map((r) => <PayoutRow key={r.id} r={r} />)}
    </div>
  );
}

function PayoutRow({ r }: { r: ReadyRow }) {
  const chip = STATE_CHIP[r.state];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "90px minmax(0,1.4fr) 110px minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border,#f0f1f4)" }}>
      <Pill bg="var(--neutral-chip-bg,#eef0f3)" fg="var(--neutral-chip-text,#5b6779)">{KIND_LABEL[r.kind]}</Pill>
      <div title={r.description} style={{ font: `500 13px ${F_SANS}`, color: "var(--fg,#3b4657)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description}</div>
      <div style={{ font: `700 15px ${F_GRO}`, color: "var(--fg,#111)", textAlign: "right" }}>{money(r.amount, r.currency)}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ font: `600 13px ${F_SANS}`, color: "var(--fg,#111)" }}>{r.method || "—"}</div>
        <div style={{ font: `500 12px ${F_GRO}`, color: "var(--muted,#8a93a3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.masked || ""}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end" }}>
        {r.overdue && r.state === "ready" && <Pill bg="var(--st-cancel-bg,#fdecea)" fg="var(--st-cancel-fg,#c0392b)">Overdue</Pill>}
        {r.state === "upcoming"
          ? <Pill bg={chip.bg} fg={chip.fg}>Due {fmtDate(r.dueDate)}</Pill>
          : r.state === "hold"
          ? <Pill bg={chip.bg} fg={chip.fg}>{r.holdReason ? `On hold · ${r.holdReason}` : "On hold"}</Pill>
          : <Pill bg={chip.bg} fg={chip.fg}>{chip.label}</Pill>}
        {r.state === "ready" && WISE_SEND && <button style={{ border: "none", background: "var(--fg,#0b1220)", color: "var(--card,#fff)", borderRadius: 8, padding: "7px 12px", font: `700 12.5px ${F_SANS}`, cursor: "pointer", whiteSpace: "nowrap" }}>Send via Wise</button>}
      </div>
    </div>
  );
}

// ── Directory ───────────────────────────────────────────────────────────
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
            {p.kinds.map((k) => <Pill key={k} bg="var(--neutral-chip-bg,#eef0f3)" fg="var(--neutral-chip-text,#5b6779)">{KIND_LABEL[k]}</Pill>)}
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
