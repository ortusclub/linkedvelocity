"use client";
import { useState } from "react";
import styles from "./wizard.module.css";
import type { OnboardingEta } from "@/lib/onboarding-eta";

// Phone hand-off: the referrer can't run GoLogin (desktop-only), so they give us a
// temporary password and we do the sign-in on our side. The 2FA key was captured in the
// dedicated two-step-verification step before this, so it's sent along by the wizard.
export default function PhoneHandoff({ busy, error, submit, selfMode = false, demo = false, eta }: {
  selfMode?: boolean;
  demo?: boolean;
  busy: boolean;
  error?: string;
  submit: (password: string) => Promise<void>;
  eta?: OnboardingEta;
}) {
  const [password, setPassword] = useState(demo ? "LinkedVel2026!" : "");
  const [agree, setAgree] = useState(demo);
  const [showPw, setShowPw] = useState(false);
  const pwSet = password.trim().length >= 6;
  const ready = pwSet && agree;

  const dot = (label: string, state: "done" | "active" | "locked") => <span style={{ width: 26, height: 26, flex: "none", borderRadius: "50%", background: state === "done" ? "#16a34a" : state === "active" ? "#0b1220" : "#c5cbd3", color: "#fff", font: "700 12.5px 'Space Grotesk', system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>{label}</span>;
  const line = () => <span style={{ flex: 1, width: 2, background: "#e3e6ea", margin: "4px 0" }} />;
  const colL = { display: "flex", flexDirection: "column", alignItems: "center" } as const;
  const txt = { font: "600 14.5px/1.45 'Plus Jakarta Sans', system-ui, sans-serif", color: "#0b1220" } as const;
  const sub = { font: "500 12.5px/1.45 'Plus Jakarta Sans', system-ui, sans-serif", color: "#5b6779" } as const;
  const chip = (label: string, kind: "done" | "todo") => <span style={{ font: "700 11px 'Plus Jakarta Sans', system-ui, sans-serif", padding: "4px 9px", borderRadius: 999, background: kind === "done" ? "#dcfce7" : "#fef3c7", color: kind === "done" ? "#15803d" : "#b45309" }}>{label}</span>;

  return <>
    <div className={styles.stepLabel}>Hand off</div>
    <h1 className={styles.heroTitle}>Hand off to our team</h1>
    <p>No computer needed. We do the sign-in, the checks and the payment.</p>
    {error && <div className={styles.error} role="alert">{error}</div>}

    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "2px 0 6px" }}>
      {chip("✓ Email is ours", "done")}
      {chip("✓ 2FA set", "done")}
      {pwSet ? chip("✓ Password set", "done") : chip("Password needed", "todo")}
    </div>

    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={colL}>{dot(pwSet ? "✓" : "1", pwSet ? "done" : "active")}{line()}</div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, padding: "2px 0 18px" }}>
          <div style={txt}>{selfMode ? "Set a temporary password" : "Owner sets a temporary password"}</div>
          <div style={sub}>{selfMode ? "On your phone" : "On their phone"}: <strong style={{ color: "#0b1220" }}>Settings → Sign in &amp; security → Change password</strong>. {selfMode ? "You" : "They"} can change it back after setup.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1.5px solid #d9dde3", borderRadius: 12, padding: "0 6px 0 13px", background: "#fff" }}>
            <input type={showPw ? "text" : "password"} autoComplete="off" required minLength={6} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="e.g. LinkedVel2026!" style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", font: "600 15px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#0b1220", padding: "13px 0" }} />
            <button type="button" onClick={() => setShowPw(v => !v)} style={{ flex: "none", border: "none", background: "none", font: "700 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#15803d", cursor: "pointer", padding: "6px 8px" }}>{showPw ? "Hide" : "Show"}</button>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={colL}>{dot("2", pwSet ? "active" : "locked")}</div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, padding: "2px 0 0", opacity: pwSet ? 1 : .55 }}>
          <div style={txt}>Get the owner&apos;s OK</div>
          <label className={styles.check} style={{ margin: 0 }}><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>{selfMode ? "I agree to share this so LinkedVelocity can sign in. I keep full access and can reset it anytime." : "The owner agrees to share this so we can sign in. They keep full access and can reset it anytime."}</span></label>
        </div>
      </div>
    </div>

    <button className={styles.primary} style={{ marginTop: 18 }} disabled={busy || !ready} onClick={() => void submit(password.trim())}>{busy ? "Handing off…" : "Hand off to the team →"}</button>
    <p className={styles.hint} style={{ textAlign: "center" }}>We&apos;ll sign in {eta ? `in about ${eta.wait}${eta.busy ? " — we're busier than usual right now" : ""}` : "within 24 hours"}. Only ever share this with LinkedVelocity.</p>
  </>;
}
