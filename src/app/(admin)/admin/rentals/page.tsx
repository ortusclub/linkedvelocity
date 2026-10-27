"use client";

import { useEffect, useMemo, useState } from "react";
import { paymentStatus, accessStatus, isManualGrant, weeklyBilling, weeklyDueState, advanceWeeklyNotes, weeklyPaidStamp, dailyBilling, dailyDueState, dailyPaidStamp } from "@/lib/rental-tracker";

interface Rental {
  id: string;
  status: string;
  startDate: string;
  currentPeriodEnd: string | null;
  autoRenew: boolean;
  paused: boolean;
  usdcPayment: boolean;
  accessGrantedAt: string | null;
  accessRevokedAt: string | null;
  notes: string | null;
  lvPoc: string | null;
  lockedPrice: string | number | null;
  isShadow: boolean;
  renterAccountsLive: number;
  paymentMethodResolved: "USDC" | "Stripe";
  gologinShareIds: { email: string; shareId: string }[];
  user: { id: string; fullName: string; email: string; contactNumber: string | null; company: string | null; industry: string | null; createdAt: string };
  linkedinAccount: { id: string; linkedinName: string; linkedinUrl: string | null; connectionCount: number; monthlyPrice: string | number | null; gologinProfileId: string | null; notes: string | null; restrictedAt: string | null };
}

interface Account { id: string; linkedinName: string; status: string; notes: string | null; }

const F_SANS = "var(--font-sans),system-ui,sans-serif";
const F_GRO = "var(--font-grotesk),system-ui,sans-serif";
const DAY = 86400000;

const fmt = (d: string | null) => { if (!d) return "—"; try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return "—"; } };
const fmtY = (d: string | null) => { if (!d) return "—"; try { return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); } catch { return "—"; } };
const daysUntil = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / DAY) : null);
const profileEmail = (a: Rental["linkedinAccount"]) => (a.notes || "").match(/Profile email:\s*(\S+@\S+?\.\S+?)[\s.]/)?.[1] || a.linkedinName;
const initialsOf = (s: string) => (s || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
const weeklyOverdue = (r: Rental) => { const b = weeklyBilling(r.notes); return !!b && weeklyDueState(b.nextDue).tone === "overdue"; };
const dailyOverdue = (r: Rental) => { const b = dailyBilling(r.notes); if (!b) return false; const nd = dailyPaidStamp(r.notes)?.nextDue ?? b.from; return dailyDueState(nd).tone === "overdue"; };
const attnOf = (r: Rental) => !!r.linkedinAccount.restrictedAt || ["Overdue", "Expired"].includes(paymentStatus(r)) || accessStatus(r) === "Revoked" || weeklyOverdue(r) || dailyOverdue(r);

// Colour a weekly-due badge by urgency (reuses the existing status-chip tokens).
const weeklyStyle = (tone: string): React.CSSProperties => {
  const m: Record<string, [string, string]> = {
    overdue: ["var(--st-cancel-bg)", "var(--st-cancel-fg)"],
    due: ["var(--warn-badge-bg)", "var(--warn-badge-text)"],
    soon: ["var(--blue-chip-bg)", "var(--blue-chip-text)"],
    ok: ["var(--st-active-bg)", "var(--st-active-fg)"],
  };
  const [bg, fg] = m[tone] || m.ok;
  return { background: bg, color: fg };
};

const payStyle = (p: string): React.CSSProperties => {
  const m: Record<string, [string, string]> = { Paid: ["var(--st-active-bg)", "var(--st-active-fg)"], Pending: ["var(--blue-chip-bg)", "var(--blue-chip-text)"], Overdue: ["var(--st-cancel-bg)", "var(--st-cancel-fg)"], Expired: ["var(--neutral-chip-bg)", "var(--neutral-chip-text)"], Cancelled: ["var(--neutral-chip-bg)", "var(--neutral-chip-text)"] };
  const [bg, fg] = m[p] || m.Cancelled;
  return { background: bg, color: fg };
};
const accStyle = (a: string): React.CSSProperties => {
  const m: Record<string, [string, string]> = { Granted: ["var(--blue-chip-bg)", "var(--blue-chip-text)"], Paused: ["var(--warn-badge-bg)", "var(--warn-badge-text)"], Revoked: ["var(--st-cancel-bg)", "var(--st-cancel-fg)"], "Not granted": ["var(--neutral-chip-bg)", "var(--neutral-chip-text)"] };
  const [bg, fg] = m[a] || m["Not granted"];
  return { background: bg, color: fg };
};

export default function AdminRentalsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [addForm, setAddForm] = useState({ userEmail: "", linkedinAccountId: "", startDate: new Date().toISOString().split("T")[0], autoRenew: true });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [attnOnly, setAttnOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pocEdit, setPocEdit] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [sheetConfigured, setSheetConfigured] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = () => fetch("/api/admin/rentals").then((r) => r.json()).then((d) => setRentals(d.rentals || []));
  useEffect(() => {
    refresh().finally(() => setLoading(false));
    fetch("/api/admin/rentals/export-url").then((r) => r.json()).then((d) => { setSheetConfigured(!!d.configured); setSheetUrl(d.url || null); }).catch(() => setSheetConfigured(false));
  }, []);

  const handleAccess = async (rentalId: string, action: "grant" | "revoke" | "end", manualGrant = false) => {
    if (action === "end" && !window.confirm("End this rental permanently? This cuts the renter's GoLogin access and marks the rental cancelled (no resume).")) return;
    if (action === "revoke" && manualGrant && !window.confirm("This access was granted manually, so there's no stored share to revoke automatically. We'll mark it Paused here — but you must ALSO remove the share in GoLogin yourself. Continue?")) return;
    setBusy(rentalId);
    try {
      const res = await fetch(`/api/admin/rentals/${rentalId}/access`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json();
      if (!res.ok || data.ok === false) alert(`Failed: ${data.error || "unknown error"}`);
      await refresh();
    } catch (e) { alert("Request failed: " + (e instanceof Error ? e.message : "")); }
    finally { setBusy(null); }
  };
  const handleDeleteRental = async (id: string) => {
    if (!window.confirm("Permanently delete this rental record? Removes it from the tracker and frees the account. (For test/junk — use 'End' for a real cancellation.)")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/rentals/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert("Failed: " + (d.error || res.status)); }
      else setRentals((prev) => prev.filter((r) => r.id !== id));
    } finally { setBusy(null); }
  };
  // Recover a restricted account: clears the restriction (credits downtime + resumes billing/service).
  const handleUnrestrict = async (r: Rental) => {
    if (!window.confirm("Mark this account recovered? This clears the restriction, credits the downtime back to the renter's billing period, and resumes normal service.")) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/admin/accounts/${r.linkedinAccount.id}/restricted`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restricted: false }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert("Failed: " + (d.error || res.status)); }
      await refresh();
    } catch (e) { alert("Request failed: " + (e instanceof Error ? e.message : "")); }
    finally { setBusy(null); }
  };
  const handleSendRenewalLink = async (id: string) => {
    if (!window.confirm("Email this renter a payment link to renew their next month?")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/rentals/${id}/renewal-link`, { method: "POST" });
      const data = await res.json();
      alert(res.ok && data.ok ? `Renewal link emailed to ${data.sentTo}.` : "Failed: " + (data.error || res.status));
    } catch (e) { alert("Request failed: " + (e instanceof Error ? e.message : "")); }
    finally { setBusy(null); }
  };

  // Generate a Stripe subscription link that puts this rental onto auto-renew, and copy it
  // so you can send it to the renter. Doesn't charge until their current period ends.
  const handleAutoRenewLink = async (id: string) => {
    if (!window.confirm("Generate an auto-renew (recurring) link for this renter? It won't charge until their current paid period ends — no double-charge.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/rentals/${id}/autorenew-link`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        try { await navigator.clipboard?.writeText(data.url); } catch {}
        window.prompt("Auto-renew link (copied to clipboard) — send this to the renter:", data.url);
      } else alert("Failed: " + (data.error || res.status));
    } catch (e) { alert("Request failed: " + (e instanceof Error ? e.message : "")); }
    finally { setBusy(null); }
  };

  // notes (per rental)
  const saveNotes = async (r: Rental, value: string) => {
    if (value === (r.notes || "")) return;
    setRentals((prev) => prev.map((x) => (x.id === r.id ? { ...x, notes: value || null } : x)));
    await fetch("/api/admin/rentals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, notes: value || null }) });
  };
  // Off-platform weekly rentals: roll the "next due" marker forward one week.
  const markWeeklyPaid = async (r: Rental) => {
    const b = weeklyBilling(r.notes);
    if (!b) return;
    const newNotes = advanceWeeklyNotes(r.notes);
    const nextDue = weeklyBilling(newNotes)?.nextDue;
    if (!window.confirm(`Mark this week's $${b.amountRaw} payment from ${r.user.fullName} as received?\n\nNext payment due rolls to ${nextDue}.`)) return;
    await saveNotes(r, newNotes);
  };
  // company (per user -> applies to all that renter's rentals)
  const saveCompany = async (userId: string, anyRentalId: string, value: string) => {
    setRentals((prev) => prev.map((x) => (x.user.id === userId ? { ...x, user: { ...x.user, company: value || null } } : x)));
    await fetch("/api/admin/rentals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: anyRentalId, company: value || null }) });
  };
  // POC (stored per rental -> write to every rental in the renter group)
  const savePoc = async (groupRentals: Rental[], value: string) => {
    const ids = new Set(groupRentals.map((r) => r.id));
    setRentals((prev) => prev.map((x) => (ids.has(x.id) ? { ...x, lvPoc: value || null } : x)));
    await Promise.all(groupRentals.map((r) => fetch("/api/admin/rentals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, lvPoc: value || null }) })));
  };

  const openAddModal = () => { setShowAdd(true); setAddError(""); fetch("/api/admin/accounts?status=available").then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).catch(() => {}); };
  const handleAdd = async () => {
    if (!addForm.userEmail || !addForm.linkedinAccountId) { setAddError("Please fill in customer email and select an account."); return; }
    setAdding(true); setAddError("");
    const res = await fetch("/api/admin/rentals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(addForm) });
    const data = await res.json();
    if (!res.ok) { setAddError(data.error || "Failed to create rental"); setAdding(false); return; }
    setShowAdd(false); setAdding(false);
    setAddForm({ userEmail: "", linkedinAccountId: "", startDate: new Date().toISOString().split("T")[0], autoRenew: true });
    refresh();
  };
  const accountLabel = (a: Account) => (a.notes || "").match(/Profile email:\s*(\S+@\S+?\.\S+?)[\s.]/)?.[1] || a.linkedinName;

  const copyFormula = () => { if (!sheetUrl) return; navigator.clipboard?.writeText(`=IMPORTDATA("${sheetUrl}")`); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  // group by renter (user)
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; user: Rental["user"]; poc: string | null; rentals: Rental[] }>();
    for (const r of rentals) {
      let g = map.get(r.user.id);
      if (!g) { g = { key: r.user.id, user: r.user, poc: r.lvPoc, rentals: [] }; map.set(r.user.id, g); }
      g.rentals.push(r);
      if (!g.poc && r.lvPoc) g.poc = r.lvPoc;
    }
    return [...map.values()];
  }, [rentals]);

  const summary = useMemo(() => ({
    live: rentals.length,
    renters: groups.length,
    attn: rentals.filter(attnOf).length,
    healthy: rentals.filter((r) => !attnOf(r)).length,
  }), [rentals, groups]);

  const matches = (r: Rental) => {
    const q = query.trim().toLowerCase();
    if (attnOnly && !attnOf(r)) return false;
    if (!q) return true;
    return `${profileEmail(r.linkedinAccount)} ${r.linkedinAccount.gologinProfileId || ""} ${r.notes || ""} ${r.user.fullName} ${r.user.company || ""}`.toLowerCase().includes(q);
  };
  const toggleGroup = (key: string) => setCollapsed((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const allCollapsed = groups.length > 0 && collapsed.size >= groups.length;
  const collapseAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)));

  const F = { GRID: "minmax(0,1.35fr) 168px 150px minmax(0,1.25fr) 150px" };
  const labelCss: React.CSSProperties = { font: `700 10px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--label)" };
  const toolBtn = (active: boolean): React.CSSProperties => ({ font: `600 12.5px ${F_SANS}`, whiteSpace: "nowrap", padding: "9px 14px", borderRadius: 9, cursor: "pointer", border: "1px solid", ...(active ? { background: "var(--warn-badge-bg)", color: "var(--warn-badge-text)", borderColor: "transparent" } : { background: "var(--btn-secondary-bg)", color: "var(--btn-secondary-fg)", borderColor: "var(--btn-secondary-border)" }) });
  const chip: React.CSSProperties = { font: `600 11px ${F_SANS}`, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" };
  // white-background outline button: coloured border + matching coloured text
  const outBtn = (color: string): React.CSSProperties => ({ flex: 1, font: `600 12px ${F_SANS}`, color, background: "transparent", border: `1px solid ${color}`, padding: "6px 8px", borderRadius: 8, cursor: "pointer" });

  if (loading) return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{[1, 2, 3].map((i) => <div key={i} style={{ height: 72, borderRadius: 14, background: "var(--card)", border: "1px solid var(--card-border)" }} />)}</div>;

  return (
    <div>
      {/* title + actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 680 }}>
          <h1 style={{ font: `600 30px/1 ${F_GRO}`, color: "var(--text)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Rentals &amp; Contracts</h1>
          <p style={{ font: `500 13.5px/1.5 ${F_SANS}`, color: "var(--muted)", margin: 0 }}>Every live rental, grouped by renter. Renewal, billing and access at a glance — Company, POC &amp; notes save automatically and feed the Google Sheet export.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flex: "none", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={openAddModal} style={{ font: `600 13px ${F_SANS}`, color: "#fff", background: "var(--btn-primary-bg)", padding: "9px 16px", borderRadius: 10, border: "none", cursor: "pointer" }}>+ Add Rental</button>
          {sheetConfigured && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--sheets-bg)", border: "1px solid var(--sheets-border)", padding: "6px 8px 6px 14px", borderRadius: 12 }}>
              <span style={{ font: `600 13px ${F_SANS}`, color: "var(--sheets-fg)" }}>Live Google Sheets</span>
              <button onClick={copyFormula} style={{ font: `600 12.5px ${F_SANS}`, color: "#fff", background: "var(--sheets-btn-bg)", border: "none", padding: "8px 14px", borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap" }}>{copied ? "Copied ✓" : "Copy formula"}</button>
            </div>
          )}
        </div>
      </div>

      {sheetConfigured === false && (
        <div style={{ font: `500 12px ${F_SANS}`, color: "var(--warn-badge-text)", background: "var(--warn-badge-bg)", borderRadius: 9, padding: "8px 13px", marginBottom: 16 }}>
          Live Sheets export needs <code>RENTALS_EXPORT_KEY</code> set in Vercel. (Download CSV still works.)
        </div>
      )}

      {/* summary + toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ font: `600 22px ${F_GRO}`, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{summary.live}</span>
            <span style={{ font: `600 12px ${F_SANS}`, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--label)" }}>live rentals</span>
          </div>
          <span style={{ width: 1, height: 20, background: "var(--divider)" }} />
          {[["var(--avatar-fg)", `${summary.renters} renters`], ["var(--st-active-fg)", `${summary.healthy} healthy`], ["var(--warn-badge-text)", `${summary.attn} needs attention`]].map(([dot, txt]) => (
            <span key={txt} style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `500 12.5px ${F_SANS}`, color: "var(--muted)" }}><span style={{ width: 7, height: 7, borderRadius: 999, background: dot }} />{txt}</span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search account or notes…" style={{ width: 260, maxWidth: "50vw", background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 9, padding: "9px 12px", font: `500 13px ${F_SANS}`, color: "var(--input-fg)", outline: "none" }} />
          <button onClick={collapseAll} style={toolBtn(false)}>{allCollapsed ? "Expand all" : "Collapse all"}</button>
          <button onClick={() => setAttnOnly((v) => !v)} style={toolBtn(attnOnly)}>Needs attention</button>
        </div>
      </div>

      {/* groups */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", borderRadius: 16, overflow: "hidden", boxShadow: "var(--panel-shadow)" }}>
        <div style={{ display: "grid", gridTemplateColumns: F.GRID, gap: 18, padding: "11px 22px", borderBottom: "1px solid var(--divider)" }}>
          <span style={labelCss}>Account</span><span style={labelCss}>Billing</span><span style={labelCss}>Status</span><span style={labelCss}>Notes</span><span style={{ ...labelCss, textAlign: "right" }}>Manage</span>
        </div>

        {rentals.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", font: `500 13px ${F_SANS}`, color: "var(--muted)" }}>No rentals yet.</div>
        ) : groups.map((g) => {
          const visible = g.rentals.filter(matches);
          if (visible.length === 0) return null;
          const isCollapsed = collapsed.has(g.key);
          const gAttn = g.rentals.filter(attnOf).length;
          const title = g.user.company || g.user.fullName;
          const contact = g.user.contactNumber;
          const isTG = (contact || "").startsWith("telegram:");
          return (
            <div key={g.key}>
              {/* band */}
              <div onClick={() => toggleGroup(g.key)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 22px", background: "var(--band)", borderTop: "1px solid var(--divider)", cursor: "pointer", userSelect: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <span style={{ font: `600 12px ${F_SANS}`, color: "var(--muted)", flex: "none", width: 14, textAlign: "center", transform: isCollapsed ? "none" : "rotate(90deg)", transition: "transform .18s" }}>▸</span>
                  <div style={{ width: 38, height: 38, borderRadius: 10, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", font: `600 13px ${F_GRO}`, background: "var(--avatar-bg)", color: "var(--avatar-fg)" }}>{initialsOf(title)}</div>
                  <div style={{ minWidth: 0 }}>
                    <input onClick={(e) => e.stopPropagation()} defaultValue={g.user.company || ""} placeholder="Company…"
                      onBlur={(e) => saveCompany(g.user.id, g.rentals[0].id, e.target.value.trim())}
                      style={{ font: `600 15.5px ${F_SANS}`, color: "var(--text)", background: "transparent", border: "1px solid transparent", borderRadius: 6, padding: "1px 5px", margin: "0 0 3px -5px", outline: "none", maxWidth: 260 }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 9, font: `500 12px ${F_SANS}`, color: "var(--muted)", flexWrap: "wrap" }}>
                      <span>{g.user.fullName}</span><span style={{ color: "var(--muted2)" }}>·</span><span>{g.user.email}</span>
                      {contact && <span style={{ font: `700 9.5px ${F_SANS}`, letterSpacing: ".03em", padding: "2px 6px", borderRadius: 5, background: "var(--tag-bg)", color: isTG ? "var(--tg-fg)" : "var(--wa-fg)" }}>{isTG ? "TG" : "WA"} {contact.replace(/^(whatsapp|telegram):/, "")}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "none" }}>
                  {pocEdit === g.key ? (
                    <input autoFocus onClick={(e) => e.stopPropagation()} defaultValue={g.poc || ""} placeholder="Type a name…"
                      onBlur={(e) => { savePoc(g.rentals, e.target.value.trim()); setPocEdit(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setPocEdit(null); }}
                      style={{ font: `600 11.5px ${F_SANS}`, padding: "5px 11px", borderRadius: 999, border: "1px solid var(--accent)", background: "var(--input-bg)", color: "var(--input-fg)", outline: "none", width: 150 }} />
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); setPocEdit(g.key); }} style={{ font: `600 11.5px ${F_SANS}`, padding: "5px 11px", borderRadius: 999, cursor: "pointer", ...(g.poc ? { background: "var(--blue-chip-bg)", color: "var(--blue-chip-text)", border: "none" } : { background: "transparent", color: "var(--muted)", border: "1px dashed var(--btn-secondary-border)" }) }}>{g.poc ? `◔ LV POC · ${g.poc}` : "+ Assign LV POC"}</button>
                  )}
                  {g.rentals.some((r) => r.isShadow) && <span title="Shadow renter — holds idle accounts without removing them from the catalogue; a real customer rental takes the account back." style={{ font: `600 12px ${F_SANS}`, color: "var(--blue-chip-text)", background: "var(--blue-chip-bg)", padding: "5px 11px", borderRadius: 999 }}>Shadow · doesn&apos;t hold inventory</span>}
                  <span style={{ font: `600 12px ${F_SANS}`, color: "var(--text2)", background: "var(--tag-bg)", padding: "5px 11px", borderRadius: 999 }}>{g.rentals.length} {g.rentals.length === 1 ? "account" : "accounts"}</span>
                  {gAttn > 0 && <span style={{ font: `600 12px ${F_SANS}`, color: "var(--warn-badge-text)", background: "var(--warn-badge-bg)", padding: "5px 11px", borderRadius: 999 }}>{gAttn} needs attention</span>}
                </div>
              </div>

              {/* rentals */}
              {!isCollapsed && visible.map((r) => {
                const pay = paymentStatus(r); const acc = accessStatus(r);
                const restricted = !!r.linkedinAccount.restrictedAt;
                const days = daysUntil(r.currentPeriodEnd);
                const renewLabel = restricted ? "Billing paused" : days == null ? "—" : days >= 0 ? `${r.autoRenew ? "Renews" : "Ends"} in ${days}d` : `Overdue ${-days}d`;
                const wb = weeklyBilling(r.notes);
                const wDue = wb ? weeklyDueState(wb.nextDue) : null;
                const db = dailyBilling(r.notes);
                const dStamp = db ? dailyPaidStamp(r.notes) : null;
                const dNextDue = db ? (dStamp?.nextDue ?? db.from) : null;
                const dDue = dNextDue ? dailyDueState(dNextDue) : null;
                return (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: F.GRID, gap: 18, alignItems: "start", padding: "16px 22px", borderTop: "1px solid var(--divider)", borderLeft: "3px solid", borderLeftColor: attnOf(r) ? "var(--warn-badge-text)" : "transparent" }}>
                    {/* account */}
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ font: `600 13.5px ${F_SANS}`, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profileEmail(r.linkedinAccount)}</span>
                      {r.linkedinAccount.gologinProfileId && <span style={{ font: `500 11px ${F_GRO}`, color: "var(--muted2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title="GoLogin profile ID">{r.linkedinAccount.gologinProfileId}</span>}
                      {restricted && <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 2, font: `600 11px ${F_SANS}`, color: "var(--warn-badge-text)", background: "var(--warn-badge-bg)", padding: "4px 9px", borderRadius: 7 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--warn-badge-text)", flex: "none" }} />Restricted — recovering · billing paused since {fmt(r.linkedinAccount.restrictedAt)}</div>}
                    </div>
                    {/* billing */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {wb && wDue && !restricted ? (
                        <>
                          <span style={{ ...chip, ...weeklyStyle(wDue.tone), alignSelf: "flex-start" }}>{wDue.label} · ${wb.amountRaw}/wk</span>
                          <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted)" }}>Next payment {fmtY(wb.nextDue)}</span>
                          {(() => { const ps = weeklyPaidStamp(r.notes); return ps ? (
                            <span title={`Confirmed on-chain · tx ${ps.tx}`} style={{ font: `600 11px ${F_SANS}`, color: "var(--st-active-fg)" }}>✓ Paid {fmtY(ps.date)} · tx {ps.tx.slice(0, 6)}…</span>
                          ) : null; })()}
                          <span style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2)" }}>Weekly · manual (off-platform)</span>
                        </>
                      ) : db && dDue && dNextDue && !restricted ? (
                        <>
                          <span style={{ ...chip, ...weeklyStyle(dDue.tone), alignSelf: "flex-start" }}>{dDue.label} · ${db.rateRaw}/day</span>
                          <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted)" }}>Next payment {fmtY(dNextDue)}</span>
                          {dStamp ? (
                            <span title={dStamp.tx ? `Auto-summed on-chain · latest tx ${dStamp.tx}` : "Auto-summed on-chain"} style={{ font: `600 11px ${F_SANS}`, color: "var(--st-active-fg)" }}>✓ ${dStamp.total} received{dStamp.tx ? ` · tx ${dStamp.tx.slice(0, 6)}…` : ""}</span>
                          ) : null}
                          <span style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2)" }}>Daily · auto (unique address)</span>
                        </>
                      ) : (
                        <>
                          <span style={{ font: `600 13px ${F_SANS}`, color: restricted ? "var(--warn-badge-text)" : "var(--accent)" }}>{renewLabel}</span>
                          <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted)" }}>{fmt(r.startDate)} → {fmt(r.currentPeriodEnd)}</span>
                          <span style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2)" }}>{r.autoRenew ? "✓ Auto-renew on" : "○ Auto-renew off"}</span>
                        </>
                      )}
                    </div>
                    {/* status */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                      <span style={{ ...chip, ...payStyle(pay) }}>{pay} · {r.paymentMethodResolved === "USDC" ? "Crypto" : "Card"}</span>
                      <span style={{ ...chip, ...accStyle(acc) }}>{acc === "Granted" ? "Access granted" : acc}</span>
                      <span style={{ font: `500 10.5px ${F_SANS}`, color: "var(--label)" }}>Live {fmt(r.accessGrantedAt)}</span>
                    </div>
                    {/* notes */}
                    <div style={{ minWidth: 0 }}>
                      <textarea key={`notes-${r.id}-${wb?.nextDue ?? "x"}`} defaultValue={r.notes || ""} placeholder="Issues, internal notes…" rows={2} onBlur={(e) => saveNotes(r, e.target.value.trim())}
                        style={{ width: "100%", resize: "vertical", font: `500 12.5px/1.5 ${F_SANS}`, color: "var(--text2)", background: "var(--quote-bg)", border: "1px solid var(--card-border)", borderRadius: 9, padding: "9px 11px", outline: "none", minHeight: 40 }} />
                    </div>
                    {/* manage */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {wb ? (
                        <button onClick={() => markWeeklyPaid(r)} disabled={busy === r.id} title="Log this week's payment as received and roll the due date forward one week" style={{ font: `600 12px ${F_SANS}`, color: "#fff", background: "var(--btn-primary-bg)", border: "none", padding: "7px 10px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>✓ Mark paid (+1 wk)</button>
                      ) : db ? (
                        <span title="Payments are summed automatically from this renter's unique TRON address by the daily-payment cron" style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2)", whiteSpace: "nowrap" }}>⟳ Auto-tracked on-chain</span>
                      ) : (
                        <>
                          {(r.status === "active" || r.status === "payment_failed" || r.status === "expired") && (
                            <button onClick={() => handleSendRenewalLink(r.id)} disabled={busy === r.id} style={{ font: `600 12px ${F_SANS}`, color: "var(--link)", background: "var(--link-bg)", border: "none", padding: "7px 10px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>Send renewal</button>
                          )}
                          {!r.autoRenew && (r.status === "active" || r.status === "payment_failed") && (
                            <button onClick={() => handleAutoRenewLink(r.id)} disabled={busy === r.id} title="Generate a recurring-billing link to put this renter on auto-renew" style={{ font: `600 12px ${F_SANS}`, color: "var(--st-active-fg)", background: "transparent", border: "1px solid var(--st-active-fg)", padding: "7px 10px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>Set up auto-renew</button>
                          )}
                        </>
                      )}
                      <div style={{ display: "flex", gap: 6 }}>
                        {restricted ? (
                          <button onClick={() => handleUnrestrict(r)} disabled={busy === r.id} title="Mark recovered — clears the restriction, credits downtime, resumes service" style={outBtn("var(--st-active-fg)")}>{busy === r.id ? "…" : "Resume"}</button>
                        ) : acc === "Paused" ? (
                          <button onClick={() => handleAccess(r.id, "grant")} disabled={busy === r.id} style={outBtn("var(--st-active-fg)")}>{busy === r.id ? "…" : "Resume"}</button>
                        ) : acc === "Granted" ? (
                          <button onClick={() => handleAccess(r.id, "revoke", isManualGrant(r))} disabled={busy === r.id} style={outBtn("var(--orange)")}>{busy === r.id ? "…" : "Pause"}</button>
                        ) : (
                          <button onClick={() => handleAccess(r.id, "grant")} disabled={busy === r.id} style={{ flex: 1, font: `600 12px ${F_SANS}`, color: "#fff", background: "var(--btn-primary-bg)", border: "none", padding: "6px 8px", borderRadius: 8, cursor: "pointer" }}>{busy === r.id ? "…" : "Grant"}</button>
                        )}
                        {(r.status === "active" || r.status === "payment_failed" || r.status === "pending_access") && (
                          <button onClick={() => handleAccess(r.id, "end")} disabled={busy === r.id} style={outBtn("var(--danger)")}>End</button>
                        )}
                      </div>
                      <button onClick={() => handleDeleteRental(r.id)} disabled={busy === r.id} style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2)", background: "transparent", border: "none", cursor: "pointer", padding: 2, alignSelf: "center" }}>🗑 Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Add Rental modal */}
      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.5)", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 16, padding: 24, boxShadow: "0 20px 60px -20px rgba(0,0,0,.6)" }}>
            <h2 style={{ font: `600 18px ${F_GRO}`, color: "var(--text)", margin: "0 0 16px" }}>Add Rental</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={labelCss}>Customer Email<input type="email" value={addForm.userEmail} onChange={(e) => setAddForm((f) => ({ ...f, userEmail: e.target.value }))} placeholder="customer@email.com" style={{ ...modalInput, marginTop: 5 }} /></label>
              <label style={labelCss}>Account<select value={addForm.linkedinAccountId} onChange={(e) => setAddForm((f) => ({ ...f, linkedinAccountId: e.target.value }))} style={{ ...modalInput, marginTop: 5 }}><option value="">Select an available account…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></label>
              <label style={labelCss}>Start Date<input type="date" value={addForm.startDate} onChange={(e) => setAddForm((f) => ({ ...f, startDate: e.target.value }))} style={{ ...modalInput, marginTop: 5 }} /><span style={{ display: "block", font: `500 11px ${F_SANS}`, color: "var(--muted)", marginTop: 4, textTransform: "none", letterSpacing: 0 }}>Billing period is 1 month — next date is set automatically one month out.</span></label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, font: `500 13px ${F_SANS}`, color: "var(--text)" }}><input type="checkbox" checked={addForm.autoRenew} onChange={(e) => setAddForm((f) => ({ ...f, autoRenew: e.target.checked }))} />Auto-renew</label>
              {addError && <p style={{ font: `500 13px ${F_SANS}`, color: "var(--danger)", margin: 0 }}>{addError}</p>}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => setShowAdd(false)} style={{ font: `600 13px ${F_SANS}`, color: "var(--btn-secondary-fg)", background: "var(--btn-secondary-bg)", border: "1px solid var(--btn-secondary-border)", padding: "9px 15px", borderRadius: 10, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleAdd} disabled={adding} style={{ font: `600 13px ${F_SANS}`, color: "#fff", background: "var(--btn-primary-bg)", border: "none", padding: "9px 16px", borderRadius: 10, cursor: "pointer", opacity: adding ? 0.6 : 1 }}>{adding ? "Creating…" : "Create Rental"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const modalInput: React.CSSProperties = { width: "100%", background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 9, padding: "9px 12px", font: `500 13px var(--font-sans),system-ui,sans-serif`, color: "var(--input-fg)", outline: "none" };
