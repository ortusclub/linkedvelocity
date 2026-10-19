"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { OnboardingPrice } from "@/components/onboarding-price";
import { CurrencySelector, useDisplayCurrency } from "@/components/display-currency";
import { configuredText, configuredOffer, offerRange } from "@/lib/display-currency";
import { type CurrencyConfig, currencyConfig } from "@/lib/referral-currency";
import styles from "./wizard.module.css";
import { countries, countryCode } from "@/lib/countries";
import BrowserStep from "./browser-step";
import PhoneHandoff from "./phone-handoff";
import EmailStep, { type EmailSetup } from "./email-step";
import { CoachTour, type TourStep } from "./coach-tour";
import TotpCode, { looksLikeTotpKey } from "./totp";

// Per-page coach tours — a referrer gets a short walkthrough of each screen. Tours stop
// entirely once they've run BOTH a computer AND a phone onboarding (see `experienced`).
// Before that, each page's tour shows until it's skipped or clicked through, and that
// dismissal is persisted per token in localStorage (readTourStore / writeTourStore) so it
// does NOT reappear on every fresh onboarding. "Skip tour" quiets all pages for good.
const PAGE_TOURS: Record<string, TourStep[]> = {
  before: [
    { title: "Welcome — quick tour", body: "You'll do this virtually with the account owner — you drive the steps, they confirm and do their bits on their own device — in about 10 minutes. Here's the lay of the land." },
    { target: "rail", title: "See all 6 steps anytime", body: "Tap \"How it works\" to expand the full flow and see where you are. It saves as you go." },
    { target: "need", title: "Check they're ready", body: "Before you start, make sure the owner has these to hand — and that they can stay with you the whole way." },
    { target: "consent", title: "Get their OK", body: "Once they're happy and agree to the terms, tick this box, then hit Start." },
  ],
  details: [
    { title: "Their details", body: "You fill these in as you go — read each one back to the owner to confirm it's right rather than guessing. It's their account." },
    { target: "age", title: "How old is the account", body: "Good to note either way — newer accounts see the odd restriction. The setup fee lands about a week after sign-in and our checks." },
    { target: "verified", title: "Is it verified?", body: "Check their profile for a Verified badge. A verified account pays you the top rate, so check rather than guess." },
  ],
  email: [
    { target: "email-why", title: "Why add an email?", body: "LinkedIn's routine security checks go to the primary email. Making ours primary means they come to us — not the owner. The owner keeps full access and their own email stays on the account." },
    { target: "email-inbox", title: "Whose email goes here?", body: "Any inbox you can open right now — yours or the owner's. Yours is usually easiest." },
  ],
  payout: [
    { target: "payout-method", title: "Where THEY get paid", body: "These are the account owner's payout details. Your own commission uses the details on your portal, not this." },
    { target: "payout-when", title: "When the money moves", body: "We verify the account, then their setup fee goes out — your commission at the same time." },
  ],
  signin: [
    { target: "signin-choice", title: "Who signs in?", body: "On a laptop you do the sign-in and earn the most. No computer? \"Hand it to us\" and the team does it — they still get paid, you earn a little less." },
  ],
  twofa: [
    { title: "Why 2FA first", body: "Without it, LinkedIn pings the owner's phone and you're stuck waiting. With it, you just type the code this page gives you." },
    { target: "twofa-key", title: "Copy the key — don't scan it", body: "LinkedIn app: Settings → Sign in & security → Two-step verification → Authenticator app. Copy the long key (the sample below shows what it looks like) and paste it below — not the QR." },
    { target: "twofa-code", title: "This is your authenticator", body: "No separate app needed. Type this code into LinkedIn to turn 2FA on — it changes every 30 seconds." },
  ],
  signinPc: [
    { title: "You're doing the sign-in", body: "This is the highest-rate path. You'll open the protected GoLogin browser and sign in to their LinkedIn together — the steps below walk you through it. You're not finished until you've signed in and confirmed." },
  ],
  handoffPhone: [
    { title: "Handing it to us", body: "No computer, so you're handing the sign-in to our team. Set a temporary password with the owner below. They still get paid the same; you earn a little less than the laptop path." },
  ],
  donePhone: [
    { target: "done-phone", title: "That's your part done", body: "Nothing more for you here. Our team sets up the protected browser and signs in after about 24 hours, then verifies the account. The setup payment follows, and your commission at the same time — we'll message you if anything is needed." },
  ],
  donePc: [
    { target: "done-summary", title: "Onboarded — here's the deal", body: "Their setup and monthly payments, and your commission, are now locked to your code. This is what everyone gets for this account." },
    { target: "done-next", title: "What happens next", body: "We test the sign-in over the next few days. If LinkedIn asks for a check, WE message you — not them — so keep your phone on. Once it clears, they're paid and your commission goes out at the same time. That's it, you're done." },
  ],
};
import { ShareLinks, type ScriptContext } from "./onboarding-scripts";

type Session = {
  emailSetup: EmailSetup | null;
  diyTier?: string | null;
  twoFactorSaved?: boolean;
  meetingRequested?: boolean;
  savedDetails?: { fullName: string; email: string; linkedinUrl: string; contactNumber: string | null; paymentMethod: string | null; paymentDetails: string | null; payoutName: string | null; bankName: string | null; bankAccountNumber: string | null; bankRoutingNumber: string | null };
  duplicateWarning?: string | null;
  country: string | null; proxyAssigned: boolean; proxyPriceLimit: number;
  id: string; name: string; state: string; opened: boolean; shareLink: string | null;
  confirmedAt: string | null; accountFreshness: string | null; setupDueAt: string | null; setupAmount: string;
  monthlyAmount: string; commission: string; verified: boolean;
};
type Bootstrap = { displayCurrency?: string; emailEnabled: boolean; phoneVerificationEnabled: boolean; countries: string[]; autoPurchase: boolean; config: CurrencyConfig; configured: boolean; doneComputer: boolean; donePhone: boolean; sessions: { id: string; state: string; name: string; done: boolean }[] };

const PAYOUT_FIELDS: Record<string, { label: string; type?: string; placeholder: string; help: string }> = {
  GCash: { label: "GCash mobile number", type: "tel", placeholder: "+63 9XX XXX XXXX", help: "Enter the mobile number registered to their GCash account." },
  Maya: { label: "Maya mobile number", type: "tel", placeholder: "+63 9XX XXX XXXX", help: "Enter the mobile number registered to their Maya account." },
  Maribank: { label: "Maribank mobile number", type: "tel", placeholder: "+63 9XX XXX XXXX", help: "Enter the mobile number registered to their Maribank account." },
  GoTyme: { label: "GoTyme account number", placeholder: "GoTyme account number", help: "Enter their GoTyme Bank account number (or the mobile number linked to it)." },
  UnionBank: { label: "UnionBank account number", placeholder: "Account number", help: "Enter their UnionBank account number." },
  BPI: { label: "BPI account number", placeholder: "Account number", help: "Enter their BPI account number." },
  BDO: { label: "BDO account number", placeholder: "Account number", help: "Enter their BDO account number." },
  UPI: { label: "UPI ID", placeholder: "name@bank", help: "Enter their UPI ID, sometimes called a virtual payment address—not a bank account number." },
  PayPal: { label: "PayPal email address", type: "email", placeholder: "name@example.com", help: "Use the email address confirmed on their PayPal account." },
  Wise: { label: "Wise email address", type: "email", placeholder: "name@example.com", help: "Use the email address registered to their Wise account." },
  "Bank transfer": { label: "Bank transfer details", placeholder: "Bank name, account number and routing / SWIFT details", help: "Include the bank name, account number and the routing, sort, IFSC or SWIFT code required in their country." },
};
const PROXY_COUNTRIES = ["IN", "GB", "US", "PH"];
// Setup-fee checking window. New policy (from Sep 2026): the account is checked for about a
// week after login + QC before the setup payment, regardless of account age. A restriction
// adds a few more days once cleared.
const checkWindow = (_freshness?: string | null) => "about a week";

// The coach tour is a first-run aid. Its "seen / skipped" state is persisted per referrer
// token in localStorage (best-effort — private mode or blocked storage just falls back to
// in-memory), so it stops popping up on every fresh onboarding once they've skipped it or
// clicked through it. Wrapped in try/catch and SSR-guarded; a read that fails reads as "new".
const tourStoreKey = (token: string) => `lv-ob-tour:${token}`;
function readTourStore(token: string): { skipped: boolean; seen: string[] } {
  if (typeof window === "undefined") return { skipped: false, seen: [] };
  try {
    const raw = window.localStorage.getItem(tourStoreKey(token));
    const p = raw ? JSON.parse(raw) : null;
    return { skipped: !!p?.skipped, seen: Array.isArray(p?.seen) ? p.seen.filter((s: unknown): s is string => typeof s === "string") : [] };
  } catch { return { skipped: false, seen: [] }; }
}
function writeTourStore(token: string, value: { skipped: boolean; seen: string[] }) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(tourStoreKey(token), JSON.stringify(value)); } catch { /* private mode / blocked — fine */ }
}

export default function SelfServiceWizard({ token, endpoint: endpointProp, selfMode = false, demo = false }: { token: string; endpoint?: string; selfMode?: boolean; demo?: boolean }) {
  // demo = a safe, read-only PREVIEW (`?demo=1`): every field auto-fills and every
  // server call is faked client-side, so the whole wizard can be clicked through
  // without creating an application/account/GoLogin profile/proxy or spending money.
  // Guarded at each network chokepoint below; when demo is false nothing changes.
  // selfMode = the public DIY flow: the ambassador drives their OWN session via a per-session
  // token + the /api/self-onboarding mirror. Everything else is shared with the referral flow.
  const endpoint = endpointProp ?? `/api/m/${encodeURIComponent(token)}/onboarding`;
  const phoneEndpoint = `${endpoint}/phone`;
  // In demo, every "leave this flow" link loops back to a fresh demo run instead
  // of dropping the ?demo=1 param (which would dead-end on the real invalid-token flow).
  const demoHome = `/m/${token}/onboarding?demo=1`;
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const preference = useDisplayCurrency(selfMode ? "public-diy" : token, selfMode ? undefined : bootstrap?.displayCurrency, selfMode ? undefined : token);
  const [step, setStep] = useState(0);
  const [device, setDevice] = useState<"" | "pc" | "phone">("");
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [consent, setConsent] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [showTour, setShowTour] = useState(false);
  // Tour suppression: which pages have been seen, and whether the whole run was skipped.
  // Seeded once from localStorage (per token) so a tour the referrer has already skipped or
  // clicked through does NOT return on the next onboarding; endTour writes changes back.
  const tourInit = useRef<{ skipped: boolean; seen: string[] } | null>(null);
  if (tourInit.current === null) tourInit.current = readTourStore(token);
  const tourSeen = useRef<Set<string>>(new Set(tourInit.current.seen));
  const [tourSkipped, setTourSkipped] = useState(tourInit.current.skipped);
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [setupChoice, setSetupChoice] = useState(false);
  const [setupPick, setSetupPick] = useState<"" | "pc" | "phone" | "team">("");
  const [browserMode, setBrowserMode] = useState<"" | "pc" | "phone">("");
  const [handedOff, setHandedOff] = useState(false);
  // 2FA is its own step (step 4) after the email is made primary. The key is captured
  // there once and reused at sign-in, so the live authenticator code is on hand when
  // LinkedIn asks for it instead of pushing a confirmation to the owner's phone.
  const [twoFactorKey, setTwoFactorKey] = useState("");
  const [idCheck, setIdCheck] = useState({ hasGovernmentId: false, nameMatchesId: false });
  const [accountVerified, setAccountVerified] = useState<"" | "yes" | "no" | "unsure">("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [form, setForm] = useState({ fullName: "", email: "", linkedinUrl: "", country: "", contactNumber: "", phoneVerificationToken: "", accountFreshness: "established", paymentMethod: "", paymentDetails: "", payoutName: "", bankName: "", bankAccountNumber: "", bankRoutingNumber: "", ownerPhotoUrl: "" });

  // --- Demo mode: fabricate everything the UI would otherwise fetch, with no writes. ---
  const demoProgress = useRef<{ twoFa: boolean; email: "add" | "verify" | "primary" | "done"; browser: "reserved" | "ready" | "opened"; confirmed: boolean }>({ twoFa: false, email: "add", browser: "reserved", confirmed: false });
  function demoBootstrap(): Bootstrap {
    return { displayCurrency: "PHP", emailEnabled: true, phoneVerificationEnabled: false, countries: ["Philippines"], autoPurchase: true, config: currencyConfig("demo"), configured: true, doneComputer: false, donePhone: false, sessions: [] };
  }
  function demoEmailSetup(stage: "add" | "verify" | "primary" | "done"): EmailSetup {
    const base = { configured: true, domains: ["linkedvelocity.com"], address: "owner.demo@linkedvelocity.com", destination: "owner.personal@gmail.com", previouslyVerifiedEmail: null, forwardingUntil: null, primaryConfirmedAt: null, latestCodeAt: new Date().toISOString() };
    if (stage === "add") return { ...base, forwardingActive: false, destinationVerified: false, verificationCodePending: false, lastForwardedAt: null, confirmUrl: null, latestCode: null, primaryConfirmed: false };
    if (stage === "verify") return { ...base, forwardingActive: true, destinationVerified: false, verificationCodePending: true, lastForwardedAt: null, confirmUrl: "https://linkedvelocity.com/confirm/demo", latestCode: "483920", primaryConfirmed: false };
    if (stage === "primary") return { ...base, forwardingActive: true, destinationVerified: true, verificationCodePending: false, lastForwardedAt: new Date().toISOString(), confirmUrl: null, latestCode: "712398", primaryConfirmed: false };
    return { ...base, forwardingActive: true, destinationVerified: true, verificationCodePending: false, lastForwardedAt: new Date().toISOString(), confirmUrl: null, latestCode: null, primaryConfirmed: true, primaryConfirmedAt: new Date().toISOString() };
  }
  function demoSession(over: Partial<Session> = {}): Session {
    const cfg = currencyConfig("demo");
    const p = demoProgress.current;
    return {
      emailSetup: demoEmailSetup(p.email), diyTier: null, twoFactorSaved: p.twoFa, meetingRequested: false,
      savedDetails: { fullName: form.fullName, email: form.email, linkedinUrl: form.linkedinUrl, contactNumber: form.contactNumber, paymentMethod: form.paymentMethod, paymentDetails: form.paymentDetails, payoutName: form.payoutName, bankName: form.bankName, bankAccountNumber: form.bankAccountNumber, bankRoutingNumber: form.bankRoutingNumber },
      duplicateWarning: null, country: "PH", proxyAssigned: true, proxyPriceLimit: 10,
      id: "demo", name: form.fullName || "Demo Owner", state: p.confirmed ? "confirmed" : p.browser === "reserved" ? "reserved" : "ready", opened: p.browser === "opened",
      shareLink: "https://app.gologin.com/share/demo-profile", confirmedAt: p.confirmed ? new Date().toISOString() : null,
      accountFreshness: form.accountFreshness, setupDueAt: null, setupAmount: cfg.offer.setup, monthlyAmount: cfg.offer.monthly,
      commission: cfg.symbol + (800).toLocaleString("en-US"), verified: accountVerified === "yes", ...over,
    };
  }

  async function request(method: string, body?: unknown, id?: string) {
    if (demo) {
      const act = body && typeof body === "object" ? (body as { action?: string }).action : undefined;
      if (act === "twofactor") demoProgress.current.twoFa = true;
      if (act === "prepare") demoProgress.current.browser = "ready";
      if (act === "opened") demoProgress.current.browser = "opened";
      if (act === "confirm") { demoProgress.current.twoFa = true; demoProgress.current.confirmed = true; }
      if (act === "meeting") return { session: demoSession({ meetingRequested: true }) };
      if (act === "undo_meeting") return { session: demoSession({ meetingRequested: false }) };
      return { session: demoSession(), ok: true };
    }
    const response = await fetch(endpoint + (id ? `?id=${encodeURIComponent(id)}` : ""), {
      method, headers: { "Content-Type": "application/json" }, cache: "no-store",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  useEffect(() => {
    if (demo) {
      setBootstrap(demoBootstrap());
      setForm((f) => ({ ...f, fullName: "Demo Owner", email: "demo.owner@example.com", linkedinUrl: "https://www.linkedin.com/in/demo-owner", country: "PH", contactNumber: "+63 912 345 6789", accountFreshness: "established", paymentMethod: "GCash", paymentDetails: "0912 345 6789", payoutName: "Demo Owner" }));
      setConsent(true);
      setIdCheck({ hasGovernmentId: true, nameMatchesId: true });
      setAccountVerified("yes");
      setTwoFactorKey("JBSWY3DPEHPK3PXP");
      return;
    }
    let cancelled = false;
    async function load() {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        let retryable = true;
        try {
          const r = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15000) });
          retryable = r.status >= 500 || r.status === 429;
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || "Could not load onboarding.");
          if (!cancelled) {
            setBootstrap(data);
            setForm((f) => ({ ...f, paymentMethod: data.config.defaultPayoutMethod }));
          }
          return;
        } catch (e) {
          if (!retryable || attempt === 2) {
            if (!cancelled) setError(e instanceof Error ? e.message : "Could not load onboarding.");
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
    }
    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, loadAttempt, demo]);

  // Record interaction rather than treating a forgotten open tab as active forever.
  useEffect(() => {
    if (!selfMode || !session || ["confirmed", "handed_off"].includes(session.state)) return;
    let dirty = true;
    const mark = () => { dirty = true; };
    const record = () => {
      if (!dirty || document.visibilityState !== "visible") return;
      dirty = false;
      void fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: session.id, action: "activity" }), keepalive: true })
        .then(r => { if (!r.ok) dirty = true; }).catch(() => { dirty = true; });
    };
    record();
    const timer = window.setInterval(record, 60000);
    const events = ["pointerdown", "keydown", "scroll", "focus"] as const;
    for (const event of events) window.addEventListener(event, mark, { passive: true });
    const visible = () => { if (document.visibilityState === "visible") { mark(); record(); } };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(timer); for (const event of events) window.removeEventListener(event, mark); document.removeEventListener("visibilitychange", visible); };
  }, [selfMode, endpoint, session?.id, session?.state]);

  // Resume an existing session automatically instead of restarting at the details form:
  // - selfMode: the ambassador's own single session (created before they arrived).
  // - referrer path: the specific session the portal's "Resume onboarding" link targets
  //   (?session=<id>), so they land where they left off. showSession picks the right step.
  useEffect(() => {
    if (!bootstrap || session) return;
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const resumeParam = params?.get("session") || null;
    // ?adopt=<applicationId>: a form referrer switching to run the guided onboarding themselves.
    // POST adopts their existing application into a session, then we land in the guided flow (not
    // the details form). Idempotent server-side, so a refresh is safe; swap the URL to ?session=.
    const adoptParam = params?.get("adopt") || null;
    const target = selfMode ? bootstrap.sessions[0] : (resumeParam ? { id: resumeParam } : undefined);
    if (target) {
      void run(async () => { showSession((await request("GET", undefined, target.id)).session as Session); });
    } else if (!selfMode && adoptParam) {
      void run(async () => {
        const s = (await request("POST", { action: "adopt", applicationId: adoptParam })).session as Session;
        showSession(s);
        if (typeof window !== "undefined" && s?.id) window.history.replaceState(null, "", `${window.location.pathname}?session=${encodeURIComponent(s.id)}`);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfMode, bootstrap, session]);

  // Which page's coach tour applies right now (null = no tour for this screen).
  const tourKey = step === 0 ? "before" : step === 1 ? "details" : step === 2 ? "payout" : step === 3 ? "twofa"
    : step === 4 ? "email"
    : step === 6 ? "donePc"
    : step === 5 ? (handedOff ? "donePhone" : browserMode === "" ? "signin" : browserMode === "phone" ? "handoffPhone" : "signinPc")
    : null;
  // A referrer stops being a first-timer only once they've completed BOTH a computer and a
  // phone onboarding. Until then the tour keeps returning on each fresh wizard load.
  const experienced = !selfMode && (!!bootstrap && bootstrap.doneComputer && bootstrap.donePhone);
  // Auto-show each page's tour once per load, unless they're experienced or skipped this run.
  useEffect(() => {
    if (!bootstrap || (selfMode && !device) || !tourKey || experienced || tourSkipped) { setShowTour(false); return; }
    if (tourSeen.current.has(tourKey)) { setShowTour(false); return; }
    setShowTour(true);
  }, [bootstrap, tourKey, experienced, tourSkipped, selfMode, device]);
  const endTour = (skipped: boolean) => {
    setShowTour(false);
    if (tourKey) tourSeen.current.add(tourKey);
    if (skipped) setTourSkipped(true);
    // Persist so the tour stays quiet on the next onboarding, not just this load.
    writeTourStore(token, { skipped: skipped || tourSkipped, seen: [...tourSeen.current] });
  };

  async function run(task: () => Promise<void>) {
    setBusy(true); setError("");
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }
  async function verifyPhone(action: "send" | "check") {
    if (demo) { if (action === "send") setPhoneCodeSent(true); else setForm((c) => ({ ...c, phoneVerificationToken: "demo-token" })); return; }
    setPhoneBusy(true); setPhoneError("");
    try {
      const response = await fetch(phoneEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, phone: form.contactNumber, ...(action === "check" ? { code: phoneCode } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Mobile verification failed.");
      if (action === "send") setPhoneCodeSent(true);
      else setForm((current) => ({ ...current, phoneVerificationToken: data.verificationToken }));
    } catch (e) { setPhoneError(e instanceof Error ? e.message : "Mobile verification failed."); }
    finally { setPhoneBusy(false); }
  }
  function chooseDevice(value: "" | "pc" | "phone") {
    setDevice(value);
    try { if (selfMode) localStorage.setItem(`lv-setup-device:${token}`, value); } catch { /* Storage is optional. */ }
    if (value === "pc" && session?.diyTier !== "partial") setBrowserMode("pc");
  }
  const hydratedSession = useRef<string | null>(null);
  function showSession(s: Session) {
    setSession(s);
    if (!selfMode && s.savedDetails && hydratedSession.current !== s.id) {
      const saved = s.savedDetails;
      setForm(previous => ({ ...previous, ...Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, value || ""])) }));
      hydratedSession.current = s.id;
    }
    if (selfMode) {
      try {
        const saved = localStorage.getItem(`lv-setup-device:${token}`);
        if (saved === "pc" || saved === "phone") {
          setDevice(saved);
          if (saved === "pc" && s.diyTier !== "partial") setBrowserMode("pc");
        }
      } catch { /* Ask for the device when browser storage is unavailable. */ }
    }
    if (selfMode && s.diyTier === "partial") setBrowserMode("phone");
    if (s.state === "handed_off") setHandedOff(true);
    // Order is 2FA (step 3) → secure email (step 4) → sign-in (5). 2FA goes first so LinkedIn's
    // 2FA-setup verification hits the OWNER's inbox (they still hold the primary email); the email
    // swap only happens after. Functional update so we never yank a referrer BACKWARD: 2FA not
    // saved → 2FA (3); 2FA done but email not primary → email (4); otherwise sign-in (5); a refresh
    // once they've moved on leaves them there. confirmed → done (6).
    setStep((prev) => s.state === "confirmed" ? 6 : s.state === "handed_off" ? 5 : !s.twoFactorSaved ? 3 : Math.max(prev, (s.emailSetup && !s.emailSetup.primaryConfirmed) ? 4 : 5));
  }
  async function emailAction(body: unknown) {
    if (!session) return;
    if (demo) {
      const a = (body as { action?: string }).action;
      if (a === "start") demoProgress.current.email = "verify";
      else if (a === "verify") demoProgress.current.email = "primary";
      else if (a === "primary") demoProgress.current.email = "done";
      else if (a === "restart") demoProgress.current.email = "add";
      showSession(demoSession());
      if (a !== "primary") setStep(4);
      return;
    }
    await run(async () => {
      const res = await fetch(`${endpoint}/${session.id}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Email setup failed.");
      showSession(data.session);
      if ((body as { action?: string }).action !== "primary") setStep(4);
    });
  }
  async function handoff(password: string) {
    if (!session) return;
    await run(async () => {
      await request("PATCH", { id: session.id, action: "handoff", password, twoFactorKey: twoFactorKey.trim() });
      setHandedOff(true);
    });
  }
  async function action(action: "prepare" | "opened") {
    if (!session) return;
    const data = await request("PATCH", { id: session.id, action });
    showSession(data.session);
  }
  async function confirmLogin(password: string) {
    if (!session) return;
    await run(async () => {
      const data = await request("PATCH", { id: session.id, action: "confirm", password, twoFactorKey: twoFactorKey.trim() });
      showSession(data.session);
    });
  }
  // Persist the 2FA key as soon as it's set up (2FA step), so it's recorded even if the
  // onboarding stalls before sign-in. Best-effort; the sign-in confirm/hand-off also send it.
  async function saveTwoFactor() {
    if (!session || !looksLikeTotpKey(twoFactorKey)) return;
    try { await request("PATCH", { id: session.id, action: "twofactor", twoFactorKey: twoFactorKey.trim() }); } catch { /* best effort */ }
  }
  async function uploadPhoto(file: File) {
    if (demo) { setForm((f) => ({ ...f, ownerPhotoUrl: "https://dummyimage.com/300x380/e5e7eb/9ca3af&text=Demo+ID+photo" })); return; }
    setPhotoBusy(true); setPhotoError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`${endpoint}/photo`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setForm((f) => ({ ...f, ownerPhotoUrl: data.url }));
    } catch (e) { setPhotoError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setPhotoBusy(false); }
  }
  const field = (key: keyof typeof form, label: string, type = "text", placeholder = "", required = true) => (
    <label className={styles.field}>{label}<input required={required} type={type} value={form[key]} maxLength={key === "paymentDetails" ? 500 : 254} placeholder={placeholder}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>
  );

  const wizardSteps = [
    { index: 0, label: "Start with them", detail: "The account owner must stay with you for the entire setup." },
    { index: 1, label: "Owner details", detail: "Add their LinkedIn and contact details." },
    { index: 2, label: "Payout", detail: "Record where the account owner should be paid." },
    { index: 3, label: "Two-step verification", detail: "Turn on authenticator 2FA so sign-in asks for a code, not a device prompt." },
    ...(bootstrap?.emailEnabled ? [{ index: 4, label: "Add secure email", detail: "The account owner approves a LinkedVelocity-managed email on LinkedIn." }] : []),
    { index: 5, label: "Prepare & sign in", detail: "The account owner enters their login, codes and completes any checks." },
    { index: 6, label: "Team verification", detail: "We check the saved session before activation and payment." },
  ].filter(item => !selfMode || item.index >= 3);
  const currentPos = Math.max(0, wizardSteps.findIndex((s) => s.index === step));
  const activeStep = wizardSteps[currentPos];
  // Currency follows the referrer (₱ for PH, $ for USD referrers) — everything the
  // wizard shows about money comes from bootstrap.config, never hardcoded pesos.
  const cfg = bootstrap?.config;
  const fmtMoney = (n: number) => cfg ? configuredOffer(n, cfg.currency, preference.currency) : "";
  const setupOffer = cfg ? fmtMoney(cfg.setupAmount) : "";
  const monthlyOffer = cfg ? fmtMoney(cfg.monthlyAmount) : "";
  const moneyText = (text: string) => configuredText(text, preference.currency);
  const refBase = cfg ? fmtMoney(cfg.referralTiers.referral) : "";
  const refMax = cfg ? fmtMoney(cfg.referralTiers.computer.verified) : "";
  const phoneRange = offerRange(10, 13, 600, 800, preference.currency);
  const computerRange = offerRange(11, 16, 700, 1000, preference.currency);
  const payoutField = PAYOUT_FIELDS[form.paymentMethod] || { label: "Payout details", placeholder: "Account number or payment address", help: "Enter everything needed to send the payment." };
  const scriptCtx: ScriptContext = {
    name: session?.name || form.fullName,
    address: session?.emailSetup?.address || null,
    termsUrl: `${typeof window !== "undefined" ? window.location.origin : "https://linkedvelocity.com"}/ambassador-terms`,
    guideUrl: `${typeof window !== "undefined" ? window.location.origin : "https://linkedvelocity.com"}/ambassador-guide`,
    setupDays: form.accountFreshness === "established" ? 3 : 7,
  };
  const selectedCountry = countryCode(form.country);
  const browserCapacityAvailable = selectedCountry && PROXY_COUNTRIES.includes(selectedCountry)
    ? bootstrap?.countries.some((country) => countryCode(country) === selectedCountry)
    : bootstrap?.countries.some((country) => {
      const code = countryCode(country);
      return !!code && PROXY_COUNTRIES.includes(code);
    });

  async function moveToComputer() {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: "LinkedVelocity onboarding", url }); return; }
      catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
    }
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
  }

  function selectSetupMethod(method: "phone" | "pc") {
    setBrowserMode(method);
    setSetupChoice(false);
    setError("");
    // Choosing a route never skips unfinished 2FA or email setup (2FA first, then email).
    setStep(!session?.twoFactorSaved ? 3 : (session?.emailSetup && !session.emailSetup.primaryConfirmed) ? 4 : 5);
  }
  function setupOptions() {
    if (!session) return null;
    const optCard = (id: "pc" | "phone", title: string, price: string, body: string, tags: [string, string, string][]) => {
      const on = setupPick === id;
      return <button type="button" {...(id === "phone" ? { "data-tour": "signin-choice" } : {})} onClick={() => setSetupPick(id)} style={{ textAlign: "left", cursor: "pointer", background: "#fff", border: `2px solid ${on ? "#16a34a" : "#e3e6ea"}`, borderRadius: 16, padding: 16, display: "flex", gap: 12, alignItems: "flex-start", boxShadow: on ? "0 4px 14px rgba(22,163,74,.12)" : "none", width: "100%", boxSizing: "border-box", font: "inherit" }}>
        <span style={{ width: 20, height: 20, flex: "none", borderRadius: "50%", border: `2px solid ${on ? "#16a34a" : "#c5cbd3"}`, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: on ? "#16a34a" : "transparent" }} /></span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ font: "800 16px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#0b1220" }}>{title}</span>
            <span style={{ font: "700 14px 'Space Grotesk', system-ui, sans-serif", color: "#15803d", whiteSpace: "nowrap" }}>{price}</span>
          </span>
          <span style={{ font: "500 13.5px/1.45 'Plus Jakarta Sans', system-ui, sans-serif", color: "#5b6779" }}>{body}</span>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{tags.map(([label, bg, fg]) => <span key={label} style={{ font: "700 11px 'Plus Jakarta Sans', system-ui, sans-serif", padding: "3px 8px", borderRadius: 999, background: bg, color: fg }}>{label}</span>)}</span>
        </span>
      </button>;
    };
    return <>
            <h1 className={styles.heroTitle}>{selfMode ? "Finish your account setup" : "How will you finish setup?"}</h1>
            <p className={styles.lead}>{selfMode ? "Complete Full DIY on a computer for the larger sign-on bonus, or switch to Email + 2FA and let our team finish." : "The more you do with the owner, the more you earn."}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {optCard("pc", "Full setup on a laptop", selfMode ? "$32 (₱2,000) sign-on" : computerRange, selfMode ? "Open the protected browser and sign in to your own LinkedIn. Highest sign-on bonus." : "Sign in to their LinkedIn in our secure browser while you’re in touch with the owner — a call or chat works.", [["⏱ ~20–30 min", "#eef4ff", "#1d4ed8"], ["Highest pay", "#dcfce7", "#15803d"], ["Windows or Mac", "#eef0f4", "#3b4556"]])}
              {optCard("phone", selfMode ? "Hand it to us" : "I’ve done email + 2FA", selfMode ? "$24 (₱1,500) sign-on" : phoneRange, selfMode ? "Set a temporary password and our team completes the sign-in. Works on a phone." : "You’re finished — hand over and our team does the final sign-in.", [["⏱ Done now", "#eef4ff", "#1d4ed8"], ["Works on a phone", "#eef0f4", "#3b4556"]])}
            </div>
            {!selfMode && <div style={{ borderTop: "1px solid #e3e6ea", paddingTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {session.meetingRequested ? <div className={styles.note}>✓ Submitted — our team will try to reach the owner and complete setup. A meeting isn’t booked yet.<div style={{ marginTop: 6 }}><button type="button" className={styles.linkBtn} disabled={busy} onClick={() => run(async () => { const result = await request("PATCH", { id: session.id, action: "undo_meeting" }); setSession(result.session); })}>Undo — I’ll continue the setup</button></div></div> : <>
                <button type="button" onClick={() => setSetupPick("team")} style={{ textAlign: "left", cursor: "pointer", background: setupPick === "team" ? "#fff" : "transparent", border: `1.5px ${setupPick === "team" ? "solid" : "dashed"} ${setupPick === "team" ? "#5b6779" : "#d5d9e0"}`, borderRadius: 14, padding: "13px 16px", display: "flex", gap: 12, alignItems: "center", width: "100%", boxSizing: "border-box", font: "inherit" }}>
                  <span style={{ width: 18, height: 18, flex: "none", borderRadius: "50%", border: `2px solid ${setupPick === "team" ? "#5b6779" : "#c5cbd3"}`, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: setupPick === "team" ? "#5b6779" : "transparent" }} /></span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><span style={{ font: "700 14px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#3b4556" }}>Leave it to our team</span><span style={{ font: "700 13px 'Space Grotesk', system-ui, sans-serif", color: "#5b6779", whiteSpace: "nowrap" }}>{refBase}</span></span>
                    <span style={{ font: "500 12.5px/1.45 'Plus Jakarta Sans', system-ui, sans-serif", color: "#8a93a3" }}>Can take days to reach the owner, and is less likely to finish. Paid only if it completes.</span>
                  </span>
                </button>
                <a href="https://calendly.com/linkedvelocity-info/30min" onClick={e => { e.preventDefault(); if (busy) return; void run(async () => { if (!session.meetingRequested) { const result = await request("PATCH", { id: session.id, action: "meeting" }); setSession(result.session); } window.location.assign("https://calendly.com/linkedvelocity-info/30min"); }); }} style={{ font: "700 13px 'Plus Jakarta Sans', system-ui, sans-serif", textDecoration: "none", paddingLeft: 4, color: "#15803d" }}>Book a time with the owner instead →</a>
              </>}
            </div>}
            <button type="button" className={styles.primary} style={{ marginTop: 18, ...(setupPick === "team" ? { background: "#3b4556" } : {}) }} disabled={busy || !setupPick} onClick={() => { if (setupPick === "pc") selectSetupMethod("pc"); else if (setupPick === "phone") selectSetupMethod("phone"); else if (setupPick === "team") void run(async () => { const result = await request("PATCH", { id: session.id, action: "meeting" }); setSession(result.session); }); }}>{!setupPick ? "Choose an option" : setupPick === "team" ? "Hand over to our team →" : "Continue →"}</button>
    </>;
  }

  const canGoBack = !!bootstrap && !handedOff && step < 6 && (!selfMode || !!device)
    && (step >= 1 && step <= 5);
  function goBack() {
    if (busy) return;
    setError("");
    if (setupChoice) { setSetupChoice(false); setStep(2); }
    else if (!selfMode && step === 3) setSetupChoice(true);
    else if (step === 5 && browserMode) setBrowserMode("");
    else if (selfMode && step === 3) chooseDevice("");
    else setStep(step - 1);
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      {demo && <div style={{ background: "#fde68a", color: "#78350f", font: "700 13px 'Plus Jakarta Sans', system-ui, sans-serif", textAlign: "center", padding: "8px 16px", letterSpacing: ".02em" }}>👁️ DEMO PREVIEW — every field is pre-filled and nothing is saved. No account, proxy or email is created.</div>}
      <header className={styles.header}>
        <div className={styles.headerRow}>
          {canGoBack ? <button type="button" className={styles.headerBack} disabled={busy} onClick={goBack}>← Back</button>
            : <Link href={demo ? demoHome : selfMode ? "/dashboard" : `/m/${token}`} className={styles.headerBack}>← Dashboard</Link>}
          <span className={styles.headerTitle}>DIY onboarding</span>
          {bootstrap && !setupChoice && <span className={styles.headerStep}>Step {currentPos + 1} of {wizardSteps.length}</span>}
        </div>
        <div className={styles.progress} aria-hidden="true">
          {wizardSteps.map((s, i) => <span key={s.label} style={{ background: i <= currentPos ? "#16a34a" : "rgba(255,255,255,.16)" }} />)}
        </div>
      </header>
      <CurrencySelector preference={preference} />
      {selfMode && <p className={styles.hint} style={{ padding: "12px 24px", margin: 0 }}>Your completed steps are saved. Return through your LinkedVelocity dashboard and select <strong>Continue setup</strong> under Accounts I’m Renting Out.</p>}

      <div className={styles.content}>
        {error && step !== 4 && <div className={styles.error} role="alert">{error}</div>}
        {!bootstrap && error && <button className={styles.primary} onClick={() => { setError(""); setLoadAttempt((n) => n + 1); }}>Retry loading onboarding</button>}
        {!bootstrap && !error && <p className={styles.loading} role="status">Loading onboarding…</p>}

        {selfMode && session?.duplicateWarning && <div className={styles.warn} role="alert"><strong>Previous application found</strong><p>{session.duplicateWarning}</p></div>}
        {bootstrap && selfMode && !device && <>
          <h1 className={styles.heroTitle}>Let’s set up your account</h1>
          <p className={styles.lead}>{session?.diyTier === "partial" ? "We’ll guide you through adding the managed email and turning on 2FA. Then our team completes the browser sign-in." : "We’ll guide you through email, 2FA and the protected-browser sign-in, with help at each step."}</p>
          <div className={styles.card}>
            <p><strong>Email + 2FA: <OnboardingPrice usd={24} php={1500} /> sign-on bonus.</strong> You add the email and 2FA; our team finishes the browser sign-in.</p>
            <p><strong>Full DIY: <OnboardingPrice usd={32} php={2000} /> sign-on bonus.</strong> Earn <OnboardingPrice usd={8} php={500} /> more by completing the sign-in yourself. <strong>Full DIY requires a Windows or Mac laptop or desktop with GoLogin installed. You cannot complete Full DIY on a phone.</strong></p>
            <p style={{ marginBottom: 0, color: "#067A45" }}><strong>Both options: <OnboardingPrice usd={8} php={500} /> every month</strong> once onboarding is complete.</p>
          </div>
          <h2>Are you using a phone or a computer?</h2>
          <button className={styles.choiceCard} onClick={() => chooseDevice("phone")}><strong>I’m on a phone</strong><p>Complete the email and 2FA steps on your phone. Full DIY cannot be completed on a phone: you must switch to a Windows or Mac computer to install and use GoLogin.</p></button>
          <button className={styles.choiceCard} onClick={() => chooseDevice("pc")}><strong>I’m on a laptop or desktop</strong><p>Choose this for Full DIY. You’ll install GoLogin on your Windows or Mac computer and complete the account sign-in yourself.</p></button>
        </>}
        {bootstrap && (!selfMode || device) && <>
          {railOpen ? <div className={styles.railOpen}>
            <div className={styles.railKick}>HOW IT WORKS</div>
            <h2>One setup, {wizardSteps.length} clear steps</h2>
            <p>{selfMode ? "Follow each step for your own account. Keep LinkedIn and your email inbox open; your progress is saved." : "It usually takes about 10 minutes. Don’t begin unless the account owner can stay until sign-in is complete."}</p>
            {wizardSteps.map((item, position) => {
              const complete = item.index < step;
              return <div key={item.label} className={styles.railStep}>
                <span className={styles.railDot}>{complete ? "✓" : position + 1}</span>
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              </div>;
            })}
            <button type="button" className={styles.linkBtn} onClick={() => setRailOpen(false)}>Hide steps ▲</button>
          </div> : <button type="button" data-tour="rail" className={styles.rail} onClick={() => setRailOpen(true)}>
            <span className={styles.railKick}>HOW IT WORKS</span>
            <span className={styles.railNext}>Now: {activeStep?.label}</span>
            <span className={styles.railToggle}>Show all ▼</span>
          </button>}

          {showTour && tourKey && PAGE_TOURS[tourKey] && <CoachTour steps={selfMode ? [{ title: activeStep?.label || "Your next step", body: tourKey === "email" ? "Add the managed email to your own LinkedIn account, verify it, and make it primary. The guides below show each step." : tourKey === "twofa" ? "Turn on authenticator-based two-step verification on your account. Paste the setup key here, then use the displayed code to finish in LinkedIn." : "Follow the instructions below for your own account. Your progress is saved, and you can return using this link." }] : PAGE_TOURS[tourKey]} onDone={endTour} />}

          {selfMode && !session && !error && <div style={{ padding: 28, textAlign: "center", color: "#5A6473" }}>Loading your onboarding…</div>}
          {!selfMode && session && !handedOff && step >= 3 && step < 6 && !setupChoice && <button type="button" className={styles.linkBtn} disabled={busy} onClick={() => { setError(""); setSetupChoice(true); }}>← Change setup option</button>}
          {setupChoice && setupOptions()}
          <div hidden={setupChoice}>
          {session?.emailSetup?.latestCode && step >= 3 && step < 6 && (
            <div style={{ margin: "0 0 14px", border: "2px solid #15803d", background: "#f0faf4", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#15803d", marginBottom: 4 }}>Latest code from LinkedIn</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: ".16em", color: "#0b1220" }}>{session.emailSetup.latestCode}</span>
                <button type="button" onClick={() => { navigator.clipboard?.writeText(session.emailSetup!.latestCode!); }} style={{ fontSize: 12, fontWeight: 700, color: "#0b1220", background: "#a7f3d0", border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>Copy</button>
                <button type="button" disabled={busy} onClick={() => run(async () => showSession((await request("GET", undefined, session.id)).session))} style={{ fontSize: 12, fontWeight: 600, color: "#15803d", background: "none", border: "none", cursor: "pointer" }}>Refresh</button>
              </div>
              <div style={{ fontSize: 11.5, lineHeight: 1.45, fontWeight: 500, color: "#166534", marginTop: 6 }}>Sent to {session.emailSetup.address} for this account. Codes expire fast — if LinkedIn rejects it, tap resend on LinkedIn, then Refresh here.</div>
            </div>
          )}
          {!selfMode && step === 0 && <>
            <h1 className={styles.heroTitle}>Before you begin</h1>
            <p className={styles.lead}>You&apos;re the referrer. You&apos;re onboarding the <strong>account owner</strong> — the person whose LinkedIn this is — virtually, with them on the other end. Six steps, about ten minutes.</p>
            <button type="button" className={styles.linkBtn} style={{ width: "auto", textAlign: "left", padding: "0 0 10px", color: "#15803d" }} onClick={() => { if (tourKey) tourSeen.current.delete(tourKey); setTourSkipped(false); setShowTour(true); }}>New here? Take the quick tour →</button>
            <div className={styles.warn}>
              <div>Don&apos;t start unless they can stay</div>
              <p>LinkedIn will send codes and may ask them to confirm who they are. If they walk away halfway, the account can&apos;t be finished and nobody gets paid.</p>
            </div>
            <div className={styles.card} data-tour="need">
              <div className={styles.cardTitle}>They need, right now</div>
              <div className={styles.rowLine}><span className={styles.tick}>✓</span><span className={styles.rowText}>Their LinkedIn email and password — on a computer you use it to sign in, with them sitting right there.</span></div>
              <div className={styles.rowLine}><span className={styles.tick}>✓</span><span className={styles.rowText}>An inbox open in front of you for LinkedIn&apos;s confirmation code — yours or theirs, either is fine.</span></div>
              <div className={styles.rowLine}><span className={styles.tick}>✓</span><span className={styles.rowText}>A government ID somewhere at home — we never take a copy, LinkedIn may ask them later.</span></div>
              <div className={styles.rowLine}><span className={styles.tick}>✓</span><span className={styles.rowText}>A way for you to reach them again — you&apos;re our contact for this account, not them.</span></div>
            </div>
            <ShareLinks ctx={scriptCtx} />
            <div className={styles.note}>
              <div style={{ font: "700 13px 'Plus Jakarta Sans'", color: "#166534", marginBottom: 8 }}>Who gets what</div>
              <div className={styles.payRow}><span>They get</span><span className={styles.payAmt}>{setupOffer} + {monthlyOffer}/mo</span></div>
              <div className={styles.payRow}><span>You get</span><span className={styles.payAmt}>{refBase}–{refMax}</span></div>
              <p style={{ margin: "10px 0 0", fontWeight: 500 }}>Your exact rate is set at the sign-in step, by who does the final sign-in and whether the account is ID-verified.</p>
            </div>
            <div className={styles.consentCard} data-tour="consent">
              <label className={styles.check}><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>They&apos;re here with me, they meet <a href="https://www.linkedin.com/help/linkedin/answer/a6854067" target="_blank" rel="noreferrer">LinkedIn&apos;s minimum age (16, or older where local law requires)</a>, they can reach their own email and phone, and they agree to add a LinkedVelocity email and share access under the <a href="/ambassador-terms" target="_blank" rel="noreferrer">terms</a>.</span></label>
            </div>
            {!bootstrap.configured && <p className={styles.note}>You can enter the details now. The team will need to configure browser access before you can save and continue to sign-in.</p>}
            {bootstrap.configured && !bootstrap.autoPurchase && bootstrap.countries.length === 0 && <p className={styles.note}>You can enter the details now. A dedicated proxy will be needed before you can save and continue to sign-in.</p>}
            <button data-tour="start" className={styles.primary} disabled={!consent} onClick={() => setStep(1)}>Start onboarding →</button>
            {bootstrap.sessions.length > 0 && <div className={styles.resume}><h3>Your saved onboardings</h3>{bootstrap.sessions.map((s) => <button key={s.id} disabled={busy} onClick={() => run(async () => showSession((await request("GET", undefined, s.id)).session))}>
              <span>{s.name}</span><span>{s.done ? "View summary" : "Resume"} →</span></button>)}</div>}
          </>}

          {step === 1 && !session && <form onSubmit={(e) => { e.preventDefault(); if (bootstrap.phoneVerificationEnabled && !form.phoneVerificationToken) { setPhoneError("Verify the mobile number before continuing."); return; } setError(""); setStep(2); }}>
            <h1 className={styles.heroTitle}>Who&apos;s the account owner?</h1>
            <p className={styles.lead}>Fill these in and confirm each one with the owner as you go — it&apos;s their account.</p>
            <div className={styles.card}>
            {field("fullName", "Full name, as on their ID", "text", "Their full name")}
            {field("email", "Their own email", "email", "them@gmail.com")}
            <label className={styles.field}>Mobile, with country code<input required type="tel" value={form.contactNumber} placeholder="+63 912 345 6789" onChange={(e) => { setForm({ ...form, contactNumber: e.target.value, phoneVerificationToken: "" }); setPhoneCode(""); setPhoneCodeSent(false); setPhoneError(""); }} /></label>
            <p className={styles.hint}>Only needed if we ever have to reach them directly — day to day comes to you.</p>
            {bootstrap.phoneVerificationEnabled && <div>
              {form.phoneVerificationToken ? <div className={styles.verifiedPhone}>✓ Mobile number verified</div> : <>
                <button type="button" className={styles.verifyButton} disabled={phoneBusy || form.contactNumber.trim().length < 8} onClick={() => void verifyPhone("send")}>{phoneBusy && !phoneCodeSent ? "Sending…" : phoneCodeSent ? "Send a new code" : "Send verification code"}</button>
                {phoneCodeSent && <div className={styles.verificationRow}><input className={styles.codeInput} inputMode="numeric" autoComplete="one-time-code" value={phoneCode} maxLength={10} placeholder="SMS code" onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, ""))} /><button type="button" className={styles.verifyButton} disabled={phoneBusy || phoneCode.length < 4} onClick={() => void verifyPhone("check")}>{phoneBusy ? "Checking…" : "Verify number"}</button></div>}
                {phoneCodeSent && <p className={styles.phoneHint}>Ask the account owner to read you the code sent to this phone.</p>}
                {phoneError && <p className={styles.phoneError} role="alert">{phoneError}</p>}
              </>}
            </div>}
            {field("linkedinUrl", "Their LinkedIn profile link", "url", "linkedin.com/in/their-name")}
            <label className={styles.field}>Country the account is normally used in<select required value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
              <option value="">Choose their country</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select></label><p className={styles.hint}>We match their connection to this country, so LinkedIn keeps seeing them log in from home.</p>
            </div>

            <div className={styles.card} data-tour="age">
              <div className={styles.cardTitle}>How old is the account?</div>
              <button type="button" className={`${styles.optionCard} ${form.accountFreshness === "established" ? styles.optionOn : ""}`} onClick={() => setForm({ ...form, accountFreshness: "established" })}><span className={styles.radio} /><span><strong>More than a month old</strong><small>About a week of checks, then payment</small></span></button>
              <button type="button" className={`${styles.optionCard} ${form.accountFreshness === "fresh" ? styles.optionOn : ""}`} onClick={() => setForm({ ...form, accountFreshness: "fresh" })}><span className={styles.radio} /><span><strong>Less than a month old</strong><small>About a week of checks before payment, and expect the odd restriction</small></span></button>
            </div>

            <div className={styles.card} data-tour="verified">
              <div className={styles.cardTitle}>Is their LinkedIn already verified?</div>
              <p className={styles.cardSub}>Ask the owner to open their profile and look under their name — a verified profile says &ldquo;Verified&rdquo; there. This changes what you earn, so check rather than guess.</p>
              {([{ v: "yes", t: "Yes — it says Verified", s: "Top rate: your commission goes up" }, { v: "no", t: "No, not verified", s: "Fine, they can still do it later" }, { v: "unsure", t: "Not sure yet", s: "We'll confirm it during the checks" }] as const).map((o) => (
                <button key={o.v} type="button" className={`${styles.optionCard} ${accountVerified === o.v ? styles.optionOn : ""}`} onClick={() => setAccountVerified(o.v)}><span className={styles.radio} /><span><strong>{o.t}</strong><small>{o.s}</small></span></button>
              ))}
              <div className={styles.note} style={{ marginTop: 4 }}>Worth doing now: they can verify with a passport in the LinkedIn app in about two minutes. It makes restrictions much less likely, and it moves you to the top rate.</div>
            </div>
            <div className={styles.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}><div className={styles.cardTitle} style={{ marginBottom: 0 }}>A photo of them</div><span style={{ font: "700 9.5px 'Plus Jakarta Sans'", letterSpacing: ".06em", color: "#8b95a5", border: "1px solid #e3e6ea", borderRadius: 5, padding: "3px 6px" }}>OPTIONAL</span></div>
              <p className={styles.cardSub}>Upload one where their full face is clearly visible, smiling if possible. It doesn&apos;t need to be professional — we&apos;ll tidy it up.</p>
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                {form.ownerPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.ownerPhotoUrl} alt="Uploaded" width={56} height={56} style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", flex: "none", border: "1px solid #e3e6ea" }} />
                ) : <span style={{ width: 56, height: 56, borderRadius: "50%", flex: "none", background: "#f7f8fa", border: "1px solid #e3e6ea", display: "flex", alignItems: "center", justifyContent: "center", font: "600 9px 'Plus Jakarta Sans'", color: "#98a2b3" }}>No photo</span>}
                <div style={{ minWidth: 0 }}>
                  {form.ownerPhotoUrl
                    ? <button type="button" className={styles.linkBtn} style={{ width: "auto", textAlign: "left", padding: 0 }} onClick={() => setForm({ ...form, ownerPhotoUrl: "" })}>Remove photo</button>
                    : <label className={styles.secondary} style={{ cursor: "pointer", display: "inline-block", width: "auto", padding: "11px 16px" }}>{photoBusy ? "Uploading…" : "Upload a photo"}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden disabled={photoBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f); e.target.value = ""; }} /></label>}
                  <p className={styles.hint} style={{ margin: "8px 0 0" }}>Whatever they send you is fine. Skip it and we&apos;ll ask later.</p>
                </div>
              </div>
              {photoError && <p className={styles.phoneError} style={{ marginTop: 8 }}>{photoError}</p>}
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>ID check</div>
              <p className={styles.cardSub}>We never take a copy. They just need one in case LinkedIn asks them to verify later.</p>
              <div className={styles.check} style={{ margin: "4px 0 0" }}><input type="checkbox" checked={idCheck.hasGovernmentId} onChange={(e) => setIdCheck({ ...idCheck, hasGovernmentId: e.target.checked })} id="hasGovId" /><label htmlFor="hasGovId">They own a <strong>physical government ID</strong> — passport, national ID or driver&apos;s license.</label></div>
              <div className={styles.check}><input type="checkbox" checked={idCheck.nameMatchesId} onChange={(e) => setIdCheck({ ...idCheck, nameMatchesId: e.target.checked })} id="nameMatches" /><label htmlFor="nameMatches">The name they gave above <strong>matches the name on that ID</strong>.</label></div>
            </div>
            <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setStep(0)}>Back</button><button className={styles.primary} disabled={(bootstrap.phoneVerificationEnabled && !form.phoneVerificationToken) || !idCheck.hasGovernmentId || !idCheck.nameMatchesId || !accountVerified}>Continue →</button></div>
          </form>}

          {step === 1 && session && <>
            <h1 className={styles.heroTitle}>Account details</h1>
            <div className={styles.card}><p><strong>{session.savedDetails?.fullName || session.name}</strong></p><p>{session.savedDetails?.email}</p><p>{session.savedDetails?.linkedinUrl}</p><p>{session.savedDetails?.contactNumber}</p></div>
            <p className={styles.hint}>These details identify the saved application. Contact the team if the account details need correcting.</p>
            <button type="button" className={styles.primary} onClick={() => setStep(2)}>Continue to payout details →</button>
          </>}
          {step === 2 && <form onSubmit={(e) => { e.preventDefault(); run(async () => {
              if (session) { const data = await request("PATCH", { ...form, id: session.id, action: "payout" }); setSession(data.session); setStep(3); }
              else showSession((await request("POST", { ...form, consent, ...idCheck, linkedinVerified: accountVerified === "yes" })).session);
            }); }}>
            <h1 className={styles.heroTitle}>Where should they get paid?</h1>
            <p className={styles.lead}>This is <strong>their</strong> {setupOffer} and {monthlyOffer} a month. Your own commission goes to the details on your portal.</p>
            <div className={styles.card} data-tour="payout-method">
            <label className={styles.field}>Pay them via<select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value, paymentDetails: "", bankName: "", bankAccountNumber: "", bankRoutingNumber: "" })}>{bootstrap.config.payoutMethods.map((p) => <option key={p}>{p}</option>)}</select></label>
            {field("payoutName", "Name registered on that account", "text", "Must match the payment account")}
            {form.paymentMethod === "Bank transfer" ? <>
              {field("bankName", "Bank name", "text", "Name of the receiving bank")}
              {field("bankAccountNumber", "Account number or IBAN", "text", "Receiving account number")}
              {field("bankRoutingNumber", "Routing, IFSC, sort or SWIFT code (optional)", "text", "Only if their bank needs one — not required in the Philippines", false)}
            </> : <>
              {field("paymentDetails", payoutField.label, payoutField.type || "text", payoutField.placeholder)}
              <p className={styles.hint}>{payoutField.help}</p>
            </>}
            </div>
            {(!bootstrap.configured || (!bootstrap.autoPurchase && !browserCapacityAvailable)) && <div className={styles.warn}><div>Browser setup isn&apos;t ready yet</div><p>Your entries are only held on this page until you successfully save. Keep this tab open while the team configures browser access, then try Save &amp; continue.</p></div>}
            <div className={styles.infoBlue} data-tour="payout-when">
              <div>When they get paid</div>
              <div style={{ display: "flex", gap: 12, margin: "4px 0 2px" }}><strong style={{ minWidth: 72, color: "#1e3a8a", font: "700 13px 'Plus Jakarta Sans'" }}>{setupOffer}</strong><span style={{ font: "500 12.5px/1.5 'Plus Jakarta Sans'", color: "#1e3a8a" }}>About a week after sign-in, once we&apos;ve verified the account.</span></div>
              <div style={{ display: "flex", gap: 12, margin: "4px 0 2px" }}><strong style={{ minWidth: 72, color: "#1e3a8a", font: "700 13px 'Plus Jakarta Sans'" }}>{monthlyOffer}/mo</strong><span style={{ font: "500 12.5px/1.5 'Plus Jakarta Sans'", color: "#1e3a8a" }}>First weekday of each month, while the account stays active.</span></div>
              <p style={{ marginTop: 8 }}>They just need to stay reachable for the odd LinkedIn check.</p>
              <div className={styles.note} style={{ marginBottom: 0, marginTop: 10 }}><strong>No need to check in.</strong> Payments go out during the day on payday and we&apos;ll send a receipt. Not there by end of day? Message us then.</div>
            </div>
            <div className={styles.actions}><button type="button" disabled={busy} className={styles.secondary} onClick={() => setStep(1)}>Back</button><button className={styles.primary} disabled={busy}>{busy ? "Saving…" : "Save & continue →"}</button></div>
          </form>}

          {selfMode && session && <div className={styles.note}>
            <strong>{session.diyTier === "partial" ? "Email + 2FA setup" : "Full DIY setup"}</strong> · Your sign-on bonus: {moneyText(session.setupAmount)} · {moneyText(session.monthlyAmount)}/month after onboarding.
            <p><a href="/ambassador-guide" target="_blank" rel="noreferrer">Account setup guide</a> · <a href="/guide/two-step-verification" target="_blank" rel="noreferrer">2FA guide</a> · <a href="/guide" target="_blank" rel="noreferrer">GoLogin guide</a></p>
            <button className={styles.linkBtn} onClick={() => chooseDevice("")}>Change device</button>
          </div>}
          {step === 4 && session?.emailSetup && <>
            <div className={styles.stepLabel}>Add secure email</div>
            <EmailStep selfMode={selfMode} demo={demo} key={`${session.id}-${session.emailSetup.forwardingActive}-${session.emailSetup.lastForwardedAt || "waiting"}`} setup={session.emailSetup} busy={busy} submit={emailAction} refresh={() => run(async () => showSession((await request("GET", undefined, session.id)).session))} />
          </>}

          {step === 3 && session && <>
            <div className={styles.stepLabel}>Two-step verification</div>
            <h1 className={styles.heroTitle}>Turn on two-step verification</h1>
            <p className={styles.lead}>Do this <strong>before</strong> signing in, so LinkedIn asks for a code instead of pinging {selfMode ? "your" : "the owner’s"} phone.</p>
            <div className={styles.warn}>
              <div>Copy the key — don&apos;t scan the QR</div>
              <p>If you scan it into your own app, {selfMode ? "we" : "the team"} can&apos;t make sign-in codes and you&apos;ll be stuck.</p>
            </div>
            {(() => {
              const captured = looksLikeTotpKey(twoFactorKey) || (!!session.twoFactorSaved && !twoFactorKey.trim());
              const dot = (label: string | number, done = false) => <span style={{ width: 26, height: 26, flex: "none", borderRadius: "50%", background: done ? "#16a34a" : "#0b1220", color: "#fff", font: "700 12.5px 'Space Grotesk', system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>{label}</span>;
              const line = () => <span style={{ flex: 1, width: 2, background: "#e3e6ea", margin: "4px 0" }} />;
              const txt = { font: "600 14.5px/1.45 'Plus Jakarta Sans', system-ui, sans-serif", color: "#0b1220" } as const;
              const colL = { display: "flex", flexDirection: "column", alignItems: "center" } as const;
              return <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={colL}>{dot(1)}{line()}</div>
                  <div style={{ flex: 1, minWidth: 0, padding: "2px 0 18px" }}><div style={txt}>In the LinkedIn app, go to <strong>Settings → Sign in &amp; security → Two-step verification</strong></div></div>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={colL}>{dot(2)}{line()}</div>
                  <div style={{ flex: 1, minWidth: 0, padding: "2px 0 18px" }}><div style={txt}>Choose <strong>Authenticator app</strong></div></div>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={colL}>{dot(3)}{line()}</div>
                  <div style={{ flex: 1, minWidth: 0, padding: "2px 0 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={txt}>Copy the long key under the QR code</div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <div style={{ border: "1px solid #e3e6ea", borderRadius: 10, overflow: "hidden", background: "#fff" }}><img src="/onboarding/2fa-key-sample.png" alt="Where the key appears in LinkedIn, with the copy icon" style={{ width: "100%", display: "block" }} /></div>
                    <div style={{ font: "500 12px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#8a93a3" }}>Tap the copy icon. Can&apos;t see it? Tap &ldquo;Can&apos;t scan the QR code?&rdquo;</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12 }} data-tour="twofa-key">
                  <div style={colL}>{dot(captured ? "✓" : 4, captured)}{line()}</div>
                  <div style={{ flex: 1, minWidth: 0, padding: "2px 0 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={txt}>Paste it here</div>
                    <input type="text" autoComplete="off" maxLength={128} value={twoFactorKey} onChange={(e) => setTwoFactorKey(e.target.value.toUpperCase())} onBlur={() => void saveTwoFactor()} placeholder="e.g. K7QX M2VD 4HJN P3WL…" style={{ width: "100%", boxSizing: "border-box", border: `1.5px solid ${captured ? "#86efac" : "#d9dde3"}`, borderRadius: 12, padding: 13, font: "600 15px 'Space Grotesk', system-ui, sans-serif", letterSpacing: ".04em", color: "#0b1220", outline: "none", background: "#fff" }} />
                    {captured && <div style={{ font: "600 12.5px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#15803d" }}>✓ Key saved</div>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12 }} data-tour="twofa-code">
                  <div style={colL}>{dot(5)}</div>
                  <div style={{ flex: 1, minWidth: 0, padding: "2px 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={txt}>Type this code into LinkedIn</div>
                    <TotpCode secretKey={twoFactorKey.trim()} />
                  </div>
                </div>
              </div>;
            })()}
            <a href={`https://linkedvelocity.com/guide/two-step-verification?for=${selfMode ? "owner" : "referrer"}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", margin: "14px 0 0", color: "#15803d", font: "700 13px 'Plus Jakarta Sans', system-ui, sans-serif", textDecoration: "none" }}>Full guide with screenshots ↗</a>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={goBack}>Back</button>
              <button type="button" className={styles.primary} disabled={busy || (!looksLikeTotpKey(twoFactorKey) && !(session.twoFactorSaved && !twoFactorKey.trim()))} onClick={() => run(async () => { if (twoFactorKey.trim()) { await request("PATCH", { id: session.id, action: "twofactor", twoFactorKey: twoFactorKey.trim() }); setSession({ ...session, twoFactorSaved: true }); } setStep(session.emailSetup && !session.emailSetup.primaryConfirmed ? 4 : 5); })}>{session.emailSetup && !session.emailSetup.primaryConfirmed ? "Continue to secure email →" : selfMode && session.diyTier === "partial" ? "Continue to team handoff →" : "Continue to sign-in →"}</button>
            </div>
          </>}

          {step === 5 && session && (handedOff ? <>
            <div className={styles.success}>✓</div>
            <h1 className={styles.heroTitle}>Handed off — you&apos;re done</h1>
            <p className={styles.lead} data-tour="done-phone">{session.name}&apos;s account is saved. Nothing more to do here.</p>
            {(() => {
              const sdot = (state: "done" | "active" | "locked") => <span style={{ width: 20, height: 20, flex: "none", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", font: "700 11px 'Space Grotesk', system-ui, sans-serif", ...(state === "done" ? { background: "#16a34a", color: "#fff" } : state === "active" ? { background: "#fff", color: "#16a34a", boxShadow: "inset 0 0 0 2px #16a34a" } : { background: "#c5cbd3", color: "#fff" }) }}>{state === "done" ? "✓" : ""}</span>;
              const sline = (done: boolean) => <span style={{ flex: 1, width: 2, background: done ? "#16a34a" : "#e3e6ea", margin: "3px 0" }} />;
              const scolL = { display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch" } as const;
              const stitle = { font: "700 14px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#0b1220" } as const;
              const smeta = { font: "600 12.5px 'Plus Jakarta Sans', system-ui, sans-serif", color: "#5b6779" } as const;
              const sbody = { font: "500 12.5px/1.4 'Plus Jakarta Sans', system-ui, sans-serif", color: "#5b6779", marginTop: 2 } as const;
              const row = (state: "done" | "active" | "locked", title: string, meta: string, body: React.ReactNode, last = false) => <div style={{ display: "flex", gap: 11 }}>
                <div style={scolL}>{sdot(state)}{!last && sline(state === "done")}</div>
                <div style={{ flex: 1, minWidth: 0, padding: last ? "1px 0 0" : "1px 0 14px", opacity: state === "locked" ? .62 : 1 }}>
                  <div><span style={stitle}>{title}</span>{meta && <span style={smeta}> · {meta}</span>}</div>
                  <div style={sbody}>{body}</div>
                </div>
              </div>;
              return <div style={{ margin: "8px 0 2px" }}>
                <div className={styles.stepLabel} style={{ marginBottom: 12 }}>What happens next</div>
                {row("done", "Account saved", "just now", "We set up the protected browser today.")}
                {row("active", "We sign in", "in about 24 hours", "The short wait lowers the chance of an ID check.")}
                {row("locked", "We check the account", checkWindow(session.accountFreshness), "We make sure it’s ready before payout.")}
                {row("locked", selfMode ? "You get paid" : "Everyone gets paid", "", selfMode ? <>Your {moneyText(session.setupAmount)} setup payment goes out once it clears, and you’ll get a receipt.</> : <>The owner’s {moneyText(session.setupAmount)} setup fee and your commission go out the same day. You’ll both get a receipt.</>, true)}
              </div>;
            })()}
            <div className={styles.note} style={{ display: "flex", gap: 8 }}><span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span><span><strong>No need to check in.</strong> We’ll message you if we need anything. Check the status anytime in your portal{selfMode ? "" : " under Onboardings"}.</span></div>
            {!selfMode ? <>
              <a className={styles.primary} href={demo ? demoHome : `/m/${token}/onboarding`}>Onboard another account owner</a>
              <a className={styles.secondary} href={demo ? demoHome : `/m/${token}`} style={{ marginTop: 9 }}>Check status in Onboardings →</a>
            </> : <Link className={styles.primary} href={demo ? demoHome : "/dashboard"}>Go to my dashboard →</Link>}
          </> : browserMode === "" ? <>
            {setupOptions()}
          </> : browserMode === "phone" ? <>
            <button className={styles.linkBtn} disabled={busy} onClick={() => setBrowserMode("")}>← Back to computer or phone</button>
            <PhoneHandoff selfMode={selfMode} demo={demo} busy={busy} error={error} submit={handoff} />
          </> : <>
            <button className={styles.linkBtn} disabled={busy} onClick={() => setBrowserMode("")}>← Back to computer or phone</button>
            <BrowserStep
              selfMode={selfMode}
              demo={demo}
              key={`${session.id}-${session.state}-${session.opened}`}
              session={session}
              busy={busy}
              error={error}
              twoFactorKey={twoFactorKey.trim()}
              loginEmail={session.emailSetup?.address || null}
              primaryConfirmedAt={session.emailSetup?.primaryConfirmedAt || null}
              linkCopied={linkCopied}
              copyLink={() => void moveToComputer()}
              onManageEmail={session.emailSetup ? () => setStep(4) : undefined}
              action={(nextAction) => run(() => action(nextAction))}
              confirm={confirmLogin}
              refresh={() => run(async () => showSession((await request("GET", undefined, session.id)).session))}
            />
          </>)}

          {step === 6 && session && <>
            <div className={styles.success}>✓</div>
            <h1 className={styles.heroTitle}>{selfMode ? "Your setup is complete" : "That’s them onboarded"}</h1>
            <p className={styles.lead}>{selfMode ? "Your account is ready for the team’s final checks. You can track it from your dashboard." : `${session.name}’s account is in our system and linked to your code. Nothing else for either of you to do today.`}</p>
            <div className={styles.card} data-tour="done-summary">
              <div className={styles.summaryRow}><span>{selfMode ? "Your sign-on bonus" : "Their setup payment"}</span><b>{moneyText(session.setupAmount)}</b></div>
              <div className={styles.summaryRow}><span>{selfMode ? "Your monthly payment" : "Their monthly payment"}</span><b>{moneyText(session.monthlyAmount)}/mo</b></div>
              {!selfMode && <div className={styles.summaryRow}><span>Your commission</span><b>{moneyText(session.commission)} · {session.verified ? "Verified" : "Pending"}</b></div>}
              <div className={styles.summaryRow}><span>Due date</span><b>{session.setupDueAt ? new Date(session.setupDueAt).toLocaleDateString(undefined, { dateStyle: "medium" }) : "~1 week after QC"}</b></div>
            </div>
            {selfMode ? <div className={styles.note}>We’ll check your account and contact you if anything else is needed. Payments begin once onboarding is approved.</div> : <div className={styles.note} data-tour="done-next"><strong>What we do next.</strong> We run our checks (QC) and hold the account about a week. If LinkedIn asks for a check in that time, <strong>we message you</strong>, not them — you&apos;re our contact for this account, so keep your phone on. Once it clears — {checkWindow(session.accountFreshness)} after QC — their {moneyText(session.setupAmount)} goes out, and your commission with it.</div>}
            <div className={styles.card}>
              <div className={styles.cardTitle}>{selfMode ? "While your account is being checked" : "Tell them before you go"}</div>
              <p className={styles.cardSub} style={{ marginBottom: 8 }}>Don&apos;t post, message or browse from your own phone while it&apos;s with us — being logged in from two places is what causes restrictions.</p>
              <p className={styles.cardSub} style={{ margin: 0 }}>{selfMode ? "Keep your contact details up to date so our team can reach you if a check is needed." : "And if anything is ever needed on the account, it comes through you — so make sure they’ll pick up when you call."}</p>
            </div>
            <Link className={styles.primary} href={demo ? demoHome : selfMode ? "/dashboard" : `/m/${token}`}>{selfMode ? "Go to my dashboard →" : "Back to my portal →"}</Link>
            {!selfMode && <a className={styles.secondary} href={demo ? demoHome : `/m/${token}/onboarding`} style={{ marginTop: 9 }}>Onboard someone else</a>}
          </>}
          </div>
        </>}
      </div>
    </div>
  </main>;
}
