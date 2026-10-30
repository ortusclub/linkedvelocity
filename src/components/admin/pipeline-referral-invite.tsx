"use client";
import { useRef, useState } from "react";
import { contactLink, type IssueContact } from "@/lib/issue-contacts";
import { referralInviteMessage, type InviteRecipient } from "@/lib/referral-invite-message";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";

// Shown on onboarded + paid pipeline rows: invite the ambassador to become a referrer
// (opt-in — no portal yet) and re-engage the referrer who brought them in (live portal link).
export function PipelineReferralInvite({ id, ambassadorName, referrerName, ambassador, referrer, referrerToken, ambassadorPortalToken, ambassadorReferrerSlug, onSent }: {
  id: string; ambassadorName: string; referrerName: string | null;
  ambassador: IssueContact; referrer: IssueContact | null; referrerToken: string | null;
  ambassadorPortalToken?: string | null; ambassadorReferrerSlug?: string | null; onSent: () => void;
}) {
  const portalUrl = referrerToken ? `${APP_URL}/m/${referrerToken}` : null;
  // Set only when this ambassador is already a referrer too — then we link their own portal
  // instead of the self-signup link.
  const ambassadorPortalUrl = ambassadorPortalToken ? `${APP_URL}/m/${ambassadorPortalToken}` : null;
  // Self-signup link for an ambassador who isn't a referrer yet — name prefilled so the
  // /become-a-referrer form is one step less. Deliberately no email in the URL (it would
  // land in logs / history / referrer headers); they type that on the form.
  const signupQuery = ambassadorName?.trim()
    ? `?${new URLSearchParams({ name: ambassadorName.trim() }).toString()}`
    : "";
  const signupUrl = `${APP_URL}/become-a-referrer${signupQuery}`;
  const [preview, setPreview] = useState<{ recipient: InviteRecipient; channel: keyof IssueContact; subject: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false), [result, setResult] = useState("");
  const request = useRef({ signature: "", id: "" });
  const button = { border: "1px solid var(--line,#d6e4fb)", borderRadius: 8, padding: "8px 12px", background: "var(--card,#fff)", color: "var(--link,#0a66c2)", cursor: "pointer", fontSize: 12 };

  const build = (recipient: InviteRecipient, channel: keyof IssueContact) => {
    const name = recipient === "ambassador" ? ambassadorName : (referrerName || "");
    return referralInviteMessage(recipient, channel === "email" ? "email" : "chat", name, recipient === "referrer" ? portalUrl : ambassadorPortalUrl, recipient === "ambassador" ? signupUrl : null);
  };

  return <div style={{ display: "grid", gap: 10 }}>
    <small style={{ color: "var(--muted,#647189)" }}>₱500 per referral · up to ₱1,000 if they onboard it themselves.</small>
    {([
      { key: "ambassador" as InviteRecipient, name: ambassadorName, role: ambassadorPortalUrl
        ? <>Ambassador · already a referrer{ambassadorReferrerSlug && <> · <a href={`/admin/referrals?ref=${encodeURIComponent(ambassadorReferrerSlug)}`} style={{ color: "var(--link,#0a66c2)", textDecoration: "none" }}>{ambassadorReferrerSlug} →</a></>}</>
        : "Ambassador · invite to refer", contact: ambassador },
      ...(referrer ? [{ key: "referrer" as InviteRecipient, name: referrerName || "Referrer", role: "Referrer · nudge for more", contact: referrer }] : []),
    ]).map(row => {
      const valid = (["email", "whatsapp", "telegram", "viber"] as const).filter(ch => !!contactLink(ch, row.contact?.[ch], ""));
      return <div key={row.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "var(--inset,#f7f8fa)", border: "1px solid var(--card-border,#e7ebf0)", borderRadius: 10, padding: "10px 12px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--fg,#111)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name || "—"}</div>
          <div style={{ fontWeight: 500, fontSize: 11.5, color: "var(--muted,#8a97ad)", marginTop: 1 }}>{row.role}</div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {valid.length ? valid.map(ch => <button key={ch} style={button} disabled={busy} title="Review the message before sending" onClick={() => { setResult(""); setPreview({ recipient: row.key, channel: ch, ...build(row.key, ch) }); }}>{({ email: "Email", whatsapp: "WhatsApp", telegram: "Telegram", viber: "Viber" } as Record<string, string>)[ch]}</button>)
            : <span style={{ fontSize: 11, color: "var(--muted2,#9aa0a6)" }}>no contact saved</span>}
        </div>
      </div>;
    })}
    {preview && <div role="dialog" aria-label="Review referral invite message" style={{ border: "1px solid var(--line,#d6e4fb)", borderRadius: 12, padding: 16, display: "grid", gap: 10 }}>
      <b>Review message to {preview.recipient}</b><span>To: {(preview.recipient === "ambassador" ? ambassador : referrer)?.[preview.channel]}</span>
      {preview.channel === "email" && <input aria-label="Email subject" style={button} value={preview.subject} onChange={e => setPreview({ ...preview, subject: e.target.value })} />}
      <textarea aria-label="Invite message" style={{ ...button, color: "var(--fg,#111)", width: "100%", boxSizing: "border-box" }} rows={10} value={preview.text} onChange={e => setPreview({ ...preview, text: e.target.value })} />
      {preview.channel !== "email" && <small>Opens the chat for you to review and send. Viber copies the message so you can paste it.</small>}
      <div style={{ display: "flex", gap: 8 }}><button style={button} disabled={busy} onClick={() => setPreview(null)}>Cancel</button><button style={button} disabled={busy || !preview.text.trim() || (preview.channel === "email" && !preview.subject.trim())} onClick={async () => {
        setBusy(true); setResult("");
        try {
          const signature = JSON.stringify(preview);
          if (signature !== request.current.signature) request.current = { signature, id: crypto.randomUUID() };
          if (preview.channel === "email") {
            const response = await fetch(`/api/admin/ambassadors/${id}/referral-invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: preview.recipient, channel: "email", subject: preview.subject, text: preview.text, requestId: request.current.id }) });
            const data = await response.json(); if (!response.ok) throw new Error(data.error);
            setResult(`Email sent to ${data.to}.`); onSent();
          } else {
            const href = contactLink(preview.channel, (preview.recipient === "ambassador" ? ambassador : referrer)?.[preview.channel], preview.text);
            if (preview.channel === "viber") await navigator.clipboard.writeText(preview.text);
            if (href) window.open(href, "_blank", "noopener,noreferrer");
            // Log that we invited them on this channel so the "not yet invited" flag clears.
            try {
              await fetch(`/api/admin/ambassadors/${id}/referral-invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: preview.recipient, channel: preview.channel, text: preview.text, requestId: request.current.id }) });
              onSent();
            } catch { /* the chat still opened; the flag just won't clear */ }
            setResult(`Opened ${preview.channel} — logged as sent.`);
          }
          setPreview(null);
        } catch (e) { setResult(e instanceof Error ? e.message : "Could not prepare the message."); } finally { setBusy(false); }
      }}>{busy ? "Sending…" : preview.channel === "email" ? "Send email" : preview.channel === "viber" ? "Copy message & open Viber" : "Open chat"}</button></div>
    </div>}
    {result && <p role="status">{result}</p>}
  </div>;
}
