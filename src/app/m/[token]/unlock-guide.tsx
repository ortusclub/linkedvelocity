"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// The guided "unlock a restricted account" flow a referrer walks the account owner through, one
// screen at a time, to clear LinkedIn's sign-in identity check and release the locked payout.
// It mirrors the admin Recovery workflow (owner verifies → ID / help form → appeal → LinkedIn
// decision): the owner's self-reported actions here are logged back to the application so the
// team's Restrictions-v2 case advances without waiting on captured email alone.
//
// Copy uses they/them throughout — we only hold the owner's name, never their pronoun, and must
// not infer one from a name. The owner's first name is interpolated where it reads naturally.

const JAK = "var(--font-jak), system-ui, sans-serif";
const GRO = "var(--font-gro), system-ui, sans-serif";
const SUPPORT = "https://t.me/linkedvelocity_support_bot";

export type ScreenId = "ready" | "signin" | "persona" | "phone" | "result" | "retry" | "help" | "appeal" | "waiting" | "done";
type GuideEvent = "help_sent" | "appeal_sent";

type Block =
  | { t: "items"; items: { title: string; sub?: string }[] }
  | { t: "code" }
  | { t: "link"; label: string; href: string }
  | { t: "fields"; rows: [string, string][] }
  | { t: "copy"; label: string; text: string }
  | { t: "note"; text: string };

type Choice = { text: string; variant: "P" | "S"; to: ScreenId; effect?: GuideEvent };

type Screen = {
  label: string;
  tone: "main" | "branch" | "cleared";
  main?: number; // 1..5 position on the main path (drives the 5-bar progress)
  title: string;
  body: string;
  blocks: Block[];
  choices: Choice[];
};

const MAIN_TOTAL = 5;

export default function UnlockGuide({
  token, applicationId, firstName, lockAmt, resumeHref, startStep, startHistory, onBackIn, onClose,
}: {
  token: string;
  applicationId: string;
  firstName: string;
  lockAmt: string; // e.g. "₱700"
  resumeHref: string; // where "Finish the sign-in" resumes the onboarding wizard
  startStep: ScreenId;
  startHistory: ScreenId[]; // saved back-stack, so Back works after resuming
  onBackIn: () => void; // report "recovered" to the team + refresh the card
  onClose: () => void;
}) {
  const [lk, setLk] = useState<ScreenId>(startStep);
  const [hist, setHist] = useState<ScreenId[]>(startHistory);
  const [copied, setCopied] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const backInFired = useRef(false);

  const N = firstName || "they";
  const screens = useMemo(() => buildScreens(N), [N]);
  const s = screens[lk];

  // Scroll to the top of the sheet on every screen change.
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [lk]);

  // Persist the current screen AND the back-stack to the application, so the referrer resumes
  // exactly where they left off (Back included), and the team can see where the owner is.
  useEffect(() => {
    void fetch(`/api/m/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recoveryGuide", applicationId, step: lk, history: hist }) }).catch(() => {});
  }, [lk, hist, token, applicationId]);

  // Reaching "Cleared" means the owner is back in — report it once so the team verifies and the
  // payout timer resumes.
  useEffect(() => {
    if (lk === "done" && !backInFired.current) { backInFired.current = true; onBackIn(); }
  }, [lk, onBackIn]);

  const go = (to: ScreenId, effect?: GuideEvent) => {
    if (effect) void fetch(`/api/m/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recoveryGuide", applicationId, event: effect }) }).catch(() => {});
    setHist((h) => [...h, lk]);
    setLk(to);
  };
  const back = () => setHist((h) => { if (!h.length) return h; const next = [...h]; const prev = next.pop()!; setLk(prev); return next; });

  const flashCopy = (text: string) => { navigator.clipboard?.writeText(text); setCopied(text); setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500); };

  const labelColor = s.tone === "cleared" ? "#0f7a3d" : s.tone === "branch" ? "#92400e" : "#8a93a3";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(9,17,12,.5)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div ref={scroller} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: "#fff", borderRadius: "22px 22px 0 0", padding: "22px 20px 26px", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ width: 38, height: 4, borderRadius: 999, background: "#e3e6ea", margin: "0 auto 16px" }} />

        {/* Persistent payout strip */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#fdf0f0", border: "1px solid #f5c2c2", borderRadius: 12, padding: "11px 12px", marginBottom: 14 }}>
          <LockIcon size={16} color="#b91c1c" />
          <div style={{ font: `600 12.5px/1.45 ${JAK}`, color: "#0b1220" }}>
            Your <span style={{ font: `600 15px ${GRO}`, color: "#b91c1c" }}>{lockAmt}</span> for {N} unlocks once they clear this and you finish the sign-in.
          </div>
        </div>

        {/* Nav row: Back + step label */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, minHeight: 24 }}>
          {hist.length > 0 && (
            <button onClick={back} style={{ font: `700 12px ${JAK}`, color: "#5b6779", background: "#f1f3f6", border: "none", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>← Back</button>
          )}
          <span style={{ font: `700 10.5px ${JAK}`, letterSpacing: ".06em", textTransform: "uppercase", color: labelColor }}>{s.label}</span>
          {lk !== "ready" && (
            <button onClick={() => { setHist([]); setLk("ready"); }} style={{ marginLeft: "auto", font: `600 12px ${JAK}`, color: "#5b6779", background: "none", border: "none", cursor: "pointer" }}>Start over</button>
          )}
        </div>

        {/* Main-path progress (main screens only) */}
        {s.main && (
          <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
            {Array.from({ length: MAIN_TOTAL }).map((_, i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 999, background: i < s.main! ? "#0b1220" : "#e6e9ee" }} />)}
          </div>
        )}

        <div style={{ font: `600 20px/1.25 ${GRO}`, color: "#0b1220", marginBottom: 7 }}>{s.title}</div>
        <p style={{ font: `500 13px/1.5 ${JAK}`, color: "#5b6779", margin: "0 0 14px" }}>{s.body}</p>

        {s.blocks.map((b, i) => <BlockView key={i} b={b} token={token} applicationId={applicationId} copied={copied} onCopy={flashCopy} />)}

        {/* Choice buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 16 }}>
          {lk === "done" ? (
            <a href={resumeHref} style={{ display: "block", width: "100%", textAlign: "center", boxSizing: "border-box", minHeight: 44, font: `700 15px ${JAK}`, color: "#fff", background: "#12a150", border: "none", borderRadius: 12, padding: "13px 16px", textDecoration: "none" }}>Finish the sign-in → unlock {lockAmt}</a>
          ) : s.choices.map((c, i) => (
            <button key={i} onClick={() => go(c.to, c.effect)} style={{
              width: "100%", minHeight: 48, borderRadius: 12, cursor: "pointer", padding: "12px 14px",
              ...(c.variant === "P"
                ? { font: `700 14.5px ${JAK}`, color: "#fff", background: "#0b1220", border: "none" }
                : { font: `700 13.5px ${JAK}`, color: "#0b1220", background: "#fff", border: "1px solid #e3e6ec" }),
            }}>{c.text}</button>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1f3f6" }}>
          <a href={SUPPORT} target="_blank" rel="noreferrer" style={{ font: `600 12px ${JAK}`, color: "#2563eb", textDecoration: "none" }}>Stuck? Send us a screenshot →</a>
          <button onClick={onClose} style={{ font: `700 12.5px ${JAK}`, color: "#5b6779", background: "none", border: "none", cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function BlockView({ b, token, applicationId, copied, onCopy }: {
  b: Block;
  token: string;
  applicationId: string;
  copied: string | null;
  onCopy: (text: string) => void;
}) {
  if (b.t === "items") {
    return (
      <div style={{ border: "1px solid #f1f3f6", borderRadius: 12 }}>
        {b.items.map((it, i) => (
          <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "12px 13px", borderTop: i ? "1px solid #f1f3f6" : "none" }}>
            <span style={{ width: 22, height: 22, flex: "none", borderRadius: 999, background: "#0b1220", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: `700 11px ${GRO}` }}>{i + 1}</span>
            <div>
              <div style={{ font: `600 13.5px ${JAK}`, color: "#0b1220" }}>{it.title}</div>
              {it.sub && <div style={{ font: `500 12px/1.4 ${JAK}`, color: "#7b8696", marginTop: 2 }}>{it.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (b.t === "code") return <CodeField token={token} applicationId={applicationId} />;
  if (b.t === "link") {
    return (
      <a href={b.href} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", boxSizing: "border-box", marginTop: 12, font: `700 13.5px ${JAK}`, color: "#2563eb", background: "#eff4ff", border: "1px solid #cfdcfb", borderRadius: 10, padding: "11px 12px", textDecoration: "none" }}>{b.label} ↗</a>
    );
  }
  if (b.t === "fields") {
    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ font: `700 10px ${JAK}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#8a93a3", marginBottom: 7 }}>What to put in each box</div>
        <div style={{ border: "1px solid #e6e9ee", borderRadius: 12 }}>
          {b.rows.map(([k, v], i) => (
            <div key={i} style={{ display: "flex", gap: 12, justifyContent: "space-between", padding: "10px 12px", borderTop: i ? "1px solid #e6e9ee" : "none" }}>
              <span style={{ font: `500 12px ${JAK}`, color: "#5b6779" }}>{k}</span>
              <span style={{ font: `700 12.5px ${JAK}`, color: "#0b1220", textAlign: "right" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (b.t === "copy") {
    return (
      <div style={{ marginTop: 12, background: "#f6f7f9", border: "1px solid #e6e9ee", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
          <span style={{ font: `700 11px ${JAK}`, color: "#5b6779" }}>{b.label}</span>
          <button onClick={() => onCopy(b.text)} style={{ font: `700 11.5px ${JAK}`, color: "#fff", background: "#0b1220", border: "none", borderRadius: 8, padding: "6px 11px", cursor: "pointer", flex: "none" }}>{copied === b.text ? "Copied ✓" : "Copy"}</button>
        </div>
        <div style={{ font: `500 12px/1.55 ${JAK}`, color: "#0b1220", whiteSpace: "pre-wrap" }}>{b.text}</div>
      </div>
    );
  }
  // note
  return (
    <div style={{ marginTop: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: 12, font: `500 12.5px/1.5 ${JAK}`, color: "#92400e" }}>{b.text}</div>
  );
}

// The live authenticator (TOTP) code for the account, fetched from the referrer's own endpoint.
// Shows a 30-second countdown and auto-refreshes when the window rolls over; it unmounts (and so
// clears + collapses) when the sheet closes or the referrer leaves the sign-in screen.
function CodeField({ token, applicationId }: { token: string; applicationId: string }) {
  const [st, setSt] = useState<{ value: string | null; loading: boolean; error: boolean; open: boolean }>({ value: null, loading: false, error: false, open: false });
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lastPeriod = useRef<number | null>(null);

  const load = async () => {
    setSt((s) => ({ ...s, loading: true, error: false, open: true }));
    try {
      const r = await fetch(`/api/m/${token}/code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b.code) { setSt((s) => ({ ...s, loading: false, error: true, open: true })); return; }
      setSt({ value: b.code, loading: false, error: false, open: true });
    } catch { setSt((s) => ({ ...s, loading: false, error: true, open: true })); }
  };

  // Tick each second while a code is shown, to drive the countdown.
  useEffect(() => {
    if (!st.value) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [st.value]);

  const secondsLeft = 30 - (Math.floor(now / 1000) % 30);
  const periodIdx = Math.floor(now / 30000);
  // When the 30-second TOTP window rolls over, pull a fresh code automatically.
  useEffect(() => {
    if (!st.value) { lastPeriod.current = null; return; }
    if (lastPeriod.current === null) { lastPeriod.current = periodIdx; return; }
    if (periodIdx !== lastPeriod.current) { lastPeriod.current = periodIdx; void load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodIdx, st.value]);

  const copy = () => { if (!st.value) return; navigator.clipboard?.writeText(st.value); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  if (!st.open) {
    return <button onClick={load} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", minHeight: 46, marginTop: 12, font: `700 14px ${JAK}`, color: "#0f7a3d", background: "#e7f7ee", border: "1px solid #c3ebd2", borderRadius: 10, cursor: "pointer" }}>Get authenticator code</button>;
  }
  return (
    <div style={{ marginTop: 12, background: "#e7f7ee", border: "1px solid #c3ebd2", borderRadius: 12, padding: "13px 14px" }}>
      {st.loading && !st.value ? (
        <div style={{ font: `600 13px ${JAK}`, color: "#0f7a3d" }}>Getting code…</div>
      ) : st.error && !st.value ? (
        <>
          <div style={{ font: `600 12.5px/1.5 ${JAK}`, color: "#b91c1c" }}>Couldn&apos;t get a code — try again or message support.</div>
          <button onClick={load} style={{ marginTop: 10, width: "100%", minHeight: 44, font: `700 13px ${JAK}`, color: "#0f7a3d", background: "#fff", border: "1px solid #c3ebd2", borderRadius: 10, cursor: "pointer" }}>Retry</button>
        </>
      ) : st.value ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ font: `700 10.5px ${JAK}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#0f7a3d" }}>6-digit code</span>
            <span style={{ font: `600 11.5px ${JAK}`, color: "#0f7a3d", fontVariantNumeric: "tabular-nums" }}>New code in {secondsLeft}s</span>
          </div>
          <div style={{ font: `600 32px ${GRO}`, letterSpacing: ".12em", color: "#0b1220", margin: "6px 0 8px" }}>{st.value.replace(/^(\d{3})(\d{3})$/, "$1 $2")}</div>
          <div style={{ height: 4, borderRadius: 999, background: "#c3ebd2", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(secondsLeft / 30) * 100}%`, background: "#12a150", transition: "width 1s linear" }} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={copy} style={{ flex: 1, minHeight: 44, font: `700 13px ${JAK}`, color: "#fff", background: "#12a150", border: "none", borderRadius: 10, cursor: "pointer" }}>{copied ? "Copied ✓" : "Copy code"}</button>
            <button onClick={load} style={{ flex: 1, minHeight: 44, font: `700 13px ${JAK}`, color: "#0f7a3d", background: "#fff", border: "1px solid #c3ebd2", borderRadius: 10, cursor: "pointer" }}>Refresh</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function LockIcon({ size = 16, color = "#b91c1c" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flex: "none", marginTop: 1 }} aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="2" stroke={color} strokeWidth="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke={color} strokeWidth="2" />
    </svg>
  );
}

// The owner's help-form / appeal messages are written in the FIRST person (the owner pastes them),
// so they carry no they/them substitution.
const HELP_MESSAGE = "Hi, I'm trying to use my own LinkedIn account but it's asking me to verify my identity, and the identity check keeps failing with the error \"Something unexpected happened. Please try again.\" I've tried several times over a couple of days, in good lighting and on a stable connection, but it won't complete. This is my real account and I'm happy to verify my identity and provide a government ID. Could you please help me complete the verification, or restore access? Thank you.";
const APPEAL_MESSAGE = "This is my own LinkedIn account, and I believe the restriction was applied in error. I've been trying to confirm my identity through the in-app verification, but it repeatedly fails with the error \"Something unexpected happened. Please try again,\" so I haven't been able to finish it. I use the account for genuine, professional networking. The name on my profile matches my government ID, and I'm happy to provide it to confirm who I am. Please could you re-review the restriction and let me verify my identity so I can regain access. Thank you for your help.";

function buildScreens(N: string): Record<ScreenId, Screen> {
  return {
    ready: {
      label: `Step 1 of ${MAIN_TOTAL}`, tone: "main", main: 1,
      title: "Before you start",
      body: `${N} has to do the ID check themselves — LinkedIn won't accept anyone else. Sit with them and go through this one screen at a time. Get these ready first:`,
      blocks: [{ t: "items", items: [
        { title: "Their phone, charged and online", sub: "They'll scan a QR code and take a selfie on it." },
        { title: "Their government ID", sub: "The name on it must match their LinkedIn profile." },
        { title: "Good light and a steady connection", sub: "The selfie and ID photo need to be clear." },
        { title: "Their login email and password", sub: "You sign in to their account first." },
      ] }],
      choices: [
        { text: "They're with me — next", variant: "P", to: "signin" },
        { text: "It's already unrestricted", variant: "S", to: "done" },
      ],
    },
    signin: {
      label: `Step 2 of ${MAIN_TOTAL}`, tone: "main", main: 2,
      title: "Sign in to their account",
      body: "Sign in the normal way, in the same browser profile you used to onboard them.",
      blocks: [
        { t: "items", items: [
          { title: "Enter their login email and password" },
          { title: "Asked for a 6-digit code?", sub: "Tap Get authenticator code below. It changes every 30 seconds — if it expires, use the new one." },
          { title: "Password not working?", sub: "Use Forgot password on LinkedIn's sign-in page." },
        ] },
        { t: "code" },
      ],
      choices: [
        { text: "I see “Verify your identity”", variant: "P", to: "persona" },
        { text: "It's unrestricted now — it let me in", variant: "S", to: "done" },
      ],
    },
    persona: {
      label: `Step 3 of ${MAIN_TOTAL}`, tone: "main", main: 3,
      title: "Tap “Verify with Persona”",
      body: "LinkedIn shows a screen called “Verify your identity to continue”. This is the normal first step.",
      blocks: [{ t: "items", items: [
        { title: "Tap Verify with Persona" },
        { title: "A QR code appears", sub: "Keep this screen open on the computer." },
        { title: "They scan it with their phone camera", sub: "The check opens on their phone." },
      ] }],
      choices: [
        { text: "They scanned it — it worked", variant: "P", to: "phone" },
        { text: "It showed an error", variant: "S", to: "retry" },
        { text: "Tried several times, still an error", variant: "S", to: "help" },
      ],
    },
    phone: {
      label: `Step 4 of ${MAIN_TOTAL}`, tone: "main", main: 4,
      title: "They finish on their phone",
      body: "Hand them the phone and let them follow the prompts to the end.",
      blocks: [
        { t: "items", items: [
          { title: "Live selfie", sub: "Good lighting, phone held steady." },
          { title: "Photo of their government ID", sub: "The name must match the profile." },
          { title: "Tap through to the last screen", sub: "Then wait for LinkedIn's result." },
        ] },
        { t: "note", text: "Only upload ID inside LinkedIn's own screen. Never send ID photos to us or anyone over chat or email." },
      ],
      choices: [{ text: "They've finished", variant: "P", to: "result" }],
    },
    result: {
      label: `Step 5 of ${MAIN_TOTAL}`, tone: "main", main: 5,
      title: "What does LinkedIn show now?",
      body: "Pick the one that matches.",
      blocks: [],
      choices: [
        { text: "They're back in", variant: "P", to: "done" },
        { text: "It's still checking / under review", variant: "S", to: "waiting" },
        { text: "“Something unexpected happened. Please try again.”", variant: "S", to: "retry" },
      ],
    },
    retry: {
      label: "If the check fails", tone: "branch",
      title: "This error is usually on LinkedIn's side",
      body: "It's almost always a temporary glitch, not something either of you did wrong.",
      blocks: [{ t: "items", items: [
        { title: "Wait a few hours, or try the next day" },
        { title: "Retry in good light on a stable connection", sub: "A different time of day can help." },
        { title: "Give it 2–3 tries across a day", sub: "Then move to plan B." },
      ] }],
      choices: [
        { text: "Try again from sign-in", variant: "P", to: "signin" },
        { text: "Still failing after 2–3 tries", variant: "S", to: "help" },
      ],
    },
    help: {
      label: "Plan B · 1 of 2", tone: "branch",
      title: "Ask LinkedIn for help",
      body: "Fill in LinkedIn's general help form. It looks long, but every box is below.",
      blocks: [
        { t: "link", label: "Open the general help form", href: "https://www.linkedin.com/help/linkedin/ask/LI-DEFAULT-NEW" },
        { t: "fields", rows: [
          ["First / last name", "Their real name, exactly as on their ID"],
          ["Email", "The account's login email"],
          ["Issue type", "Account access / verify identity"],
          ["Related to Premium All-in-One?", "No"],
          ["Which app or site?", "LinkedIn.com"],
          ["Which device?", "Desktop / Computer"],
        ] },
        { t: "copy", label: "Paste into “Your question”", text: HELP_MESSAGE },
      ],
      choices: [
        { text: "Sent it", variant: "P", to: "waiting", effect: "help_sent" },
        { text: "No luck — send the appeal", variant: "S", to: "appeal" },
      ],
    },
    appeal: {
      label: "Plan B · 2 of 2", tone: "branch",
      title: "Send a restriction appeal",
      body: "Only if the help form didn't sort it. Use the same name, email and story.",
      blocks: [
        { t: "link", label: "Open the appeal form", href: "https://www.linkedin.com/help/linkedin/ask/TS-F-APPEAL" },
        { t: "fields", rows: [
          ["First / last name", "Their real name, matching their ID"],
          ["Email", "The account's login email"],
          ["Profile name matches photo ID?", "Yes"],
          ["Traveling / other country?", "No"],
          ["VPN or proxy?", "No"],
          ["Current country", "Their real country"],
          ["Recent profile updates?", "No"],
        ] },
        { t: "copy", label: "Paste into the appeal box", text: APPEAL_MESSAGE },
        { t: "note", text: "Don't mention VPNs, proxies, automation or renting anywhere. If an answer doesn't fit their situation, message us before submitting." },
      ],
      choices: [{ text: "Sent it", variant: "P", to: "waiting", effect: "appeal_sent" }],
    },
    waiting: {
      label: "Waiting on LinkedIn", tone: "branch",
      title: "Now LinkedIn reviews it",
      body: "Anywhere from a few minutes to a few days. Sometimes they ask for the same thing again.",
      blocks: [
        { t: "items", items: [
          { title: "Don't resend the forms", sub: "Sending again doesn't speed it up." },
          { title: "Tell us where it stands", sub: "We keep working on it with you." },
          { title: "Have them try signing in again later", sub: "Come back here once they're in." },
        ] },
        { t: "link", label: "Update support on Telegram", href: SUPPORT },
      ],
      choices: [{ text: "They're back in", variant: "P", to: "done" }],
    },
    done: {
      label: "Cleared", tone: "cleared",
      title: "They're back in",
      body: "Finish the sign-in now and your payout unlocks.",
      blocks: [],
      choices: [],
    },
  };
}
