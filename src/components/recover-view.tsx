"use client";
import { useEffect, useState } from "react";
import styles from "@/app/(customer)/guide/primary-email/primary-email.module.css";

const BOOK = "https://calendly.com/linkedvelocity-info/30min";

type Outcome = "worked" | "stuck";
type Info = { name: string; qrUrl: string | null; qrAt: string | null; outcome: Outcome | null };

export default function RecoverView() {
  // Capture the private token synchronously at first render so it survives any child that
  // clears the hash. The link is /recover#<token>.
  const [access] = useState(() => {
    if (typeof window === "undefined") return "";
    const h = window.location.hash.slice(1);
    return /^[A-Za-z0-9_-]{22}$/.test(h) ? h : new URLSearchParams(h).get("access") || "";
  });
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (access && typeof window !== "undefined") window.history.replaceState(null, "", window.location.pathname);
    if (!access) { setLoading(false); return; }
    fetch("/api/account-recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recovery_info", access }) })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "This link is invalid or expired."); setInfo(d); setOutcome(d.outcome ?? null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Please try again."))
      .finally(() => setLoading(false));
  }, [access]);

  const report = (o: Outcome) => {
    if (saving) return;
    setOutcome(o); // optimistic — the owner sees the confirmation immediately
    setSaving(true);
    fetch("/api/account-recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recovery_outcome", access, outcome: o }) })
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  const codeLink = access ? `/c#${access}` : "/account-code";

  if (loading) return <section className={styles.card}><p>Loading…</p></section>;
  if (!access) return <section className={styles.card}><p className={styles.notice}>Open the recovery link in your message from LinkedVelocity. If you need a new one, reply to our team or <a href={BOOK}>book a quick call</a>.</p></section>;
  if (error) return <section className={styles.card}><p role="alert" className={styles.error}>{error}</p><p className={styles.notice}>Reply to our team for a fresh link, or <a href={BOOK}>book a quick call</a>.</p></section>;

  return (
    <section className={`${styles.card} ${styles.form}`}>
      <h2>{info?.name ? `Hi ${info.name} — scan this to verify it's you` : "Scan this to verify it's you"}</h2>
      {info?.qrUrl ? (
        <>
          <ol style={{ fontSize: 16, lineHeight: 1.7, paddingLeft: 22, margin: "4px 0 16px" }}>
            <li>Open the <strong>LinkedIn app</strong> on another phone or device.</li>
            <li>On the sign-in screen, tap <strong>&ldquo;Sign in with QR code&rdquo;</strong> (the small QR icon).</li>
            <li>Point that camera at the code below.</li>
          </ol>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "8px 0 16px" }}>
            <a href={info.qrUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", width: "min(560px, 94vw)", maxWidth: "100%" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={info.qrUrl} alt="LinkedIn verification QR code" style={{ width: "100%", height: "auto", borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff", padding: 8, boxSizing: "border-box" }} />
            </a>
            <span style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>Hard to scan? <a href={info.qrUrl} target="_blank" rel="noopener noreferrer">Tap the code to open it full-size</a>.</span>
          </div>
          <p className={styles.notice}>If LinkedIn asks for a <strong>6-digit code</strong> instead, <a href={codeLink}>tap here to get it</a>.</p>

          {/* Did it work? — owner self-report, so the team knows whether to move on or step in. */}
          {outcome === "worked" ? (
            <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: 12, background: "#ecfdf3", border: "1px solid #abefc6", color: "#067647", fontSize: 15, lineHeight: 1.6 }}>
              <strong>You&apos;re back in — nice.</strong> We&apos;ve let the team know. You can close this page.
            </div>
          ) : outcome === "stuck" ? (
            <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: 12, background: "#fff8f1", border: "1px solid #f6c89a", color: "#92400e", fontSize: 15, lineHeight: 1.6 }}>
              <strong>Thanks for telling us.</strong> Reply to the message we sent you, or <a href={BOOK}>book a quick call</a> — we&apos;ll verify you another way. You can also try the <a href={codeLink}>6-digit code</a> once more.
            </div>
          ) : (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #eef0f3" }}>
              <p style={{ fontSize: 15, fontWeight: 600, margin: "0 0 10px", color: "#111827" }}>Did it work?</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={() => report("worked")} disabled={saving} style={{ flex: "1 1 180px", fontSize: 15, fontWeight: 600, padding: "12px 16px", borderRadius: 12, border: "1px solid #067647", background: "#067647", color: "#fff", cursor: "pointer" }}>✓ Yes, I&apos;m back in</button>
                <button type="button" onClick={() => report("stuck")} disabled={saving} style={{ flex: "1 1 180px", fontSize: 15, fontWeight: 600, padding: "12px 16px", borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#344054", cursor: "pointer" }}>No, still stuck</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className={styles.notice}>Your recovery code isn&apos;t ready yet. Our team is preparing it — keep this link, refresh in a few minutes, or reply to the message we sent you.</p>
      )}
      <p style={{ fontSize: 13, color: "#6b7280", marginTop: 12 }}>This link is private and expires after 24 hours. Need help? <a href={BOOK}>Book a quick call</a>.</p>
    </section>
  );
}
