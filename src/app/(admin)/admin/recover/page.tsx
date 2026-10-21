"use client";

import { useEffect, useRef, useState } from "react";

const F_SANS = "var(--font-sans),system-ui,sans-serif";
const F_GRO = "var(--font-grotesk),system-ui,sans-serif";

type Acct = { id: string; linkedinName: string; status: string; loginEmail: string | null; linkedinVerified: boolean; restrictedAt: string; recoveryQrUrl: string | null; recoveryQrAt: string | null; recoverySentAt: string | null; recoverySentVia: string | null; recoveryOutcome: string | null; recoveryOutcomeAt: string | null };

const daysAgo = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const ago = (iso: string) => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
const VIA_LABEL: Record<string, string> = { copy: "copied link", whatsapp: "WhatsApp", telegram: "Telegram", viber: "Viber", email: "Email", link: "link" };
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

function ownerMessage(name: string, link: string) {
  const who = name ? name.split(/\s+/)[0] : "there";
  return `Hi ${who}, your LinkedIn account needs a quick identity check to get back online. Open this on your phone and follow the steps (private link, expires in 24 hours): ${link}`;
}

function SendRow({ name, link, onSent }: { name: string; link: string; onSent: (via: string) => void }) {
  const [copied, setCopied] = useState(false);
  const msg = ownerMessage(name, link);
  const btn = (label: string, href: string, via: string) => (
    <a href={href} target="_blank" rel="noreferrer" onClick={() => onSent(via)} style={{ font: `600 12px ${F_SANS}`, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--card-border)", color: "var(--text)", textDecoration: "none", background: "var(--card)", whiteSpace: "nowrap" }}>{label}</a>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center", marginTop: 8 }}>
      <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ flex: "1 1 220px", minWidth: 180, font: `500 12px ${F_SANS}`, padding: "6px 9px", borderRadius: 8, border: "1px solid var(--card-border)", background: "var(--card)", color: "var(--text)" }} />
      <button onClick={() => { navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); onSent("copy"); }); }} style={{ font: `600 12px ${F_SANS}`, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--card-border)", background: "var(--card)", color: "var(--text)", cursor: "pointer" }}>{copied ? "Copied ✓" : "Copy"}</button>
      {btn("WhatsApp", `https://wa.me/?text=${encodeURIComponent(msg)}`, "whatsapp")}
      {btn("Telegram", `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(ownerMessage(name, "").trim())}`, "telegram")}
      {btn("Viber", `viber://forward?text=${encodeURIComponent(msg)}`, "viber")}
      {btn("Email", `mailto:?subject=${encodeURIComponent("Get your LinkedIn account back online")}&body=${encodeURIComponent(msg)}`, "email")}
    </div>
  );
}

function Card({ a, onChange }: { a: Acct; onChange: (next: Acct) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [link, setLink] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (dataUrl: string) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/admin/accounts/${a.id}/recovery-qr`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload failed.");
      onChange({ ...a, recoveryQrUrl: d.qrUrl, recoveryQrAt: new Date().toISOString() });
      setLink(d.ownerLink);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); } finally { setBusy(false); }
  };
  const onPaste = async (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    const f = item?.getAsFile();
    if (f) { e.preventDefault(); await upload(await fileToDataUrl(f)); }
  };
  const getLink = async () => {
    setBusy(true); setErr("");
    try { const r = await fetch(`/api/admin/accounts/${a.id}/code-link`); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not make a link."); setLink(String(d.url).replace("/c#", "/recover#")); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not make a link."); } finally { setBusy(false); }
  };
  const clearQr = async () => { setBusy(true); try { await fetch(`/api/admin/accounts/${a.id}/recovery-qr`, { method: "DELETE" }); onChange({ ...a, recoveryQrUrl: null, recoveryQrAt: null }); setLink(""); } finally { setBusy(false); } };
  // Optimistic: reflect the send/share immediately, then persist so the card survives a refresh.
  const markSent = (via: string) => {
    onChange({ ...a, recoverySentAt: new Date().toISOString(), recoverySentVia: via });
    fetch(`/api/admin/accounts/${a.id}/recovery-qr`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ via }) }).catch(() => {});
  };

  const chip = (text: string, fg: string, bg: string) => <span style={{ font: `600 11px ${F_SANS}`, color: fg, background: bg, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>{text}</span>;

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 14, padding: 16, boxShadow: "var(--card-shadow)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ font: `700 14px ${F_GRO}`, color: "var(--text)" }}>{a.linkedinName}{a.linkedinVerified && <span title="Verified" style={{ marginLeft: 6, color: "var(--green)", font: `600 11px ${F_SANS}` }}>✓</span>}</div>
        <div style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted)" }}>{a.status} · {daysAgo(a.restrictedAt)}d down · {a.loginEmail || "no login email"}</div>
      </div>

      {(a.recoveryQrUrl || a.recoverySentAt || a.recoveryOutcome) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
          {a.recoverySentAt
            ? chip(`Sent · ${VIA_LABEL[a.recoverySentVia || "link"] || a.recoverySentVia} · ${ago(a.recoverySentAt)}`, "#1D4ED8", "#EAF1FE")
            : a.recoveryQrUrl && chip("Not sent yet", "#92400E", "#FEF3E2")}
          {a.recoveryOutcome === "worked"
            ? chip(`Owner: back in ✓${a.recoveryOutcomeAt ? ` · ${ago(a.recoveryOutcomeAt)}` : ""}`, "#067647", "#ECFDF3")
            : a.recoveryOutcome === "stuck"
              ? chip(`Owner: still stuck${a.recoveryOutcomeAt ? ` · ${ago(a.recoveryOutcomeAt)}` : ""}`, "#B42318", "#FEF3F2")
              : a.recoverySentAt && chip("Awaiting owner", "var(--muted)", "var(--card-border)")}
        </div>
      )}

      <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        {a.recoveryQrUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.recoveryQrUrl} alt="recovery QR" style={{ width: 96, height: 96, objectFit: "contain", borderRadius: 8, border: "1px solid var(--card-border)", background: "#fff" }} />
        ) : (
          <div onPaste={onPaste} tabIndex={0} style={{ width: 160, minHeight: 96, borderRadius: 8, border: "1.5px dashed var(--card-border)", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", font: `500 11.5px ${F_SANS}`, color: "var(--muted)", padding: 8, outline: "none" }}>
            Click here &amp; paste the QR screenshot (⌘V), or use Upload →
          </div>
        )}
        <div style={{ flex: "1 1 240px", minWidth: 220 }}>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) await upload(await fileToDataUrl(f)); e.currentTarget.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ font: `600 12px ${F_SANS}`, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--card-border)", background: "var(--card)", color: "var(--text)", cursor: "pointer" }}>{busy ? "…" : a.recoveryQrUrl ? "Replace QR" : "Upload QR"}</button>
            {a.recoveryQrUrl && <button onClick={getLink} disabled={busy} style={{ font: `600 12px ${F_SANS}`, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--card-border)", background: "var(--card)", color: "var(--text)", cursor: "pointer" }}>Get link to send</button>}
            {a.recoveryQrUrl && <button onClick={clearQr} disabled={busy} style={{ font: `600 12px ${F_SANS}`, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--card-border)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>Clear</button>}
          </div>
          {a.recoveryQrAt && <div style={{ font: `500 11px ${F_SANS}`, color: "var(--muted)", marginTop: 6 }}>QR captured {new Date(a.recoveryQrAt).toLocaleString()}</div>}
          {err && <div style={{ font: `500 11.5px ${F_SANS}`, color: "var(--danger)", marginTop: 6 }}>{err}</div>}
          {link && <SendRow name={a.linkedinName} link={link} onSent={markSent} />}
        </div>
      </div>
    </div>
  );
}

export default function RecoverPage() {
  const [accounts, setAccounts] = useState<Acct[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/admin/recover").then((r) => r.json()).then((d) => (d.error ? setError(d.error) : setAccounts(d.accounts))).catch((e) => setError(String(e)));
  }, []);

  const shown = (accounts || []).filter((a) => !q || a.linkedinName.toLowerCase().includes(q.toLowerCase()) || (a.loginEmail || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ font: `700 22px ${F_GRO}`, color: "var(--text)", margin: 0 }}>Recovery helper</h1>
        <p style={{ font: `500 13px ${F_SANS}`, color: "var(--muted)", margin: "4px 0 0" }}>
          Paste the LinkedIn verification QR from the GoLogin session onto a restricted account, then send the owner a private phone-first link to scan it. No email instructions to parse.
        </p>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or login email…" style={{ font: `500 13px ${F_SANS}`, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--card-border)", background: "var(--card)", color: "var(--text)", maxWidth: 360 }} />
      {error && <div style={{ color: "var(--danger)", font: `500 13px ${F_SANS}` }}>{error}</div>}
      {!accounts && !error && <div style={{ color: "var(--muted)", font: `500 13px ${F_SANS}` }}>Loading…</div>}
      {accounts && shown.length === 0 && <div style={{ color: "var(--muted)", font: `500 13px ${F_SANS}` }}>No restricted accounts{q ? " match" : ""}.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {shown.map((a) => <Card key={a.id} a={a} onChange={(next) => setAccounts((prev) => (prev || []).map((x) => (x.id === a.id ? next : x)))} />)}
      </div>
    </div>
  );
}
