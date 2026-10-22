"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/utils";

const F_SANS = "var(--font-sans),system-ui,sans-serif";
const F_GRO = "var(--font-grotesk),system-ui,sans-serif";

type Status = "planned" | "needs_info" | "done" | "rejected";

interface Req {
  id: string;
  status: Status;
  field: string;
  label: string;
  detail: string;
  fileUrl: string | null;
  plannedFor: string;
  appliedAt: string | null;
  adminNote: string | null;
  createdAt: string;
  rentalId: string;
  account: { name: string; url: string | null };
  renter: { name: string; email: string };
}

const SMETA: Record<Status, { label: string; bg: string; fg: string }> = {
  planned: { label: "Planned", bg: "#e8eefc", fg: "#1550e8" },
  needs_info: { label: "Needs info", bg: "#fef3c7", fg: "#b45309" },
  done: { label: "Done", bg: "#e7f7ee", fg: "#0f7a3d" },
  rejected: { label: "Rejected", bg: "#fdecec", fg: "#b91c1c" },
};

const GRID = "minmax(0,1.5fr) minmax(0,2fr) 150px 220px";
const fmt = (d?: string | null) => (d ? formatDate(d) : "—");
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export default function AdminProfileChangesPage() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"open" | "done" | "rejected" | "all">("open");
  const [query, setQuery] = useState("");
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  // Inline reason capture for needs_info / reject: { id, action, text }.
  const [noteFor, setNoteFor] = useState<{ id: string; action: "needs_info" | "reject"; text: string } | null>(null);

  const refresh = () => fetch("/api/admin/profile-changes").then((r) => r.json()).then((d) => setReqs(d.requests || [])).catch(() => {});
  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(""), 2400); };

  const act = async (id: string, body: object, msg: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/profile-changes/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); flash(d.error || "That didn't work."); return; }
      setNoteFor(null);
      await refresh();
      flash(msg);
    } catch { flash("That didn't work."); }
    finally { setBusy(null); }
  };

  const tabOf = (r: Req): "open" | "done" | "rejected" => (r.status === "planned" || r.status === "needs_info" ? "open" : r.status === "done" ? "done" : "rejected");
  const inClient = (r: Req) => !client || r.renter.email === client;
  const matchesQuery = (r: Req) => { const q = query.trim().toLowerCase(); return !q || `${r.renter.name} ${r.renter.email} ${r.account.name} ${r.detail}`.toLowerCase().includes(q); };
  const tabCount = (t: "open" | "done" | "rejected" | "all") => reqs.filter((r) => inClient(r) && (t === "all" || tabOf(r) === t)).length;
  const overdueCount = reqs.filter((r) => inClient(r) && r.status === "planned" && new Date(r.plannedFor).getTime() < startOfToday()).length;

  const clients = useMemo(() => {
    const m = new Map<string, { email: string; label: string; n: number; open: number }>();
    for (const r of reqs) {
      let row = m.get(r.renter.email);
      if (!row) { row = { email: r.renter.email, label: r.renter.name, n: 0, open: 0 }; m.set(r.renter.email, row); }
      row.n++;
      if (tabOf(r) === "open") row.open++;
    }
    return [...m.values()].sort((a, b) => b.open - a.open || b.n - a.n);
  }, [reqs]);

  const rows = reqs.filter((r) => inClient(r) && (tab === "all" || tabOf(r) === tab) && matchesQuery(r));
  const TABS: [typeof tab, string][] = [["open", "To do"], ["done", "Done"], ["rejected", "Rejected"], ["all", "All"]];

  const btn = (label: string, onClick: () => void, variant: "primary" | "ghost" | "danger", key: string) => (
    <button key={key} disabled={busy === key} onClick={onClick}
      style={{ border: variant === "primary" ? "none" : `1px solid ${variant === "danger" ? "#f0b7b7" : "#d5dbe5"}`, background: variant === "primary" ? "#0f7a3d" : "#fff", color: variant === "primary" ? "#fff" : variant === "danger" ? "#b91c1c" : "#3b4657", borderRadius: 8, padding: "6px 11px", fontWeight: 700, fontSize: 12, cursor: busy === key ? "default" : "pointer", opacity: busy === key ? 0.6 : 1, fontFamily: F_SANS, whiteSpace: "nowrap" }}>
      {label}
    </button>
  );

  return (
    <div style={{ fontFamily: F_SANS, color: "#0b1220", maxWidth: 1180, margin: "0 auto", padding: "26px 22px 60px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: F_GRO, fontWeight: 800, fontSize: 26, margin: 0 }}>Profile changes</h1>
        <span style={{ fontWeight: 500, fontSize: 13.5, color: "#5b6779" }}>Renter-requested edits — apply about one every two days, oldest planned first.</span>
      </div>
      {overdueCount > 0 && (
        <div style={{ marginTop: 12, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "9px 13px", fontWeight: 700, fontSize: 13, color: "#9a3412" }}>
          {overdueCount} {overdueCount === 1 ? "change is" : "changes are"} due now (planned date reached).
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 7, marginTop: 16, flexWrap: "wrap" }}>
        {TABS.map(([t, label]) => {
          const on = tab === t; const n = tabCount(t);
          return (
            <button key={t} onClick={() => setTab(t)} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: `1px solid ${on ? "#0b1220" : "#d5dbe5"}`, background: on ? "#0b1220" : "#fff", color: on ? "#fff" : "#3b4657", borderRadius: 999, padding: "6px 13px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: F_SANS }}>
              {label}<span style={{ fontWeight: 700, fontSize: 11.5, background: on ? "rgba(255,255,255,.22)" : "#eef0f4", color: on ? "#fff" : "#5b6779", borderRadius: 999, padding: "1px 7px" }}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search renter or account…" style={{ border: "1px solid #d5dbe5", borderRadius: 9, padding: "8px 12px", fontSize: 13.5, fontFamily: F_SANS, minWidth: 230, outline: "none" }} />
        {clients.length > 1 && (
          <select value={client} onChange={(e) => setClient(e.target.value)} style={{ border: "1px solid #d5dbe5", borderRadius: 9, padding: "8px 12px", fontSize: 13.5, fontFamily: F_SANS, outline: "none" }}>
            <option value="">All renters</option>
            {clients.map((c) => <option key={c.email} value={c.email}>{c.label}{c.open ? ` (${c.open} to do)` : ""}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div style={{ marginTop: 16, border: "1px solid #e6e9ee", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: "10px 18px", padding: "11px 18px", background: "#fafbfc", borderBottom: "1px solid #eef0f4", fontWeight: 700, fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "#8a93a3" }}>
          <span>Account · renter</span><span>Change</span><span>Planned</span><span>Status · next step</span>
        </div>
        {loading ? (
          <p style={{ padding: "40px 0", textAlign: "center", color: "#8a93a3", fontWeight: 500, fontSize: 14 }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ padding: "40px 0", textAlign: "center", color: "#8a93a3", fontWeight: 500, fontSize: 14 }}>Nothing here. {tab === "open" ? "No requests waiting." : "No requests."}</p>
        ) : rows.map((r, i) => {
          const s = SMETA[r.status];
          const overdue = r.status === "planned" && new Date(r.plannedFor).getTime() < startOfToday();
          const open = r.status === "planned" || r.status === "needs_info";
          const noting = noteFor?.id === r.id;
          return (
            <div key={r.id} style={{ borderTop: i === 0 ? "none" : "1px solid #eef0f4" }}>
              <div style={{ display: "grid", gridTemplateColumns: GRID, gap: "10px 18px", padding: "14px 18px", alignItems: "center" }}>
                {/* account + renter */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.account.name}</span>
                    {r.account.url && <a href={r.account.url} target="_blank" rel="noopener noreferrer" style={{ flex: "none", color: "#0a66c2", fontWeight: 800, fontSize: 11, textDecoration: "none" }}>in ↗</a>}
                  </div>
                  <div style={{ fontWeight: 500, fontSize: 12, color: "#5b6779", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.renter.name}</div>
                  <div style={{ fontWeight: 500, fontSize: 11, color: "#8a93a3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.renter.email}</div>
                </div>
                {/* change */}
                <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
                  {r.fileUrl && <img src={r.fileUrl} alt="" style={{ flex: "none", width: 72, height: 18, objectFit: "cover", borderRadius: 4, border: "1px solid #e6e9ee", background: "#eef0f4" }} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>{r.label}</div>
                    <div style={{ fontWeight: 500, fontSize: 12.5, color: "#5b6779", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.detail}>{r.detail || "—"}</div>
                    {r.fileUrl && <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, fontSize: 11.5, color: "#1550e8", textDecoration: "none" }}>Open image ↗</a>}
                  </div>
                </div>
                {/* planned */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: overdue ? "#b91c1c" : "#0b1220" }}>{fmt(r.plannedFor)}</div>
                  {overdue && <div style={{ fontWeight: 700, fontSize: 11, color: "#b91c1c" }}>Due now</div>}
                  {r.status === "done" && r.appliedAt && <div style={{ fontWeight: 500, fontSize: 11, color: "#0f7a3d" }}>Applied {fmt(r.appliedAt)}</div>}
                </div>
                {/* status + actions */}
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 7, alignItems: "flex-start" }}>
                  <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: "3px 10px", fontWeight: 700, fontSize: 11.5 }}>{s.label}</span>
                  {open && !noting && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {btn("Mark done", () => act(r.id, { action: "done" }, "Marked done · renter emailed"), "primary", r.id)}
                      {btn("Needs info", () => setNoteFor({ id: r.id, action: "needs_info", text: "" }), "ghost", r.id + "-ni")}
                      {btn("Reject", () => setNoteFor({ id: r.id, action: "reject", text: "" }), "danger", r.id + "-rj")}
                    </div>
                  )}
                  {(r.status === "needs_info" || r.status === "rejected") && r.adminNote && !noting && (
                    <div style={{ fontWeight: 500, fontSize: 11.5, color: r.status === "rejected" ? "#b91c1c" : "#b45309" }}>“{r.adminNote}”</div>
                  )}
                </div>
              </div>
              {/* inline reason input */}
              {noting && (
                <div style={{ padding: "0 18px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input autoFocus value={noteFor!.text} onChange={(e) => setNoteFor((p) => (p ? { ...p, text: e.target.value } : p))}
                    placeholder={noteFor!.action === "reject" ? "Why we won't apply this (shown to the renter)…" : "What we need from the renter…"}
                    style={{ flex: "1 1 320px", border: "1px solid #d5dbe5", borderRadius: 9, padding: "8px 12px", fontSize: 13, fontFamily: F_SANS, outline: "none" }} />
                  {btn(noteFor!.action === "reject" ? "Reject & send" : "Send", () => act(r.id, { action: noteFor!.action, note: noteFor!.text }, noteFor!.action === "reject" ? "Rejected" : "Marked needs-info"), noteFor!.action === "reject" ? "danger" : "ghost", r.id)}
                  {btn("Cancel", () => setNoteFor(null), "ghost", r.id + "-cx")}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 26, transform: "translateX(-50%)", background: "#0b1220", color: "#fff", borderRadius: 999, padding: "10px 18px", fontWeight: 700, fontSize: 13, fontFamily: F_SANS, boxShadow: "0 12px 30px rgba(11,18,32,.3)", zIndex: 60 }}>{toast}</div>
      )}
    </div>
  );
}
