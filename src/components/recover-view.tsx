"use client";
import { useEffect, useState } from "react";
import styles from "@/app/(customer)/guide/primary-email/primary-email.module.css";

const BOOK = "https://calendly.com/linkedvelocity-info/30min";

type Info = { name: string; qrUrl: string | null; qrAt: string | null };

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

  useEffect(() => {
    if (access && typeof window !== "undefined") window.history.replaceState(null, "", window.location.pathname);
    if (!access) { setLoading(false); return; }
    fetch("/api/account-recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recovery_info", access }) })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "This link is invalid or expired."); setInfo(d); })
      .catch((e) => setError(e instanceof Error ? e.message : "Please try again."))
      .finally(() => setLoading(false));
  }, [access]);

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
          <p className={styles.notice}>If LinkedIn asks for a <strong>6-digit code</strong> instead, <a href={codeLink}>tap here to get it</a>. If the QR doesn&apos;t work after a couple of tries, reply to our team — we&apos;ll help you verify another way.</p>
        </>
      ) : (
        <p className={styles.notice}>Your recovery code isn&apos;t ready yet. Our team is preparing it — keep this link, refresh in a few minutes, or reply to the message we sent you.</p>
      )}
      <p style={{ fontSize: 13, color: "#6b7280", marginTop: 12 }}>This link is private and expires after 24 hours. Need help? <a href={BOOK}>Book a quick call</a>.</p>
    </section>
  );
}
