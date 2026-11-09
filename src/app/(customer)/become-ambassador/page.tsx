"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { refFromCookieHeader, writeRefCookie } from "@/lib/referral-cookie";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencySelector, useDisplayCurrency } from "@/components/display-currency";
import { offerPair, balancePair } from "@/lib/display-currency";

type Step = "choice" | "logged-in-choice" | "info" | "scanning" | "result" | "bank" | "account-details" | "login" | "complete" | "done" | "review" | "scheduled";

// Onboarding-call booking. Every path that ends a signup should push to this —
// a booked call converts far better than leaving someone to "check back soon".
const CALENDAR_URL = "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ1he_qAS5s8faJzrAIjTJi8KIX9xvPhGbC4Ipn38lPTLzkfSuoyMIiqUrB0viY2jpXr_W_zLSdq";
// Ortus referrals book a separate Calendly so those onboarding calls land distinctly.
const ORTUS_CALENDAR_URL = "https://calendly.com/linkedvelocity-info/30min";

const SCAN_STEPS = [
  "Locating your LinkedIn profile...",
  "Analysing your connection network...",
  "Reviewing your industry and experience...",
  "Checking profile verification status...",
  "Evaluating account history and age...",
  "Assessing profile strength and engagement...",
  "Calculating your ambassador value...",
  "Generating your personalised offer...",
];

function calculateOffer(data: {
  connectionCount: number;
  verified: boolean;
  hasSalesNav: boolean;
  notes: string;
}): {
  amount: number;
  tier: string;
  reasons: { label: string; detail: string; positive: boolean }[];
} {
  const reasons: { label: string; detail: string; positive: boolean }[] = [];
  let baseScore = 0;

  // Connections
  const conn = data.connectionCount || 0;
  if (conn >= 10000) {
    baseScore += 40;
    reasons.push({ label: "Connections", detail: `${conn.toLocaleString()}+ connections — excellent network`, positive: true });
  } else if (conn >= 5000) {
    baseScore += 30;
    reasons.push({ label: "Connections", detail: `${conn.toLocaleString()}+ connections — strong network`, positive: true });
  } else if (conn >= 2000) {
    baseScore += 20;
    reasons.push({ label: "Connections", detail: `${conn.toLocaleString()}+ connections — good network`, positive: true });
  } else if (conn >= 500) {
    baseScore += 10;
    reasons.push({ label: "Connections", detail: `${conn.toLocaleString()} connections — growing network`, positive: true });
  } else {
    baseScore += 5;
    reasons.push({ label: "Connections", detail: `${conn} connections — building network`, positive: false });
  }

  // Verified
  if (data.verified) {
    baseScore += 15;
    reasons.push({ label: "Verification", detail: "LinkedIn verified profile", positive: true });
  }

  // Sales Navigator
  if (data.hasSalesNav) {
    baseScore += 10;
    reasons.push({ label: "Sales Navigator", detail: "Active Sales Navigator subscription", positive: true });
  }

  // Notes parsing for account age
  const notes = (data.notes || "").toLowerCase();
  const ageMatch = notes.match(/(\d+)\+?\s*year/);
  if (ageMatch) {
    const years = parseInt(ageMatch[1]);
    if (years >= 5) {
      baseScore += 15;
      reasons.push({ label: "Account Age", detail: `${years}+ years — well-established account`, positive: true });
    } else {
      baseScore += 8;
      reasons.push({ label: "Account Age", detail: `${years} years`, positive: true });
    }
  }
  if (notes.includes("photo") || notes.includes("picture")) {
    baseScore += 5;
    reasons.push({ label: "Profile Photo", detail: "Professional profile photo", positive: true });
  }

  // Calculate amount
  let amount: number;
  let tier: string;
  if (baseScore >= 70) {
    amount = 40 + Math.floor((baseScore - 70) / 5) * 5;
    tier = "Elite";
  } else if (baseScore >= 50) {
    amount = 25 + Math.floor((baseScore - 50) / 10) * 5;
    tier = "Premium";
  } else if (baseScore >= 30) {
    amount = 15 + Math.floor((baseScore - 30) / 10) * 5;
    tier = "Standard";
  } else {
    amount = 16;
    tier = "Starter";
  }

  return { amount: Math.min(amount, 75), tier, reasons };
}

// Accept whatever the user pastes for their LinkedIn URL and tidy it up — add https://
// if missing so "linkedin.com/in/name" (no protocol) still works. Empty -> undefined.
const cleanLinkedinUrl = (u: string): string | undefined => {
  const s = u.trim().replace(/\s+/g, "");
  if (!s) return undefined;
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
};

export default function BecomeAmbassadorPage() {
  const [step, setStep] = useState<Step | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currencyKey, setCurrencyKey] = useState("ambassador-public");
  const preference = useDisplayCurrency(currencyKey);
  const currency = preference.currency;
  const monthlyPrice = offerPair(8, 500, currency);
  // If the ?ref= belongs to an Ortus referrer, the form adapts: an Ortus-use note + USD-first pricing.
  const [refType, setRefType] = useState<string | null>(null);
  const isOrtusRef = refType === "ortus";
  // Pool referrals (Ortus / Apex) get the pool note + USD-first pricing; only Ortus books
  // the Calendly — Apex (and everyone else) keeps the standard Google schedule.
  const isPoolRef = refType === "ortus" || refType === "apex";
  const poolBrand = refType === "apex" ? "Apex" : "Ortus";
  const bookingUrl = isOrtusRef ? ORTUS_CALENDAR_URL : CALENDAR_URL;
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const [assignedProxy, setAssignedProxy] = useState<{host:string;port:number;username:string;password:string}|null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  const [scanIndex, setScanIndex] = useState(0);
  const [offer, setOffer] = useState<{ amount: number; tier: string; reasons: { label: string; detail: string; positive: boolean }[] } | null>(null);
  const [profileId, setGologinProfileId] = useState("");
  const [launchingBrowser, setLaunchingBrowser] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; tempPassword: string } | null>(null);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    contactNumber: "",
    contactMethod: "whatsapp" as "whatsapp" | "telegram" | "viber",
    contactHandle: "",
    linkedinProfileName: "",
    linkedinEmail: "",
    sameNameAsProfile: true,
    sameEmailAsProfile: true,
    linkedinUrl: "",
    connectionCount: "",
    location: "",
    verified: false,
    hasSalesNav: false,
    notes: "",
    referralSource: "",
    referredBy: "",
  });

  // The owner's one-time setup bonus is a flat ₱1,000 / $16 whether or not they were referred
  // (the referrer earns their own commission separately). Keep this in step with the payout
  // logic in referral-currency.ts, which already pays referred owners the flat amount.
  const setupPrice = offerPair(16, 1000, currency);

  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountLinkedinUrl, setAccountLinkedinUrl] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"usdc" | "paypal" | "wise" | null>(null);
  const [bankForm, setBankForm] = useState({
    bankName: "",
    bankAccountName: "",
    bankAccountNumber: "",
    bankRoutingNumber: "",
    bankSortCode: "",
    usdcWalletAddress: "",
    usdcNetwork: "ethereum",
    paypalEmail: "",
    wiseEmail: "",
  });

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const updateBank = (field: string, value: string) =>
    setBankForm((prev) => ({ ...prev, [field]: value }));

  // Capture the field-marketer referral tag from ?ref= (e.g. /become-ambassador?ref=mark-lewis-estacio),
  // set by the marketer's personal QR. Persist it in sessionStorage so it survives the valuation flow
  // AND the login redirect round-trip, and attach it at submit. Also default "how did you hear" to
  // "Flyer" (a QR scan comes from a marketer's flyer) so the manual fail-safe field shows pre-filled.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const fromUrl = sp.get("ref") || "";
      if (fromUrl) { sessionStorage.setItem("lv_ref", fromUrl); writeRefCookie(fromUrl); }
      const ref = fromUrl || sessionStorage.getItem("lv_ref") || refFromCookieHeader(document.cookie) || "";
      setCurrencyKey(`ambassador:${ref || "direct"}`);
      if (ref) {
        setForm((prev) => ({
          ...prev,
          referredBy: prev.referredBy || ref,
          referralSource: prev.referralSource || "Flyer",
        }));
        // Resolve the referrer so an Ortus link shows the Ortus-use note + USD-first pricing.
        fetch(`/api/ambassador/referrer-info?ref=${encodeURIComponent(ref)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d?.referrer) {
              setRefType(d.referrer.type);

            }
          })
          .catch(() => {});
      }
    } catch {}
  }, []);

  // Pre-fill from logged-in user and skip choice step. If "?valuation=1" is in the URL
  // (e.g. the "Get my valuation" nav button), jump straight into the form.
  useEffect(() => {
    let wantValuation = false;
    let booked = false;
    let wantSubmit = false;
    try {
      const sp = new URLSearchParams(window.location.search);
      // A marketer's QR (?ref=slug) drops straight onto the form — skip the hero/choice screen.
      wantValuation = !!sp.get("valuation") || !!sp.get("ref");
      booked = !!sp.get("booked"); // returning here after signing up — show the book-a-call step
      wantSubmit = !!sp.get("submit"); // logged-in user adding an account — skip valuation, go straight to the form
    } catch {}
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setForm((prev) => ({
            ...prev,
            fullName: prev.fullName || data.user.fullName || "",
            email: prev.email || data.user.email || "",
            contactNumber: prev.contactNumber || data.user.contactNumber || "",
            contactMethod: data.user.contactNumber?.startsWith("telegram:") ? "telegram" as const : data.user.contactNumber?.startsWith("viber:") ? "viber" as const : "whatsapp" as const,
            contactHandle: prev.contactHandle || (data.user.contactNumber?.replace(/^(whatsapp|telegram|viber):/, "") || ""),
          }));
          setIsLoggedIn(true);
          setStep(booked ? "scheduled" : wantSubmit ? "account-details" : wantValuation ? "info" : "logged-in-choice");
        } else {
          setStep(booked ? "scheduled" : wantValuation ? "info" : "choice");
        }
      })
      .catch(() => {
        setStep(booked ? "scheduled" : wantValuation ? "info" : "choice");
      });
  }, []);

  // Nav header anchors (#how, #earn, #faq) must work from anywhere — including mid-flow.
  // Those sections only render on the landing steps, so if the user clicks a header while
  // in the form/flow, return to the landing view first, then scroll to the section.
  useEffect(() => {
    const ANCHORS = ["#how", "#earn", "#faq"];
    const scrollTo = (hash: string, tries = 0) => {
      const el = document.querySelector(hash);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      if (tries < 10) setTimeout(() => scrollTo(hash, tries + 1), 60);
    };
    const onHash = () => {
      const h = window.location.hash;
      if (!ANCHORS.includes(h)) return;
      setStep((prev) => (prev === "choice" || prev === "logged-in-choice" ? prev : (isLoggedIn ? "logged-in-choice" : "choice")));
      scrollTo(h);
    };
    window.addEventListener("hashchange", onHash);
    if (ANCHORS.includes(window.location.hash)) onHash(); // handle deep-link on load
    return () => window.removeEventListener("hashchange", onHash);
  }, [isLoggedIn]);

  // Auto-fetch proxy when entering the GoLogin setup step
  useEffect(() => {
    if (step !== "login" || assignedProxy) return;
    fetch("/api/ambassador/proxy")
      .then((r) => r.json())
      .then((data) => {
        if (data.proxy) setAssignedProxy(data.proxy);
      })
      .catch(() => {});
  }, [step, assignedProxy]);

  // Scanning animation
  useEffect(() => {
    if (step !== "scanning") return;
    if (scanIndex >= SCAN_STEPS.length) {
      // Show the server's assessed offer (captured in handleSubmit). Fall back to the
      // local estimate only if the apply call didn't return one — so the number the
      // applicant sees always matches what's stored + emailed + paid.
      setOffer((prev) => prev ?? calculateOffer({
        connectionCount: Number(form.connectionCount) || 0,
        verified: form.verified as unknown as boolean,
        hasSalesNav: form.hasSalesNav as unknown as boolean,
        notes: form.notes,
      }));
      setTimeout(() => setStep("result"), 500);
      return;
    }
    const timer = setTimeout(() => setScanIndex((i) => i + 1), 1200 + Math.random() * 800);
    return () => clearTimeout(timer);
  }, [step, scanIndex, form]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    // Guard against double-submits: on a slow connection people tap the button
    // repeatedly and each tap used to file another application (one field-day
    // signup landed 6 times in a single minute). The ref blocks re-entry
    // synchronously — state alone updates too late to stop a fast second tap.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    if (!form.fullName || !form.email || !form.contactHandle) {
      setError("Please fill in your name, email and contact");
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }
    if (!form.linkedinUrl.trim() || !/linkedin\.com/i.test(form.linkedinUrl)) {
      setError("Please add your LinkedIn profile URL (e.g. linkedin.com/in/yourprofile)");
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }
    const hasUrl = !!form.linkedinUrl.trim();

    // Create ambassador application immediately so it appears in admin, and capture
    // the server's assessed offer so the applicant sees the SAME number we store/pay.
    try {
      const res = await fetch("/api/ambassador/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email,
          linkedinEmail: form.sameEmailAsProfile ? form.email : (form.linkedinEmail || form.email),
          contactNumber: `${form.contactMethod}:${form.contactHandle}`,
          linkedinUrl: cleanLinkedinUrl(form.linkedinUrl),
          connectionCount: form.connectionCount ? Number(form.connectionCount) : undefined,
          location: form.location || undefined,
          referralSource: form.referralSource || undefined,
          referredBy: form.referredBy || undefined,
          notes: [
            form.verified ? "Verified profile" : "",
            form.hasSalesNav ? "Sales Navigator" : "",
            form.notes || "",
          ].filter(Boolean).join(". ") || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const a = data.assessment;
        if (a) {
          setOffer({
            amount: a.offeredAmount,
            tier: a.tier ? a.tier.charAt(0).toUpperCase() + a.tier.slice(1) : "Starter",
            reasons: (a.breakdown || []).map((b: { category: string; reason: string; points: number }) => ({
              label: b.category, detail: b.reason, positive: b.points > 0,
            })),
          });
        }
      }
    } catch {} // Don't block the flow if this fails

    setSubmitting(false);
    // Deliberately NOT clearing submittingRef: we're leaving the form for the next
    // step, and this application is filed. Keeping it latched means a stray extra
    // tap can't file a second copy.

    // With a LinkedIn URL we run the instant valuation; without one we've still captured
    // the lead, so go straight to the confirmation (no valuation to show).
    if (hasUrl) { setScanIndex(0); setStep("scanning"); }
    else { setStep("scheduled"); }
  }, [form]);

  // Stash what they already typed so the signup page pre-fills it (no re-entering).
  const stashSignupPrefill = () => {
    try {
      const parts = (form.fullName || "").trim().split(/\s+/);
      localStorage.setItem("lv_signup_prefill", JSON.stringify({
        firstName: parts[0] || "",
        lastName: parts.slice(1).join(" "),
        email: form.email || "",
        contactMethod: form.contactMethod || "whatsapp",
        contactHandle: form.contactHandle || "",
      }));
    } catch {}
  };

  const handleBankSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Save to database
      const applyRes = await fetch("/api/ambassador/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          contactNumber: form.contactHandle ? `${form.contactMethod}:${form.contactHandle}` : undefined,
          linkedinEmail: form.sameEmailAsProfile ? form.email : (form.linkedinEmail || form.email),
          connectionCount: form.connectionCount ? Number(form.connectionCount) : undefined,
        }),
      });

      if (applyRes.ok) {
        const applyData = await applyRes.json();
        // Save bank details
        await fetch("/api/ambassador/bank", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applicationId: applyData.application.id, paymentMethod, ...bankForm }),
        });
      }

      setStep("account-details");
    } catch {
      setStep("account-details"); // Continue even if save fails
    } finally {
      setLoading(false);
    }
  };

  if (step === null) {
    return <div className="flex min-h-screen items-center justify-center"><div className="text-gray-400">Loading...</div></div>;
  }

  return (
    <div>
      <style>{`
        .atiers{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;align-items:start;max-width:1080px;margin:0 auto}
        .atier{position:relative;border:1px solid #E8E6E1;border-radius:18px;padding:30px 28px;background:#fff;transition:.2s;text-align:left}
        .atier::before{content:'';position:absolute;top:0;left:0;right:0;height:5px;border-radius:18px 18px 0 0;background:#9be0b8}
        .atier.t-est::before{background:#00B85C}
        .atier.t-prem::before{background:#0A4D30}
        .atier:hover{transform:translateY(-4px);box-shadow:0 22px 44px -24px rgba(0,184,92,0.3)}
        .atier.feat{border:2px solid #00B85C;box-shadow:0 30px 60px -26px rgba(0,184,92,0.5);transform:translateY(-14px)}
        .atier.feat:hover{transform:translateY(-18px)}
        .atier h3{font-family:'Montserrat',sans-serif;font-size:20px;font-weight:700;letter-spacing:-0.02em;margin:14px 0 4px;color:#0F1419}
        .a-badge{position:absolute;top:-11px;left:28px;font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#fff;background:linear-gradient(135deg,#00B85C,#007A3D);padding:4px 11px;border-radius:999px}
        .a-cat{font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#007A3D;background:#E6F9EE;border-radius:999px;padding:4px 11px;display:inline-block}
        .atier.t-est .a-cat{color:#fff;background:#00B85C}
        .atier.t-prem .a-cat{color:#fff;background:#0A4D30}
        .a-strength{display:inline-flex;gap:4px;margin-left:9px;vertical-align:middle}
        .a-strength i{width:7px;height:7px;border-radius:50%;background:#D5DBE3;display:inline-block}
        .a-strength i.on{background:#00B85C}
        .atier.t-prem .a-strength i.on{background:#0A4D30}
        .a-eg{display:flex;align-items:center;gap:11px;margin:14px 0 10px;padding:11px 12px;border:1px solid #E8E6E1;border-radius:12px;background:#FAFBFC}
        .a-eg-av{width:42px;height:42px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;position:relative;flex:0 0 42px;font-family:'Montserrat',sans-serif}
        .a-eg-dot{position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:#0A66C2;border:2px solid #FAFBFC}
        .a-eg-name{font-weight:700;font-size:14px;color:#0F1419}
        .a-eg-tag{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#8899A6;background:#EEF0F4;border-radius:6px;padding:2px 6px;margin-left:6px}
        .a-eg-role{font-size:12px;color:#536471}
        .a-egstats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:6px}
        .a-egstats > div{background:#F2FAF5;border-radius:9px;padding:8px 6px;text-align:center}
        .a-egstats b{display:block;font-family:'Montserrat',sans-serif;font-size:15px;color:#007A3D}
        .a-egstats span{font-size:10px;color:#8899A6}
        .a-desc{font-size:13.5px;color:#536471;line-height:1.55;margin:10px 0 0}
        .a-band{font-size:16px;font-weight:800;color:#007A3D;margin:14px 0 0}
        .a-band small{color:#8899A6;font-weight:600}
        @media(max-width:860px){.atiers{grid-template-columns:1fr}}
      `}</style>

      {/* Landing marketing (hero + earnings) — only on the choice/landing steps so it
          hides once the user starts the valuation form. */}
      {(step === "choice" || step === "logged-in-choice") && (
      <>
      <style>{`@keyframes lvAurA{0%,100%{transform:translate(0,0) scale(1);opacity:.9}50%{transform:translate(6%,4%) scale(1.12);opacity:1}}@keyframes lvAurB{0%,100%{transform:translate(0,0) scale(1);opacity:.8}50%{transform:translate(-5%,3%) scale(1.15);opacity:.95}}@media(max-width:720px){.a-earn-grid{grid-template-columns:1fr!important}}.a-earn-card{transition:transform .22s cubic-bezier(.2,.7,.3,1), box-shadow .22s ease}.a-earn-card.setup:hover{transform:translateY(-6px);box-shadow:0 22px 48px rgba(16,24,40,0.12)!important}.a-earn-card.month:hover{transform:translateY(-6px);box-shadow:0 30px 64px rgba(0,161,80,0.24)!important}.a-lift{transition:transform .2s cubic-bezier(.2,.7,.3,1), box-shadow .2s ease}.a-lift:hover{transform:translateY(-6px);box-shadow:0 18px 40px rgba(16,24,40,0.12)!important}@media(max-width:900px){.a-3grid{grid-template-columns:1fr 1fr!important}.a-4grid{grid-template-columns:1fr 1fr!important}}@media(max-width:600px){.a-3grid,.a-2grid,.a-4grid{grid-template-columns:1fr!important}}`}</style>

      {/* Hero — green ambassador design */}
      <section id="amb-hero" style={{ position: "relative", overflow: "hidden", background: "radial-gradient(80% 60% at 50% -10%, rgba(0,184,92,0.30) 0%, rgba(11,32,24,0) 62%), radial-gradient(70% 60% at 88% 10%, rgba(20,160,90,0.20) 0%, rgba(11,32,24,0) 55%), linear-gradient(180deg,#10432C 0%,#0B2018 100%)", padding: "74px 24px 84px", textAlign: "center", color: "#EAF6EE" }}>
        <div aria-hidden style={{ position: "absolute", width: 620, height: 620, left: -160, top: -220, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,184,92,0.26), rgba(0,184,92,0) 65%)", filter: "blur(20px)", pointerEvents: "none", animation: "lvAurA 16s ease-in-out infinite" }} />
        <div aria-hidden style={{ position: "absolute", width: 560, height: 560, right: -140, bottom: -200, borderRadius: "50%", background: "radial-gradient(circle, rgba(20,180,110,0.22), rgba(20,180,110,0) 65%)", filter: "blur(20px)", pointerEvents: "none", animation: "lvAurB 19s ease-in-out infinite" }} />
        <div style={{ position: "relative", maxWidth: 820, margin: "0 auto" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "7px 15px", fontSize: 13, fontWeight: 600, color: "#CFEAD9", marginBottom: 26 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3EF08A" }} />For account owners &amp; professionals
          </span>
          <h1 style={{ fontFamily: "'Poppins','Montserrat',sans-serif", fontWeight: 800, fontSize: "clamp(36px,5.8vw,58px)", lineHeight: 1.04, letterSpacing: "-0.03em", margin: "0 auto 22px", color: "#fff", maxWidth: 720 }}>Get paid for your <span style={{ color: "#4FE08C" }}>LinkedIn account</span></h1>
          <p style={{ fontSize: 19, lineHeight: 1.6, color: "#B7D4C4", margin: "0 auto", maxWidth: 600 }}>Every LinkedIn account has value — whether you&apos;re a student, a professional, or barely use it. Companies need real profiles for outreach, and we pay you a <strong style={{ color: "#fff" }}>setup bonus plus a monthly payout</strong> for every account you share.</p>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "center", marginTop: 34 }}>
            <a href="/onboarding" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 9, background: "#00B85C", color: "#fff", fontSize: 16, fontWeight: 600, padding: "15px 26px", borderRadius: 12, border: "none", cursor: "pointer", boxShadow: "0 14px 32px rgba(0,184,92,0.34)" }}>Rent us your account →</a>
            <a href="#earn" style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "rgba(255,255,255,0.08)", color: "#EAF6EE", border: "1px solid rgba(255,255,255,0.2)", fontSize: 16, fontWeight: 600, padding: "15px 26px", borderRadius: 12, textDecoration: "none" }}>See how it works</a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap", justifyContent: "center", marginTop: 34, fontSize: 13.5, color: "#9DC4AE" }}>
            {["No cost to join", "You stay in control", "Cancel anytime after 6 months"].map((t) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span style={{ color: "#4FE08C" }}>✓</span>{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* EARN — flat payout, real public figures with PHP/USD toggle */}
      {(() => {
        const M = { setup: setupPrice, monthly: monthlyPrice, year: offerPair(112, 7000, currency) };
        return (
      <section id="earn" style={{ background: "#FBFCFB", padding: "64px 24px 8px", borderBottom: "1px solid #E8E6E1" }}>
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 40px" }}>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "#00A150", marginBottom: 14 }}>What you can earn</div>
          <h2 style={{ fontFamily: "'Poppins','Montserrat',sans-serif", fontWeight: 700, fontSize: "clamp(28px,4vw,40px)", letterSpacing: "-0.03em", margin: "0 0 12px" }}>Earn more by completing your own setup</h2>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "#5A6473", margin: "0 0 22px" }}>Choose how much of the setup you do yourself. Complete email and 2FA for a higher setup bonus, or finish the full setup on a computer for the highest bonus. The monthly payout is the same for all three options.</p>
          <CurrencySelector preference={preference} />
          <div style={{ fontSize: 12.5, color: "#5A6473", marginTop: 12 }}>Payouts are made in PHP{currency === "USD" ? " — USD shown for reference." : "."}</div>
        </div>

        <div style={{ maxWidth: 820, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, alignItems: "stretch" }} className="a-earn-grid">
          <div className="a-earn-card setup" style={{ background: "#fff", border: "1px solid #E7EBE8", borderRadius: 20, padding: "30px", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", color: "#067A45", background: "#E7F6EE", padding: "5px 11px", borderRadius: 7 }}>ONE-TIME</span>
            <h3 style={{ fontSize: 20, color: "#0B1220", margin: "20px 0 16px" }}>Choose your setup bonus</h3>
            {[
              { title: "We set it up", price: M.setup, detail: "Submit your account and book a call. Our team helps you complete the setup." },
              { title: "You add email + 2FA", price: offerPair(24, 1500, currency), detail: "Add the assigned email and complete two-factor authentication yourself. Our team finishes the browser sign-in." },
              { title: "Full DIY setup", price: offerPair(32, 2000, currency), detail: "Complete email, 2FA and the GoLogin sign-in yourself. Requires a Windows or Mac laptop or desktop." },
            ].map((option, index) => <div key={option.title} style={{ padding: "14px 0", borderTop: index ? "1px solid #E7EBE8" : undefined }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, fontWeight: 700, fontSize: 16, color: "#0B1220" }}><span>{option.title}</span><span style={{ color: "#067A45" }}>{option.price}</span></div>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: "#5A6473", margin: "6px 0 0" }}>{option.detail}</p>
            </div>)}
            <p style={{ fontSize: 13, color: "#5A6473", marginBottom: 0 }}>Paid once after your account is approved and setup is complete.</p>
          </div>
          <div className="a-earn-card month" style={{ position: "relative", background: "#fff", border: "1.5px solid #00A150", borderRadius: 20, padding: "30px", boxShadow: "0 18px 44px rgba(0,161,80,0.16)" }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", color: "#fff", background: "#00A150", padding: "5px 11px", borderRadius: 7 }}>EVERY MONTH</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "20px 0 4px" }}>
              <span style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 800, fontSize: 46, lineHeight: 1, letterSpacing: "-0.02em", color: "#00A150" }}>{M.monthly}</span>
              <span style={{ fontSize: 16, color: "#8A93A2", fontWeight: 500 }}>/month</span>
            </div>
            <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 600, fontSize: 16, color: "#0B1220", marginBottom: 6 }}>Monthly payout</div>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#5A6473", margin: 0 }}>Paid every month your account stays active — even in months it isn&apos;t rented. Cancel anytime after a light 6-month minimum.</p>
          </div>
        </div>

        <div style={{ maxWidth: 820, margin: "18px auto 0", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "center", background: "#F6FAF7", border: "1px solid #E6F0EA", borderRadius: 14, padding: "16px 22px" }}>
          <span style={{ fontSize: 14.5, color: "#37424F" }}><strong style={{ color: "#0B1220" }}>First year with team setup:</strong> {M.setup} setup + {M.monthly} × 12 months = <strong style={{ color: "#00A150" }}>{M.year}</strong> from a single account.</span>
        </div>

        <div style={{ textAlign: "center", margin: "24px auto" }}>
          <a href="/onboarding" style={{ display: "inline-flex", padding: "13px 22px", borderRadius: 10, background: "#00A150", color: "#fff", fontSize: 16, fontWeight: 600, textDecoration: "none" }}>Rent us your account →</a>
        </div>

        <div style={{ maxWidth: 820, margin: "14px auto 0" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "center", background: "#fff", border: "1px dashed #CDDCD3", borderRadius: 14, padding: "15px 22px", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#946011", background: "#FBF0DA", padding: "4px 9px", borderRadius: 6 }}>Coming soon</span>
            <span style={{ fontSize: 14, color: "#5A6473" }}>Higher payouts for stronger profiles (more connections, Sales Navigator) are on the way.</span>
          </div>
        </div>

        <div style={{ maxWidth: 900, margin: "34px auto 0" }}>
          <div style={{ background: "linear-gradient(135deg,#E7F6EE,#F1FAF4)", border: "1px solid #CDEBD9", borderRadius: 16, padding: "26px 30px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 19, color: "#0B1220", marginBottom: 8 }}>It&apos;s not just your account</div>
            <p style={{ fontSize: 15.5, lineHeight: 1.65, color: "#37424F", margin: "0 auto", maxWidth: 640 }}>Got family who don&apos;t use their LinkedIn? Your siblings, parents, aunties, uncles — submit their accounts too and earn a setup bonus plus monthly payout for each one. If the account exists, it has value.</p>
          </div>
        </div>
      </section>
        );
      })()}

      </>
      )}

      {/* Choice Screen */}
      {step === "choice" && (
        <section className="py-6">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-5 md:grid-cols-2">
              <div
                onClick={() => (window.location.href = "/login?redirect=/become-ambassador")}
                className="group cursor-pointer rounded-2xl border border-gray-200 bg-white p-8 transition-all hover:border-blue-400 hover:shadow-xl hover:shadow-blue-500/5"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
                  <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-gray-900">Already an Ambassador?</h3>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">Sign in to manage your accounts, check earnings, and view your dashboard.</p>
                <div className="mt-5">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 group-hover:gap-2.5 transition-all">
                    Sign In
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  </span>
                </div>
              </div>

              <div
                onClick={() => setStep("info")}
                className="group cursor-pointer rounded-2xl border border-gray-200 bg-white p-8 transition-all hover:border-green-400 hover:shadow-xl hover:shadow-green-500/5"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-50">
                  <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-gray-900">First-Time Ambassador?</h3>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">Get your LinkedIn profile evaluated instantly — no sign-up needed.</p>
                <div className="mt-5">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-600 group-hover:gap-2.5 transition-all">
                    Get Started
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* === Landing marketing (how it works + FAQ) — on both landing steps so the
          ambassador nav anchors (#how, #earn, #faq) resolve for logged-in users too === */}
      {(step === "choice" || step === "logged-in-choice") && (
        <>
          {/* BENEFITS */}
          <section style={{ background: "#FBFCFB", padding: "64px 24px 8px" }}>
            <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 44px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "#00A150", marginBottom: 14 }}>Ambassador benefits</div>
              <h2 style={{ fontFamily: "'Poppins','Montserrat',sans-serif", fontWeight: 700, fontSize: "clamp(28px,4vw,40px)", letterSpacing: "-0.03em", margin: "0 0 12px" }}>Why ambassadors love this</h2>
              <p style={{ fontSize: 18, lineHeight: 1.55, color: "#5A6473", margin: 0 }}>Everything you gain — nothing you lose.</p>
            </div>
            <div className="a-3grid" style={{ maxWidth: 1160, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
              {[
                { c: "#E7F6EE", ic: "💰", title: "Earn monthly income", body: "Predictable recurring payouts every month your account is active." },
                { c: "#EAF2FC", ic: "🖐️", title: "Completely hands-off", body: "You don't run campaigns, reply to messages, or manage anything — we handle it all." },
                { c: "#E7F6EE", ic: "🎚️", title: "Stay in full control", body: "You stay in control the whole time. After a light 6-month minimum, withdraw whenever you want — no penalties." },
                { c: "#EAF2FC", ic: "🛡️", title: "Safe & protected", body: "Human-paced activity within LinkedIn's limits. Your profile stays protected." },
                { c: "#E7F6EE", ic: "🌐", title: "Grow your network", body: "Real, relevant connections get added as outreach runs on your behalf." },
                { c: "#EAF2FC", ic: "🌙", title: "Even idle accounts pay", body: "Barely use LinkedIn? Accounts you — or family — don't use still earn." },
              ].map((b) => (
                <div key={b.title} className="a-lift" style={{ background: "#fff", border: "1px solid #E7EBE8", borderRadius: 18, padding: "26px 26px 24px", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}>
                  <div style={{ width: 46, height: 46, borderRadius: 13, background: b.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 18 }}>{b.ic}</div>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 600, fontSize: 17, color: "#0B1220", marginBottom: 8 }}>{b.title}</div>
                  <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#5A6473", margin: 0 }}>{b.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* SAFE & CONTROL */}
          <section style={{ background: "#F6FAF7", padding: "64px 24px 68px" }}>
            <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 44px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "#00A150", marginBottom: 14 }}>Safe &amp; in your control</div>
              <h2 style={{ fontFamily: "'Poppins','Montserrat',sans-serif", fontWeight: 700, fontSize: "clamp(28px,4vw,40px)", letterSpacing: "-0.03em", margin: "0 0 12px" }}>Your account always stays yours</h2>
              <p style={{ fontSize: 18, lineHeight: 1.55, color: "#5A6473", margin: 0 }}>Sharing an account doesn&apos;t mean giving it away. Here&apos;s how we keep you protected.</p>
            </div>
            <div className="a-2grid" style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              {[
                { title: "You stay in control", body: "Your name and photo never change. The account is used for professional outreach only." },
                { title: "Protected access", body: "Every account runs through a dedicated proxy and a secure anti-detect browser (GoLogin)." },
                { title: "Nothing posted as you", body: "Renters can't change your profile or post on your behalf." },
                { title: "Low commitment", body: "Just a light 6-month minimum. After that, withdraw your account whenever you want — no penalties." },
              ].map((s) => (
                <div key={s.title} className="a-lift" style={{ display: "flex", gap: 15, alignItems: "flex-start", background: "#fff", border: "1px solid #E7EBE8", borderRadius: 16, padding: "22px 24px", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}>
                  <span style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 11, background: "linear-gradient(150deg,#E4F6EC,#C9EED8)", color: "#067A45", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  <div><div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 600, fontSize: 16, color: "#0B1220", marginBottom: 5 }}>{s.title}</div><p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#5A6473", margin: 0 }}>{s.body}</p></div>
                </div>
              ))}
            </div>
          </section>

          {/* PAYOUTS */}
          <section style={{ background: "#FBFCFB", padding: "64px 24px 8px" }}>
            <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 44px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "#00A150", marginBottom: 14 }}>Payouts</div>
              <h2 style={{ fontFamily: "'Poppins','Montserrat',sans-serif", fontWeight: 700, fontSize: "clamp(28px,4vw,40px)", letterSpacing: "-0.03em", margin: "0 0 12px" }}>Get paid every month — guaranteed</h2>
              <p style={{ fontSize: 18, lineHeight: 1.55, color: "#5A6473", margin: 0 }}>Whether or not we find a renter, you get paid.</p>
            </div>
            <div className="a-4grid" style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18 }}>
              {[
                { icon: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M9 15l2 2 4-4" /></>, bg: "#E7F6EE", fg: "#067A45", label: "Paid monthly", body: "In the first few days of every month — the first working day, since the 1st can fall on a weekend." },
                { icon: <path d="M3 21h18M4 10h16M5 10l7-6 7 6M6 10v11M18 10v11M10 10v11M14 10v11" />, bg: "#EAF2FC", fg: "#0A66C2", label: "Your choice", body: "Bank transfer, straight to an account of your choice." },
                { icon: <><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></>, bg: "#E7F6EE", fg: "#067A45", label: "Guaranteed", body: "Paid even in months your account isn't rented." },
                { icon: <path d="M12 5v14M5 12h14" />, bg: "#EAF2FC", fg: "#0A66C2", label: "Scale up", body: "Add more accounts (yours or family's) for more income." },
              ].map((p) => (
                <div key={p.label} className="a-lift" style={{ textAlign: "center", background: "#fff", border: "1px solid #E7EBE8", borderRadius: 16, padding: "28px 20px", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: p.bg, color: p.fg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{p.icon}</svg>
                  </div>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 600, fontSize: 15, color: "#0B1220", margin: "14px 0 6px" }}>{p.label}</div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "#8A93A2", margin: 0 }}>{p.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* HOW IT WORKS — step flow */}
          <section id="how" style={{ background: "#FBFCFB", padding: "64px 24px 8px" }}>
            <div style={{ maxWidth: 1180, margin: "0 auto 44px", height: 1, background: "#EAEDEA" }} />
            <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 44px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "#00A150", marginBottom: 14 }}>How it works</div>
              <h2 style={{ fontFamily: "'Poppins','Montserrat',sans-serif", fontWeight: 700, fontSize: "clamp(28px,4vw,40px)", letterSpacing: "-0.03em", margin: "0 0 12px" }}>From sign-up to your first payout</h2>
              <p style={{ fontSize: 18, lineHeight: 1.55, color: "#5A6473", margin: 0 }}>Four simple steps. No technical know-how needed.</p>
            </div>
            <div className="a-4grid" style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 22 }}>
              {[
                { n: "1", title: "Get a free valuation", body: "Enter your profile and see what it's worth instantly — no sign-up needed." },
                { n: "2", title: "Share your profile securely", body: "We set up protected, proxy-based access through GoLogin. Your login stays safe." },
                { n: "3", title: "We review & approve", body: "Our team checks the account and lists it for renters — usually within a day or two." },
                { n: "4", title: "Get paid monthly", body: "Earn every month, guaranteed, via bank transfer." },
              ].map((s) => (
                <div key={s.n} className="a-lift" style={{ background: "#fff", border: "1px solid #E7EBE8", borderRadius: 18, padding: "26px 24px 24px", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
                    <span style={{ width: 44, height: 44, borderRadius: 13, background: "linear-gradient(150deg,#00B85C,#068A48)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 18, boxShadow: "0 8px 18px rgba(0,161,80,0.3)" }}>{s.n}</span>
                  </div>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 600, fontSize: 17, color: "#0B1220", marginBottom: 8, lineHeight: 1.25 }}>{s.title}</div>
                  <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#5A6473", margin: 0 }}>{s.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* AFTER YOU SUBMIT */}
          <section style={{ background: "#F6FAF7", padding: "64px 24px 68px", marginTop: 56 }}>
            <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 44px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "#00A150", marginBottom: 14 }}>What&apos;s next</div>
              <h2 style={{ fontFamily: "'Poppins','Montserrat',sans-serif", fontWeight: 700, fontSize: "clamp(28px,4vw,40px)", letterSpacing: "-0.03em", margin: "0 0 12px" }}>After you submit</h2>
              <p style={{ fontSize: 18, lineHeight: 1.55, color: "#5A6473", margin: 0 }}>No mystery — here&apos;s exactly what happens.</p>
            </div>
            <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { n: "1", title: "Instant valuation", body: "You see your estimated monthly value right away." },
                { n: "2", title: "Quick review", body: "Our team verifies the account, usually within a couple of days." },
                { n: "3", title: "You're notified & listed", body: "We let you know it's approved and add it to the marketplace." },
                { n: "4", title: "Earnings begin", body: "You start earning on your next monthly payout." },
              ].map((s) => (
                <div key={s.n} className="a-lift" style={{ display: "flex", gap: 20, alignItems: "center", background: "#fff", border: "1px solid #E7EBE8", borderRadius: 16, padding: "20px 24px", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}>
                  <span style={{ flexShrink: 0, width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(150deg,#00B85C,#068A48)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 15, boxShadow: "0 6px 14px rgba(0,161,80,0.3)" }}>{s.n}</span>
                  <div><div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 600, fontSize: 16.5, color: "#0B1220", marginBottom: 3 }}>{s.title}</div><p style={{ fontSize: 14.5, lineHeight: 1.55, color: "#5A6473", margin: 0 }}>{s.body}</p></div>
                </div>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section id="faq" style={{ background: "#fff", padding: "64px 24px 72px" }}>
            <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 40px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "#00A150", marginBottom: 14 }}>FAQ</div>
              <h2 style={{ fontFamily: "'Poppins','Montserrat',sans-serif", fontWeight: 700, fontSize: "clamp(28px,4vw,40px)", letterSpacing: "-0.03em", margin: 0 }}>Common questions</h2>
            </div>
            <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { q: "Is this allowed? Is it legal?", a: "Completely legal — it's your account, and it's your choice to share access to it if you want to. Everything is consent-based and secure: you decide to take part, you stay in full control, and after a light 6-month minimum you can stop anytime. We only work with vetted businesses using accounts for normal professional outreach." },
                { q: "Is it safe to share my account?", a: "Yes. Access runs through a dedicated proxy and a secure anti-detect browser (GoLogin), and your password is never exposed to renters. They use the account for outreach only — they can never see your login, change your profile, or post as you." },
                { q: "Do I have to share my password?", a: "Your login is only ever used to keep your account secure and running — it's stored safely and never shared with renters, who access the account only through our software. You stay in full control, can change it at any time, and can withdraw your account after a light 6-month minimum. We'll walk you through exactly how access works when you get started." },
                { q: "What will renters use my account for?", a: "Normal B2B outreach — sending connection requests and messages to potential clients. Renters are vetted businesses, and they can never change your profile, post as you, or touch your settings. It's used for outreach only." },
                { q: "Can I still use my account while it's shared?", a: "Yes. You keep full access to your own account at any time, and you can see exactly how it's being used and who's being messaged. Sharing doesn't mean giving it up." },
                { q: "Will this affect my LinkedIn account?", a: "Activity is kept human-paced and within LinkedIn's normal limits to protect the account. Your name stays exactly the same. We may update your photo to a cleaner, professional version that still clearly looks like you, and tweak details like your headline, job or About to keep the profile credible for professional outreach." },
                { q: "What if my account gets restricted?", a: "It's rare — activity is kept human-paced and secure to protect the account. If a restriction ever does happen, we work to recover it, and since it's your own account you're never penalised for it." },
                { q: "How much will I earn?", a: `A ${setupPrice} one-time setup bonus, then ${monthlyPrice} every month your account stays active — the same for every approved account. Have more than one (yours or family's)? Each earns its own bonus and monthly payout. Higher payouts for stronger profiles are coming soon.` },
                { q: "When and how do I get paid?", a: "You're paid every month via bank transfer, in the first few days of the month — on the first working day, since the 1st can fall on a weekend — for as long as your account stays active and stable, even in months it isn't rented." },
                { q: "Do I have to do anything day-to-day?", a: "Nothing. It's completely hands-off — you don't run campaigns, reply to messages, or manage anything. We handle it all." },
                { q: "Can I stop anytime?", a: "We ask for a light 6-month minimum to cover the up-front setup and warm-up we invest in your account. After that, you can withdraw your account at any time — no penalties. You keep your login and full access the whole time, and can always step in sooner if you're ever worried about your account's safety." },
                { q: "Can I submit accounts that aren't mine?", a: "You can submit accounts belonging to family members with their consent — siblings, parents, aunties, uncles. Each approved account earns its own setup bonus and monthly payout." },
              ].map((f, i) => {
                const open = faqOpen === i;
                return (
                  <div key={i} style={{ background: "#fff", border: "1px solid " + (open ? "#9FD9B8" : "#E9ECF0"), borderRadius: 14, boxShadow: open ? "0 6px 20px rgba(16,24,40,0.06)" : "0 1px 2px rgba(16,24,40,0.03)", overflow: "hidden", transition: "border-color .15s, box-shadow .15s" }}>
                    <button onClick={() => setFaqOpen(open ? null : i)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, background: "transparent", border: "none", cursor: "pointer", padding: "20px 22px", textAlign: "left" }}>
                      <span style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 600, fontSize: 16.5, lineHeight: 1.35, color: "#0B1220" }}>{f.q}</span>
                      <span style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 400, lineHeight: 1, color: open ? "#fff" : "#00A150", background: open ? "#00A150" : "#E7F6EE", transition: "all .15s" }}>{open ? "–" : "+"}</span>
                    </button>
                    <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows .28s ease", overflow: "hidden" }}>
                      <div style={{ minHeight: 0, overflow: "hidden" }}><div style={{ padding: "0 22px 22px", fontSize: 15.5, lineHeight: 1.7, color: "#4A5563" }}>{f.a}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* CLOSING CTA */}
          <section style={{ position: "relative", overflow: "hidden", background: "radial-gradient(80% 90% at 50% -10%, rgba(0,184,92,0.30) 0%, rgba(11,32,24,0) 60%), linear-gradient(135deg,#10432C 0%,#0B2018 100%)", padding: "80px 24px", textAlign: "center" }}>
            <div aria-hidden style={{ position: "absolute", width: 520, height: 520, left: "50%", top: -260, transform: "translateX(-50%)", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,184,92,0.22), rgba(0,184,92,0) 65%)", filter: "blur(20px)", pointerEvents: "none", animation: "lvAurA 16s ease-in-out infinite" }} />
            <div style={{ position: "relative" }}>
              <h2 style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 800, fontSize: "clamp(30px,4.5vw,44px)", letterSpacing: "-0.03em", color: "#fff", margin: "0 0 14px" }}>Ready to start earning?</h2>
              <p style={{ fontSize: 18, color: "#B7D4C4", margin: "0 auto 32px", maxWidth: 440 }}>Get a free, instant valuation — no sign-up needed.</p>
              <a href="/onboarding" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 9, background: "#fff", color: "#0B1220", fontSize: 16, fontWeight: 600, padding: "16px 30px", borderRadius: 12, border: "none", cursor: "pointer", boxShadow: "0 16px 40px rgba(0,0,0,0.28)" }}>Rent us your account →</a>
            </div>
          </section>
        </>
      )}

      {/* Logged-in Choice Screen */}
      {step === "logged-in-choice" && (
        <section className="py-6">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-5 md:grid-cols-2">
              <div
                onClick={() => setStep("info")}
                className="group cursor-pointer rounded-2xl border border-gray-200 bg-white p-8 transition-all hover:border-blue-400 hover:shadow-xl hover:shadow-blue-500/5"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
                  <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" /></svg>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-gray-900">Get Your Profile Evaluated</h3>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">Share your LinkedIn details and we&apos;ll assess your profile value.</p>
                <div className="mt-5">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 group-hover:gap-2.5 transition-all">
                    Start Evaluation
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  </span>
                </div>
                <div className="mt-4 inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">Beta</div>
              </div>

              <div
                onClick={() => setStep("account-details")}
                className="group cursor-pointer rounded-2xl border border-gray-200 bg-white p-8 transition-all hover:border-green-400 hover:shadow-xl hover:shadow-green-500/5"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-50">
                  <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-gray-900">Share Your Profile Directly</h3>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">Follow our step-by-step guide to share your LinkedIn profile via GoLogin. It&apos;s quick and free.</p>
                <div className="mt-5">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-600 group-hover:gap-2.5 transition-all">
                    Follow the Steps
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-500">Need help? <a href="https://t.me/linkedvelocity_support_bot" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-medium hover:text-blue-800">Get in touch with our team</a> and we&apos;ll walk you through the process.</p>
            </div>
          </div>
        </section>
      )}

      {/* How It Works */}
      {step !== "choice" && step !== "logged-in-choice" && (
      <section className="py-12">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-start justify-between">
            {[
              { n: "1", title: "Get a Valuation", active: step === "info" || step === "scanning" || step === "result" || step === "bank" || step === "scheduled" || step === "review", done: ["account-details","login","complete","done"].includes(step as string), goTo: "info" as Step, color: "#00A150" },
              { n: "2", title: "Share Your Profile", active: step === "account-details" || step === "login", done: ["complete","done"].includes(step as string), goTo: "account-details" as Step, color: "#00A150" },
              { n: "3", title: "Get Approved", active: step === "complete", done: step === "done", goTo: "complete" as Step, color: "#00A150" },
              { n: "4", title: "Get Paid Monthly", active: false, done: step === "done", goTo: "done" as Step, color: "#00A150" },
            ].map((s, i, arr) => (
              <div key={s.n} className="flex items-start" style={{flex:1}}>
                <div
                  onClick={() => s.done && setStep(s.goTo)}
                  className={`flex flex-col items-center text-center ${s.done ? "cursor-pointer" : ""}`}
                  style={{width:'100%'}}
                >
                  <div
                    className="flex items-center justify-center transition-all"
                    style={{
                      width: 44, height: 44, borderRadius: '50%',
                      background: s.done ? '#00B85C' : s.active ? s.color : '#E8E6E1',
                      color: s.done || s.active ? '#fff' : '#8899A6',
                      fontSize: 16, fontWeight: 700,
                      boxShadow: s.active ? `0 0 0 4px ${s.color}20` : 'none',
                    }}
                  >
                    {s.done ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                    ) : s.n}
                  </div>
                  <p className="mt-2 text-xs font-semibold" style={{color: s.active ? '#0F1419' : s.done ? '#00B85C' : '#8899A6'}}>{s.title}</p>
                </div>
                {i < arr.length - 1 && (
                  <div style={{flex:'0 0 auto',width:40,height:2,background: s.done ? '#00B85C' : '#E8E6E1',marginTop:22,borderRadius:1}} />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
      )}

      {step !== "choice" && (
      <section className="py-16" style={{ background: "#FBFCFB" }}>
        <div className="mx-auto px-4" style={{ maxWidth: step === "info" ? 1120 : 576 }}>
          {error && <div className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}
          <style>{`.ambf-in{width:100%;font-family:'Inter',sans-serif;font-size:15px;color:#0B1220;background:#fff;border:1px solid #DCE3DE;border-radius:11px;padding:13px 14px;outline:none;transition:border-color .15s, box-shadow .15s}.ambf-in:focus{border-color:#00A150;box-shadow:0 0 0 3px rgba(0,161,80,0.14)}.ambf-in::placeholder{color:#A6B0AA}@media(max-width:820px){.ambf-grid{grid-template-columns:1fr!important}.ambf-side{position:static!important}}`}</style>

          {/* STEP 1: Form — new green design (form + sidebar) */}
          {step === "info" && (
            <div>
              <div style={{ textAlign: "center", maxWidth: 600, margin: "0 auto 8px" }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "#00A150", marginBottom: 12 }}>Step 1 · Get a valuation</div>
                <h1 style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: "clamp(28px,4vw,38px)", letterSpacing: "-0.03em", margin: "0 0 10px" }}>Get your profile valuation</h1>
                <p style={{ fontSize: 17, color: "#5A6473", margin: "0 0 6px" }}>We&apos;ll evaluate your profile instantly — free, no obligation.</p>
                <button type="button" onClick={async () => {
                  // Capture the lead (name/email/contact + referral) and go straight to the confirmation
                  // — no valuation, no separate register form. Same clean ending as a completed signup.
                  setError("");
                  if (!form.fullName || !form.email || !form.contactHandle) { setError("Please add your name, email and contact so we can reach you."); return; }
                  if (!form.linkedinUrl.trim() || !/linkedin\.com/i.test(form.linkedinUrl)) { setError("Please add your LinkedIn profile URL (e.g. linkedin.com/in/yourprofile)."); return; }
                  try {
                    await fetch("/api/ambassador/apply", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        fullName: form.fullName,
                        email: form.email,
                        linkedinEmail: form.sameEmailAsProfile ? form.email : (form.linkedinEmail || form.email),
                        contactNumber: `${form.contactMethod}:${form.contactHandle}`,
                        linkedinUrl: cleanLinkedinUrl(form.linkedinUrl),
                        connectionCount: form.connectionCount ? Number(form.connectionCount) : undefined,
                        location: form.location || undefined,
                        referralSource: form.referralSource || undefined,
                        referredBy: form.referredBy || undefined,
                      }),
                    });
                  } catch {}
                  setStep("scheduled");
                }} style={{ background: "none", border: "none", fontSize: 14.5, color: "#0A66C2", fontWeight: 600, cursor: "pointer" }}>Skip valuation for now →</button>
              </div>

              {isPoolRef && (
                <div style={{ maxWidth: 780, margin: "22px auto 0", background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 14, padding: "16px 18px" }}>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, color: "#6D28D9", marginBottom: 6 }}>◆ How your account will be used</div>
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: "#37424F", margin: 0 }}>
                    This account will be used by <b>the referrer</b>. In the event that the referrer already has enough accounts, or is not an {poolBrand} team member, the account will be used for <b>{poolBrand} projects only</b> — it will never be rented to or used by any other company.
                  </p>
                </div>
              )}

              <div className="ambf-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 34, alignItems: "start", marginTop: 34 }}>
                {/* FORM */}
                <form onSubmit={handleSubmit} style={{ background: "#fff", border: "1px solid #E6E8EC", borderRadius: 20, padding: "30px 32px", boxShadow: "0 6px 20px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.04)" }}>
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#66707C" }}>Your details</div>
                    <div style={{ fontSize: 12.5, color: "#5A6473", marginTop: 4 }}>Who we&apos;ll pay and contact.</div>
                  </div>

                  <div style={{ marginBottom: 18 }}>
                    <label style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "#37424F", marginBottom: 7 }}>Your full name <span style={{ color: "#00A150" }}>*</span></label>
                    <input className="ambf-in" type="text" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} required />
                  </div>
                  <div style={{ marginBottom: 18 }}>
                    <label style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "#37424F", marginBottom: 7 }}>Your email <span style={{ color: "#00A150" }}>*</span></label>
                    <input className="ambf-in" type="email" placeholder="you@email.com" value={form.email} onChange={(e) => update("email", e.target.value)} required />
                  </div>

                  <div style={{ marginBottom: 6 }}>
                    <label style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "#37424F", marginBottom: 7 }}>Viber, Telegram or WhatsApp <span style={{ color: "#00A150" }}>*</span></label>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      {(["viber", "telegram", "whatsapp"] as const).map((m) => {
                        const on = form.contactMethod === m;
                        return <button key={m} type="button" onClick={() => update("contactMethod", m)} style={{ flex: 1, cursor: "pointer", fontFamily: "'Inter',sans-serif", fontSize: 14, fontWeight: 600, borderRadius: 10, padding: 11, transition: "all .15s", color: on ? "#067A45" : "#5A6473", background: on ? "#EAF7F0" : "#fff", border: "1.5px solid " + (on ? "#00A150" : "#DCE3DE") }}>{m === "whatsapp" ? "WhatsApp" : m === "telegram" ? "Telegram" : "Viber"}</button>;
                      })}
                    </div>
                    <input className="ambf-in" type="text" value={form.contactHandle} onChange={(e) => update("contactHandle", e.target.value)} placeholder={form.contactMethod === "telegram" ? "@yourhandle" : "+63 917 000 0000"} required />
                    <p style={{ fontSize: 12, lineHeight: 1.55, color: "#5A6473", margin: "9px 0 0" }}>Include your country code. We&apos;ll only contact you about your ambassador accounts or billing — never marketing or spam.</p>
                  </div>

                  <div style={{ height: 1, background: "#EEF0F3", margin: "24px 0" }} />
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#66707C" }}>Your LinkedIn account <span style={{ textTransform: "none", letterSpacing: 0, color: "#A6B0AA" }}>(optional)</span></div>
                    <div style={{ fontSize: 12.5, color: "#5A6473", marginTop: 4 }}>The profile you&apos;re offering.</div>
                  </div>

                  <div style={{ marginBottom: form.linkedinUrl.trim() ? 16 : 6 }}>
                    <label style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "#37424F", marginBottom: 7 }}>LinkedIn profile URL <span style={{ fontWeight: 400, color: "#96A0AD" }}>(optional)</span></label>
                    <input className="ambf-in" type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="linkedin.com/in/yourprofile" value={form.linkedinUrl} onChange={(e) => update("linkedinUrl", e.target.value)} required />
                    <div style={{ fontSize: 12.5, color: "#5A6473", marginTop: 6 }}>Have your profile link? Add it for an instant valuation. No account yet? Leave it blank — we&apos;ll help you get set up.</div>
                    <div style={{ fontSize: 12.5, color: "#5A6473", marginTop: 6 }}>Have more than one account? All payments still go to you — just add the rest after signup.</div>
                  </div>

                  {form.linkedinUrl.trim() && (
                    <>
                      <label style={{ display: "flex", gap: 11, alignItems: "flex-start", cursor: "pointer", margin: "4px 0 12px" }}>
                        <input type="checkbox" checked={form.sameNameAsProfile} onChange={(e) => setForm(prev => ({ ...prev, sameNameAsProfile: e.target.checked }))} style={{ marginTop: 3, accentColor: "#00A150" }} />
                        <span style={{ fontSize: 14, color: "#37424F", lineHeight: 1.4 }}>The LinkedIn profile name is the same as my name above</span>
                      </label>
                      {!form.sameNameAsProfile && (
                        <div style={{ marginBottom: 14 }}>
                          <label style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "#37424F", marginBottom: 7 }}>Name on LinkedIn profile <span style={{ color: "#00A150" }}>*</span></label>
                          <input className="ambf-in" type="text" placeholder="e.g. John Smith" value={form.linkedinProfileName} onChange={(e) => update("linkedinProfileName", e.target.value)} />
                        </div>
                      )}
                      <label style={{ display: "flex", gap: 11, alignItems: "flex-start", cursor: "pointer", marginBottom: 18 }}>
                        <input type="checkbox" checked={form.sameEmailAsProfile} onChange={(e) => setForm(prev => ({ ...prev, sameEmailAsProfile: e.target.checked }))} style={{ marginTop: 3, accentColor: "#00A150" }} />
                        <span style={{ fontSize: 14, color: "#37424F", lineHeight: 1.4 }}>The LinkedIn login email is the same as my email above</span>
                      </label>
                      {!form.sameEmailAsProfile && (
                        <div style={{ marginBottom: 18 }}>
                          <label style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "#37424F", marginBottom: 7 }}>Email used for LinkedIn login <span style={{ color: "#00A150" }}>*</span></label>
                          <input className="ambf-in" type="email" placeholder="linkedin@email.com" value={form.linkedinEmail} onChange={(e) => update("linkedinEmail", e.target.value)} />
                        </div>
                      )}
                    </>
                  )}
                  <div style={{ marginBottom: 26 }}>
                    <label style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "#37424F", marginBottom: 7 }}>How did you hear about us?</label>
                    <select className="ambf-in" value={form.referralSource} onChange={(e) => update("referralSource", e.target.value)}>
                      <option value="">Select an option (optional)</option>
                      <option>Google search</option><option>LinkedIn</option><option>ChatGPT / AI tool</option><option>Social media</option><option>Reddit</option><option>Friend or referral</option><option>Flyer</option><option>Other</option>
                    </select>
                  </div>

                  {/* Referral attribution — always visible & optional. Pre-filled from a marketer's
                      ?ref= QR; anyone else can type a name/code so the marketer still gets credit. */}
                  <div style={{ marginBottom: 26 }}>
                    <label style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "#37424F", marginBottom: 7 }}>Referral code <span style={{ fontWeight: 400, color: "#96A0AD" }}>(optional)</span></label>
                    <input className="ambf-in" type="text" placeholder="If someone referred you, enter their name or code" value={form.referredBy} onChange={(e) => update("referredBy", e.target.value)} />
                  </div>

                  <button type="submit" disabled={submitting} style={{ width: "100%", background: submitting ? "#8FD9B4" : "#00B85C", color: "#fff", fontFamily: "'Inter',sans-serif", fontSize: 16, fontWeight: 600, border: "none", borderRadius: 12, padding: 15, cursor: submitting ? "not-allowed" : "pointer", boxShadow: submitting ? "none" : "0 12px 28px rgba(0,184,92,0.28)" }}>{submitting ? "Sending — one moment…" : form.linkedinUrl.trim() ? "Get my profile valuation →" : "Sign me up →"}</button>
                  <div style={{ textAlign: "center", fontSize: 12.5, color: "#5A6473", marginTop: 12 }}>{form.linkedinUrl.trim() ? "Free · instant · no account required" : "No account needed · we'll set you up"}</div>
                </form>

                {/* SIDEBAR */}
                <div className="ambf-side" style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 24 }}>
                  <div style={{ background: "#0D2A1C", borderRadius: 18, padding: 24 }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#6FCF97", marginBottom: 14 }}>What you&apos;ll earn</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 800, fontSize: 30, color: "#fff" }}>{monthlyPrice}</span>
                      <span style={{ fontSize: 14, color: "#9DC4AE" }}>/month</span>
                    </div>
                    <div style={{ fontSize: 13.5, color: "#9DC4AE", marginTop: 4 }}>plus a {setupPrice} one-time setup bonus.</div>
                    <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "18px 0" }} />
                    {["Paid every month, guaranteed", "You keep full control of your account", "Cancel anytime after a 6-month minimum"].map((t) => (
                      <div key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, color: "#D6E7DD", lineHeight: 1.45, marginBottom: 12 }}><span style={{ color: "#3EF08A", fontWeight: 700 }}>✓</span>{t}</div>
                    ))}
                  </div>

                  <div style={{ background: "#fff", border: "1px solid #E6E8EC", borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}>
                    <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 600, fontSize: 15, marginBottom: 12 }}>What happens after this</div>
                    {[["1", "Instant estimate of your monthly value"], ["2", "Quick review by our team (1–2 days)"], ["3", "Approved, listed, and you start earning"]].map(([n, t]) => (
                      <div key={n} style={{ display: "flex", gap: 11, alignItems: "flex-start", marginBottom: 12 }}>
                        <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: "#E7F6EE", color: "#067A45", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 11 }}>{n}</span>
                        <span style={{ fontSize: 13, color: "#5A6473", lineHeight: 1.5 }}>{t}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, justifyContent: "center", fontSize: 12.5, color: "#5A6473" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    Your details are kept private
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Scanning animation */}
          {step === "scanning" && (
            <div style={{ maxWidth: 520, margin: "0 auto", textAlign: "center", padding: "20px 0 40px" }}>
              <style>{`@keyframes ambSpin{to{transform:rotate(360deg)}}@keyframes ambPulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:.9;transform:scale(1.04)}}`}</style>
              <div style={{ position: "relative", width: 150, height: 150, margin: "0 auto 30px" }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,184,92,0.10), rgba(0,184,92,0) 70%)", animation: "ambPulse 2.4s ease-in-out infinite" }} />
                <div style={{ position: "absolute", inset: 18, borderRadius: "50%", border: "3px solid #E4F1EA", borderTopColor: "#00B85C", borderRightColor: "#00B85C", animation: "ambSpin 1.1s linear infinite" }} />
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#00A150" }}>
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
                </div>
              </div>
              <h2 style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 30, letterSpacing: "-0.02em", margin: "0 0 8px" }}>Assessing your profile</h2>
              <p style={{ fontSize: 16, color: "#8A93A2", margin: "0 0 30px" }}>This will only take a moment…</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 340, margin: "0 auto 34px", textAlign: "left" }}>
                {SCAN_STEPS.map((label, i) => {
                  const done = i < scanIndex, activeS = i === scanIndex;
                  return (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 13 }}>
                      <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: done ? "#067A45" : "#00A150", background: done ? "#E7F6EE" : (activeS ? "transparent" : "#F1F3F2"), border: activeS ? "2.5px solid #E4F1EA" : "none", borderTopColor: activeS ? "#00B85C" : undefined, animation: activeS ? "ambSpin 0.9s linear infinite" : "none" }}>{done ? "✓" : ""}</span>
                      <span style={{ fontSize: 15.5, fontWeight: (done || activeS) ? 600 : 500, color: done ? "#067A45" : (activeS ? "#0B1220" : "#B0B7C2") }}>{label}{done ? "" : "…"}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ maxWidth: 400, margin: "0 auto", height: 8, borderRadius: 999, background: "#EAEFEC", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, (scanIndex / SCAN_STEPS.length) * 100)}%`, borderRadius: 999, background: "linear-gradient(90deg,#00B85C,#00A150)", transition: "width .5s ease" }} />
              </div>
            </div>
          )}

          <CurrencySelector preference={preference} />
          {/* STEP 3: Result & offer — green design */}
          {step === "result" && offer && (
            <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center", padding: "16px 0 40px" }}>
              <div style={{ width: 74, height: 74, margin: "0 auto 22px", borderRadius: "50%", background: "linear-gradient(150deg,#00B85C,#068A48)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 16px 34px rgba(0,161,80,0.32)" }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              </div>
              <h2 style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 32, letterSpacing: "-0.02em", margin: "0 0 8px" }}>Assessment complete</h2>
              <p style={{ fontSize: 17, color: "#8A93A2", margin: "0 0 28px" }}>Here&apos;s what we found{form.fullName ? `, ${form.fullName.split(" ")[0]}` : ""}.</p>

              <div style={{ position: "relative", overflow: "hidden", background: "linear-gradient(160deg,#0D2A1C,#0B2018)", borderRadius: 22, padding: "38px 34px", boxShadow: "0 24px 56px rgba(0,0,0,0.2)" }}>
                <div style={{ position: "absolute", width: 340, height: 340, left: "50%", top: -180, transform: "translateX(-50%)", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,184,92,0.24), rgba(0,184,92,0) 65%)", filter: "blur(16px)", pointerEvents: "none" }} />
                <div style={{ position: "relative" }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#6FCF97", marginBottom: 16 }}>Based on your profile, we&apos;d like to offer you</div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 800, fontSize: "clamp(28px, 6vw, 44px)", lineHeight: 1, letterSpacing: "-0.03em", color: "#fff" }}>{monthlyPrice}</span>
                    <span style={{ fontSize: 20, color: "#9DC4AE", fontWeight: 500 }}>/mo</span>
                  </div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 16, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 999, padding: "6px 14px", fontSize: 13, color: "#D6E7DD" }}>+ {setupPrice} one-time setup bonus</div>
                  <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#9DC4AE", margin: "20px 0 0" }}>Paid via bank transfer in the first few days of each month. Cancel anytime after a 6-month minimum.</p>
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <button onClick={() => { if (!isLoggedIn) { stashSignupPrefill(); window.location.href = "/register?redirect=" + encodeURIComponent("/become-ambassador?booked=1"); return; } setStep("scheduled"); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#00B85C", color: "#fff", fontSize: 16, fontWeight: 600, border: "none", borderRadius: 12, padding: 15, cursor: "pointer", boxShadow: "0 12px 28px rgba(0,184,92,0.28)" }}>Accept &amp; continue →</button>
                <button onClick={() => setStep("review")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", color: "#0B1220", border: "1px solid #DFE3E9", fontSize: 15, fontWeight: 600, borderRadius: 12, padding: 15, cursor: "pointer" }}>Request manual review</button>
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#96A0AD", margin: "18px 0 0" }}>By accepting, you agree to the <a href="/ambassador-terms" target="_blank" rel="noopener noreferrer" style={{ color: "#00A150", fontWeight: 600 }}>Ambassador Agreement</a> (LinkedIn account access &amp; usage terms).</p>
            </div>
          )}

          {/* STEP: Book your onboarding call — green design */}
          {step === "scheduled" && (
            <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center", padding: "16px 0 40px" }}>
              <div style={{ position: "relative", width: 88, height: 88, margin: "0 auto 24px" }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,184,92,0.16), rgba(0,184,92,0) 70%)" }} />
                <div style={{ position: "absolute", inset: 8, borderRadius: "50%", background: "linear-gradient(150deg,#00B85C,#068A48)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 16px 34px rgba(0,161,80,0.34)" }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                </div>
              </div>
              <h2 style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em", margin: "0 0 10px" }}>You&apos;re in{form.fullName ? `, ${form.fullName.split(" ")[0]}` : ""}! 🎉</h2>
              <p style={{ fontSize: 17, lineHeight: 1.6, color: "#5A6473", margin: "0 auto 30px", maxWidth: 460 }}>{form.linkedinUrl.trim() ? "We've got your details. The last step is a quick onboarding call to verify your profile and get you set up to earn." : "We've got your details. The last step is a quick onboarding call — we'll help you get your LinkedIn ready and connected so you can start earning. No account yet? No problem, we'll sort it with you."}</p>

              <a href={bookingUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 11, background: "#00B85C", color: "#fff", fontSize: 16.5, fontWeight: 600, padding: "16px 30px", borderRadius: 14, textDecoration: "none", boxShadow: "0 14px 32px rgba(0,184,92,0.32)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>Book your onboarding call
              </a>

              <div style={{ textAlign: "left", background: "#F6FAF7", border: "1px solid #E1EFE7", borderRadius: 18, padding: "24px 26px", marginTop: 30 }}>
                <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 600, fontSize: 16, color: "#0B1220", marginBottom: 18 }}>What happens on the call</div>
                {(form.linkedinUrl.trim()
                  ? [["1", "We quickly verify your LinkedIn profile."], ["2", "We connect your account securely via GoLogin — you keep full control."], ["3", "You start earning every month it's active."]]
                  : [["1", "We help you get your LinkedIn account ready — if you don't have one yet, we'll set it up with you (takes a few minutes)."], ["2", "We connect it securely via GoLogin — you keep full control."], ["3", "Once it's active (about a week for a brand-new account), you start earning every month."]]
                ).map(([n, t]) => (
                  <div key={n} style={{ display: "flex", gap: 13, alignItems: "flex-start", marginBottom: 16 }}>
                    <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", background: "#E7F6EE", color: "#067A45", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 12 }}>{n}</span>
                    <span style={{ fontSize: 15, lineHeight: 1.55, color: "#37424F" }}>{t}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, flexWrap: "wrap", marginTop: 22 }}>
                {["Takes ~10 minutes", "No cost to apply"].map((t) => (
                  <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "#8A93A2" }}><span style={{ color: "#00A150", fontWeight: 700 }}>✓</span>{t}</span>
                ))}
              </div>
              <a href="/dashboard" style={{ display: "inline-block", marginTop: 26, fontSize: 15, fontWeight: 600, color: "#5A6473", textDecoration: "none" }}>Go to my dashboard →</a>
            </div>
          )}

          {/* STEP: Manual Review Contact Options */}
          {step === "review" && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Request a Manual Review</h2>
              <p className="text-center text-gray-500 mb-6">
                The quickest way is a short call — our team reviews your profile with you and gives you a tailored offer there and then.
              </p>

              <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-center mb-6">
                <a
                  href={bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-green-600 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-green-600/25 hover:bg-green-700 transition-colors"
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                  Book a call
                </a>
                <p className="mt-2.5 text-xs text-gray-500">About 10 minutes. No cost to apply.</p>
              </div>

              <p className="text-center text-sm text-gray-500 mb-4">Or reach us another way:</p>

              <div className="space-y-3">
                <a
                  href="https://wa.me/639399388701"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 text-green-600" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">WhatsApp Us</p>
                    <p className="text-sm text-gray-500">+639399388701</p>
                  </div>
                </a>

                <a
                  href="https://t.me/linkedvelocity_support_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 text-blue-500" fill="currentColor">
                      <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Telegram Us</p>
                    <p className="text-sm text-gray-500">@linkedvelocity_support_bot</p>
                  </div>
                </a>

                <a
                  href="mailto:info@linkedvelocity.com"
                  className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 text-purple-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="M22 4l-10 8L2 4" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Email Us</p>
                    <p className="text-sm text-gray-500">info@linkedvelocity.com</p>
                  </div>
                </a>
              </div>

              <div className="mt-6">
                <Button variant="outline" size="lg" className="w-full" onClick={() => setStep("result")}>
                  Back to Offer
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: Payment details */}
          {step === "bank" && (
            <form onSubmit={handleBankSubmit}>
              <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Payment Details</h2>
              <p className="text-center text-gray-500 mb-6">
                How would you like to receive your {offer ? balancePair(offer.amount, "USD", currency) : ""}/month payment?
              </p>

              {/* Payment method selection */}
              <div className="space-y-3 mb-6">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("usdc")}
                  className={`flex items-center gap-4 w-full rounded-xl border-2 p-5 text-left transition-all ${paymentMethod === "usdc" ? "border-blue-600 bg-blue-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 text-blue-600" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-2h-2v2zm0-4h2V7h-2v6z"/>
                      <text x="7" y="16" fontSize="10" fontWeight="bold" fill="currentColor">$</text>
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">USDC</p>
                    <p className="text-sm text-gray-500">Receive stablecoin to your crypto wallet. Fast, zero fees.</p>
                  </div>
                  <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${paymentMethod === "usdc" ? "border-blue-600" : "border-gray-300"}`}>
                    {paymentMethod === "usdc" && <div className="h-2.5 w-2.5 rounded-full bg-blue-600" />}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("wise")}
                  className={`flex items-center gap-4 w-full rounded-xl border-2 p-5 text-left transition-all ${paymentMethod === "wise" ? "border-blue-600 bg-blue-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Wise</p>
                    <p className="text-sm text-gray-500">Receive to your bank account via Wise. Low fees, great rates.</p>
                  </div>
                  <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${paymentMethod === "wise" ? "border-blue-600" : "border-gray-300"}`}>
                    {paymentMethod === "wise" && <div className="h-2.5 w-2.5 rounded-full bg-blue-600" />}
                  </div>
                </button>
              </div>

              {/* USDC fields */}
              {paymentMethod === "usdc" && (
                <Card>
                  <CardContent className="py-6 space-y-4">
                    <Input
                      id="usdcWalletAddress"
                      label="Wallet Address"
                      placeholder="0x... or ENS name"
                      value={bankForm.usdcWalletAddress}
                      onChange={(e) => updateBank("usdcWalletAddress", e.target.value)}
                    />
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Network</label>
                      <select
                        value={bankForm.usdcNetwork}
                        onChange={(e) => updateBank("usdcNetwork", e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="ethereum">Ethereum (ERC-20)</option>
                        <option value="polygon">Polygon</option>
                        <option value="arbitrum">Arbitrum</option>
                        <option value="base">Base</option>
                        <option value="solana">Solana</option>
                      </select>
                    </div>
                    <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                      Make sure your wallet supports USDC on the selected network. Sending to the wrong network may result in lost funds.
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Wise fields */}
              {paymentMethod === "wise" && (
                <Card>
                  <CardContent className="py-6 space-y-4">
                    <Input
                      id="wiseEmail"
                      label="Wise Email"
                      type="email"
                      placeholder="your@email.com"
                      value={bankForm.wiseEmail}
                      onChange={(e) => updateBank("wiseEmail", e.target.value)}
                    />
                    <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                      We&apos;ll send payment to your Wise account. If you don&apos;t have one yet, <a href="https://wise.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">sign up for free</a>.
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="mt-6 flex gap-3">
                <Button variant="outline" size="lg" type="button" onClick={() => setStep("result")}>
                  Back
                </Button>
                {paymentMethod && (
                  <Button type="submit" loading={loading} className="flex-1" size="lg">
                    Submit &amp; Complete Setup
                  </Button>
                )}
              </div>
            </form>
          )}

          {/* STEP: Account Details */}
          {step === "account-details" && (
            <div className="py-4">
              <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Account Details</h2>
              <p className="text-center text-gray-500 mb-8">Tell us about the LinkedIn account you&apos;re sharing.</p>

              <div className="mx-auto max-w-md space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="Full name on the LinkedIn account"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Email <span className="text-red-500">*</span></label>
                  <input
                    type="email"
                    value={accountEmail}
                    onChange={(e) => setAccountEmail(e.target.value)}
                    placeholder="Email used to log into this LinkedIn account"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">LinkedIn Profile URL <span className="text-red-500">*</span></label>
                  <input
                    type="url"
                    value={accountLinkedinUrl}
                    onChange={(e) => setAccountLinkedinUrl(e.target.value)}
                    placeholder="https://www.linkedin.com/in/yourprofile"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}

                <Button
                  className="w-full"
                  disabled={!accountName || !accountEmail || !accountLinkedinUrl}
                  onClick={async () => {
                    setError("");
                    if (!/\S+@\S+\.\S+/.test(accountEmail)) { setError("Please enter a valid account email address."); return; }
                    if (!/linkedin\.com\/in\//i.test(accountLinkedinUrl)) { setError("Please enter a valid LinkedIn profile URL (e.g. https://www.linkedin.com/in/yourprofile)."); return; }
                    try {
                      const res = await fetch("/api/ambassador/apply", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          fullName: accountName,
                          email: form.email || accountEmail,
                          linkedinEmail: accountEmail,
                          contactNumber: form.contactHandle ? `${form.contactMethod}:${form.contactHandle}` : undefined,
                          linkedinUrl: accountLinkedinUrl,
                          notes: `Account name: ${accountName}. Account email: ${accountEmail}.`,
                        }),
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        // 409 = duplicate, still continue
                        if (res.status !== 409) {
                          console.error("Submission failed:", err);
                        }
                      }
                    } catch (e) {
                      console.error("Submission error:", e);
                    }
                    // Land on the dashboard so the new account shows under "My Submissions" (reviewing).
                    window.location.href = "/dashboard";
                  }}
                >
                  Submit account
                </Button>
              </div>
            </div>
          )}

          {/* STEP 5: Link LinkedIn — two options */}
          {step === "login" && (
            <div className="py-4">
              <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Link Your LinkedIn Account</h2>
              <p className="text-center text-gray-500 mb-8">
                Pick one of the two options below to connect your LinkedIn profile.
              </p>

              {/* Option A: Do it yourself */}
              <Card>
                <CardContent className="py-8">
                  <div className="text-center mb-4">
                    <span className="inline-block rounded-full bg-blue-100 px-4 py-1.5 text-sm font-semibold text-blue-700 mb-4">Option A</span>
                    <h3 className="text-xl font-bold text-gray-900 mb-3">Set It Up Yourself</h3>
                    <p className="text-gray-500">Takes about 5 minutes using GoLogin (free).</p>
                    <div className="mt-4 flex items-center justify-center gap-4">
                      <a href="#" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-purple-50 border border-purple-200 px-4 py-2.5 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" /></svg>
                        Watch Loom Walkthrough
                      </a>
                      <a href="https://scribehow.com/viewer/Share_your_accounts_on_LinkedVelocity__jLAzNyl3SHeWQVy8ISk9BA" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                        See Scribe Guide
                      </a>
                    </div>
                  </div>

                  <hr className="border-gray-200 mb-6" />

                  <div className="space-y-6">
                    {/* Step 1 */}
                    <div className="flex items-start gap-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white flex-shrink-0">1</div>
                      <div>
                        <p className="font-semibold text-gray-900">Sign up to GoLogin</p>
                        <p className="text-sm text-gray-500 mt-1">If you don&apos;t have GoLogin yet, sign up for free at <a href="https://gologin.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-medium hover:text-blue-800">gologin.com</a>. You&apos;ll get a free trial — that&apos;s fine, you only need the free version.</p>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="flex items-start gap-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white flex-shrink-0">2</div>
                      <div>
                        <p className="font-semibold text-gray-900">Create a new profile with this proxy</p>
                        <p className="text-sm text-gray-500 mt-1">Open GoLogin, click &quot;+ New Profile&quot;, and name it after the email of the LinkedIn account you want to share. Then enter the proxy details below:</p>
                        {assignedProxy ? (
                          <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-4 font-mono text-sm space-y-2">
                            <div className="flex justify-between"><span className="text-gray-500">Host:</span><span className="font-semibold text-gray-900">{assignedProxy.host}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Port:</span><span className="font-semibold text-gray-900">{assignedProxy.port}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Username:</span><span className="font-semibold text-gray-900">{assignedProxy.username}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Password:</span><span className="font-semibold text-gray-900">{assignedProxy.password}</span></div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const res = await fetch("/api/ambassador/proxy");
                                const data = await res.json();
                                if (data.proxy) setAssignedProxy(data.proxy);
                              } catch {}
                            }}
                            className="mt-3 inline-flex items-center rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            Show my proxy details
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="flex items-start gap-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white flex-shrink-0">3</div>
                      <div>
                        <p className="font-semibold text-gray-900">Log into your LinkedIn account</p>
                        <p className="text-sm text-gray-500 mt-1">Open the profile you just created in GoLogin. A browser will open — log into your LinkedIn account as you normally would.</p>
                      </div>
                    </div>

                    {/* Step 4 */}
                    <div className="flex items-start gap-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white flex-shrink-0">4</div>
                      <div>
                        <p className="font-semibold text-gray-900">Share the profile with LinkedVelocity</p>
                        <p className="text-sm text-gray-500 mt-1">Close the browser, then in GoLogin right-click the profile → <strong>Share</strong> → set permission to <strong>&quot;Can edit&quot;</strong> → share to:</p>
                        <div className="mt-2 flex items-center gap-2">
                          <code className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white">info@linkedvelocity.com</code>
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard.writeText("info@linkedvelocity.com"); }}
                            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 rounded-lg bg-green-50 border border-green-100 p-4 text-sm text-green-700">
                    <strong>Your password stays private.</strong> By sharing the GoLogin profile with us, we can both access the account without you ever needing to share your LinkedIn password. You stay in control — if you ever want to deactivate your account, simply delete the profile from GoLogin and it will automatically be removed from our system too.
                  </div>

                  <Button size="lg" className="w-full mt-6" onClick={() => setStep("complete")}>
                    I&apos;ve Shared My Profile
                  </Button>
                </CardContent>
              </Card>

              {/* Divider */}
              <div className="flex items-center gap-4 my-8">
                <div className="flex-1 border-t border-gray-200" />
                <span className="text-sm font-medium text-gray-400 uppercase tracking-wide">or</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>

              {/* Option B: Get help from our team */}
              <Card>
                <CardContent className="py-8">
                  <div className="text-center mb-4">
                    <span className="inline-block rounded-full bg-green-100 px-4 py-1.5 text-sm font-semibold text-green-700 mb-4">Option B</span>
                    <h3 className="text-xl font-bold text-gray-900 mb-3">Get Help From Our Team</h3>
                    <p className="text-gray-500">We&apos;ll walk you through it and set everything up together.</p>
                  </div>

                  <hr className="border-gray-200 mb-6" />

                  <div className="space-y-4">
                    <a
                      href="https://linkedvelocity.com/book"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-indigo-300 hover:bg-indigo-50"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 flex-shrink-0">
                        <svg viewBox="0 0 24 24" className="h-6 w-6 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">Book a Meeting</p>
                        <p className="text-sm text-gray-500">Schedule a call with our team</p>
                      </div>
                    </a>

                    <a
                      href="https://wa.me/639399388701"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-green-300 hover:bg-green-50"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 flex-shrink-0">
                        <svg viewBox="0 0 24 24" className="h-6 w-6 text-green-600" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">WhatsApp</p>
                        <p className="text-sm text-gray-500">+639399388701</p>
                      </div>
                    </a>

                    <a
                      href="https://t.me/linkedvelocity_support_bot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-blue-300 hover:bg-blue-50"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 flex-shrink-0">
                        <svg viewBox="0 0 24 24" className="h-6 w-6 text-blue-500" fill="currentColor">
                          <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">Telegram</p>
                        <p className="text-sm text-gray-500">@linkedvelocity_support_bot</p>
                      </div>
                    </a>

                    <a
                      href="mailto:info@linkedvelocity.com"
                      className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-purple-300 hover:bg-purple-50"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 flex-shrink-0">
                        <svg viewBox="0 0 24 24" className="h-6 w-6 text-purple-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="4" width="20" height="16" rx="2" />
                          <path d="M22 4l-10 8L2 4" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">Email</p>
                        <p className="text-sm text-gray-500">info@linkedvelocity.com</p>
                      </div>
                    </a>
                  </div>

                  <p className="text-sm text-gray-400 mt-5 text-center">Our team will guide you through the entire process step by step.</p>
                </CardContent>
              </Card>

              <div className="mt-6">
                <Button size="lg" className="w-full" onClick={() => setStep("complete")}>
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* STEP 6: Waiting for confirmation */}
          {step === "complete" && (
            <div className="py-4">
              <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Almost Done!</h2>
              <p className="text-center text-gray-500 mb-6">
                The LinkedVelocity team is now assessing your profile to ensure everything is in place. We&apos;ll send you an email once it&apos;s approved.
              </p>

              <Card>
                <CardContent className="py-6">
                  <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-center mb-6">
                    <p className="text-base font-semibold text-gray-900">Last step — book your onboarding call</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
                      We can&apos;t set your account up or start your payments until we&apos;ve spoken. It takes about 10 minutes and there&apos;s no cost or commitment — pick a time that suits you now, while it&apos;s in front of you.
                    </p>
                    <a
                      href={bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex items-center justify-center gap-2.5 rounded-xl bg-green-600 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-green-600/25 hover:bg-green-700 transition-colors"
                    >
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                      Book my onboarding call
                    </a>
                  </div>

                  <p className="text-sm text-gray-500 text-center mb-4">Prefer to talk to us another way? You can reach us here:</p>

                  <div className="space-y-3">
                    <a href="https://wa.me/639399388701" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-green-50 hover:border-green-200 transition-all">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100 flex-shrink-0">
                        <svg viewBox="0 0 24 24" className="h-4 w-4 text-green-600" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">WhatsApp</p>
                        <p className="text-xs text-gray-500">+639399388701</p>
                      </div>
                    </a>
                    <a href="https://t.me/linkedvelocity_support_bot" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-blue-50 hover:border-blue-200 transition-all">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 flex-shrink-0">
                        <svg viewBox="0 0 24 24" className="h-4 w-4 text-blue-500" fill="currentColor"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Telegram</p>
                        <p className="text-xs text-gray-500">@linkedvelocity_support_bot</p>
                      </div>
                    </a>
                    <a href="mailto:info@linkedvelocity.com" className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-purple-50 hover:border-purple-200 transition-all">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-100 flex-shrink-0">
                        <svg viewBox="0 0 24 24" className="h-4 w-4 text-purple-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/></svg>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Email</p>
                        <p className="text-xs text-gray-500">info@linkedvelocity.com</p>
                      </div>
                    </a>
                  </div>
                </CardContent>
              </Card>

              <div className="mt-6">
                <Button size="lg" className="w-full" onClick={() => setStep("done")}>
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* STEP 7: Done */}
          {step === "done" && (
            <div className="text-center py-8">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                <svg className="h-10 w-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-3xl font-bold text-gray-900">Start Getting Paid</h2>
              <p className="mt-4 text-lg text-gray-600">
                Once your account is approved, you&apos;ll start getting paid in the first few days of every month.
              </p>

              <Card className="mt-6 text-left">
                <CardContent className="py-6">
                  <h3 className="font-semibold text-gray-900 mb-4">How you get paid</h3>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 flex-shrink-0 mt-0.5">
                        <svg className="h-3.5 w-3.5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">Paid at the start of each month</p>
                        <p className="text-sm text-gray-500">Your agreed amount is paid in the first few days of every month — the first working day, since the 1st can fall on a weekend — for every month your account stays active and stable, directly to your preferred payment method.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 flex-shrink-0 mt-0.5">
                        <svg className="h-3.5 w-3.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">Multiple payment options</p>
                        <p className="text-sm text-gray-500">Receive payment via USDC directly into your LinkedVelocity wallet, or if you prefer an alternative method, our team can accommodate — just let us know.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 flex-shrink-0 mt-0.5">
                        <svg className="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">Cancel anytime after 6 months</p>
                        <p className="text-sm text-gray-500">A light 6-month minimum covers the up-front setup, then you can withdraw your account at any time.</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="mt-6 flex flex-col items-center gap-3">
                <a
                  href={bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-green-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-green-600/25 hover:bg-green-700 transition-colors"
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                  Book my onboarding call
                </a>
                <p className="text-xs text-gray-500">Haven&apos;t booked yet? This is the step that gets you paid.</p>
                <a href="/dashboard" className="mt-1 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors">
                  Go to my dashboard →
                </a>
              </div>
            </div>
          )}
        </div>
      </section>
      )}

      {/* FAQ — only on step 1 */}
      {step === "info" && (
        <section className="bg-white py-20">
          <div className="mx-auto max-w-3xl px-4">
            <h2 className="text-center text-3xl font-bold text-gray-900">Common Questions</h2>
            <div className="mt-12 space-y-8">
              {[
                { q: "Is my account safe?", a: "Yes. Your account is accessed through a secure, isolated browser profile with its own fingerprint and proxy. It looks like normal usage to LinkedIn." },
                { q: "Do I lose access to my own account?", a: "No. Both you and the renter have access to the account at any time through our proprietary software. You can see what they're using it for and who they're messaging. You don't lose access to anything." },
                { q: "How do I get paid?", a: "We pay via bank transfer to a bank of your choice, in the first few days of every month — on the first working day, since the 1st can fall on a weekend — for as long as your account stays active and stable." },
                { q: "Can I stop at any time?", a: "We ask for a light 6-month minimum to cover the up-front setup and warm-up we invest in your account. After that, you can withdraw anytime — just change your password or remove it — and you simply stop being paid for the following month. We'd appreciate a heads up. You always have full access to your account throughout, just like anybody else, and can step in sooner if you're ever worried about its safety." },
              ].map((faq) => (
                <div key={faq.q}>
                  <h3 className="text-lg font-semibold text-gray-900">{faq.q}</h3>
                  <p className="mt-2 text-gray-600">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
