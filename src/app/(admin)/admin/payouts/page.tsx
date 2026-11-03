"use client";

// Unified Payouts console — rebuilt to match the "Payouts v2" design (high fidelity:
// literal hex, Plus Jakarta Sans + Space Grotesk, exact sizes/spacing/radii). Two tabs:
// "This pay run" (owed + paid-this-cycle, grouped by fee kind, with the Wise send flow)
// and "All payees" (every payee + merged payment record). Data from
// /api/admin/payouts/unified. Wise send lights up when WISE_API_TOKEN_FULL is set
// (wiseEnabled) and the prepare/send routes are deployed.

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { PAUSE_REASONS, REASON_LABEL, reasonLabel, reasonIsRestricted, ownerPauseEmail, type PauseReason } from "@/lib/payout-pause";

// Fonts: next/font exposes Plus Jakarta Sans as --font-sans and Space Grotesk as
// --font-grotesk on the admin subtree; the literal names are fallbacks.
const SANS = "var(--font-sans),'Plus Jakarta Sans',system-ui,sans-serif";
const GRO = "var(--font-grotesk),'Space Grotesk',system-ui,sans-serif";

const C = {
  pageBg: "#eef0f4", card: "#fff", ink: "#0b1220", ink2: "#3b4657", muted: "#5b6779", faint: "#8a93a3",
  border: "#e3e6ec", inputBorder: "#dde1e8", divider: "#eef0f4", band: "#fafbfc", groupBand: "#f6f7f9",
  inset: "#f8f9fb", countPill: "#eef0f4", countPillGroup: "#e9ecf1", link: "#2563eb", selOutline: "#2563eb",
};
type PillTone = "green" | "blue" | "amber" | "orange" | "red" | "neutral";
const PILLS: Record<PillTone, { bg: string; fg: string; dot: string }> = {
  green: { bg: "#e7f7ee", fg: "#0f7a3d", dot: "#12a150" },
  blue: { bg: "#eef3fe", fg: "#1d4ed8", dot: "#2563eb" },
  amber: { bg: "#fffbeb", fg: "#92400e", dot: "#d97706" },
  orange: { bg: "#fff7ed", fg: "#c2410c", dot: "#ea580c" },
  red: { bg: "#fef2f2", fg: "#b91c1c", dot: "#dc2626" },
  neutral: { bg: "#f1f3f6", fg: "#5b6779", dot: "#8a93a3" },
};
const GROUP_DOT: Record<Kind, string> = { referral: "#7c3aed", monthly: "#12a150", setup: "#2563eb" };

type Kind = "referral" | "setup" | "monthly";
type State = "ready" | "upcoming" | "hold" | "needs_details" | "manual" | "paid";

interface UnreadMail { from: string; subject: string; when: string }
interface Flags { linkedinUrl: string | null; unreadMail: UnreadMail[]; recoveredAt: string | null; recoveryNote: string | null; checkedAt: string | null; flagged: boolean; }
interface Pause { reason: string; pausedAt: string; note: string; emailed: string[]; }
interface Row {
  id: string; kind: Kind; payeeKey: string; payeeName: string; payeeSub: string | null;
  referredBy: string | null; description: string; amount: number; currency: "PHP" | "USD";
  method: string | null; rail: "wallet" | "bank" | null; dueDate: string; overdue: boolean;
  state: State; holdReason: string | null; masked: string | null;
  receipt: string | null; paidAt: string | null; confirmed: boolean; sentViaWise: boolean;
  paused: Pause | null; flagged: boolean;
}
interface Payment { date: string | null; amount: number; kind: Kind; label: string; by: string | null; receipt: string | null; notified: boolean; acknowledged: boolean; }
interface Payee {
  key: string; name: string; sub: string | null; kinds: Kind[]; referredBy: string | null;
  method: string | null; masked: string | null; rail: "wallet" | "bank" | null;
  email: string | null; phone: string | null; holder: string | null; accounts: number; linkedinUrls: string[]; nextDue: string | null; note: string | null;
  totalPaid: number; lastPaidAt: string | null; history: Payment[]; flags: Flags | null; pause: Pause | null;
}
interface Feed { ready: Row[]; payees: Payee[]; wiseEnabled: boolean; }
interface PayoutActions { markChecked: (payeeKey: string) => void; pause: (p: PausePayload) => void; resume: (payeeKey: string) => void; }

const money = (n: number, c: "PHP" | "USD" = "PHP") =>
  c === "USD" ? `$${(n || 0).toLocaleString()}` : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const KIND_LABEL: Record<Kind, string> = { referral: "Referral", setup: "Setup", monthly: "Monthly" };
// LinkedIn URL shown without the https://www. prefix, e.g. linkedin.com/in/jane-doe.
const linkedinLabel = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\?.*$/, "").replace(/\/$/, "");
// Short date, no year — "Oct 29" (Manila), for the flag pills / check block.
const fmtShort = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" }) : "";
const first = (name: string | null | undefined) => (name || "there").trim().split(/\s+/)[0] || "there";
const KIND_EMAIL: Record<Kind, string> = { monthly: "monthly", setup: "setup fee", referral: "referral" };

// ── shared atoms ────────────────────────────────────────────────────────
function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  const p = PILLS[tone];
  return <span style={{ display: "inline-flex", alignItems: "center", font: `700 11.5px ${SANS}`, padding: "3px 10px", borderRadius: 999, background: p.bg, color: p.fg, whiteSpace: "nowrap" }}>{children}</span>;
}
// Row flag pills, under the payee sub-line: unread account mail + a recent recovery.
function FlagPills({ flags }: { flags: Flags }) {
  const n = flags.unreadMail.length;
  if (!flags.flagged) return null;
  const pill = (bg: string, fg: string): CSSProperties => ({ font: `700 11px ${SANS}`, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap", background: bg, color: fg });
  return (
    <div style={{ paddingLeft: 18, marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
      {n > 0 && <span style={pill("#eef3fe", "#1d4ed8")}>✉ {n} new email{n === 1 ? "" : "s"}</span>}
      {flags.recoveredAt && <span style={pill("#fff7ed", "#c2410c")}>↻ Recovered {fmtShort(flags.recoveredAt)}</span>}
    </div>
  );
}

// "Check before paying" block — first thing in an expanded panel when the payee is flagged.
// Lists the unread account inbox mail + a recovery note, each with a jump-out link, and a
// "Mark as checked" button. Once checked (and nothing newer), collapses to a one-line stamp.
function CheckBlock({ flags, onMarkChecked }: { flags: Flags; onMarkChecked: () => void }) {
  if (!flags.flagged) {
    if (!flags.checkedAt) return null;
    return (
      <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.divider}`, font: `600 12px ${SANS}`, color: "#0f7a3d" }}>
        ✓ Checked {fmtShort(flags.checkedAt)} · inbox and GoLogin reviewed
      </div>
    );
  }
  const n = flags.unreadMail.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${C.divider}`, background: "#f8faff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ flex: 1, font: `700 10.5px ${SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#1d4ed8" }}>Check before paying</span>
        <button onClick={onMarkChecked} style={{ border: `1px solid ${C.inputBorder}`, background: C.card, color: C.ink, borderRadius: 8, padding: "6px 11px", font: `600 12px ${SANS}`, cursor: "pointer" }}>✓ Mark as checked</button>
      </div>
      {n > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ flex: 1, font: `700 13px ${SANS}`, color: C.ink }}>✉ {n} new email{n === 1 ? "" : "s"} in the account inbox</span>
            <a href="/admin/inventory-v2" target="_blank" rel="noopener noreferrer" style={{ font: `700 12px ${SANS}`, color: C.link }}>Open in Inventory →</a>
          </div>
          <div style={{ border: "1px solid #dfe6f5", borderRadius: 10, overflow: "hidden", background: C.card }}>
            {flags.unreadMail.map((m, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "150px minmax(0,1fr) 90px", gap: 12, alignItems: "center", padding: "8px 12px", borderTop: i ? `1px solid ${C.divider}` : "none", font: `500 12.5px ${SANS}`, color: C.ink2 }}>
                <span style={{ fontWeight: 700, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.from}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subject}</span>
                <span style={{ textAlign: "right", color: C.faint }}>{fmtShort(m.when)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {flags.recoveredAt && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px", borderRadius: 10, background: "#fff7ed", border: "1px solid #fed7aa" }}>
          <span style={{ flex: 1, font: `500 12.5px/1.5 ${SANS}`, color: "#9a3412" }}>
            <b>↻ Recovered {fmtShort(flags.recoveredAt)}.</b> {flags.recoveryNote ? `${flags.recoveryNote} ` : ""}Check the GoLogin profile opens and is still logged in before paying.
          </span>
          <a href="https://app.gologin.com/" target="_blank" rel="noopener noreferrer" style={{ font: `700 12px ${SANS}`, color: "#c2410c", whiteSpace: "nowrap" }}>Open GoLogin →</a>
        </div>
      )}
    </div>
  );
}
// Context the Pause form needs to compose the owner email + know who can be notified.
interface PauseCtx { payeeKey: string; ownerFirst: string; ownerEmail: string | null; referrerFirst: string | null; kind: string; amt: string; dest: string; }
interface PausePayload { payeeKey: string; reason: PauseReason; notifyOwner: boolean; notifyReferrer: boolean; ownerEmailBody: string | null; }

function emailedLine(emailed: string[]): string {
  const who = emailed.filter((e) => e === "owner" || e === "referrer").map((e) => e === "owner" ? "owner" : "referrer");
  if (who.length === 0) return "";
  return ` Emailed ${who.join(" and ")}.`;
}

// Pause / resume a payout, with an optional templated email to the owner (editable) and a
// heads-up to the referrer. Idle strip → form → paused strip. Form state is local to the row.
function PausePanel({ ctx, paused, onPause, onResume }: { ctx: PauseCtx; paused: Pause | null; onPause: (p: PausePayload) => void; onResume: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<PauseReason | "">("");
  const [notifyOwner, setNotifyOwner] = useState(true);
  const [notifyReferrer, setNotifyReferrer] = useState(false);
  const [body, setBody] = useState<string | null>(null); // null = use the reason's template

  // State C — already paused.
  if (paused) {
    const red = reasonIsRestricted(paused.reason);
    const bg = red ? "#fef2f2" : "#fff7ed", fg = red ? "#7f1d1d" : "#9a3412";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${C.divider}`, background: bg, flexWrap: "wrap" }}>
        <span style={{ flex: 1, minWidth: 220, font: `500 12.5px/1.45 ${SANS}`, color: fg }}>
          <b>Paused · {reasonLabel(paused.reason)}</b> since {fmtDate(paused.pausedAt)}. {paused.note}{emailedLine(paused.emailed)}
        </span>
        <button onClick={onResume} style={secBtn}>Resume payout</button>
      </div>
    );
  }

  // State A — idle.
  if (!open) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${C.divider}`, flexWrap: "wrap" }}>
        <span style={{ flex: 1, minWidth: 220, font: `500 12.5px ${SANS}`, color: C.muted }}>Restricted, can&apos;t log in, or account inaccessible? Pause the payout so it isn&apos;t sent.</span>
        <button onClick={() => setOpen(true)} style={{ background: "#fffbeb", border: "1px solid #f0c36d", color: "#92400e", borderRadius: 8, padding: "6px 12px", font: `700 12px ${SANS}`, cursor: "pointer" }}>Pause payout</button>
      </div>
    );
  }

  // State B — the form.
  const template = reason ? ownerPauseEmail(reason, { first: ctx.ownerFirst, kind: ctx.kind, amt: ctx.amt, dest: ctx.dest }) : null;
  const bodyVal = body ?? template?.body ?? "";
  const pickReason = (r: PauseReason) => { setReason(r); setBody(null); };
  const confirmLabel = !notifyOwner && !notifyReferrer ? "Pause payout"
    : notifyOwner && notifyReferrer ? "Pause & email owner + referrer"
    : notifyOwner ? "Pause & email owner" : "Pause & email referrer";
  const canConfirm = !!reason;
  const submit = () => { if (!reason) return; onPause({ payeeKey: ctx.payeeKey, reason, notifyOwner: notifyOwner && !!ctx.ownerEmail, notifyReferrer: notifyReferrer && !!ctx.referrerFirst, ownerEmailBody: notifyOwner ? bodyVal : null }); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${C.divider}`, background: "#fffbeb" }}>
      <span style={{ font: `700 13px ${SANS}`, color: "#92400e" }}>What&apos;s wrong?</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {PAUSE_REASONS.map((r) => {
          const on = reason === r;
          return <button key={r} onClick={() => pickReason(r)} style={{ background: C.card, border: `1.5px solid ${on ? "#92400e" : C.border}`, color: on ? "#92400e" : C.ink2, borderRadius: 999, padding: "5px 12px", font: `700 12.5px ${SANS}`, cursor: "pointer" }}>{REASON_LABEL[r]}</button>;
        })}
      </div>

      {reason && (
        <>
          <span style={{ font: `700 10.5px ${SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#92400e" }}>Let them know</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <ToggleChip on={notifyOwner} onClick={() => setNotifyOwner((v) => !v)} label="Email owner" sub={ctx.ownerEmail || ""} />
            {ctx.referrerFirst && <ToggleChip on={notifyReferrer} onClick={() => setNotifyReferrer((v) => !v)} label="Email referrer" sub={ctx.referrerFirst} />}
          </div>

          {notifyOwner && ctx.ownerEmail && template && (
            <div style={{ background: C.card, border: "1px solid #f0dca8", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #f5ebcf", font: `600 12.5px ${SANS}`, color: C.ink }}>
                <span style={{ color: C.faint }}>Subject</span> {template.subject}
              </div>
              <textarea value={bodyVal} onChange={(e) => setBody(e.target.value)} rows={6} style={{ width: "100%", boxSizing: "border-box", border: "none", outline: "none", resize: "vertical", padding: "10px 12px", font: `500 13px/1.55 ${SANS}`, color: C.ink }} />
            </div>
          )}
          {notifyReferrer && ctx.referrerFirst && (
            <span style={{ font: `500 12px ${SANS}`, color: "#92400e" }}>{ctx.referrerFirst} gets a short heads-up: “Heads up: {ctx.ownerFirst}&apos;s payout is on hold”</span>
          )}
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ flex: 1, minWidth: 200, font: `500 12px ${SANS}`, color: "#92400e" }}>Nothing is sent while paused. It shows as On hold or Restricted in All payees until you resume it.</span>
        <button onClick={() => { setOpen(false); setReason(""); setBody(null); }} style={secBtn}>Cancel</button>
        <button onClick={submit} disabled={!canConfirm} style={{ background: canConfirm ? "#92400e" : "#d6c9a8", color: "#fff", border: "none", borderRadius: 8, padding: "7px 13px", font: `700 12px ${SANS}`, cursor: canConfirm ? "pointer" : "not-allowed" }}>{confirmLabel}</button>
      </div>
    </div>
  );
}
function ToggleChip({ on, onClick, label, sub }: { on: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.card, border: `1.5px solid ${on ? "#92400e" : C.border}`, borderRadius: 999, padding: "5px 12px 5px 8px", font: `700 12.5px ${SANS}`, color: C.ink, cursor: "pointer" }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${on ? "#92400e" : C.border}`, background: on ? "#92400e" : C.card, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "700 10px sans-serif" }}>{on ? "✓" : ""}</span>
      {label}{sub && <span style={{ font: `500 12px ${SANS}`, color: C.muted }}>{sub}</span>}
    </button>
  );
}
const secBtn: CSSProperties = { border: `1px solid #dde1e8`, background: "#fff", color: "#0b1220", borderRadius: 8, padding: "6px 12px", font: `700 12px ${SANS}`, cursor: "pointer" };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ font: `700 10.5px ${SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: C.faint }}>{label}</span>
      <span style={{ font: `600 13.5px ${GRO}`, color: C.ink, overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
    </div>
  );
}

// ── payment record (both tabs) ──────────────────────────────────────────
function PaymentRecord({ history, total }: { history: Payment[]; total: number }) {
  const copy = () => {
    const tsv = history.map((h) => [fmtDate(h.date), money(h.amount), h.label, h.acknowledged ? "Acked" : "Awaiting"].join("\t")).join("\n");
    navigator.clipboard?.writeText(tsv);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ font: `700 10.5px ${SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: C.faint, flex: 1 }}>Payment record</span>
        <span style={{ font: `500 12.5px ${SANS}`, color: C.muted }}>Total paid <b style={{ fontFamily: "var(--font-grotesk)", color: "#0f7a3d" }}>{money(total)}</b></span>
        <button onClick={copy} style={{ border: `1px solid ${C.inputBorder}`, background: C.card, color: C.ink, borderRadius: 8, padding: "6px 11px", font: `600 12px ${SANS}`, cursor: "pointer" }}>Copy history</button>
      </div>
      <div style={{ border: `1px solid ${C.divider}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr) 110px 110px 150px", gap: 12, padding: "8px 12px", background: C.band, font: `700 10.5px ${SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: C.faint }}>
          <span>Date</span><span>Payment</span><span>Proof</span><span>Notified</span><span>Acknowledged</span>
        </div>
        {history.length === 0 && <div style={{ padding: "14px 12px", font: `500 12.5px ${SANS}`, color: C.faint }}>No payments yet.</div>}
        {history.map((h, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr) 110px 110px 150px", gap: 12, alignItems: "center", padding: "10px 12px", borderTop: `1px solid ${C.divider}` }}>
            <span style={{ font: `600 13px ${SANS}`, color: C.ink }}>{fmtDate(h.date)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: `500 13px ${SANS}`, color: C.muted }}><b style={{ fontFamily: "var(--font-grotesk)", color: C.ink }}>{money(h.amount)}</b> · {h.label}</div>
              {h.by && <div style={{ font: `500 11.5px ${SANS}`, color: C.faint }}>by {h.by}</div>}
            </div>
            {h.receipt ? <a href={h.receipt} target="_blank" rel="noreferrer"><Pill tone="blue">↗ Receipt</Pill></a> : <span style={{ color: "#c0c4cc" }}>—</span>}
            {h.notified ? <Pill tone="blue">Notified</Pill> : <Pill tone="neutral">Not notified</Pill>}
            {h.acknowledged ? <Pill tone="green">Acked</Pill> : <Pill tone="neutral">Awaiting ack</Pill>}
          </div>
        ))}
      </div>
      <span style={{ font: `500 12px ${SANS}`, color: C.faint }}>Sending through Wise attaches the receipt and emails the payee automatically.</span>
    </div>
  );
}

// info grid shared by both tabs' expanded panels
function InfoGrid({ p, amount, nextDue }: { p: Payee | undefined; amount?: number; nextDue?: boolean }) {
  if (!p) return null;
  const last = p.history.find((h) => h.date);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: "14px 24px", padding: 14 }}>
      <Field label="Owner (ambassador)">{p.name}</Field>
      <Field label="LinkedIn">
        {p.linkedinUrls[0]
          ? <a href={p.linkedinUrls[0]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ font: `600 13.5px ${SANS}`, color: C.link, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{linkedinLabel(p.linkedinUrls[0])} ↗</a>
          : "—"}
      </Field>
      <Field label="Referred by">{p.referredBy || "—"}</Field>
      <Field label="Payment method">{[p.method, p.masked, p.holder].filter(Boolean).join(" · ") || "—"}</Field>
      <Field label={amount != null ? "This payout" : "Payout"}>{amount != null ? money(amount) : (p.kinds.includes("monthly") ? "monthly" : "—")}</Field>
      {nextDue && <Field label="Next payment due">{fmtDate(p.nextDue)}</Field>}
      <Field label="Accounts">{p.accounts > 0 ? String(p.accounts) : "—"}</Field>
      <Field label="Last payment">{last ? `${money(last.amount)} · ${fmtDate(last.date)}` : "—"}</Field>
      <Field label="Total paid">{money(p.totalPaid)}</Field>
      <Field label="Contact email">{p.email || "—"}</Field>
      <Field label="Contact number">{p.phone || "—"}</Field>
    </div>
  );
}

// Wise connectivity indicator — confirms the full-access token authenticates.
function WiseBadge() {
  const [s, setS] = useState<{ connected: boolean; name?: string | null; isBusiness?: boolean; reason?: string; message?: string } | null>(null);
  useEffect(() => {
    let a = true;
    fetch("/api/admin/payouts/wise/status").then((r) => r.json()).then((d) => { if (a) setS(d); }).catch(() => { if (a) setS({ connected: false, reason: "error" }); });
    return () => { a = false; };
  }, []);
  if (!s) return null;
  const p = !s.connected ? PILLS.neutral : s.isBusiness ? PILLS.green : PILLS.amber;
  const label = !s.connected
    ? `Wise not connected${s.reason === "no_token" ? " · add token" : s.reason ? ` · ${s.reason}` : ""}`
    : s.isBusiness
      ? `Wise connected · ${s.name}`
      : `Wise: ${s.name || "personal"} — not the business profile`;
  return (
    <span title={s.message || undefined} style={{ display: "inline-flex", alignItems: "center", gap: 7, font: `600 12px ${SANS}`, color: p.fg, background: p.bg, borderRadius: 999, padding: "5px 11px", whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.dot }} />{label}
    </span>
  );
}

// ── page ────────────────────────────────────────────────────────────────
export default function PayoutsPage() {
  const [data, setData] = useState<Feed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"run" | "all">("run");

  const load = useCallback(() => fetch("/api/admin/payouts/unified")
    .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then((d) => setData(d))
    .catch((e) => setErr(e.message || "Failed to load")), []);
  useEffect(() => { load(); }, [load]);

  // Console actions — POST then reload so row state (hold/flags) reflects the server truth.
  const actions: PayoutActions = useMemo(() => {
    const post = (path: string, body: object) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(() => load()).catch(() => {});
    return {
      markChecked: (payeeKey) => void post("/api/admin/payouts/mark-checked", { payeeKey }),
      pause: (p) => void post("/api/admin/payouts/pause", p),
      resume: (payeeKey) => void post("/api/admin/payouts/resume", { payeeKey }),
    };
  }, [load]);

  const payeeByKey = useMemo(() => new Map((data?.payees || []).map((p) => [p.key, p])), [data]);
  const runCount = (data?.ready || []).filter((r) => r.state !== "upcoming").length;
  const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const tabBtn = (k: "run" | "all", label: string, n: number | undefined) => {
    const active = tab === k;
    return (
      <button key={k} onClick={() => setTab(k)} style={{ border: "none", cursor: "pointer", borderRadius: 999, padding: "7px 16px", font: `700 13px ${SANS}`, display: "flex", alignItems: "center", gap: 7, background: active ? C.card : "transparent", color: active ? C.ink : C.muted }}>
        {label}{n != null && <span style={{ font: `700 11px ${GRO}`, color: C.muted, background: active ? C.countPill : "#d5dbe5", borderRadius: 999, padding: "1px 7px" }}>{n}</span>}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 0 80px", maxWidth: 1320, margin: "0 auto", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 700 }}>
          <h1 style={{ font: `700 30px ${GRO}`, color: C.ink, margin: "0 0 4px", letterSpacing: "-.01em" }}>Payouts</h1>
          <p style={{ font: `500 14px/1.5 ${SANS}`, color: C.muted, margin: 0 }}>Send ambassador payouts from the Wise PHP balance. A quote moves no money; nothing is sent until you click <b style={{ color: C.ink }}>Approve &amp; send</b>.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button style={navBtn}>‹</button>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 130 }}>
            <span style={{ font: `700 15px ${GRO}`, color: C.ink }}>{monthLabel}</span>
            <span style={{ font: `500 11.5px ${SANS}`, color: C.faint }}>Pay run · {today}</span>
          </div>
          <button style={navBtn}>›</button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, background: "#e3e6ec", borderRadius: 999, padding: 3 }}>
          {tabBtn("run", "This pay run", runCount)}
          {tabBtn("all", "All payees", data?.payees.length)}
        </div>
        <WiseBadge />
      </div>

      {err && <div style={{ padding: 16, borderRadius: 12, background: PILLS.red.bg, color: PILLS.red.fg, font: `600 13px ${SANS}` }}>Couldn’t load payouts: {err}</div>}
      {!data && !err && <div style={{ padding: 40, textAlign: "center", color: C.faint, font: `500 14px ${SANS}` }}>Loading…</div>}

      {data && tab === "run" && <PayRun rows={data.ready} wiseEnabled={data.wiseEnabled} payeeByKey={payeeByKey} actions={actions} />}
      {data && tab === "all" && <AllPayees payees={data.payees} ready={data.ready} actions={actions} />}
    </div>
  );
}

const navBtn: CSSProperties = { border: `1px solid ${C.inputBorder}`, background: C.card, color: C.ink, borderRadius: 10, width: 34, height: 34, font: `600 14px ${SANS}`, cursor: "pointer" };
const searchInput: CSSProperties = { flex: 1, minWidth: 220, border: `1px solid ${C.inputBorder}`, background: C.inset, borderRadius: 10, padding: "9px 12px", font: `500 13.5px ${SANS}`, color: C.ink, outline: "none" };
const cardBox: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 };

function StatCards({ cards, active, onPick }: { cards: { k: string; label: string; dot: string; fg: string; value: string; hint: string }[]; active: string | null; onPick: (k: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
      {cards.map((c) => {
        const on = active === c.k;
        return (
          <button key={c.k} onClick={() => onPick(c.k)} style={{ textAlign: "left", cursor: "pointer", background: on ? C.card : C.inset, borderRadius: 14, padding: "12px 14px", border: `2px solid ${on ? C.selOutline : "transparent"}`, display: "flex", flexDirection: "column", gap: 3, transition: "transform .12s" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7, font: `700 11px ${SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: c.fg }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot }} />{c.label}
            </span>
            <span style={{ font: `700 26px ${GRO}`, color: C.ink }}>{c.value}</span>
            <span style={{ font: `600 12px/1.4 ${SANS}`, color: C.muted }}>{c.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Tab A: This pay run ─────────────────────────────────────────────────
type RunCard = "owed" | "flag" | "ready" | "sent" | "failed" | "cant";
function PayRun({ rows, wiseEnabled, payeeByKey, actions }: { rows: Row[]; wiseEnabled: boolean; payeeByKey: Map<string, Payee>; actions: PayoutActions }) {
  const [q, setQ] = useState("");
  const [card, setCard] = useState<RunCard | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [groupOpen, setGroupOpen] = useState<Record<Kind, boolean>>({ referral: true, monthly: true, setup: true });

  const run = useMemo(() => rows.filter((r) => r.state !== "upcoming"), [rows]);
  const inCard = (r: Row, c: RunCard) => {
    if (c === "owed") return ["ready", "manual", "needs_details"].includes(r.state); // held payouts aren't owed this cycle — they're under Can't send
    if (c === "flag") return r.flagged && !["paid", "hold", "needs_details", "manual"].includes(r.state); // flagged, excl. sent + can't-send
    if (c === "ready") return r.state === "ready";
    if (c === "sent") return r.state === "paid" && r.sentViaWise;
    if (c === "failed") return false;
    if (c === "cant") return ["needs_details", "manual", "hold"].includes(r.state);
    return true;
  };
  const stats = useMemo(() => {
    const sum = (f: (r: Row) => boolean) => run.filter(f).reduce((s, r) => s + r.amount, 0);
    const cnt = (f: (r: Row) => boolean) => run.filter(f).length;
    return {
      owed: { t: sum((r) => inCard(r, "owed")), n: cnt((r) => inCard(r, "owed")) },
      flag: { n: cnt((r) => inCard(r, "flag")) },
      ready: { t: sum((r) => inCard(r, "ready")), n: cnt((r) => inCard(r, "ready")) },
      sent: { t: sum((r) => inCard(r, "sent")), n: cnt((r) => inCard(r, "sent")) },
      cant: { n: cnt((r) => inCard(r, "cant")), miss: cnt((r) => r.state === "needs_details"), man: cnt((r) => r.state === "manual"), hold: cnt((r) => r.state === "hold") },
    };
  }, [run]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return run.filter((r) => {
      if (card) { if (!inCard(r, card)) return false; }
      // Default view hides the can't-send rows (on hold / no details / not on Wise) —
      // they live under the "Can't send" card instead of cluttering the pay run.
      else if (["hold", "needs_details", "manual"].includes(r.state)) return false;
      if (!needle) return true;
      return [r.payeeName, r.payeeSub, r.description, r.method, r.referredBy].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [run, q, card]);

  const groups = (["referral", "monthly", "setup"] as Kind[]).map((k) => {
    const gr = filtered.filter((r) => r.kind === k);
    return { k, rows: gr, total: gr.reduce((s, r) => s + r.amount, 0), sent: gr.filter((r) => r.state === "paid").length, ready: gr.filter((r) => r.state === "ready").length };
  }).filter((g) => g.rows.length > 0);

  const selRows = filtered.filter((r) => r.state === "ready" && sel.has(r.id));
  const selTotal = selRows.reduce((s, r) => s + r.amount, 0);
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleOpen = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const cards = [
    { k: "owed", label: "Owed this cycle", dot: "#2563eb", fg: "#1d4ed8", value: money(stats.owed.t), hint: `${stats.owed.n} payout${stats.owed.n === 1 ? "" : "s"}` },
    { k: "flag", label: "Check first", dot: "#7c3aed", fg: "#6d28d9", value: String(stats.flag.n), hint: "new emails or recently recovered" },
    { k: "ready", label: "Ready to send", dot: "#ca8a04", fg: "#a16207", value: money(stats.ready.t), hint: `${stats.ready.n} payout${stats.ready.n === 1 ? "" : "s"}` },
    { k: "sent", label: "Sent via Wise", dot: "#12a150", fg: "#0f7a3d", value: money(stats.sent.t), hint: `${stats.sent.n} sent · receipts emailed` },
    { k: "failed", label: "Failed", dot: "#dc2626", fg: "#b91c1c", value: money(0), hint: "0 to retry" },
    { k: "cant", label: "Can’t send", dot: "#ea580c", fg: "#c2410c", value: String(stats.cant.n), hint: `${stats.cant.miss} missing details · ${stats.cant.man} manual · ${stats.cant.hold} on hold` },
  ];

  const colTemplate = "28px minmax(0,1.1fr) minmax(0,1.4fr) 100px 150px 270px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StatCards cards={cards} active={card} onPick={(k) => setCard((cur) => cur === k ? null : k as RunCard)} />

      <div style={{ ...cardBox, padding: "12px 14px", display: "flex" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, slug or method…" style={searchInput} />
      </div>

      <div style={{ position: "sticky", top: 10, zIndex: 5, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", borderRadius: 12, padding: "10px 12px 10px 16px", background: selRows.length ? C.ink : C.card, border: `1px solid ${selRows.length ? C.ink : C.border}` }}>
        <span style={{ flex: "1 1 300px", font: selRows.length ? `700 13.5px ${SANS}` : `500 12.5px ${SANS}`, color: selRows.length ? "#fff" : C.muted }}>
          {selRows.length ? <>{selRows.length} selected · {money(selTotal)}<button onClick={() => setSel(new Set())} style={{ border: "none", background: "none", marginLeft: 12, font: `600 12px ${SANS}`, color: "#a7b0bf", cursor: "pointer" }}>Clear</button></> : "Tick payouts to send several at once, or send them one at a time from each row."}
        </span>
        <button disabled={!selRows.length || !wiseEnabled} title={!wiseEnabled ? "Wise sending switches on once the full-access token is added" : undefined}
          style={{ border: "none", borderRadius: 10, padding: "8px 14px", font: `700 12.5px ${SANS}`, whiteSpace: "nowrap", cursor: selRows.length && wiseEnabled ? "pointer" : "not-allowed", background: selRows.length && wiseEnabled ? "#12a150" : C.countPill, color: selRows.length && wiseEnabled ? "#fff" : C.faint }}>
          {selRows.length ? `Review & send ${selRows.length} (${money(selTotal)})` : "Review & send"}
        </button>
      </div>

      <div style={{ ...cardBox, overflow: "auto" }}>
        <div style={{ minWidth: 1040 }}>
          <div style={{ display: "grid", gridTemplateColumns: colTemplate, gap: 12, alignItems: "center", padding: "10px 16px", background: C.band, borderBottom: `1px solid ${C.divider}`, font: `700 10.5px ${SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: C.faint }}>
            <span /><span>Ambassador</span><span>For</span><span style={{ textAlign: "right" }}>Amount</span><span>Destination</span><span>Wise</span>
          </div>
          {groups.map((g) => {
            const gOpen = groupOpen[g.k];
            return (
              <div key={g.k}>
                <div onClick={() => setGroupOpen((s) => ({ ...s, [g.k]: !s[g.k] }))} style={{ display: "flex", alignItems: "center", gap: 10, background: C.groupBand, borderBottom: `1px solid ${C.divider}`, padding: "9px 16px", cursor: "pointer" }}>
                  <span style={{ font: `700 12px ${SANS}`, color: C.faint, transform: gOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: GROUP_DOT[g.k] }} />
                  <span style={{ font: `700 13.5px ${SANS}`, color: C.ink }}>{KIND_LABEL[g.k]} fees</span>
                  <span style={{ font: `700 11.5px ${GRO}`, color: C.muted, background: C.countPillGroup, borderRadius: 999, padding: "1px 8px" }}>{g.rows.length}</span>
                  <span style={{ font: `500 12px ${SANS}`, color: C.faint }}>{g.sent} sent · {g.ready} ready</span>
                  <span style={{ marginLeft: "auto", font: `700 13.5px ${GRO}`, color: C.ink }}>{money(g.total)}</span>
                </div>
                {gOpen && g.rows.map((r) => (
                  <RunRow key={r.id} r={r} colTemplate={colTemplate} wiseEnabled={wiseEnabled} selected={sel.has(r.id)} onToggleSel={() => toggleSel(r.id)} expanded={open.has(r.id)} onToggleOpen={() => toggleOpen(r.id)} payee={payeeByKey.get(r.payeeKey)} actions={actions} />
                ))}
              </div>
            );
          })}
          {groups.length === 0 && <div style={{ padding: 44, textAlign: "center", font: `500 13.5px ${SANS}`, color: C.muted }}>No payouts match these filters.</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "12px 16px", background: C.band, borderTop: `1px solid ${C.divider}` }}>
          <span style={{ font: `500 12.5px ${SANS}`, color: C.muted }}>Setup {money(sumKind(run, "setup"))} · Monthly {money(sumKind(run, "monthly"))} · Referral {money(sumKind(run, "referral"))}</span>
          <span style={{ font: `700 14px ${GRO}`, color: C.ink }}>Sent {money(stats.sent.t)} of {money(stats.sent.t + stats.ready.t + stats.owed.t)}</span>
        </div>
      </div>
    </div>
  );
}
const sumKind = (rows: Row[], k: Kind) => rows.filter((r) => r.kind === k).reduce((s, r) => s + r.amount, 0);

function ctxForRow(r: Row, payee?: Payee): PauseCtx {
  return {
    payeeKey: r.payeeKey, ownerFirst: first(r.payeeName),
    ownerEmail: payee?.email || (r.payeeSub?.includes("@") ? r.payeeSub : null),
    referrerFirst: r.kind !== "referral" && r.referredBy ? first(r.referredBy) : null,
    kind: KIND_EMAIL[r.kind], amt: money(r.amount, r.currency),
    dest: [r.method, r.masked].filter(Boolean).join(" · ") || "your account",
  };
}
function RunRow({ r, colTemplate, wiseEnabled, selected, onToggleSel, expanded, onToggleOpen, payee, actions }: { r: Row; colTemplate: string; wiseEnabled: boolean; selected: boolean; onToggleSel: () => void; expanded: boolean; onToggleOpen: () => void; payee: Payee | undefined; actions: PayoutActions }) {
  const flags = payee?.flags || null;
  const canPause = ["ready", "needs_details", "manual", "hold"].includes(r.state);
  return (
    <div style={{ borderBottom: `1px solid ${C.divider}` }}>
      <div style={{ display: "grid", gridTemplateColumns: colTemplate, gap: 12, alignItems: "center", padding: "12px 16px" }}>
        <div>{r.state === "ready" && <Checkbox on={selected} onClick={onToggleSel} />}</div>
        <div onClick={onToggleOpen} style={{ minWidth: 0, cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, font: `700 13.5px ${SANS}`, color: C.ink, minWidth: 0 }}>
            <span style={{ font: `700 12px ${SANS}`, color: C.faint, transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.payeeName}</span>
          </div>
          <div style={{ paddingLeft: 18, font: `500 12px ${SANS}`, color: C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.payeeSub}</div>
          {flags && <FlagPills flags={flags} />}
        </div>
        <div title={r.description} style={{ font: `500 13px ${SANS}`, color: C.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description}</div>
        <div style={{ font: `700 15px ${GRO}`, color: C.ink, textAlign: "right" }}>{money(r.amount, r.currency)}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: `600 13px ${SANS}`, color: C.ink }}>{r.method || "—"}</div>
          <div style={{ font: `500 12px ${GRO}`, color: C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.masked || ""}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0, overflow: "hidden" }}><WiseCell r={r} wiseEnabled={wiseEnabled} onResume={() => actions.resume(r.payeeKey)} /></div>
      </div>
      {expanded && (
        <div style={{ margin: "0 16px 16px 56px", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", background: C.card }}>
          {flags && <CheckBlock flags={flags} onMarkChecked={() => actions.markChecked(r.payeeKey)} />}
          {canPause && <PausePanel ctx={ctxForRow(r, payee)} paused={r.paused} onPause={actions.pause} onResume={() => actions.resume(r.payeeKey)} />}
          <InfoGrid p={payee} amount={r.amount} />
          <div style={{ borderTop: `1px solid ${C.divider}`, padding: "12px 14px" }}>
            <PaymentRecord history={payee?.history || []} total={payee?.totalPaid || 0} />
          </div>
        </div>
      )}
    </div>
  );
}

interface Quote { id: string; sourceAmount: number | null; targetAmount: number | null; fee: number | null; targetCurrency: string; expirationTime: string | null; }
// Prepare-then-tap Wise send for one row: click Send → real Wise quote (prices it, moves no
// money) → review with a live quote timer → "Pay in Wise" to finish the payout in Wise.
function WiseSend({ r }: { r: Row }) {
  const [st, setSt] = useState<"idle" | "preparing" | "prepared" | "error">("idle");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [payUrl, setPayUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (st !== "prepared") return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [st]);

  const prepare = async () => {
    setSt("preparing"); setErr(null);
    try {
      const res = await fetch("/api/admin/payouts/wise/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: r.amount, currency: r.currency }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't prepare");
      setQuote(d.quote); setPayUrl(d.payUrl || "https://wise.com/send"); setNow(Date.now()); setSt("prepared");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't prepare"); setSt("error"); }
  };

  const btn = (bg: string, fg: string): CSSProperties => ({ border: "none", borderRadius: 8, padding: "7px 12px", font: `700 12.5px ${SANS}`, whiteSpace: "nowrap", cursor: "pointer", background: bg, color: fg });
  if (st === "idle") return <button onClick={prepare} style={btn(C.ink, "#fff")}>Send {money(r.amount, r.currency)} via Wise</button>;
  if (st === "preparing") return <span style={{ font: `600 12px ${SANS}`, color: C.muted }}>Preparing quote…</span>;
  if (st === "error") return <><Pill tone="red">Couldn’t prepare</Pill><button onClick={prepare} style={{ ...btn(C.card, C.link), border: `1px solid ${C.inputBorder}` }}>Retry</button>{err && <span title={err} style={{ font: `500 11.5px ${SANS}`, color: C.faint, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{err}</span>}</>;
  // prepared
  const secs = quote?.expirationTime ? Math.max(0, Math.floor((new Date(quote.expirationTime).getTime() - now) / 1000)) : null;
  const expired = secs !== null && secs <= 0;
  const mmss = secs !== null ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : "";
  return <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", minWidth: 0 }}>
    <span style={{ font: `500 11.5px ${SANS}`, color: C.muted, textAlign: "right" }}>
      Payee gets {money(quote?.targetAmount ?? r.amount, r.currency)}{quote?.fee != null ? ` · fee ${money(quote.fee, r.currency)}` : ""}{quote?.sourceAmount != null ? ` · ${money(quote.sourceAmount, r.currency)} leaves balance` : ""}
    </span>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {expired
        ? <><Pill tone="neutral">Quote expired</Pill><button onClick={prepare} style={{ ...btn(C.card, C.link), border: `1px solid ${C.inputBorder}` }}>Get new quote</button></>
        : <><span style={{ font: `600 11.5px ${SANS}`, color: C.faint }}>Quote valid {mmss}</span><a href={payUrl} target="_blank" rel="noopener noreferrer" style={btn("#12a150", "#fff")}>Pay in Wise →</a></>}
    </div>
  </div>;
}

function WiseCell({ r, wiseEnabled, onResume }: { r: Row; wiseEnabled: boolean; onResume: () => void }) {
  const link = { font: `700 12px ${SANS}`, color: C.link } as const;
  if (r.state === "ready") return <>
    {r.overdue && <Pill tone="red">Overdue</Pill>}
    {wiseEnabled
      ? <WiseSend r={r} />
      : <button disabled title="Wise sending switches on once the full-access token is added"
          style={{ border: "none", borderRadius: 8, padding: "7px 12px", font: `700 12.5px ${SANS}`, whiteSpace: "nowrap", cursor: "not-allowed", background: C.countPill, color: C.faint }}>
          Send {money(r.amount, r.currency)} via Wise
        </button>}
  </>;
  if (r.state === "paid") return <>
    <Pill tone="green">{r.confirmed ? "Paid" : "Sent"}</Pill>
    {r.receipt && <a href={r.receipt} target="_blank" rel="noreferrer" style={link}>Receipt ↗</a>}
    {r.confirmed ? <span style={{ font: `500 12px ${SANS}`, color: C.faint }}>payee confirmed</span> : <span style={{ font: `500 12px ${SANS}`, color: C.faint }}>✉ emailed</span>}
  </>;
  if (r.state === "needs_details") return <><Pill tone="neutral">No payment details</Pill><a href="/admin/payouts-ii" style={link}>Add details →</a></>;
  if (r.state === "manual") return <><Pill tone="neutral">Not on Wise</Pill><a href="/admin/payouts-ii" style={link}>Pay manually →</a></>;
  if (r.state === "hold") return <>
    <Pill tone={r.paused && reasonIsRestricted(r.paused.reason) ? "red" : "orange"}>{r.paused ? reasonLabel(r.paused.reason) : "On hold"}</Pill>
    {r.paused
      ? <button onClick={(e) => { e.stopPropagation(); onResume(); }} style={{ border: "none", background: "none", font: `700 12px ${SANS}`, color: C.link, cursor: "pointer", padding: 0 }}>Resume</button>
      : r.holdReason && <span title={r.holdReason} style={{ font: `500 12px ${SANS}`, color: C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: "0 1 auto" }}>{r.holdReason}</span>}
  </>;
  return <Pill tone="blue">Due {fmtDate(r.dueDate)}</Pill>;
}

function Checkbox({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label="select" style={{ width: 16, height: 16, borderRadius: 4, cursor: "pointer", border: `1.5px solid ${on ? C.ink : "#c3c9d3"}`, background: on ? C.ink : "transparent", color: "#fff", font: `800 10px/1 ${SANS}`, padding: 0, display: "grid", placeItems: "center" }}>{on ? "✓" : ""}</button>;
}

// ── Tab B: All payees ───────────────────────────────────────────────────
type Status = "due" | "paid" | "hold" | "restricted" | "upcoming" | "ended";
const STATUS_PILL: Record<Status, { tone: PillTone; label: string }> = {
  due: { tone: "amber", label: "Due this run" }, paid: { tone: "green", label: "Paid this cycle" },
  hold: { tone: "orange", label: "On hold" }, restricted: { tone: "red", label: "Restricted" },
  upcoming: { tone: "blue", label: "Not due yet" }, ended: { tone: "neutral", label: "Ended" },
};
function payeeStatus(key: string, ready: Row[]): Status {
  const rs = ready.filter((r) => r.payeeKey === key);
  if (rs.some((r) => r.state === "hold" && /restrict/i.test(r.holdReason || ""))) return "restricted";
  if (rs.some((r) => r.state === "hold")) return "hold";
  if (rs.some((r) => ["ready", "manual", "needs_details"].includes(r.state))) return "due";
  if (rs.some((r) => r.state === "paid")) return "paid";
  if (rs.some((r) => r.state === "upcoming")) return "upcoming";
  return "ended";
}

function ctxForPayee(p: Payee): PauseCtx {
  const last = p.history.find((h) => h.date);
  const kind = p.kinds.includes("monthly") ? "monthly" : p.kinds.includes("setup") ? "setup fee" : "referral";
  return {
    payeeKey: p.key, ownerFirst: first(p.name), ownerEmail: p.email,
    referrerFirst: p.referredBy ? first(p.referredBy) : null,
    kind, amt: money(last?.amount || 0), dest: [p.method, p.masked].filter(Boolean).join(" · ") || "your account",
  };
}
function AllPayees({ payees, ready, actions }: { payees: Payee[]; ready: Row[]; actions: PayoutActions }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [status, setStatus] = useState<Status | "all" | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Status comes from the pay-run row; a manual pause overrides it (restricted/hold).
  const withStatus = useMemo(() => payees.map((p) => {
    let st = payeeStatus(p.key, ready);
    if (p.pause) st = reasonIsRestricted(p.pause.reason) ? "restricted" : "hold";
    return { p, st };
  }), [payees, ready]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: payees.length, due: 0, paid: 0, hold: 0, restricted: 0, upcoming: 0, ended: 0 };
    for (const { st } of withStatus) c[st]++;
    return c;
  }, [withStatus, payees]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return withStatus.filter(({ p, st }) => {
      if (status && status !== "all" && st !== status) return false;
      if (kind !== "all" && !p.kinds.includes(kind)) return false;
      if (!needle) return true;
      return [p.name, p.sub, p.referredBy, p.method, p.masked, p.email, p.phone, p.holder].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [withStatus, q, kind, status]);

  const cards = [
    { k: "all", label: "All", dot: "#2563eb", fg: "#1d4ed8", value: String(counts.all), hint: "every payee" },
    { k: "due", label: "Due this run", dot: "#d97706", fg: "#92400e", value: String(counts.due), hint: "in this pay run" },
    { k: "paid", label: "Paid this cycle", dot: "#12a150", fg: "#0f7a3d", value: String(counts.paid), hint: "sent this cycle" },
    { k: "hold", label: "On hold", dot: "#ea580c", fg: "#c2410c", value: String(counts.hold), hint: "payout paused" },
    { k: "restricted", label: "Restricted", dot: "#dc2626", fg: "#b91c1c", value: String(counts.restricted), hint: "account restricted" },
    { k: "upcoming", label: "Not due yet", dot: "#2563eb", fg: "#1d4ed8", value: String(counts.upcoming), hint: "next cycle" },
    { k: "ended", label: "Ended", dot: "#8a93a3", fg: "#5b6779", value: String(counts.ended), hint: "no more payouts" },
  ];
  const toggleOpen = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const col = "minmax(0,1.3fr) minmax(0,1fr) 170px 100px 150px 100px 120px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StatCards cards={cards} active={status} onPick={(k) => setStatus((cur) => cur === k ? null : k as Status | "all")} />
      <div style={{ ...cardBox, padding: "12px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any payee: name, email, slug, referrer, method, account number…" style={searchInput} />
        <select value={kind} onChange={(e) => setKind(e.target.value as "all" | Kind)} style={{ border: `1px solid ${C.inputBorder}`, background: C.card, borderRadius: 10, padding: "9px 10px", font: `600 13px ${SANS}`, color: C.ink }}>
          <option value="all">All payout types</option><option value="referral">Referral</option><option value="monthly">Monthly</option><option value="setup">Setup</option>
        </select>
      </div>
      <div style={{ font: `500 12.5px ${SANS}`, color: C.muted, margin: "0 4px" }}><b style={{ color: C.ink, fontFamily: "var(--font-grotesk)" }}>{filtered.length}</b> of {payees.length} payees · click a name for details and payment record</div>
      <div style={{ ...cardBox, overflow: "auto" }}>
        <div style={{ minWidth: 1060 }}>
          <div style={{ display: "grid", gridTemplateColumns: col, gap: 12, alignItems: "center", padding: "10px 16px", background: C.band, borderBottom: `1px solid ${C.divider}`, font: `700 10.5px ${SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: C.faint }}>
            <span>Payee</span><span>Referred by</span><span>Method</span><span>Accounts</span><span>Last paid</span><span style={{ textAlign: "right" }}>Total paid</span><span>Status</span>
          </div>
          {filtered.map(({ p, st }) => {
            const isOpen = open.has(p.key);
            const last = p.history.find((h) => h.date);
            return (
              <div key={p.key} style={{ borderBottom: `1px solid ${C.divider}` }}>
                <div onClick={() => toggleOpen(p.key)} style={{ display: "grid", gridTemplateColumns: col, gap: 12, alignItems: "center", padding: "12px 16px", cursor: "pointer", background: isOpen ? C.band : undefined }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, font: `700 13.5px ${SANS}`, color: C.ink }}>
                      <span style={{ font: `700 12px ${SANS}`, color: C.faint, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    </div>
                    <div style={{ paddingLeft: 18, font: `500 12px ${SANS}`, color: C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.sub}</div>
                    {p.flags && <FlagPills flags={p.flags} />}
                  </div>
                  <span style={{ font: `500 13px ${SANS}`, color: C.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.referredBy || "—"}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ font: `600 13px ${SANS}`, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.method || "—"}</div>
                    <div style={{ font: `500 12px ${GRO}`, color: C.faint }}>{p.masked || ""}</div>
                  </div>
                  <span style={{ font: `500 13px ${SANS}`, color: C.ink2 }}>{p.accounts > 0 ? p.accounts : "—"}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ font: `700 13px ${GRO}`, color: C.ink }}>{last ? money(last.amount) : "—"}</div>
                    <div style={{ font: `500 12px ${SANS}`, color: C.faint }}>{last ? fmtDate(last.date) : "never paid"}</div>
                  </div>
                  <span style={{ font: `700 14px ${GRO}`, color: C.ink, textAlign: "right" }}>{money(p.totalPaid)}</span>
                  <span><Pill tone={STATUS_PILL[st].tone}>{STATUS_PILL[st].label}</Pill></span>
                </div>
                {isOpen && (
                  <div style={{ margin: "0 16px 16px 34px", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", background: C.card }}>
                    {p.flags && <CheckBlock flags={p.flags} onMarkChecked={() => actions.markChecked(p.key)} />}
                    {st !== "ended" && <PausePanel ctx={ctxForPayee(p)} paused={p.pause} onPause={actions.pause} onResume={() => actions.resume(p.key)} />}
                    {p.note && <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.divider}`, font: `500 12.5px/1.5 ${SANS}`, background: st === "restricted" ? "#fef2f2" : st === "hold" ? "#fff7ed" : C.inset, color: st === "restricted" ? "#7f1d1d" : st === "hold" ? "#9a3412" : C.ink2 }}>{p.note}</div>}
                    <InfoGrid p={p} nextDue />
                    <div style={{ borderTop: `1px solid ${C.divider}`, padding: "12px 14px" }}>
                      <PaymentRecord history={p.history} total={p.totalPaid} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div style={{ padding: 44, textAlign: "center", font: `500 13.5px ${SANS}`, color: C.muted }}>No payees match.</div>}
        </div>
      </div>
    </div>
  );
}
