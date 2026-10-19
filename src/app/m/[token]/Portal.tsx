"use client";

import { useEffect, useState } from "react";
import { CurrencySelector, useDisplayCurrency } from "@/components/display-currency";
import { balancePair, configuredText, configuredOffer, offerPair, offerRange } from "@/lib/display-currency";
import { CURRENCY_CONFIG } from "@/lib/referral-currency";

interface BoardRow { name: string; signups: number; converted: number; lifetimeEarnings: string; isMe: boolean; }
interface Activity { kind: string; name: string; referrer: string | null; mine: boolean; date: string; }
type FixIssue = "application_incomplete" | "email_added" | "email_primary" | "twofa" | "password";
interface Signup { id: string; name: string; date: string; whoLabel: string; pill: { text: string; tone: "green" | "blue" | "amber" | "red" }; line: string; sub: string; path: string; fee: string; progress: number; action: "resume" | "onboard" | "clear" | null; kind: "action" | "blocked" | "waiting" | "paid"; fix: { issues: FixIssue[]; state: "open" | "referrer_done" } | null; restricted: boolean; restrictionReport: { type: "qr_done" | "recovered"; at: string } | null; liUrl: string | null; pay: { text: string; sub?: string } | null; journey: { label: string; date: string | null; state: "done" | "now" | "todo" | "warn" }[] | null; onboarded: boolean; deletable: boolean; resumeSessionId: string | null; codeSessionId: string | null; }
interface Payout { id: string; type: string; description: string | null; amount: number; method: string | null; reference: string | null; paidAt: string | null; confirmedAt: string | null; }
interface Tier { base: number; verified: number; }
interface Config { currency: string; symbol: string; offer: { setup: string; monthly: string }; referralTiers: { referral: number; phone: Tier; computer: Tier }; payoutMethods: string[]; defaultPayoutMethod: string; }
interface Data {
  me: { displayCurrency: string; name: string; slug: string; type: string; contactMethod: string | null; contactHandle: string | null; paymentMethod: string | null; paymentDetails: string | null; paymentName: string | null; assignedDay: string | null; assignedLocation: string | null; };
  stats: { signups: number; converted: number; commission: number; rate: number; };
  config: Config;
  board: BoardRow[];
  activity: Activity[];
  signups: Signup[];
  payouts: Payout[];
}

const PAYOUT_LABEL: Record<string, string> = {
  day_rate: "Field day rate",
  commission: "Signup commission",
  bonus: "Bonus",
  other: "Payment",
};

const JAK = "var(--font-jak), system-ui, sans-serif";
const GRO = "var(--font-gro), system-ui, sans-serif";
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Static field content — the offer, how a guided onboarding goes, do/don't, what
// makes a good account, and the two FAQ sets. Kept verbatim from the previous
// single-scroll portal; only the layout around them changed.
const STEPS: { t: string; s: string }[] = [
  { t: "Start together", s: "Stay with the account owner for the whole thing — they need their phone, email and LinkedIn to hand." },
  { t: "Their details", s: "Their name, LinkedIn link and contact, plus a couple of quick eligibility checks." },
  { t: "Payout", s: "Where the account owner gets paid. Your own commission uses your details in “For you”." },
  { t: "Add secure email", s: "They add a LinkedVelocity-managed email to their LinkedIn and confirm the code." },
  { t: "Sign in", s: "Choose computer (you sign in) or phone (hand it to us). This sets what you earn." },
  { t: "Done", s: "We verify the account works, then release setup and your commission." },
];
const DOS = ["Be friendly, casual and quick", "Get them to finish the form or the guided steps", "Stay with them until a call is booked or sign-in is done", "Be honest that payment comes after setup", "Check LinkedIn's minimum age: 16, or older where local law requires"];
const DONTS = ["Pressure anyone — encourage, never force", "Promise cash on the spot", "Collect passwords, PINs or 2FA codes yourself", "Guarantee earnings beyond the offer", "Sign up anyone below LinkedIn's applicable minimum age"];

const TIPS = [
  "They can remove their account any time after a light 6-month minimum — and keep access throughout.",
  "They can view their account any time and see exactly how it's being used.",
  "Their password is never shared with renters — only we have access.",
  "We vet every renter to make sure they're a legitimate business.",
  "They can test it with just one account first to see how it works.",
];

const GOOD_ACCOUNT = [
  "A fresh account is fine. What matters is that it looks like a real person's.",
  "Connections matter. Aim for 50–100, and the more the better. Accounts with very few connections are the most likely to get restricted.",
  "Verified is best, and a passport is the only way to verify. Verifying makes it far less likely to get restricted early on.",
  "If it's fresh, connect with people you actually know who'll accept, and use it (like, comment) so it looks real.",
];
const WARMUP: { t: string; items: string[] }[] = [
  { t: "Complete your profile (the most important one)", items: ["Clear profile photo (a normal headshot)", "Headline, About section and location", "School / education and any work experience (even part-time or internships)", "A few skills"] },
  { t: "Connect with real people you know", items: ["Classmates, former coworkers, friends, people in your field", "Aim for at least 30–50 connections, around five a day, and don't over-add", "Only add people likely to accept, real connections, not random strangers"] },
  { t: "Be active a little each day", items: ["Like a few posts", "Leave one or two genuine comments", "Follow a few companies or pages you're interested in", "Spread it across several days, don't do it all at once"] },
  { t: "Just use it normally for a week", items: [] },
];

const MARKETER_FAQ = [
  { q: "When do I get paid?", a: "You get ₱2,000 for the day, plus ₱500 to ₱1,000 for every sign-up onboarded onto our inventory — you see the exact amount when you choose how to onboard. Commissions release about a week after a sign-up is onboarded, once we've confirmed the account is stable, and are paid the following Monday. A restriction in that window adds a few days." },
  { q: "What counts as a successful sign-up?", a: "The person you signed up gets fully onboarded and their account lands on our inventory — usually confirmed about a week after onboarding, once it's passed our checks. That's when your fee (₱500 to ₱1,000, depending on how it's onboarded) is triggered." },
  { q: "What if someone doesn't qualify?", a: "Thank them and move on. LinkedIn's minimum age is 16, or older where local law requires." },
  { q: "How do I update my payout details?", a: "In the Earnings tab — under “Where we send your money”, save your GCash / bank info so we can pay you." },
  { q: "How do I get invited back?", a: "We track sign-ups per person — strong performers get first pick for the next field days." },
];
const AMBASSADOR_FAQ = [
  { q: "What is LinkedIn?", a: "LinkedIn is like Facebook, but for professionals and businesses — people use it to network, find work, and reach out to potential clients." },
  { q: "Why would a business want to use my account?", a: "LinkedIn limits how many people one account can message or connect with. Businesses need lots of real, established accounts to reach potential clients — so they pay to use accounts like yours." },
  { q: "What will my account be used for?", a: "Two things: sending connection requests and messages to potential clients (outreach), and gathering public professional info like company names and job titles (research). Nothing is ever posted as you." },
  { q: "Is this a scam or illegal?", a: "No — it's completely legal. It's your account and your choice to share access. It does go against LinkedIn's own rules, but that isn't the same as illegal, and everything is consent-based. We only work with vetted, legitimate businesses doing normal professional outreach." },
  { q: "Is it safe? Can you steal my account?", a: "No. You keep recovery access to your own account at all times, and after a light 6-month minimum you can take it back whenever you want — and sooner if you're ever worried about its safety. It's used for professional outreach only." },
  { q: "Will you change anything on my profile?", a: "Your name stays exactly the same, and we never change that. We may polish your profile photo into a cleaner, professional version that still clearly looks like you, and update details like your job title, location, or headline / About to keep the profile credible for professional outreach. It's still your profile." },
  { q: "How much will I earn?", a: "₱500 ($8) to start for a new referred account — paid about a week after setup, once the account is confirmed stable. Then ₱500 ($8) every full month your account stays active, paid in the first few days of the month (the first working day if the 1st is a weekend). Direct self-onboarding has separate signup bonuses based on the setup option chosen." },
  { q: "Can I use a brand-new LinkedIn account?", a: "Yes — new accounts are welcome. It just needs to be about a week old before we pay the setup fee." },
  { q: "Can I still use my account?", a: "Yes. You keep full access, you can see exactly how it's being used, and you can use it yourself any time it isn't being rented." },
  { q: "Do I have to share my password?", a: "Your password is never shared with the renter — they only access the account through our software. We keep it secure so we can quickly sort out any issue with your account for you." },
  { q: "Can my friends or family do it too?", a: "Yes, provided they meet LinkedIn's minimum age: 16, or older where local law requires. Each eligible account earns its own set-up bonus and monthly payout." },
  { q: "What if I want my account back later?", a: "After a light 6-month minimum, reclaim it anytime and the monthly payments simply stop. You keep your login and access the whole time, and can step in sooner if you're ever worried about your account's safety." },
];

const READY_CHECKS = [
  { t: "They stay with you the whole way", s: "LinkedIn sends codes and checks mid-setup. Stopping halfway means nobody gets paid." },
  { t: "They can open their own email and phone", s: "Verification codes and the email confirmation go to them, not you." },
  { t: "They know their LinkedIn password", s: "On a computer you sign in with it while they watch. Keep it in the app only." },
  { t: "They meet LinkedIn's minimum age", s: "16, or older where local law requires." },
  { t: "They have a physical government ID", s: "We never take a copy; they just need one in case LinkedIn asks them to verify later, with a matching name." },
];

const C = {
  pageBg: "#e9ebef", appBg: "#f5f6f8", card: "#fff", line: "#e6e8ec", line2: "#f1f3f6",
  ink: "#0b1220", slate: "#5b6779", muted: "#7b8696", muted2: "#98a2b3",
  green: "#16a34a", greenDk: "#15803d", softGreen: "#f0faf4", softGreenBorder: "#c3ebd2",
  dark: "#0b1220", warn: "#9a3412", warnBg: "#fff7ed", warnBorder: "#fed7aa",
  blueInk: "#1e3a8a", blueBg: "#f1f5ff", blueBorder: "#c7d7fe",
  red: "#b91c1c", redBg: "#fdf0f0", redBorder: "#f5c2c2",
  accBg: "#f0faf4", accFg: "#15803d", pendBg: "#eef1f5", pendFg: "#647189",
  inputBg: "#f7f8fa", inputBorder: "#e3e6ea",
};

type Tab = "home" | "jobs" | "money" | "guide" | "you";

// Filter chips on the "Your onboardings" tab, by signup kind.
type JobFilter = "all" | "action" | "onboarded" | "blocked" | "waiting";
const JOB_FILTERS: { id: JobFilter; label: string; empty: string; test: (s: Signup) => boolean }[] = [
  { id: "all", label: "Everyone", empty: "here", test: () => true },
  // An onboarding only "counts" as onboarded once the setup fee is paid (and the referrer is
  // paid) — before that it's still with us. So "Onboarded" = the paid ones; there's no separate
  // "Paid" chip. Onboarded-but-not-yet-paid accounts sit under "With us" (payout pending).
  { id: "onboarded", label: "Onboarded", empty: "onboarded yet", test: (s) => s.kind === "paid" },
  // A flagged fix (2FA/email/password not set) is the referrer's to-do before they get paid, so
  // it belongs in "Needs you" even while the account's lifecycle pill reads "Verifying" — and it
  // drops out of "With us" so the two buckets don't both claim it.
  { id: "action", label: "Needs you", empty: "needs you right now", test: (s) => s.kind === "action" || (s.kind === "waiting" && !!s.fix) },
  { id: "blocked", label: "Restricted", empty: "restricted", test: (s) => s.kind === "blocked" },
  { id: "waiting", label: "With us", empty: "waiting on us", test: (s) => s.kind === "waiting" && !s.fix },
];

// Post-sign-in fixes the team can raise on a signup — what the referrer needs to sort out.
const FIX_INFO: Record<FixIssue, { title: string; how: string }> = {
  application_incomplete: { title: "Application not complete", how: "Continue this account’s onboarding wizard: add and verify the assigned Ortus / LinkedVelocity email, set it as primary, and complete 2FA. Alternatively, book a meeting with our team at https://calendly.com/linkedvelocity-info/30min for help finishing setup." },
  email_added: { title: "Our email isn't on the account yet", how: "In LinkedIn: Settings → Sign in & security → Email addresses → Add email address. Add the LinkedVelocity email we gave you. LinkedIn sends it a confirmation link (we receive it), then set it as PRIMARY." },
  email_primary: { title: "Our email isn't set as Primary", how: "In LinkedIn: Settings → Sign in & security → Email addresses. Set the LinkedVelocity email as the PRIMARY one — not just added. It has to be primary or we can't keep the account signed in." },
  twofa: { title: "Two-step verification isn't set up", how: "In LinkedIn: Settings → Sign in & security → Two-step verification → Authenticator app. Use the setup key from onboarding (the wizard shows the code to finish it)." },
  password: { title: "The account password isn't working", how: "Confirm the exact current LinkedIn password with them (watch for typos or a recent change). If unsure, reset it in Settings → Sign in & security → Change password, then send us the working password." },
};

// The owner clears a LinkedIn restriction themselves on their own phone — steps for the sheet.
const LOCK_STEPS = [
  { t: "They open LinkedIn on their own phone", s: "The lock screen appears as soon as they try to use the account." },
  { t: "They follow the check LinkedIn asks for", s: "Usually scanning a QR code, sometimes a selfie or an ID photo." },
  { t: "Wait for the confirmation", s: "Minutes for a QR scan, up to a day or two for an ID review." },
  { t: "Come back and finish the sign-in", s: "Nothing you entered is lost — the onboarding resumes where it stopped." },
];

export default function Portal({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const preference = useDisplayCurrency(token, data?.me.displayCurrency, token);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [tab, setTab] = useState<Tab>("home");
  const [form, setForm] = useState({ contactMethod: "WhatsApp", contactHandle: "", paymentMethod: "GCash", paymentDetails: "", paymentName: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [jobQuery, setJobQuery] = useState("");
  const [lockName, setLockName] = useState<string | null>(null);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [faqOpen, setFaqOpen] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmErr, setConfirmErr] = useState("");
  // The one signup whose "latest sign-in code" panel is expanded, plus the code we
  // fetched for it. Codes are pulled on demand from the onboarding session, so the
  // referrer can grab one without walking the wizard.
  const [codeOpenId, setCodeOpenId] = useState<string | null>(null);
  const [codeInfo, setCodeInfo] = useState<{ code: string | null; at: string | null; loading: boolean; error: string; copied: boolean }>({ code: null, at: null, loading: false, error: "", copied: false });
  // The authenticator (2FA) code for a restricted referred account — the TOTP the owner needs to
  // sign in and run LinkedIn's identity check. Separate from the emailed code panel above.
  const [authOpenId, setAuthOpenId] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState<{ code: string | null; loading: boolean; error: string; copied: boolean }>({ code: null, loading: false, error: "", copied: false });

  useEffect(() => {
    fetch(`/api/m/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Data) => {
        setData(d);
        setForm({
          contactMethod: d.me.contactMethod || "WhatsApp",
          contactHandle: d.me.contactHandle || "",
          paymentMethod: d.me.paymentMethod && d.config.payoutMethods.includes(d.me.paymentMethod)
            ? d.me.paymentMethod
            : d.config.defaultPayoutMethod,
          paymentDetails: d.me.paymentDetails || "",
          paymentName: d.me.paymentName || d.me.name || "",
        });
        setState("ok");
      })
      .catch(() => setState("notfound"));
  }, [token]);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await fetch(`/api/m/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };
  // Referrer marks a raised fix as done → the team rechecks. Optimistically flip to done.
  const markFixed = async (applicationId: string) => {
    setFixingId(applicationId);
    try {
      await fetch(`/api/m/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "fixDone", applicationId }) });
      setData((d) => d && ({ ...d, signups: d.signups.map((s) => s.id === applicationId && s.fix ? { ...s, fix: { ...s.fix, state: "referrer_done" } } : s) }));
    } finally { setFixingId(null); }
  };
  // Referrer reports on a restriction: the owner did LinkedIn's QR/ID check, or it's
  // already unrestricted. We only tell the team to verify — it doesn't clear it here.
  const reportRestriction = async (applicationId: string, type: "qr_done" | "recovered") => {
    setReportingId(applicationId);
    try {
      await fetch(`/api/m/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restrictionReport", applicationId, type }) });
      setData((d) => d && ({ ...d, signups: d.signups.map((s) => s.id === applicationId ? { ...s, restrictionReport: { type, at: new Date().toISOString() } } : s) }));
      setLockName(null);
    } finally { setReportingId(null); }
  };
  // Delete one of the referrer's own signups (only offered before onboarding finishes /
  // any payment — the server enforces the same). Drops it from the list on success.
  const deleteApplication = async (applicationId: string) => {
    setDeletingId(applicationId);
    try {
      const res = await fetch(`/api/m/${token}?applicationId=${encodeURIComponent(applicationId)}`, { method: "DELETE" });
      if (!res.ok) { const b = await res.json().catch(() => ({})); alert(b.error || "Could not delete this signup. Please try again."); return; }
      setDeleteId(null);
      setData((d) => d && ({ ...d, signups: d.signups.filter((s) => s.id !== applicationId) }));
    } finally { setDeletingId(null); }
  };
  // Pull the latest LinkedIn sign-in code for one signup's onboarding session. Reuses the
  // onboarding GET, which only returns a code while forwarding is live (pre-onboarding).
  const loadCode = async (sessionId: string) => {
    setCodeInfo((c) => ({ ...c, loading: true, error: "", copied: false }));
    try {
      const r = await fetch(`/api/m/${token}/onboarding?id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setCodeInfo({ code: null, at: null, loading: false, error: b.error || "Couldn't load the code. Please try again.", copied: false }); return; }
      const es = b.session?.emailSetup;
      setCodeInfo({ code: es?.latestCode ?? null, at: es?.latestCodeAt ?? null, loading: false, error: "", copied: false });
    } catch {
      setCodeInfo({ code: null, at: null, loading: false, error: "Check your connection and try again.", copied: false });
    }
  };
  const toggleCode = (sessionId: string, signupId: string) => {
    if (codeOpenId === signupId) { setCodeOpenId(null); return; }
    setCodeOpenId(signupId);
    void loadCode(sessionId);
  };
  // Generate the live authenticator code for a restricted referred account (TOTP from the saved key).
  const loadAuthCode = async (applicationId: string) => {
    setAuthCode((c) => ({ ...c, loading: true, error: "", copied: false }));
    try {
      const r = await fetch(`/api/m/${token}/code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setAuthCode({ code: null, loading: false, error: b.error || "Couldn't get the code. Please try again.", copied: false }); return; }
      setAuthCode({ code: b.code ?? null, loading: false, error: "", copied: false });
    } catch {
      setAuthCode({ code: null, loading: false, error: "Check your connection and try again.", copied: false });
    }
  };
  const toggleAuth = (applicationId: string) => {
    if (authOpenId === applicationId) { setAuthOpenId(null); return; }
    setAuthOpenId(applicationId);
    void loadAuthCode(applicationId);
  };
  const toggleFaq = (k: string) => setFaqOpen((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const go = (t: Tab) => { setTab(t); if (typeof window !== "undefined") window.scrollTo({ top: 0 }); };

  // Confirming is deliberately a two-step (button → type your name → confirm) so it
  // can't be tapped by accident. Once sent it can't be undone from this side.
  const confirmPayout = async (id: string) => {
    setConfirming(true); setConfirmErr("");
    try {
      const res = await fetch(`/api/m/${token}/payouts/${id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedBy: confirmName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setConfirmErr(body.error || "Couldn't confirm — please try again."); return; }
      setData((d) => d && ({ ...d, payouts: d.payouts.map((p) => p.id === id ? { ...p, confirmedAt: body.confirmedAt || new Date().toISOString() } : p) }));
      setConfirmId(null); setConfirmName("");
    } catch {
      setConfirmErr("Couldn't confirm — check your connection and try again.");
    } finally { setConfirming(false); }
  };

  const outer: React.CSSProperties = { minHeight: "100vh", background: C.pageBg, display: "flex", justifyContent: "center", fontFamily: JAK, color: C.ink };

  if (state === "loading") return <div style={{ ...outer, alignItems: "center", color: C.muted }}>Loading…</div>;
  if (state === "notfound" || !data) return (
    <div style={{ ...outer, alignItems: "center", padding: 24 }}>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, textAlign: "center", maxWidth: 360 }}>
        <div style={{ font: `700 18px ${GRO}`, marginBottom: 8 }}>Link not found</div>
        <div style={{ color: C.muted, fontSize: 14 }}>This dashboard link isn&apos;t valid. Ask your LinkedVelocity contact for your correct link.</div>
      </div>
    </div>
  );

  const { me, stats, board, activity, signups, payouts, config } = data;
  const actualCurrency = config.currency === "USD" ? "USD" : "PHP";
  const money = (n: number) => balancePair(n, actualCurrency, preference.currency);
  const offerMoney = (n: number) => configuredOffer(n, actualCurrency, preference.currency);
  const moneyText = (text: string) => configuredText(text, preference.currency);
  const setupOffer = configuredOffer(CURRENCY_CONFIG[actualCurrency].setupAmount, actualCurrency, preference.currency);
  const monthlyOffer = configuredOffer(CURRENCY_CONFIG[actualCurrency].monthlyAmount, actualCurrency, preference.currency);
  const firstName = me.name.split(" ")[0];
  const initial = (me.name.trim()[0] || "?").toUpperCase();
  // Pool referrers (Ortus / Apex) see the portal branded accordingly; everything else stays
  // shared so any common wording/feature change here applies to all. Only the label varies.
  const brand = me.type === "ortus" ? "Ortus" : me.type === "apex" ? "Apex" : "LinkedVelocity";
  const isPoolRef = me.type === "ortus" || me.type === "apex";

  // DIY (guided) onboarding payout tiers: base = referral we onboard, high = DIY verified.
  const base = offerMoney(stats.rate);
  const diyHigh = offerMoney(stats.rate * 2);
  // Tiered referral commission for display (locked at onboarding by method + verified).
  const tiers = config.referralTiers;
  const tierRange = (t: Tier) => `${offerMoney(t.base)}–${offerMoney(t.verified)}`;

  const P = CURRENCY_CONFIG.PHP, U = CURRENCY_CONFIG.USD;
  const dualVal = (usd: number, php: number, _primary: string) => offerPair(usd, php, preference.currency);
  const dualRange = (usdLo: number, usdHi: number, phpLo: number, phpHi: number, _primary: string) => offerRange(usdLo, usdHi, phpLo, phpHi, preference.currency);
  const baseD = dualVal(U.referralTiers.referral, P.referralTiers.referral, base);
  const rangeD = dualRange(U.referralTiers.referral, U.referralTiers.computer.verified, P.referralTiers.referral, P.referralTiers.computer.verified, `${base}–${diyHigh}`);
  const guidedRangeD = dualRange(U.referralTiers.phone.base, U.referralTiers.computer.verified, P.referralTiers.phone.base, P.referralTiers.computer.verified, "");
  const tierRangeD = (key: "phone" | "computer") =>
    dualRange(U.referralTiers[key].base, U.referralTiers[key].verified, P.referralTiers[key].base, P.referralTiers[key].verified, tierRange(tiers[key]));
  // Single-value display for the rate breakdown table (method × verified).
  const cellD = (key: "phone" | "computer", v: "base" | "verified") =>
    dualVal(U.referralTiers[key][v], P.referralTiers[key][v], offerMoney(tiers[key][v]));

  // For non-PH (USD) referrers, rewrite the money/method-bearing FAQ answers.
  const faqOverrides: Record<string, string> = {
    "When do I get paid?": `You get ${base} to ${diyHigh} for every sign-up onboarded onto our inventory — you see the exact amount when you choose how to onboard. Commissions release about a week after onboarding, once we've confirmed the account is stable, and are paid the following Monday. A restriction in that window adds a few days.`,
    "What counts as a successful sign-up?": `The person you signed up gets fully onboarded and their account lands on our inventory — usually confirmed about a week after onboarding, once it's passed our checks. That's when your fee (${base} to ${diyHigh}, depending on how it's onboarded) is triggered.`,
    "How do I update my payout details?": `In the Earnings tab — under "Where we send your money", save your ${config.defaultPayoutMethod} / bank info so we can pay you.`,
    "How much will I earn?": `${setupOffer} to start — paid to your account about a week after setup, once the account is confirmed stable. Then ${monthlyOffer} every full month your account stays active, paid in the first few days of the month (the first working day if the 1st is a weekend). Your monthly payments start from your first full month; the ${setupOffer} covers your first partial month, so you're never short-changed.`,
  };
  const applyFaq = (items: { q: string; a: string }[]) => items.map((f) => faqOverrides[f.q] ? { ...f, a: faqOverrides[f.q] } : f);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const myLink = `${origin}/r/${me.slug}`;
  const myLinkShort = myLink.replace(/^https?:\/\//, "");
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=440x440&margin=0&data=${encodeURIComponent(myLink)}`;
  const ranked = board.slice().sort((a, b) => b.converted - a.converted || b.signups - a.signups);
  const myRank = ranked.findIndex((b) => b.isMe) + 1;
  const topFive = ranked.slice(0, 5);
  const myBoardRow = ranked.find((b) => b.isMe);
  const copyLink = () => { navigator.clipboard?.writeText(myLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); };

  const paidTotal = payouts.filter((p) => p.confirmedAt).reduce((s, p) => s + p.amount, 0);
  const pendingCount = activity.filter((a) => a.kind !== "converted").length;

  // shared style helpers
  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 17px", marginBottom: 12 };
  const h1: React.CSSProperties = { font: `600 22px ${GRO}`, color: C.ink, margin: "2px 0 4px", letterSpacing: "-.01em" };
  const lead: React.CSSProperties = { font: `500 12.5px/1.5 ${JAK}`, color: C.slate, margin: "0 0 16px" };
  const cardTitle: React.CSSProperties = { font: `700 14px ${JAK}`, color: C.ink, marginBottom: 4 };
  const secLbl: React.CSSProperties = { font: `700 11px ${JAK}`, letterSpacing: ".07em", textTransform: "uppercase", color: C.muted2 };
  const inp: React.CSSProperties = { flex: 1, minWidth: 0, background: C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 10, padding: "12px 13px", font: `500 13.5px ${JAK}`, color: C.ink, outline: "none" };
  const selWrap: React.CSSProperties = { position: "relative", flex: "none", width: 136 };
  const sel: React.CSSProperties = { width: "100%", appearance: "none", WebkitAppearance: "none", background: C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 10, padding: "12px 30px 12px 12px", font: `600 13px ${JAK}`, color: C.ink, cursor: "pointer" };
  const chev: React.CSSProperties = { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", font: `600 10px ${JAK}`, color: C.slate };

  const faqBlock = (items: { q: string; a: string }[], prefix: string) => items.map((f, i) => {
    const k = prefix + i, open = faqOpen.has(k);
    return (
      <div key={k} style={{ borderTop: `1px solid ${C.line2}` }}>
        <div onClick={() => toggleFaq(k)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 0", cursor: "pointer", userSelect: "none" }}>
          <span style={{ font: `600 13.5px/1.35 ${JAK}`, color: C.ink }}>{f.q}</span>
          <span style={{ marginLeft: "auto", flex: "none", font: `600 12px ${JAK}`, color: C.muted2, transition: "transform .18s ease", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
        </div>
        {open && <div style={{ padding: "0 0 13px" }}><p style={{ font: `500 13px/1.55 ${JAK}`, color: C.muted, margin: 0 }}>{f.a}</p></div>}
      </div>
    );
  });

  const tabDef: { id: Tab; icon: string; label: string }[] = [
    { id: "home", icon: "◆", label: "Today" },
    { id: "jobs", icon: "☰", label: "Signups" },
    { id: "money", icon: preference.currency === "USD" ? "$" : "₱", label: "Earnings" },
    { id: "guide", icon: "?", label: "What to say" },
    { id: "you", icon: "☺", label: "For you" },
  ];

  return (
    <div style={outer}>
      <div style={{ width: "100%", maxWidth: 440, background: C.appBg, minHeight: "100vh", position: "relative", paddingBottom: 92 }}>

        {/* top bar */}
        <div style={{ position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", background: C.dark }}>
          <div style={{ width: 20, height: 20, borderRadius: 6, backgroundImage: "linear-gradient(135deg,#34d399,#16a34a)" }} />
          <span style={{ font: `700 14px ${JAK}`, color: "#fff" }}>{brand}</span>
          <span style={{ font: `700 9px ${JAK}`, letterSpacing: ".09em", color: "#a7f3d0", border: "1px solid #1f6f47", background: "#0f2b1e", padding: "3px 7px", borderRadius: 6 }}>REFERRER</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, font: `600 12.5px ${JAK}`, color: "#cbd5e1" }}>{firstName}
            <span style={{ width: 26, height: 26, borderRadius: 999, background: "#1e293b", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: `700 11px ${JAK}` }}>{initial}</span>
          </span>
        </div>

        <CurrencySelector preference={preference} />

        {/* ============ TODAY ============ */}
        {tab === "home" && (
          <div style={{ padding: "20px 18px 0" }}>
            <h1 style={{ font: `600 25px/1.15 ${GRO}`, color: C.ink, margin: "0 0 5px", letterSpacing: "-.02em" }}>Hi, {firstName} 👋</h1>
            <p style={{ ...lead, margin: "0 0 16px" }}>
              {me.assignedDay || me.assignedLocation
                ? <>You&apos;re on for <b style={{ color: C.ink }}>{[me.assignedDay, me.assignedLocation].filter(Boolean).join(" · ")}</b>. Two ways to earn — onboarding them yourself pays more.</>
                : "Two ways to earn today — onboarding them yourself pays more."}
            </p>

            {isPoolRef && (
              <div style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
                <div style={{ font: `700 13.5px ${JAK}`, color: "#6d28d9", marginBottom: 6 }}>◆ How your {brand} accounts are used</div>
                <p style={{ font: `500 12.5px/1.55 ${JAK}`, color: C.ink, margin: 0 }}>
                  Every account you bring on goes into the <b>{brand} pool</b> — reserved for {brand} projects and looked after by the {brand} team.
                </p>
                <p style={{ font: `500 12.5px/1.55 ${JAK}`, color: C.ink, margin: "8px 0 0" }}>
                  Your accounts are <b>never listed in the general inventory and never rented to other companies</b>. They are only ever used for {brand} projects.
                </p>
              </div>
            )}

            {(() => {
              const needFix = signups.filter((s) => s.fix && s.fix.state === "open");
              if (needFix.length === 0) return null;
              return (
                <button onClick={() => go("jobs")} style={{ display: "block", width: "100%", textAlign: "left", background: C.warnBg, border: `1px solid ${C.warnBorder}`, borderRadius: 14, padding: "13px 15px", marginBottom: 12, cursor: "pointer" }}>
                  <div style={{ font: `700 13.5px ${JAK}`, color: C.warn, marginBottom: 2 }}>⚠ {needFix.length === 1 ? "1 onboarding needs" : `${needFix.length} onboardings need`} a quick fix</div>
                  <div style={{ font: `500 12px/1.45 ${JAK}`, color: "#9a5b2a" }}>Something&apos;s stopping payment on {needFix.length === 1 ? needFix[0].name : "some of your signups"}. Tap to see what to fix →</div>
                </button>
              );
            })()}

            {/* stats (dark) */}
            <div style={{ background: C.dark, borderRadius: 18, padding: 18, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: "#34d399" }} />
                <span style={{ font: `700 11px ${JAK}`, letterSpacing: ".06em", textTransform: "uppercase", color: "#6ee7b7" }}>Your totals</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
                {[{ v: String(stats.signups), l: "Referred", c: "#fff" }, { v: String(stats.converted), l: "Onboarded", c: "#6ee7b7" }, { v: money(stats.commission), l: "Est. earned", c: "#fff" }].map((t, i) => (
                  <div key={t.l} style={{ display: "flex", alignItems: "flex-end", gap: 14, minWidth: 0 }}>
                    {i > 0 && <div style={{ width: 1, height: 38, background: "#1e293b" }} />}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: `600 26px/1 ${GRO}`, color: t.c, fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
                      <div style={{ font: `600 11.5px ${JAK}`, color: "#94a3b8", marginTop: 5 }}>{t.l}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ font: `500 11.5px/1.45 ${JAK}`, color: "#7c8799", margin: "12px 0 0" }}>Referred means they signed up. Onboarded means the account is done and checked — that&apos;s the one that pays, whoever ran it.</p>
            </div>

            {/* guided onboarding hero */}
            <div style={{ position: "relative", overflow: "hidden", backgroundImage: "linear-gradient(155deg,#18a957 0%,#15803d 55%,#116e35 100%)", borderRadius: 20, padding: "21px 20px", marginBottom: 12, boxShadow: "0 18px 34px -20px rgba(17,110,53,.95)" }}>
              <div style={{ position: "absolute", top: -70, right: -50, width: 190, height: 190, borderRadius: 999, background: "rgba(255,255,255,.09)" }} />
              <div style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 11 }}>
                  <span style={{ font: `700 10px ${JAK}`, letterSpacing: ".09em", textTransform: "uppercase", color: "#bbf7d0" }}>Guided onboarding</span>
                  <span style={{ font: `700 9.5px ${JAK}`, letterSpacing: ".05em", textTransform: "uppercase", color: C.ink, background: "#a7f3d0", padding: "3px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>Pays most</span>
                </div>
                <div style={{ font: `600 24px/1.2 ${GRO}`, color: "#fff", letterSpacing: "-.015em", marginBottom: 8 }}>{guidedRangeD}<br />per person you onboard</div>
                <p style={{ font: `500 13px/1.5 ${JAK}`, color: "rgba(255,255,255,.88)", margin: "0 0 16px" }}>Stay with the account owner and follow the guided steps together. Highest pay, and it&apos;s all recorded to your code as you go.</p>
                <button onClick={() => setReadyOpen(true)} style={{ width: "100%", font: `700 15.5px ${JAK}`, color: C.greenDk, background: "#fff", border: "none", padding: 16, borderRadius: 13, cursor: "pointer", boxShadow: "0 8px 18px -10px rgba(0,0,0,.4)" }}>Start guided onboarding →</button>
                <div style={{ display: "flex", gap: 6, marginTop: 13 }}>
                  {[{ a: tierRangeD("phone"), l: "Phone — we sign in" }, { a: tierRangeD("computer"), l: "Computer — you sign in" }].map((t) => (
                    <div key={t.l} style={{ flex: 1, background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.22)", borderRadius: 10, padding: "9px 8px", textAlign: "center" }}>
                      <div style={{ font: `600 14px ${GRO}`, color: "#fff" }}>{t.a}</div>
                      <div style={{ font: `600 9.5px/1.25 ${JAK}`, color: "rgba(255,255,255,.8)", marginTop: 3 }}>{t.l}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "rgba(0,0,0,.2)", borderRadius: 11, padding: 12, marginTop: 12 }}>
                  <span style={{ font: `700 12px ${JAK}`, color: "#bbf7d0", flex: "none" }}>i</span>
                  <span style={{ font: `500 12px/1.45 ${JAK}`, color: "#eafbf1" }}>The final sign-in needs a computer. No computer today? Choose &ldquo;hand it to us&rdquo; and we finish it — they still get paid, you earn a little less.</span>
                </div>
              </div>
            </div>

            {/* what sets the rate — method × verified, right under the hero tiles */}
            <div style={card}>
              <div style={cardTitle}>What sets your rate</div>
              <p style={{ font: `500 12px/1.5 ${JAK}`, color: C.muted, margin: "0 0 12px" }}>Two things decide the amount, locked in when the account is onboarded.</p>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", font: `600 10.5px ${JAK}`, color: C.muted, padding: "0 6px 7px", borderBottom: `1px solid ${C.line}` }}>Who signs in</th>
                    <th style={{ textAlign: "right", font: `600 10.5px ${JAK}`, color: C.muted, padding: "0 6px 7px", borderBottom: `1px solid ${C.line}` }}>Not verified</th>
                    <th style={{ textAlign: "right", font: `600 10.5px ${JAK}`, color: C.muted, padding: "0 6px 7px", borderBottom: `1px solid ${C.line}` }}>Verified</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ font: `600 12px ${JAK}`, color: C.ink, padding: "9px 6px", borderBottom: `1px solid ${C.line2}` }}>Phone — we sign in</td>
                    <td style={{ font: `600 12.5px ${JAK}`, color: C.slate, textAlign: "right", padding: "9px 6px", borderBottom: `1px solid ${C.line2}` }}>{cellD("phone", "base")}</td>
                    <td style={{ font: `700 12.5px ${JAK}`, color: C.greenDk, textAlign: "right", padding: "9px 6px", borderBottom: `1px solid ${C.line2}` }}>{cellD("phone", "verified")}</td>
                  </tr>
                  <tr>
                    <td style={{ font: `600 12px ${JAK}`, color: C.ink, padding: "9px 6px" }}>Computer — you sign in</td>
                    <td style={{ font: `600 12.5px ${JAK}`, color: C.slate, textAlign: "right", padding: "9px 6px" }}>{cellD("computer", "base")}</td>
                    <td style={{ font: `700 12.5px ${JAK}`, color: C.greenDk, textAlign: "right", padding: "9px 6px" }}>{cellD("computer", "verified")}</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ font: `500 11.5px/1.5 ${JAK}`, color: C.muted, marginTop: 11 }}>
                <strong style={{ color: C.slate }}>Sign-in method:</strong> doing the final sign-in yourself on a computer pays more than handing it to us on a phone. <strong style={{ color: C.slate }}>Verified:</strong> the account has passed LinkedIn&apos;s ID verification — verified accounts rent for more and are safer from restrictions, so they pay the higher amount.
              </div>
            </div>

            {/* send the form */}
            <div style={card}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 5 }}>
                <div style={{ font: `700 15.5px/1.3 ${JAK}`, color: C.ink }}>Just send them the form</div>
                <span style={{ marginLeft: "auto", flex: "none", font: `700 11px ${JAK}`, color: C.greenDk, background: C.softGreen, border: `1px solid ${C.softGreenBorder}`, padding: "5px 9px", borderRadius: 6, whiteSpace: "nowrap" }}>{baseD}</span>
              </div>
              <p style={{ font: `500 13px/1.5 ${JAK}`, color: C.slate, margin: "0 0 13px" }}>Can&apos;t onboard them now? They fill in your form and a LinkedVelocity team member takes it from there.</p>
              <div style={{ display: "flex", gap: 9 }}>
                <button onClick={copyLink} style={{ flex: 1, font: `700 13.5px ${JAK}`, color: C.ink, background: "#f1f3f6", border: `1px solid ${C.inputBorder}`, padding: 13, borderRadius: 12, cursor: "pointer" }}>{linkCopied ? "Copied ✓" : "Send my link"}</button>
                <button onClick={() => setQrOpen(true)} style={{ flex: 1, font: `700 13.5px ${JAK}`, color: C.ink, background: "#f1f3f6", border: `1px solid ${C.inputBorder}`, padding: 13, borderRadius: 12, cursor: "pointer" }}>Show my QR</button>
              </div>
              <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: C.warnBg, border: `1px solid ${C.warnBorder}`, borderRadius: 11, padding: 12, marginTop: 11 }}>
                <span style={{ font: `700 13px ${JAK}`, color: "#c2410c", flex: "none" }}>!</span>
                <span style={{ font: `600 12.5px/1.45 ${JAK}`, color: C.warn }}>A form with no booked call almost never gets onboarded — and unonboarded means unpaid. Stay with them until a call is picked.</span>
              </div>
              <div style={{ marginTop: 11, paddingTop: 11, borderTop: `1px solid ${C.line2}`, font: `500 12px ${JAK}`, color: C.slate }}>Can&apos;t scan? Give them your code: <b style={{ font: `700 13px ${GRO}`, color: C.ink }}>{me.slug}</b></div>
            </div>

            {/* money snapshot */}
            <div style={{ background: C.softGreen, border: `1px solid ${C.softGreenBorder}`, borderRadius: 16, padding: "16px 17px", marginTop: 6 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ font: `700 13.5px ${JAK}`, color: "#166534" }}>Estimated earned</span>
                <span style={{ marginLeft: "auto", font: `600 19px ${GRO}`, color: C.greenDk, fontVariantNumeric: "tabular-nums" }}>{money(stats.commission)}</span>
              </div>
              <p style={{ font: `500 12.5px/1.5 ${JAK}`, color: "#3f5c4a", margin: "7px 0 0" }}>Commission releases once we&apos;ve verified the account works — about a week after onboarding. Paid the following Monday.</p>
              <span onClick={() => go("money")} style={{ display: "inline-block", marginTop: 10, font: `700 12.5px ${JAK}`, color: C.greenDk, cursor: "pointer" }}>See my earnings →</span>
            </div>

            <div onClick={() => go("guide")} style={{ display: "flex", alignItems: "center", gap: 12, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 15, marginTop: 12, cursor: "pointer" }}>
              <div>
                <div style={{ font: `700 13.5px ${JAK}`, color: C.ink }}>What do I say to people?</div>
                <div style={{ font: `500 12px ${JAK}`, color: C.muted, marginTop: 2 }}>The offer, what to avoid, and answers to their questions</div>
              </div>
              <span style={{ marginLeft: "auto", font: `600 15px ${JAK}`, color: C.muted2 }}>›</span>
            </div>
          </div>
        )}

        {/* ============ SIGNUPS ============ */}
        {tab === "jobs" && (
          <div style={{ padding: "18px 18px 0" }}>
            <h1 style={h1}>Your onboardings</h1>
            <p style={lead}>Everyone you&apos;ve referred, where they&apos;re stuck, and who&apos;s running it.</p>

            {signups.length === 0 ? (
              <div style={{ ...card, textAlign: "center", padding: "22px 18px" }}>
                <div style={{ font: `700 14.5px ${JAK}`, color: C.ink, marginBottom: 5 }}>Nobody here yet</div>
                <p style={{ font: `500 12.5px/1.55 ${JAK}`, color: C.muted, margin: "0 0 14px" }}>Once someone signs up through your code — or you start a guided onboarding — they show up here.</p>
                <button onClick={() => setReadyOpen(true)} style={{ font: `700 13.5px ${JAK}`, color: "#fff", background: C.green, border: "none", padding: "13px 18px", borderRadius: 11, cursor: "pointer" }}>Start your first onboarding</button>
              </div>
            ) : (<>
              <div style={{ position: "relative", marginBottom: 11 }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", font: `400 13px ${JAK}`, color: C.muted2, pointerEvents: "none" }}>⌕</span>
                <input value={jobQuery} onChange={(e) => setJobQuery(e.target.value)} placeholder="Search by name" aria-label="Search your onboardings by name" style={{ width: "100%", boxSizing: "border-box", font: `500 13px ${JAK}`, color: C.ink, padding: "11px 32px 11px 30px", borderRadius: 11, border: `1px solid ${C.inputBorder}`, background: "#fff", outline: "none" }} />
                {jobQuery && <button onClick={() => setJobQuery("")} aria-label="Clear search" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", font: `600 13px ${JAK}`, color: C.muted2, background: "none", border: "none", cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>}
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16 }}>
                {JOB_FILTERS.map((f) => {
                  const on = jobFilter === f.id;
                  const n = f.id === "all" ? 0 : signups.filter(f.test).length;
                  return (
                    <button key={f.id} onClick={() => setJobFilter(f.id)} style={{ font: `700 12px ${JAK}`, padding: "9px 13px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", ...(on ? { background: C.dark, color: "#fff", border: "none" } : { background: "#fff", color: C.slate, border: `1px solid ${C.inputBorder}` }) }}>{f.label}{f.id === "all" ? "" : ` ${n}`}</button>
                  );
                })}
              </div>
              {(() => {
              const q = jobQuery.trim().toLowerCase();
              const shown = signups
                .filter((JOB_FILTERS.find((f) => f.id === jobFilter) || JOB_FILTERS[0]).test)
                .filter((s) => !q || (s.name || "").toLowerCase().includes(q));
              if (shown.length === 0) return q ? (
                <div style={{ ...card, textAlign: "center", padding: "22px 18px" }}>
                  <div style={{ font: `700 14px ${JAK}`, color: C.ink, marginBottom: 4 }}>No match for &ldquo;{jobQuery.trim()}&rdquo;</div>
                  <p style={{ font: `500 12.5px/1.55 ${JAK}`, color: C.muted, margin: 0 }}>{jobFilter === "all" ? "Check the spelling, or they may not be in your list yet." : "Try “Everyone”, or check the spelling."}</p>
                </div>
              ) : (
                <div style={{ ...card, textAlign: "center", padding: "22px 18px" }}>
                  <div style={{ font: `700 14px ${JAK}`, color: C.ink, marginBottom: 4 }}>Nothing {(JOB_FILTERS.find((f) => f.id === jobFilter) || {}).empty}</div>
                  <p style={{ font: `500 12.5px/1.55 ${JAK}`, color: C.muted, margin: 0 }}>Tap &ldquo;Everyone&rdquo; to see the rest.</p>
                </div>
              );
              return shown.map((s, i) => {
              const initials = ((s.name || "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("") || "?").toUpperCase();
              const fg = { green: C.greenDk, blue: "#2563eb", amber: "#c2410c", red: C.red }[s.pill.tone];
              const bg = { green: C.softGreen, blue: "#eef4ff", amber: C.warnBg, red: C.redBg }[s.pill.tone];
              const bd = { green: C.softGreenBorder, blue: "#c7d7fe", amber: C.warnBorder, red: C.redBorder }[s.pill.tone];
              return (
                <div key={i} style={card}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 999, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", font: `700 11.5px ${JAK}`, background: bg, color: fg }}>{initials}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: `700 14px ${JAK}`, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                        <span style={{ font: `500 11.5px ${JAK}`, color: C.muted, whiteSpace: "nowrap" }}>Signed up {fmtDate(s.date)}</span>
                        <span style={{ font: `600 10px ${JAK}`, color: C.slate, background: "#f1f3f6", padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>{s.whoLabel}</span>
                      </div>
                    </div>
                    <span style={{ marginLeft: "auto", flex: "none", font: `600 10px ${JAK}`, padding: "4px 9px", borderRadius: 6, whiteSpace: "nowrap", background: bg, color: fg, border: `1px solid ${bd}` }}>{s.pill.text}</span>
                  </div>
                  <div style={{ display: "flex", gap: 4, margin: "13px 0 9px" }}>
                    {[0, 1, 2, 3, 4, 5].map((n) => <span key={n} style={{ flex: 1, height: 5, borderRadius: 999, background: n < s.progress ? fg : C.line2 }} />)}
                  </div>
                  <div style={{ font: `600 12.5px ${JAK}`, color: fg }}>{s.line}</div>
                  <div style={{ font: `500 12px/1.45 ${JAK}`, color: C.slate, marginTop: 3 }}>{s.sub}</div>
                  {s.journey && s.journey.length > 0 && (
                    <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
                      {s.journey.map((j, k) => (
                        <div key={k} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ width: 15, height: 15, flex: "none", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", font: `700 9px ${JAK}`, background: j.state === "done" ? C.softGreen : j.state === "now" ? "#eef4ff" : j.state === "warn" ? C.warnBg : C.line2, color: j.state === "done" ? C.greenDk : j.state === "now" ? "#2563eb" : j.state === "warn" ? "#c2410c" : C.muted }}>{j.state === "done" ? "✓" : j.state === "now" ? "•" : j.state === "warn" ? "!" : ""}</span>
                          <span style={{ font: `600 11.5px ${JAK}`, color: j.state === "todo" ? C.muted : j.state === "warn" ? "#c2410c" : C.ink }}>{j.label}</span>
                          {j.date ? <span style={{ marginLeft: "auto", font: `500 11px ${JAK}`, color: j.state === "warn" ? "#c2410c" : C.muted }}>{fmtDate(j.date)}</span>
                            : j.state === "now" ? <span style={{ marginLeft: "auto", font: `500 11px ${JAK}`, color: "#2563eb" }}>in progress</span> : null}
                        </div>
                      ))}
                    </div>
                  )}
                  {s.pay && (
                    <div style={{ marginTop: 9, padding: "8px 10px", background: C.blueBg, border: `1px solid ${C.blueBorder}`, borderRadius: 9 }}>
                      <div style={{ font: `700 11.5px ${JAK}`, color: C.blueInk }}>📅 {s.pay.text}</div>
                      {s.pay.sub && <div style={{ font: `500 11px/1.4 ${JAK}`, color: C.slate, marginTop: 2 }}>{s.pay.sub}</div>}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingTop: 9, borderTop: `1px solid ${C.line2}` }}>
                    <span style={{ font: `500 11.5px ${JAK}`, color: C.muted }}>{s.path}</span>
                    {s.liUrl && !s.restricted && <a href={s.liUrl} target="_blank" rel="noopener noreferrer" style={{ font: `600 11.5px ${JAK}`, color: "#2563eb", textDecoration: "none", whiteSpace: "nowrap" }}>View on LinkedIn ↗</a>}
                    <span style={{ marginLeft: "auto", font: `700 12.5px ${GRO}`, color: C.ink, textAlign: "right" }}>{moneyText(s.fee)}</span>
                  </div>
                  {s.restricted && (
                    <div style={{ marginTop: 12, background: C.redBg, border: `1px solid ${C.redBorder}`, borderRadius: 12, padding: 13 }}>
                      <div style={{ font: `700 12.5px ${JAK}`, color: C.red, marginBottom: 4 }}>⚠ Account restricted</div>
                      <div style={{ font: `500 11.5px/1.45 ${JAK}`, color: "#8a2b2b" }}>LinkedIn has locked this account. The owner clears it on their <strong>own phone</strong> — usually scanning a QR code, sometimes a selfie or ID photo. You can&apos;t clear it for them.</div>
                      {s.liUrl && <a href={s.liUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", width: "100%", marginTop: 10, font: `700 12.5px ${JAK}`, color: "#fff", background: C.dark, padding: 11, borderRadius: 10, textDecoration: "none" }}>Open LinkedIn to check it ↗</a>}
                      <button onClick={() => setLockName(s.name)} style={{ width: "100%", marginTop: 8, font: `700 12.5px ${JAK}`, color: C.red, background: "#fff", border: `1px solid ${C.redBorder}`, padding: 11, borderRadius: 10, cursor: "pointer" }}>See the steps to clear it</button>
                      <div style={{ font: `500 11.5px/1.45 ${JAK}`, color: "#8a2b2b", marginTop: 10 }}>To sign in and start LinkedIn&apos;s check, the owner needs the 6-digit code:</div>
                      {authOpenId === s.id ? (
                        <div style={{ marginTop: 8, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 10, padding: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ font: `700 10.5px ${JAK}`, letterSpacing: ".08em", color: C.greenDk, textTransform: "uppercase" }}>Authenticator code</span>
                            <button onClick={() => setAuthOpenId(null)} style={{ font: `600 11px ${JAK}`, color: C.muted, background: "none", border: "none", cursor: "pointer" }}>Hide</button>
                          </div>
                          {authCode.loading ? (
                            <div style={{ font: `600 13px ${JAK}`, color: C.muted, marginTop: 8 }}>Getting code…</div>
                          ) : authCode.error ? (
                            <div style={{ font: `600 12.5px ${JAK}`, color: C.red, marginTop: 8 }}>{authCode.error}</div>
                          ) : authCode.code ? (<>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                              <span style={{ font: `700 26px ${GRO}`, letterSpacing: ".16em", color: "#0b1220" }}>{authCode.code}</span>
                              <button onClick={() => { navigator.clipboard?.writeText(authCode.code!); setAuthCode((c) => ({ ...c, copied: true })); }} style={{ font: `700 12px ${JAK}`, color: "#0b1220", background: "#a7f3d0", border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>{authCode.copied ? "Copied" : "Copy"}</button>
                              <button onClick={() => void loadAuthCode(s.id)} style={{ font: `700 12px ${JAK}`, color: C.greenDk, background: "none", border: "none", cursor: "pointer" }}>Refresh</button>
                            </div>
                            <div style={{ font: `500 11px/1.45 ${JAK}`, color: "#5b7a68", marginTop: 8 }}>Enter this where LinkedIn asks for the 6-digit code. It changes every 30 seconds — tap Refresh for a fresh one.</div>
                          </>) : (
                            <div style={{ font: `600 12.5px/1.5 ${JAK}`, color: "#5b7a68", marginTop: 8 }}>No code available right now. Ask the team.</div>
                          )}
                        </div>
                      ) : (
                        <button onClick={() => toggleAuth(s.id)} style={{ width: "100%", marginTop: 8, font: `700 12.5px ${JAK}`, color: C.greenDk, background: C.softGreen, border: `1px solid ${C.softGreenBorder}`, padding: 11, borderRadius: 10, cursor: "pointer" }}>Get authenticator code</button>
                      )}
                      {s.restrictionReport ? (
                        <div style={{ font: `700 11.5px/1.4 ${JAK}`, color: C.greenDk, background: C.softGreen, border: `1px solid ${C.softGreenBorder}`, borderRadius: 9, padding: "9px 11px", marginTop: 8 }}>
                          ✓ {s.restrictionReport.type === "recovered" ? "You told us it's unrestricted" : "You told us the check is done"} — the team is verifying it now.
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button onClick={() => void reportRestriction(s.id, "qr_done")} disabled={reportingId === s.id} style={{ flex: 1, font: `700 12px ${JAK}`, color: C.ink, background: C.line2, border: `1px solid ${C.inputBorder}`, padding: 11, borderRadius: 10, cursor: "pointer" }}>{reportingId === s.id ? "Saving…" : "They did the QR check"}</button>
                          <button onClick={() => void reportRestriction(s.id, "recovered")} disabled={reportingId === s.id} style={{ flex: 1, font: `700 12px ${JAK}`, color: "#fff", background: C.greenDk, border: "none", padding: 11, borderRadius: 10, cursor: "pointer" }}>{reportingId === s.id ? "Saving…" : "It's unrestricted now"}</button>
                        </div>
                      )}
                    </div>
                  )}
                  {s.fix && (
                    <div style={{ marginTop: 12, background: C.warnBg, border: `1px solid ${C.warnBorder}`, borderRadius: 12, padding: 13 }}>
                      <div style={{ font: `700 12.5px ${JAK}`, color: C.warn, marginBottom: 6 }}>⚠ Needs fixing before you get paid</div>
                      {s.fix.issues.map((iss) => (
                        <div key={iss} style={{ marginBottom: 8 }}>
                          <div style={{ font: `700 12px ${JAK}`, color: C.warn }}>{FIX_INFO[iss].title}</div>
                          <div style={{ font: `500 11.5px/1.45 ${JAK}`, color: "#9a5b2a", marginTop: 2 }}>{FIX_INFO[iss].how}</div>
                        </div>
                      ))}
                      {s.fix.state === "referrer_done"
                        ? <div style={{ font: `700 12px ${JAK}`, color: C.greenDk, background: C.softGreen, border: `1px solid ${C.softGreenBorder}`, borderRadius: 9, padding: "9px 11px", marginTop: 4 }}>✓ Marked done — the team will recheck it</div>
                        : <button onClick={() => void markFixed(s.id)} disabled={fixingId === s.id} style={{ width: "100%", marginTop: 4, font: `700 13px ${JAK}`, color: "#fff", background: C.warn, border: "none", padding: 12, borderRadius: 10, cursor: "pointer" }}>{fixingId === s.id ? "Saving…" : "I've fixed it"}</button>}
                    </div>
                  )}
                  {s.action === "clear" ? (
                    <button onClick={() => setLockName(s.name)} style={{ display: "block", width: "100%", marginTop: 12, font: `700 13.5px ${JAK}`, color: "#fff", background: C.red, border: "none", padding: 13, borderRadius: 11, cursor: "pointer" }}>See how to clear it</button>
                  ) : s.action ? (
                    <a href={s.action === "resume" && s.resumeSessionId ? `/m/${token}/onboarding?session=${encodeURIComponent(s.resumeSessionId)}` : `/m/${token}/onboarding?adopt=${encodeURIComponent(s.id)}`} style={{ display: "block", width: "100%", marginTop: 12, textAlign: "center", font: `700 13.5px ${JAK}`, color: "#fff", background: C.dark, padding: 13, borderRadius: 11, textDecoration: "none" }}>{s.action === "resume" ? "Resume onboarding" : "Onboard them now"}</a>
                  ) : null}
                  {/* Get the latest LinkedIn sign-in code for this person, without walking the
                      wizard. Only shown while codes can still flow (pre-onboarding). */}
                  {s.codeSessionId && (codeOpenId === s.id ? (
                    <div style={{ marginTop: 12, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 12, padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ font: `700 10.5px ${JAK}`, letterSpacing: ".08em", color: C.greenDk, textTransform: "uppercase" }}>Latest code from LinkedIn</span>
                        <button onClick={() => setCodeOpenId(null)} style={{ font: `600 11px ${JAK}`, color: C.muted, background: "none", border: "none", cursor: "pointer" }}>Hide</button>
                      </div>
                      {codeInfo.loading ? (
                        <div style={{ font: `600 13px ${JAK}`, color: C.muted, marginTop: 8 }}>Checking…</div>
                      ) : codeInfo.error ? (
                        <div style={{ font: `600 12.5px ${JAK}`, color: C.red, marginTop: 8 }}>{codeInfo.error}</div>
                      ) : codeInfo.code ? (<>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                          <span style={{ font: `700 26px ${GRO}`, letterSpacing: ".16em", color: "#0b1220" }}>{codeInfo.code}</span>
                          <button onClick={() => { navigator.clipboard?.writeText(codeInfo.code!); setCodeInfo((c) => ({ ...c, copied: true })); }} style={{ font: `700 12px ${JAK}`, color: "#0b1220", background: "#a7f3d0", border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>{codeInfo.copied ? "Copied" : "Copy"}</button>
                          <button onClick={() => void loadCode(s.codeSessionId!)} style={{ font: `700 12px ${JAK}`, color: C.greenDk, background: "none", border: "none", cursor: "pointer" }}>Refresh</button>
                        </div>
                        <div style={{ font: `500 11px/1.45 ${JAK}`, color: "#5b7a68", marginTop: 8 }}>For {s.name}. Codes expire fast — if LinkedIn rejects it, tap resend on LinkedIn, then Refresh here.</div>
                      </>) : (<>
                        <div style={{ font: `600 12.5px/1.5 ${JAK}`, color: "#5b7a68", marginTop: 8 }}>No code yet. On LinkedIn, start the sign-in or tap “Send code”, then Refresh here.</div>
                        <button onClick={() => void loadCode(s.codeSessionId!)} style={{ font: `700 12px ${JAK}`, color: C.greenDk, background: "#fff", border: `1px solid ${C.softGreenBorder}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", marginTop: 10 }}>Refresh</button>
                      </>)}
                    </div>
                  ) : (
                    <button onClick={() => toggleCode(s.codeSessionId!, s.id)} style={{ display: "block", width: "100%", marginTop: 10, font: `700 13px ${JAK}`, color: C.greenDk, background: C.softGreen, border: `1px solid ${C.softGreenBorder}`, padding: 12, borderRadius: 11, cursor: "pointer" }}>Get sign-in code</button>
                  ))}
                  {/* Delete — only before onboarding finishes / any payment (the server re-checks). */}
                  {s.deletable && (deleteId === s.id ? (
                    <div style={{ marginTop: 10, padding: "11px 12px", background: C.redBg, border: `1px solid ${C.redBorder}`, borderRadius: 11 }}>
                      <div style={{ font: `700 12px ${JAK}`, color: C.red }}>Delete {s.name}&apos;s signup?</div>
                      <div style={{ font: `500 11.5px/1.45 ${JAK}`, color: "#8a2b2b", marginTop: 2 }}>This removes it for good. You can&apos;t undo it.</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button onClick={() => setDeleteId(null)} disabled={deletingId === s.id} style={{ flex: 1, font: `700 12.5px ${JAK}`, color: C.ink, background: "#fff", border: `1px solid ${C.inputBorder}`, padding: 11, borderRadius: 10, cursor: "pointer" }}>Keep it</button>
                        <button onClick={() => void deleteApplication(s.id)} disabled={deletingId === s.id} style={{ flex: 1, font: `700 12.5px ${JAK}`, color: "#fff", background: C.red, border: "none", padding: 11, borderRadius: 10, cursor: "pointer" }}>{deletingId === s.id ? "Deleting…" : "Delete it"}</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteId(s.id)} style={{ display: "block", margin: "10px auto 0", font: `600 11.5px ${JAK}`, color: C.muted, background: "none", border: "none", padding: 4, cursor: "pointer", textDecoration: "underline" }}>Delete this signup</button>
                  ))}
                </div>
              );
            });
            })()}
            </>)}

            {signups.length > 0 && (
              <div style={{ background: C.card, border: `1px dashed #d8dce3`, borderRadius: 16, padding: 18, textAlign: "center", marginBottom: 8 }}>
                <div style={{ font: `700 13.5px ${JAK}`, color: C.ink, marginBottom: 4 }}>Someone already said yes?</div>
                <p style={{ font: `500 12px/1.5 ${JAK}`, color: C.muted, margin: "0 0 12px" }}>Start their onboarding here so they get counted and you get paid.</p>
                <button onClick={() => setReadyOpen(true)} style={{ font: `700 13.5px ${JAK}`, color: C.greenDk, background: C.softGreen, border: `1px solid ${C.softGreenBorder}`, padding: "12px 18px", borderRadius: 11, cursor: "pointer" }}>Start an onboarding</button>
              </div>
            )}
          </div>
        )}

        {/* ============ EARNINGS ============ */}
        {tab === "money" && (
          <div style={{ padding: "18px 18px 0" }}>
            <h1 style={h1}>Your earnings</h1>
            <p style={lead}>Paid to your GCash or bank the Monday after each onboarding clears our check. {rangeD} per onboarding, depending on how it&apos;s done.</p>

            <div style={{ background: C.dark, borderRadius: 18, padding: 18, marginBottom: 12 }}>
              <div style={{ font: `600 11.5px ${JAK}`, color: "#94a3b8", marginBottom: 4 }}>Estimated, not yet paid</div>
              <div style={{ font: `600 26px/1.25 ${GRO}`, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{money(stats.commission)}</div>
              <div style={{ display: "flex", gap: 22, marginTop: 16, paddingTop: 14, borderTop: "1px solid #1e293b" }}>
                <div>
                  <div style={{ font: `600 17px ${GRO}`, color: "#6ee7b7", fontVariantNumeric: "tabular-nums" }}>{money(paidTotal)}</div>
                  <div style={{ font: `600 11px ${JAK}`, color: "#94a3b8", marginTop: 3 }}>Confirmed received</div>
                </div>
                {myRank > 0 && <div>
                  <div style={{ font: `600 17px ${GRO}`, color: "#fff", fontVariantNumeric: "tabular-nums" }}>#{myRank}</div>
                  <div style={{ font: `600 11px ${JAK}`, color: "#94a3b8", marginTop: 3 }}>of {ranked.length} referrers</div>
                </div>}
              </div>
            </div>

            <p style={{ fontSize: 11, color: C.muted }}>Payout currency: {actualCurrency}. ≈ marks an estimate using our reference rate of ₱58 per $1; actual payments keep their saved currency.</p>
            {/* what each onboarding pays */}
            <div style={card}>
              <div style={cardTitle}>What each onboarding pays</div>
              <p style={{ font: `500 12px/1.5 ${JAK}`, color: C.muted, margin: "0 0 8px" }}>Two things move your rate: who does the final sign-in, and whether LinkedIn has ID-verified the account.</p>
              {[
                { a: offerMoney(tiers.referral), t: "You send the form — our team onboards them." },
                { a: tierRangeD("phone"), t: "Phone: you chase it, we do the sign-in. Verified pays the top." },
                { a: tierRangeD("computer"), t: "Computer: you do the guided sign-in yourself. Verified pays the top." },
              ].map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "9px 0", borderTop: `1px solid ${C.line2}` }}>
                  <span style={{ font: `700 13.5px ${GRO}`, color: C.greenDk, flex: "none", minWidth: 62 }}>{p.a}</span>
                  <span style={{ font: `500 12.5px/1.45 ${JAK}`, color: C.slate }}>{p.t}</span>
                </div>
              ))}
              <p style={{ font: `500 11.5px/1.5 ${JAK}`, color: C.muted2, margin: "10px 0 0" }}>The estimate above is confirmed at payout.</p>
            </div>

            {/* payment history — marketer confirms receipt */}
            <div style={card}>
              <div style={{ ...secLbl, marginBottom: 8 }}>Payment history</div>
              {payouts.length === 0 ? (
                <p style={{ font: `500 12.5px/1.55 ${JAK}`, color: C.muted, margin: 0, padding: "8px 0" }}>No payouts yet. Your first one lands the Monday after your first onboarding clears our check.</p>
              ) : payouts.map((p) => {
                const label = PAYOUT_LABEL[p.type] || PAYOUT_LABEL.other;
                const confirming_ = confirmId === p.id;
                const refIsUrl = /^https?:\/\//i.test(p.reference || "");
                const pill = p.confirmedAt
                  ? { t: "Confirmed", bg: C.accBg, fg: C.accFg, bd: C.softGreenBorder }
                  : p.paidAt
                    ? { t: "Check it arrived", bg: C.warnBg, fg: "#c2410c", bd: C.warnBorder }
                    : { t: "Not sent yet", bg: C.pendBg, fg: C.pendFg, bd: "#e3e6ea" };
                const meta = p.paidAt
                  ? `Paid ${fmtDate(p.paidAt)}${p.method ? ` · ${p.method}` : ""}${p.confirmedAt ? " · you confirmed it" : ""}${p.reference && !refIsUrl ? ` · ref ${p.reference}` : ""}`
                  : "Not sent yet — lands the Monday after it clears our check";
                const needsConfirm = !!p.paidAt && !p.confirmedAt && !confirming_;
                return (
                  <div key={p.id} style={{ borderTop: `1px solid ${C.line2}`, padding: "14px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ font: `600 17px ${GRO}`, color: C.ink, fontVariantNumeric: "tabular-nums", flex: "none" }}>{money(p.amount)}</span>
                      <span style={{ font: `500 12.5px ${JAK}`, color: C.slate, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.description || label}</span>
                      <span style={{ marginLeft: "auto", flex: "none", font: `600 9.5px ${JAK}`, padding: "4px 9px", borderRadius: 6, whiteSpace: "nowrap", background: pill.bg, color: pill.fg, border: `1px solid ${pill.bd}` }}>{pill.t}</span>
                    </div>

                    <div style={{ marginTop: 5, font: `500 11.5px ${JAK}`, color: C.muted }}>{meta}</div>

                    {(refIsUrl || needsConfirm) && (
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        {refIsUrl && (
                          <a href={p.reference!} target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: "center", font: `700 12px ${JAK}`, color: C.ink, background: C.inputBg, border: `1px solid ${C.inputBorder}`, padding: 13, borderRadius: 10, textDecoration: "none" }}>View receipt ↗</a>
                        )}
                        {needsConfirm && (
                          <button onClick={() => { setConfirmId(p.id); setConfirmName(""); setConfirmErr(""); }} style={{ flex: 1, font: `700 12px ${JAK}`, color: "#fff", background: C.green, border: "none", padding: 13, borderRadius: 10, cursor: "pointer" }}>I got it ✓</button>
                        )}
                      </div>
                    )}

                    {confirming_ && (
                      <div style={{ marginTop: 9, background: C.softGreen, border: `1px solid ${C.softGreenBorder}`, borderRadius: 10, padding: 12 }}>
                        <div style={{ font: `500 12px/1.5 ${JAK}`, color: C.slate, marginBottom: 8 }}>
                          Type your full name to confirm you received {money(p.amount)}{p.method ? ` by ${p.method}` : ""}. This is your receipt — it&apos;s recorded with today&apos;s date and can&apos;t be undone.
                        </div>
                        <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder="Your full name" style={{ ...inp, width: "100%", marginBottom: 8 }} />
                        {confirmErr && <div style={{ font: `500 12px ${JAK}`, color: C.warn, marginBottom: 8 }}>{confirmErr}</div>}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button disabled={confirming || !confirmName.trim()} onClick={() => confirmPayout(p.id)} style={{ flex: 1, background: confirmName.trim() ? C.green : C.softGreenBorder, color: "#fff", border: "none", borderRadius: 9, padding: "10px 12px", font: `600 13px ${JAK}`, cursor: confirmName.trim() ? "pointer" : "not-allowed" }}>
                            {confirming ? "Confirming…" : "Confirm"}
                          </button>
                          <button onClick={() => { setConfirmId(null); setConfirmErr(""); }} style={{ flex: "none", background: "#fff", color: C.slate, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 14px", font: `600 13px ${JAK}`, cursor: "pointer" }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* payout details */}
            <div style={card}>
              <div style={cardTitle}>Where we send your money</div>
              <p style={{ font: `500 12px ${JAK}`, color: C.muted, margin: "0 0 13px" }}>Keep this right or your payout bounces.</p>
              <div style={{ font: `600 11px ${JAK}`, color: C.slate, marginBottom: 6 }}>Pay me via</div>
              <div style={{ display: "flex", gap: 9, marginBottom: 9 }}>
                <div style={selWrap}>
                  <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} style={sel}>{config.payoutMethods.map((m) => <option key={m}>{m}</option>)}</select>
                  <span style={chev}>▾</span>
                </div>
                <input value={form.paymentDetails} onChange={(e) => setForm({ ...form, paymentDetails: e.target.value })} placeholder="account number / details" style={inp} />
              </div>
              <div style={{ font: `600 11px ${JAK}`, color: C.slate, marginBottom: 6 }}>Account name</div>
              <input value={form.paymentName} onChange={(e) => setForm({ ...form, paymentName: e.target.value })} placeholder="name your account is registered under" style={{ ...inp, width: "100%", boxSizing: "border-box", marginBottom: 13 }} />
              <div style={{ font: `600 11px ${JAK}`, color: C.slate, marginBottom: 6 }}>Where we message you</div>
              <div style={{ display: "flex", gap: 9, marginBottom: 15 }}>
                <div style={selWrap}>
                  <select value={form.contactMethod} onChange={(e) => setForm({ ...form, contactMethod: e.target.value })} style={sel}><option>WhatsApp</option><option>Telegram</option><option>Viber</option><option>Email</option></select>
                  <span style={chev}>▾</span>
                </div>
                <input value={form.contactHandle} onChange={(e) => setForm({ ...form, contactHandle: e.target.value })} placeholder="number / @handle" style={inp} />
              </div>
              <button onClick={save} disabled={saving} style={{ width: "100%", font: `700 14px ${JAK}`, color: "#fff", background: saved ? C.greenDk : C.green, border: "none", padding: 14, borderRadius: 12, cursor: "pointer" }}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</button>
            </div>

            {/* leaderboard */}
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                <span style={secLbl}>Top referrers · lifetime</span>
                {myRank > 0 && <span style={{ marginLeft: "auto", font: `700 12px ${JAK}`, color: C.greenDk, whiteSpace: "nowrap" }}>You&apos;re #{myRank}</span>}
              </div>
              {topFive.map((b, i) => (
                <div key={b.name + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 10px", borderRadius: 10, marginBottom: 3, background: b.isMe ? C.softGreen : "transparent" }}>
                  <span style={{ font: `600 13px ${GRO}`, color: C.muted2, width: 16, flex: "none" }}>{i + 1}</span>
                  <span style={{ minWidth: 0, font: `${b.isMe ? 700 : 500} 13.5px ${JAK}`, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name.trim().split(/\s+/)[0]}{b.isMe ? " (you)" : ""}</span>
                  <span style={{ marginLeft: "auto", textAlign: "right", flex: "none" }}>
                    <strong style={{ display: "block", font: `600 13px ${GRO}`, color: C.greenDk, fontVariantNumeric: "tabular-nums" }}>{moneyText(b.lifetimeEarnings)}</strong>
                    <small style={{ display: "block", font: `500 10.5px ${JAK}`, color: C.muted2, whiteSpace: "nowrap" }}>{b.converted} onboarded · {b.signups} signed up</small>
                  </span>
                </div>
              ))}
              {myRank > 5 && myBoardRow && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px", borderRadius: 10, marginTop: 4, background: C.softGreen, border: `1px solid ${C.softGreenBorder}` }}>
                  <span style={{ font: `700 13px ${GRO}`, color: C.greenDk, width: 24, flex: "none" }}>#{myRank}</span>
                  <span style={{ minWidth: 0, font: `700 13.5px ${JAK}`, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{myBoardRow.name.trim().split(/\s+/)[0]} (you)</span>
                  <span style={{ marginLeft: "auto", textAlign: "right", flex: "none" }}>
                    <strong style={{ display: "block", font: `600 13px ${GRO}`, color: C.greenDk }}>{moneyText(myBoardRow.lifetimeEarnings)}</strong>
                    <small style={{ display: "block", font: `500 10.5px ${JAK}`, color: C.muted2, whiteSpace: "nowrap" }}>{myBoardRow.converted} onboarded · {myBoardRow.signups} signed up</small>
                  </span>
                </div>
              )}
              <div style={{ marginTop: 9, paddingTop: 10, borderTop: `1px solid ${C.line2}`, font: `500 12px/1.5 ${JAK}`, color: C.slate }}>Strong performers get first pick for the next field days. 💪</div>
            </div>
          </div>
        )}

        {/* ============ WHAT TO SAY (GUIDE) ============ */}
        {tab === "guide" && (
          <div style={{ padding: "18px 18px 0" }}>
            <h1 style={h1}>What to say</h1>
            <p style={lead}>Everything you need when you&apos;re talking to someone. Say it your own way.</p>

            {/* the offer */}
            <div style={{ ...card, padding: 17 }}>
              <div style={cardTitle}>The offer, in their words</div>
              <p style={{ font: `500 12.5px/1.5 ${JAK}`, color: C.slate, margin: "0 0 13px" }}>&ldquo;You lend us your LinkedIn account for business outreach. You keep your login, we pay you monthly, and after a light 6-month minimum you can take it back any time.&rdquo;</p>
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${C.line2}` }}>
                  <span style={{ font: `600 12.5px ${JAK}`, color: C.ink, width: 62, flex: "none" }}>One-off</span>
                  <span style={{ font: `700 14px ${GRO}`, color: C.greenDk, whiteSpace: "nowrap" }}>{setupOffer}</span>
                  <span style={{ font: `500 12px ${JAK}`, color: C.slate }}>once the account is confirmed stable</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
                  <span style={{ font: `600 12.5px ${JAK}`, color: C.ink, width: 62, flex: "none" }}>Monthly</span>
                  <span style={{ font: `700 14px ${GRO}`, color: C.greenDk, whiteSpace: "nowrap" }}>{monthlyOffer}</span>
                  <span style={{ font: `500 12px ${JAK}`, color: C.slate }}>in the first few days of every active month</span>
                </div>
              </div>
              <p style={{ font: `500 11.5px/1.45 ${JAK}`, color: C.muted, margin: "9px 0 0" }}>These are floor rates; older, stronger accounts can be worth more.</p>
              <div style={{ background: C.warnBg, border: `1px solid ${C.warnBorder}`, borderRadius: 11, padding: 13, marginTop: 11 }}>
                <div style={{ font: `700 12px ${JAK}`, color: C.warn, marginBottom: 8 }}>Say these three things every time</div>
                <div style={{ font: `600 12.5px/1.45 ${JAK}`, color: C.warn, marginBottom: 6 }}>1. Nobody gets cash on the spot — not them, not you.</div>
                <div style={{ font: `600 12.5px/1.45 ${JAK}`, color: C.warn, marginBottom: 6 }}>2. We never take a copy of their ID.</div>
                <div style={{ font: `600 12.5px/1.45 ${JAK}`, color: C.warn }}>3. Don&apos;t use the account while it&apos;s with us — that&apos;s what causes restrictions.</div>
              </div>
            </div>

            {/* how a guided onboarding goes */}
            <div style={{ ...card, padding: 17 }}>
              <div style={cardTitle}>How a guided onboarding goes</div>
              <p style={{ font: `500 12px/1.5 ${JAK}`, color: C.muted, margin: "0 0 12px" }}>Six steps, about 10 minutes. It saves as you go, so you can resume from the Signups tab.</p>
              {STEPS.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 11, marginBottom: 12 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 999, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", font: `700 11px ${GRO}`, background: C.dark, color: "#fff" }}>{i + 1}</span>
                  <div>
                    <div style={{ font: `700 13px ${JAK}`, color: C.ink }}>{s.t}</div>
                    <div style={{ font: `500 12.5px/1.45 ${JAK}`, color: C.slate, marginTop: 2 }}>{s.s}</div>
                  </div>
                </div>
              ))}
              <div style={{ background: C.blueBg, border: `1px solid ${C.blueBorder}`, borderRadius: 11, padding: 12, font: `500 12.5px/1.45 ${JAK}`, color: C.blueInk }}>Only the last step needs a computer — the protected browser doesn&apos;t run on phones. No computer today? Choose &ldquo;hand it to us&rdquo; and our team does the sign-in. They still get paid; you earn a little less.</div>
            </div>

            {/* do / don't */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div style={{ background: C.softGreen, border: `1px solid ${C.softGreenBorder}`, borderRadius: 14, padding: 14 }}>
                <div style={{ font: `700 11px ${JAK}`, color: C.greenDk, marginBottom: 9 }}>DO</div>
                {DOS.map((d, i) => <div key={i} style={{ font: `500 12px/1.4 ${JAK}`, color: "#2f5741", marginBottom: 8 }}>{d}</div>)}
              </div>
              <div style={{ background: "#fdf0f0", border: "1px solid #f5d0d0", borderRadius: 14, padding: 14 }}>
                <div style={{ font: `700 11px ${JAK}`, color: "#dc2626", marginBottom: 9 }}>DON&apos;T</div>
                {DONTS.map((d, i) => <div key={i} style={{ font: `500 12px/1.4 ${JAK}`, color: "#7f2d2d", marginBottom: 8 }}>{d}</div>)}
              </div>
            </div>

            {/* what makes a good account + warm-up */}
            <div style={{ ...card, padding: 17 }}>
              <div style={cardTitle}>What makes a good LinkedIn account</div>
              <p style={{ font: `500 12px ${JAK}`, color: C.muted, margin: "0 0 12px" }}>Share this with anyone you sign up, or use it yourself if you&apos;re listing your own account.</p>
              {GOOD_ACCOUNT.map((g, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                  <span style={{ color: C.green, font: `700 13px ${JAK}`, flex: "none", lineHeight: 1.45 }}>✓</span>
                  <span style={{ font: `500 13px/1.45 ${JAK}`, color: C.slate }}>{g}</span>
                </div>
              ))}
              <div style={{ font: `700 13px ${JAK}`, color: C.ink, margin: "16px 0 4px" }}>Warm it up first</div>
              <p style={{ font: `500 12.5px/1.5 ${JAK}`, color: C.muted, margin: "0 0 14px" }}>Spend a little time making the account look complete and active. This protects it from getting locked later.</p>
              {WARMUP.map((w, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 11, alignItems: "center", marginBottom: w.items.length ? 8 : 0 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 999, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", font: `700 11px ${GRO}`, background: C.green, color: "#fff" }}>{i + 1}</span>
                    <span style={{ font: `700 13px/1.35 ${JAK}`, color: C.ink }}>{w.t}</span>
                  </div>
                  {w.items.map((it, j) => (
                    <div key={j} style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 6px 33px" }}>
                      <span style={{ color: C.muted2, flex: "none", lineHeight: 1.45 }}>•</span>
                      <span style={{ font: `500 12.5px/1.45 ${JAK}`, color: C.slate }}>{it}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ background: C.warnBg, border: `1px solid ${C.warnBorder}`, borderRadius: 12, padding: "12px 14px", marginTop: 4 }}>
                <div style={{ font: `700 12.5px ${JAK}`, color: C.warn, marginBottom: 5 }}>Expect some restrictions early on</div>
                <div style={{ font: `500 12.5px/1.5 ${JAK}`, color: "#7c4a26" }}>Restrictions are common. LinkedIn flags unusual activity, so there may be restrictions early on while the account is warming up. The steps above are exactly what makes it less likely and easier to recover from.</div>
              </div>
            </div>

            {/* tips */}
            <div style={{ ...card, padding: 17 }}>
              <div style={cardTitle}>Tips to reassure them</div>
              <p style={{ font: `500 12px ${JAK}`, color: C.muted, margin: "0 0 12px" }}>Handy points to bring up if someone&apos;s unsure.</p>
              {TIPS.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                  <span style={{ color: C.green, font: `700 13px ${JAK}`, flex: "none", lineHeight: 1.4 }}>✓</span>
                  <span style={{ font: `500 13px/1.45 ${JAK}`, color: C.slate }}>{t}</span>
                </div>
              ))}
            </div>

            {/* if an account gets restricted */}
            <div style={{ ...card, padding: 17 }}>
              <div style={cardTitle}>If an account gets restricted</div>
              <p style={{ font: `500 12.5px/1.5 ${JAK}`, color: C.slate, margin: "0 0 12px" }}>Common on newer accounts and almost always temporary. The owner clears it themselves on their own phone — our step-by-step guide walks them through LinkedIn&apos;s ID check and, if LinkedIn needs it, the appeal.</p>
              <a href="https://linkedvelocity.com/restriction-guide" target="_blank" rel="noreferrer" style={{ display: "inline-block", font: `700 13px ${JAK}`, color: "#0a66c2", textDecoration: "none" }}>Open the restriction guide ↗</a>
            </div>

            {/* they'll ask you this */}
            <div style={{ ...card, padding: 17 }}>
              <div style={cardTitle}>They&apos;ll ask you this</div>
              <p style={{ font: `500 12px ${JAK}`, color: C.muted, margin: "0 0 6px" }}>Tap to see the answer.</p>
              {faqBlock(applyFaq(AMBASSADOR_FAQ), "a")}
            </div>

            <div onClick={() => go("you")} style={{ display: "flex", alignItems: "center", gap: 12, background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 15, marginBottom: 12, cursor: "pointer" }}>
              <div>
                <div style={{ font: `700 13.5px ${JAK}`, color: C.ink }}>Questions about your own side?</div>
                <div style={{ font: `500 12px ${JAK}`, color: C.muted, marginTop: 2 }}>Your pay, your code, getting booked again → For you</div>
              </div>
              <span style={{ marginLeft: "auto", font: `600 15px ${JAK}`, color: C.muted2 }}>›</span>
            </div>
          </div>
        )}

        {/* ============ FOR YOU ============ */}
        {tab === "you" && (
          <div style={{ padding: "18px 18px 0" }}>
            <h1 style={h1}>For you</h1>
            <p style={lead}>Your details, what we expect, and answers about your own side of it.</p>

            {/* profile + code */}
            <div style={{ ...card, padding: 17 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <span style={{ width: 42, height: 42, borderRadius: 999, flex: "none", background: C.dark, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: `700 15px ${JAK}` }}>{initial}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ font: `700 15px ${JAK}`, color: C.ink }}>{me.name}</div>
                  <div style={{ font: `500 12px ${JAK}`, color: C.muted, marginTop: 2 }}>{brand} referrer</div>
                </div>
                <span style={{ marginLeft: "auto", flex: "none", font: `700 10px ${JAK}`, padding: "5px 9px", borderRadius: 6, background: C.softGreen, color: C.greenDk, border: `1px solid ${C.softGreenBorder}` }}>Active</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.inputBg, border: "1px solid #e9ebef", borderRadius: 11, padding: "12px 13px" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ font: `600 10.5px ${JAK}`, letterSpacing: ".06em", textTransform: "uppercase", color: "#8b95a5" }}>Your referral code</div>
                  <div style={{ font: `600 15px ${GRO}`, color: C.ink, marginTop: 3 }}>{me.slug}</div>
                </div>
                <button onClick={copyLink} style={{ marginLeft: "auto", flex: "none", font: `700 12px ${JAK}`, color: C.ink, background: "#fff", border: `1px solid ${C.inputBorder}`, padding: "10px 13px", borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap" }}>{linkCopied ? "Copied ✓" : "Copy link"}</button>
              </div>
              <p style={{ font: `500 11.5px/1.45 ${JAK}`, color: C.muted, margin: "10px 0 0" }}>Anyone who signs up through this code or your QR is credited to you, even if someone else finishes the onboarding.</p>
            </div>

            {/* what we expect */}
            <div style={{ ...card, padding: 17 }}>
              <div style={cardTitle}>What we expect from you</div>
              <p style={{ font: `500 12px ${JAK}`, color: C.muted, margin: "0 0 4px" }}>Four things that keep your onboardings paying out.</p>
              {[
                { t: "Stay with them to the end", s: "A signup with no booked call — or an onboarding you leave halfway — rarely completes." },
                { t: "Never handle their secrets", s: "Don't collect passwords, PINs or 2FA codes yourself. The owner enters those." },
                { t: "Be honest about pay", s: "Payment comes after setup and our check. Never promise cash on the spot." },
                { t: "Only eligible accounts", s: "LinkedIn's minimum age is 16, or older where local law requires." },
              ].map((e, i) => (
                <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "11px 0", borderTop: `1px solid ${C.line2}` }}>
                  <span style={{ font: `700 12px ${GRO}`, color: C.greenDk, flex: "none", width: 14 }}>{i + 1}</span>
                  <div>
                    <div style={{ font: `600 13px ${JAK}`, color: C.ink }}>{e.t}</div>
                    <div style={{ font: `500 12px/1.45 ${JAK}`, color: C.slate, marginTop: 2 }}>{e.s}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* how you grow this */}
            <div style={{ ...card, padding: 17 }}>
              <div style={cardTitle}>How you grow this</div>
              <p style={{ font: `500 12.5px/1.5 ${JAK}`, color: C.slate, margin: "0 0 12px" }}>Completed onboardings are what we count — not signups. The more you finish, the better the rates and support you get.</p>
              <div style={{ display: "flex", gap: 10 }}>
                {[
                  { v: String(stats.converted), l: "Onboarded", bg: C.inputBg, bd: "#e9ebef", c: C.ink, lc: C.slate },
                  { v: String(pendingCount), l: "Still pending", bg: C.warnBg, bd: C.warnBorder, c: "#c2410c", lc: C.warn },
                  { v: myRank > 0 ? `#${myRank}` : "—", l: "On the board", bg: C.softGreen, bd: C.softGreenBorder, c: C.greenDk, lc: "#166534" },
                ].map((t) => (
                  <div key={t.l} style={{ flex: 1, background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 12, padding: 13 }}>
                    <div style={{ font: `600 20px ${GRO}`, color: t.c, fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
                    <div style={{ font: `600 11px ${JAK}`, color: t.lc, marginTop: 3 }}>{t.l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* your questions */}
            <div style={{ ...card, padding: 17 }}>
              <div style={cardTitle}>Your questions</div>
              <p style={{ font: `500 12px ${JAK}`, color: C.muted, margin: "0 0 6px" }}>About your pay, your commission and your bookings.</p>
              {faqBlock(applyFaq(MARKETER_FAQ), "m")}
            </div>

            {/* documents */}
            <div style={{ ...card, padding: 17 }}>
              <div style={{ ...secLbl, marginBottom: 4 }}>Documents</div>
              {[
                { href: "/ambassador-terms", t: "Account owner agreement", s: "Show them this" },
                { href: "/ambassador-guide", t: "What to expect with your account", s: "Plain-language guide" },
              ].map((d, i) => (
                <a key={i} href={d.href} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 0", borderTop: `1px solid ${C.line2}`, textDecoration: "none" }}>
                  <span style={{ font: `600 13px ${JAK}`, color: C.ink }}>{d.t}</span>
                  <span style={{ marginLeft: "auto", font: `500 12px ${JAK}`, color: C.muted }}>{d.s}</span>
                </a>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, background: C.inputBg, border: "1px solid #e9ebef", borderRadius: 16, padding: 16, marginBottom: 8 }}>
              <div>
                <div style={{ font: `700 13.5px ${JAK}`, color: C.ink }}>Something wrong with your pay?</div>
                <div style={{ font: `500 12px ${JAK}`, color: C.muted, marginTop: 2 }}>Message your LinkedVelocity contact with the person&apos;s name and date</div>
              </div>
            </div>
            <p style={{ textAlign: "center", font: `500 12px ${JAK}`, color: C.muted2, padding: "4px 0 16px" }}>Questions? Message your LinkedVelocity contact.</p>
          </div>
        )}

        {/* ============ TAB BAR ============ */}
        <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 440, background: "#fff", borderTop: `1px solid ${C.inputBorder}`, zIndex: 30 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 2, padding: "8px 6px 12px" }}>
            {tabDef.map((t) => {
              const on = tab === t.id;
              return (
                <div key={t.id} onClick={() => go(t.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "6px 2px", cursor: "pointer", color: on ? C.greenDk : C.muted2, borderRadius: 10, background: on ? C.softGreen : "transparent" }}>
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{t.icon}</span>
                  <span style={{ font: `700 9.5px ${JAK}`, textAlign: "center" }}>{t.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ready sheet */}
        {readyOpen && (
          <div onClick={() => setReadyOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(9,17,12,.5)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: "#fff", borderRadius: "22px 22px 0 0", padding: "22px 20px 26px" }}>
              <div style={{ width: 38, height: 4, borderRadius: 999, background: C.inputBorder, margin: "0 auto 16px" }} />
              <div style={{ font: `600 19px ${GRO}`, color: C.ink, marginBottom: 5 }}>Before you start</div>
              <p style={{ font: `500 12.5px/1.5 ${JAK}`, color: C.slate, margin: "0 0 14px" }}>Six steps, about 10 minutes. Don&apos;t start unless they can stay with you until the sign-in is done.</p>
              {READY_CHECKS.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "11px 0", borderTop: `1px solid ${C.line2}` }}>
                  <span style={{ width: 20, height: 20, borderRadius: 999, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", font: `700 10px ${JAK}`, background: C.softGreen, color: C.greenDk, border: `1px solid ${C.softGreenBorder}` }}>✓</span>
                  <div>
                    <div style={{ font: `600 13px ${JAK}`, color: C.ink }}>{c.t}</div>
                    <div style={{ font: `500 12px/1.4 ${JAK}`, color: C.muted, marginTop: 2 }}>{c.s}</div>
                  </div>
                </div>
              ))}
              <a href={`/m/${token}/onboarding`} style={{ display: "block", width: "100%", marginTop: 16, textAlign: "center", font: `700 15px ${JAK}`, color: "#fff", background: C.green, padding: 15, borderRadius: 13, textDecoration: "none" }}>I&apos;m with them — start →</a>
              <button onClick={() => setReadyOpen(false)} style={{ width: "100%", marginTop: 8, font: `700 13.5px ${JAK}`, color: C.slate, background: "none", border: "none", padding: 11, cursor: "pointer" }}>Not now</button>
            </div>
          </div>
        )}

        {/* Restricted / "how to clear it" sheet */}
        {lockName !== null && (
          <div onClick={() => setLockName(null)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(9,17,12,.5)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: "#fff", borderRadius: "22px 22px 0 0", padding: "22px 20px 26px" }}>
              <div style={{ width: 38, height: 4, borderRadius: 999, background: C.inputBorder, margin: "0 auto 16px" }} />
              <div style={{ font: `600 19px ${GRO}`, color: C.ink, marginBottom: 5 }}>Clearing a LinkedIn lock</div>
              <p style={{ font: `500 12.5px/1.5 ${JAK}`, color: C.slate, margin: "0 0 14px" }}>Common on newer accounts, and almost always temporary. <strong>They</strong> do this on their own phone — you can&apos;t clear it for them.</p>
              {LOCK_STEPS.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "11px 0", borderTop: `1px solid ${C.line2}` }}>
                  <span style={{ width: 20, height: 20, borderRadius: 999, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", font: `700 10px ${GRO}`, background: C.dark, color: "#fff" }}>{i + 1}</span>
                  <div>
                    <div style={{ font: `600 13px ${JAK}`, color: C.ink }}>{l.t}</div>
                    <div style={{ font: `500 12px/1.45 ${JAK}`, color: C.muted, marginTop: 2 }}>{l.s}</div>
                  </div>
                </div>
              ))}
              <div style={{ background: C.warnBg, border: `1px solid ${C.warnBorder}`, borderRadius: 12, padding: 13, marginTop: 13, font: `500 12.5px/1.5 ${JAK}`, color: C.warn }}>If it needs an ID check, they photograph their own ID in LinkedIn&apos;s screen. We never see it and never ask for a copy.</div>
              <a href="https://linkedvelocity.com/restriction-guide" target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center", marginTop: 13, font: `700 13px ${JAK}`, color: "#0a66c2", textDecoration: "none" }}>Open the full step-by-step guide ↗</a>
              <a href={`/m/${token}/onboarding`} style={{ display: "block", textAlign: "center", marginTop: 14, font: `700 13.5px ${JAK}`, color: C.ink, background: C.line2, border: `1px solid ${C.inputBorder}`, padding: 14, borderRadius: 13, textDecoration: "none" }}>It&apos;s cleared — resume the onboarding</a>
              <button onClick={() => setLockName(null)} style={{ width: "100%", marginTop: 8, font: `700 13.5px ${JAK}`, color: C.slate, background: "none", border: "none", padding: 11, cursor: "pointer" }}>Close</button>
            </div>
          </div>
        )}

        {/* QR modal */}
        {qrOpen && (
          <div onClick={() => setQrOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(9,17,12,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, background: "#fff", borderRadius: 22, padding: "26px 24px", textAlign: "center" }}>
              <div style={{ font: `600 18px ${GRO}`, color: C.ink, marginBottom: 5 }}>Let them scan this</div>
              <p style={{ font: `500 12.5px/1.5 ${JAK}`, color: C.slate, margin: "0 0 18px" }}>It opens a short form. You get credited for whoever fills it in.</p>
              <div style={{ width: 216, height: 216, margin: "0 auto 18px", border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrSrc} alt="Your referral QR code" width={184} height={184} style={{ width: "100%", height: "100%" }} />
              </div>
              <div style={{ font: `500 11.5px ${GRO}`, color: C.muted2, marginBottom: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{myLinkShort}</div>
              <div style={{ display: "flex", gap: 9 }}>
                <button onClick={copyLink} style={{ flex: 1, font: `700 13.5px ${JAK}`, color: C.greenDk, background: C.softGreen, border: `1px solid ${C.softGreenBorder}`, padding: 12, borderRadius: 11, cursor: "pointer" }}>{linkCopied ? "Copied ✓" : "Copy link"}</button>
                <button onClick={() => setQrOpen(false)} style={{ flex: 1, font: `700 13.5px ${JAK}`, color: "#fff", background: C.green, border: "none", padding: 12, borderRadius: 11, cursor: "pointer" }}>Done</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
