"use client";

// Pipeline (New) — v2 triage view. Same data + same endpoints as /admin/pipeline
// (nothing here writes anywhere the live pipeline doesn't), reorganised around
// WHOSE TURN it is: To action / Waiting on them / Maturing / Onboarded / Stopped,
// with a handler lens, claim/bulk-assign, and the same expanded-row panel.
import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/referral-currency";
import { formatName } from "@/lib/utils";
import { isLikelyTestEmail } from "@/lib/test-mode";
import { CardDetail, AccountOnlyCard } from "@/components/admin/pipeline-panel";
import {
  type Row, type Status, type Turn, F_SANS, F_GRO, labelCss, inputCss,
  applicationType, effectiveType, effectiveTypeKey, APPLICATION_TYPES, levelOf, levelKey, LEVEL_CHIP, LEVEL_GROUPS,
  healthOf, HEALTH_OPTIONS, isRestricted, turnOf,
  cfgOf, monthlyAmt, fmtDate, ageDays, initialsOf, lastTouchActivity,
} from "@/lib/pipeline-model";

// Tile / turn-chip vocabulary.
const TURN_META: Record<Turn | "all", { tile: string; chip: string; bg: string; fg: string; dot: string; sub: string }> = {
  all:   { tile: "All", chip: "ALL", bg: "var(--blue-chip-bg,#e8f0fe)", fg: "var(--blue-chip-text,#1a56db)", dot: "var(--blue-chip-text,#1a56db)", sub: "every pipeline stage" },
  us:    { tile: "To action",       chip: "ACTION",    bg: "var(--warn-badge-bg,#fef3e2)", fg: "var(--warn-badge-text,#b7791f)", dot: "var(--warn-badge-text,#b7791f)", sub: "needs us now" },
  recovery: { tile: "In recovery",  chip: "RECOVERY",  bg: "var(--rose-chip-bg,#fff1f2)",  fg: "var(--rose-chip-text,#be123c)",  dot: "var(--rose-chip-text,#be123c)",  sub: "restricted · handle in Restrictions" },
  them:  { tile: "Waiting on them", chip: "WAITING",   bg: "var(--blue-chip-bg,#e8f0fe)",  fg: "var(--blue-chip-text,#1a56db)",  dot: "var(--blue-chip-text,#1a56db)",  sub: "applicant or referrer" },
  timer: { tile: "Maturing",        chip: "TIMER",     bg: "var(--st-conv-bg,#efe8fd)",    fg: "var(--st-conv-fg,#6d28d9)",      dot: "var(--st-conv-fg,#6d28d9)",      sub: "1-week hold" },
  live:  { tile: "Onboarded",       chip: "ONBOARDED", bg: "var(--st-active-bg,#e6f4ea)",  fg: "var(--st-active-fg,#188038)",    dot: "var(--st-active-fg,#188038)",    sub: "live & earning" },
  dead:  { tile: "Stopped",         chip: "STOPPED",   bg: "var(--st-cancel-bg,#fdecea)",  fg: "var(--st-cancel-fg,#c0392b)",    dot: "var(--st-cancel-fg,#c0392b)",    sub: "not progressing" },
};
const TURN_ORDER: (Turn | "all")[] = ["all", "us", "recovery", "them", "timer", "live", "dead"];
const GROUP_OPTS: { key: string; label: string }[] = [
  { key: "level", label: "Level" }, { key: "handler", label: "Handler" }, { key: "referrer", label: "Referrer" }, { key: "none", label: "None" },
];
// A distinct, stable colour per handler so the "Handled by" chips read at a glance.
// Known handlers get fixed colours; anyone else is hashed into the palette.
const HANDLER_PALETTE = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4f46e5", "#ca8a04", "#be185d"];
const HANDLER_FIXED: Record<string, string> = { ardi: "#2563eb", giana: "#db2777", sam: "#059669", ton: "#d97706", milee: "#7c3aed" };
const handlerColor = (name: string): string => {
  const key = (name || "").trim().toLowerCase().split(/\s+/)[0];
  if (HANDLER_FIXED[key]) return HANDLER_FIXED[key];
  let h = 0; for (const ch of key) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return HANDLER_PALETTE[h % HANDLER_PALETTE.length];
};
// Application-type pill colours (matches the mock: Form grey, Email/2FA blue, Full-service purple).
const TYPE_COLOR: Record<string, [string, string]> = {
  standard: ["#eef1f5", "#334155"], partial: ["#e0f2fe", "#075985"], full: ["#ede9fe", "#5b21b6"], unknown: ["#f1f3f6", "#9aa0a6"],
};
const typeColor = (r: Row) => TYPE_COLOR[effectiveTypeKey(r)] || TYPE_COLOR.unknown;
// Level pill colours by ladder stage (matches the mock STAGES palette).
const LEVEL_PILL: Record<string, [string, string]> = {
  "0.5": ["#fef3c7", "#92400e"], "1": ["#dbeafe", "#1e40af"], "2": ["#dbeafe", "#1e40af"], "3": ["#ffedd5", "#9a3412"], "4": ["#ede9fe", "#5b21b6"], "5": ["#dcfce7", "#166534"], "0": ["#fee2e2", "#991b1b"],
};
const levelPill = (lvl: number) => LEVEL_PILL[String(lvl)] || LEVEL_PILL["1"];

export default function PipelineNewPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [me, setMe] = useState<string>("");
  const [turnF, setTurnF] = useState<Turn | "all">("all");
  const [whoF, setWhoF] = useState<string>("all"); // "all" | "__me" | "__unassigned" | <poc>
  const [levelF, setLevelF] = useState<number | "all">("all");
  const [healthF, setHealthF] = useState<string>("all");
  const [typeF, setTypeF] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<string>("level");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Maturing daily check: walk the 1-week-hold accounts, log today's connections + a ✓/✕ health tick.
  const [checkMode, setCheckMode] = useState(false);
  // Mirror checkMode into a ref so the background-refresh effect (mounted once, empty deps) can read
  // the current value and PAUSE while the daily check is open. Without this, the 10s interval — or a
  // window focus/visibility change (e.g. tabbing out to verify an account, then back) — refetches and
  // rebuilds rows from the server, dropping an optimistic ✓/✕ tick that hasn't committed yet. That's
  // the "the check reverts, then goes back to check itself on its own" bug: the stale refetch unchecks
  // it, the next refetch (after the save lands) re-checks it.
  const checkModeRef = useRef(checkMode);
  checkModeRef.current = checkMode;
  const [hideDone, setHideDone] = useState(false);
  const [connDraft, setConnDraft] = useState<Record<string, string>>({});

  const flashSave = (ok: boolean, text: string) => { setSaveMsg({ ok, text }); window.setTimeout(() => setSaveMsg((m) => (m && m.text === text ? null : m)), ok ? 1800 : 6000); };
  const toggle = (id: string) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = (k: string) => setClosed((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleSel = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const load = async () => {
    try {
      const [onb, amb] = await Promise.all([
        fetch("/api/admin/onboarding", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { rows: [] })),
        fetch("/api/admin/ambassadors", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { applications: [] })),
      ]);
      const overlay = new Map<string, Pick<Row, "onboardingStartedAt" | "paidAt" | "verifiedAt" | "monthlyPayouts" | "call">>();
      for (const a of (amb.applications || [])) {
        overlay.set(a.id, {
          onboardingStartedAt: a.onboardingStartedAt ?? null,
          paidAt: a.paidAt ?? null,
          verifiedAt: a.verifiedAt ?? null,
          monthlyPayouts: Array.isArray(a.monthlyPayouts) ? a.monthlyPayouts : null,
          call: a.call ? { stage: a.call.stage, scheduledAt: a.call.scheduledAt ?? null, meetLink: a.call.meetLink ?? null } : null,
        });
      }
      const merged: Row[] = (onb.rows || []).map((r: Row) => {
        const o = overlay.get(r.id);
        return { ...r, onboardingStartedAt: o?.onboardingStartedAt ?? null, paidAt: o?.paidAt ?? r.setupPaidAt ?? null, verifiedAt: o?.verifiedAt ?? r.verifiedAt ?? null, monthlyPayouts: o?.monthlyPayouts ?? null, call: o?.call ?? null };
      });
      setRows(merged);
    } catch { setError(true); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.user) setMe(d.user.fullName || d.user.email || ""); }).catch(() => {}); }, []);
  // Background refresh — keep the pipeline current, preserve overlay fields.
  useEffect(() => {
    let stopped = false; let refreshing = false;
    const refresh = async () => {
      // Pause while the daily check is open so a refetch can't clobber an uncommitted ✓/✕ tick.
      if (checkModeRef.current || document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      try {
        const res = await fetch("/api/admin/onboarding", { cache: "no-store" });
        if (!res.ok) return; const data = await res.json(); if (stopped || !Array.isArray(data.rows)) return;
        setRows((previous) => {
          const existing = new Map((previous || []).map((row) => [row.id, row]));
          return data.rows.map((row: Row) => { const prior = existing.get(row.id); return { ...row, onboardingStartedAt: prior?.onboardingStartedAt ?? null, paidAt: prior?.paidAt ?? row.setupPaidAt ?? null, verifiedAt: row.verifiedAt ?? prior?.verifiedAt ?? null, monthlyPayouts: prior?.monthlyPayouts ?? null, call: prior?.call ?? null }; });
        });
      } catch { /* keep current */ } finally { refreshing = false; }
    };
    const timer = window.setInterval(refresh, 10000);
    document.addEventListener("visibilitychange", refresh); window.addEventListener("focus", refresh);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, []);

  // ---- mutations (identical endpoints to the live pipeline) ----
  const patchApp = async (id: string, patch: Record<string, unknown>, reload = false) => {
    setRows((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...patch } : r)) : prev));
    try {
      const res = await fetch(`/api/admin/ambassadors/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Save failed (${res.status})`);
      flashSave(true, "Saved ✓"); if (reload) await load();
    } catch (e) { flashSave(false, e instanceof Error ? e.message : "Save failed — not saved. Please retry."); await load(); }
  };
  const patchAccount = async (id: string, accountId: string, patch: Record<string, unknown>, reload = false) => {
    setRows((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...patch } : r)) : prev));
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data: { error?: string; notify?: { sent?: { recipient: string }[]; skipped?: { recipient: string; reason: string }[] } } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Save failed (${res.status})`);
      flashSave(true, "Saved ✓");
      // Report the restricted-notice email outcome when one was requested (restrict + "email now").
      if (data.notify) {
        const sent = (data.notify.sent || []).map((x) => x.recipient).join(" + ");
        const skipped = (data.notify.skipped || []).map((x) => `${x.recipient} (${x.reason})`).join(", ");
        alert(sent ? `Restriction emailed to: ${sent}.${skipped ? ` Skipped: ${skipped}.` : ""}` : `No one emailed.${skipped ? ` Skipped: ${skipped}.` : ""}`);
      }
      if (reload) await load();
    } catch (e) { flashSave(false, e instanceof Error ? e.message : "Save failed — not saved. Please retry."); await load(); }
  };
  const deleteRestrictionEvent = async (accountId: string, at: string) => {
    try { await fetch(`/api/admin/accounts/${accountId}/restricted`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ at }) }); } catch {}
    await load();
  };
  const setStage = async (r: Row, status: Status) => {
    setBusy(r.id);
    try {
      const res = await fetch("/api/admin/onboarding/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, status }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(typeof d.error === "string" ? d.error : `Could not update status (${res.status}).`); return; }
      await load();
    } finally { setBusy(null); }
  };
  const workflow = async (id: string, patch: Record<string, unknown>) => { setBusy(id); try { await patchApp(id, patch, true); } finally { setBusy(null); } };
  const provisionGologin = async (r: Row) => {
    if (!r.accountId) return; setBusy(r.id);
    try {
      const res = await fetch("/api/admin/onboarding/provision-gologin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: r.accountId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) alert(typeof d.error === "string" ? d.error : `Could not create GoLogin (${res.status}).`);
      else if (d.result?.proxy === "flagged") { const why = d.result?.errors?.length ? d.result.errors.join("; ") : "no proxy could be assigned"; alert(`Couldn't attach a proxy — ${why}.`); }
      else if (d.result?.errors?.length) alert(`Partly done: ${d.result.errors.join("; ")}`);
      await load();
    } finally { setBusy(null); }
  };
  // Spin up an inventory account linked to this application so the login/2FA/GoLogin fields
  // open up right here — matched back to the app by its LinkedIn URL and an "Owner: email"
  // note. For an app with no account yet (nothing matched), so it can't create a duplicate.
  const createAccount = async (r: Row) => {
    if (r.accountId) return; setBusy(r.id);
    try {
      const res = await fetch("/api/admin/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        linkedinName: formatName(r.fullName) || r.fullName || r.email,
        linkedinUrl: r.linkedinUrl || undefined,
        notes: `Owner: ${r.email}`,
        status: "under_construction",
      }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) alert(typeof d.error === "string" ? d.error : `Could not create account (${res.status}).`);
      await load();
    } finally { setBusy(null); }
  };
  // Resolve a self-service PC sign-in the referrer self-reported: confirm it's actually signed in,
  // send it back for the referrer to retry, or take over the sign-in ourselves (drops to email/2FA tier).
  const verifySignin = async (r: Row, action: "confirm" | "retry" | "takeover") => {
    if (action === "takeover" && !confirm(`Take over ${formatName(r.fullName) || "this"} sign-in?\n\nThe referrer's commission drops to the email/2FA tier and it moves to our sign-in queue.`)) return;
    setBusy(r.id);
    try {
      const res = await fetch("/api/admin/onboarding/verify-signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) alert(typeof d.error === "string" ? d.error : `Could not update (${res.status}).`);
      await load();
    } finally { setBusy(null); }
  };
  const transferToLv = async (r: Row) => {
    if (!confirm(`Transfer ${formatName(r.fullName) || "this"} onboarding to LV?\n\nThe referrer stops here and LV finishes the onboarding. Their commission reverts to the base referral tier (e.g. ₱500), not the DIY tier.`)) return;
    setBusy(r.id);
    try {
      const res = await fetch("/api/admin/onboarding/transfer-to-lv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) alert(typeof d.error === "string" ? d.error : `Could not transfer (${res.status}).`);
      await load();
    } finally { setBusy(null); }
  };
  const deleteGologin = async (r: Row) => {
    if (!r.accountId) return;
    if (!confirm(`Delete the GoLogin profile for ${r.accountName || r.fullName || "this account"}?\n\nThis removes the browser profile, clears the share link, and unassigns the proxy.`)) return;
    setBusy(r.id);
    try {
      const res = await fetch("/api/admin/onboarding/delete-gologin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: r.accountId }) });
      const d = await res.json().catch(() => ({})); if (!res.ok) alert(typeof d.error === "string" ? d.error : `Could not delete GoLogin (${res.status}).`); else if (d.warning) alert(d.warning);
      await load();
    } finally { setBusy(null); }
  };
  const generateProfile = async (r: Row, lane: string) => {
    if (!r.accountId) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/admin/accounts/${r.accountId}/generate-profile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate", lane }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(typeof d.error === "string" ? d.error : `Could not generate (${res.status}).`); return; }
      setRows((prev) => (prev ? prev.map((x) => (x.id === r.id ? { ...x, profileBuild: d.profileBuild } : x)) : prev));
    } finally { setBusy(null); }
  };
  const applyProfile = async (r: Row) => {
    if (!r.accountId) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/admin/accounts/${r.accountId}/generate-profile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(typeof d.error === "string" ? d.error : `Could not save (${res.status}).`); return; }
      setRows((prev) => (prev ? prev.map((x) => (x.id === r.id ? { ...x, profileBuild: d.profileBuild } : x)) : prev));
    } finally { setBusy(null); }
  };
  // ---- Maturing daily check (optimistic, same fields the Inventory daily check writes) ----
  // A daily check is a touch on the record, so log one summarised note (by a person, so it
  // counts) — this bumps the row's "Last touch". Folds in today's connection count.
  const logCheckTouch = (r: Row, health: "healthy" | "restricted") => {
    const d = connDraft[r.id];
    const parsed = d != null ? parseInt(d.replace(/[^0-9]/g, ""), 10) : NaN;
    const conn = Number.isFinite(parsed) ? parsed : r.connectionCount;
    const note = `Maturing daily check${conn != null ? ` — ${conn} connections` : ""} · ${health}`;
    void logTouch(r.id, "note", note, me);
  };
  // Health ✓: mark active + stamp today's check (clears any restriction). ✕: route through the
  // /restricted endpoint (logged) then stamp the check. Both log a touch so Last touch updates.
  const checkHealthy = (r: Row) => {
    if (!r.accountId) return;
    const now = new Date().toISOString();
    setRows((prev) => (prev ? prev.map((x) => (x.id === r.id ? { ...x, linkedinAccountHealth: "active", healthCheckedAt: now, accountRestrictedAt: null } : x)) : prev));
    fetch(`/api/admin/accounts/${r.accountId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linkedinAccountHealth: "active", healthCheckedAt: now, restrictedAt: null }) }).catch(() => load());
    logCheckTouch(r, "healthy");
  };
  const checkRestricted = async (r: Row) => {
    if (!r.accountId) return;
    const now = new Date().toISOString();
    setRows((prev) => (prev ? prev.map((x) => (x.id === r.id ? { ...x, linkedinAccountHealth: "restricted", healthCheckedAt: now, accountRestrictedAt: now } : x)) : prev));
    try {
      await fetch(`/api/admin/accounts/${r.accountId}/restricted`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restricted: true }) });
      await fetch(`/api/admin/accounts/${r.accountId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ healthCheckedAt: now }) });
    } catch { load(); return; }
    logCheckTouch(r, "restricted");
    // One-tap opt-in: email the owner + referrer the restricted notice (same flow as Inventory).
    // Deduped server-side on the restriction timestamp, so confirming twice can't double-send.
    if (!confirm(`Email ${formatName(r.fullName) || "the owner"} and their referrer the restricted notice now?\n\nSends the recovery message (with their login details) and logs it on the account.`)) return;
    try {
      const nr = await fetch(`/api/admin/accounts/${r.accountId}/restrict-notify`, { method: "POST" });
      const nd = await nr.json().catch(() => ({}));
      if (nr.ok) {
        const sentTo = (nd.sent || []).map((s: { recipient: string; to: string }) => `${s.recipient} (${s.to})`).join(", ");
        const skip = (nd.skipped || []).map((s: { recipient: string; reason: string }) => `${s.recipient}: ${s.reason}`).join("; ");
        alert(sentTo ? `Emailed ${sentTo}.${skip ? ` Skipped — ${skip}.` : ""}` : (skip ? `No emails sent — ${skip}.` : "No recipients to email."));
      } else alert(nd.error || "Could not send notifications.");
    } catch { alert("Could not send notifications."); }
  };
  // Save today's connection count (the PATCH route appends to the account's connectionHistory on change).
  const saveConn = (r: Row, raw: string) => {
    if (!r.accountId) return;
    const n = parseInt((raw || "").replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(n) || n === r.connectionCount) return;
    setRows((prev) => (prev ? prev.map((x) => (x.id === r.id ? { ...x, connectionCount: n } : x)) : prev));
    fetch(`/api/admin/accounts/${r.accountId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionCount: n }) }).catch(() => load());
  };
  const emailIssue = async (r: Row, issue: string) => {
    setBusy(r.id);
    try {
      const res = await fetch("/api/admin/onboarding/email-issue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, issue, loginEmail: r.loginEmail, ambassadorName: r.fullName, referrerSlug: r.referredBy }) });
      const d = await res.json().catch(() => ({})); if (!res.ok) alert(typeof d.error === "string" ? d.error : `Could not send (${res.status}).`); else { alert(`Sent to ${d.to}.`); await load(); }
    } finally { setBusy(null); }
  };
  const logTouch = async (id: string, ch: string, text: string, by: string) => {
    const body = text || (({ whatsapp: "WhatsApp message sent", viber: "Viber message sent", telegram: "Telegram message sent", email: "Email sent", call: "Call attempted — no answer", text: "Text message sent", note: "Note added" } as Record<string, string>)[ch] || "Note added");
    setBusy(id);
    setRows((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, outreachLog: [...(r.outreachLog || []), { ch, text: body, by: by || "You", at: new Date().toISOString() }] } : r)) : prev));
    try {
      const res = await fetch(`/api/admin/ambassadors/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addTouch: { ch, text: body, by: by || undefined } }) });
      if (res.ok) { const d = await res.json(); if (d.application?.outreachLog) setRows((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, outreachLog: d.application.outreachLog } : r)) : prev)); }
    } catch {} finally { setBusy(null); }
  };
  const logPayment = async (r: Row, kind: "setup" | "monthly") => {
    const cfg = cfgOf(r); const amount = kind === "setup" ? cfg.setupAmount : monthlyAmt(r);
    const payout: Record<string, unknown> = { amount, kind, method: r.paymentMethod || undefined };
    if (kind === "setup" && r.accountId) payout.accountId = r.accountId;
    const patch: Record<string, unknown> = { addMonthlyPayout: payout };
    if (kind === "setup") patch.paidAt = new Date().toISOString();
    await workflow(r.id, patch);
  };
  const updatePayout = async (r: Row, index: number, patch: { proofUrl?: string | null; notified?: boolean; acknowledged?: boolean }) => {
    await workflow(r.id, { updateMonthlyPayout: { index, ...patch } });
  };
  const deleteApp = async (r: Row) => {
    if (!confirm(`Delete ${formatName(r.fullName) || r.email}'s application permanently? This cannot be undone.`)) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/admin/ambassadors/${r.id}`, { method: "DELETE" }); const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(`Couldn't delete: ${data.error || res.statusText}`); return; }
      if (data.accountKept) alert("Application deleted. The linked LinkedIn account was kept because it's listed or has been rented.");
      await load();
    } finally { setBusy(null); }
  };
  // Assign a handler (POC) to a set of rows — app rows via bulk-poc, inventory-only via account PATCH.
  const assignMany = async (ids: string[], poc: string | null) => {
    if (!ids.length) return;
    const byId = new Map((rows || []).map((r) => [r.id, r]));
    const picked = ids.map((id) => byId.get(id)).filter(Boolean) as Row[];
    const appIds = picked.filter((r) => !r.accountOnly).map((r) => r.id);
    const acctRows = picked.filter((r) => r.accountOnly && r.accountId);
    const idSet = new Set(ids);
    setRows((prev) => (prev ? prev.map((r) => (idSet.has(r.id) ? { ...r, poc: poc || null } : r)) : prev));
    try {
      if (appIds.length) { const res = await fetch("/api/admin/ambassadors/bulk-poc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: appIds, poc }) }); if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Failed (${res.status})`); }
      if (acctRows.length) await Promise.all(acctRows.map((r) => fetch(`/api/admin/accounts/${r.accountId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ poc }) }).then((res) => { if (!res.ok) throw new Error("account PoC save failed"); })));
      flashSave(true, `${poc ? "Assigned" : "Unassigned"} ${ids.length} ${ids.length === 1 ? "row" : "rows"}${poc ? " → " + poc : ""} ✓`);
    } catch (e) { flashSave(false, e instanceof Error ? e.message : "Assign failed — not saved."); await load(); }
  };
  const claim = (r: Row) => { if (me) assignMany([r.id], me); };

  const handlers = { busy: busy !== null, patchApp, patchAccount, deleteRestrictionEvent, setStage, workflow, provisionGologin, createAccount, verifySignin, transferToLv, deleteGologin, emailIssue, generateProfile, applyProfile, logTouch, logPayment, updatePayout, onDeleteApp: deleteApp };

  // Distinct handlers present (for chips + bulk menu).
  const handlerNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows || []) { const p = (r.poc || "").trim(); if (p) s.add(p); }
    if (me) s.add(me);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows, me]);

  const withTurn = useMemo(() => (rows || []).map((r) => ({ r, t: turnOf(r) })), [rows]);

  // Maturing daily check scope: the 1-week-hold rows that have a linked account to check.
  const maturingCheck = useMemo(() => withTurn.filter(({ r, t }) => t.turn === "timer" && !!r.accountId).map((x) => x.r), [withTurn]);
  const isCheckedToday = (r: Row) => !!r.healthCheckedAt && new Date(r.healthCheckedAt).toDateString() === new Date().toDateString();
  const dcTotal = maturingCheck.length;
  const dcDone = maturingCheck.filter(isCheckedToday).length;

  // Tile counts — over everything (ignores the who/level/search filters, like a scoreboard).
  const tileCounts = useMemo(() => {
    const c: Record<Turn, number> = { us: 0, recovery: 0, them: 0, timer: 0, live: 0, dead: 0 };
    for (const { t } of withTurn) c[t.turn]++;
    return c;
  }, [withTurn]);
  // Per-handler open-action load (turn === us), including resurfaced chases.
  const handlerLoad = useMemo(() => {
    const m = new Map<string, number>(); let unclaimed = 0;
    for (const { r, t } of withTurn) if (t.turn === "us") { const p = (r.poc || "").trim(); if (p) m.set(p, (m.get(p) || 0) + 1); else unclaimed++; }
    return { m, unclaimed, total: withTurn.filter((x) => x.t.turn === "us").length };
  }, [withTurn]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return withTurn.filter(({ r, t }) => {
      if (turnF !== "all" && t.turn !== turnF) return false;
      if (whoF !== "all") { const p = (r.poc || "").trim(); if (whoF === "__unassigned" ? p !== "" : whoF === "__me" ? p !== me : p !== whoF) return false; }
      if (levelF !== "all" && levelKey(r) !== levelF) return false;
      if (healthF !== "all") { if (healthF === "maturing") { if (!r.maturingStartedAt) return false; } else if (healthF === "restricted") { if (!isRestricted(r)) return false; } else if (healthOf(r) !== healthF) return false; }
      if (typeF !== "all" && effectiveTypeKey(r) !== typeF) return false;
      if (!q) return true;
      return [r.fullName, r.email, r.contactNumber, r.loginEmail, r.personalEmail, r.linkedinEmail, r.referredBy, r.poc, ...(r.outreachLog || []).map((x) => x.text)].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [withTurn, turnF, whoF, me, levelF, healthF, typeF, query]);

  type Grp = { key: string; title: string; dot: string; note: string; items: { r: Row; t: ReturnType<typeof turnOf> }[] };
  const groups: Grp[] = useMemo(() => {
    const byNewest = (a: { r: Row }, b: { r: Row }) => +new Date(b.r.createdAt) - +new Date(a.r.createdAt);
    const sorted = [...filtered].sort(byNewest);
    if (groupBy === "none") return [{ key: "all", title: "All", dot: "var(--fg,#111)", note: "newest first", items: sorted }];
    if (groupBy === "handler") {
      const defs = [...handlerNames.map((n) => ({ k: n, t: n, c: handlerColor(n) })), { k: "__un", t: "Unclaimed", c: "var(--warn-badge-text,#b7791f)" }];
      return defs.map((d) => ({ key: "h" + d.k, title: d.t, dot: d.c, note: "", items: sorted.filter(({ r }) => (d.k === "__un" ? !(r.poc || "").trim() : (r.poc || "").trim() === d.k)) })).filter((g) => g.items.length);
    }
    if (groupBy === "referrer") {
      const refs = [...new Set(sorted.map(({ r }) => (r.referredBy || "—")))].sort();
      return refs.map((rf) => ({ key: "r" + rf, title: rf, dot: "var(--blue-chip-text,#1a56db)", note: "", items: sorted.filter(({ r }) => (r.referredBy || "—") === rf) })).filter((g) => g.items.length);
    }
    // level
    return LEVEL_GROUPS.map((d) => {
      let items = sorted.filter(({ r }) => levelKey(r) === d.key);
      // Onboarded (L5): order by when they were onboarded (newest first), not by application date,
      // so someone you just onboarded floats to the top instead of being buried by old apply dates.
      if (d.key === 5) items = [...items].sort((a, b) => +new Date(b.r.onboardedAt || b.r.createdAt) - +new Date(a.r.onboardedAt || a.r.createdAt));
      return { key: "l" + d.key, title: d.label, dot: d.dot, note: d.key === 5 ? "newest onboarded first" : d.note, items };
    }).filter((g) => g.items.length);
  }, [filtered, groupBy, handlerNames]);

  const selArr = [...sel];
  const totalLive = useMemo(() => (rows || []).filter((r) => levelOf(r) === 5).length, [rows]);

  if (error) return <div style={{ padding: 40, font: `500 14px ${F_SANS}`, color: "var(--muted,#777)" }}>Couldn’t load the pipeline. Refresh to retry.</div>;

  // ── Maturing daily check — focused walk of the 1-week-hold accounts ──
  if (checkMode) {
    const list = hideDone ? maturingCheck.filter((r) => !isCheckedToday(r)) : maturingCheck;
    return (
      <div style={{ maxWidth: 940, margin: "0 auto", padding: "8px 4px 60px" }}>
        {saveMsg && <div role="status" onClick={() => setSaveMsg(null)} style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 100, cursor: "pointer", font: `700 13px ${F_SANS}`, padding: "10px 16px", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,.14)", background: saveMsg.ok ? "var(--st-active-bg,#e6f4ea)" : "var(--st-cancel-bg,#fdecea)", color: saveMsg.ok ? "var(--st-active-fg,#188038)" : "var(--st-cancel-fg,#c0392b)", border: `1px solid ${saveMsg.ok ? "var(--st-active-fg,#188038)" : "var(--st-cancel-fg,#c0392b)"}` }}>{saveMsg.ok ? saveMsg.text : `⚠ ${saveMsg.text}`}</div>}

        <div style={{ marginBottom: 14 }}>
          <h1 style={{ font: `800 24px ${F_GRO}`, margin: "0 0 4px", color: "var(--fg,#111)" }}>Maturing · daily check</h1>
          <p style={{ font: `500 13px ${F_SANS}`, color: "var(--muted,#777)", margin: 0 }}>Log today’s connections and tick each account healthy or restricted, so you can see the warm-up is working.</p>
        </div>

        {/* sticky progress bar */}
        <div style={{ position: "sticky", top: 10, zIndex: 5, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: "var(--btn-dark-bg,#0b1220)", color: "#fff", borderRadius: 12, padding: "10px 14px", boxShadow: "0 10px 30px rgba(11,18,32,.2)", marginBottom: 14 }}>
          <span style={{ font: `700 13.5px ${F_SANS}`, whiteSpace: "nowrap" }}>Daily check</span>
          <div style={{ flex: "1 1 200px", display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ flex: 1, height: 6, borderRadius: 6, background: "#273246", overflow: "hidden", display: "block" }}><span style={{ display: "block", height: "100%", width: `${dcTotal ? (dcDone / dcTotal) * 100 : 0}%`, background: "#34d399", transition: "width .3s" }} /></span>
            <span style={{ font: `700 13px ${F_GRO}`, whiteSpace: "nowrap" }}>{dcDone} / {dcTotal}</span>
          </div>
          <span style={{ font: `500 12px ${F_SANS}`, color: "#a7b0bf", whiteSpace: "nowrap" }}>Type connections + Enter · tick ✓ or ✕</span>
          <button onClick={() => setHideDone((h) => !h)} style={{ border: "1px solid #2a3344", background: hideDone ? "#1f2a3c" : "transparent", color: "#fff", borderRadius: 8, padding: "6px 11px", font: `700 12px ${F_SANS}`, cursor: "pointer" }}>{hideDone ? "Show done" : "Hide done"}</button>
          <button onClick={() => { setCheckMode(false); load(); }} style={{ border: "none", background: "#fff", color: "var(--fg,#0b1220)", borderRadius: 8, padding: "6px 12px", font: `700 12px ${F_SANS}`, cursor: "pointer" }}>Done</button>
        </div>

        <div style={{ background: "var(--card,#fff)", border: "1px solid var(--card-border,#e3e3e6)", borderRadius: 14, overflow: "hidden" }}>
          {list.length === 0 && <div style={{ padding: 40, textAlign: "center", font: `600 13.5px ${F_SANS}`, color: "var(--muted,#777)" }}>{dcTotal === 0 ? "No maturing accounts to check right now." : "All caught up — every maturing account is checked for today. ✓"}</div>}
          {list.map((r) => {
            const done = isCheckedToday(r);
            const restricted = isRestricted(r);
            const warmDays = r.warmupStartedAt ? ageDays(r.warmupStartedAt) : null;
            const hist = Array.isArray(r.connectionHistory) ? r.connectionHistory : [];
            const first = hist.length ? hist[0] : null;
            const grew = first && typeof r.connectionCount === "number" ? r.connectionCount - first.count : null;
            const hcText = restricted ? "restricted" : r.healthCheckedAt ? `✓ checked ${fmtDate(r.healthCheckedAt)}` : "not yet checked";
            const draft = connDraft[r.id];
            const dirty = draft != null && draft !== String(r.connectionCount ?? "");
            return (
              <div key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) 150px minmax(0,1fr) 80px", gap: 14, alignItems: "center", padding: "11px 16px", borderBottom: "1px solid var(--divider,#f0f2f5)", background: done && !restricted ? "var(--st-active-bg,#f1faf4)" : "var(--card,#fff)" }}>
                {/* who */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ font: `700 14px ${F_SANS}`, color: "var(--fg,#111)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatName(r.fullName) || r.accountName || "—"}</span>
                    {warmDays != null && <span title={`Warming up since ${fmtDate(r.warmupStartedAt)}`} style={{ flex: "none", font: `700 10px ${F_SANS}`, padding: "2px 7px", borderRadius: 999, background: "var(--warn-badge-bg,#fef3c7)", color: "var(--warn-badge-text,#b7791f)" }}>🔥 {warmDays}d</span>}
                    {r.linkedinUrl && <a href={r.linkedinUrl.startsWith("http") ? r.linkedinUrl : `https://${r.linkedinUrl}`} target="_blank" rel="noopener noreferrer" title="Open LinkedIn ↗" style={{ flex: "none", font: `700 10px ${F_SANS}`, padding: "2px 7px", borderRadius: 999, background: "var(--blue-chip-bg,#e8f0fe)", color: "var(--blue-chip-text,#1a56db)", textDecoration: "none" }}>in ↗</a>}
                  </div>
                  <div style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted2,#9aa0a6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.loginEmail || r.email}</div>
                </div>
                {/* connections */}
                <div>
                  <input autoComplete="off" defaultValue={r.connectionCount ?? ""} key={`c-${r.id}-${r.connectionCount}`} onChange={(e) => setConnDraft((d) => ({ ...d, [r.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} onBlur={() => { if (connDraft[r.id] != null) saveConn(r, connDraft[r.id]); }} inputMode="numeric" placeholder="connections" title="Connection count — saves on Enter / blur" style={{ width: 120, border: `1.5px solid ${dirty ? "var(--blue-chip-text,#1a56db)" : "var(--input-border,#dde1e8)"}`, background: "var(--card,#fff)", borderRadius: 8, padding: "6px 9px", font: `700 14px ${F_GRO}`, color: "var(--fg,#111)", outline: "none" }} />
                  <div style={{ font: `600 10.5px ${F_SANS}`, color: grew != null && grew > 0 ? "var(--st-active-fg,#188038)" : "var(--muted2,#9aa0a6)", marginTop: 3 }}>{grew != null ? (grew > 0 ? `+${grew} since first logged` : grew < 0 ? `${grew} since first logged` : "no change yet") : "first check"}</div>
                </div>
                {/* last check */}
                <span style={{ font: `600 11.5px ${F_SANS}`, color: restricted ? "var(--st-cancel-fg,#c0392b)" : r.healthCheckedAt ? "var(--st-active-fg,#188038)" : "var(--muted2,#9aa0a6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hcText}</span>
                {/* ✓/✕ */}
                <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                  <button onClick={() => checkHealthy(r)} title="Healthy — mark checked" style={{ width: 34, height: 30, borderRadius: 8, border: "1.5px solid var(--st-active-fg,#188038)", background: done && !restricted ? "var(--st-active-fg,#188038)" : "var(--card,#fff)", color: done && !restricted ? "#fff" : "var(--st-active-fg,#188038)", font: `800 14px ${F_SANS}`, cursor: "pointer" }}>✓</button>
                  <button onClick={() => checkRestricted(r)} title="Restricted" style={{ width: 34, height: 30, borderRadius: 8, border: "1.5px solid var(--st-cancel-fg,#c0392b)", background: restricted ? "var(--st-cancel-fg,#c0392b)" : "var(--card,#fff)", color: restricted ? "#fff" : "var(--st-cancel-fg,#c0392b)", font: `800 13px ${F_SANS}`, cursor: "pointer" }}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "8px 4px 60px" }}>
      {saveMsg && <div role="status" onClick={() => setSaveMsg(null)} style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 100, cursor: "pointer", font: `700 13px ${F_SANS}`, padding: "10px 16px", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,.14)", background: saveMsg.ok ? "var(--st-active-bg,#e6f4ea)" : "var(--st-cancel-bg,#fdecea)", color: saveMsg.ok ? "var(--st-active-fg,#188038)" : "var(--st-cancel-fg,#c0392b)", border: `1px solid ${saveMsg.ok ? "var(--st-active-fg,#188038)" : "var(--st-cancel-fg,#c0392b)"}` }}>{saveMsg.ok ? saveMsg.text : `⚠ ${saveMsg.text}`}</div>}

      {/* title + viewing-as */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ font: `800 28px ${F_GRO}`, margin: "0 0 4px", color: "var(--fg,#111)" }}>Pipeline</h1>
          <p style={{ font: `500 13.5px ${F_SANS}`, color: "var(--muted,#777)", margin: 0 }}>Who needs what, and who’s on it. {(rows || []).length} in pipeline · {totalLive} live.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, font: `600 13px ${F_SANS}`, color: "var(--muted,#777)" }}>
          Viewing as
          <span style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--card,#fff)", border: "1px solid var(--card-border,#e3e3e6)", borderRadius: 999, padding: "4px 11px 4px 4px", color: "var(--fg,#111)" }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: me ? handlerColor(me) : "var(--muted2,#9aa0a6)", color: "#fff", font: `700 10px ${F_SANS}`, display: "flex", alignItems: "center", justifyContent: "center" }}>{me ? initialsOf(me) : "?"}</span>
            {me || "—"}
          </span>
        </div>
      </div>

      {/* turn tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
        {TURN_ORDER.map((k) => {
          const m = TURN_META[k]; const active = turnF === k;
          return (
            <button key={k} aria-pressed={active} onClick={() => { setTurnF(active ? "all" : k); setOpen(new Set()); }} style={{ textAlign: "left", cursor: "pointer", background: active ? "var(--card,#fff)" : "var(--band,#f6f7f9)", border: `1.5px solid ${active ? m.dot : "var(--card-border,#e3e3e6)"}`, borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, font: `700 11px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: m.fg }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: m.dot }} />{m.tile}</span>
              <span style={{ font: `800 24px ${F_GRO}`, color: "var(--fg,#111)" }}>{k === "all" ? withTurn.length : tileCounts[k]}</span>
              <span style={{ font: `600 11.5px ${F_SANS}`, color: "var(--muted,#8a9099)" }}>{k === "us" ? `${handlerLoad.unclaimed} unclaimed` : m.sub}</span>
            </button>
          );
        })}
      </div>

      {/* maturing daily-check launcher */}
      {dcTotal > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--st-conv-bg,#efe8fd)", border: "1px solid var(--card-border,#e3e3e6)", borderRadius: 12, padding: "9px 14px", marginBottom: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--st-conv-fg,#6d28d9)" }} />
          <span style={{ font: `700 13px ${F_SANS}`, color: "var(--fg,#111)" }}>Maturing · {dcTotal} account{dcTotal === 1 ? "" : "s"} in the 1-week hold</span>
          <span style={{ font: `600 12px ${F_SANS}`, color: dcDone >= dcTotal ? "var(--st-active-fg,#188038)" : "var(--st-conv-fg,#6d28d9)" }}>{dcDone >= dcTotal ? "all checked today ✓" : `${dcDone}/${dcTotal} checked today`}</span>
          <button onClick={() => { setConnDraft({}); setCheckMode(true); }} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, border: "1.5px solid var(--st-conv-fg,#6d28d9)", background: "var(--card,#fff)", color: "var(--st-conv-fg,#6d28d9)", borderRadius: 999, padding: "6px 13px", font: `700 12.5px ${F_SANS}`, cursor: "pointer" }}>
            ✓ Start daily check
            <span style={{ font: `700 11px ${F_GRO}`, color: "#fff", background: "var(--st-conv-fg,#6d28d9)", borderRadius: 999, padding: "1px 8px" }}>{dcTotal - dcDone} left</span>
          </button>
        </div>
      )}

      {/* handler chips */}
      <div style={{ background: "var(--card,#fff)", border: "1px solid var(--card-border,#e3e3e6)", borderRadius: 14, padding: "11px 14px", display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ ...labelCss, marginRight: 4 }}>Handled by</span>
          {([{ k: "all", label: "Everyone", cnt: handlerLoad.total, color: "var(--muted,#8a9099)", ini: null as string | null }, ...(me ? [{ k: "__me", label: "Me", cnt: handlerLoad.m.get(me) || 0, color: handlerColor(me), ini: initialsOf(me) as string | null }] : []), ...handlerNames.filter((n) => n !== me).map((n) => ({ k: n, label: n, cnt: handlerLoad.m.get(n) || 0, color: handlerColor(n), ini: initialsOf(n) as string | null })), { k: "__unassigned", label: "Unclaimed", cnt: handlerLoad.unclaimed, color: "var(--warn-badge-text,#b7791f)", ini: null as string | null }]).map((c) => {
            const active = whoF === c.k;
            const tint = c.color.startsWith("#") ? c.color + "22" : "var(--band,#f1f3f6)";
            return (
              <button key={c.k} onClick={() => setWhoF(active ? "all" : c.k)} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", border: `1.5px solid ${active ? c.color : "var(--card-border,#e3e3e6)"}`, background: active ? tint : "var(--card,#fff)", borderRadius: 999, padding: "4px 11px 4px 5px", font: `700 12.5px ${F_SANS}`, color: "var(--fg,#111)", whiteSpace: "nowrap" }}>
                {c.ini
                  ? <span style={{ width: 18, height: 18, borderRadius: "50%", background: c.color, color: "#fff", font: `700 8.5px ${F_SANS}`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{c.ini}</span>
                  : <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.color, flex: "none" }} />}
                {c.label}
                <span style={{ font: `700 11px ${F_GRO}`, color: c.cnt ? "var(--warn-badge-text,#b7791f)" : "var(--muted2,#9aa0a6)", background: c.cnt ? "var(--warn-badge-bg,#fef3e2)" : "var(--band,#f1f3f6)", borderRadius: 999, padding: "1px 7px" }}>{c.cnt}</span>
              </button>
            );
          })}
          <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted2,#9aa0a6)", marginLeft: "auto" }}>Count = open actions</span>
        </div>
        {/* filters */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--divider,#f0f2f5)", paddingTop: 10 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, contact or referrer…" style={{ ...inputCss, flex: 1, minWidth: 220 }} />
          <select value={String(levelF)} onChange={(e) => setLevelF(e.target.value === "all" ? "all" : Number(e.target.value))} style={{ ...inputCss, width: "auto", cursor: "pointer" }}>
            <option value="all">All levels</option>
            {[0.5, 1, 2, 3, 4, 5, 0].map((n) => <option key={n} value={n}>Level {LEVEL_CHIP[String(n)]}</option>)}
          </select>
          <select value={healthF} onChange={(e) => setHealthF(e.target.value)} style={{ ...inputCss, width: "auto", cursor: "pointer" }}>
            <option value="all">Any status</option>
            <option value="restricted">Restricted</option>
            <option value="maturing">🔥 Maturing</option>
            {HEALTH_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <select value={typeF} onChange={(e) => setTypeF(e.target.value)} style={{ ...inputCss, width: "auto", cursor: "pointer" }}>
            <option value="all">All types</option>
            {APPLICATION_TYPES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <div style={{ display: "flex", gap: 3, background: "var(--band,#eef0f4)", borderRadius: 10, padding: 3 }}>
            <span style={{ font: `600 12px ${F_SANS}`, color: "var(--muted2,#9aa0a6)", padding: "0 6px", alignSelf: "center" }}>Group</span>
            {GROUP_OPTS.map((g) => <button key={g.key} onClick={() => setGroupBy(g.key)} style={{ border: "none", cursor: "pointer", borderRadius: 7, padding: "6px 11px", whiteSpace: "nowrap", font: `700 12px ${F_SANS}`, background: groupBy === g.key ? "var(--card,#fff)" : "transparent", color: groupBy === g.key ? "var(--fg,#111)" : "var(--muted,#8a9099)" }}>{g.label}</button>)}
          </div>
        </div>
      </div>

      {/* bulk assign bar */}
      {sel.size > 0 && (
        <div style={{ position: "sticky", top: 10, zIndex: 5, background: "var(--btn-dark-bg,#0b1220)", color: "#fff", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", boxShadow: "0 10px 30px rgba(11,18,32,.25)", marginBottom: 12 }}>
          <span style={{ font: `700 13.5px ${F_SANS}` }}>{sel.size} selected</span>
          <span style={{ font: `500 13px ${F_SANS}`, color: "#a7b0bf" }}>Assign to</span>
          {(me ? [me, ...handlerNames.filter((n) => n !== me)] : handlerNames).map((n) => (
            <button key={n} onClick={() => { void assignMany(selArr, n); setSel(new Set()); }} style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #2a3344", background: "#151d2c", color: "#fff", borderRadius: 8, padding: "6px 10px", font: `700 12px ${F_SANS}`, cursor: "pointer" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: handlerColor(n), flex: "none" }} />{n === me ? "Me" : n}</button>
          ))}
          <button onClick={() => { void assignMany(selArr, null); setSel(new Set()); }} style={{ border: "1px solid #2a3344", background: "#151d2c", color: "#fff", borderRadius: 8, padding: "6px 10px", font: `700 12px ${F_SANS}`, cursor: "pointer" }}>Unassign</button>
          <button onClick={() => setSel(new Set())} style={{ marginLeft: "auto", border: "none", background: "none", color: "#a7b0bf", font: `700 12.5px ${F_SANS}`, cursor: "pointer" }}>Clear</button>
        </div>
      )}

      {/* table */}
      {rows === null ? (
        <div style={{ padding: 40, textAlign: "center", font: `500 13px ${F_SANS}`, color: "var(--muted,#777)" }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {groups.map((g) => {
            const gClosed = closed.has(g.key);
            const stale = g.items.filter(({ t }) => t.chaseDue).length;
            const uncl = g.items.filter(({ r, t }) => t.turn === "us" && !(r.poc || "").trim()).length;
            return (
              <div key={g.key} style={{ background: "var(--card,#fff)", border: "1px solid var(--card-border,#e3e3e6)", borderRadius: 14, overflow: "hidden" }}>
                <button onClick={() => toggleGroup(g.key)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, border: "none", background: "var(--band,#f6f7f9)", borderBottom: "1px solid var(--divider,#eef0f4)", padding: "9px 16px", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ font: `700 12px ${F_SANS}`, color: "var(--muted2,#9aa0a6)", display: "inline-block", transform: gClosed ? "none" : "rotate(90deg)", transition: "transform .15s" }}>›</span>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.dot }} />
                  <span style={{ font: `700 13.5px ${F_SANS}`, color: "var(--fg,#111)" }}>{g.title}</span>
                  <span style={{ font: `700 11.5px ${F_GRO}`, color: "var(--muted,#888)", background: "var(--band,#e9ecf1)", borderRadius: 999, padding: "1px 8px" }}>{g.items.length}</span>
                  <span style={{ font: `500 12px ${F_SANS}`, color: "var(--muted2,#9aa0a6)" }}>{g.note}</span>
                  <span style={{ marginLeft: "auto", font: `700 11.5px ${F_SANS}`, color: "var(--warn-badge-text,#b7791f)" }}>{stale ? `${stale} to chase` : uncl ? `${uncl} unclaimed` : ""}</span>
                </button>
                {!gClosed && (
                  <div style={{ overflowX: "auto" }}>
                    <div style={{ minWidth: 1180 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "32px minmax(0,2fr) 104px 96px 70px 60px 112px minmax(0,1.5fr) 118px 84px 22px", gap: 12, alignItems: "center", padding: "8px 16px", borderBottom: "1px solid var(--divider,#eef0f4)", font: `700 9.5px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted2,#9aa0a6)" }}>
                        <span /><span>Ambassador</span><span>Referrer</span><span>Type</span><span>Applied</span><span>Verified</span><span>Level</span><span>Next step</span><span>Handler</span><span>Last touch</span><span />
                      </div>
                      {g.items.map(({ r, t }) => (
                        <Rowline key={r.id} r={r} t={t} open={open.has(r.id)} selected={sel.has(r.id)} me={me} handlerNames={handlerNames}
                          onToggle={() => toggle(r.id)} onSel={() => toggleSel(r.id)} onClaim={() => claim(r)} onAssign={(p) => assignMany([r.id], p)} handlers={handlers} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!groups.length && <div style={{ padding: 40, textAlign: "center", font: `600 14px ${F_SANS}`, color: "var(--muted,#777)" }}>Nothing here.</div>}
        </div>
      )}
    </div>
  );
}

function Rowline({ r, t, open, selected, me, handlerNames, onToggle, onSel, onClaim, onAssign, handlers }: {
  r: Row; t: ReturnType<typeof turnOf>; open: boolean; selected: boolean; me: string; handlerNames: string[];
  onToggle: () => void; onSel: () => void; onClaim: () => void; onAssign: (poc: string | null) => void;
  handlers: Parameters<typeof CardDetail>[0]["h"];
}) {
  const m = TURN_META[t.turn];
  const lvl = levelKey(r);
  const applied = ageDays(r.createdAt);
  const h = (r.poc || "").trim();
  const lt = lastTouchActivity(r);
  const lastTouch = lt ? ageDays(lt) : null;
  const restricted = isRestricted(r);
  return (
    <div style={{ borderBottom: "1px solid var(--divider,#f0f2f5)", background: open ? "var(--band,#fafbfc)" : "var(--card,#fff)" }}>
      <div onClick={onToggle} style={{ display: "grid", gridTemplateColumns: "32px minmax(0,2fr) 104px 96px 70px 60px 112px minmax(0,1.5fr) 118px 84px 22px", gap: 12, alignItems: "center", padding: "9px 16px", cursor: "pointer", boxShadow: `inset 3px 0 0 ${t.chaseDue ? "var(--st-cancel-fg,#c0392b)" : t.turn === "us" && !h ? "var(--warn-badge-text,#f59e0b)" : "transparent"}` }}>
        <input type="checkbox" checked={selected} onClick={(e) => e.stopPropagation()} onChange={onSel} style={{ width: 16, height: 16, cursor: "pointer" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ font: `700 14px/1.3 ${F_SANS}`, color: "var(--fg,#111)" }}>{formatName(r.fullName) || "—"}</span>
            {r.linkedinUrl && <a href={r.linkedinUrl.startsWith("http") ? r.linkedinUrl : `https://${r.linkedinUrl}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open LinkedIn profile ↗" style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 2, font: `700 10px ${F_SANS}`, padding: "2px 7px", borderRadius: 999, background: "var(--blue-chip-bg,#e8f0fe)", color: "var(--blue-chip-text,#1a56db)", textDecoration: "none" }}>in ↗</a>}
            {restricted && <span style={{ flex: "none", font: `700 10px ${F_SANS}`, padding: "2px 7px", borderRadius: 999, background: "var(--st-cancel-bg,#fdecea)", color: "var(--st-cancel-fg,#c0392b)" }}>Restricted</span>}
            {r.maturingStartedAt
              ? <span title={`Currently maturing — a LinkedVelocity warm/cold campaign is running (auto) · since ${fmtDate(r.maturingStartedAt)}`} style={{ flex: "none", font: `700 10px ${F_SANS}`, padding: "2px 7px", borderRadius: 999, background: "var(--warn-badge-bg,#fef3c7)", color: "var(--warn-badge-text,#b7791f)" }}>🔥 {ageDays(r.maturingStartedAt)}d</span>
              : r.warmupStartedAt && <span title={`Warming up since ${fmtDate(r.warmupStartedAt)}`} style={{ flex: "none", font: `700 10px ${F_SANS}`, padding: "2px 7px", borderRadius: 999, background: "var(--warn-badge-bg,#fef3c7)", color: "var(--warn-badge-text,#b7791f)" }}>🔥 {ageDays(r.warmupStartedAt)}d</span>}
            {r.linkedinVerified && <span style={{ flex: "none", font: `700 10px ${F_SANS}`, padding: "2px 7px", borderRadius: 999, background: "var(--blue-chip-bg,#e8f0fe)", color: "var(--blue-chip-text,#1a56db)" }}>✓</span>}
            {lvl >= 4 && r.accountId && !r.linkedinJoinedAt && <span title="Account history (Level 4) not filled — open this row and record the account's 'Joined LinkedIn' month + current connections." style={{ flex: "none", font: `700 10px ${F_SANS}`, padding: "2px 7px", borderRadius: 999, background: "var(--warn-badge-bg,#fef3c7)", color: "var(--warn-badge-text,#b7791f)", border: "1px dashed var(--warn-badge-text,#b7791f)" }}>⚠ History</span>}
            {isLikelyTestEmail(r.email) && <span style={{ flex: "none", font: `700 9px ${F_SANS}`, padding: "2px 6px", borderRadius: 5, background: "var(--test-bg,#fde68a)", color: "var(--test-fg,#92400e)" }}>TEST</span>}
          </div>
          <div style={{ font: `500 12px ${F_SANS}`, color: "var(--muted2,#9aa0a6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.loginEmail || r.email}{r.contactNumber ? ` · ${r.contactNumber}` : ""}</div>
        </div>
        {r.referredBy ? <a href={`/admin/referrals?ref=${encodeURIComponent(r.referredBy)}`} onClick={(e) => e.stopPropagation()} style={{ font: `700 12.5px ${F_SANS}`, color: "var(--link,#0a66c2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.referredBy}</a> : <span style={{ color: "var(--muted2,#b6bbc2)" }}>—</span>}
        <span style={{ justifySelf: "start", font: `700 11px ${F_SANS}`, padding: "3px 8px", borderRadius: 7, background: typeColor(r)[0], color: typeColor(r)[1], whiteSpace: "nowrap" }}>{effectiveType(r).label}</span>
        <div style={{ display: "flex", flexDirection: "column" }}><span style={{ font: `700 12.5px ${F_GRO}`, color: applied >= 14 && !["live", "dead", "recovery"].includes(t.turn) ? "var(--st-cancel-fg,#c0392b)" : "var(--fg,#111)" }}>{applied === 0 ? "Today" : applied + "d"}</span><span style={{ font: `500 10px ${F_SANS}`, color: "var(--muted2,#9aa0a6)" }}>{fmtDate(r.createdAt)}</span></div>
        <span style={{ justifySelf: "start", font: `700 11px ${F_SANS}`, padding: "3px 8px", borderRadius: 999, background: r.linkedinVerified ? "#dcfce7" : "#f1f3f6", color: r.linkedinVerified ? "#15803d" : "#9aa0a6", whiteSpace: "nowrap" }}>{r.linkedinVerified ? "✓ Yes" : "No"}</span>
        <span style={{ justifySelf: "start", font: `700 11px ${F_SANS}`, padding: "3px 9px", borderRadius: 999, background: levelPill(lvl)[0], color: levelPill(lvl)[1], whiteSpace: "nowrap" }}>{LEVEL_CHIP[String(lvl)]}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ flex: "none", font: `800 9px ${F_SANS}`, letterSpacing: ".05em", padding: "3px 7px", borderRadius: 6, background: m.bg, color: m.fg }}>{m.chip}</span>
            <span title={t.label} style={{ font: `600 12.5px ${F_SANS}`, color: "var(--fg,#111)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "help" }}>{t.label}</span>
          </div>
          {(t.stopSuggested || t.recheckDue || t.turn === "recovery") && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {t.turn === "recovery" && r.accountId && <a href={`/admin/restrictions-v2?focus=${encodeURIComponent(r.accountId)}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open this account's recovery case" style={{ flex: "none", border: "1px solid #fecdd3", background: "#fff1f2", color: "#be123c", borderRadius: 7, padding: "3px 8px", font: `700 11px ${F_SANS}`, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none" }}>Open recovery case →</a>}
              {t.stopSuggested && <button onClick={(e) => { e.stopPropagation(); void handlers.setStage(r, "unreachable"); }} title="Stop chasing — mark Unresponsive" style={{ flex: "none", border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 7, padding: "3px 8px", font: `700 11px ${F_SANS}`, cursor: "pointer", whiteSpace: "nowrap" }}>Mark Stopped</button>}
              {t.recheckDue && (<>
                <button onClick={(e) => { e.stopPropagation(); if (r.accountId) { handlers.patchAccount(r.id, r.accountId, { linkedinAccountHealth: "restricted" }, true); } else { const d = new Date(); d.setDate(d.getDate() + 1); handlers.patchApp(r.id, { nextFollowUp: d.toISOString() }, true); } }} title="Still restricted — snooze the re-check to tomorrow" style={{ flex: "none", border: "1px solid #fcd34d", background: "#fffbeb", color: "#92400e", borderRadius: 7, padding: "3px 8px", font: `700 11px ${F_SANS}`, cursor: "pointer", whiteSpace: "nowrap" }}>Still restricted</button>
                <button onClick={(e) => { e.stopPropagation(); if (r.accountId) { handlers.patchAccount(r.id, r.accountId, { restrictedAt: null, linkedinAccountHealth: "active" }, true); } else { handlers.patchApp(r.id, { accountIssue: "", nextFollowUp: null }, true); } }} title="Restriction cleared — remove from To action" style={{ flex: "none", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#15803d", borderRadius: 7, padding: "3px 8px", font: `700 11px ${F_SANS}`, cursor: "pointer", whiteSpace: "nowrap" }}>Cleared</button>
              </>)}
            </div>
          )}
        </div>
        <div onClick={(e) => e.stopPropagation()} style={{ minWidth: 0 }}>
          {!h ? (
            <button onClick={onClaim} disabled={!me} style={{ border: "1.5px dashed var(--input-border,#c5cbd3)", background: "var(--card,#fff)", color: "var(--fg,#111)", borderRadius: 999, padding: "4px 12px", font: `700 12px ${F_SANS}`, cursor: me ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}>+ Claim</button>
          ) : (
            <label style={{ position: "relative", display: "flex", alignItems: "center", gap: 7, cursor: "pointer", minWidth: 0 }}>
              <span style={{ flex: "none", width: 24, height: 24, borderRadius: "50%", background: handlerColor(h), color: "#fff", font: `700 10px ${F_SANS}`, display: "flex", alignItems: "center", justifyContent: "center" }}>{initialsOf(h)}</span>
              <span style={{ font: `600 12.5px ${F_SANS}`, color: "var(--fg,#111)", whiteSpace: "nowrap" }}>{h === me ? "Me" : h}</span>
              <span style={{ font: `600 10px ${F_SANS}`, color: "var(--muted2,#9aa0a6)" }}>▾</span>
              <select value={h} onChange={(e) => onAssign(e.target.value || null)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}>
                {[...(me && !handlerNames.includes(me) ? [me] : []), ...handlerNames].map((n) => <option key={n} value={n}>{n === me ? "Me (" + n + ")" : n}</option>)}
                <option value="">Unassign</option>
              </select>
            </label>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}><span style={{ font: `700 12.5px ${F_GRO}`, color: t.chaseDue ? "var(--st-cancel-fg,#c0392b)" : "var(--fg,#111)" }}>{lastTouch === null ? "—" : lastTouch === 0 ? "Today" : lastTouch + "d"}</span><span style={{ font: `600 10px ${F_SANS}`, color: t.chaseDue ? "var(--st-cancel-fg,#c0392b)" : "var(--muted2,#9aa0a6)" }}>{t.chaseDue ? "chase due" : t.turn === "us" && !h ? "unclaimed" : ""}</span></div>
        <span style={{ font: `700 14px ${F_SANS}`, color: "var(--muted2,#9aa0a6)", display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
      </div>
      {open && (r.accountOnly ? (
        <div style={{ padding: 16 }}><AccountOnlyCard r={r} patchAccount={handlers.patchAccount} deleteRestrictionEvent={handlers.deleteRestrictionEvent} /></div>
      ) : (
        <CardDetail r={r} h={handlers} />
      ))}
    </div>
  );
}
