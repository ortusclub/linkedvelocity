"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Renters v3 — PREVIEW (Phase 0)
//
// One page merging renters (User) + the CRM/Inbound contact list (InboundLead) into
// a single person record (lead → signup → renting → dormant). This preview reads the
// unified view live from /api/admin/renters (no new tables yet) so the look & flow can
// be reviewed with real data before the Phase-1 schema migration + persistence.
//
// What's REAL in the preview (writes to existing endpoints):
//   • Vetting / sign-in access / daily cap / test flag  → /api/admin/customers PATCH
//   • Delete renter                                     → /api/admin/customers DELETE
//   • View as (impersonate, read-only)                  → /dashboard?view_as=<id>
//   • Logging a conversation on a person who is a lead  → /api/admin/inbound/notes
// What's PREVIEW-ONLY (edits locally, Save shows a notice): details fields, lead
//   stage / PoC / follow-up / source on renters, company grouping, merge, add renter.
//
// Styling mirrors inventory-v2: literal light palette + inline style objects.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState, useCallback } from "react";

// palette (matches inventory-v2 + the Renters v3 mockup)
const INK = "#0b1220", BODY = "#334155", SUB = "#5b6779", MUT = "#8a93a3";
const LINE = "#e3e6ec", LINE2 = "#eef0f4", LINE3 = "#dde1e8", BG = "#eef0f4", INPUT = "#f8f9fb";
const BLUE = "#2563eb";
const F = "'Plus Jakarta Sans',system-ui,sans-serif";
const G = "'Space Grotesk',system-ui,sans-serif";

const ST = {
  Active: { bg: "#e7f6ee", fg: "#0f7a3d" },
  Dormant: { bg: "#fff4e5", fg: "#b45309" },
  Warm: { bg: "#fff7e0", fg: "#a16207" },
  Cold: { bg: "#eef2f7", fg: "#475569" },
  Signup: { bg: "#eef0f4", fg: "#5b6779" },
  Test: { bg: "#f3e8ff", fg: "#7c3aed" },
} as const;
const VET = {
  Verified: { bg: "#e7f6ee", fg: "#0f7a3d" },
  "Needs review": { bg: "#fff7e0", fg: "#a16207" },
  "Not vetted": { bg: "#f3f4f6", fg: "#8a93a3" },
} as const;
const PAY = {
  Card: { bg: "#e8f0fe", fg: "#2563eb" },
  "Crypto Wallet": { bg: "#f3e8ff", fg: "#7c3aed" },
  none: { bg: "#f3f4f6", fg: "#8a93a3" },
} as const;
const POC_COLOR: Record<string, string> = { Ardi: "#7c3aed", Milee: "#0f7a3d", Sam: "#c2410c" };
const CH = { WA: { bg: "#e7f6ee", fg: "#0f7a3d", l: "WA" }, TG: { bg: "#e0f2fe", fg: "#0369a1", l: "TG" } } as const;
const CONV_TYPE: Record<string, { bg: string; fg: string }> = {
  Note: { bg: "#eef0f4", fg: "#5b6779" },
  Call: { bg: "#e8f0fe", fg: "#2563eb" },
  WhatsApp: { bg: "#e7f6ee", fg: "#0f7a3d" },
  Telegram: { bg: "#e0f2fe", fg: "#0369a1" },
  Email: { bg: "#f3e8ff", fg: "#7c3aed" },
};
const AVATARS = ["#2563eb", "#7c3aed", "#0f7a3d", "#c2410c", "#be185d", "#0369a1", "#b45309"];

type Person = {
  id: string; kind: "user" | "lead"; userId: string | null; leadId: string | null;
  name: string; email: string | null; channel: "WA" | "TG" | null; contact: string | null;
  role: string | null; source: string | null; pocOwner: "Ardi" | "Milee" | "Sam" | null;
  followUp: string | null; leadStage: "warm" | "cold" | null;
  vetting: keyof typeof VET; paymentMethod: "Card" | "Crypto Wallet" | null; paymentFailed: boolean;
  signInAccess: boolean; dailyCap: number; isTest: boolean; notes: string | null;
  liveRentals: number; totalRentals: number; mrr: number; txnCount: number; paidTotal: number;
  replacementCount: number; discount: string | null; joinedAt: string; lastActivityAt: string;
  companyId: string | null; companyDomain: string | null; vettingReviewRaw: string | null;
  commsSummary: string | null; commsSummaryStale: boolean;
  conversations: { id: string; type: string; text: string; meta: string; author: string | null; ts: string }[];
};
type Company = { id: string; domain: string; name: string; notes?: string | null; memberIds: string[]; mainContactId: string | null };

function initials(name: string) {
  const parts = name.replace(/[@]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(seed: string) {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}
function statusOf(p: Person): keyof typeof ST {
  if (p.isTest) return "Test";
  if (p.liveRentals > 0) return "Active";
  if (p.totalRentals > 0) return "Dormant";
  if (p.leadStage === "warm") return "Warm";
  if (p.leadStage === "cold") return "Cold";
  return "Signup";
}
function daysAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "today"; if (d === 1) return "1d ago"; if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30); return m < 12 ? `${m}mo ago` : `${Math.floor(m / 12)}y ago`;
}
function money(n: number) { return n ? `$${Math.round(n).toLocaleString()}` : "—"; }
// Comms entries are often raw template emails (booking confirmations etc.) with HTML
// markup — strip the tags/entities so they read as plain text, then the UI clamps length.
const CONV_CLAMP = 180;
function cleanCommText(raw: string): string {
  return (raw || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#0?39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Auto-generated booking-confirmation entries ("Call booked: <iso> 30 min with LinkedVelocity…
// Join with Google Meet: …") are pure template noise. Collapse them to a one-line marker so
// only the real conversation reads. Human-written notes pass through unchanged.
function condenseEntry(text: string): string {
  const m = text.match(/^Call book(?:ed|ing updated):\s*(\S+)?\s*(\d+\s*min)?/i);
  if (m) {
    const iso = m[1] || "";
    const d = /\d{4}-\d{2}-\d{2}/.test(iso) ? new Date(iso) : null;
    const when = d && !isNaN(d.getTime())
      ? d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
      : "";
    const dur = m[2] ? " · " + m[2].replace(/\s+/g, "") : "";
    return `📅 Call booked${when ? " — " + when : ""}${dur}`;
  }
  return text;
}

export default function RentersV3Page() {
  const [people, setPeople] = useState<Person[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [status, setStatus] = useState<"renters" | "active" | "dormant" | "leads" | "signups" | "test">("renters");
  const [poc, setPoc] = useState<"all" | "Ardi" | "Milee" | "Sam" | "unassigned">("all");
  const [byCompany, setByCompany] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "spend" | "rentals" | "joined" | "name">("recent");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [openCompany, setOpenCompany] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Person>>({});
  const [noteText, setNoteText] = useState("");
  const [noteType, setNoteType] = useState("Note");
  const [confirmDel, setConfirmDel] = useState(false);

  const [serverDupes, setServerDupes] = useState<{ id: string; aId: string; bId: string; reason: string }[]>([]);
  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2600); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/renters");
      const data = await res.json();
      if (res.ok) { setPeople(data.people || []); setCompanies(data.companies || []); setServerDupes(data.dupes || []); }
      else flash(data.error || "Failed to load");
    } catch { flash("Failed to load"); } finally { setLoading(false); }
  }, [flash]);
  useEffect(() => { load(); }, [load]);

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  // duplicate suggestions come from the server (duplicate_suggestions table).
  const dupes = useMemo(() => {
    const out: { id: string; a: Person; b: Person; why: string }[] = [];
    for (const d of serverDupes) {
      const a = personById.get(d.aId); const b = personById.get(d.bId);
      if (a && b) out.push({ id: d.id, a, b, why: d.reason.replace(/-/g, " ") });
    }
    return out;
  }, [serverDupes, personById]);
  const dupePartner = useMemo(() => {
    const m = new Map<string, { other: Person; why: string; dupeId: string }>();
    for (const d of dupes) { m.set(d.a.id, { other: d.b, why: d.why, dupeId: d.id }); m.set(d.b.id, { other: d.a, why: d.why, dupeId: d.id }); }
    return m;
  }, [dupes]);

  // status counts (ignoring the status filter itself, honouring PoC + search)
  const matchesPoc = useCallback((p: Person) => poc === "all" || (poc === "unassigned" ? !p.pocOwner : p.pocOwner === poc), [poc]);
  const matchesQ = useCallback((p: Person) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    const co = p.companyId ? companyById.get(p.companyId)?.name || "" : "";
    return [p.name, p.email, p.contact, co, p.role].filter(Boolean).some((v) => v!.toLowerCase().includes(s));
  }, [q, companyById]);

  const counts = useMemo(() => {
    const base = people.filter((p) => matchesPoc(p) && matchesQ(p));
    const st = (p: Person) => statusOf(p);
    return {
      renters: base.filter((p) => st(p) === "Active" || st(p) === "Dormant").length,
      active: base.filter((p) => st(p) === "Active").length,
      dormant: base.filter((p) => st(p) === "Dormant").length,
      leads: base.filter((p) => st(p) === "Warm" || st(p) === "Cold").length,
      signups: base.filter((p) => st(p) === "Signup").length,
      test: base.filter((p) => st(p) === "Test").length,
    };
  }, [people, matchesPoc, matchesQ]);

  const pocCounts = useMemo(() => {
    const base = people.filter((p) => !p.isTest && matchesQ(p));
    return {
      all: base.length,
      Ardi: base.filter((p) => p.pocOwner === "Ardi").length,
      Milee: base.filter((p) => p.pocOwner === "Milee").length,
      Sam: base.filter((p) => p.pocOwner === "Sam").length,
      unassigned: base.filter((p) => !p.pocOwner).length,
    };
  }, [people, matchesQ]);

  const filtered = useMemo(() => {
    let list = people.filter((p) => matchesPoc(p) && matchesQ(p));
    list = list.filter((p) => {
      const s = statusOf(p);
      if (status === "renters") return s === "Active" || s === "Dormant";
      if (status === "active") return s === "Active";
      if (status === "dormant") return s === "Dormant";
      if (status === "leads") return s === "Warm" || s === "Cold";
      if (status === "signups") return s === "Signup";
      if (status === "test") return s === "Test";
      return true;
    });
    const cmp: Record<string, (a: Person, b: Person) => number> = {
      recent: (a, b) => (b.lastActivityAt > a.lastActivityAt ? 1 : -1),
      spend: (a, b) => b.mrr - a.mrr,
      rentals: (a, b) => b.totalRentals - a.totalRentals,
      joined: (a, b) => (b.joinedAt > a.joinedAt ? 1 : -1),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...list].sort(cmp[sort]);
  }, [people, matchesPoc, matchesQ, status, sort]);

  // rows: either flat person rows, or company group rows with nested members
  type Row = { kind: "co"; co: Company; members: Person[] } | { kind: "person"; p: Person; indent: boolean };
  const rows = useMemo<Row[]>(() => {
    if (!byCompany) return filtered.map((p) => ({ kind: "person", p, indent: false }));
    const out: Row[] = [];
    const used = new Set<string>();
    for (const c of companies) {
      const members = filtered.filter((p) => p.companyId === c.id);
      if (!members.length) continue;
      members.forEach((m) => used.add(m.id));
      out.push({ kind: "co", co: c, members });
      if (!collapsed[c.id]) members.forEach((p) => out.push({ kind: "person", p, indent: true }));
    }
    filtered.filter((p) => !used.has(p.id)).forEach((p) => out.push({ kind: "person", p, indent: false }));
    return out;
  }, [byCompany, filtered, companies, collapsed]);

  const cur = openPerson ? personById.get(openPerson) || null : null;
  useEffect(() => {
    if (cur) { setDraft({ ...cur }); setConfirmDel(false); setNoteText(""); setNoteType("Note"); }
  }, [openPerson]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes drawers
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpenPerson(null); setOpenCompany(null); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);

  // ── persistence (Phase 1: crm_people overlay) ──
  function patchLocal(id: string, patch: Partial<Person>) {
    setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  async function patchPerson(id: string, body: Record<string, unknown>) {
    const res = await fetch("/api/admin/renters", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
    if (!res.ok) { flash("Save failed"); return false; }
    return true;
  }
  async function setVetting(p: Person, label: keyof typeof VET) {
    patchLocal(p.id, { vetting: label }); setDraft((d) => ({ ...d, vetting: label }));
    if (!p.userId) { flash("Vetting applies once they have an account"); return; }
    await patchPerson(p.id, { vetting: label });
  }
  async function toggleSignin(p: Person) {
    const v = !p.signInAccess; patchLocal(p.id, { signInAccess: v }); setDraft((d) => ({ ...d, signInAccess: v }));
    if (!p.userId) { flash("Sign-in access needs an account"); return; }
    await patchPerson(p.id, { signInAccess: v });
  }
  async function setCap(p: Person, cap: number) {
    const v = Math.max(1, Math.min(50, cap)); patchLocal(p.id, { dailyCap: v }); setDraft((d) => ({ ...d, dailyCap: v }));
    if (!p.userId) { flash("Daily cap needs an account"); return; }
    await patchPerson(p.id, { dailyCap: v });
  }
  async function toggleTest(p: Person) {
    const v = !p.isTest; patchLocal(p.id, { isTest: v });
    await patchPerson(p.id, { isTest: v });
    flash(v ? "Marked as test" : "Unmarked test");
  }
  async function del(p: Person) {
    if (!confirmDel) { setConfirmDel(true); return; }
    const res = await fetch("/api/admin/renters", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) });
    if (res.ok) { setOpenPerson(null); flash("Deleted"); load(); } else flash("Delete failed");
  }
  async function addConversation(p: Person) {
    const text = noteText.trim(); if (!text) return;
    setNoteText("");
    const res = await fetch("/api/admin/renters/conversation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: p.id, type: noteType, text }) });
    const data = await res.json();
    if (res.ok && data.conversation) {
      patchLocal(p.id, { conversations: [data.conversation, ...p.conversations], lastActivityAt: data.conversation.ts });
      flash("Conversation logged");
    } else flash(data.error || "Failed to log");
  }
  async function saveDetails(p: Person) {
    const d = draft;
    const ok = await patchPerson(p.id, {
      name: d.name, email: d.email, channel: d.channel, contact: d.contact, role: d.role,
      source: d.source, pocOwner: d.pocOwner ?? "", followUp: d.followUp, leadStage: d.leadStage,
      notes: d.notes, companyId: d.companyId ?? "",
    });
    if (ok) { flash("Saved"); load(); }
  }
  async function mergeInto(intoId: string, fromId: string) {
    const res = await fetch("/api/admin/renters/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "merge", intoId, fromId }) });
    if (res.ok) { flash("Merged"); load(); } else flash("Merge failed");
  }
  async function groupDupe(aId: string, bId: string) {
    const res = await fetch("/api/admin/renters/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "group", aId, bId }) });
    if (res.ok) { flash("Grouped into a company"); load(); } else flash("Failed");
  }
  async function dismissDupe(dupeId: string) {
    const res = await fetch("/api/admin/renters/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dismiss", dupeId }) });
    if (res.ok) { flash("Dismissed"); load(); } else flash("Failed");
  }
  async function companyOp(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/renters/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { load(); return true; } flash("Company save failed"); return false;
  }
  async function addPerson() {
    const name = window.prompt("New contact name?")?.trim(); if (!name) return;
    const res = await fetch("/api/admin/renters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await res.json();
    if (res.ok) { await load(); setOpenPerson(data.id); flash("Added — fill in details"); } else flash(data.error || "Failed");
  }

  const colGrid = "minmax(240px,2.6fr) 128px minmax(150px,1fr) 78px 86px 118px 26px";

  const filterChips = [
    { k: "renters", l: "Renters", n: counts.renters, dot: "#0f7a3d", tip: "Active + dormant" },
    { k: "active", l: "Active", n: counts.active, dot: "#0f7a3d", tip: "Renting now" },
    { k: "dormant", l: "Dormant", n: counts.dormant, dot: "#b45309", tip: "Rented before, not now" },
    { k: "leads", l: "Leads", n: counts.leads, dot: "#a16207", tip: "Warm + cold" },
    { k: "signups", l: "Signups", n: counts.signups, dot: "#5b6779", tip: "Account, never rented" },
    { k: "test", l: "Test", n: counts.test, dot: "#7c3aed", tip: "Internal test records" },
  ] as const;
  const pocChips = [
    { k: "all", l: "Everyone", n: pocCounts.all },
    { k: "Ardi", l: "Ardi", n: pocCounts.Ardi },
    { k: "Milee", l: "Milee", n: pocCounts.Milee },
    { k: "Sam", l: "Sam", n: pocCounts.Sam },
    { k: "unassigned", l: "Unassigned", n: pocCounts.unassigned },
  ] as const;

  return (
    <div style={{ minHeight: "100vh", background: BG, padding: "28px 28px 80px", display: "flex", justifyContent: "center", fontFamily: F }}>
      <div style={{ width: "100%", maxWidth: 1320, display: "flex", flexDirection: "column", gap: 16 }}>

        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ font: `700 30px ${G}`, color: INK, margin: "0 0 4px", letterSpacing: "-.01em" }}>Renters</h1>
            <p style={{ font: `500 14px ${F}`, color: SUB, margin: 0 }}>
              Everyone we talk to — lead to renting. Click anyone to edit details or log a conversation.
              <span style={{ marginLeft: 8, font: `700 11px ${F}`, color: "#7c3aed", background: "#f3e8ff", borderRadius: 999, padding: "2px 8px" }}>PREVIEW</span>
            </p>
          </div>
          <button onClick={addPerson} style={{ border: "none", background: INK, color: "#fff", borderRadius: 10, padding: "9px 14px", font: `700 12.5px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>+ Add renter</button>
        </div>

        {/* duplicate banner */}
        {dupes.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#fff8eb", border: "1px solid #f5dcae", borderRadius: 12, padding: "9px 14px", font: `500 13px/1.45 ${F}`, color: "#7a4b06" }}>
            <span style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", background: "#d97706", color: "#fff", display: "grid", placeItems: "center", font: `800 11px ${F}` }}>?</span>
            <span style={{ flex: 1, minWidth: 220 }}><b>{dupes.length} possible duplicate{dupes.length > 1 ? "s" : ""}</b> — same person may have signed up twice. Open one to merge or group.</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {dupes.slice(0, 6).map((d, i) => (
                <button key={i} onClick={() => setOpenPerson(d.a.id)} style={{ border: "1px solid #f0c98a", background: "#fff", color: "#7a4b06", borderRadius: 999, padding: "4px 11px", font: `700 12px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>{d.a.name} ↔ {d.b.name}</button>
              ))}
            </div>
          </div>
        )}

        {/* filter card */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {filterChips.map((f) => {
              const on = status === f.k;
              return (
                <button key={f.k} title={f.tip} onClick={() => setStatus(f.k)} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", border: `1.5px solid ${on ? INK : LINE3}`, background: on ? "#fff" : INPUT, borderRadius: 999, padding: "5px 12px 5px 10px", font: `700 12.5px ${F}`, color: INK, whiteSpace: "nowrap" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: f.dot }} />{f.l}
                  <span style={{ font: `700 11px ${G}`, color: SUB, background: LINE2, borderRadius: 999, padding: "1px 7px" }}>{f.n}</span>
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", background: LINE2, borderRadius: 10, padding: 3, gap: 2 }}>
              {[{ k: false, l: "People only" }, { k: true, l: "By company" }].map((v) => {
                const on = byCompany === v.k;
                return <button key={String(v.k)} onClick={() => setByCompany(v.k)} style={{ border: "none", background: on ? "#fff" : "transparent", color: on ? INK : SUB, boxShadow: on ? "0 1px 2px rgba(11,18,32,.12)" : "none", borderRadius: 8, padding: "6px 12px", font: `700 12.5px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>{v.l}</button>;
              })}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", borderTop: `1px solid ${LINE2}`, paddingTop: 10 }}>
            <span style={{ font: `700 11px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: MUT, marginRight: 4 }}>LV PoC</span>
            {pocChips.map((pc) => {
              const on = poc === pc.k;
              const color = POC_COLOR[pc.k] || INK;
              return (
                <button key={pc.k} onClick={() => setPoc(pc.k)} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", border: `1.5px solid ${on ? INK : LINE3}`, background: on ? "#fff" : INPUT, borderRadius: 999, padding: "4px 11px 4px 4px", font: `700 12.5px ${F}`, color: INK, whiteSpace: "nowrap" }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: pc.k === "all" || pc.k === "unassigned" ? "#c6ccd6" : color, color: "#fff", font: `700 10px ${F}`, display: "grid", placeItems: "center" }}>{pc.k === "all" ? "∀" : pc.k === "unassigned" ? "—" : pc.l[0]}</span>{pc.l}
                  <span style={{ font: `700 11px ${G}`, color: SUB, background: LINE2, borderRadius: 999, padding: "1px 7px" }}>{pc.n}</span>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${LINE2}`, paddingTop: 10 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, email, phone or handle…" style={{ flex: 1, minWidth: 220, border: `1px solid ${LINE3}`, background: INPUT, borderRadius: 10, padding: "9px 12px", font: `500 13.5px ${F}`, color: INK, outline: "none" }} />
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ border: `1px solid ${LINE3}`, background: "#fff", borderRadius: 10, padding: "9px 10px", font: `600 13px ${F}`, color: INK }}>
              <option value="recent">Last active</option><option value="spend">Spend / mo, high → low</option><option value="rentals">Most rentals</option><option value="joined">Newest signup</option><option value="name">Name A–Z</option>
            </select>
          </div>
        </div>

        {/* table */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, overflowX: "auto" }}>
          <div style={{ minWidth: 980 }}>
            <div style={{ display: "grid", gridTemplateColumns: colGrid, gap: 14, padding: "11px 18px", borderBottom: `1px solid ${LINE2}`, font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: MUT }}>
              <span>{byCompany ? "Company / renter" : "Renter"}</span><span>Status</span><span>Vetting · payment</span><span>Rentals</span><span>Spend / mo</span><span>PoC · last touch</span><span />
            </div>
            {loading && <div style={{ padding: 40, textAlign: "center", font: `500 13.5px ${F}`, color: MUT }}>Loading…</div>}
            {!loading && rows.length === 0 && <div style={{ padding: 40, textAlign: "center", font: `500 13.5px ${F}`, color: MUT }}>No renters match.</div>}
            {rows.map((row) => {
              if (row.kind === "co") {
                const live = row.members.reduce((s, m) => s + m.liveRentals, 0);
                const total = row.members.reduce((s, m) => s + m.totalRentals, 0);
                const spend = row.members.reduce((s, m) => s + m.mrr, 0);
                const main = row.co.mainContactId ? personById.get(row.co.mainContactId) : null;
                return (
                  <div key={row.co.id} onClick={() => setOpenCompany(row.co.id)} style={{ display: "grid", gridTemplateColumns: colGrid, gap: 14, alignItems: "center", padding: "12px 18px", background: INPUT, borderBottom: `1px solid ${LINE2}`, cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <button onClick={(e) => { e.stopPropagation(); setCollapsed((c) => ({ ...c, [row.co.id]: !c[row.co.id] })); }} title="Show / hide people" style={{ flex: "none", width: 22, height: 22, border: `1px solid ${LINE3}`, background: "#fff", borderRadius: 6, font: `700 11px ${F}`, color: SUB, cursor: "pointer", display: "grid", placeItems: "center" }}>{collapsed[row.co.id] ? "▸" : "▾"}</button>
                      <span style={{ flex: "none", width: 32, height: 32, borderRadius: 9, background: INK, color: "#fff", display: "grid", placeItems: "center", font: `700 12px ${G}` }}>{initials(row.co.name)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ font: `700 14.5px ${F}`, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.co.name}</div>
                        <div style={{ font: `500 12px ${F}`, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.members.length} people · {row.co.domain}</div>
                      </div>
                    </div>
                    <span />
                    <span style={{ font: `500 12px ${F}`, color: SUB }}>{main ? `Main: ${main.name.split(" ")[0]}` : ""}</span>
                    <span style={{ font: `700 15px ${G}`, color: INK }}>{live}<span style={{ font: `500 12px ${F}`, color: MUT }}> / {total}</span></span>
                    <span style={{ font: `700 14px ${G}`, color: INK }}>{money(spend)}</span>
                    <span />
                    <span style={{ font: `700 14px ${F}`, color: "#b4bccb" }}>›</span>
                  </div>
                );
              }
              const p = row.p;
              const s = statusOf(p);
              const noPay = p.liveRentals > 0 && !p.paymentMethod;
              const edge = p.paymentFailed || noPay ? "#dc2626" : "transparent";
              const flags: { l: string; bg: string; fg: string }[] = [];
              if (p.paymentFailed) flags.push({ l: "Payment failed", bg: "#fde8e8", fg: "#b91c1c" });
              else if (noPay) flags.push({ l: "No payment method", bg: "#fde8e8", fg: "#b91c1c" });
              if (p.followUp) {
                const d = Math.floor((new Date(p.followUp).getTime() - Date.now()) / 86400000);
                if (d < 0) flags.push({ l: "Follow-up overdue", bg: "#fff4e5", fg: "#b45309" });
                else if (d === 0) flags.push({ l: "Follow up today", bg: "#fff4e5", fg: "#b45309" });
              }
              if (dupePartner.has(p.id)) flags.push({ l: "Possible duplicate", bg: "#fff4e5", fg: "#b45309" });
              const payK = p.paymentMethod ?? "none";
              const coName = p.companyId ? companyById.get(p.companyId)?.name : null;
              const missing = !p.contact && (s === "Active" || s === "Dormant") ? "phone or handle" : null;
              return (
                <div key={p.id} onClick={() => setOpenPerson(p.id)} style={{ display: "grid", gridTemplateColumns: colGrid, gap: 14, alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${LINE2}`, boxShadow: `inset 3px 0 0 ${edge}`, cursor: "pointer", background: "#fff" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, paddingLeft: row.indent ? 40 : 0 }}>
                    <span style={{ flex: "none", width: 30, height: 30, borderRadius: "50%", background: avatarColor(p.id), color: "#fff", display: "grid", placeItems: "center", font: `700 11px ${F}` }}>{initials(p.name)}</span>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ font: `700 14px ${F}`, color: INK }}>{p.name}</span>
                        {coName && !byCompany && <span style={{ font: `600 11px ${F}`, color: BODY, background: LINE2, borderRadius: 6, padding: "1px 7px" }}>{coName}</span>}
                        {flags.map((fl, i) => <span key={i} style={{ font: `700 10.5px ${F}`, padding: "2px 8px", borderRadius: 999, background: fl.bg, color: fl.fg, whiteSpace: "nowrap" }}>{fl.l}</span>)}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, font: `500 12.5px ${F}`, color: SUB }}>
                        {p.channel && <span style={{ flex: "none", font: `800 9.5px ${F}`, padding: "2px 5px", borderRadius: 4, background: CH[p.channel].bg, color: CH[p.channel].fg }}>{CH[p.channel].l}</span>}
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[p.contact, p.email].filter(Boolean).join(" · ") || "—"}</span>
                      </div>
                      {missing && <span style={{ font: `500 11px ${F}`, color: MUT }}>Fill in: {missing}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                    <span style={{ font: `700 11.5px ${F}`, padding: "3px 9px", borderRadius: 999, background: ST[s].bg, color: ST[s].fg, whiteSpace: "nowrap" }}>{s === "Signup" ? "Signed up" : s}</span>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <span style={{ font: `600 11px ${F}`, padding: "2px 8px", borderRadius: 999, background: VET[p.vetting].bg, color: VET[p.vetting].fg, whiteSpace: "nowrap" }}>{p.vetting}</span>
                    <span style={{ font: `600 11px ${F}`, padding: "2px 8px", borderRadius: 999, background: PAY[payK].bg, color: PAY[payK].fg, whiteSpace: "nowrap" }}>{p.paymentMethod ?? "No method"}</span>
                  </div>
                  <span style={{ font: `700 15px ${G}`, color: p.liveRentals ? "#0f7a3d" : INK }}>{p.liveRentals}<span style={{ font: `500 12px ${F}`, color: MUT }}> / {p.totalRentals}</span></span>
                  <span style={{ font: `700 14px ${G}`, color: INK }}>{money(p.mrr)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 7, font: `600 12.5px ${F}`, color: SUB, whiteSpace: "nowrap" }}>
                    <span title={p.pocOwner || "Unassigned"} style={{ flex: "none", width: 22, height: 22, borderRadius: "50%", background: p.pocOwner ? POC_COLOR[p.pocOwner] : "#c6ccd6", color: "#fff", display: "grid", placeItems: "center", font: `700 9.5px ${F}` }}>{p.pocOwner ? p.pocOwner[0] : "—"}</span>{daysAgo(p.lastActivityAt)}
                  </span>
                  <span style={{ font: `700 14px ${F}`, color: "#b4bccb" }}>›</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* person drawer */}
      {cur && <PersonDrawer
        p={cur} draft={draft} setDraft={setDraft} companies={companies} companyById={companyById}
        dupe={dupePartner.get(cur.id)} noteText={noteText} setNoteText={setNoteText} noteType={noteType} setNoteType={setNoteType}
        confirmDel={confirmDel}
        onClose={() => setOpenPerson(null)} onSave={() => saveDetails(cur)}
        onVet={(l) => setVetting(cur, l)} onSignin={() => toggleSignin(cur)} onCap={(c) => setCap(cur, c)}
        onTest={() => toggleTest(cur)} onDel={() => del(cur)} onAddConv={() => addConversation(cur)}
        onMerge={() => { const d = dupePartner.get(cur.id); if (d) mergeInto(cur.id, d.other.id); }}
        onGroup={() => { const d = dupePartner.get(cur.id); if (d) groupDupe(cur.id, d.other.id); }}
        onDismiss={() => { const d = dupePartner.get(cur.id); if (d) dismissDupe(d.dupeId); }}
        onViewAs={() => cur.userId ? window.open(`/dashboard?view_as=${cur.userId}`, "_blank") : flash("View-as needs an account")}
      />}

      {/* company drawer */}
      {openCompany && (() => {
        const c = companyById.get(openCompany); if (!c) return null;
        const members = people.filter((p) => p.companyId === c.id);
        const addable = people.filter((pp) => !pp.companyId && !pp.isTest);
        return <CompanyDrawer c={c} members={members} addable={addable}
          onClose={() => setOpenCompany(null)} onOpenPerson={(id) => { setOpenCompany(null); setOpenPerson(id); }}
          onSave={(d) => companyOp({ action: "update", id: c.id, ...d })}
          onUngroup={() => { companyOp({ action: "ungroup", id: c.id }); setOpenCompany(null); }}
          onAddMember={(personId) => companyOp({ action: "addMember", companyId: c.id, personId })}
          onRemoveMember={(personId) => companyOp({ action: "removeMember", personId })} />;
      })()}

      {toast && <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", background: INK, color: "#fff", borderRadius: 10, padding: "10px 16px", font: `600 13px ${F}`, zIndex: 60, boxShadow: "0 8px 24px rgba(11,18,32,.25)" }}>{toast}</div>}
    </div>
  );
}

// ───────────────────────────── Person drawer ─────────────────────────────
function PersonDrawer(props: {
  p: Person; draft: Partial<Person>; setDraft: (f: (d: Partial<Person>) => Partial<Person>) => void;
  companies: Company[]; companyById: Map<string, Company>; dupe?: { other: Person; why: string; dupeId: string };
  noteText: string; setNoteText: (v: string) => void; noteType: string; setNoteType: (v: string) => void; confirmDel: boolean;
  onClose: () => void; onSave: () => void; onVet: (l: keyof typeof VET) => void; onSignin: () => void; onCap: (c: number) => void;
  onTest: () => void; onDel: () => void; onAddConv: () => void; onViewAs: () => void;
  onMerge: () => void; onGroup: () => void; onDismiss: () => void;
}) {
  const { p, draft, companies } = props;
  const s = statusOf(p);
  const isLead = s === "Warm" || s === "Cold";
  const [showAll, setShowAll] = useState(false);
  const shownConv = showAll ? p.conversations : p.conversations.slice(0, 3);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleEntry = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rid = p.userId || "";
  const links = [
    { label: "Rentals", val: `${p.liveRentals} live · ${p.totalRentals} total`, href: `/admin/rentals?renter=${rid}` },
    { label: "Transactions", val: `${p.txnCount} · ${money(p.paidTotal)} paid`, href: `/admin/transactions?renter=${rid}` },
    { label: "Replacements", val: `${p.replacementCount}`, href: `/admin/replacements?renter=${rid}` },
    { label: "Discounts", val: p.discount || "none", href: `/admin/discounts${p.discount ? `?code=${encodeURIComponent(p.discount)}` : ""}` },
    { label: "Email log", val: p.email || "—", href: `/admin/emails${p.email ? `?q=${encodeURIComponent(p.email)}` : ""}` },
  ];
  const typeChips = ["Note", "Call", "WhatsApp", "Telegram", "Email"];
  return (
    <>
      <div onClick={props.onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,.28)", zIndex: 40 }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(520px,100vw)", background: "#fff", zIndex: 41, display: "flex", flexDirection: "column", boxShadow: "-12px 0 40px rgba(11,18,32,.14)" }}>
        <div style={{ padding: "18px 20px 14px", borderBottom: `1px solid ${LINE2}`, display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ flex: "none", width: 42, height: 42, borderRadius: "50%", background: avatarColor(p.id), color: "#fff", display: "grid", placeItems: "center", font: `700 14px ${F}` }}>{initials(p.name)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: `700 19px ${G}`, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, font: `500 12px ${F}`, color: SUB }}>
              <span style={{ font: `700 11px ${F}`, padding: "2px 8px", borderRadius: 999, background: ST[s].bg, color: ST[s].fg }}>{s === "Signup" ? "Signed up" : s}</span>
              joined {new Date(p.joinedAt).toLocaleDateString()}{p.pocOwner && <span>· PoC {p.pocOwner}</span>}
            </div>
          </div>
          <button onClick={props.onClose} style={{ flex: "none", border: "none", background: LINE2, width: 30, height: 30, borderRadius: 8, font: `700 14px ${F}`, color: SUB, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
          {props.dupe && (
            <div style={{ background: "#fff8eb", border: "1px solid #f5dcae", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ font: `500 13px/1.45 ${F}`, color: "#7a4b06" }}><b>Possibly the same person as {props.dupe.other.name}</b> — {props.dupe.why}.</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={props.onMerge} style={{ border: "none", background: INK, color: "#fff", borderRadius: 8, padding: "6px 11px", font: `700 12px ${F}`, cursor: "pointer" }}>Merge {props.dupe.other.name.split(" ")[0]} into this one</button>
                <button onClick={props.onGroup} style={{ border: "1px solid #f0c98a", background: "#fff", color: "#7a4b06", borderRadius: 8, padding: "6px 11px", font: `700 12px ${F}`, cursor: "pointer" }}>Different people, same company</button>
                <button onClick={props.onDismiss} style={{ border: "none", background: "none", color: "#8a6a30", padding: "6px 6px", font: `700 12px ${F}`, cursor: "pointer" }}>Not related</button>
              </div>
            </div>
          )}

          {/* details */}
          <Section title="Details">
            <Field label="Full name"><input value={draft.name ?? ""} onChange={(e) => props.setDraft((d) => ({ ...d, name: e.target.value }))} style={inp} /></Field>
            <Field label="Email"><input value={draft.email ?? ""} onChange={(e) => props.setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="name@company.com" style={inp} /></Field>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, font: `600 12px ${F}`, color: BODY }}>Contact
              <div style={{ display: "flex", gap: 6 }}>
                <div style={{ flex: "none", display: "flex", background: LINE2, borderRadius: 10, padding: 3, gap: 2 }}>
                  {(["WA", "TG"] as const).map((c) => { const on = (draft.channel ?? p.channel) === c; return <button key={c} onClick={() => props.setDraft((d) => ({ ...d, channel: c }))} style={{ border: "none", background: on ? "#fff" : "transparent", color: on ? INK : SUB, borderRadius: 8, padding: "5px 10px", font: `700 12px ${F}`, cursor: "pointer" }}>{c}</button>; })}
                </div>
                <input value={draft.contact ?? ""} onChange={(e) => props.setDraft((d) => ({ ...d, contact: e.target.value }))} placeholder={(draft.channel ?? p.channel) === "TG" ? "@handle" : "phone number"} style={{ ...inp, flex: 1 }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Company">
                <select value={draft.companyId ?? ""} onChange={(e) => props.setDraft((d) => ({ ...d, companyId: e.target.value || null }))} style={sel}>
                  <option value="">None</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Role"><input value={draft.role ?? ""} onChange={(e) => props.setDraft((d) => ({ ...d, role: e.target.value }))} placeholder="e.g. Founder, SDR lead" style={inp} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 10 }}>
              <Field label="Source">
                <select value={draft.source ?? ""} onChange={(e) => props.setDraft((d) => ({ ...d, source: e.target.value }))} style={sel}>
                  <option value="">Not set</option>{["Google Calendar booking", "Website", "Google search", "ChatGPT / AI tool", "LinkedIn", "Friend or referral", "Telegram", "Other"].map((o) => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="LV PoC">
                <select value={draft.pocOwner ?? ""} onChange={(e) => props.setDraft((d) => ({ ...d, pocOwner: (e.target.value || null) as Person["pocOwner"] }))} style={sel}>
                  <option value="">Unassigned</option><option>Ardi</option><option>Milee</option><option>Sam</option>
                </select>
              </Field>
              <Field label="Follow-up"><input type="date" value={draft.followUp ? draft.followUp.slice(0, 10) : ""} onChange={(e) => props.setDraft((d) => ({ ...d, followUp: e.target.value || null }))} style={inp} /></Field>
            </div>
            {isLead && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, font: `600 12px ${F}`, color: BODY }}>Lead stage
                <div style={{ display: "flex", background: LINE2, borderRadius: 10, padding: 3, gap: 2 }}>
                  {(["warm", "cold"] as const).map((so) => { const on = (draft.leadStage ?? p.leadStage) === so; return <button key={so} onClick={() => props.setDraft((d) => ({ ...d, leadStage: so }))} style={{ border: "none", background: on ? "#fff" : "transparent", color: on ? INK : SUB, borderRadius: 8, padding: "5px 11px", font: `700 12px ${F}`, cursor: "pointer", textTransform: "capitalize" }}>{so}</button>; })}
                </div>
              </div>
            )}
            <Field label="Notes"><textarea value={draft.notes ?? ""} onChange={(e) => props.setDraft((d) => ({ ...d, notes: e.target.value }))} rows={3} placeholder="Anything the team should know" style={{ ...inp, resize: "vertical" }} /></Field>
          </Section>

          {/* conversations */}
          <Section title={`Notes & conversations · ${p.conversations.length}`}>
            <ConvSummary p={p} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, background: INPUT, border: `1px solid ${LINE}`, borderRadius: 12, padding: 10 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {typeChips.map((t) => { const on = props.noteType === t; const c = CONV_TYPE[t]; return <button key={t} onClick={() => props.setNoteType(t)} style={{ border: `1.5px solid ${on ? c.fg : LINE3}`, background: on ? c.bg : "#fff", color: on ? c.fg : SUB, borderRadius: 999, padding: "3px 10px", font: `700 11.5px ${F}`, cursor: "pointer" }}>{t}</button>; })}
              </div>
              <textarea value={props.noteText} onChange={(e) => props.setNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); props.onAddConv(); } }} rows={2} placeholder="Add a note or record what was said…" style={{ border: `1px solid ${LINE3}`, background: "#fff", borderRadius: 10, padding: "9px 11px", font: `500 13px/1.45 ${F}`, color: INK, outline: "none", resize: "vertical" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ font: `500 11px ${F}`, color: MUT }}>Enter to save · Shift+Enter for a new line</span>
                <button onClick={props.onAddConv} style={{ border: "none", background: props.noteText.trim() ? INK : "#c6ccd6", color: "#fff", borderRadius: 8, padding: "6px 12px", font: `700 12px ${F}`, cursor: "pointer" }}>Add entry</button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {p.conversations.length === 0 && <div style={{ font: `500 12.5px ${F}`, color: MUT, padding: "4px 0" }}>Nothing logged yet.</div>}
              {shownConv.map((h) => { const c = CONV_TYPE[h.type] || CONV_TYPE.Note; const clean = condenseEntry(cleanCommText(h.text)); const long = clean.length > CONV_CLAMP + 24; const open = expanded.has(h.id); const shownText = open || !long ? clean : clean.slice(0, CONV_CLAMP).trimEnd() + "…"; return (
                <div key={h.id} style={{ display: "grid", gridTemplateColumns: "14px 1fr", gap: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}><span style={{ flex: "none", width: 12, height: 12, borderRadius: "50%", border: `2.5px solid ${c.fg}`, background: "#fff", marginTop: 3 }} /><span style={{ flex: 1, width: 2, background: LINE }} /></div>
                  <div style={{ paddingBottom: 14, display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}><span style={{ font: `800 9.5px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, background: c.bg, color: c.fg }}>{h.type}</span><span style={{ font: `500 11.5px ${F}`, color: MUT }}>{[h.author, h.meta].filter(Boolean).join(" · ")}</span></div>
                    <div style={{ font: `500 13px/1.5 ${F}`, color: "#1e293b", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{shownText}{long && <button onClick={() => toggleEntry(h.id)} style={{ marginLeft: 6, border: "none", background: "none", color: BLUE, font: `700 12px ${F}`, cursor: "pointer", padding: 0 }}>{open ? "less" : "more"}</button>}</div>
                  </div>
                </div>
              ); })}
              {p.conversations.length > 3 && (
                <button onClick={() => setShowAll((v) => !v)} style={{ alignSelf: "flex-start", border: "none", background: "none", color: BLUE, font: `700 12px ${F}`, cursor: "pointer", padding: "2px 0" }}>
                  {showAll ? "Show less" : `Show all ${p.conversations.length} messages`}
                </button>
              )}
            </div>
          </Section>

          {/* access */}
          <Section title="Access">
            <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${LINE2}` }}>
                <div style={{ font: `600 13px ${F}`, color: INK }}>Vetting</div>
                <select value={p.vetting} onChange={(e) => props.onVet(e.target.value as keyof typeof VET)} style={{ border: `1px solid ${LINE3}`, background: "#fff", borderRadius: 8, padding: "6px 8px", font: `600 12.5px ${F}`, color: INK }}><option>Verified</option><option>Needs review</option><option>Not vetted</option></select>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${LINE2}` }}>
                <div><div style={{ font: `600 13px ${F}`, color: INK }}>Sign-in access</div><div style={{ font: `500 11.5px ${F}`, color: MUT }}>Can log in to rented profiles directly</div></div>
                <button onClick={props.onSignin} style={{ flex: "none", width: 38, height: 22, border: "none", borderRadius: 999, background: p.signInAccess ? "#0f7a3d" : "#c6ccd6", position: "relative", cursor: "pointer", padding: 0 }}><span style={{ position: "absolute", top: 3, left: p.signInAccess ? 19 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .15s" }} /></button>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px" }}>
                <div><div style={{ font: `600 13px ${F}`, color: INK }}>Daily cap</div><div style={{ font: `500 11.5px ${F}`, color: MUT }}>Max rentals started per day</div></div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => props.onCap(p.dailyCap - 1)} style={stepBtn}>−</button>
                  <span style={{ minWidth: 22, textAlign: "center", font: `700 14px ${G}`, color: INK }}>{p.dailyCap}</span>
                  <button onClick={() => props.onCap(p.dailyCap + 1)} style={stepBtn}>+</button>
                </div>
              </div>
            </div>
          </Section>

          {/* linked records */}
          <Section title="Linked records">
            <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, display: "flex", flexDirection: "column" }}>
              {links.map((l, i) => (
                <a key={l.label} href={l.href} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderBottom: i < links.length - 1 ? `1px solid ${LINE2}` : "none", color: INK, textDecoration: "none" }}>
                  <span style={{ font: `600 13px ${F}` }}>{l.label}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, font: `500 12.5px ${F}`, color: SUB }}>{l.val}<span style={{ color: BLUE, fontWeight: 700 }}>↗</span></span>
                </a>
              ))}
            </div>
            <div style={{ font: `500 11px ${F}`, color: MUT }}>Deep-links use ?renter= — wired into each tab in Phase 5 (Email log works now).</div>
          </Section>
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1px solid ${LINE2}`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={props.onViewAs} style={{ border: `1px solid ${LINE3}`, background: "#fff", color: INK, borderRadius: 9, padding: "7px 11px", font: `700 12px ${F}`, cursor: "pointer" }}>View as ↗</button>
          <button onClick={props.onTest} style={{ border: "none", background: "#f3e8ff", color: "#7c3aed", borderRadius: 9, padding: "7px 11px", font: `700 12px ${F}`, cursor: "pointer" }}>{p.isTest ? "Unmark test" : "Mark test"}</button>
          <button onClick={props.onDel} style={{ border: "none", background: "none", color: "#dc2626", padding: "7px 6px", font: `700 12px ${F}`, cursor: "pointer" }}>{props.confirmDel ? "Click again to delete" : "Delete"}</button>
          <div style={{ flex: 1 }} />
          <button onClick={props.onClose} style={{ border: "none", background: "none", color: SUB, padding: "7px 8px", font: `700 12.5px ${F}`, cursor: "pointer" }}>Cancel</button>
          <button onClick={props.onSave} style={{ border: "none", background: INK, color: "#fff", borderRadius: 9, padding: "8px 16px", font: `700 12.5px ${F}`, cursor: "pointer" }}>Save</button>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── Company drawer ─────────────────────────────
function CompanyDrawer(props: {
  c: Company; members: Person[]; addable: Person[];
  onClose: () => void; onOpenPerson: (id: string) => void;
  onSave: (d: { name: string; domain: string; notes: string; mainContactId: string | null }) => void;
  onUngroup: () => void; onAddMember: (personId: string) => void; onRemoveMember: (personId: string) => void;
}) {
  const { c, members } = props;
  const [name, setName] = useState(c.name);
  const [domain, setDomain] = useState(c.domain || "");
  const [notes, setNotes] = useState(c.notes || "");
  const [mainContactId, setMainContactId] = useState(c.mainContactId ?? "");
  const [confirmUngroup, setConfirmUngroup] = useState(false);
  return (
    <>
      <div onClick={props.onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,.28)", zIndex: 40 }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(520px,100vw)", background: "#fff", zIndex: 41, display: "flex", flexDirection: "column", boxShadow: "-12px 0 40px rgba(11,18,32,.14)" }}>
        <div style={{ padding: "18px 20px 14px", borderBottom: `1px solid ${LINE2}`, display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ flex: "none", width: 42, height: 42, borderRadius: 11, background: INK, color: "#fff", display: "grid", placeItems: "center", font: `700 14px ${G}` }}>{initials(name)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: `700 19px ${G}`, color: INK }}>{name}</div>
            <div style={{ font: `500 12px ${F}`, color: SUB, marginTop: 2 }}>{members.length} people · {domain}</div>
          </div>
          <button onClick={props.onClose} style={{ flex: "none", border: "none", background: LINE2, width: 30, height: 30, borderRadius: 8, font: `700 14px ${F}`, color: SUB, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
          <Section title="Company">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} style={inp} /></Field>
              <Field label="Website / domain"><input value={domain} onChange={(e) => setDomain(e.target.value)} style={inp} /></Field>
            </div>
            <Field label="Main contact"><select value={mainContactId} onChange={(e) => setMainContactId(e.target.value)} style={sel}><option value="">None</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Shared context for this company" style={{ ...inp, resize: "vertical" }} /></Field>
          </Section>
          <Section title="People">
            <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, display: "flex", flexDirection: "column" }}>
              {members.map((m, i) => { const s = statusOf(m); return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: i < members.length - 1 ? `1px solid ${LINE2}` : "none" }}>
                  <span style={{ flex: "none", width: 28, height: 28, borderRadius: "50%", background: avatarColor(m.id), color: "#fff", display: "grid", placeItems: "center", font: `700 10.5px ${F}` }}>{initials(m.name)}</span>
                  <button onClick={() => props.onOpenPerson(m.id)} style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer" }}>
                    <div style={{ font: `700 13px ${F}`, color: INK }}>{m.name}{m.id === c.mainContactId && <span style={{ marginLeft: 6, font: `600 10px ${F}`, color: BLUE }}>main</span>}</div>
                    <div style={{ font: `500 11.5px ${F}`, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</div>
                  </button>
                  <span style={{ font: `700 11px ${F}`, padding: "2px 8px", borderRadius: 999, background: ST[s].bg, color: ST[s].fg }}>{s === "Signup" ? "Signed up" : s}</span>
                  <button onClick={() => props.onRemoveMember(m.id)} title="Remove from company" style={{ border: "none", background: "none", color: MUT, font: `700 12px ${F}`, cursor: "pointer" }}>Remove</button>
                </div>
              ); })}
              <div style={{ padding: "10px 12px" }}>
                <select value="" onChange={(e) => e.target.value && props.onAddMember(e.target.value)} style={{ ...sel, border: `1px dashed #c6ccd6`, color: BLUE }}>
                  <option value="">+ Add a person to this company…</option>
                  {props.addable.map((o) => <option key={o.id} value={o.id}>{o.name}{o.email ? ` · ${o.email}` : ""}</option>)}
                </select>
              </div>
            </div>
          </Section>
        </div>
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${LINE2}`, display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => { if (confirmUngroup) props.onUngroup(); else setConfirmUngroup(true); }} style={{ border: "none", background: "none", color: "#dc2626", padding: "7px 6px", font: `700 12px ${F}`, cursor: "pointer" }}>{confirmUngroup ? "Click again to ungroup" : "Ungroup company"}</button>
          <div style={{ flex: 1 }} />
          <button onClick={props.onClose} style={{ border: "none", background: "none", color: SUB, padding: "7px 8px", font: `700 12.5px ${F}`, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => props.onSave({ name, domain, notes, mainContactId: mainContactId || null })} style={{ border: "none", background: INK, color: "#fff", borderRadius: 9, padding: "8px 16px", font: `700 12.5px ${F}`, cursor: "pointer" }}>Save</button>
        </div>
      </div>
    </>
  );
}

// shared bits
const inp: React.CSSProperties = { border: `1px solid ${LINE3}`, background: INPUT, borderRadius: 10, padding: "9px 11px", font: `500 13.5px ${F}`, color: INK, outline: "none", width: "100%" };
const sel: React.CSSProperties = { border: `1px solid ${LINE3}`, background: "#fff", borderRadius: 10, padding: "9px 10px", font: `600 13px ${F}`, color: INK, width: "100%" };
const stepBtn: React.CSSProperties = { width: 26, height: 26, border: `1px solid ${LINE3}`, background: "#fff", borderRadius: 7, font: `700 13px ${F}`, color: INK, cursor: "pointer" };
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ font: `700 11px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: MUT }}>{title}</span>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 5, font: `600 12px ${F}`, color: BODY }}>{label}{children}</label>;
}

// AI running summary of the conversation thread — one concise line so the timeline below
// stops being "always too long". Cached on the lead; Refresh re-generates after new messages.
function ConvSummary({ p }: { p: Person }) {
  const [summary, setSummary] = useState<string | null>(p.commsSummary);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  // Nothing to summarise unless this person has a CRM thread (a linked inbound lead).
  if (!p.leadId || p.conversations.length === 0) return null;
  const stale = p.commsSummaryStale && !refreshed;

  async function run(force: boolean) {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/admin/inbound/summarise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: p.leadId, force }) });
      const data = await res.json();
      if (res.ok) { setSummary(data.summary || "No summary — thread is empty."); setRefreshed(true); }
      else if (res.status === 503) setErr("Add ANTHROPIC_API_KEY on the server to enable AI summaries.");
      else setErr(data.error || "Couldn't summarise.");
    } catch { setErr("Couldn't summarise."); } finally { setLoading(false); }
  }

  return (
    <div style={{ background: "#f6f4ff", border: "1px solid #e4defa", borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ font: `800 9.5px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: "#7c3aed", background: "#f3e8ff", borderRadius: 5, padding: "2px 7px" }}>AI summary</span>
        {stale && summary && <span style={{ font: `600 10.5px ${F}`, color: "#a16207", background: "#fff7e0", borderRadius: 999, padding: "1px 7px" }}>new messages since</span>}
        <div style={{ flex: 1 }} />
        <button onClick={() => run(!!summary)} disabled={loading} style={{ border: "none", background: "none", color: BLUE, font: `700 12px ${F}`, cursor: loading ? "default" : "pointer", padding: 0, opacity: loading ? 0.6 : 1 }}>
          {loading ? "Summarising…" : summary ? "Refresh" : "Summarise thread"}
        </button>
      </div>
      {summary && <div style={{ font: `500 13px/1.5 ${F}`, color: "#1e293b" }}>{summary}</div>}
      {!summary && !err && <div style={{ font: `500 12.5px ${F}`, color: MUT }}>Condense this {p.conversations.length}-message thread into one line.</div>}
      {err && <div style={{ font: `500 12px ${F}`, color: "#b91c1c" }}>{err}</div>}
    </div>
  );
}
