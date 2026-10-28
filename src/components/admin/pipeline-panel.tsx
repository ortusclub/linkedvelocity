"use client";

// Shared pipeline detail components — the expanded-row panel (workflow rail, payments,
// restriction control, outreach log, credential fields). Drives the exact same behaviour
// and endpoints as the live pipeline; only the /admin/pipeline-new layout is restyled to
// the Pipeline v2 mock (workflow bar on top, then a 3-column card grid with per-card
// read/edit toggles and a compact payments summary).
import { useState } from "react";
import type { CSSProperties, ReactNode, MouseEvent } from "react";
import { formatMoney } from "@/lib/referral-currency";
import { formatName } from "@/lib/utils";
import { PipelineIssueActions } from "@/components/admin/pipeline-issue-actions";
import { PipelineReferralInvite } from "@/components/admin/pipeline-referral-invite";
import { OnboardingNotes } from "@/components/admin/onboarding-notes";
import { ambassadorIssueContact, messagingLinks } from "@/lib/issue-contacts";
import { isApplicationReceived, receiptPatch } from "@/lib/pipeline-received";
import { useQcChecks } from "@/components/admin/use-qc-checks";
import TotpCode from "@/app/m/[token]/onboarding/totp";
import { isLikelyTestEmail } from "@/lib/test-mode";
import {
  type Row, type Touch, F_SANS, F_GRO, labelCss, inputCss, btnSec, btnPrimary,
  applicationType, effectiveType, awaitingSigninVerify, isLive, stageOf, isBlocked, levelKey, healthOf, needsGologin,
  STATUS_STYLE, STAGE_ACCENT, HEALTH_OPTIONS, ACCOUNT_STATUS_OPTIONS, OWNER_STATUS_OPTIONS,
  cfgOf, monthlyAmt, totalPaid, setupPaid, holdDays, matureDaysLeft, QC_ITEMS,
  fmtDate, fmtDateTime, ageDays, liHref, proxyCombined, parseProxy, initialsOf,
  messagingChannel, touchCount, touchLabel, touchChipStyle, lastTouchAt, nextStep,
  type Status, type Health,
} from "@/lib/pipeline-model";

type Handlers = {
  busy: boolean;
  patchApp: (id: string, patch: Record<string, unknown>, reload?: boolean) => void;
  patchAccount: (id: string, accountId: string, patch: Record<string, unknown>, reload?: boolean) => void;
  deleteRestrictionEvent: (accountId: string, at: string) => void;
  setStage: (r: Row, s: Status) => void;
  workflow: (id: string, patch: Record<string, unknown>) => void;
  provisionGologin: (r: Row) => void;
  createAccount: (r: Row) => void;
  verifySignin: (r: Row, action: "confirm" | "retry" | "takeover") => void;
  transferToLv: (r: Row) => void;
  generateProfile: (r: Row, lane: string) => void;
  applyProfile: (r: Row) => void;
  deleteGologin: (r: Row) => void;
  emailIssue: (r: Row, issue: string) => void;
  logTouch: (id: string, ch: string, text: string, by: string) => Promise<void>;
  logPayment: (r: Row, kind: "setup" | "monthly") => Promise<void>;
  updatePayout: (r: Row, index: number, patch: { proofUrl?: string | null; notified?: boolean; acknowledged?: boolean }) => Promise<void>;
  onDeleteApp: (r: Row) => void;
};

export function SectionLabel({ children, num }: { children: ReactNode; num?: number }) {
  return <div style={{ ...labelCss, marginBottom: 10 }}>{num ? `${num} · ` : ""}{children}</div>;
}
export function D({ label, children }: { label: string; children?: ReactNode }) {
  const empty = children === null || children === undefined || children === "" || children === false;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...labelCss, marginBottom: 3 }}>{label}</div>
      <div style={{ font: `600 13px ${F_SANS}`, color: empty ? "var(--muted2,#b6bbc2)" : "var(--fg,#111)", wordBreak: "break-word" }}>{empty ? "—" : children}</div>
    </div>
  );
}
export function Edit({ label, value, onSave, placeholder, numeric, hint, secret, openHref }: { label: string; value: string | number | null; onSave: (v: string | number | null) => void; placeholder?: string; numeric?: boolean; hint?: string; secret?: boolean; openHref?: string | null }) {
  const [reveal, setReveal] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span style={labelCss}>{label}{hint && <span style={{ color: "var(--muted2,#9aa0a6)", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}> · {hint}</span>}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <input defaultValue={value == null ? "" : String(value)} placeholder={placeholder} inputMode={numeric ? "numeric" : undefined} type={secret && !reveal ? "password" : "text"}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (raw === (value == null ? "" : String(value))) return;
            onSave(numeric ? (raw === "" ? null : (parseInt(raw.replace(/[^0-9]/g, ""), 10) || null)) : (raw === "" ? null : raw));
          }} style={inputCss} />
        {openHref && <a href={liHref(openHref)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open link" style={{ font: `600 12px ${F_SANS}`, color: "var(--link,#0a66c2)", flex: "none", textDecoration: "none" }}>↗</a>}
        {secret && <span onClick={(e) => { e.stopPropagation(); setReveal((s) => !s); }} style={{ font: `600 11.5px ${F_SANS}`, color: "var(--muted,#8a97ad)", cursor: "pointer", flex: "none" }}>{reveal ? "Hide" : "Show"}</span>}
      </div>
    </div>
  );
}
export function EditSelect({ label, value, options, onSave }: { label: string; value: string; options: { value: string; label: string }[]; onSave: (v: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span style={labelCss}>{label}</span>
      <select value={value} onClick={(e) => e.stopPropagation()} onChange={(e) => onSave(e.target.value)} style={{ ...inputCss, cursor: "pointer" }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
export function Note({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ ...labelCss, marginBottom: 3 }}>{label}</div>
      <div style={{ font: `500 12.5px/1.55 ${F_SANS}`, color: "var(--fg,#444)", whiteSpace: "pre-wrap" }}>{children}</div>
    </div>
  );
}

// White rounded section card with an uppercase grey label (the Pipeline v2 card look).
function PanelCard({ title, right, children, tone }: { title: string; right?: ReactNode; children: ReactNode; tone?: "notes" }) {
  const notes = tone === "notes";
  return (
    <div style={{ background: notes ? "var(--warn-badge-bg,#fffdf5)" : "var(--card,#fff)", border: `1px solid ${notes ? "var(--warn-badge-border,#f1e3b5)" : "var(--card-border,#e3e3e6)"}`, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <span style={{ ...labelCss, color: notes ? "var(--warn-badge-text,#a16207)" : "var(--label,#7c8597)" }}>{title}</span>
        {right}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </div>
  );
}

const editLinkStyle: CSSProperties = { font: `700 12px ${F_SANS}`, color: "var(--link,#2563eb)", background: "none", border: "none", cursor: "pointer", padding: 0, flex: "none" };

// Read-only value display with copy-on-click, link, and secret reveal. Used in view mode.
function ReadField({ label, value, href, secret, mono }: { label: string; value: string | number | null; href?: string | null; secret?: boolean; mono?: boolean }) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const empty = value == null || value === "";
  const text = empty ? "" : String(value);
  const copy = (e: MouseEvent) => { e.stopPropagation(); if (empty) return; navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...labelCss, marginBottom: 3 }}>{label}</div>
      {empty ? <span style={{ font: `600 13px ${F_SANS}`, color: "var(--muted2,#b6bbc2)" }}>—</span>
        : href ? <a href={liHref(href)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ font: `600 13px ${F_SANS}`, color: "var(--link,#0a66c2)", textDecoration: "none", wordBreak: "break-word" }}>{text} ↗</a>
          : <span onClick={copy} title="Click to copy" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", maxWidth: "100%" }}>
              <span style={{ font: mono ? `600 12.5px ${F_GRO}` : `600 13px ${F_SANS}`, color: "var(--fg,#111)", wordBreak: "break-word" }}>{secret && !reveal ? "••••••••••" : text}</span>
              {secret && <button onClick={(e) => { e.stopPropagation(); setReveal((s) => !s); }} style={{ font: `600 11px ${F_SANS}`, color: "var(--link,#0a66c2)", background: "none", border: "none", cursor: "pointer", padding: 0, flex: "none" }}>{reveal ? "Hide" : "Show"}</button>}
              <span style={{ font: `600 10.5px ${F_SANS}`, color: copied ? "var(--st-active-fg,#15803d)" : "var(--muted2,#98a2b3)", flex: "none" }}>{copied ? "✓" : "⧉"}</span>
            </span>}
    </div>
  );
}

type FieldSpec = { k: string; label: string; value: string | number | null; onSave: (v: string | number | null) => void; kind?: "text" | "numeric" | "secret" | "link" | "select"; options?: { value: string; label: string }[]; placeholder?: string; hint?: string };

function renderField(f: FieldSpec, editing: boolean) {
  if (editing) {
    if (f.kind === "select") return <EditSelect key={f.k} label={f.label} value={String(f.value ?? "")} options={f.options || []} onSave={(v) => f.onSave(v)} />;
    return <Edit key={f.k} label={f.label} value={f.value} onSave={f.onSave} placeholder={f.placeholder} numeric={f.kind === "numeric"} secret={f.kind === "secret"} hint={f.hint} openHref={f.kind === "link" ? (f.value as string | null) : undefined} />;
  }
  if (f.kind === "select") { const lbl = f.options?.find((o) => o.value === String(f.value ?? ""))?.label ?? ""; return <ReadField key={f.k} label={f.label} value={lbl || null} />; }
  return <ReadField key={f.k} label={f.label} value={f.value} href={f.kind === "link" ? (f.value as string | null) : undefined} secret={f.kind === "secret"} mono={f.kind === "secret"} />;
}

// In view mode: show filled fields (and all selects); collapse empty text fields into a
// single "+ Add <fields>" affordance that enters edit mode.
function ToggleFields({ fields, editing, onEdit }: { fields: FieldSpec[]; editing: boolean; onEdit: () => void }) {
  const empties = fields.filter((f) => f.kind !== "select" && (f.value == null || f.value === ""));
  const names = empties.slice(0, 3).map((f) => f.label.replace(/ \(.*/, "").toLowerCase()).join(", ");
  return (
    <>
      {fields.map((f) => editing ? renderField(f, true) : (f.kind === "select" || !(f.value == null || f.value === "") ? renderField(f, false) : null))}
      {!editing && empties.length > 0 && (
        <button onClick={onEdit} style={{ alignSelf: "flex-start", font: `600 12px ${F_SANS}`, color: "var(--muted,#5b6779)", background: "var(--inset,#fafbfc)", border: "1px dashed var(--input-border,#d5d9e0)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", textAlign: "left" }}>+ Add {names}{empties.length > 3 ? ` +${empties.length - 3}` : ""}</button>
      )}
    </>
  );
}

function SignupMeeting({ r }: { r: Row }) {
  const latest = new Map<string, Touch>();
  for (const entry of r.outreachLog || []) if (entry.bookingKey && entry.scheduledAt) latest.set(entry.bookingKey, entry);
  const meetings = [...latest.values()].sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  const active = meetings.filter(m => !m.cancelled);
  const meeting = active.find(m => new Date(m.scheduledAt!).getTime() >= Date.now()) || active[active.length - 1];
  const when = meeting?.scheduledAt || (!meetings.length && r.call?.stage !== "none" ? r.call?.scheduledAt : null);
  return <div style={{ padding: 9, borderRadius: 8, background: "var(--link-bg,#eaf1ff)", fontSize: 11, lineHeight: 1.5 }}>
    <b>{when ? "Meeting booked" : meetings.length ? "Meeting cancelled · no active booking" : "No meeting booking recorded yet"}</b>
    {when ? <div><time dateTime={when}>{new Date(when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time><br /><small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small></div> : <div>Calendar updates can take a few minutes to sync.</div>}
  </div>;
}

export function WorkflowRail({ r, busy, workflow, setStage, verifySignin }: { r: Row; busy: boolean; workflow: (id: string, patch: Record<string, unknown>) => void; setStage: (r: Row, s: Status) => void; verifySignin: (r: Row, action: "confirm" | "retry" | "takeover") => void }) {
  const qcPassed = !!r.verifiedAt;
  // A fresh form signup lands as "reviewing"/"pending" — step 1 is to accept it (the old
  // footer "Accept → Level 1" button is now folded in here).
  const toAccept = ["reviewing", "pending"].includes(r.status);
  const accepted = isApplicationReceived(r) && !toAccept;
  const matureStartMs = r.verifiedAt ? new Date(r.verifiedAt).getTime() : null;
  const matureDue = matureStartMs !== null ? matureStartMs + holdDays(r) * 86400000 : null;
  const matured = matureDue !== null && matureDaysLeft(matureDue) <= 0;
  const gated = false;

  const qcState = useQcChecks(r.id, r.qcChecks);
  const qc = qcState.checks;
  const qcCount = QC_ITEMS.filter(([k]) => qc[k]).length;
  const allQc = qcCount === QC_ITEMS.length;
  // Pre-onboarding security handover check (Step 5), stored in the same qcChecks object. The
  // GoLogin item only applies to full-service (onboardingMethod "computer"), where the referrer
  // was given GoLogin access to do the sign-in; other types never had it.
  const secItems: ["sessionsOut" | "noRememberedPw" | "gologinRemoved" | "phoneRemoved", string][] = [
    ["sessionsOut", "Signed out of all other sessions on LinkedIn"],
    ["noRememberedPw", "No other device remembers the password"],
    ["phoneRemoved", "Phone number removed from the account"],
    ...(r.onboardingMethod === "computer" ? [["gologinRemoved", "Referrer's GoLogin access removed"] as ["gologinRemoved", string]] : []),
  ];
  const allSec = secItems.every(([k]) => qc[k]);

  type Step = { label: string; title: string; sub: string; done: boolean; render: (isNext: boolean) => ReactNode };
  const stepCard = (label: string, title: string, sub: string, isNext: boolean, done: boolean, body: ReactNode) => (
    <div style={{ flex: "1 1 190px", minWidth: 180, background: "var(--card,#fff)", border: `1px solid ${done ? "var(--st-active-fg,#188038)" : isNext ? "#1a56db" : "var(--divider,#eee)"}`, borderRadius: 10, padding: "11px 12px" }}>
      <div style={{ ...labelCss, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6, color: done ? "var(--st-active-fg,#188038)" : isNext ? "#1a56db" : "var(--muted,#8a97ad)" }}>{done ? "COMPLETED" : isNext ? "NOT COMPLETED · NEXT STEP" : "NOT COMPLETED"}</div>
      <div style={{ font: `600 12.5px ${F_SANS}`, color: "var(--fg,#111)", marginBottom: 3 }}>{title}</div>
      <div style={{ font: `500 11px ${F_SANS}`, color: "var(--muted,#8a97ad)", marginBottom: 8, minHeight: 15 }}>{sub}</div>
      {body}
    </div>
  );
  const doneBadge = (text: string) => <span style={{ font: `600 11.5px ${F_SANS}`, color: "var(--st-active-fg,#188038)", background: "var(--st-active-bg,#e6f4ea)", padding: "6px 10px", borderRadius: 7, display: "inline-block" }}>✓ {text}</span>;
  const undoLink = (patch: Record<string, unknown>) => <button disabled={busy} onClick={() => workflow(r.id, patch)} style={{ font: `500 10.5px ${F_SANS}`, color: "var(--muted,#8a97ad)", cursor: "pointer", background: "transparent", border: "none", padding: 0, textAlign: "left" }}>Undo completion</button>;
  const primaryBtn = (isNext: boolean): CSSProperties => ({ ...btnPrimary, width: "100%", background: isNext ? "#1a56db" : "var(--btn-secondary-bg,#fff)", color: isNext ? "#fff" : "var(--btn-secondary-fg,#333)", border: isNext ? "none" : "1px solid var(--btn-secondary-border,#dcdce0)" });
  const doneCol = (badge: string, undo: Record<string, unknown>) => <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{doneBadge(badge)}{undoLink(undo)}</div>;

  const steps: Step[] = [
    {
      label: "Step 1", title: "Application received", sub: toAccept ? "review, then accept to start onboarding" : r.createdAt ? `applied ${fmtDate(r.createdAt)}` : "in the pipeline", done: accepted,
      render: (isNext) => <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {accepted ? doneCol("Received", { status: "reviewing" })
          : toAccept ? <button onClick={() => workflow(r.id, { status: "onboarding", applicationReceived: true })} disabled={busy} style={primaryBtn(isNext)}>✓ Accept → start onboarding</button>
          : <button onClick={() => workflow(r.id, receiptPatch(r, true))} disabled={busy} style={primaryBtn(isNext)}>Mark received</button>}
        <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--fg,#111)" }}>
          <b>Signup: {effectiveType(r).label}</b>
          {r.diyTier && <div style={{ color: "var(--muted,#8a97ad)", marginTop: 4 }}>{r.diyTier === "standard" ? "Submitted the form for our team to handle setup." : r.diyTier === "partial" ? "Chose to add the LV email and set up 2FA themselves." : "Chose to handle email, 2FA and GoLogin themselves."}</div>}
          {r.diyTier !== "standard" && r.diyTier && <small>Chosen route — completion is tracked in the steps below.</small>}
        </div>
        {r.diyTier === "standard" && <SignupMeeting r={r} />}
        {!isLive(r) && r.status !== "rejected" && <button onClick={() => workflow(r.id, { status: "rejected" })} disabled={busy} style={{ font: `600 12px ${F_SANS}`, color: "var(--danger,#c0392b)", background: "transparent", border: "1px solid var(--danger-border,#e6b4ad)", padding: "8px 13px", borderRadius: 8, cursor: "pointer" }}>Reject</button>}
      </div>,
    },
    {
      label: "Step 2", title: "LV email added & primary", sub: r.emailPrimaryAt ? `done ${fmtDate(r.emailPrimaryAt)}` : "our email is on the account & set primary", done: !!r.emailPrimaryAt,
      render: (isNext) => r.emailPrimaryAt ? doneCol("Email primary", { emailPrimaryAt: null })
        : <button onClick={() => workflow(r.id, { emailPrimaryAt: new Date().toISOString() })} disabled={busy} style={primaryBtn(isNext)}>Mark email added &amp; primary</button>,
    },
    {
      label: "Step 3", title: "Logged into GoLogin", sub: r.onboardedAt ? `logged in ${fmtDate(r.onboardedAt)}` : awaitingSigninVerify(r) ? "referrer reported sign-in — verify it's actually signed in" : "sign in via the GoLogin profile", done: !!r.onboardedAt,
      render: (isNext) => r.onboardedAt ? doneCol("Logged in", { onboardedAt: null })
        : awaitingSigninVerify(r)
          ? <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ font: `600 11px ${F_SANS}`, color: "var(--warn-badge-text,#b7791f)", lineHeight: 1.4 }}>Referrer reported the sign-in. Open the GoLogin and confirm it&apos;s actually signed into LinkedIn.</div>
              {r.gologinShareLink && <a href={liHref(r.gologinShareLink)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ font: `700 11px ${F_SANS}`, color: "var(--link,#0a66c2)", textDecoration: "none" }}>Open GoLogin ↗</a>}
              <button onClick={() => verifySignin(r, "confirm")} disabled={busy} style={primaryBtn(isNext)}>✓ Confirm signed in</button>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => verifySignin(r, "retry")} disabled={busy} title="Not signed in — reopen the referrer's sign-in step so they can retry (stays full-service tier)" style={{ flex: "1 1 auto", font: `700 11px ${F_SANS}`, color: "#92400e", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "7px 9px", cursor: busy ? "wait" : "pointer" }}>↩ Referrer retries</button>
                <button onClick={() => verifySignin(r, "takeover")} disabled={busy} title="Not signed in — we take over the sign-in; commission drops to the email/2FA tier" style={{ flex: "1 1 auto", font: `700 11px ${F_SANS}`, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "7px 9px", cursor: busy ? "wait" : "pointer" }}>✗ We&apos;ll do it</button>
              </div>
            </div>
          : <button onClick={() => workflow(r.id, { status: "approved", onboardedAt: new Date().toISOString() })} disabled={busy} style={primaryBtn(isNext)}>Mark logged in</button>,
    },
    {
      label: "Step 4", title: "Passed checks & QC",
      sub: r.verifiedAt ? `passed ${fmtDate(r.verifiedAt)}` : `quality control · ${qcCount}/${QC_ITEMS.length} checks`,
      done: !!r.verifiedAt,
      render: (isNext) => r.verifiedAt
        ? doneCol("Passed QC", { verifiedAt: null, onboardingStartedAt: null })
        : (<div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {QC_ITEMS.map(([key, lbl]) => {
              const on = !!qc[key];
              return (
                <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: 7, cursor: busy ? "wait" : "pointer", font: `500 11px ${F_SANS}`, color: on ? "var(--st-active-fg,#188038)" : "var(--fg,#111)" }}>
                  <input type="checkbox" checked={on} onChange={event => qcState.toggle(key, event.target.checked)} style={{ width: 15, height: 15, marginTop: 1, accentColor: "var(--st-active-fg,#188038)", flex: "none", cursor: "pointer" }} />
                  <span>{lbl}</span>
                </label>
              );
            })}
            {qcState.saving && <small role="status">Saving checks…</small>}
            {qcState.error && <div role="alert" style={{ fontSize: 11, color: "#b91c1c" }}>{qcState.error} <button onClick={qcState.retry}>Retry</button></div>}
            <button onClick={() => workflow(r.id, { verifiedAt: new Date().toISOString(), onboardingStartedAt: new Date().toISOString() })} disabled={busy || !allQc || qcState.saving || !!qcState.error} title={allQc ? "Mark QC as passed" : "Tick all checks first"} style={{ ...primaryBtn(isNext), marginTop: 2, opacity: allQc ? 1 : 0.5, cursor: allQc ? "pointer" : "not-allowed" }}>Mark QC passed</button>
          </div>),
    },
    {
      label: "Step 5", title: "Matured — ready to onboard",
      sub: !qcPassed ? "starts once QC is passed" : r.status === "onboarded" ? "live & earning" : matured ? "ready — mark onboarded" : `maturing · ready ${matureDue ? fmtDate(new Date(matureDue).toISOString()) : "—"}`,
      done: r.status === "onboarded",
      render: (isNext: boolean) => !qcPassed
        ? <span style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2,#9aa0a6)" }}>🔒 pass QC to begin</span>
        : r.status === "onboarded"
          ? doneBadge("Onboarded — live")
          : !matured
            ? <span style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2,#9aa0a6)" }}>maturing · 1 week hold…</span>
            : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ font: `700 10px ${F_SANS}`, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted2,#9aa0a6)" }}>Security check before onboarding</div>
                {secItems.map(([key, lbl]) => (
                  <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: 7, cursor: "pointer", font: `500 12px ${F_SANS}`, color: "var(--fg,#333)", lineHeight: 1.35 }}>
                    <input type="checkbox" checked={!!qc[key]} onChange={e => qcState.toggle(key, e.target.checked)} style={{ width: 15, height: 15, marginTop: 1, accentColor: "var(--st-active-fg,#188038)", flex: "none", cursor: "pointer" }} />
                    <span>{lbl}</span>
                  </label>
                ))}
                {qcState.saving && <small role="status">Saving…</small>}
                <button onClick={() => setStage(r, "onboarded")} disabled={busy || !allSec || qcState.saving} title={allSec ? "Mark the account onboarded & live (needs a GoLogin profile)" : "Complete the security check first"} style={{ ...primaryBtn(isNext), marginTop: 2, opacity: allSec ? 1 : 0.5, cursor: allSec ? "pointer" : "not-allowed" }}>Mark onboarded (live)</button>
              </div>,
    },
  ];
  let unlocked = true;
  let effLevel = 0;
  for (const s of steps) { if (s.done) effLevel++; else break; }

  return (
    <div style={{ background: "var(--inset,#fafbfc)", border: "1px solid var(--divider,#eee)", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <SectionLabel>Workflow</SectionLabel>
          <span style={{ font: `500 12px ${F_SANS}`, color: "var(--muted,#8a97ad)" }}>Next: <b style={{ color: "var(--fg,#111)" }}>{nextStep(r).label}</b></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span title="The account's stage = the lowest step not yet complete. Ticking a later step doesn't advance the level until the steps before it are done." style={{ font: `700 11px ${F_SANS}`, color: effLevel >= steps.length ? "var(--st-active-fg,#188038)" : "var(--sheets-btn-bg,#1a56db)", background: effLevel >= steps.length ? "var(--st-active-bg,#e6f4ea)" : "var(--link-bg,#eaf1ff)", padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>Level {effLevel}/{steps.length}</span>
          {r.linkedinUrl && <a href={liHref(r.linkedinUrl)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ font: `700 12px ${F_SANS}`, color: "var(--link,#0a66c2)", textDecoration: "none", whiteSpace: "nowrap" }}>Open LinkedIn ↗</a>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap" }}>
        {steps.map((s, i) => {
          const isNext = !s.done && unlocked && !gated;
          if (!s.done) unlocked = false;
          return <div key={i} style={{ flex: "1 1 190px", minWidth: 180 }}>{stepCard(s.label, s.title, s.sub, isNext, s.done, s.render(isNext))}</div>;
        })}
      </div>
    </div>
  );
}

export function RestrictionControl({ r, onAccount, onApp, onDeleteEvent, onNote }: { r: Row; onAccount: (patch: Record<string, unknown>, reload?: boolean) => void; onApp: (patch: Record<string, unknown>) => void; onDeleteEvent: (at: string) => void; onNote?: (text: string) => void }) {
  const hasAcct = !!r.accountId;
  const issue = (r.accountIssue || "").toLowerCase();
  const restrictIssue = issue.includes("withdrawn") || issue.includes("permanent") || issue.includes("restricted");
  const current: "active" | "restricted" | "retired" | "withdrawn" =
    r.accountStatus === "removed" || issue.includes("withdrawn") ? "withdrawn"
      : r.accountStatus === "retired" || issue.includes("permanent") ? "retired"
        : r.accountRestrictedAt || issue.includes("restricted") ? "restricted"
          : "active";
  const dead = r.accountStatus === "retired" || r.accountStatus === "removed";
  const undead = dead ? { status: "unavailable" } : {};
  const apply = (key: "active" | "restricted" | "retired" | "withdrawn") => {
    if (key === "active" && r.restrictionReport) onApp({ setRestrictionReport: null, restrictionReport: null });
    if (hasAcct) {
      // Marking restricted: confirm, then offer to email the owner + referrer the restricted
      // notice (login details + 2FA recovery link) — a deliberate one-tap choice so a restrict
      // is never a silent credential send. The account route notifies + logs it when the flag
      // is on, and returns who was emailed (surfaced by patchAccount).
      if (key === "restricted") {
        const name = r.fullName || "this account";
        const rented = r.accountStatus === "rented";
        if (!window.confirm(`Mark ${name} restricted?\n\nOnly do this if LinkedIn actually restricted the account.${rented ? " It pauses the renter's billing." : ""}`)) return;
        const notifyOwnerReferrer = window.confirm(`Email the owner + referrer now that ${name} is restricted?\n\nSends the "account restricted / payment suspended" message (includes their login details + 2FA recovery link when a password is on file) and logs it on the account. Cancel just marks it restricted without emailing.`);
        onAccount({ restrictedAt: new Date().toISOString(), notifyOwnerReferrer, ...undead }, true);
        onNote?.(`Marked restricted${notifyOwnerReferrer ? " · emailed owner + referrer" : ""}`);
        return;
      }
      const patch: Record<string, unknown> = key === "active" ? { restrictedAt: null, ...undead } : key === "retired" ? { status: "retired", restrictedAt: new Date().toISOString() } : { status: "removed" };
      if (key === "active" && restrictIssue) patch.accountIssue = null;
      onAccount(patch, true);
      onNote?.(key === "active" ? "Marked active (recovered)" : key === "retired" ? "Marked permanently restricted" : "Marked withdrawn");
    } else {
      onApp({ accountIssue: key === "active" ? null : key === "restricted" ? "Restricted" : key === "retired" ? "Permanently restricted" : "Withdrawn" });
      onNote?.(key === "active" ? "Marked active" : key === "restricted" ? "Marked restricted" : key === "retired" ? "Marked permanently restricted" : "Marked withdrawn");
    }
  };
  const opts: { key: "active" | "restricted" | "retired" | "withdrawn"; label: string; tone: [string, string] }[] = [
    { key: "active", label: "Active", tone: ["--st-active-bg,#e6f4ea", "--st-active-fg,#188038"] },
    { key: "restricted", label: "Restricted", tone: ["--st-cancel-bg,#fdecea", "--st-cancel-fg,#c0392b"] },
    { key: "retired", label: "Perm. restricted", tone: ["--st-cancel-bg,#fdecea", "--st-cancel-fg,#c0392b"] },
    { key: "withdrawn", label: "Withdrawn", tone: ["--neutral-bg,#eef1f5", "--muted,#647189"] },
  ];
  const history = Array.isArray(r.accountRestrictionLog) ? r.accountRestrictionLog : [];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {opts.map((o) => {
          const on = current === o.key;
          return (
            <button key={o.key} onClick={(e) => { e.stopPropagation(); apply(o.key); }}
              style={{ font: `600 11.5px ${F_SANS}`, padding: "5px 11px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", border: "1px solid", borderColor: on ? "transparent" : "var(--input-border,#dcdce0)", background: on ? `var(${o.tone[0]})` : "transparent", color: on ? `var(${o.tone[1]})` : "var(--muted,#647189)" }}>
              {on ? "● " : ""}{o.label}
            </button>
          );
        })}
      </div>
      {history.length > 0 && (() => {
        const restrictedCount = history.filter((e) => e.event !== "recovered").length;
        const rel = (at: string) => { const d = ageDays(at); return d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`; };
        return (
          <div style={{ marginTop: 8, background: "var(--inset,#f7f8fa)", border: "1px solid var(--card-border,#e7ebf0)", borderRadius: 10, padding: "8px 11px" }}>
            <div style={{ font: `700 9.5px ${F_SANS}`, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted2,#9aa0a6)", marginBottom: 7 }}>Restriction history · Restricted {restrictedCount}×</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {history.slice().reverse().map((e, i) => {
                const recovered = e.event === "recovered";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                    <span style={{ flex: "none", width: 54, font: `500 10.5px ${F_SANS}`, color: "var(--muted2,#9aa0a6)", whiteSpace: "nowrap" }} title={fmtDate(e.at)}>{rel(e.at)}</span>
                    <span style={{ flex: "none", width: 66, font: `700 10.5px ${F_SANS}`, color: recovered ? "var(--st-active-fg,#188038)" : "var(--st-cancel-fg,#c0392b)" }}>{recovered ? "Active" : "Restricted"}</span>
                    <span style={{ flex: 1, minWidth: 0, font: `500 11px/1.35 ${F_SANS}`, color: "var(--fg,#444)" }}>{recovered ? (e.note ? `Cleared — ${e.note}` : "Cleared") : (e.note || "Restricted")}{e.creditedDays ? ` · +${e.creditedDays}d credit` : ""}</span>
                    {hasAcct && (
                      <button title="Delete this entry (added by mistake)"
                        onClick={(ev) => { ev.stopPropagation(); if (confirm(`Delete this ${recovered ? "recovered" : "restricted"} entry from ${fmtDate(e.at)}? This only fixes the history — it doesn't restrict or recover the account.`)) onDeleteEvent(e.at); }}
                        style={{ flex: "none", font: `700 12px ${F_SANS}`, lineHeight: 1, color: "var(--muted2,#9aa0a6)", background: "none", border: "none", cursor: "pointer", padding: "0 1px" }}>×</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      {r.restrictionReport && current === "restricted" && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "var(--purple-chip-bg,#efe7fd)", border: "1px solid var(--purple-chip-border,#d9c9fb)", borderRadius: 8, padding: "6px 10px" }}>
          <span style={{ font: `700 10.5px ${F_SANS}`, color: "var(--purple-chip-text,#6b3fd4)" }}>
            Referrer says {r.restrictionReport.type === "recovered" ? "it's unrestricted now" : "the owner did LinkedIn's QR/ID check"} · {fmtDate(r.restrictionReport.at)} — verify, then set Active to recover
          </span>
          <button onClick={(e) => { e.stopPropagation(); onApp({ setRestrictionReport: null, restrictionReport: null }); }} style={{ marginLeft: "auto", font: `700 10px ${F_SANS}`, padding: "3px 9px", borderRadius: 999, cursor: "pointer", border: "none", background: "var(--neutral-bg,#eef1f5)", color: "var(--muted,#647189)" }}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

function AccountHistoryCard({ r, busy, onSave }: { r: Row; busy: boolean; onSave: (patch: Record<string, unknown>, reload?: boolean) => void }) {
  const savedJoined = r.linkedinJoinedAt ? r.linkedinJoinedAt.slice(0, 7) : ""; // YYYY-MM
  const savedConns = r.connectionCount != null ? String(r.connectionCount) : "";
  const [joined, setJoined] = useState(savedJoined);
  const [conns, setConns] = useState(savedConns);
  const dirty = joined !== savedJoined || conns !== savedConns;
  const ageMonths = joined ? Math.max(0, (new Date().getFullYear() - Number(joined.slice(0, 4))) * 12 + (new Date().getMonth() - (Number(joined.slice(5, 7)) - 1))) : null;
  const save = () => {
    const patch: Record<string, unknown> = { linkedinJoinedAt: joined ? new Date(joined + "-01T00:00:00Z").toISOString() : null };
    const n = parseInt(conns, 10);
    if (conns === "" || !Number.isNaN(n)) patch.connectionCount = conns === "" ? 0 : n;
    onSave(patch, true);
  };
  return (
    <div>
      <p style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted,#8a93a3)", margin: "0 0 10px", lineHeight: 1.45 }}>
        From the LinkedIn profile: open <b>⋯ (More)</b> → <b>About this member</b> → <b>Account history</b> for the “Joined LinkedIn” month, and read the current connection count off the profile. Recorded for our catalogue.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelCss}>Joined LinkedIn (month)</span>
          <input type="month" value={joined} onChange={(e) => setJoined(e.target.value)} style={{ ...inputCss, width: "auto" }} />
          {ageMonths != null && <span style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2,#9aa0a6)" }}>≈ {ageMonths} month{ageMonths === 1 ? "" : "s"} old</span>}
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelCss}>Connections (current)</span>
          <input type="number" min="0" value={conns} onChange={(e) => setConns(e.target.value)} placeholder="e.g. 500" style={{ ...inputCss, width: "auto" }} />
        </label>
        <button style={btnSec} disabled={busy || !dirty} onClick={save}>{dirty ? "Save to inventory" : "✓ Saved"}</button>
      </div>
      {(() => {
        const hist = r.connectionHistory || [];
        const counts = hist.filter((e) => typeof e.count === "number" && !e.note);
        const first = counts[0], last = counts[counts.length - 1];
        const days = first && last ? Math.max(1, Math.round((new Date(last.at).getTime() - new Date(first.at).getTime()) / 86400000)) : 0;
        const growth = first && last && last !== first ? last.count - first.count : null;
        if (!hist.length) return null;
        return (
          <div style={{ borderTop: "1px solid var(--divider,#eee)", marginTop: 12, paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={labelCss}>Connection history</span>
              {growth != null && <span style={{ font: `600 11px ${F_SANS}`, color: growth >= 0 ? "var(--st-active-fg,#15803d)" : "var(--st-restrict-fg,#b91c1c)" }}>{growth >= 0 ? "+" : ""}{growth} in {days}d</span>}
            </div>
            <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
              {hist.map((e, i) => {
                const prev = i > 0 ? hist[i - 1] : null;
                const delta = prev && !e.note ? e.count - prev.count : null;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, font: `500 11.5px ${F_SANS}`, color: "var(--text2,#444)" }}>
                    <span style={{ color: "var(--muted2,#9aa0a6)", flex: "none", width: 92 }}>{fmtDate(e.at)}</span>
                    {e.note
                      ? <span style={{ font: `700 10px ${F_SANS}`, padding: "1px 7px", borderRadius: 999, background: e.note === "rented" ? "var(--link-bg,#eaf1ff)" : "var(--neutral-bg,#eef1f5)", color: e.note === "rented" ? "var(--link,#0a66c2)" : "var(--muted,#647189)" }}>{e.note === "rented" ? "🔑 Rented" : "↩ Returned"} · {e.count}</span>
                      : <><b style={{ color: "var(--fg,#111)" }}>{e.count}</b> connections {delta != null && delta !== 0 && <span style={{ color: delta > 0 ? "var(--st-active-fg,#15803d)" : "var(--st-restrict-fg,#b91c1c)" }}>({delta > 0 ? "+" : ""}{delta})</span>}</>}
                    <button type="button" title="Delete this entry" disabled={busy} onClick={() => onSave({ deleteConnectionHistoryIndex: i }, true)} style={{ marginLeft: "auto", flex: "none", border: "none", background: "none", cursor: "pointer", color: "var(--muted2,#9aa0a6)", font: `700 13px ${F_SANS}`, lineHeight: 1, padding: "0 2px" }}>×</button>
                  </div>
                );
              }).reverse()}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function ProfileBuildCard({ r, busy, onGenerate, onApply }: { r: Row; busy: boolean; onGenerate: (r: Row, lane: string) => void; onApply: (r: Row) => void }) {
  const [lane, setLane] = useState("auto");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const p = r.profileBuild;
  const applied = !!p?.appliedAt;
  const copy = (key: string, text: string) => { navigator.clipboard?.writeText(text); setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1200); };
  const LANE_OPTS: [string, string][] = [["auto", "Auto (random lane)"], ["Business Development", "Business Development"], ["Sales", "Sales"], ["Marketing", "Marketing"], ["GTM", "GTM"]];
  const field = (key: string, label: string, value: string, multiline = false) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ font: `700 10px ${F_SANS}`, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--muted2,#9aa0a6)" }}>{label}</span>
        <button onClick={() => copy(key, value)} style={{ font: `600 10px ${F_SANS}`, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--input-border,#dcdce0)", background: "transparent", color: "var(--muted,#647189)", cursor: "pointer", flex: "none" }}>{copiedKey === key ? "✓ Copied" : "Copy"}</button>
      </div>
      <div style={{ font: `500 12.5px ${F_SANS}`, color: "var(--text2,#333)", lineHeight: 1.4, whiteSpace: multiline ? "pre-wrap" : "normal", marginTop: 2, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: p ? 12 : 0 }}>
        <select value={lane} onChange={(e) => setLane(e.target.value)} style={{ ...inputCss, width: "auto", padding: "5px 8px", cursor: "pointer" }}>
          {LANE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button style={btnSec} disabled={busy} onClick={() => onGenerate(r, lane)}>{p ? "↻ Regenerate" : "Generate profile"}</button>
        {p && <span style={{ font: `500 10.5px ${F_SANS}`, color: "var(--muted2,#9aa0a6)" }}>Generated {fmtDate(p.generatedAt)}</span>}
      </div>
      {!p && <p style={{ font: `500 12px ${F_SANS}`, color: "var(--muted,#777)", margin: "8px 0 0", lineHeight: 1.4 }}>Generates a copy-paste profile: US location, PH work history (2 past roles) + PH school, BD/Sales/Marketing/GTM capped at manager.</p>}
      {p && <>
        {field("headline", "Headline", p.headline)}
        {field("location", "Location", p.location)}
        {field("zip", "ZIP code", p.zip)}
        {field("industry", "Industry", p.industry)}
        {field("about", "About", p.about, true)}
        {p.experiences.map((x, i) => (
          <div key={i} style={{ borderTop: "1px solid var(--divider,#eee)", paddingTop: 8, marginTop: 8 }}>
            {field(`e${i}t`, `Experience ${i + 1} · Title`, x.title)}
            {field(`e${i}c`, "Company", x.company)}
            <div style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted,#647189)", marginBottom: 6 }}>{x.start} – {x.end} · {x.duration} · past role</div>
            {field(`e${i}b`, "Description", x.blurb, true)}
          </div>
        ))}
        <div style={{ borderTop: "1px solid var(--divider,#eee)", paddingTop: 8, marginTop: 8 }}>
          {field("school", "Education · School", p.education.school)}
          {field("degree", "Degree", p.education.degree)}
          <div style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted,#647189)" }}>{p.education.start} – {p.education.end}</div>
        </div>
        <button onClick={() => copy("all", [`HEADLINE\n${p.headline}`, `LOCATION\n${p.location} (ZIP ${p.zip})`, `INDUSTRY\n${p.industry}`, `ABOUT\n${p.about}`, `EXPERIENCE 1\n${p.experiences[0].title} · ${p.experiences[0].company}\n${p.experiences[0].start} – ${p.experiences[0].end} (${p.experiences[0].duration})\n${p.experiences[0].blurb}`, `EXPERIENCE 2\n${p.experiences[1].title} · ${p.experiences[1].company}\n${p.experiences[1].start} – ${p.experiences[1].end} (${p.experiences[1].duration})\n${p.experiences[1].blurb}`, `EDUCATION\n${p.education.school}\n${p.education.degree} · ${p.education.start} – ${p.education.end}`].join("\n\n"))} style={{ ...btnSec, marginTop: 12 }}>{copiedKey === "all" ? "✓ Copied all" : "Copy all"}</button>
        <div style={{ borderTop: "1px solid var(--divider,#eee)", marginTop: 12, paddingTop: 10 }}>
          {applied ? (
            <div style={{ font: `600 11.5px ${F_SANS}`, color: "var(--st-active-fg,#15803d)", lineHeight: 1.5 }}>
              ✓ Saved to inventory · {fmtDate(p.appliedAt!)}
              <div style={{ font: `500 11px ${F_SANS}`, color: "var(--muted,#647189)", marginTop: 2 }}>Inventory headline: “{p.headline.split("|")[0].trim()}” · {p.location}</div>
            </div>
          ) : (
            <button style={{ ...btnSec, borderColor: "var(--st-active-fg,#15803d)", color: "var(--st-active-fg,#15803d)" }} disabled={busy} title="Once you've pasted this into LinkedIn, save it to inventory: writes the location and the SHORT headline (before the first | ) to the account." onClick={() => onApply(r)}>✅ Mark saved (apply to inventory)</button>
          )}
        </div>
      </>}
    </div>
  );
}

function OutreachLog({ r, busy, onLog, onSetFollowUp, onDelete }: { r: Row; busy: boolean; onLog: (id: string, ch: string, text: string, by: string) => Promise<void>; onSetFollowUp: (iso: string | null) => void; onDelete: (at: string) => void }) {
  const [draft, setDraft] = useState("");
  const [by, setBy] = useState("");
  const log = r.outreachLog;
  const chan = messagingChannel(r);
  const send = async (ch: string) => { await onLog(r.id, ch, draft.trim(), by.trim()); setDraft(""); };
  const followVal = r.nextFollowUp ? new Date(r.nextFollowUp).toISOString().slice(0, 10) : "";
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted,#777)" }}>{touchCount(log)} {touchCount(log) === 1 ? "touch" : "touches"} · last {lastTouchAt(log) || "—"}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `500 11.5px ${F_SANS}`, color: "var(--muted,#777)" }}>Follow up <input type="date" value={followVal} onChange={(e) => onSetFollowUp(e.target.value ? new Date(e.target.value).toISOString() : null)} style={{ ...inputCss, width: "auto", padding: "4px 7px", cursor: "pointer" }} /></span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What happened? Logged with the date and your name." style={{ ...inputCss, width: "100%" }} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Who sent it?" style={{ ...inputCss, width: 130, flex: "none" }} />
          <span style={{ font: `600 10.5px ${F_SANS}`, color: "var(--muted2,#9aa0a6)" }}>LOG</span>
          {[chan, "email", "text", "note"].map((ch) => <button key={ch} onClick={() => send(ch)} disabled={busy} style={btnSec}>+ {touchLabel(ch)}</button>)}
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--divider,#eee)", paddingTop: 6, maxHeight: 300, overflowY: "auto" }}>
        {log && log.length ? [...log].reverse().map((t, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "6px 0" }}>
            <span style={touchChipStyle(t.ch)}>{touchLabel(t.ch)}</span>
            <span title={t.text} style={{ flex: 1, minWidth: 0, font: `500 12.5px ${F_SANS}`, color: "var(--text2,#333)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}>{t.text}</span>
            <span style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2,#9aa0a6)", whiteSpace: "nowrap", flex: "none" }}>{(t.by ? t.by + " · " : "") + fmtDateTime(t.at)}</span>
            <span onClick={() => { if (confirm("Delete this outreach entry?")) onDelete(t.at); }} title="Delete entry" style={{ font: `600 13px ${F_SANS}`, color: "var(--muted2,#9aa0a6)", cursor: "pointer", flex: "none", lineHeight: 1.2 }}>×</span>
          </div>
        )) : <span style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted,#777)" }}>No outreach logged yet.</span>}
      </div>
    </div>
  );
}

export function AccountOnlyCard({ r, patchAccount, deleteRestrictionEvent }: {
  r: Row;
  patchAccount: (id: string, accountId: string, patch: Record<string, unknown>, reload?: boolean) => void;
  deleteRestrictionEvent: (accountId: string, at: string) => void;
}) {
  const acctSave = (patch: Record<string, unknown>, reload = false) => { if (r.accountId) patchAccount(r.id, r.accountId, patch, reload); };
  const facts = [
    r.loginEmail && `Login: ${r.loginEmail}`,
    r.connectionCount != null && `${r.connectionCount} connections`,
    r.linkedinVerified && "Verified",
    r.proxyLocation && `Proxy: ${r.proxyLocation}`,
    r.accountStatus && `Status: ${r.accountStatus}`,
  ].filter(Boolean) as string[];
  return (
    <div style={{ background: "var(--card,#fff)", border: "1px solid var(--card-border,#e3e3e6)", borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ font: `700 15px ${F_GRO}`, color: "var(--fg,#111)" }}>{r.fullName}</span>
        <span title="Inventory account with no ambassador application" style={{ font: `700 10px ${F_SANS}`, padding: "2px 8px", borderRadius: 999, background: "var(--band,#f1f1f2)", color: "var(--muted,#647189)" }}>Inventory only · no application</span>
        {r.accountRestrictedAt && <span style={{ font: `700 10px ${F_SANS}`, padding: "2px 8px", borderRadius: 999, background: "var(--st-cancel-bg,#fdecea)", color: "var(--st-cancel-fg,#c0392b)" }}>⚠ Restricted {fmtDate(r.accountRestrictedAt)}</span>}
        <a href="/admin/inventory-v2" style={{ marginLeft: "auto", font: `600 11.5px ${F_SANS}`, color: "var(--link,#1a56db)", textDecoration: "none" }}>Open in Inventory →</a>
      </div>
      {facts.length > 0 && <div style={{ font: `500 12px ${F_SANS}`, color: "var(--muted,#647189)", marginBottom: 10 }}>{facts.join("  ·  ")}</div>}
      <div style={{ ...labelCss, marginBottom: 6 }}>Restriction</div>
      <RestrictionControl r={r} onAccount={acctSave} onApp={() => {}} onDeleteEvent={(at) => { if (r.accountId) deleteRestrictionEvent(r.accountId, at); }} />
    </div>
  );
}

// The full expanded-row detail — Pipeline v2 layout: workflow bar on top, then a 3-column
// card grid. Applicant / Sign-in & credentials / Payout cards have a per-card read↔edit
// toggle; Payments is a compact summary that links out to the Payouts page. Same wiring.
export function CardDetail({ r, h }: { r: Row; h: Handlers }) {
  const { busy, patchApp, patchAccount, deleteRestrictionEvent, workflow, setStage, provisionGologin, createAccount, verifySignin, transferToLv, generateProfile, applyProfile, deleteGologin, logTouch, onDeleteApp } = h;
  const [editSec, setEditSec] = useState<string | null>(null);
  // null = not rejecting; string = the reason-entry box is open (holds the typed reason).
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const live = isLive(r);
  // A row whose linked account has been pulled (withdrawn/removed) or permanently
  // restricted (retired) is dead even if the application still reads as "live"
  // (status approved/onboarded). Without this, the account toggle marks the account
  // removed but the application stays approved → the row never leaves the active
  // pipeline and there's no visible way to close it. Treat a dead account like a
  // not-live row so the "Close application…" footer (Unresponsive / Rejected) shows.
  const accountDead = r.accountStatus === "removed" || r.accountStatus === "retired";
  const onboarded = r.status === "onboarded";
  const paid = setupPaid(r);
  const acctSave = (patch: Record<string, unknown>, reload = false) => { if (r.accountId) patchAccount(r.id, r.accountId, patch, reload); };
  const onboardingPhoto = (r.adminNotes || "").match(/Owner photo:\s*(https?:\/\/\S+)/)?.[1] || null; // original from signup — reference, never overwritten
  const editedPhoto = r.profilePhotoUrl; // the edited/clear version we upload → this is what inventory shows
  const [photoUploading, setPhotoUploading] = useState(false);
  const uploadPhoto = async (file: File) => {
    if (!r.accountId) { alert("No account linked yet — create the account first."); return; }
    setPhotoUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) { alert(typeof d.error === "string" ? d.error : `Upload failed (${res.status}).`); return; }
      acctSave({ profilePhotoUrl: d.url }, true); // same field inventory reads → shows there automatically
    } finally { setPhotoUploading(false); }
  };
  const col: CSSProperties = { flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 };
  const meetings = new Map<string, Touch>();
  for (const entry of r.outreachLog || []) if (entry.bookingKey && entry.scheduledAt) meetings.set(entry.bookingKey, entry);

  const applicantFields: FieldSpec[] = [
    { k: "fullName", label: "Full name", value: r.fullName, placeholder: "display name", hint: "how they show in the pipeline & owner lists — shorten long ones here", onSave: (v) => { const name = String(v ?? "").trim(); if (!name) return; if (r.accountOnly) { if (r.accountId) patchAccount(r.id, r.accountId, { linkedinName: name }, true); } else patchApp(r.id, { fullName: name }, true); } },
    { k: "linkedinUrl", label: "LinkedIn URL", value: r.linkedinUrl, kind: "link", placeholder: "linkedin.com/in/…", onSave: (v) => patchApp(r.id, { linkedinUrl: v }) },
    { k: "linkedinEmail", label: "Applied with (LinkedIn email)", value: r.linkedinEmail, placeholder: "same as owner", onSave: (v) => patchApp(r.id, { linkedinEmail: v }) },
    { k: "contactNumber", label: "Contact number / handle", value: r.contactNumber, placeholder: "phone / handle", onSave: (v) => patchApp(r.id, { contactNumber: v }) },
    { k: "contactChannel", label: "Contact channel", value: r.contactChannel, placeholder: "Viber / Telegram / WhatsApp", onSave: (v) => patchApp(r.id, { contactChannel: v }) },
    { k: "location", label: "Location", value: r.location, placeholder: "city / country", onSave: (v) => patchApp(r.id, { location: v }) },
    { k: "industry", label: "Industry", value: r.industry, placeholder: "—", onSave: (v) => patchApp(r.id, { industry: v }) },
    { k: "connections", label: "Connections", value: r.connectionCount, kind: "numeric", placeholder: "e.g. 500", onSave: (v) => patchApp(r.id, { connectionCount: v }) },
    { k: "referralSource", label: "Found us via", value: r.referralSource, placeholder: "flyer / FB / referral", onSave: (v) => patchApp(r.id, { referralSource: v }) },
    { k: "referredBy", label: "Referred by", value: r.referredBy, placeholder: "marketer code", onSave: (v) => patchApp(r.id, { referredBy: v }) },
    { k: "bookingEmail", label: "Booking email", value: r.bookingEmail, placeholder: "if booked with another email", onSave: (v) => patchApp(r.id, { bookingEmail: v }) },
    { k: "poc", label: "LV handler (POC)", value: r.poc, placeholder: "who's handling this", onSave: (v) => { if (!r.accountOnly) patchApp(r.id, { poc: v }); if (r.accountId) patchAccount(r.id, r.accountId, { poc: v }); } },
    { k: "ownerStatus", label: "Owner status", value: r.ownerStatus || "", kind: "select", options: OWNER_STATUS_OPTIONS, onSave: (v) => patchApp(r.id, { ownerStatus: (v as string) || null }) },
    { k: "accountIssue", label: "Account issue", value: r.accountIssue, placeholder: "login problem, restriction…", onSave: (v) => patchApp(r.id, { accountIssue: v }) },
  ];
  const credFields: FieldSpec[] = r.accountId ? [
    { k: "loginEmail", label: "Login email (work)", value: r.loginEmail, placeholder: "klabber address we sign in with", onSave: (v) => acctSave({ loginEmail: v }) },
    { k: "personalEmail", label: "Personal email (on account)", value: r.personalEmail, placeholder: "ambassador's own", onSave: (v) => acctSave({ personalEmail: v }) },
    { k: "workEmail", label: "Work / recovery email", value: r.workEmail, placeholder: "recovery email on the account", onSave: (v) => acctSave({ workEmail: v }) },
    { k: "password", label: "Password", value: r.accountPassword, kind: "secret", placeholder: "set account password", onSave: (v) => acctSave({ accountPassword: v }) },
    { k: "twofa", label: "2FA / TOTP", value: r.twoFactor, kind: "secret", hint: "backup code / secret", placeholder: "2FA secret / backup", onSave: (v) => acctSave({ twoFactor: v }) },
    { k: "gologin", label: "GoLogin share link", value: r.gologinShareLink, kind: "link", placeholder: "https://app.gologin.com/share/…", onSave: (v) => acctSave({ gologinShareLink: v }, true) },
    { k: "proxy", label: "Proxy · host:port:user:pass", value: proxyCombined(r), placeholder: "1.2.3.4:8000:username:password", onSave: (v) => acctSave(parseProxy(v)) },
    { k: "proxyLocation", label: "Proxy location", value: r.proxyLocation, placeholder: "City, Country", onSave: (v) => acctSave({ proxyLocation: v }) },
    { k: "accountStatus", label: "Account status", value: r.accountStatus || "under_review", kind: "select", options: ACCOUNT_STATUS_OPTIONS.map((s) => ({ value: s, label: s === "under_construction" ? "Pipeline" : s === "construction_immature" ? "Construction (Immature)" : s.replace(/_/g, " ") })), onSave: (v) => acctSave({ status: v }, true) },
    { k: "verified", label: "LinkedIn verified", value: r.linkedinVerified ? "yes" : "no", kind: "select", options: [{ value: "no", label: "No" }, { value: "yes", label: "✓ Yes" }], onSave: (v) => acctSave({ linkedinVerified: v === "yes" }, true) },
  ] : [];
  const payoutFields: FieldSpec[] = [
    { k: "method", label: "Method", value: r.paymentMethod, placeholder: "Wise / PayPal / GCash", onSave: (v) => patchApp(r.id, { paymentMethod: v }) },
    { k: "details", label: "Account no. / handle", value: r.paymentDetails, placeholder: "email / number / account", onSave: (v) => patchApp(r.id, { paymentDetails: v }) },
    { k: "payoutName", label: "Name on account", value: r.payoutName, placeholder: "name on the account", onSave: (v) => patchApp(r.id, { payoutName: v }) },
    { k: "currency", label: "Currency", value: r.payoutCurrency || "", kind: "select", options: [{ value: "", label: "Auto" }, { value: "PHP", label: "PHP ₱" }, { value: "USD", label: "USD $" }], onSave: (v) => patchApp(r.id, { payoutCurrency: (v as string) || null }) },
    ...(r.accountId ? [
      { k: "payoutMo", label: "Payout /mo", value: r.ambassadorPayment, kind: "numeric" as const, placeholder: "amount", onSave: (v: string | number | null) => acctSave({ ambassadorPayment: v ?? 0 }) },
      { k: "rentMo", label: "Rent /mo ($)", value: r.monthlyPrice, kind: "numeric" as const, placeholder: "e.g. 50", onSave: (v: string | number | null) => acctSave({ monthlyPrice: v ?? 0 }) },
    ] : []),
  ];

  const appEditing = editSec === "applicant";
  const credEditing = editSec === "cred";
  const payEditing = editSec === "payout";
  const editToggle = (sec: string, on: boolean) => <button onClick={(e) => { e.stopPropagation(); setEditSec(on ? null : sec); }} style={editLinkStyle}>{on ? "Done" : "Edit"}</button>;

  const cfg = cfgOf(r);
  const setupDone = setupPaid(r);
  const setupPay = (r.monthlyPayouts || []).find((p) => p.kind === "setup");
  const monthlyStarted = (r.monthlyPayouts || []).some((p) => p.kind === "monthly");
  const pill = (text: string, green?: boolean): CSSProperties => ({ font: `700 11px ${F_SANS}`, padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap", flex: "none", background: green ? "var(--st-active-bg,#dcfce7)" : "var(--band,#f1f3f6)", color: green ? "var(--st-active-fg,#15803d)" : "var(--muted,#5b6779)" });
  const payRow = (title: string, sub: string, pillNode: ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ font: `700 13px ${F_SANS}`, color: "var(--fg,#111)" }}>{title}</div>
        <div style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted2,#9aa0a6)" }}>{sub}</div>
      </div>
      {pillNode}
    </div>
  );

  return (
    <div style={{ borderTop: "1px solid var(--divider,#eee)", background: "var(--panel,#fafafa)", padding: 16 }}>
      {!onboarded && <WorkflowRail r={r} busy={busy} workflow={workflow} setStage={setStage} verifySignin={verifySignin} />}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
        {/* ── Left column: Applicant · Sign-in & credentials ── */}
        <div style={col}>
          <PanelCard title="Applicant" right={<div style={{ display: "flex", alignItems: "center", gap: 10 }}>{r.linkedinUrl && <a href={liHref(r.linkedinUrl)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ font: `700 12px ${F_SANS}`, color: "var(--link,#0a66c2)", textDecoration: "none" }}>View profile ↗</a>}{editToggle("applicant", appEditing)}</div>}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: 10, background: "var(--inset,#f8f9fb)", borderRadius: 12, flexWrap: "wrap" }}>
              {/* Original (from onboarding) — kept for reference, never overwritten */}
              {onboardingPhoto && (
                <div style={{ flex: "none", textAlign: "center" }}>
                  <a href={onboardingPhoto} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={onboardingPhoto} alt="Original photo" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 12, border: "1px solid var(--line,#e6e8ec)", display: "block", opacity: 0.85 }} /></a>
                  <div style={{ ...labelCss, marginTop: 4 }}>Original · onboarding</div>
                </div>
              )}
              {/* Edited (on inventory) — what we upload; falls back to initials placeholder */}
              <div style={{ flex: "none", textAlign: "center" }}>
                {editedPhoto
                  ? <a href={editedPhoto} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={editedPhoto} alt="Edited photo" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 12, border: "2px solid var(--st-active-fg,#16a34a)", display: "block" }} /></a>
                  : <div style={{ width: 64, height: 64, borderRadius: 12, border: "1.5px dashed var(--input-border,#c5cbd3)", background: "var(--card,#fff)", display: "flex", alignItems: "center", justifyContent: "center", font: `700 18px ${F_GRO}`, color: "var(--muted2,#b0b7c3)" }}>{initialsOf(r.fullName)}</div>}
                <div style={{ ...labelCss, marginTop: 4, color: editedPhoto ? "var(--st-active-fg,#15803d)" : "var(--muted2,#9aa0a6)" }}>{editedPhoto ? "Edited · on inventory" : "No edited photo"}</div>
              </div>
              {/* Upload control + note */}
              <div style={{ minWidth: 120, flex: 1 }}>
                <div style={{ ...labelCss, marginBottom: 3 }}>Profile photo</div>
                <div style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted,#8a93a3)", lineHeight: 1.4 }}>Upload an edited/clearer version — it goes to inventory. The original from onboarding stays here for reference.</div>
                {r.accountId && <label onClick={(e) => e.stopPropagation()} title="Upload an edited/clearer photo. Saved to the account and shown on inventory. The original onboarding photo is kept as reference." style={{ display: "inline-block", marginTop: 6, font: `700 12px ${F_SANS}`, color: photoUploading ? "var(--muted,#8a93a3)" : "var(--link,#0a66c2)", cursor: photoUploading ? "wait" : "pointer" }}>
                  {photoUploading ? "Uploading…" : editedPhoto ? "Replace edited photo ↑" : "Upload edited photo ↑"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" disabled={photoUploading} style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadPhoto(f); }} />
                </label>}
              </div>
            </div>
            <ToggleFields fields={applicantFields} editing={appEditing} onEdit={() => setEditSec("applicant")} />
            {!appEditing && r.contactNumber && (() => {
              const links = messagingLinks(r.contactNumber, r.location);
              const apps: [keyof typeof links, string][] = [["viber", "Viber"], ["whatsapp", "WhatsApp"], ["telegram", "Telegram"]];
              const avail = apps.filter(([k]) => links[k]);
              if (!avail.length) return null;
              return <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 2 }}>
                <span style={{ font: `700 9.5px ${F_SANS}`, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted2,#9aa0a6)" }}>Message</span>
                {avail.map(([k, label]) => <a key={k} href={links[k]} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ font: `700 11px ${F_SANS}`, color: "var(--link,#0a66c2)", border: "1px solid var(--line,#d6e4fb)", borderRadius: 8, padding: "5px 10px", textDecoration: "none", whiteSpace: "nowrap" }}>{label}</a>)}
              </div>;
            })()}
          </PanelCard>

          <PanelCard title="Sign-in & credentials" right={
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {!r.accountId ? <span style={{ font: `600 11px ${F_SANS}`, color: "var(--muted2,#9aa0a6)" }}>no account linked</span>
                : !r.hasGologin ? <button onClick={(e) => { e.stopPropagation(); void provisionGologin(r); }} disabled={busy} title="Create the GoLogin profile, assign a proxy, and generate the share link" style={{ font: `700 11px ${F_SANS}`, color: "#fff", background: "var(--st-active-fg,#188038)", border: "none", padding: "5px 10px", borderRadius: 8, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>{busy ? "Creating…" : "+ Create GoLogin"}</button>
                  : <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {r.gologinShareLink ? <a href={liHref(r.gologinShareLink)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ font: `600 11px ${F_SANS}`, color: "var(--link,#0a66c2)", textDecoration: "none" }}>↗ Open</a> : <span style={{ font: `600 11px ${F_SANS}`, color: "var(--muted,#8a97ad)" }}>GoLogin ready</span>}
                      <button onClick={(e) => { e.stopPropagation(); void deleteGologin(r); }} disabled={busy} title="Delete the GoLogin profile, clear its share link, unassign the proxy" style={{ font: `600 11px ${F_SANS}`, color: "var(--danger,#c0392b)", background: "transparent", border: "none", padding: 0, cursor: busy ? "wait" : "pointer" }}>Delete</button>
                    </div>}
              {r.accountId && editToggle("cred", credEditing)}
            </div>
          }>
            <div><div style={{ ...labelCss, marginBottom: 6 }}>Status</div><RestrictionControl r={r} onAccount={acctSave} onApp={(patch) => patchApp(r.id, patch)} onDeleteEvent={(at) => { if (r.accountId) deleteRestrictionEvent(r.accountId, at); }} onNote={(text) => { void logTouch(r.id, "note", text, ""); }} /></div>
            {r.accountId && (
              <div><div style={{ ...labelCss, marginBottom: 6 }}>Warm-up</div>
                <button onClick={(e) => { e.stopPropagation(); acctSave({ warmupStartedAt: r.warmupStartedAt ? null : new Date().toISOString() }, true); }} disabled={busy} title="Toggle whether this account is actively being warmed up (Ortus app)" style={{ font: `600 11.5px ${F_SANS}`, padding: "5px 11px", borderRadius: 999, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap", border: "1px solid", borderColor: r.warmupStartedAt ? "transparent" : "var(--input-border,#dcdce0)", background: r.warmupStartedAt ? "var(--warn-badge-bg,#fef3c7)" : "transparent", color: r.warmupStartedAt ? "var(--warn-badge-text,#b7791f)" : "var(--muted,#647189)" }}>{r.warmupStartedAt ? `🔥 ${ageDays(r.warmupStartedAt)}d` : "Not warming up"}</button>
              </div>
            )}
            {r.accountId ? (<>
              {r.twoFactor && <TotpCode key={r.twoFactor} secretKey={r.twoFactor} />}
              {needsGologin(r) && !r.hasGologin && <div style={{ font: `600 11px ${F_SANS}`, color: "var(--warn-badge-text,#b7791f)" }}>⚠ No GoLogin — this account cannot be run</div>}
              <ToggleFields fields={credFields} editing={credEditing} onEdit={() => setEditSec("cred")} />
            </>) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={(e) => { e.stopPropagation(); void createAccount(r); }} disabled={busy} title="Create a linked inventory account from this application, then add the login, GoLogin, 2FA and pricing here" style={{ alignSelf: "flex-start", font: `700 12px ${F_SANS}`, color: "#fff", background: "var(--st-active-fg,#188038)", border: "none", padding: "8px 13px", borderRadius: 8, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>{busy ? "Creating…" : "+ Create account to add login"}</button>
                <div style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted,#888)", lineHeight: 1.5 }}>Creates a linked inventory account (matched by LinkedIn URL and an “Owner: email” note), then login, GoLogin, proxy, 2FA and pricing open up here. If one already exists on Inventory it links automatically.</div>
              </div>
            )}
          </PanelCard>
        </div>

        {/* ── Middle column: Chase an issue · Activity ── */}
        <div style={col}>
          <PanelCard title="Chase an issue">
            <PipelineIssueActions referrerResumeUrl={r.referrerResumeUrl} id={r.id} name={r.fullName} profile={r.linkedinUrl} lvEmail={r.loginEmail}
              ambassador={ambassadorIssueContact(r.email, r.contactNumber, r.contactChannel, r.location)} referrer={r.referrer} referrerSlug={r.referredBy}
              onboarded={onboarded} onSent={() => void workflow(r.id, {})} />
            {!!r.onboardingFix?.issues.length && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {r.onboardingFix.issues.map(issue => <button key={issue} style={btnSec} disabled={busy} onClick={() => {
                const remaining = r.onboardingFix!.issues.filter(value => value !== issue);
                void workflow(r.id, { setOnboardingFix: remaining.length ? { ...r.onboardingFix, issues: remaining } : null });
              }}>{r.onboardingFix?.state === "referrer_done" ? "Reported fixed" : "Open"}: {({ application_incomplete: "Application not complete", email_added: "Email not added", email_primary: "Email not primary", twofa: "2FA", password: "Password" })[issue]} · Mark resolved</button>)}
            </div>}
            {r.referredBy && r.referralSource === "self-service" && r.onboardingMethod !== "team_meeting" && !onboarded && (
              <button style={btnSec} disabled={busy} title="The referrer stops here and LV finishes the onboarding; their commission reverts to the base referral tier (not the DIY tier)." onClick={() => transferToLv(r)}>🔄 Transfer onboarding to LV (fee → base tier)</button>
            )}
            {r.referredBy && <a href={`/admin/referrals?ref=${encodeURIComponent(r.referredBy)}`} style={{ font: `700 12px ${F_SANS}`, color: "var(--link,#0a66c2)", textDecoration: "none" }}>View referrer →</a>}
            {r.asReferrer && <div style={{ marginTop: 8, font: `600 11.5px ${F_SANS}`, color: "var(--muted,#647189)" }}>Also a referrer · <a href={`/admin/referrals?ref=${encodeURIComponent(r.asReferrer.slug)}`} style={{ color: "var(--link,#0a66c2)", textDecoration: "none" }}>{r.asReferrer.slug} →</a><span title="Contact and payout details are shared with this referrer record"> · linked payout</span></div>}
          </PanelCard>

          {r.accountId && (
            <PanelCard title="Profile build (Level 4)">
              <ProfileBuildCard r={r} busy={busy} onGenerate={generateProfile} onApply={applyProfile} />
            </PanelCard>
          )}

          {r.accountId && (
            <PanelCard title="Account history (Level 4)">
              <AccountHistoryCard r={r} busy={busy} onSave={acctSave} />
            </PanelCard>
          )}

          {onboarded && paid && (
            <PanelCard title="Referral program">
              <PipelineReferralInvite id={r.id} ambassadorName={r.fullName} referrerName={r.referrer?.name ?? null}
                ambassador={ambassadorIssueContact(r.email, r.contactNumber, r.contactChannel, r.location)}
                referrer={r.referrer} referrerToken={r.referrer?.token ?? null}
                ambassadorPortalToken={r.asReferrer?.token ?? null} ambassadorReferrerSlug={r.asReferrer?.slug ?? null} onSent={() => void workflow(r.id, {})} />
            </PanelCard>
          )}

          <PanelCard title="Activity">
            {meetings.size > 0 && <div style={{ padding: "8px 10px", background: "var(--link-bg,#eaf1ff)", borderRadius: 8, font: `500 11.5px ${F_SANS}`, color: "var(--fg,#111)" }}>
              <b>Meeting booked</b>
              {(() => { const ms = [...meetings.values()].sort((a, b) => b.scheduledAt!.localeCompare(a.scheduledAt!)); return <>{ms.slice(0, 3).map(meeting => <div key={meeting.bookingKey} style={{ marginTop: 4 }}><time dateTime={meeting.scheduledAt}>{new Date(meeting.scheduledAt!).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>{meeting.cancelled && " · Cancelled"}</div>)}{ms.length > 3 && <div style={{ marginTop: 4, color: "var(--muted2,#9aa0a6)" }}>+{ms.length - 3} earlier</div>}</>; })()}
            </div>}
            <OutreachLog r={r} busy={busy} onLog={logTouch} onSetFollowUp={(iso) => patchApp(r.id, { nextFollowUp: iso })} onDelete={(at) => patchApp(r.id, { removeTouch: at }, true)} />
          </PanelCard>
        </div>

        {/* ── Right column: Payout · Payments · Admin notes ── */}
        <div style={col}>
          <PanelCard title="Payout" right={editToggle("payout", payEditing)}>
            <ToggleFields fields={payoutFields} editing={payEditing} onEdit={() => setEditSec("payout")} />
          </PanelCard>

          <PanelCard title="Payments" right={<span style={{ font: `500 12px ${F_SANS}`, color: "var(--muted,#5b6779)" }}>Total paid <b style={{ font: `700 13px ${F_GRO}`, color: "var(--st-active-fg,#15803d)" }}>{formatMoney(totalPaid(r), cfg.currency)}</b></span>}>
            {payRow(
              `Setup fee · ${formatMoney(cfg.setupAmount, cfg.currency)}`,
              setupDone ? `Paid ${fmtDate(setupPay?.paidAt || r.paidAt)}` : live ? "Owed now that they're onboarded" : "Owed once they're onboarded",
              <span style={pill(setupDone ? "✓ Paid" : live ? "Due" : "After onboarding", setupDone)}>{setupDone ? "✓ Paid" : live ? "Due" : "After onboarding"}</span>
            )}
            {payRow(
              `Monthly · ${formatMoney(monthlyAmt(r), cfg.currency)}/mo`,
              "First weekday of the month, after a full month live",
              <span style={pill(monthlyStarted ? "Active" : "Not started", monthlyStarted)}>{monthlyStarted ? "Active" : "Not started"}</span>
            )}
            <a href="/admin/balances" style={{ font: `700 12px ${F_SANS}`, color: "var(--link,#0a66c2)", textDecoration: "none" }}>Pay, attach receipts &amp; full history in Payouts →</a>
          </PanelCard>

          {(r.adminNotes || r.applicationNotes) && (
            // Read-only onboarding summary. Adding/logging updates lives in the Activity card
            // (the shared outreach log) so there's one place to post an update, not three.
            <PanelCard title="Admin notes" tone="notes">
              {r.adminNotes && <OnboardingNotes text={r.adminNotes} live={{ has2fa: !!r.twoFactor, loginConfirmed: isLive(r) || r.status === "onboarded" }} />}
              {r.applicationNotes && <Note label="Application notes">{r.applicationNotes}</Note>}
            </PanelCard>
          )}
        </div>
      </div>

      {/* ── Footer: accept / onboarded state + delete ── */}
      {!live || accountDead ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, paddingTop: 14, marginTop: 16, borderTop: "1px solid var(--divider,#eee)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "flex-start" }}>
            {r.status !== "rejected" && r.status !== "unreachable" && (
              <select value="" disabled={busy || rejectReason !== null} onChange={(e) => { const v = e.target.value; if (!v) return; if (v === "rejected") setRejectReason(""); else void workflow(r.id, { status: v }); }} title="Stop / close this application (Withdrawn lives in the Status toggle above)" style={{ font: `700 12px ${F_SANS}`, color: "var(--danger,#c0392b)", background: "var(--card,#fff)", border: "1px solid var(--danger-border,#e6b4ad)", borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>
                <option value="">Close application…</option>
                <option value="unreachable">Unresponsive — no reply</option>
                <option value="rejected">Rejected — with reason…</option>
              </select>
            )}
            {rejectReason !== null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 260 }}>
                <textarea autoFocus value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={2} maxLength={1000} placeholder="Why are you rejecting? (kept on record, e.g. tried to switch referrer verah-77 → aiza)" style={{ font: `500 12px ${F_SANS}`, color: "var(--fg,#111)", background: "var(--card,#fff)", border: "1px solid var(--danger-border,#e6b4ad)", borderRadius: 8, padding: "8px 10px", resize: "vertical", width: "100%", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 6 }}>
                  <button disabled={busy || !rejectReason.trim()} onClick={async () => { const reason = rejectReason.trim(); await workflow(r.id, { status: "rejected", addTouch: { ch: "note", text: `Rejected — ${reason}` } }); setRejectReason(null); }} style={{ font: `700 12px ${F_SANS}`, color: "#fff", background: "var(--danger,#c0392b)", border: "none", borderRadius: 8, padding: "7px 12px", cursor: rejectReason.trim() ? "pointer" : "default", opacity: busy || !rejectReason.trim() ? 0.5 : 1 }}>Reject &amp; record reason</button>
                  <button disabled={busy} onClick={() => setRejectReason(null)} style={{ font: `700 12px ${F_SANS}`, color: "var(--muted,#647189)", background: "transparent", border: "1px solid var(--line,#d6e4fb)", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted2,#9aa0a6)" }}>Accept &amp; advance from the Workflow steps above · reopen a closed one with Mark received</span>
        </div>
      ) : onboarded ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 14, marginTop: 16, borderTop: "1px solid var(--divider,#eee)" }}>
          <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted,#8a9099)" }}>Onboarding complete — warm-up and setup are done. Use the status dropdown to move them back into the pipeline.</span>
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button onClick={() => onDeleteApp(r)} disabled={busy} title="Permanently delete this application" style={{ font: `600 11px ${F_SANS}`, color: "var(--danger,#c0392b)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>Delete application</button>
      </div>
    </div>
  );
}

// Re-exports the new page also uses for the collapsed row.
export { initialsOf, stageOf, isBlocked, levelKey, healthOf, STATUS_STYLE, STAGE_ACCENT, HEALTH_OPTIONS, applicationType, fmtDate, ageDays, liHref, nextStep, formatName, isLikelyTestEmail };
export type { Status as PipelineStatus, Health as PipelineHealth };
