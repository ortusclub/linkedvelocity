"use client";

import { useState } from "react";
import styles from "./wizard.module.css";

export type EmailSetup = {
  previouslyVerifiedEmail?: string | null;
  configured: boolean; domains: string[]; address: string | null; destination: string | null;
  destinationVerified: boolean; verificationCodePending: boolean; primaryConfirmed: boolean; forwardingActive: boolean;
  forwardingUntil: string | null; lastForwardedAt: string | null; primaryConfirmedAt: string | null;
  confirmUrl: string | null;
  latestCode: string | null; latestCodeAt: string | null;
};

export default function EmailStep({ setup, busy, submit, refresh, selfMode = false, demo = false }: {
  selfMode?: boolean;
  demo?: boolean;
  setup: EmailSetup; busy: boolean; submit: (body: unknown) => Promise<void>; refresh: () => Promise<void>;
}) {
  const [destination, setDestination] = useState(setup.destination || (selfMode ? setup.previouslyVerifiedEmail : "") || "");
  const [editingInbox, setEditingInbox] = useState(false);
  const previouslyVerified = !!(selfMode && setup.previouslyVerifiedEmail && destination.trim().toLowerCase() === setup.previouslyVerifiedEmail.toLowerCase());
  const [consent, setConsent] = useState(demo);
  const [code, setCode] = useState("");
  const [linkConfirmed, setLinkConfirmed] = useState(demo);
  const [primary, setPrimary] = useState(demo);
  const [copied, setCopied] = useState(false);
  const [confirmCopied, setConfirmCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  function copyAddress() {
    if (!setup.address) return;
    navigator.clipboard?.writeText(setup.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  function copyConfirm() {
    if (!setup.confirmUrl) return;
    navigator.clipboard?.writeText(setup.confirmUrl);
    setConfirmCopied(true);
    setTimeout(() => setConfirmCopied(false), 1800);
  }

  async function restart() {
    await submit({ action: "restart", consent: true });
    setCode(""); setConsent(demo); setLinkConfirmed(demo); setPrimary(demo); setEditingInbox(false);
  }

  // Ready-to-send message the referrer copies and sends to the account owner so they
  // can add the LinkedVelocity email themselves. The email is filled in for them.
  const [copiedSteps, setCopiedSteps] = useState(false);
  const addEmailMessage = `Here's how to add our work email to your LinkedIn:

1. Log in to LinkedIn on your normal device.
2. Click your photo (Me) at the top right, then Settings & Privacy.
3. Go to Sign in & security, then Email addresses.
4. Click Add email address.
5. Enter: ${setup.address || "(the email we'll share in a moment)"}
6. Enter your current password when prompted, then click Send verification.
${selfMode ? "7. Return to this wizard, open LinkedIn’s verification link on your signed-in device, and confirm the new email is verified." : "7. That’s it on your end. Let us know once you’ve added it, and we’ll click the verification link from our side to confirm it."}
8. Once it shows as verified, please set it as your primary email, and we'll take it from there.`;
  function copySteps() {
    navigator.clipboard?.writeText(addEmailMessage);
    setCopiedSteps(true);
    setTimeout(() => setCopiedSteps(false), 1800);
  }

  // Vertical-stepper primitives (match the 2FA step's look).
  const started = setup.forwardingActive; // step 1 complete: inbox verified + forwarding live + LV address provisioned
  // LinkedIn's verification message actually reached our forwarding (a code or a confirm link).
  // Until it does, the referrer can't truthfully tick "verified"/"primary" — and the server
  // rejects the primary step anyway — so we gate those checkboxes on it rather than letting the
  // referrer pre-tick and then face a silently-locked Continue button.
  const linkReceived = demo || !!(setup.lastForwardedAt || setup.confirmUrl);
  const dot = (label: string, state: "done" | "active" | "locked") => <span style={{ width: 26, height: 26, flex: "none", borderRadius: "50%", background: state === "done" ? "#16a34a" : state === "active" ? "#0b1220" : "#c5cbd3", color: "#fff", font: "700 12.5px 'Space Grotesk', system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>{label}</span>;
  const line = () => <span style={{ flex: 1, width: 2, background: "#e3e6ea", margin: "4px 0" }} />;
  const txt = { font: "600 14.5px/1.45 'Plus Jakarta Sans', system-ui, sans-serif", color: "#0b1220" } as const;
  const sub = { font: "500 12.5px/1.45 'Plus Jakarta Sans', system-ui, sans-serif", color: "#5b6779" } as const;
  const colL = { display: "flex", flexDirection: "column", alignItems: "center" } as const;

  return <>
    <h2>{selfMode ? "Set up your LinkedIn email" : "Set up their LinkedIn email"}</h2>
    <p>{selfMode ? "Add and verify the email on your own phone or laptop where you’re already signed into LinkedIn." : "The owner does this on their own phone or laptop. You guide them."} The protected GoLogin browser comes later for the final sign-in.</p>

    <div className={styles.why} data-tour="email-why">
      <strong>LinkedIn emails a code to confirm the new address</strong>
      <p>It goes to an inbox of your choice — {selfMode ? "one you can open now" : "yours or the owner’s"} — for up to an hour.</p>
    </div>

    {!setup.configured ? <div className={styles.note}>Email receiving is not live yet. Your progress is saved; the team must finish configuring and testing the domains before this step can continue.</div> : <>
      <div style={{ display: "flex", flexDirection: "column" }}>

        {/* STEP 1 — pick inbox + send/verify code */}
        <div style={{ display: "flex", gap: 12 }} data-tour="email-inbox">
          <div style={colL}>{dot(started ? "✓" : "1", started ? "done" : "active")}{line()}</div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10, padding: "2px 0 18px" }}>
            <div style={txt}>Pick an inbox for the code <span style={{ fontWeight: 500, color: "#8a93a3" }}>— {selfMode ? "yours" : "yours or the owner’s"}</span></div>
            {started ? (
              <div className={styles.note} style={{ margin: 0 }}>✓ Inbox verified. LinkedIn’s messages forward to <strong>{setup.destination}</strong>.</div>
            ) : (setup.destinationVerified && !setup.forwardingActive) ? <>
              <div className={styles.note} style={{ margin: 0 }}>The previous forwarding window expired. Start again to choose the receiving inbox and get a different LinkedVelocity email.</div>
              <button className={styles.primary} disabled={busy} onClick={() => void restart()}>Start this email step again →</button>
            </> : <>
              <form onSubmit={e => { e.preventDefault(); void submit({ action: "start", destination, consent }); }} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(!previouslyVerified || editingInbox) && <input type="email" required maxLength={254} value={destination} onChange={e => { setDestination(e.target.value); setCode(""); }} placeholder="name@gmail.com" style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #d9dde3", borderRadius: 12, padding: 13, font: "600 15px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#0b1220", outline: "none", background: "#fff" }} />}
                {previouslyVerified && !editingInbox && <div className={styles.note} style={{ margin: 0 }}>We’ll use <strong>{destination}</strong> — already verified. <button type="button" className={styles.linkBtn} disabled={busy} onClick={() => setEditingInbox(true)}>Change email</button></div>}
                <label className={styles.check} style={{ margin: 0 }}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>{selfMode ? "I agree" : "The owner agrees"} to add a LinkedVelocity primary email and have LinkedIn’s messages forwarded here for one hour.</span></label>
                <button className={styles.primary} disabled={busy || !consent}>{previouslyVerified ? "Continue with this email →" : setup.verificationCodePending ? "Send another six-digit code" : "Send six-digit code →"}</button>
              </form>
              {setup.verificationCodePending && !previouslyVerified && <form onSubmit={e => { e.preventDefault(); void submit({ action: "verify", code }); }} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 2 }}>
                <label className={styles.field} style={{ margin: 0 }}>Enter the six-digit code sent to {setup.destination}<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} /></label>
                <button className={styles.primary} disabled={busy || code.length !== 6}>Verify inbox and continue →</button>
              </form>}
            </>}
          </div>
        </div>

        {/* STEP 2 — add the LV email in LinkedIn */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={colL}>{dot("2", started ? "active" : "locked")}{line()}</div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, padding: "2px 0 18px", opacity: started ? 1 : .55 }}>
            <div style={txt}>In LinkedIn, add our email</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f8f9fb", border: "1px solid #eceef2", borderRadius: 10, padding: "10px 12px" }}>
              <span style={{ flex: 1, minWidth: 0, font: "600 13.5px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#0b1220", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{setup.address || "…"}</span>
              <button type="button" disabled={!setup.address} onClick={copyAddress} style={{ flex: "none", border: "none", background: "#e5e7eb", borderRadius: 8, padding: "6px 10px", font: "700 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#0b1220", cursor: "pointer", whiteSpace: "nowrap" }}>{copied ? "✓ Copied" : "Copy"}</button>
            </div>
            <div style={{ font: "500 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#8a93a3" }}>Settings → Sign in &amp; security → Email addresses → Add email</div>
            {!selfMode && <button type="button" className={styles.linkBtn} style={{ alignSelf: "flex-start" }} disabled={busy} onClick={copySteps}>{copiedSteps ? "Steps copied ✓" : "Copy full steps to send the owner"}</button>}
          </div>
        </div>

        {/* STEP 3 — confirm the verification link */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={colL}>{dot(linkConfirmed ? "✓" : "3", linkConfirmed ? "done" : started ? "active" : "locked")}{line()}</div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, padding: "2px 0 18px", opacity: started ? 1 : .55 }}>
            <div style={txt}>Open LinkedIn’s confirmation link</div>
            <div style={sub}>Open it <strong style={{ color: "#0b1220" }}>on the device where {selfMode ? "you’re" : "the owner is"} logged into LinkedIn</strong>.</div>
            {setup.confirmUrl ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <a href={setup.confirmUrl} target="_blank" rel="noopener noreferrer" style={{ borderRadius: 10, padding: 10, font: "700 13px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#fff", background: "#16a34a", cursor: "pointer", textAlign: "center", textDecoration: "none", whiteSpace: "nowrap" }}>Open link ↗</a>
                <button type="button" onClick={copyConfirm} style={{ border: "1px solid #dde1e8", borderRadius: 10, padding: 10, font: "700 13px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#0b1220", background: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}>{confirmCopied ? "✓ Copied" : (selfMode ? "Copy link" : "Copy for owner")}</button>
              </div>
            ) : (
              <>
                <div className={styles.note} style={{ margin: 0 }}>{setup.lastForwardedAt ? <>LinkedIn’s verification message was forwarded to <strong>{setup.destination}</strong>. Open its link, then tick below.</> : <>Waiting for LinkedIn’s confirmation. Once {selfMode ? "you add" : "the owner adds"} the email it usually arrives in a moment.</>}</div>
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => void refresh()}>{busy ? "Checking…" : "Check for LinkedIn’s link"}</button>
              </>
            )}
            <label className={styles.check} style={{ margin: "2px 0 0", ...(linkReceived ? {} : { opacity: .5, cursor: "not-allowed" }) }}><input type="checkbox" checked={linkConfirmed && linkReceived} disabled={!linkReceived} onChange={e => setLinkConfirmed(e.target.checked)} /><span>It now shows as <strong>verified</strong> on LinkedIn.</span></label>
            {!linkReceived && <div style={{ font: "500 11.5px/1.45 'Plus Jakarta Sans', system-ui, sans-serif", color: "#8a93a3" }}>You can tick this once LinkedIn’s confirmation reaches us — finish verifying on LinkedIn, then tap <strong>Check for LinkedIn’s link</strong> above.</div>}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setShowCode(v => !v)} style={{ border: "none", background: "none", padding: 0, font: "600 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#15803d", cursor: "pointer" }}>{showCode ? "Hide code" : "LinkedIn asking for a code instead?"}</button>
              <button type="button" onClick={() => void restart()} disabled={busy} style={{ border: "none", background: "none", padding: 0, font: "600 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#8a93a3", cursor: "pointer", textDecoration: "underline" }}>Use a different email</button>
            </div>
            {showCode && <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
              {setup.latestCode ? <>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ font: "700 22px 'Space Grotesk', system-ui, sans-serif", letterSpacing: ".14em", color: "#0b1220" }}>{setup.latestCode}</span>
                  <button type="button" onClick={() => { if (setup.latestCode) { navigator.clipboard?.writeText(setup.latestCode); setCopiedCode(true); setTimeout(() => setCopiedCode(false), 1400); } }} style={{ border: "none", background: "#dcfce7", borderRadius: 8, padding: "5px 10px", font: "700 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#166534", cursor: "pointer", whiteSpace: "nowrap" }}>{copiedCode ? "✓ Copied" : "Copy"}</button>
                  <button type="button" onClick={() => void refresh()} disabled={busy} style={{ marginLeft: "auto", border: "none", background: "none", padding: 0, font: "700 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#15803d", cursor: "pointer" }}>↻ Refresh</button>
                </div>
                <div style={{ font: "500 11.5px/1.45 'Plus Jakarta Sans', system-ui, sans-serif", color: "#166534" }}>Latest code LinkedIn sent to our email. Expired? Tap resend on LinkedIn, then Refresh.</div>
              </> : <div style={{ font: "500 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#166534", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}><span>No code yet — tap resend on LinkedIn.</span><button type="button" onClick={() => void refresh()} disabled={busy} style={{ flex: "none", border: "none", background: "none", padding: 0, font: "700 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#15803d", cursor: "pointer" }}>↻ Refresh</button></div>}
            </div>}
          </div>
        </div>

        {/* STEP 4 — make it primary */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={colL}>{dot("4", linkConfirmed ? "active" : "locked")}</div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6, padding: "2px 0 0", opacity: linkConfirmed ? 1 : .55 }}>
            <div style={txt}>Make our email <strong>primary</strong></div>
            <div style={sub}>Back in LinkedIn’s Email addresses, tap <span style={{ display: "inline-block", font: "700 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#3b4556", background: "#eef0f4", borderRadius: 999, padding: "1px 9px" }}>Make primary</span> next to our email.</div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "9px 11px", font: "500 12.5px/1.45 'Plus Jakarta Sans', system-ui, sans-serif", color: "#9a3412" }}><b style={{ flex: "none" }}>!</b><span><b>Added isn’t enough</b> — if it’s not primary, we can’t sign in.</span></div>
            <label className={styles.check} style={{ margin: "2px 0 0", ...(linkConfirmed ? {} : { opacity: .5, cursor: "not-allowed" }) }}><input type="checkbox" checked={primary && linkConfirmed} disabled={!linkConfirmed} onChange={e => setPrimary(e.target.checked)} /><span>It shows as <strong>primary</strong> on LinkedIn, and {selfMode ? "I agree" : "the owner agrees"}.</span></label>
            <a href="https://linkedvelocity.com/account-guide-v2" target="_blank" rel="noreferrer" style={{ font: "600 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#15803d", textDecoration: "none" }}>See it with screenshots ↗</a>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
        <button className={styles.primary} disabled={busy || !linkReceived || !linkConfirmed || !primary} onClick={() => void submit({ action: "primary", consent: true })}>{primary && linkConfirmed ? "Email is primary — continue to sign-in →" : "Continue to sign-in →"}</button>
        <p className={styles.hint} style={{ textAlign: "center" }}>Only change the primary email with the {selfMode ? "" : "owner’s "}OK. Unsure? Pause and message us.</p>
      </div>
    </>}
  </>;
}
