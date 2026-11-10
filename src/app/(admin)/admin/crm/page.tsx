"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CRM v2 — "Contacts & Comms". The SALES / RELATIONSHIP lens over the unified
// crm_people overlay (same layer /admin/renters reads). Renters = renter-ops lens;
// CRM = lead → client → past lens. Both read /api/admin/renters, so notes, AI
// summaries and renter numbers stay in sync. Relationship + temperature are derived;
// PoC / next-step / follow-up / interest / value / direction / status pin persist
// to crm_people via PATCH. Timeline + composer use the shared conversation endpoint.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";

type Conv = { id: string; type: string; text: string; meta: string; author: string | null; ts: string };
type Call = { key: string; scheduledAt: string; cancelled: boolean };
type Person = {
  id: string; kind: "user" | "lead"; userId: string | null; leadId: string | null;
  name: string; email: string | null; channel: "WA" | "TG" | null; contact: string | null;
  role: string | null; source: string | null;
  pocOwner: "Ardi" | "Milee" | "Sam" | null; followUp: string | null;
  leadStage: "hot" | "warm" | "cold" | null; statusOverride: "renting" | "dormant" | null;
  nextStep: string | null; interest: string | null; dealValue: number | null; direction: "in" | "out" | null;
  routedAmbassador: boolean; routedReferrer: boolean; routedCrm: boolean;
  vetting: string; paymentMethod: "Card" | "Crypto Wallet" | null; paymentFailed: boolean;
  isTest: boolean; notes: string | null;
  liveRentals: number; totalRentals: number; autoRenewOn: number; mrr: number;
  paidTotal: number; discount: string | null;
  joinedAt: string; lastActivityAt: string;
  companyDomain: string | null;
  commsSummary: string | null; commsSummaryStale: boolean;
  calls: Call[];
  conversations: Conv[];
};

const F = "var(--font-sans),system-ui,sans-serif";
const G = "var(--font-grotesk),system-ui,sans-serif";

const POCS = ["Ardi", "Milee", "Sam"] as const;
const POC_COLOR: Record<string, string> = { Ardi: "var(--accent)", Milee: "var(--orange)", Sam: "var(--green)", Unassigned: "var(--neutral-dot)" };

type Rel = "lead" | "client" | "past";
const REL_LABEL: Record<Rel, string> = { lead: "Lead", client: "Client", past: "Past client" };
const relChip = (r: Rel) => r === "client"
  ? { bg: "var(--green-chip-bg)", fg: "var(--green-chip-text)", dot: "var(--green)" }
  : r === "lead" ? { bg: "var(--blue-chip-bg)", fg: "var(--blue-chip-text)", dot: "var(--accent)" }
  : { bg: "var(--neutral-chip-bg)", fg: "var(--neutral-chip-text)", dot: "var(--neutral-dot)" };

type Temp = "Hot" | "Warm" | "Cold";
const tempChip = (t: Temp) => t === "Hot"
  ? { bg: "var(--pri-p1-bg)", fg: "var(--pri-p1-fg)", dot: "var(--danger)" }
  : t === "Warm" ? { bg: "var(--warn-badge-bg)", fg: "var(--warn-badge-text)", dot: "var(--orange)" }
  : { bg: "var(--neutral-chip-bg)", fg: "var(--neutral-chip-text)", dot: "var(--neutral-dot)" };

// Conversation channel badge colours (reuse the shell's inbound palette).
const chChip = (type: string): { bg: string; fg: string } => {
  const t = (type || "").toLowerCase();
  if (t === "telegram") return { bg: "var(--pf-tg-bg)", fg: "var(--pf-tg-fg)" };
  if (t === "whatsapp") return { bg: "var(--st-new-bg)", fg: "var(--st-new-fg)" };
  if (t === "email") return { bg: "var(--st-replied-bg)", fg: "var(--st-replied-fg)" };
  if (t === "call") return { bg: "var(--blue-chip-bg)", fg: "var(--blue-chip-text)" };
  return { bg: "var(--tag-bg)", fg: "var(--tag-fg)" };
};
const convGroup = (type: string): "calls" | "msgs" | "notes" => {
  const t = (type || "").toLowerCase();
  if (t === "call") return "calls";
  if (t === "whatsapp" || t === "telegram" || t === "email") return "msgs";
  return "notes";
};

const ENTRY_TYPES = ["Note", "Call", "Email", "WhatsApp", "Telegram"] as const;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = 86_400_000;
const fmtDay = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return `${MON[d.getMonth()]} ${d.getDate()}`; };
const fmtFull = (iso: string | null) => { if (!iso) return "—"; const d = new Date(iso); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`; };
const dInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
const initials = (n: string) => (n || "?").replace(/[@"()]/g, "").trim().charAt(0).toUpperCase() || "?";
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / day);
const lastTouch = (iso: string) => { const n = daysSince(iso); return n <= 0 ? "Today" : n === 1 ? "Yesterday" : `${n}d ago`; };

export default function CrmPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "table">("list");
  const [rel, setRel] = useState<"all" | Rel>("all");
  const [temp, setTemp] = useState<"all" | Temp>("all");
  const [poc, setPoc] = useState<string>("all");
  const [dir, setDir] = useState<"all" | "in" | "out">("all");
  const [due, setDue] = useState(false);
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<string>("Note");
  const [entryText, setEntryText] = useState("");
  const [tlTab, setTlTab] = useState<"all" | "calls" | "msgs" | "notes">("all");
  const [summarising, setSummarising] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", pocOwner: "" });
  const entryLock = useRef(false);

  const load = () =>
    fetch("/api/admin/renters")
      .then(async (r) => { if (!r.ok) throw new Error("Could not load contacts."); return r.json(); })
      .then((d) => setPeople((d.people || []) as Person[]))
      .catch(() => setError("Could not load contacts. Please refresh."))
      .finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ── derivations ──
  const relationship = (p: Person): Rel => {
    if (p.liveRentals > 0 || p.statusOverride === "renting") return "client";
    if (p.totalRentals > 0 || p.statusOverride === "dormant") return "past";
    return "lead";
  };
  const upcomingCall = (p: Person) => p.calls.some((c) => !c.cancelled && new Date(c.scheduledAt).getTime() > Date.now());
  const autoTemp = (p: Person): Temp => {
    if (upcomingCall(p) || daysSince(p.lastActivityAt) <= 3) return "Hot";
    return daysSince(p.lastActivityAt) <= 14 ? "Warm" : "Cold";
  };
  const temperature = (p: Person): Temp => {
    const o = p.leadStage;
    if (o === "hot") return "Hot"; if (o === "warm") return "Warm"; if (o === "cold") return "Cold";
    return autoTemp(p);
  };
  const dueDays = (p: Person) => (p.followUp ? Math.round((new Date(p.followUp).getTime() - Date.now()) / day) : null);
  const isDue = (p: Person) => !!p.nextStep && p.followUp != null && (dueDays(p) ?? 1) <= 0;

  // Sales lens: drop test rows and leads triaged purely to Ambassador/Referrer.
  const base = useMemo(() => people.filter((p) => {
    if (p.isTest) return false;
    if (p.kind === "lead" && !p.userId && (p.routedAmbassador || p.routedReferrer) && !p.routedCrm) return false;
    return true;
  }), [people]);

  const counts = useMemo(() => {
    const c = { all: base.length, lead: 0, client: 0, past: 0, Hot: 0, Warm: 0, Cold: 0, due: 0 } as Record<string, number>;
    for (const p of base) { c[relationship(p)]++; c[temperature(p)]++; if (isDue(p)) c.due++; }
    return c;
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [base]);
  const pocCount = (k: string) => base.filter((p) => (p.pocOwner || "Unassigned") === k).length;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return base
      .filter((p) => {
        if (rel !== "all" && relationship(p) !== rel) return false;
        if (temp !== "all" && temperature(p) !== temp) return false;
        if (poc !== "all" && (p.pocOwner || "Unassigned") !== poc) return false;
        if (dir !== "all" && p.direction !== dir) return false;
        if (due && !isDue(p)) return false;
        if (needle) {
          const hay = `${p.name} ${p.email || ""} ${p.companyDomain || ""} ${p.contact || ""} ${p.interest || ""} ${p.nextStep || ""} ${p.conversations.map((e) => e.text).join(" ")}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [base, rel, temp, poc, dir, due, q]);

  useEffect(() => { if (!loading && (!selId || !rows.some((p) => p.id === selId))) setSelId(rows[0]?.id ?? null); }, [rows, loading, selId]);
  const cur = useMemo(() => people.find((p) => p.id === selId) || null, [people, selId]);

  // ── mutations ──
  const patchLocal = (id: string, body: Partial<Person>) => setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...body } : p)));
  const patch = async (id: string, body: Record<string, unknown>) => {
    patchLocal(id, body as Partial<Person>);
    setError(null);
    try {
      const r = await fetch("/api/admin/renters", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
      if (!r.ok) throw new Error();
    } catch { setError("Could not save that change. Reloading…"); load(); }
  };

  const addEntry = async (p: Person) => {
    const text = entryText.trim();
    if (!text || entryLock.current) return;
    entryLock.current = true; setBusy(p.id); setError(null);
    try {
      const r = await fetch("/api/admin/renters/conversation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: p.id, type: entryType, text }) });
      const d = await r.json();
      if (!r.ok || !d.conversation) throw new Error(d.error || "Could not save the entry.");
      patchLocal(p.id, { conversations: [d.conversation, ...p.conversations], lastActivityAt: d.conversation.ts, commsSummaryStale: !!p.leadId });
      setEntryText("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the entry."); }
    finally { entryLock.current = false; setBusy(null); }
  };

  const regenSummary = async (p: Person) => {
    if (!p.leadId || summarising) return;
    setSummarising(true); setError(null);
    try {
      const r = await fetch("/api/admin/inbound/summarise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: p.leadId, force: true }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not summarise.");
      patchLocal(p.id, { commsSummary: d.summary || null, commsSummaryStale: false });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not summarise."); }
    finally { setSummarising(false); }
  };

  const addContact = async () => {
    if (!form.name.trim()) return;
    setBusy("new"); setError(null);
    try {
      const r = await fetch("/api/admin/renters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name.trim(), email: form.email.trim() || null, pocOwner: form.pocOwner || null, leadStage: "warm" }) });
      const d = await r.json();
      if (!r.ok) throw new Error();
      setForm({ name: "", email: "", pocOwner: "" }); setAdding(false);
      await load();
      if (d.id) { setSelId(d.id); setDrawer(true); }
    } catch { setError("Could not add the contact."); }
    finally { setBusy(null); }
  };

  const openPerson = (id: string) => { setSelId(id); setDrawer(true); setTlTab("all"); setEntryText(""); };

  // ── style atoms ──
  const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 14, boxShadow: "var(--card-shadow)" };
  const input: React.CSSProperties = { font: `500 13px ${F}`, color: "var(--input-fg)", background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 9, padding: "8px 11px", outline: "none" };
  const micro: React.CSSProperties = { font: `700 10px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--label)" };
  const pill = (active: boolean): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", font: `600 12.5px ${F}`, color: active ? "#fff" : "var(--text)", background: active ? "var(--accent)" : "var(--card)", border: `1px solid ${active ? "var(--accent)" : "var(--card-border)"}`, borderRadius: 999, padding: "5px 12px", whiteSpace: "nowrap" });
  const count = (active: boolean): React.CSSProperties => ({ font: `700 11px ${G}`, color: active ? "#fff" : "var(--faint-num)", marginLeft: 1 });

  return (
    <div style={{ font: `400 14px ${F}`, color: "var(--text)" }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ maxWidth: 720 }}>
          <h1 style={{ font: `700 28px ${G}`, letterSpacing: "-.01em", margin: "0 0 5px", color: "var(--text)" }}>Contacts &amp; Comms</h1>
          <p style={{ font: `500 13.5px/1.5 ${F}`, color: "var(--muted)", margin: 0 }}>Every lead and client in one place — pipeline, next steps and a full conversation history. The same people and notes as Renters; this is the sales lens.</p>
        </div>
        <button onClick={() => setAdding((v) => !v)} style={{ font: `700 12.5px ${F}`, color: "#fff", background: "var(--btn-primary-bg)", border: "none", borderRadius: 10, padding: "10px 15px", cursor: "pointer", whiteSpace: "nowrap" }}>{adding ? "Cancel" : "+ Add contact"}</button>
      </div>

      {error && <p role="alert" style={{ color: "var(--delete-color)", font: `600 13px ${F}` }}>{error}</p>}

      {adding && (
        <div style={{ ...card, padding: 14, marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...input, flex: "1 1 180px" }} />
          <input placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ ...input, flex: "1 1 180px" }} />
          <select aria-label="PoC owner" value={form.pocOwner} onChange={(e) => setForm({ ...form, pocOwner: e.target.value })} style={input}>
            <option value="">Unassigned PoC</option>{POCS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button onClick={addContact} disabled={busy === "new" || !form.name.trim()} style={{ font: `700 12.5px ${F}`, color: "#fff", background: "var(--green)", border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", opacity: form.name.trim() ? 1 : 0.5 }}>Save</button>
        </div>
      )}

      {/* filter bar */}
      <div style={{ ...card, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {([["all", "All"], ["lead", "Leads"], ["client", "Clients"], ["past", "Past clients"]] as const).map(([k, l]) => {
            const active = rel === k; const c = k === "all" ? null : relChip(k as Rel);
            return (
              <button key={k} onClick={() => setRel(k)} style={pill(active)}>
                {c && <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot }} />}{l}
                <span style={count(active)}>{counts[k] ?? 0}</span>
              </button>
            );
          })}
          <span style={{ width: 1, height: 22, background: "var(--divider)", margin: "0 2px" }} />
          {(["Hot", "Warm", "Cold"] as const).map((k) => {
            const active = temp === k; const c = tempChip(k);
            return (
              <button key={k} onClick={() => setTemp(active ? "all" : k)} style={{ ...pill(active), ...(active ? { background: c.fg, borderColor: c.fg } : {}) }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: active ? "#fff" : c.dot }} />{k}
                <span style={count(active)}>{counts[k] ?? 0}</span>
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", background: "var(--seg-bg)", border: "1px solid var(--seg-border)", borderRadius: 10, padding: 3, gap: 2 }}>
            {(["list", "table"] as const).map((v) => (
              <button key={v} onClick={() => { setView(v); setDrawer(false); }} style={{ border: "none", cursor: "pointer", borderRadius: 7, padding: "6px 12px", font: `700 12.5px ${F}`, background: view === v ? "var(--accent)" : "transparent", color: view === v ? "#fff" : "var(--muted)" }}>{v === "list" ? "List + detail" : "Table"}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--divider)", paddingTop: 10 }}>
          <span style={{ ...micro, marginRight: 2 }}>PoC</span>
          {["all", ...POCS, "Unassigned"].map((k) => {
            const active = poc === k;
            return (
              <button key={k} onClick={() => setPoc(k)} style={{ ...pill(active), paddingLeft: k === "all" ? 12 : 5 }}>
                {k !== "all" && <span style={{ width: 20, height: 20, borderRadius: "50%", background: POC_COLOR[k] || "var(--neutral-dot)", color: "#fff", font: `700 9px ${F}`, display: "grid", placeItems: "center" }}>{k[0]}</span>}
                {k === "all" ? "All" : k}<span style={count(active)}>{k === "all" ? base.length : pocCount(k)}</span>
              </button>
            );
          })}
          <span style={{ width: 1, height: 22, background: "var(--divider)", margin: "0 2px" }} />
          <button onClick={() => setDue((v) => !v)} style={{ ...pill(due), ...(due ? { background: "var(--danger)", borderColor: "var(--danger)" } : {}) }}>
            Follow-up due<span style={{ font: `700 11px ${G}`, background: "var(--pri-p1-bg)", color: "var(--pri-p1-fg)", borderRadius: 999, padding: "1px 7px", marginLeft: 1 }}>{counts.due}</span>
          </button>
          <select aria-label="Direction" value={dir} onChange={(e) => setDir(e.target.value as typeof dir)} style={input}>
            <option value="all">Inbound + outbound</option><option value="in">Inbound only</option><option value="out">Outbound only</option>
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, email or message…" style={{ ...input, flex: 1, minWidth: 220 }} />
        </div>
      </div>

      {/* master / detail */}
      <div style={{ display: "grid", gridTemplateColumns: view === "list" ? "minmax(320px,380px) minmax(0,1fr)" : "minmax(0,1fr)", gap: 16, alignItems: "start" }}>

        {view === "list" ? (
          <div style={{ ...card, overflow: "hidden", position: "sticky", top: 16, maxHeight: "calc(100vh - 40px)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "11px 16px", borderBottom: "1px solid var(--divider)", display: "flex", justifyContent: "space-between", ...micro }}><span>{rows.length} contacts</span><span>Last touch</span></div>
            <div style={{ overflowY: "auto" }}>{renderList()}</div>
          </div>
        ) : (
          <div style={{ ...card, overflowX: "auto" }}>
            <div style={{ minWidth: 1020 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.6fr) 110px 86px minmax(170px,1.3fr) minmax(190px,1.4fr) 140px 44px", gap: 14, padding: "11px 18px", borderBottom: "1px solid var(--divider)", ...micro }}>
                <span>{rows.length} contacts</span><span>Relationship</span><span>Temp</span><span>Interest</span><span>Next step</span><span>Last touch</span><span>PoC</span>
              </div>
              {renderTable()}
            </div>
          </div>
        )}

        {view === "list" && <div style={{ ...card, overflow: "hidden", minHeight: 440 }}>{renderDetail(false)}</div>}
      </div>

      {/* table drawer */}
      {view === "table" && drawer && cur && (
        <>
          <div onClick={() => setDrawer(false)} style={{ position: "fixed", inset: 0, background: "rgba(8,11,18,.42)", zIndex: 40 }} />
          <div style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: "min(760px,100vw)", zIndex: 50, overflowY: "auto", background: "var(--card)", borderLeft: "1px solid var(--card-border)", boxShadow: "-12px 0 40px rgba(8,11,18,.3)" }}>{renderDetail(true)}</div>
        </>
      )}
    </div>
  );

  // ── list rows ──
  function renderList() {
    if (loading) return [0, 1, 2, 3, 4].map((i) => <div key={i} style={{ height: 70, borderBottom: "1px solid var(--divider)", background: "var(--band)" }} />);
    if (!rows.length) return <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--muted)", font: `500 13px ${F}` }}>No contacts in this view.</div>;
    return rows.map((p) => {
      const r = relationship(p), t = temperature(p), rc = relChip(r), on = cur?.id === p.id;
      const last = p.conversations[0];
      return (
        <div key={p.id} onClick={() => setSelId(p.id)} style={{ display: "flex", gap: 11, padding: "12px 16px", borderBottom: "1px solid var(--divider)", cursor: "pointer", background: on ? "var(--row-selected-bg)" : "transparent", boxShadow: on ? "inset 3px 0 0 var(--accent)" : "none" }}>
          <span style={{ flex: "none", width: 34, height: 34, borderRadius: 10, background: "var(--avatar-bg)", color: "var(--avatar-fg)", display: "grid", placeItems: "center", font: `700 13px ${G}` }}>{initials(p.name)}</span>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ font: `700 14px ${F}`, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
              <span style={{ flex: "none", font: `700 10px ${F}`, padding: "2px 8px", borderRadius: 999, background: rc.bg, color: rc.fg }}>{REL_LABEL[r]}</span>
              <span style={{ flex: 1 }} />
              <span style={{ flex: "none", font: `500 11.5px ${F}`, color: "var(--muted2)", whiteSpace: "nowrap" }}>{lastTouch(p.lastActivityAt)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              {last && <span style={{ flex: "none", font: `700 9.5px ${F}`, letterSpacing: ".04em", textTransform: "uppercase", padding: "2px 5px", borderRadius: 4, ...chChip(last.type) }}>{last.type}</span>}
              <span style={{ font: `500 12.5px ${F}`, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{last?.text || p.email || "No messages yet"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, font: `600 11.5px ${F}`, color: "var(--muted)", minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, flex: "none" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: tempChip(t).dot }} />{t}</span>
              {p.nextStep && <span style={{ color: isDue(p) ? "var(--danger)" : "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>→ {p.nextStep}</span>}
              <span style={{ flex: 1 }} />
              <span title={p.pocOwner || "Unassigned"} style={{ flex: "none", width: 18, height: 18, borderRadius: "50%", background: POC_COLOR[p.pocOwner || "Unassigned"], color: "#fff", display: "grid", placeItems: "center", font: `700 8.5px ${F}` }}>{(p.pocOwner || "U")[0]}</span>
            </div>
          </div>
        </div>
      );
    });
  }

  // ── table rows ──
  function renderTable() {
    if (loading) return [0, 1, 2, 3, 4].map((i) => <div key={i} style={{ height: 56, borderBottom: "1px solid var(--divider)", background: "var(--band)" }} />);
    if (!rows.length) return <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--muted)", font: `500 13px ${F}` }}>No contacts in this view.</div>;
    return rows.map((p) => {
      const r = relationship(p), t = temperature(p), rc = relChip(r), on = cur?.id === p.id && drawer;
      return (
        <div key={p.id} onClick={() => openPerson(p.id)} style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.6fr) 110px 86px minmax(170px,1.3fr) minmax(190px,1.4fr) 140px 44px", gap: 14, alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--divider)", cursor: "pointer", background: on ? "var(--row-selected-bg)" : "transparent", boxShadow: on ? "inset 3px 0 0 var(--accent)" : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ flex: "none", width: 30, height: 30, borderRadius: 9, background: "var(--avatar-bg)", color: "var(--avatar-fg)", display: "grid", placeItems: "center", font: `700 12px ${G}` }}>{initials(p.name)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: `700 14px ${F}`, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
              <div style={{ font: `500 12px ${F}`, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[p.companyDomain, p.email || p.contact].filter(Boolean).join(" · ") || "—"}</div>
            </div>
          </div>
          <span><span style={{ font: `700 11px ${F}`, padding: "3px 9px", borderRadius: 999, background: rc.bg, color: rc.fg, whiteSpace: "nowrap" }}>{REL_LABEL[r]}</span></span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, font: `600 12.5px ${F}`, color: "var(--text2)" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: tempChip(t).dot }} />{t}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ font: `600 12.5px ${F}`, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.interest || "—"}</div>
            <div style={{ font: `600 11.5px ${G}`, color: "var(--muted)" }}>{p.liveRentals > 0 ? `${money(p.mrr)}/mo` : p.dealValue ? `${money(p.dealValue)}/mo pot.` : ""}</div>
          </div>
          <span style={{ font: `600 12.5px ${F}`, color: p.nextStep && isDue(p) ? "var(--danger)" : "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.nextStep || "No next step"}</span>
          <span style={{ font: `500 12.5px ${F}`, color: "var(--muted)", whiteSpace: "nowrap" }}>{lastTouch(p.lastActivityAt)}</span>
          <span title={p.pocOwner || "Unassigned"} style={{ width: 24, height: 24, borderRadius: "50%", background: POC_COLOR[p.pocOwner || "Unassigned"], color: "#fff", display: "grid", placeItems: "center", font: `700 10px ${F}` }}>{(p.pocOwner || "U")[0]}</span>
        </div>
      );
    });
  }

  // ── detail ──
  function renderDetail(inDrawer: boolean) {
    const p = cur;
    if (!p) return <div style={{ display: "grid", placeItems: "center", height: 440, color: "var(--muted)", font: `500 14px ${F}` }}>Select a contact to view their history.</div>;
    const r = relationship(p), t = temperature(p), rc = relChip(r), tc = tempChip(t);
    const dd = dueDays(p);
    const isClient = p.liveRentals > 0 || p.totalRentals > 0 || !!p.userId;
    const tl = tlTab === "all" ? p.conversations : p.conversations.filter((e) => convGroup(e.type) === tlTab);
    const tabN = (k: "all" | "calls" | "msgs" | "notes") => (k === "all" ? p.conversations.length : p.conversations.filter((e) => convGroup(e.type) === k).length);
    const sorted = [...p.calls].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
    const metaSel: React.CSSProperties = { ...input, width: "100%", padding: "7px 9px", fontWeight: 600 };
    const openInRenters = `/admin/renters?q=${encodeURIComponent(p.email || p.name)}`;

    return (
      <>
        {/* header */}
        <div style={{ padding: "20px 22px", display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap", borderBottom: "1px solid var(--divider)" }}>
          <span style={{ flex: "none", width: 50, height: 50, borderRadius: 14, background: "var(--avatar-bg)", color: "var(--avatar-fg)", display: "grid", placeItems: "center", font: `700 20px ${G}` }}>{initials(p.name)}</span>
          <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ font: `700 21px ${G}`, letterSpacing: "-.01em", color: "var(--text)" }}>{p.name}</span>
              {p.companyDomain && <span style={{ font: `600 12px ${F}`, color: "var(--text2)", background: "var(--tag-bg)", borderRadius: 6, padding: "2px 8px" }}>{p.companyDomain}</span>}
              <span style={{ font: `700 11px ${F}`, padding: "3px 9px", borderRadius: 999, background: rc.bg, color: rc.fg }}>{REL_LABEL[r]}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, font: `700 11px ${F}`, padding: "3px 9px", borderRadius: 999, background: tc.bg, color: tc.fg }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: tc.dot }} />{t}{p.leadStage ? " · set" : ""}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {p.email && <span style={{ font: `500 12.5px ${F}`, color: "var(--text2)", border: "1px solid var(--card-border)", borderRadius: 999, padding: "3px 10px" }}>{p.email}</span>}
              {p.contact && <span style={{ font: `500 12.5px ${F}`, color: "var(--text2)", border: "1px solid var(--card-border)", borderRadius: 999, padding: "3px 10px" }}>{p.channel === "TG" ? "TG " : p.channel === "WA" ? "WA " : ""}{p.contact}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {isClient && <a href={openInRenters} style={{ font: `700 12.5px ${F}`, color: "var(--link)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "8px 12px", textDecoration: "none", whiteSpace: "nowrap" }}>Open in Renters →</a>}
            {inDrawer && <button onClick={() => setDrawer(false)} style={{ border: "1px solid var(--card-border)", background: "var(--card)", borderRadius: 10, width: 34, height: 34, font: `700 15px ${F}`, color: "var(--muted)", cursor: "pointer" }}>×</button>}
          </div>
        </div>

        {/* meta grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", borderBottom: "1px solid var(--divider)" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, padding: "13px 20px", borderRight: "1px solid var(--divider)" }}>
            <span style={micro}>Status</span>
            <select value={p.statusOverride || "auto"} onChange={(e) => patch(p.id, { statusOverride: e.target.value === "auto" ? "" : e.target.value })} style={metaSel}>
              <option value="auto">Auto · {REL_LABEL[r]}</option><option value="renting">Pin: Client (renting)</option><option value="dormant">Pin: Past (dormant)</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, padding: "13px 20px", borderRight: "1px solid var(--divider)" }}>
            <span style={micro}>Temperature</span>
            <select value={p.leadStage || "auto"} onChange={(e) => patch(p.id, { leadStage: e.target.value === "auto" ? "" : e.target.value })} style={metaSel}>
              <option value="auto">Auto · {autoTemp(p)}</option><option value="hot">Hot (set)</option><option value="warm">Warm (set)</option><option value="cold">Cold (set)</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, padding: "13px 20px", borderRight: "1px solid var(--divider)" }}>
            <span style={micro}>PoC owner</span>
            <select value={p.pocOwner || ""} onChange={(e) => patch(p.id, { pocOwner: e.target.value })} style={metaSel}>
              <option value="">Unassigned</option>{POCS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, padding: "13px 20px" }}>
            <span style={micro}>Direction</span>
            <select value={p.direction || ""} onChange={(e) => patch(p.id, { direction: e.target.value })} style={metaSel}>
              <option value="">— not set —</option><option value="in">Inbound</option><option value="out">Outbound</option>
            </select>
          </label>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* cards: next step / calls / interest */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <div style={{ border: `1px solid ${p.nextStep && dd != null && dd < 0 ? "var(--danger-border)" : "var(--card-border)"}`, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={micro}>Next step</span>
                <span style={{ font: `700 11.5px ${F}`, color: dd != null && dd < 0 ? "var(--danger)" : "var(--muted)" }}>{p.followUp ? (dd != null && dd < 0 ? `Overdue · ${fmtDay(p.followUp)}` : dd === 0 ? "Due today" : `Due ${fmtDay(p.followUp)}`) : "No date"}</span>
              </div>
              <textarea rows={2} defaultValue={p.nextStep || ""} key={`ns-${p.id}`} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.nextStep || "")) patch(p.id, { nextStep: v }); }} placeholder="What happens next?" style={{ ...input, resize: "none", border: "none", background: "transparent", padding: 0, font: `600 13.5px/1.4 ${F}` }} />
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="date" value={dInput(p.followUp)} onChange={(e) => patch(p.id, { followUp: e.target.value || null })} style={{ ...input, flex: 1, padding: "5px 8px" }} />
                <button onClick={() => patch(p.id, { nextStep: "", followUp: null })} style={{ border: "1px solid var(--card-border)", background: "var(--st-new-bg)", color: "var(--st-new-fg)", borderRadius: 8, padding: "6px 10px", font: `700 12px ${F}`, cursor: "pointer" }}>Done</button>
              </div>
            </div>

            <div style={{ border: "1px solid var(--card-border)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={micro}>Calls</span>
              {sorted.length === 0 ? <span style={{ font: `500 12.5px ${F}`, color: "var(--muted2)" }}>No calls booked.</span> : sorted.slice(0, 3).map((c) => {
                const up = !c.cancelled && new Date(c.scheduledAt).getTime() > Date.now();
                return (
                  <div key={c.key} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                    <span style={{ flex: "none", marginTop: 4, width: 8, height: 8, borderRadius: "50%", border: `2px solid ${up ? "var(--accent)" : "var(--green)"}`, background: up ? "var(--accent)" : "transparent" }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: `700 13px ${F}`, color: "var(--text)" }}>{up ? "Upcoming" : "Call"}{c.cancelled ? " · cancelled" : ""}</div>
                      <div style={{ font: `500 12px ${F}`, color: up ? "var(--link)" : "var(--muted)" }}>{fmtFull(c.scheduledAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ border: "1px solid var(--card-border)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={micro}>Interested in</span>
              <textarea rows={2} defaultValue={p.interest || ""} key={`int-${p.id}`} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.interest || "")) patch(p.id, { interest: v }); }} placeholder="What do they want to rent?" style={{ ...input, resize: "none", border: "none", background: "transparent", padding: 0, font: `600 13.5px/1.4 ${F}` }} />
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ font: `500 12px ${F}`, color: "var(--muted2)" }}>$/mo potential</span>
                <input type="number" min={0} defaultValue={p.dealValue ?? ""} key={`dv-${p.id}`} onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== p.dealValue) patch(p.id, { dealValue: v }); }} placeholder="—" style={{ ...input, width: 90, padding: "4px 8px", font: `700 13px ${G}` }} />
              </div>
            </div>
          </div>

          {/* from renters */}
          {isClient && (
            <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", background: "var(--band)", border: "1px solid var(--card-border)", borderRadius: 12, padding: "12px 16px" }}>
              <span style={micro}>From Renters</span>
              <Stat n={`${p.liveRentals}`} sub={`of ${p.totalRentals}`} label="Live accounts" />
              <Stat n={money(p.mrr)} label="Per month" />
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ font: `700 11.5px ${F}`, padding: "3px 9px", borderRadius: 999, alignSelf: "flex-start", whiteSpace: "nowrap", background: p.paymentFailed ? "var(--pri-p1-bg)" : p.paymentMethod === "Crypto Wallet" ? "var(--pay-crypto-bg)" : "var(--pay-card-bg)", color: p.paymentFailed ? "var(--pri-p1-fg)" : p.paymentMethod === "Crypto Wallet" ? "var(--pay-crypto-fg)" : "var(--pay-card-fg)" }}>{p.paymentFailed ? "Payment failed" : p.paymentMethod || "No payment yet"}</span>
                <span style={{ font: `600 11.5px ${F}`, color: "var(--muted)" }}>Payment</span>
              </div>
              <Stat n={fmtDay(p.joinedAt)} label={r === "client" ? "Client since" : "Since"} />
            </div>
          )}

          {/* AI summary */}
          {p.leadId && p.conversations.length > 0 && (
            <div style={{ border: "1px solid var(--chip-active-border)", background: "var(--link-bg)", borderRadius: 12, padding: "13px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ ...micro, color: "var(--link)" }}>Summary</span>
                <button onClick={() => regenSummary(p)} disabled={summarising} style={{ border: "none", background: "none", padding: 0, font: `700 11.5px ${F}`, color: "var(--link)", cursor: "pointer" }}>{summarising ? "Summarising…" : p.commsSummaryStale || !p.commsSummary ? "Generate ↻" : "Refresh ↻"}</button>
              </div>
              <p style={{ margin: 0, font: `500 13.5px/1.5 ${F}`, color: p.commsSummary ? "var(--text)" : "var(--muted2)" }}>{p.commsSummary || "No summary yet — generate one from the thread below."}{p.commsSummary && p.commsSummaryStale ? " (newer messages since — refresh)" : ""}</p>
            </div>
          )}

          {/* composer */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--band)", border: "1px solid var(--card-border)", borderRadius: 12, padding: 10 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ENTRY_TYPES.map((k) => { const on = entryType === k; const c = chChip(k); return <button key={k} onClick={() => setEntryType(k)} style={{ border: `1px solid ${on ? c.fg : "var(--card-border)"}`, background: on ? c.bg : "var(--card)", color: on ? c.fg : "var(--muted)", borderRadius: 999, padding: "4px 11px", font: `700 12px ${F}`, cursor: "pointer" }}>{k}</button>; })}
            </div>
            <textarea rows={2} value={entryText} onChange={(e) => setEntryText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); addEntry(p); } }} placeholder={`Log a ${entryType.toLowerCase()}…`} style={{ ...input, resize: "vertical", font: `500 13.5px/1.45 ${F}` }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ font: `500 11.5px ${F}`, color: "var(--muted2)" }}>Enter to save · Shift+Enter for a new line · Shows in Renters too</span>
              <button onClick={() => addEntry(p)} disabled={busy === p.id || !entryText.trim()} style={{ border: "none", background: entryText.trim() ? "var(--btn-primary-bg)" : "var(--toggle-off)", color: "#fff", borderRadius: 10, padding: "8px 14px", font: `700 12.5px ${F}`, cursor: entryText.trim() ? "pointer" : "default" }}>{busy === p.id ? "Adding…" : "Add entry"}</button>
            </div>
          </div>

          {/* timeline */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ ...micro, marginRight: 4 }}>History</span>
              {([["all", "All"], ["calls", "Calls"], ["msgs", "Messages"], ["notes", "Notes"]] as const).map(([k, l]) => <button key={k} onClick={() => setTlTab(k)} style={{ border: "none", background: tlTab === k ? "var(--accent)" : "var(--neutral-chip-bg)", color: tlTab === k ? "#fff" : "var(--text2)", borderRadius: 999, padding: "4px 10px", font: `700 12px ${F}`, cursor: "pointer" }}>{l} <span style={{ font: `700 11px ${G}`, opacity: 0.7 }}>{tabN(k)}</span></button>)}
            </div>
            {tl.length === 0 ? <div style={{ font: `500 12.5px ${F}`, color: "var(--muted2)", fontStyle: "italic" }}>Nothing logged in this view.</div> : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {tl.map((e) => { const c = chChip(e.type); const who = e.author?.split(/\s+/)[0] || "—"; const when = e.ts ? fmtFull(e.ts) : "date not recorded"; return (
                  <div key={e.id} style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr)", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}><span style={{ flex: "none", marginTop: 5, width: 10, height: 10, borderRadius: "50%", border: `2px solid ${c.fg}`, background: "var(--card)" }} /><span style={{ flex: 1, width: 1.5, background: "var(--divider)" }} /></div>
                    <div style={{ paddingBottom: 16, display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ font: `700 10px ${F}`, letterSpacing: ".05em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, background: c.bg, color: c.fg }}>{e.type}</span>
                        <span style={{ font: `500 12px ${F}`, color: "var(--muted2)" }}>{when} · {who}</span>
                      </div>
                      <span style={{ font: `500 13.5px/1.55 ${F}`, color: "var(--text2)", whiteSpace: "pre-wrap" }}>{e.text}</span>
                    </div>
                  </div>
                ); })}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }
}

function Stat({ n, sub, label }: { n: string; sub?: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ font: `700 18px ${G}`, color: "var(--text)" }}>{n}{sub && <span style={{ font: `500 12px ${F}`, color: "var(--muted2)" }}> {sub}</span>}</span>
      <span style={{ font: `600 11.5px ${F}`, color: "var(--muted)" }}>{label}</span>
    </div>
  );
}
