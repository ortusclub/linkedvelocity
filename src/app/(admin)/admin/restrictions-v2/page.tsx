"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";

const F_SANS = "var(--font-sans),'Plus Jakarta Sans',system-ui,sans-serif";
const F_GRO = "var(--font-grotesk),'Space Grotesk',system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

type StepKind = "email" | "qr" | "id" | "form" | "li" | "note" | "gl" | "pw" | "relist" | "handback";
type Outcome = "ok" | "fail" | "pending" | "none" | "na";
type Step = { k: StepKind; o: "ok" | "fail" | "pending"; at: string; err?: string; note?: string };
type Chain = { k: StepKind | "na"; label: string; outcome: Outcome; tip: string };
type Flag = { label: string; kind: "repeat" | "stale" | "renter" };
type Hist = { reason: string; days: number; at: string; how: string; open: boolean };
type WfAction = { id: string; label: string; variant: "primary" | "danger" | "secondary" };
type WfCard = { n: number; title: string; sub: string; state: string; stLbl: string; stFg: string; isCurrent: boolean; note?: string; checks?: Array<{ key: "gl" | "pw"; label: string; on: boolean }>; hasPw?: boolean; hasBar?: boolean; pct?: number; barLabel?: string; actions: WfAction[] };
type MailEvt = { type: string; typeLabel: string; at: string; subject: string; severity: string; body: string };
type Row = {
  id: string; name: string; email: string | null; status: string; verified: boolean;
  linkedinUrl: string | null; poc: string; phase: { label: string; pr: number };
  restrictedAt: string | null; reason: string; steps: Step[];
  next: string; urgent: boolean; bucket: string; cnt: number; restrictedMs: number;
  resolvedAt: number | null; closedAt: number | null; lostOutcome: "perma" | "nocontact" | null; lastErr: string; flags: Flag[]; chain: Chain[];
  lastTouchAt: number | null; lastTouchLabel: string;
  renterName: string | null; qrUrl: string | null; qrAt: string | null;
  sentAt: string | null; sentVia: string | null; outcome: string | null; history: Hist[];
  wf: WfCard[]; wfNext: string; wfLevel: string; emails: MailEvt[];
};

// PoC avatar colour from the name (same scheme as inventory v2), so a PoC looks identical here.
const AV = ["#2563eb", "#7c3aed", "#0891b2", "#db2777", "#ea580c", "#059669", "#4f46e5"];
const colorOf = (s: string) => AV[[...s].reduce((h, c) => (h + c.charCodeAt(0)) | 0, 0) % AV.length];
const iniOf = (s: string) => (s || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
const LOST: Record<string, [string, string, string]> = { perma: ["Permanently restricted", "#fef2f2", "#b91c1c"], nocontact: ["Can't contact owner", "#fff7ed", "#c2410c"] };

const OC: Record<string, [string, string, string]> = {
  ok: ["#16a34a", "#ecfdf3", "#0f7a3d"], fail: ["#dc2626", "#fef2f2", "#b91c1c"],
  pending: ["#3b82f6", "#eff6ff", "#1d4ed8"], none: ["#e3e6ec", "#f1f5f9", "#9aa3b2"], na: ["#cbd5e1", "#f1f5f9", "#9aa3b2"],
};
const ST: Record<string, [string, string, string]> = {
  rented: ["Rented", "#eff6ff", "#1d4ed8"], under_construction: ["Under construction", "#f1f5f9", "#475569"],
  available: ["Onboarded", "#f4fbf7", "#0f7a3d"], maintenance: ["Maintenance", "#fff7ed", "#c2410c"],
};
const FLAG: Record<string, [string, string]> = { repeat: ["#fff7ed", "#c2410c"], stale: ["#fef2f2", "#b91c1c"], renter: ["#f1f5f9", "#475569"], noqr: ["#eef2ff", "#4338ca"] };
const TITLES: Record<StepKind, string> = { email: "Owner contacted", qr: "QR recovery link", id: "ID verification", form: "Appeal form", li: "LinkedIn decision", note: "Note", gl: "GoLogin login", pw: "Password reset", relist: "Relisted", handback: "Handed back" };

const dur = (ms: number) => { const h = Math.floor(ms / 3600e3); return h < 24 ? h + "h" : Math.floor(h / 24) + "d " + (h % 24) + "h"; };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return d.getDate() + " " + MON[d.getMonth()] + ", " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const rel = (iso: string | null, now: number) => { if (!iso) return ""; const m = Math.max(1, Math.round((now - Date.parse(iso)) / 6e4)); return m < 60 ? m + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago"; };
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

function QrCard({ r, reload }: { r: Row; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (dataUrl: string) => {
    setBusy(true); setErr("");
    try { const res = await fetch(`/api/admin/accounts/${r.id}/recovery-qr`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl }) }); const d = await res.json(); if (!res.ok) throw new Error(d.error || "Upload failed."); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); } finally { setBusy(false); }
  };
  const onPaste = async (e: React.ClipboardEvent) => { const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/")); const f = item?.getAsFile(); if (f) { e.preventDefault(); await upload(await fileToDataUrl(f)); } };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); if (!drag) setDrag(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDrag(false); };
  const onDrop = async (e: React.DragEvent) => { e.preventDefault(); setDrag(false); if (busy) return; const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith("image/")); if (f) await upload(await fileToDataUrl(f)); };
  const clearQr = async () => { setBusy(true); try { await fetch(`/api/admin/accounts/${r.id}/recovery-qr`, { method: "DELETE" }); reload(); } finally { setBusy(false); } };
  // Mint the owner's private /recover link and hand it off on the channel they actually use.
  // Copy = just the link; the app buttons open a pre-filled share AND mark the case as sent.
  const share = async (via: "copy" | "whatsapp" | "telegram" | "viber") => {
    setBusy(true); setErr(""); setInfo("");
    try {
      const res = await fetch(`/api/admin/accounts/${r.id}/recover-link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ via }) });
      const d = await res.json(); if (!res.ok) throw new Error(d.error || "Couldn't make the link.");
      const link: string = d.link;
      const lead = `Hi — LinkedIn needs a quick identity check to get ${d.name}'s account back online, and it has to be done on a phone. Open this private link on your phone and scan the QR with the LinkedIn app (it expires in 24h):`;
      if (via === "copy") {
        try { await navigator.clipboard.writeText(link); } catch { /* clipboard may be blocked */ }
        setInfo("Link copied — paste it to the owner.");
      } else {
        const url = via === "telegram" ? `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(lead)}`
          : via === "viber" ? `viber://forward?text=${encodeURIComponent(`${lead}\n${link}`)}`
          : `https://wa.me/?text=${encodeURIComponent(`${lead}\n${link}`)}`;
        window.open(url, "_blank");
        setInfo(`Opened ${via} — pick the owner and send. Marked as sent.`);
        reload();
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  };
  const btn = (label: string, onClick: () => void, primary?: boolean) => (
    <button onClick={onClick} disabled={busy} style={{ border: primary ? "none" : "1px solid #dde1e8", background: primary ? "#0b1220" : "#fff", color: primary ? "#fff" : "#0b1220", borderRadius: 8, padding: "6px 11px", font: `600 12px ${F_SANS}`, cursor: "pointer", whiteSpace: "nowrap" }}>{label}</button>
  );
  return (
    <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>QR recovery</span>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) await upload(await fileToDataUrl(f)); e.currentTarget.value = ""; }} />
      {r.qrUrl ? (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.qrUrl} alt="recovery QR" style={{ flex: "none", width: 84, height: 84, objectFit: "contain", border: "1px solid #e3e6ec", borderRadius: 10, background: "#f8f9fb" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <span style={{ font: `500 12px ${F_SANS}`, color: "#5b6779" }}>Captured {fmt(r.qrAt)}{r.sentAt ? ` · link sent ${rel(r.sentAt, Date.now())}` : " · not sent yet"}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {btn(busy ? "…" : "Replace", () => fileRef.current?.click())}
              {btn("Clear", clearQr)}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ font: `600 11px ${F_SANS}`, color: "#5b6779" }}>Send link to owner:</span>
              {btn("Copy", () => share("copy"))}
              {btn("WhatsApp", () => share("whatsapp"))}
              {btn("Telegram", () => share("telegram"))}
              {btn("Viber", () => share("viber"))}
            </div>
          </div>
        </div>
      ) : (
        <button onClick={() => fileRef.current?.click()} onPaste={onPaste} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} tabIndex={0} disabled={busy} style={{ border: `1.5px dashed ${drag ? "#2563eb" : "#cfd5df"}`, background: drag ? "#eff4ff" : "#fafbfc", borderRadius: 10, padding: 16, font: `600 12.5px ${F_SANS}`, color: drag ? "#1d4ed8" : "#5b6779", cursor: "pointer", textAlign: "center", transition: "border-color .1s, background .1s" }}>{drag ? "Drop the QR image to attach it" : "Drag a QR screenshot here · paste (⌘V) · or click to upload"}</button>
      )}
      {err && <span style={{ font: `500 11.5px ${F_SANS}`, color: "#b91c1c" }}>{err}</span>}
      {info && <span style={{ font: `600 11.5px ${F_SANS}`, color: "#0f7a3d" }}>{info}</span>}
    </div>
  );
}

type ContactData = {
  owner: { name: string; email: string | null; pref: string; prefLabel: string };
  contacts: Array<{ key: string; label: string; value: string; href: string; open: string }>;
  account: { linkedinUrl: string | null; loginEmail: string | null; password: string | null; has2fa: boolean };
};

// Owner contact + account sign-in details, fetched on expand so credentials stay out of the list.
function ContactCreds({ r }: { r: Row }) {
  const [data, setData] = useState<ContactData | null>(null);
  const [err, setErr] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [totp, setTotp] = useState<{ code: string; until: number } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/accounts/${r.id}/recovery-contact`).then((res) => res.json()).then((d) => { if (alive) (d.error ? setErr(d.error) : setData(d)); }).catch((e) => alive && setErr(String(e)));
    return () => { alive = false; };
  }, [r.id]);

  useEffect(() => {
    if (!data?.account.has2fa) return;
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    const load = () => fetch(`/api/admin/accounts/${r.id}/totp`).then((res) => res.json()).then((d) => {
      if (!alive || !d.configured || !d.code) return;
      const secs = Math.max(1, d.expiresIn || 30);
      setTotp({ code: d.code, until: Date.now() + secs * 1000 });
      timer = setTimeout(load, secs * 1000);
    }).catch(() => {});
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [r.id, data?.account.has2fa]);

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  const copy = (key: string, v: string) => { navigator.clipboard?.writeText(v); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400); };
  const cbtn = (key: string, v: string) => <button onClick={() => copy(key, v)} style={{ border: "1px solid #dde1e8", background: "#fff", color: "#334155", borderRadius: 7, padding: "4px 8px", font: `700 11px ${F_SANS}`, cursor: "pointer" }}>{copied === key ? "Copied" : "Copy"}</button>;
  const obtn = (href: string, label: string) => <a href={href} target="_blank" rel="noreferrer" style={{ background: "#0a66c2", color: "#fff", borderRadius: 7, padding: "5px 9px", font: `700 11px ${F_SANS}`, textDecoration: "none", whiteSpace: "nowrap" }}>{label}</a>;
  const field = (label: string, node: ReactNode, actions: ReactNode, border = "#e3e6ec", bg = "#fafbfc") => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${border}`, background: bg, borderRadius: 10, padding: "6px 6px 6px 10px", minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ font: `700 10px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: "#8a93a3", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ font: `600 12.5px ${MONO}`, color: "#0b1220", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 300 }}>{node}</span>
      </div>
      {actions}
    </div>
  );
  const remain = totp ? Math.max(0, Math.round((totp.until - Date.now()) / 1000)) : 0;

  return (
    <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 12, padding: "12px 14px", display: "flex", gap: "10px 18px", alignItems: "center", flexWrap: "wrap" }}>
      {err && <span style={{ font: `600 12px ${F_SANS}`, color: "#b91c1c" }}>{err}</span>}
      {!data && !err && <span style={{ font: `500 12px ${F_SANS}`, color: "#8a93a3" }}>Loading contact & sign-in…</span>}
      {data && <>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 150 }}>
          <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Owner contact</span>
          <span style={{ font: `700 13.5px ${F_SANS}`, color: "#0b1220" }}>{data.owner.name}</span>
          {data.owner.prefLabel && <span style={{ font: `500 11.5px ${F_SANS}`, color: "#8a93a3" }}>Prefers {data.owner.prefLabel}</span>}
        </div>
        {data.contacts.map((k) => field(k.label + (k.key === data.owner.pref ? " · preferred" : ""), k.value, <>{cbtn(k.key, k.value)}{obtn(k.href, k.open)}</>, k.key === data.owner.pref ? "#bfd3fb" : "#e3e6ec", k.key === data.owner.pref ? "#f5f8ff" : "#fafbfc"))}
        {!data.contacts.length && <span style={{ font: `600 12px ${F_SANS}`, color: "#b91c1c" }}>No contact details on file</span>}

        <div style={{ flexBasis: "100%", height: 0 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 150 }}>
          <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Account sign-in</span>
          <span style={{ font: `500 11.5px ${F_SANS}`, color: "#8a93a3" }}>{(ST[r.status] || [r.status])[0]}{r.renterName ? ` · ${r.renterName}` : ""}</span>
        </div>
        {data.account.linkedinUrl && field("LinkedIn", data.account.linkedinUrl.replace(/^https?:\/\//, ""), obtn(data.account.linkedinUrl.startsWith("http") ? data.account.linkedinUrl : `https://${data.account.linkedinUrl}`, "Open"))}
        {data.account.loginEmail && field("Login email", data.account.loginEmail, cbtn("login", data.account.loginEmail))}
        {data.account.password && field("Password", showPw ? data.account.password : "••••••••••", <><button onClick={() => setShowPw((s) => !s)} style={{ border: "1px solid #dde1e8", background: "#fff", color: "#334155", borderRadius: 7, padding: "4px 8px", font: `700 11px ${F_SANS}`, cursor: "pointer" }}>{showPw ? "Hide" : "Show"}</button>{cbtn("pw", data.account.password)}</>)}
        {data.account.has2fa && totp && field(`2FA code · ${remain}s`, `${totp.code.slice(0, 3)} ${totp.code.slice(3)}`, cbtn("2fa", totp.code), "#e3e6ec", "#f5f8ff")}
      </>}
    </div>
  );
}

// The 5-step recovery runbook. Each card's buttons map to an API action; checkboxes toggle the
// GoLogin / password-reset steps (the password field saves the new password to the account).
const WF_MAP: Record<string, Record<string, unknown>> = {
  qr_sent: { action: "add_step", kind: "qr", outcome: "pending" }, qr_ok: { action: "add_step", kind: "qr", outcome: "ok" }, qr_fail: { action: "add_step", kind: "qr", outcome: "fail", note: "QR didn't work" },
  id_sent: { action: "add_step", kind: "id", outcome: "pending" }, id_ok: { action: "add_step", kind: "id", outcome: "ok" }, id_fail: { action: "add_step", kind: "id", outcome: "fail", note: "ID verification failed" },
  form_sent: { action: "add_step", kind: "form", outcome: "pending" }, form_ok: { action: "add_step", kind: "form", outcome: "ok" }, form_fail: { action: "add_step", kind: "form", outcome: "fail", note: "Appeal rejected" },
  perma: { action: "mark_lost", outcome: "perma" }, relist: { action: "add_step", kind: "relist", outcome: "ok" }, handback: { action: "add_step", kind: "handback", outcome: "ok" },
  recovered: { action: "mark_recovered" },
};
function WorkflowPanel({ r, post }: { r: Row; post: (body: unknown) => void }) {
  const [pw, setPw] = useState("");
  const run = (id: string) => { const b = WF_MAP[id]; if (b) post(b); };
  const toggle = (kind: "gl" | "pw") => post({ action: "toggle_step", kind, ...(kind === "pw" && pw.trim() ? { password: pw.trim() } : {}) });
  const bstyle = (v: string): CSSProperties => ({ border: v === "primary" ? "none" : `1px solid ${v === "danger" ? "#f3c7c7" : "#dde1e8"}`, background: v === "primary" ? "#2563eb" : "#fff", color: v === "primary" ? "#fff" : v === "danger" ? "#b91c1c" : "#0b1220", borderRadius: 8, padding: "6px 11px", font: `700 12px ${F_SANS}`, cursor: "pointer", whiteSpace: "nowrap" });
  return (
    <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Recovery workflow</span>
        <span style={{ font: `500 13px ${F_SANS}`, color: "#5b6779" }}>Next: <b style={{ color: "#0b1220" }}>{r.wfNext}</b></span>
        <span style={{ flex: 1 }} />
        <span style={{ font: `700 12px ${F_SANS}`, padding: "3px 10px", borderRadius: 999, background: "#ecfdf3", color: "#0f7a3d" }}>{r.wfLevel}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(190px,1fr))", gap: 10, alignItems: "start" }}>
          {r.wf.map((w) => (
            <div key={w.n} style={{ border: `1.5px solid ${w.isCurrent ? "#2563eb" : w.state === "fail" ? "#f3c7c7" : "#e3e6ec"}`, background: w.state === "lock" || w.state === "skip" ? "#fafbfc" : "#fff", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
              <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Step {w.n}</span>
              <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".05em", textTransform: "uppercase", color: w.stFg }}>{w.stLbl}</span>
              <span style={{ font: `700 14px ${F_SANS}`, color: w.state === "lock" || w.state === "skip" ? "#8a93a3" : "#0b1220" }}>{w.title}</span>
              <span style={{ font: `500 12px ${F_SANS}`, lineHeight: 1.45, color: "#5b6779" }}>{w.sub}</span>
              {(w.n === 2 || w.n === 3) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 1 }}>
                  {w.n === 3 && <a href="https://www.linkedin.com/help/linkedin/ask/TS-F-APPEAL" target="_blank" rel="noopener noreferrer" style={{ font: `700 11.5px ${F_SANS}`, color: "#0a66c2", textDecoration: "none" }}>↗ Open the appeal form</a>}
                  {w.n === 3 && <a href="https://www.linkedin.com/help/linkedin/ask/LI-DEFAULT-NEW" target="_blank" rel="noopener noreferrer" style={{ font: `600 11.5px ${F_SANS}`, color: "#5b6779", textDecoration: "none" }}>↗ General contact form (try this first)</a>}
                  <a href="https://linkedvelocity.com/guide/restricted-account" target="_blank" rel="noopener noreferrer" style={{ font: `600 11.5px ${F_SANS}`, color: "#5b6779", textDecoration: "none" }}>↗ What to put in each field (guide)</a>
                </div>
              )}
              {w.checks?.map((ck) => (
                <label key={ck.key} style={{ display: "flex", gap: 8, alignItems: "center", font: `600 12.5px ${F_SANS}`, color: "#0b1220", cursor: "pointer" }}>
                  <input type="checkbox" checked={ck.on} onChange={() => toggle(ck.key)} style={{ width: 15, height: 15, accentColor: "#16a34a" }} />{ck.label}
                </label>
              ))}
              {w.hasPw && <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (saves to account)" style={{ border: "1px solid #dde1e8", background: "#fff", borderRadius: 8, padding: "6px 9px", font: `500 12px ${MONO}`, color: "#0b1220", outline: "none", minWidth: 0 }} />}
              {w.hasBar && <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ height: 6, borderRadius: 999, background: "#eef0f4", overflow: "hidden" }}><div style={{ height: "100%", width: `${w.pct || 0}%`, background: "#16a34a", borderRadius: 999 }} /></div>
                <span style={{ font: `500 11px ${F_SANS}`, color: "#8a93a3" }}>{w.barLabel}</span>
              </div>}
              {w.note && <span style={{ font: `500 11.5px ${F_SANS}`, color: "#8a93a3", lineHeight: 1.4 }}>{w.note}</span>}
              {w.actions.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>{w.actions.map((act) => <button key={act.id} onClick={() => run(act.id)} style={bstyle(act.variant)}>{act.label}</button>)}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MAIL_SEV: Record<string, [string, string]> = { benign: ["#f1f5f9", "#475569"], review: ["#eff6ff", "#1d4ed8"], danger: ["#fef2f2", "#b91c1c"] };
// Captured LinkedIn appeal / ID / recovery emails for this account (auto-recorded with their real dates).
function EmailLog({ emails }: { emails: MailEvt[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>LinkedIn emails · {emails.length}</span>
      {!emails.length && <span style={{ font: `500 12.5px ${F_SANS}`, color: "#8a93a3" }}>No LinkedIn appeal / ID emails captured for this account.</span>}
      {emails.slice().reverse().map((m, i) => {
        const sev = MAIL_SEV[m.severity] || MAIL_SEV.review; const o = !!open[i];
        return (
          <div key={i} onClick={() => setOpen((s) => ({ ...s, [i]: !o }))} style={{ border: "1px solid #eef0f4", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, cursor: "pointer", background: o ? "#fafbfc" : "#fff" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: "none", font: `700 10.5px ${F_SANS}`, color: "#5b6779", whiteSpace: "nowrap" }}>↓ LinkedIn</span>
              <span style={{ flex: 1, minWidth: 0, font: `600 12.5px ${F_SANS}`, color: "#0b1220", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.subject}</span>
              <span style={{ flex: "none", font: `700 10.5px ${F_SANS}`, padding: "2px 8px", borderRadius: 999, background: sev[0], color: sev[1], whiteSpace: "nowrap" }}>{m.typeLabel}</span>
            </div>
            <span style={{ font: `500 11px ${F_SANS}`, color: "#8a93a3" }}>{fmt(m.at)}</span>
            {o && <div style={{ font: `500 12px ${F_SANS}`, lineHeight: 1.55, color: "#334155", borderTop: "1px solid #eef0f4", paddingTop: 8, whiteSpace: "pre-wrap" }}>{m.body}</div>}
          </div>
        );
      })}
    </div>
  );
}

// Appeal mailbox: mint a fresh, never-used address on the appeal domain to paste into LinkedIn's
// contact/appeal form (LinkedIn blocks an address already tied to an account). LinkedIn's reply lands
// back on this case automatically (see the LinkedIn emails panel) via the inbound capture webhook.
type AppealBox = { id: string; address: string; createdAt: string };
function AppealMailboxPanel({ accountId }: { accountId: string }) {
  const [list, setList] = useState<AppealBox[] | null>(null);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let live = true;
    (async () => {
      try { const res = await fetch(`/api/admin/accounts/${accountId}/appeal-email`); const d = await res.json(); if (live && res.ok) { setList(d.mailboxes || []); setDomain(d.domain || ""); } } catch { if (live) setList([]); }
    })();
    return () => { live = false; };
  }, [accountId]);
  const copy = async (a: string, note?: string) => { try { await navigator.clipboard.writeText(a); setMsg(note || `Copied ${a}`); } catch { setMsg(a); } };
  const mint = async () => {
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/appeal-email`, { method: "POST" });
      const d = await res.json(); if (!res.ok) throw new Error(d.error || "Failed.");
      setList((l) => [d.mailbox, ...(l || [])]); if (d.domain) setDomain(d.domain);
      await copy(d.mailbox.address, "New address copied — paste it into LinkedIn's form");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  };
  return (
    <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Appeal email{domain ? ` · ${domain}` : ""}</span>
        <span style={{ flex: 1 }} />
        <button onClick={mint} disabled={busy} style={{ border: "none", background: "#0a66c2", color: "#fff", borderRadius: 8, padding: "6px 11px", font: `700 12px ${F_SANS}`, cursor: "pointer" }}>+ New appeal email</button>
      </div>
      <span style={{ font: `500 11.5px ${F_SANS}`, color: "#8a93a3", lineHeight: 1.45 }}>A fresh, never-used address so LinkedIn&apos;s contact/appeal form accepts it. Paste it in the form&apos;s email field — LinkedIn&apos;s reply lands in the LinkedIn emails panel above.</span>
      {list === null && <span style={{ font: `500 12px ${F_SANS}`, color: "#9aa3b2" }}>Loading…</span>}
      {list?.length === 0 && <span style={{ font: `500 12px ${F_SANS}`, color: "#9aa3b2" }}>None yet — mint one when you open an appeal or contact form.</span>}
      {list?.map((b) => (
        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #eef0f4", borderRadius: 9, padding: "7px 10px" }}>
          <span style={{ flex: 1, minWidth: 0, font: `600 12.5px ${MONO}`, color: "#0b1220", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.address}</span>
          <span style={{ flex: "none", font: `500 11px ${F_SANS}`, color: "#9aa3b2", whiteSpace: "nowrap" }}>{fmt(b.createdAt).split(",")[0]}</span>
          <button onClick={() => copy(b.address)} style={{ flex: "none", border: "1px solid #dde1e8", background: "#fff", color: "#5b6779", borderRadius: 7, padding: "4px 9px", font: `700 11px ${F_SANS}`, cursor: "pointer" }}>Copy</button>
        </div>
      ))}
      {msg && <span style={{ font: `600 11.5px ${F_SANS}`, color: "#0f7a3d" }}>{msg}</span>}
    </div>
  );
}

function CaseDetail({ r, reload, now }: { r: Row; reload: () => void; now: number }) {
  const [fk, setFk] = useState<StepKind>("id");
  const [fo, setFo] = useState<"ok" | "fail" | "pending">("fail");
  const [fn, setFn] = useState("");
  const [fd, setFd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const post = async (body: unknown) => { setBusy(true); try { const res = await fetch(`/api/admin/accounts/${r.id}/recovery-case`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await res.json(); if (!res.ok) throw new Error(d.error || "Failed."); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); } };
  const addStep = () => { post({ action: "add_step", kind: fk, outcome: fo, note: fn.trim() || undefined, at: fd || undefined }); setFn(""); setFd(""); };
  const sendEmail = async () => { setBusy(true); setMsg(""); try { const res = await fetch(`/api/admin/accounts/${r.id}/recover-send`, { method: "POST" }); const d = await res.json(); if (!res.ok) throw new Error(d.error || "Send failed."); const to = (d.sent || []).map((s: { recipient: string }) => s.recipient).join(" + ") || "—"; setMsg(`Emailed ${to}`); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Send failed."); } finally { setBusy(false); } };

  type TLItem = { title: string; oLbl: string; dot: string; oc: "ok" | "fail" | "pending" | "none"; at: string; err: string; note: string };
  const timeline: TLItem[] = [{ title: "Restricted", oLbl: r.reason, dot: "#0b1220", oc: "none", at: fmt(r.restrictedAt), err: "", note: "" }];
  for (const s of r.steps) timeline.push({ title: TITLES[s.k], oLbl: ({ ok: "Worked", fail: "Failed", pending: "Pending" } as Record<string, string>)[s.o], dot: OC[s.o][0], oc: s.o, at: fmt(s.at) + " · " + rel(s.at, now), err: s.err || "", note: s.note || "" });
  if (r.resolvedAt) timeline.push({ title: "Case closed", oLbl: "Restricted " + dur(r.restrictedMs), dot: "#16a34a", oc: "ok", at: fmt(new Date(r.resolvedAt).toISOString()), err: "", note: "" });
  if (r.lostOutcome) timeline.push({ title: "Case closed", oLbl: LOST[r.lostOutcome][0], dot: LOST[r.lostOutcome][2], oc: "fail", at: r.closedAt ? fmt(new Date(r.closedAt).toISOString()) : "", err: "", note: "" });
  const closed = !!r.resolvedAt || !!r.lostOutcome;

  return (
    <div style={{ background: "#f8f9fb", borderBottom: "1px solid #e3e6ec", padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {!closed && <button onClick={sendEmail} disabled={busy} style={{ border: "none", background: "#0b1220", color: "#fff", borderRadius: 10, padding: "8px 13px", font: `700 12.5px ${F_SANS}`, cursor: "pointer" }}>{r.sentAt ? "Send reminder" : "Send restriction email"}</button>}
        {!closed && <button onClick={() => post({ action: "mark_recovered" })} disabled={busy} style={{ border: "1px solid #cdebd9", background: "#f4fbf7", color: "#0f7a3d", borderRadius: 10, padding: "8px 12px", font: `700 12.5px ${F_SANS}`, cursor: "pointer" }}>Mark recovered</button>}
        <label style={{ display: "flex", alignItems: "center", gap: 6, font: `700 11px ${F_SANS}`, letterSpacing: ".05em", textTransform: "uppercase", color: "#8a93a3" }}>PoC
          <input defaultValue={r.poc} placeholder="who's handling this" disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.poc || "")) post({ action: "set_poc", poc: v }); }}
            style={{ width: 150, border: "1px solid #dde1e8", background: "#fff", borderRadius: 10, padding: "7px 9px", font: `600 12.5px ${F_SANS}`, color: "#0b1220", textTransform: "none", letterSpacing: 0, outline: "none" }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, font: `700 11px ${F_SANS}`, letterSpacing: ".05em", textTransform: "uppercase", color: "#8a93a3" }}>Reason
          <input list="rc-reasons" defaultValue={r.reason === "Restriction" ? "" : r.reason} placeholder="why restricted" disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.reason) post({ action: "set_reason", reason: v }); }}
            style={{ width: 190, border: "1px solid #dde1e8", background: "#fff", borderRadius: 10, padding: "7px 9px", font: `600 12.5px ${F_SANS}`, color: "#0b1220", textTransform: "none", letterSpacing: 0, outline: "none" }} />
          <datalist id="rc-reasons">
            <option value="ID verification required" /><option value="Phone verification" /><option value="Unusual activity detected" /><option value="Suspicious login (new device)" /><option value="Automation / ToS" />
          </datalist>
        </label>
        {!closed && <button onClick={() => post({ action: "mark_lost", outcome: "perma" })} disabled={busy} style={{ border: "1px solid #f3c7c7", background: "#fff", color: "#b91c1c", borderRadius: 10, padding: "8px 12px", font: `700 12.5px ${F_SANS}`, cursor: "pointer" }}>Permanently restricted</button>}
        {!closed && <button onClick={() => post({ action: "mark_lost", outcome: "nocontact" })} disabled={busy} style={{ border: "1px solid #f5d9b8", background: "#fff", color: "#b45309", borderRadius: 10, padding: "8px 12px", font: `700 12.5px ${F_SANS}`, cursor: "pointer" }}>Can&apos;t contact owner</button>}
        {r.lostOutcome && <button onClick={() => post({ action: "reopen" })} disabled={busy} style={{ border: "1px solid #dde1e8", background: "#fff", color: "#0b1220", borderRadius: 10, padding: "8px 12px", font: `700 12.5px ${F_SANS}`, cursor: "pointer" }}>Reopen case</button>}
        {msg && <span style={{ font: `600 11.5px ${F_SANS}`, color: "#0f7a3d" }}>{msg}</span>}
        <span style={{ flex: 1 }} />
        <a href={`/admin/rentals?q=${encodeURIComponent(r.email || "")}`} style={{ font: `700 12px ${F_SANS}`, color: "#2563eb" }}>Renter record →</a>
        <a href="/admin/accounts" style={{ font: `700 12px ${F_SANS}`, color: "#2563eb" }}>Account mail →</a>
      </div>

      <WorkflowPanel r={r} post={post} />

      <ContactCreds r={r} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 12, alignItems: "start" }}>
        {/* Timeline + log a step */}
        <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>What we&apos;ve done</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {timeline.map((s, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "14px 1fr", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ flex: "none", width: 10, height: 10, borderRadius: "50%", background: s.dot, marginTop: 4 }} />
                  {i < timeline.length - 1 && <span style={{ flex: 1, width: 1.5, background: "#e3e6ec", minHeight: 10 }} />}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingBottom: 12, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ font: `700 13px ${F_SANS}`, color: "#0b1220" }}>{s.title}</span>
                    <span style={{ font: `700 10.5px ${F_SANS}`, padding: "2px 8px", borderRadius: 999, background: OC[s.oc][1], color: OC[s.oc][2], whiteSpace: "nowrap" }}>{s.oLbl}</span>
                    <span style={{ font: `500 11.5px ${F_SANS}`, color: "#8a93a3" }}>{s.at}</span>
                  </div>
                  {s.err && <span style={{ font: `500 11.5px ${MONO}`, color: "#b91c1c", background: "#fef2f2", borderRadius: 6, padding: "4px 8px", alignSelf: "flex-start" }}>{s.err}</span>}
                  {s.note && <span style={{ font: `500 12px ${F_SANS}`, color: "#5b6779" }}>{s.note}</span>}
                </div>
              </div>
            ))}
          </div>
          {!closed && (
            <div style={{ borderTop: "1px solid #eef0f4", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Log a step</span>
                <button onClick={() => post({ action: "undo_step" })} disabled={busy} title="Remove the last step you logged. If that step recovered the account, it's re-restricted. Also clears a misclicked owner QR/recovered self-report." style={{ border: "1px solid #dde1e8", background: "#fff", color: "#5b6779", borderRadius: 8, padding: "4px 10px", font: `700 11.5px ${F_SANS}`, cursor: "pointer" }}>↶ Undo last step</button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select value={fk} onChange={(e) => setFk(e.target.value as StepKind)} style={{ border: "1px solid #dde1e8", background: "#fff", borderRadius: 8, padding: "6px 8px", font: `600 12.5px ${F_SANS}`, color: "#0b1220" }}>
                  <option value="email">Owner contacted</option><option value="id">ID verification</option><option value="form">Appeal form</option><option value="li">LinkedIn decision</option><option value="note">Note</option>
                </select>
                <select value={fo} onChange={(e) => setFo(e.target.value as "ok" | "fail" | "pending")} style={{ border: "1px solid #dde1e8", background: "#fff", borderRadius: 8, padding: "6px 8px", font: `600 12.5px ${F_SANS}`, color: "#0b1220" }}>
                  <option value="ok">Worked</option><option value="fail">Failed</option><option value="pending">Pending</option>
                </select>
                <input value={fn} onChange={(e) => setFn(e.target.value)} placeholder={fk === "email" ? "Channel + detail, e.g. Telegram — sent guide" : "Error or note (optional)"} style={{ flex: 1, minWidth: 150, border: "1px solid #dde1e8", background: "#fff", borderRadius: 8, padding: "6px 9px", font: `500 12.5px ${F_SANS}`, color: "#0b1220", outline: "none" }} />
                <input type="date" value={fd} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setFd(e.target.value)} title="Date it happened (optional — defaults to today)" style={{ border: "1px solid #dde1e8", background: "#fff", borderRadius: 8, padding: "6px 8px", font: `500 12px ${F_SANS}`, color: fd ? "#0b1220" : "#8a93a3", outline: "none" }} />
                <button onClick={addStep} disabled={busy} style={{ border: "none", background: "#0b1220", color: "#fff", borderRadius: 8, padding: "6px 12px", font: `700 12.5px ${F_SANS}`, cursor: "pointer" }}>Add</button>
              </div>
              <span style={{ font: `500 11px ${F_SANS}`, color: "#9aa3b2" }}>A LinkedIn decision of &ldquo;Worked&rdquo; closes the case and marks the account recovered.</span>
            </div>
          )}
        </div>

        {/* LinkedIn email log (captured appeal / ID / recovery emails) */}
        <EmailLog emails={r.emails} />

        {/* Appeal mailbox + QR recovery + history */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <AppealMailboxPanel accountId={r.id} />
          <QrCard r={r} reload={reload} />
          <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Restriction history · {r.cnt}×</span>
            {r.history.map((h, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 10px", padding: "8px 0", borderTop: i ? "1px solid #f0f2f5" : "none" }}>
                <span style={{ font: `600 12.5px ${F_SANS}`, color: "#0b1220" }}>{h.reason}{h.open ? " (current)" : ""}</span>
                <span style={{ font: `700 12px ${F_GRO}`, color: "#334155", whiteSpace: "nowrap" }}>{h.open ? dur(r.restrictedMs) : h.days + "d"}</span>
                <span style={{ font: `500 11.5px ${F_SANS}`, color: "#8a93a3" }}>{fmt(h.at).split(",")[0]}</span>
                <span style={{ font: `600 11.5px ${F_SANS}`, color: h.open ? "#b91c1c" : "#0f7a3d", whiteSpace: "nowrap" }}>{h.how}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RestrictionsV2Page() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("action");
  const [phaseF, setPhaseF] = useState("all");
  const [touchSort, setTouchSort] = useState<"asc" | "desc" | null>(null);
  const [pocF, setPocF] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const reload = useCallback(() => {
    fetch("/api/admin/restrictions-v2").then((r) => r.json()).then((d) => { if (d.error) setError(d.error); else { setRows(d.rows); setNow(d.now); } }).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const all = rows || [];
  const hasIdFail = (r: Row) => r.steps.some((s) => s.k === "id" && s.o === "fail");
  const isOpenCase = (r: Row) => r.bucket !== "done" && r.bucket !== "lost";
  const pick: Record<string, (r: Row) => boolean> = {
    action: (r) => r.bucket === "action", open: isOpenCase, owner: (r) => r.bucket === "owner",
    linkedin: (r) => r.bucket === "linkedin", idfail: (r) => isOpenCase(r) && hasIdFail(r),
    done: (r) => r.bucket === "done", lost: (r) => r.bucket === "lost", all: () => true,
  };
  const ql = q.trim().toLowerCase();
  const match = (r: Row) => !ql || [r.name, r.email, r.renterName, r.poc, r.reason, r.lastErr].join(" ").toLowerCase().includes(ql);
  const matchPhase = (r: Row) => phaseF === "all" || r.status === phaseF;
  const matchPoc = (r: Row) => pocF === "all" || (pocF === "none" ? !r.poc : r.poc === pocF);
  const sinceMs = (r: Row) => (r.restrictedAt ? Date.parse(r.restrictedAt) : r.resolvedAt || 0);
  const closed = (r: Row) => (r.resolvedAt || r.lostOutcome ? 1 : 0);
  // Open tabs default to stalest-first by last touch (oldest / never-touched at top) so neglected
  // cases surface; the "Last touch" header toggles the direction. Other tabs keep the default order
  // unless the header is clicked.
  const openTab = ["action", "open", "owner", "linkedin", "idfail"].includes(filter);
  const touchDir: "asc" | "desc" | null = touchSort ?? (openTab ? "asc" : null);
  const byTouch = (a: Row, b: Row) => {
    const av = a.lastTouchAt, bv = b.lastTouchAt;
    if (av == null && bv == null) return sinceMs(a) - sinceMs(b);
    if (av == null) return touchDir === "asc" ? -1 : 1; // never touched = most stale
    if (bv == null) return touchDir === "asc" ? 1 : -1;
    return touchDir === "asc" ? av - bv : bv - av;
  };
  const list = all.filter(pick[filter] || pick.all).filter(match).filter(matchPhase).filter(matchPoc)
    .sort((a, b) => touchDir ? (closed(a) - closed(b) || byTouch(a, b)) : (closed(a) - closed(b) || a.phase.pr - b.phase.pr || Number(b.urgent) - Number(a.urgent) || sinceMs(a) - sinceMs(b)));

  const openCases = all.filter(isOpenCase);
  const avgD = openCases.length ? (openCases.reduce((n, r) => n + r.restrictedMs, 0) / openCases.length / 86400e3).toFixed(1) : "0";
  const tiles: Array<[string, string, number, string, string]> = [
    ["action", "Needs action", all.filter((r) => r.bucket === "action").length, "Email, appeal or chase due", "#dc2626"],
    ["open", "Open cases", openCases.length, `Avg restricted ${avgD}d`, "#0b1220"],
    ["owner", "Awaiting owner", all.filter((r) => r.bucket === "owner").length, "Email / QR sent", "#3b82f6"],
    ["linkedin", "Awaiting LinkedIn", all.filter((r) => r.bucket === "linkedin").length, "Appeal under review", "#8b5cf6"],
    ["idfail", "ID verify failed", openCases.filter(hasIdFail).length, "Open cases", "#f59e0b"],
    ["done", "Recovered", all.filter((r) => r.bucket === "done").length, "Last 30 days", "#16a34a"],
    ["lost", "Lost", all.filter((r) => r.bucket === "lost").length, "Perma-restricted / no contact", "#7f1d1d"],
  ];
  const segs: Array<[string, string]> = [["action", "Needs action"], ["open", "All open"], ["done", "Recovered"], ["lost", "Lost"], ["all", "Everything"]];

  // Phase + PoC filter chips, counted within the current primary filter (like the mockup).
  const inFilter = all.filter(pick[filter] || pick.all);
  const phaseOpts: Array<{ key: string; label: string; pr: string; n: number }> = [
    { key: "all", label: "All", pr: "" }, { key: "rented", label: "Rented", pr: "P1" },
    { key: "available", label: "Onboarded", pr: "P2" }, { key: "under_construction", label: "Under construction", pr: "P3" },
  ].map((o) => ({ ...o, n: inFilter.filter((r) => o.key === "all" || r.status === o.key).length }));
  const pocNames = [...new Set(all.map((r) => r.poc).filter(Boolean))].sort();
  const pocChips: Array<{ key: string; label: string; n: number }> = [
    { key: "all", label: "Everyone" }, ...pocNames.map((p) => ({ key: p, label: p })), { key: "none", label: "Unassigned" },
  ].map((o) => ({ ...o, n: inFilter.filter((r) => o.key === "all" || (o.key === "none" ? !r.poc : r.poc === o.key)).length }));

  const colTpl = "minmax(200px,1.6fr) 120px 110px 70px minmax(150px,1.1fr) 220px minmax(180px,1.3fr) 22px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ maxWidth: 760 }}>
        <h1 style={{ font: `700 26px ${F_GRO}`, color: "#0b1220", margin: "0 0 4px", letterSpacing: "-.01em" }}>Restrictions</h1>
        <p style={{ font: `500 13.5px ${F_SANS}`, color: "#5b6779", margin: 0 }}>One case per restriction. Track the owner email, QR recovery, ID verification, appeal form and LinkedIn&apos;s answer — with the next step worked out for you.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
        {tiles.map(([key, label, n, sub, dot]) => {
          const on = filter === key;
          return (
            <button key={key} onClick={() => setFilter(key)} style={{ textAlign: "left", cursor: "pointer", background: on ? "#fff" : "#f8f9fb", border: `1.5px solid ${on ? "#0b1220" : "#e3e6ec"}`, borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, font: `700 11px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: "#5b6779", whiteSpace: "nowrap" }}><span style={{ flex: "none", width: 8, height: 8, borderRadius: "50%", background: dot }} />{label}</span>
              <span style={{ font: `700 26px ${F_GRO}`, color: "#0b1220" }}>{n}</span>
              <span style={{ font: `600 12px ${F_SANS}`, color: "#5b6779", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>
            </button>
          );
        })}
      </div>

      <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 14, padding: "12px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", background: "#eef0f4", borderRadius: 10, padding: 3, gap: 2, flexWrap: "wrap" }}>
          {segs.map(([k, l]) => { const on = filter === k; return <button key={k} onClick={() => setFilter(k)} style={{ border: "none", background: on ? "#fff" : "transparent", color: on ? "#0b1220" : "#5b6779", boxShadow: on ? "0 1px 2px rgba(11,18,32,.12)" : "none", borderRadius: 8, padding: "6px 12px", font: `700 12.5px ${F_SANS}`, cursor: "pointer", whiteSpace: "nowrap" }}>{l}</button>; })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>Phase</span>
          {phaseOpts.map((p) => { const on = phaseF === p.key; return (
            <button key={p.key} onClick={() => setPhaseF(p.key)} style={{ display: "flex", alignItems: "center", gap: 6, border: `1.5px solid ${on ? "#0b1220" : "#e3e6ec"}`, background: on ? "#fff" : "#f8f9fb", color: "#0b1220", borderRadius: 999, padding: "5px 11px", font: `700 12px ${F_SANS}`, cursor: "pointer", whiteSpace: "nowrap" }}>
              {p.pr && <span style={{ font: `700 10px ${MONO}`, color: p.pr === "P1" ? "#b91c1c" : p.pr === "P2" ? "#b45309" : "#8a93a3" }}>{p.pr}</span>}{p.label}<span style={{ font: `700 11px ${F_GRO}`, color: "#5b6779" }}>{p.n}</span>
            </button>
          ); })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>LV PoC</span>
          {pocChips.map((pc) => { const on = pocF === pc.key; const color = pc.key === "all" ? "#0b1220" : pc.key === "none" ? "#cbd2dc" : colorOf(pc.key); const ini = pc.key === "all" ? "★" : pc.key === "none" ? "–" : iniOf(pc.label); return (
            <button key={pc.key} onClick={() => setPocF(pc.key)} style={{ display: "flex", alignItems: "center", gap: 6, border: `1.5px solid ${on ? "#2563eb" : "#e3e6ec"}`, background: on ? "#eef4ff" : "#fff", color: "#0b1220", borderRadius: 999, padding: "3px 10px 3px 3px", font: `700 12px ${F_SANS}`, cursor: "pointer", whiteSpace: "nowrap" }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: color, color: "#fff", font: `700 10px ${F_SANS}`, display: "grid", placeItems: "center" }}>{ini}</span>{pc.label}<span style={{ font: `700 11px ${F_GRO}`, color: "#5b6779" }}>{pc.n}</span>
            </button>
          ); })}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, login email, renter, PoC or error…" style={{ flex: 1, minWidth: 240, border: "1px solid #dde1e8", background: "#f8f9fb", borderRadius: 10, padding: "9px 12px", font: `500 13.5px ${F_SANS}`, color: "#0b1220", outline: "none" }} />
      </div>

      {error && <div style={{ font: `500 13px ${F_SANS}`, color: "#b91c1c" }}>{error}</div>}
      {!rows && !error && <div style={{ font: `500 13px ${F_SANS}`, color: "#8a93a3" }}>Loading…</div>}

      {rows && (
        <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 14, overflowX: "auto" }}>
          <div style={{ minWidth: 1210 }}>
            <div style={{ display: "grid", gridTemplateColumns: colTpl, gap: 14, padding: "11px 18px", borderBottom: "1px solid #eef0f4", font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3" }}>
              <span>Account</span><span>Restricted for</span>
              <span onClick={() => setTouchSort(touchDir === "asc" ? "desc" : "asc")} title="Most recent activity by the team. Click to flip; open tabs show stalest first." style={{ cursor: "pointer", color: touchSort || openTab ? "#334155" : "#8a93a3", userSelect: "none" }}>Last touch {touchDir === "asc" ? "▲" : touchDir === "desc" ? "▼" : "⇅"}</span>
              <span>Times</span><span>Reason</span><span>Email · ID · Form · LinkedIn</span><span>Next step</span><span></span>
            </div>
            {!list.length && <div style={{ padding: "28px 18px", font: `500 13.5px ${F_SANS}`, color: "#8a93a3" }}>Nothing here.</div>}
            {list.map((r) => {
              const isOpen = !!open[r.id];
              const st = ST[r.status] || [r.status, "#f1f5f9", "#475569"];
              const days = r.restrictedMs / 86400e3;
              return (
                <div key={r.id}>
                  <div onClick={() => setOpen((o) => ({ ...o, [r.id]: !isOpen }))} style={{ display: "grid", gridTemplateColumns: colTpl, gap: 14, alignItems: "center", padding: "12px 18px", borderBottom: "1px solid #eef0f4", boxShadow: `inset 3px 0 0 ${r.urgent ? "#dc2626" : "transparent"}`, background: isOpen ? "#fafbfc" : "#fff", cursor: "pointer" }}>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <span style={{ font: `700 14px ${F_SANS}`, color: "#0b1220", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}{r.verified && <span title="Verified" style={{ marginLeft: 5, color: "#0f7a3d" }}>✓</span>}</span>
                        {r.linkedinUrl && <a href={r.linkedinUrl.startsWith("http") ? r.linkedinUrl : `https://${r.linkedinUrl}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open LinkedIn profile" style={{ flex: "none", width: 16, height: 16, borderRadius: 3, background: "#0a66c2", color: "#fff", font: `800 9.5px ${F_SANS}`, display: "grid", placeItems: "center", textDecoration: "none" }}>in</a>}
                      </span>
                      <span style={{ font: `500 11.5px ${F_SANS}`, color: "#8a93a3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.email}</span>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                        <span title={r.poc ? `PoC: ${r.poc}` : "No PoC assigned"} style={{ display: "flex", alignItems: "center", gap: 5, font: `700 10.5px ${F_SANS}`, color: r.poc ? "#334155" : "#b91c1c", whiteSpace: "nowrap" }}>
                          <span style={{ width: 16, height: 16, borderRadius: "50%", background: r.poc ? colorOf(r.poc) : "#cbd2dc", color: "#fff", font: `700 8px ${F_SANS}`, display: "grid", placeItems: "center" }}>{r.poc ? iniOf(r.poc) : "–"}</span>
                          {r.poc || "No PoC"}
                        </span>
                        <span style={{ font: `700 10.5px ${F_SANS}`, padding: "2px 8px", borderRadius: 999, background: st[1], color: st[2], whiteSpace: "nowrap" }}>P{r.phase.pr} · {st[0]}</span>
                        {r.lostOutcome && <span style={{ font: `700 10.5px ${F_SANS}`, padding: "2px 8px", borderRadius: 999, background: LOST[r.lostOutcome][1], color: LOST[r.lostOutcome][2], whiteSpace: "nowrap" }}>{LOST[r.lostOutcome][0]}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ font: `700 15px ${F_GRO}`, color: r.resolvedAt || r.lostOutcome ? "#5b6779" : days > 7 ? "#b91c1c" : days > 2 ? "#b45309" : "#0b1220" }}>{dur(r.restrictedMs)}</span>
                      <span style={{ font: `500 11px ${F_SANS}`, color: "#8a93a3", whiteSpace: "nowrap" }}>{r.resolvedAt ? "restored " + fmt(new Date(r.resolvedAt).toISOString()).split(",")[0] : r.lostOutcome && r.closedAt ? "closed " + fmt(new Date(r.closedAt).toISOString()).split(",")[0] : "since " + fmt(r.restrictedAt).split(",")[0]}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      {(() => {
                        const lt = r.lastTouchAt;
                        if (!lt) return <span style={{ font: `700 12px ${F_SANS}`, color: "#b91c1c", whiteSpace: "nowrap" }}>never touched</span>;
                        const td = (now - lt) / 86400e3;
                        return (<>
                          <span style={{ font: `700 13px ${F_GRO}`, color: td > 7 ? "#b91c1c" : td > 3 ? "#b45309" : "#334155", whiteSpace: "nowrap" }}>{rel(new Date(lt).toISOString(), now)}</span>
                          <span style={{ font: `500 11px ${F_SANS}`, color: "#8a93a3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.lastTouchLabel}</span>
                        </>);
                      })()}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ font: `700 15px ${F_GRO}`, color: r.cnt >= 3 ? "#c2410c" : "#0b1220" }}>{r.cnt}×</span>
                    </div>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ font: `600 13px ${F_SANS}`, color: "#0b1220" }}>{r.reason}</span>
                      <span style={{ font: `500 11px ${MONO}`, color: r.lastErr ? "#b91c1c" : "#b4bccb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.lastErr || "—"}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4 }}>
                      {r.chain.map((c, i) => (
                        <div key={i} title={c.tip} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                          <div style={{ height: 5, borderRadius: 999, background: OC[c.outcome][0] }} />
                          <span style={{ font: `700 10.5px ${F_SANS}`, color: OC[c.outcome][2], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ font: `700 12.5px ${F_SANS}`, color: r.lostOutcome ? LOST[r.lostOutcome][2] : r.urgent ? "#b91c1c" : r.resolvedAt ? "#0f7a3d" : "#334155" }}>{r.next}</span>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {r.flags.map((f, i) => <span key={i} style={{ font: `700 10.5px ${F_SANS}`, padding: "2px 8px", borderRadius: 999, background: FLAG[f.kind][0], color: FLAG[f.kind][1], whiteSpace: "nowrap" }}>{f.label}</span>)}
                      </div>
                    </div>
                    <span style={{ font: `700 12px ${F_SANS}`, color: "#9aa3b2" }}>{isOpen ? "▾" : "▸"}</span>
                  </div>
                  {isOpen && <CaseDetail r={r} reload={reload} now={now} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
