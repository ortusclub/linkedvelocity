"use client";

import { useEffect, useState } from "react";
import { OnboardingPrice } from "@/components/onboarding-price";

// DIY self-onboarding entry: verify email (gate), collect the details reserve needs, then
// POST /api/self-onboarding/start → get a per-session token → hand off to the live wizard.

type Cfg = { countries: string[]; payoutMethods: string[]; defaultPayoutMethod: string; symbol: string };

const COUNTRY_NAMES: Record<string, string> = { PH: "Philippines", US: "United States", GB: "United Kingdom", IN: "India" };
const countryLabel = (c: string) => COUNTRY_NAMES[c] || c;

export default function SelfSetupStart() {
  const TIER_LABEL: Record<string, React.ReactNode> = { full: <>Full DIY — <OnboardingPrice usd={32} php={2000} /> sign-on</>, partial: <>You add email + 2FA — <OnboardingPrice usd={24} php={1500} /> sign-on</> };
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [tier, setTier] = useState("full");
  const [form, setForm] = useState({
    fullName: "", email: "", linkedinUrl: "", country: "", contactMethod: "WhatsApp", contactHandle: "",
    accountFreshness: "established", paymentMethod: "", paymentDetails: "", payoutName: "", linkedinVerified: false, consent: false,
  });
  // Email gate
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [permit, setPermit] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [gateMsg, setGateMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [lead, setLead] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  // Referral slug carried over from /become-ambassador?ref=slug (or /r/slug), so the referrer
  // who sent this owner here still gets credited for the self-serve signup.
  const [ref, setRef] = useState("");

  const set = (k: keyof typeof form, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    try { const t = new URLSearchParams(window.location.search).get("tier"); if (t === "partial" || t === "full") setTier(t); } catch {}
    try { const r = new URLSearchParams(window.location.search).get("ref") || sessionStorage.getItem("lv_ref") || ""; if (r) setRef(r); } catch {}
    fetch("/api/self-onboarding/config").then((r) => r.json()).then((d: Cfg) => {
      // Bank transfer needs a multi-field sub-form; keep DIY to single-field payout methods.
      const methods = (d.payoutMethods || []).filter((m) => m !== "Bank transfer");
      setCfg({ ...d, payoutMethods: methods });
      setForm((p) => ({ ...p, paymentMethod: methods.includes(d.defaultPayoutMethod) ? d.defaultPayoutMethod : methods[0] || "GCash" }));
    }).catch(() => {});
  }, []);

  const sendCode = async () => {
    setGateMsg(""); setError("");
    if (!/^\S+@\S+\.\S+$/.test(form.email)) { setGateMsg("Enter a valid email first."); return; }
    setSending(true);
    try {
      const res = await fetch("/api/self-onboarding/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", email: form.email }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not send the code.");
      setChallenge(d.challenge); setGateMsg("Code sent — check your email.");
    } catch (e) { setGateMsg(e instanceof Error ? e.message : "Could not send the code."); }
    finally { setSending(false); }
  };

  const verifyCode = async () => {
    setGateMsg("");
    setVerifying(true);
    try {
      const res = await fetch("/api/self-onboarding/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", email: form.email, challenge, code }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "That code isn't right.");
      setPermit(d.permit); setGateMsg("Email verified ✓");
    } catch (e) { setGateMsg(e instanceof Error ? e.message : "That code isn't right."); }
    finally { setVerifying(false); }
  };

  const submit = async () => {
    setError("");
    if (!permit) { setError("Please verify your email first."); return; }
    if (!form.consent) { setError("Please tick the consent box."); return; }
    for (const [k, msg] of [["fullName", "your name"], ["linkedinUrl", "your LinkedIn URL"], ["country", "your country"], ["contactHandle", "a contact"], ["paymentMethod", "a payout method"], ["paymentDetails", "payout details"], ["payoutName", "the payout name"]] as const) {
      if (!String(form[k]).trim()) { setError(`Please add ${msg}.`); return; }
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/self-onboarding/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName, email: form.email, linkedinUrl: form.linkedinUrl, country: form.country,
          contactNumber: `${form.contactMethod}:${form.contactHandle.trim()}`, accountFreshness: form.accountFreshness,
          paymentMethod: form.paymentMethod, paymentDetails: form.paymentDetails, payoutName: form.payoutName,
          linkedinVerified: form.linkedinVerified, consent: true, permit, tier, ref: ref || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not start onboarding.");
      // Provisionable country → live wizard. Anywhere else → captured as a lead.
      if (d.lead) { setReviewReason(d.reviewReason || ""); setLead(true); return; }
      window.location.href = `/onboarding/setup/${encodeURIComponent(d.token)}`;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start onboarding."); setSubmitting(false); }
  };

  const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", fontFamily: "'Inter',sans-serif", fontSize: 15, color: "#0B1220", background: "#fff", border: "1px solid #DCE3DE", borderRadius: 11, padding: "12px 13px", outline: "none" };
  const lab: React.CSSProperties = { display: "block", fontSize: 13.5, fontWeight: 600, color: "#37424F", margin: "0 0 6px" };
  const row: React.CSSProperties = { marginBottom: 14 };

  return (
    <main style={{ minHeight: "100dvh", background: "#F6F8F7", fontFamily: "'Inter',sans-serif" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "40px 18px 70px" }}>
        {lead ? (
          <div style={{ background: "#0D2A1C", borderRadius: 18, padding: "36px 28px", textAlign: "center", color: "#fff" }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>✓</div>
            <h2 style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 24, margin: "0 0 10px" }}>Thanks, {form.fullName.split(" ")[0] || "you're in"}!</h2>
            {reviewReason && <p style={{ color: "#B7D4C4", marginBottom: 16 }}>{reviewReason}</p>}
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "#B7D4C4", margin: 0 }}>Your application has been received for review. Our team will check the account details and reach out by email at <strong style={{ color: "#fff" }}>{form.email}</strong>. You can track your application from your dashboard.</p><a href="/dashboard" style={{ display: "inline-block", color: "white", textDecoration: "underline", marginTop: 16 }}>Go to my dashboard →</a>
          </div>
        ) : (<>
        <h1 style={{ fontFamily: "'Poppins','Inter',sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Do it yourself — set up now</h1>
        <p style={{ fontSize: 14.5, color: "#5A6473", margin: "0 0 22px" }}>{TIER_LABEL[tier] || TIER_LABEL.full}. Verify your email, add a few details, then you&apos;ll go through the quick setup yourself — zero delays.</p>

        <div style={{ background: "#fff", border: "1px solid #E6E8EC", borderRadius: 18, padding: "24px 24px 26px" }}>
          <div style={row}><label style={lab} htmlFor="provided-account-name">Name on the LinkedIn account *</label><input id="provided-account-name" style={inp} value={form.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="Full name shown on the LinkedIn profile" /></div>

          {/* Email + gate */}
          <div style={row}>
            <label style={lab} htmlFor="provided-account-email">Email currently on that LinkedIn account *</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input id="provided-account-email" style={inp} type="email" value={form.email} disabled={!!permit} onChange={(e) => { set("email", e.target.value); setPermit(""); setChallenge(""); setCode(""); setGateMsg(""); }} placeholder="Email linked to the account you are providing" />
              {!permit && <button type="button" onClick={sendCode} disabled={sending} style={{ flex: "none", padding: "0 14px", borderRadius: 11, border: "1px solid #00A150", background: "#fff", color: "#00A150", fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>{sending ? "…" : challenge ? "Resend" : "Send code"}</button>}
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.5, color: "#5A6473", margin: "6px 0 0" }}>Use the account’s current email address. Verification codes and updates will be sent here.</p>
            {challenge && !permit && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input style={inp} value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" />
                <button type="button" onClick={verifyCode} disabled={verifying || code.length < 4} style={{ flex: "none", padding: "0 16px", borderRadius: 11, border: "none", background: "#00B85C", color: "#fff", fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>{verifying ? "…" : "Verify"}</button>
              </div>
            )}
            {!!permit && <button type="button" onClick={() => { setPermit(""); setChallenge(""); setCode(""); setGateMsg(""); setError(""); requestAnimationFrame(() => document.getElementById("provided-account-email")?.focus()); }} style={{ marginTop: 8, background: "none", border: "none", padding: 0, textDecoration: "underline", color: "#0A66C2", cursor: "pointer" }}>Change email</button>}
            {gateMsg && <div style={{ fontSize: 12.5, color: permit ? "#067A45" : "#5A6473", marginTop: 7 }}>{gateMsg}</div>}
          </div>

          <div style={row}><label style={lab}>LinkedIn profile URL *</label><input style={inp} value={form.linkedinUrl} onChange={(e) => set("linkedinUrl", e.target.value)} placeholder="https://www.linkedin.com/in/your-name" /></div>

          <div style={row}>
            <label style={lab}>Country *</label>
            <select style={{ ...inp, cursor: "pointer" }} value={form.country} onChange={(e) => set("country", e.target.value)}>
              <option value="">Select…</option>
              {(cfg?.countries || []).map((c) => <option key={c} value={c}>{countryLabel(c)}</option>)}
            </select>
          </div>

          <div style={row}>
            <label style={lab}>How can we reach you? *</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={form.contactMethod} onChange={(e) => set("contactMethod", e.target.value)} style={{ ...inp, width: 130, flex: "none", cursor: "pointer" }}>
                <option value="WhatsApp">WhatsApp</option><option value="Telegram">Telegram</option><option value="Cell">Cell number</option>
              </select>
              <input style={inp} value={form.contactHandle} onChange={(e) => set("contactHandle", e.target.value)} placeholder={form.contactMethod === "Telegram" ? "@username or +63…" : "+63…"} />
            </div>
          </div>

          <div style={row}>
            <label style={lab}>How should we pay you? *</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)} style={{ ...inp, width: 150, flex: "none", cursor: "pointer" }}>
                {(cfg?.payoutMethods || ["GCash"]).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input style={inp} value={form.paymentDetails} onChange={(e) => set("paymentDetails", e.target.value)} placeholder="Account number / email / UPI" />
            </div>
            <input style={{ ...inp, marginTop: 8 }} value={form.payoutName} onChange={(e) => set("payoutName", e.target.value)} placeholder="Name on the payout account" />
          </div>

          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "6px 0 4px", cursor: "pointer" }}>
            <input type="checkbox" checked={form.consent} onChange={(e) => set("consent", e.target.checked)} style={{ marginTop: 3, accentColor: "#00A150" }} />
            <span style={{ fontSize: 13, color: "#37424F", lineHeight: 1.45 }}>I consent to my LinkedIn account being onboarded onto LinkedVelocity, I&apos;m 16+ (or older where required), and the details above are mine.</span>
          </label>

          {error && <div style={{ fontSize: 13.5, color: "#C0392B", margin: "10px 0 0" }}>{error}</div>}

          <button onClick={submit} disabled={submitting || !permit} style={{ width: "100%", marginTop: 16, background: submitting || !permit ? "#8FD9B4" : "#00B85C", color: "#fff", fontSize: 16, fontWeight: 600, border: "none", borderRadius: 12, padding: 15, cursor: submitting || !permit ? "not-allowed" : "pointer" }}>
            {submitting ? "Starting…" : permit ? "Start my setup →" : "Verify your email to continue"}
          </button>
        </div>
        </>)}
      </div>
    </main>
  );
}
