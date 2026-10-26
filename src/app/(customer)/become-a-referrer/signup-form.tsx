"use client";
import { useEffect, useState } from "react";

type Method = "whatsapp" | "telegram" | "viber";
type Result = { slug: string; shareUrl: string; portalUrl: string; existing: boolean };

const C = { blue: "#0A66C2", green: "#00B85C", ink: "#0F1419", muted: "#536471", line: "#E3E6EA", bg: "#F6F8FA" };
const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

export default function ReferrerSignupForm() {
  const [form, setForm] = useState({ name: "", email: "", contactMethod: "whatsapp" as Method, contactHandle: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Prefill the name when we linked someone here from an invite (?name=). Read after mount
  // (not useSearchParams) so the static page needs no Suspense boundary, and never clobber
  // anything the person has already typed. We deliberately don't take email from the URL.
  useEffect(() => {
    try {
      const name = new URLSearchParams(window.location.search).get("name")?.trim() || "";
      if (name) setForm(f => ({ ...f, name: f.name || name }));
    } catch { /* no query / unavailable — leave fields empty */ }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/referrer/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setResult(data);
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); }
    finally { setBusy(false); }
  };

  const copy = async () => { if (!result) return; try { await navigator.clipboard.writeText(result.shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard may be blocked */ } };

  const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", font: `500 15px ${font}`, color: C.ink, padding: "13px 14px", border: `1.5px solid ${C.line}`, borderRadius: 11, outline: "none", background: "#fff" };
  const label: React.CSSProperties = { display: "block", font: `600 13.5px ${font}`, color: "#37424F", marginBottom: 7 };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "clamp(24px,6vw,64px) 16px", fontFamily: font }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <h1 style={{ font: `800 26px ${font}`, color: C.blue, letterSpacing: "-0.02em", margin: "0 0 6px" }}>LinkedVelocity</h1>

        {!result ? (
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, padding: "clamp(22px,5vw,32px)", boxShadow: "0 1px 3px rgba(16,20,25,0.04)" }}>
            <h2 style={{ font: `800 22px ${font}`, color: C.ink, letterSpacing: "-0.02em", margin: "0 0 10px" }}>Become a referrer</h2>
            <p style={{ font: `500 15px ${font}`, color: C.muted, lineHeight: 1.6, margin: "0 0 18px" }}>
              Earn <strong style={{ color: C.ink }}>&#8369;500</strong> for every person who signs up through your link, or <strong style={{ color: C.ink }}>up to &#8369;1,000</strong> when you help them get set up. You&rsquo;re paid the same day they are.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
              {["Paid same day", "Friends & family welcome", "Verified or not"].map(t => (
                <span key={t} style={{ font: `600 12px ${font}`, color: "#067A45", background: "#EAF7F0", padding: "5px 11px", borderRadius: 999 }}>&#10003; {t}</span>
              ))}
            </div>

            <form onSubmit={submit} style={{ display: "grid", gap: 15 }}>
              <div>
                <label style={label}>Your name</label>
                <input style={field} value={form.name} onChange={e => set("name", e.target.value)} placeholder="Full name" required maxLength={120} />
              </div>
              <div>
                <label style={label}>Email</label>
                <input style={field} type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="you@example.com" required maxLength={200} />
                <p style={{ font: `500 12px ${font}`, color: C.muted, margin: "6px 0 0" }}>We&rsquo;ll send your link here too.</p>
              </div>
              <div>
                <label style={label}>Where can we reach you?</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 9 }}>
                  {(["whatsapp", "telegram", "viber"] as Method[]).map(m => {
                    const on = form.contactMethod === m;
                    return <button key={m} type="button" onClick={() => set("contactMethod", m)} style={{ flex: 1, cursor: "pointer", font: `600 14px ${font}`, borderRadius: 10, padding: 11, transition: "all .15s", color: on ? "#067A45" : "#5A6473", background: on ? "#EAF7F0" : "#fff", border: `1.5px solid ${on ? C.green : C.line}` }}>{m === "whatsapp" ? "WhatsApp" : m === "telegram" ? "Telegram" : "Viber"}</button>;
                  })}
                </div>
                <input style={field} value={form.contactHandle} onChange={e => set("contactHandle", e.target.value)} placeholder={form.contactMethod === "telegram" ? "@yourhandle" : "+63 9xx xxx xxxx"} required maxLength={120} />
              </div>

              {error && <p style={{ font: `600 13.5px ${font}`, color: "#C0392B", margin: 0 }}>{error}</p>}

              <button type="submit" disabled={busy} style={{ font: `700 15.5px ${font}`, color: "#fff", background: busy ? "#7FB2EE" : C.blue, border: "none", borderRadius: 12, padding: "14px 20px", cursor: busy ? "default" : "pointer", marginTop: 4 }}>
                {busy ? "Setting up your link…" : "Get my referral link →"}
              </button>
              <p style={{ font: `500 12px ${font}`, color: C.muted, textAlign: "center", margin: 0 }}>Takes 30 seconds. Your link is ready instantly.</p>
            </form>
          </div>
        ) : (
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, padding: "clamp(22px,5vw,32px)", boxShadow: "0 1px 3px rgba(16,20,25,0.04)" }}>
            <div style={{ font: `700 13px ${font}`, color: "#067A45", background: "#EAF7F0", display: "inline-block", padding: "5px 12px", borderRadius: 999, marginBottom: 14 }}>&#10003; You&rsquo;re a referrer</div>
            <h2 style={{ font: `800 21px ${font}`, color: C.ink, letterSpacing: "-0.02em", margin: "0 0 8px" }}>{result.existing ? "You're already set up" : "Your link is ready"}</h2>
            <p style={{ font: `500 14.5px ${font}`, color: C.muted, lineHeight: 1.6, margin: "0 0 18px" }}>Share this link. When someone signs up through it you earn &#8369;500, or up to &#8369;1,000 if you help them get set up.</p>

            <label style={label}>Your referral link</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <input readOnly value={result.shareUrl} style={{ ...field, flex: "1 1 220px", fontWeight: 700, color: C.blue }} onFocus={e => e.currentTarget.select()} />
              <button type="button" onClick={copy} style={{ font: `700 14px ${font}`, color: "#fff", background: C.blue, border: "none", borderRadius: 11, padding: "0 18px", cursor: "pointer" }}>{copied ? "Copied" : "Copy"}</button>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a href={`https://wa.me/?text=${encodeURIComponent("Join LinkedVelocity through my link: " + result.shareUrl)}`} target="_blank" rel="noopener noreferrer" style={{ flex: "1 1 160px", textAlign: "center", font: `700 14px ${font}`, color: "#fff", background: C.green, borderRadius: 11, padding: "12px 16px", textDecoration: "none" }}>Share on WhatsApp</a>
              <a href={result.portalUrl} style={{ flex: "1 1 160px", textAlign: "center", font: `700 14px ${font}`, color: C.ink, background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 11, padding: "12px 16px", textDecoration: "none" }}>Open my dashboard →</a>
            </div>
            <p style={{ font: `500 13px ${font}`, color: C.muted, lineHeight: 1.6, margin: "18px 0 0" }}>Your dashboard is where you track sign-ups, add your payout details, and see what you&rsquo;ve earned. We also emailed your link to you.</p>
          </div>
        )}

        <p style={{ font: `500 12.5px ${font}`, color: C.muted, textAlign: "center", margin: "18px 0 0" }}>Questions? Message us on Telegram <a href="https://t.me/linkedvelocity_support_bot" style={{ color: C.blue, textDecoration: "none", fontWeight: 600 }}>@linkedvelocity_support_bot</a></p>
      </div>
    </div>
  );
}
