// Pipeline shared model — types, level/stage logic, formatting and style atoms.
// Extracted VERBATIM from src/app/(admin)/admin/pipeline/page.tsx so the new
// /admin/pipeline-new view computes everything identically to the live pipeline.
// Keep behaviour in lock-step with the live page; this is pure logic only.
import type { CSSProperties } from "react";
import { currencyConfigFor } from "@/lib/referral-currency";
import { isApplicationReceived } from "@/lib/pipeline-received";
import { ONBOARDING_ISSUES } from "@/lib/onboarding-issue-message";
import type { ProfileBuild } from "@/lib/profile-generator";

export const APPLICATION_TYPES = [
  { key: "standard", label: "Form" },
  { key: "partial", label: "Email/2FA" },
  { key: "full", label: "Full-service" },
  { key: "unknown", label: "Not recorded" },
] as const;
export const applicationType = (r: { diyTier?: string | null }) => APPLICATION_TYPES.find(t => t.key === r.diyTier) || APPLICATION_TYPES[3];

export const F_SANS = "var(--font-sans),system-ui,sans-serif";
export const F_GRO = "var(--font-grotesk),system-ui,sans-serif";

export type Status = "pending" | "reviewing" | "approved" | "rejected" | "onboarding" | "onboarded" | "unreachable" | "contacted" | "on_hold";
export type Stage = "initial" | "processing" | "accepted" | "onboarded" | "unreachable" | "rejected";
export type Mode = "stage" | "action" | "live";
export type Touch = { ch: string; text: string; by?: string; at: string; bookingKey?: string; scheduledAt?: string; cancelled?: boolean };
export type Payout = {
  paidAt: string; amount: number; kind?: "setup" | "monthly"; method?: string | null;
  proofUrl?: string | null; note?: string | null; accountId?: string | null; by?: string;
  notified?: boolean; notifiedAt?: string | null; acknowledged?: boolean; acknowledgedAt?: string | null;
};

export interface Row {
  id: string;
  accountOnly?: boolean;
  applicationReceived?: boolean;
  setupInProgress?: boolean;
  existingAccountSubmission?: boolean;
  referrerResumeUrl?: string | null;
  meetingRequested?: boolean;
  fullName: string;
  email: string;
  contactNumber: string | null;
  contactChannel: string | null;
  linkedinUrl: string | null;
  location: string | null;
  status: Status;
  createdAt: string;
  onboardedAt: string | null;
  accountIssue: string | null;
  onboardingFix: { issues: ("application_incomplete" | "email_added" | "email_primary" | "twofa" | "password")[]; state: "open" | "referrer_done"; raisedAt: string; doneAt?: string } | null;
  restrictionReport: { type: "qr_done" | "recovered"; at: string; by?: string } | null;
  referrer: { email?: string | null; viber?: string | null; name: string; token: string | null; whatsapp: string | null; telegram: string | null; preferred: string | null } | null;
  // Set when this account owner is ALSO a referrer (same person) — their own Referrer row.
  asReferrer?: { slug: string; token: string; name: string } | null;
  reason: string;
  phoneHandoffPending?: boolean;
  latestCode?: string | null;
  hasGologin: boolean;
  hasLogin: boolean;
  accountId: string | null;
  accountName: string | null;
  accountStatus: string | null;
  loginEmail: string | null;
  gologinShareLink: string | null;
  gologinProfileId: string | null;
  connectionCount: number | null;
  adminNotes: string | null;
  applicationNotes: string | null;
  accountNotes: string | null;
  referredBy: string | null;
  payoutCurrency: string | null;
  referralSource: string | null;
  industry: string | null;
  poc: string | null;
  linkedinEmail: string | null;
  bookingEmail: string | null;
  diyTier?: string | null;
  onboardingMethod?: string | null;
  accountFreshness: string | null;
  ownerStatus: string | null;
  paymentMethod: string | null;
  paymentDetails: string | null;
  payoutName: string | null;
  verifiedAt: string | null;
  qcChecks: { photo?: boolean; headline?: boolean; about?: boolean; connections?: boolean; experiences?: boolean; education?: boolean; followLinkedarmy?: boolean; engagedPost?: boolean; thanksMessage?: boolean; sessionsOut?: boolean; noRememberedPw?: boolean; gologinRemoved?: boolean } | null;
  emailPrimaryAt: string | null;
  linkedinVerified: boolean;
  provisionStatus: string | null;
  setupPaidAt: string | null;
  personalEmail: string | null;
  workEmail: string | null;
  hasPassword: boolean;
  has2fa: boolean;
  accountPassword: string | null;
  twoFactor: string | null;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyUsername: string | null;
  proxyPassword: string | null;
  proxyLocation: string | null;
  accountRestrictedAt: string | null;
  warmupStartedAt: string | null;
  maturingStartedAt: string | null;
  profileBuild: ProfileBuild | null;
  profilePhotoUrl: string | null;
  linkedinJoinedAt: string | null;
  connectionHistory: { at: string; count: number; note?: string }[] | null;
  accountRestrictionLog: { at: string; event: "restricted" | "recovered"; note?: string; creditedDays?: number }[] | null;
  linkedinAccountHealth: string | null;
  healthCheckedAt: string | null;
  monthlyPrice: number | null;
  ambassadorPayment: number | null;
  outreachLog: Touch[] | null;
  nextFollowUp: string | null;
  callOutcome: string | null;
  onboardingStartedAt: string | null;
  paidAt: string | null;
  monthlyPayouts: Payout[] | null;
  call: { stage: "none" | "booked" | "done"; scheduledAt: string | null; meetLink: string | null } | null;
}

export const stageOf = (r: Row): Stage => {
  if (r.status === "rejected") return "rejected";
  if (r.status === "unreachable") return "unreachable";
  if (r.status === "onboarded") return "onboarded";
  if (r.status === "approved") return "accepted";
  if (r.status === "onboarding" || r.status === "on_hold") return "processing";
  return "initial";
};
export const isLive = (r: Row) => r.status === "approved" || r.status === "onboarded";

export type Health = "active" | "awaiting" | "review" | "hold" | "unreachable" | "rejected";

export const EARNING_INVENTORY = new Set(["available", "rented", "trial"]);
export const levelOf = (r: Row): 0 | 0.5 | 1 | 2 | 3 | 4 | 5 => {
  if (r.setupInProgress && !["rejected", "unreachable", "onboarded"].includes(r.status)) return 0.5;
  if (!isApplicationReceived(r)) return 0;
  if (r.status === "onboarded") return 5;
  const feePaidLevel = !!r.paidAt || !!r.setupPaidAt || (r.monthlyPayouts || []).some((p) => p.kind === "setup");
  if (r.accountStatus && EARNING_INVENTORY.has(r.accountStatus) && !r.accountRestrictedAt && feePaidLevel) return 5;
  let n = 1;
  if (r.verifiedAt) n = 4;
  else if (r.onboardedAt) n = 3;
  else if (r.emailPrimaryAt) n = 2;
  if (r.status === "approved" && n < 3) n = 3;
  return n as 0 | 1 | 2 | 3 | 4 | 5;
};
export const levelKey = (r: Row): number => levelOf(r);

// Effective application Type. Uses the recorded tier (diyTier, written by the self-service
// wizard / apply form) when present; otherwise derives it from how far onboarding actually
// got, so active rows auto-show Form / Email-2FA / Full-service instead of "Not recorded":
//   logged into GoLogin (level 3+) → Full-service · email & 2FA set (level 2) → Email/2FA ·
//   application received (level 1) → Form · nothing started (dead / accountOnly) → Not recorded.
// Display only — it does NOT overwrite diyTier, so referrer-payout attribution stays as recorded.
export const effectiveTypeKey = (r: Row): string => {
  // Based on the self-service path the owner actually took in the wizard:
  //   "computer" (they signed into GoLogin themselves)        → Full-service
  //   "phone"    (they did email+2FA, then handed off to LV)   → Email/2FA
  // Then the DIY tier they chose on the landing page, if any. Null (LV onboarded it, or
  // not a self-service signup) stays "Not recorded" — we don't infer a tier from LV's work.
  if (r.onboardingMethod === "computer") return "full";
  if (r.onboardingMethod === "phone") return "partial";
  if (r.diyTier) return r.diyTier;
  return "unknown";
};
export const effectiveType = (r: Row) => APPLICATION_TYPES.find((t) => t.key === effectiveTypeKey(r)) || APPLICATION_TYPES[3];

// A full-service self-service row where the referrer self-reported the PC sign-in but it hasn't
// been human-verified yet (no onboardedAt, carries the "login reported" flag). The team must
// open the GoLogin and confirm / retry / take over before it advances.
export const awaitingSigninVerify = (r: Row): boolean =>
  r.referralSource === "self-service" &&
  r.onboardingMethod === "computer" &&
  !r.onboardedAt &&
  (r.accountIssue || "").toLowerCase().includes("login reported");

export const healthOf = (r: Row): Health => {
  switch (r.status) {
    case "rejected": return "rejected";
    case "unreachable": return "unreachable";
    case "on_hold": return "hold";
    case "contacted": return "awaiting";
    case "pending":
    case "reviewing": return "review";
    default: return "active";
  }
};

export const LEVEL_GROUPS: { key: number; label: string; dot: string; note: string }[] = [
  { key: 0.5, label: "Level 0.5 · Setup in progress", dot: "var(--warn-badge-text,#b7791f)", note: "started the wizard — saved details, not yet submitted for completion" },
  { key: 1, label: "Level 1 · Application received", dot: "var(--blue-chip-text,#1a56db)", note: "signed up — our email & 2FA not added yet" },
  { key: 2, label: "Level 2 · Email & 2FA", dot: "var(--blue-chip-text,#1a56db)", note: "our email added & primary, 2FA set — not logged in yet" },
  { key: 3, label: "Level 3 · Logged into GoLogin", dot: "var(--warn-badge-text,#b7791f)", note: "signed in via GoLogin — going through QC checks" },
  { key: 4, label: "Level 4 · Maturing", dot: "var(--st-conv-fg,#6d28d9)", note: "passed QC — in the 1-week maturation hold" },
  { key: 5, label: "Level 5 · Onboarded", dot: "var(--st-active-fg,#188038)", note: "matured & paid — live and earning (also in the payments view)" },
  { key: 0, label: "Level 0 · Not progressing", dot: "var(--st-cancel-fg,#c0392b)", note: "rejected, unreachable, or restricted inventory — not moving through the pipeline" },
];

export const HEALTH_OPTIONS: { key: Health; label: string; dot: string }[] = [
  { key: "active", label: "Active", dot: "var(--st-active-fg,#188038)" },
  { key: "awaiting", label: "Awaiting reply", dot: "var(--blue-chip-text,#1a56db)" },
  { key: "review", label: "In review", dot: "var(--muted2,#9aa0a6)" },
  { key: "hold", label: "On hold", dot: "var(--warn-badge-text,#b7791f)" },
  { key: "unreachable", label: "Unreachable", dot: "var(--st-unreach-fg,#c0392b)" },
  { key: "rejected", label: "Rejected", dot: "var(--st-cancel-fg,#c0392b)" },
];
export const LEVEL_CHIP: Record<string, string> = { "0.5": "0.5 · Setup in progress", "0": "0 · Not progressing", "1": "1 · Received", "2": "2 · Email & 2FA", "3": "3 · Logged in", "4": "4 · Maturing", "5": "5 · Onboarded" };

export type ActionKey = "blocked" | "message" | "awaiting" | "noreply" | "replied" | "setup" | "live" | "closed";
export const ACTION_GROUPS: { key: ActionKey; label: string; dot: string; note: string }[] = [
  { key: "blocked", label: "Blocked — fix the account", dot: "var(--st-cancel-fg,#c0392b)", note: "restricted, no GoLogin or a login issue" },
  { key: "message", label: "Needs first message", dot: "var(--st-unreach-fg,#c0392b)", note: "signed up, nobody has reached out" },
  { key: "awaiting", label: "Awaiting reply", dot: "var(--warn-badge-text,#b7791f)", note: "messaged once — give it a nudge" },
  { key: "noreply", label: "No response — chase", dot: "var(--st-unreach-fg,#c0392b)", note: "2+ touches, still nothing back" },
  { key: "replied", label: "Replied — decide", dot: "var(--blue-chip-text,#1a56db)", note: "they came back — accept or reject" },
  { key: "setup", label: "Warm-up & setup", dot: "var(--st-conv-fg,#6d28d9)", note: "accepted — run the workflow" },
  { key: "live", label: "Live", dot: "var(--st-active-fg,#188038)", note: "onboarded and earning" },
  { key: "closed", label: "Closed", dot: "var(--muted2,#9aa0a6)", note: "rejected or not a fit" },
];
export type BlockKind = "withdrawn" | "retired" | "restricted" | "setup";
export const needsGologin = (r: Row) => r.status === "approved" || r.status === "onboarded";
export const missingGologin = (r: Row) => needsGologin(r) && !!r.accountId && !r.hasGologin;
export const blockKind = (r: Row): BlockKind | null => {
  const issue = (r.accountIssue || "").toLowerCase();
  if (r.accountStatus === "removed" || issue.includes("withdrawn")) return "withdrawn";
  if (r.accountStatus === "retired" || issue.includes("permanent")) return "retired";
  if (r.accountRestrictedAt || issue.includes("restricted")) return "restricted";
  if (r.accountIssue || missingGologin(r)) return "setup";
  return null;
};
export const isBlocked = (r: Row) => blockKind(r) !== null;
export const isRestricted = (r: Row) => blockKind(r) === "restricted";
const REPLY_CH: Record<string, 1> = { reply: 1, booked: 1, done: 1 };
export const actionBucket = (r: Row): ActionKey => {
  if (r.status === "rejected") return "closed";
  if (r.status === "onboarded") return "live";
  if (isBlocked(r)) return "blocked";
  if (r.status === "approved" || r.status === "onboarding") return "setup";
  const log = r.outreachLog || [];
  const outbound = log.filter((t) => !REPLY_CH[t.ch] && t.ch !== "note");
  if (log.some((t) => REPLY_CH[t.ch])) return "replied";
  if (r.status === "unreachable" || outbound.length >= 2) return "noreply";
  if (outbound.length === 1) return "awaiting";
  return "message";
};

export type LiveKey = "due" | "restricted" | "setup" | "ok" | "retired" | "withdrawn";
export const LIVE_GROUPS: { key: LiveKey; label: string; dot: string; note: string }[] = [
  { key: "due", label: "Payment due", dot: "var(--warn-badge-text,#b7791f)", note: "setup fee or a monthly payout owed now" },
  { key: "restricted", label: "Restricted — check", dot: "var(--st-cancel-fg,#c0392b)", note: "flagged by LinkedIn — may recover; don't pay yet" },
  { key: "setup", label: "Blocked — setup", dot: "var(--st-unreach-fg,#c0392b)", note: "no GoLogin or a login issue — fix before paying" },
  { key: "ok", label: "Up to date", dot: "var(--st-active-fg,#188038)", note: "nothing owed right now" },
  { key: "retired", label: "Permanently restricted", dot: "var(--st-cancel-fg,#c0392b)", note: "heard from LinkedIn — inaccessible, won't come back" },
  { key: "withdrawn", label: "Withdrawn — account pulled", dot: "var(--muted2,#9aa0a6)", note: "ambassador took their account back" },
];
export const setupPaid = (r: Row) => (r.monthlyPayouts || []).some((p) => p.kind === "setup") || !!r.setupPaidAt || !!r.paidAt;

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
export const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
export const ageDays = (iso: string) => {
  const d = new Date(iso), n = new Date();
  const d0 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const n0 = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.max(0, Math.round((n0 - d0) / 86400000));
};
export const initialsOf = (name: string) => { const p = (name || "?").trim().split(/\s+/); return (p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase() || "?"; };
export const liHref = (u: string) => (u.startsWith("http") ? u : `https://${u}`);
export const cfgOf = (r: Row) => currencyConfigFor(r.payoutCurrency, r.referredBy, r);
export const monthlyAmt = (r: Row) => (r.ambassadorPayment && r.ambassadorPayment > 0 ? r.ambassadorPayment : cfgOf(r).monthlyAmount);
export const totalPaid = (r: Row) => (r.monthlyPayouts || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);

export const TOUCH: Record<string, [string, string, string]> = {
  whatsapp: ["WhatsApp", "--green-chip-bg,#e6f4ea", "--green-chip-text,#188038"],
  viber: ["Viber", "--st-conv-bg,#efe8fd", "--st-conv-fg,#6d28d9"],
  telegram: ["Telegram", "--blue-chip-bg,#e8f0fe", "--blue-chip-text,#1a56db"],
  email: ["Email", "--blue-chip-bg,#e8f0fe", "--blue-chip-text,#1a56db"],
  call: ["Call", "--st-unreach-bg,#fdecea", "--st-unreach-fg,#c0392b"],
  text: ["Text", "--st-conv-bg,#efe8fd", "--st-conv-fg,#6d28d9"],
  reply: ["Reply", "--st-replied-bg,#e6f4ea", "--st-replied-fg,#188038"],
  booked: ["Booked", "--st-conv-bg,#efe8fd", "--st-conv-fg,#6d28d9"],
  done: ["Call", "--st-active-bg,#e6f4ea", "--st-active-fg,#188038"],
  note: ["Note", "--tag-bg,#f1f1f2", "--muted,#6b7280"],
};
export const touchLabel = (ch: string) => (TOUCH[ch] || TOUCH.note)[0];
export const touchChipStyle = (ch: string): CSSProperties => {
  const c = TOUCH[ch] || TOUCH.note;
  return { font: `600 9.5px ${F_SANS}`, letterSpacing: ".04em", textTransform: "uppercase", padding: "4px 0", borderRadius: 6, flex: "none", width: 72, textAlign: "center", background: `var(${c[1]})`, color: `var(${c[2]})` };
};
export const messagingChannel = (r: Row): "viber" | "telegram" | "whatsapp" => {
  const c = `${r.contactChannel || ""} ${r.contactNumber || ""}`.toLowerCase();
  if (c.includes("viber")) return "viber";
  if (c.includes("telegram") || c.includes("tg")) return "telegram";
  return "whatsapp";
};
export const lastTouchAt = (log: Touch[] | null) => (log && log.length ? fmtDateTime(log[log.length - 1].at) : "");
export const touchCount = (log: Touch[] | null) => (log || []).filter((t) => t.ch !== "note").length;
// "Last touch" for the pipeline column = the last time ANYTHING was done on this record:
// any outreach/note/meeting entry, OR a milestone stamp (email & 2FA set, logged into
// GoLogin, QC passed, onboarded, setup paid). Null only when nothing has happened yet.
export const lastTouchActivity = (r: Row): string | null => {
  let best: string | null = null;
  const bump = (d: string | null | undefined) => { if (d && (!best || +new Date(d) > +new Date(best))) best = d; };
  // Exclude automated log entries (e.g. the "application received" auto note) — those
  // aren't us touching the record. Real notes/meetings (by a person) still count.
  for (const t of r.outreachLog || []) if (!/^(auto|system|pipeline|scheduler)$/i.test((t.by || "").trim())) bump(t.at);
  for (const d of [r.emailPrimaryAt, r.onboardedAt, r.verifiedAt, r.paidAt, r.onboardingStartedAt]) bump(d);
  return best;
};

export const holdDays = (_r: Row) => 7;

export const QC_ITEMS: [keyof NonNullable<Row["qcChecks"]>, string][] = [
  ["photo", "Profile picture is sufficient"],
  ["headline", "Headline is filled in"],
  ["about", "About section is filled in"],
  ["experiences", "Has at least two experiences"],
  ["education", "Has education listed"],
  ["connections", "Has sent new connection requests"],
  ["followLinkedarmy", "Follows LinkedArmy on LinkedIn"],
  ["engagedPost", "Liked or commented on a post"],
  ["thanksMessage", "Messaged a new connection (thanks for connecting)"],
];
export const eligibleMs = (r: Row): number | null => (r.onboardedAt ? new Date(r.onboardedAt).getTime() + 86400000 : null);
export const setupDue = (r: Row): boolean => { if (setupPaid(r)) return false; const due = eligibleMs(r); return due !== null && Date.now() >= due; };

export type StepState = "now" | "waiting" | "done";
export type NextStep = { state: StepState; label: string; timing?: string; last?: string };
export const STEP_RANK: Record<StepState, number> = { now: 0, waiting: 1, done: 2 };
export const daysUntil = (ms: number) => Math.max(1, Math.ceil((ms - Date.now()) / 86400000));
export const manilaDay = (ms: number) => Math.floor((ms + 8 * 3600000) / 86400000);
export const matureDaysLeft = (matureAtMs: number) => manilaDay(matureAtMs) - manilaDay(Date.now());

export const lastActivity = (r: Row): string | undefined => {
  const cands: { at: string; what: string }[] = [];
  const touches = (r.outreachLog || []).filter((t) => t.ch !== "note");
  if (touches.length) { const t = touches[touches.length - 1]; cands.push({ at: t.at, what: t.ch === "reply" ? "they replied" : t.ch === "booked" ? "call booked" : "you reached out" }); }
  const miles: [string | null, string][] = [[r.verifiedAt, "passed QC"], [r.onboardedAt, "logged in"], [r.emailPrimaryAt, "email & 2FA set"]];
  for (const [d, w] of miles) if (d) { cands.push({ at: d, what: w }); break; }
  if (!cands.length) return undefined;
  cands.sort((a, b) => +new Date(b.at) - +new Date(a.at));
  const c = cands[0]; const dd = ageDays(c.at);
  return `${c.what} ${fmtDate(c.at)}${dd > 0 ? ` (${dd}d ago)` : " (today)"}`;
};

export const lastActivityAt = (r: Row): string => {
  let best = r.createdAt;
  const touches = (r.outreachLog || []).filter((t) => t.ch !== "note");
  if (touches.length && +new Date(touches[touches.length - 1].at) > +new Date(best)) best = touches[touches.length - 1].at;
  for (const d of [r.verifiedAt, r.onboardedAt, r.emailPrimaryAt]) if (d && +new Date(d) > +new Date(best)) best = d;
  return best;
};

export const nextStep = (r: Row): NextStep => {
  const last = lastActivity(r);
  const at = lastActivityAt(r);
  const idle = ageDays(at);
  // Our own next step (add email, log in, QC, chase, fix GoLogin) is always actionable
  // NOW — To action shows it immediately. Once we message, the actioned-today rule moves
  // it to Waiting on them; account tasks leave when we advance the stage. (No same-day grace.)
  const gate = (label: string, _graceDays?: number): NextStep => ({ state: "now", label, last });

  if (r.status === "rejected") return { state: "done", label: "Closed — rejected" };
  if (r.accountStatus === "removed") return { state: "done", label: "Withdrawn — account pulled" };
  if (r.accountStatus === "retired") return { state: "done", label: "Permanently restricted" };

  if (r.accountRestrictedAt || (r.accountIssue || "").toLowerCase().includes("restricted")) {
    if (r.restrictionReport) return { state: "now", label: `Verify restriction — referrer says ${r.restrictionReport.type === "recovered" ? "it's unrestricted" : "the QR check is done"}`, last };
    return { state: "now", label: "Restricted — chase the owner to clear it", timing: r.accountRestrictedAt ? `since ${fmtDate(r.accountRestrictedAt)}` : undefined, last };
  }
  if (r.meetingRequested) return { state: "now", label: "Arrange a setup meeting — requested by referrer", last };
  if (r.onboardingFix?.state === "referrer_done") return { state: "now", label: "Recheck — referrer marked the fix done", last };
  if (r.onboardingFix?.issues?.length) return { state: "waiting", label: `Waiting on referrer: ${r.onboardingFix.issues.map((i) => ONBOARDING_ISSUES[i]?.label || i).join(", ")}`, last };
  if (r.nextFollowUp) {
    const t = new Date(r.nextFollowUp).getTime();
    if (Date.now() >= t) return { state: "now", label: "Follow-up due", timing: `set for ${fmtDate(r.nextFollowUp)}`, last };
    return { state: "waiting", label: "Follow-up scheduled", timing: `${fmtDate(r.nextFollowUp)} · ${daysUntil(t)}d`, last };
  }
  if (blockKind(r) === "setup") return gate(missingGologin(r) ? "Add a GoLogin so the account can run" : "Fix the login issue", 1);

  if (r.status === "unreachable") return gate(`Chase — unresponsive${idle > 0 ? ` (${idle}d quiet)` : ""}`, 3);
  if (r.status === "contacted") return { state: "waiting", label: "Awaiting their reply", timing: idle > 0 ? `${idle}d` : "today", last };
  if (levelOf(r) === 0.5) return { state: "waiting", label: "Setup in progress — waiting for the applicant to finish the wizard", last };
  if (r.status === "pending") return { state: "now", label: "Reach out — new application", last };
  if (r.status === "reviewing") return { state: "now", label: "Review application", last };
  if (r.status === "on_hold") return { state: "waiting", label: "On hold", last };

  const lvl = levelOf(r);
  if (lvl <= 1) return gate("Add our email (set primary) + 2FA", 1);
  if (lvl === 2) return gate("Log in via GoLogin", 1);
  if (lvl === 3) { const done = QC_ITEMS.filter(([k]) => r.qcChecks?.[k]).length; return gate(`Run QC checks (${done}/${QC_ITEMS.length} done)`, 1); }
  if (lvl === 4) {
    const matureAt = r.verifiedAt ? new Date(r.verifiedAt).getTime() + holdDays(r) * 86400000 : null;
    if (matureAt && matureDaysLeft(matureAt) > 0) { const d = matureDaysLeft(matureAt); return { state: "waiting", label: "Maturing", timing: `${d} day${d === 1 ? "" : "s"} left · ready ${fmtDate(new Date(matureAt).toISOString())}`, last }; }
    return { state: "now", label: setupPaid(r) ? "Matured — mark onboarded (live)" : "Matured — pay setup fee & mark onboarded", last };
  }
  if (!setupPaid(r)) return { state: "now", label: "Pay setup fee", last };
  return { state: "done", label: "Live & earning", last };
};
export const proxyCombined = (r: Row): string | null => {
  const parts = [r.proxyHost || "", r.proxyPort != null ? String(r.proxyPort) : "", r.proxyUsername || "", r.proxyPassword || ""];
  return parts.some(Boolean) ? parts.join(":").replace(/:+$/, "") : null;
};
export const parseProxy = (v: string | number | null): Record<string, unknown> => {
  const s = v == null ? "" : String(v).trim();
  if (!s) return { proxyHost: null, proxyPort: null, proxyUsername: null, proxyPassword: null };
  const p = s.split(":");
  const port = p[1] ? parseInt(p[1].replace(/[^0-9]/g, ""), 10) : NaN;
  return { proxyHost: p[0] || null, proxyPort: Number.isFinite(port) ? port : null, proxyUsername: p[2] || null, proxyPassword: p.slice(3).join(":") || null };
};

export const STATUS_STYLE: Record<Status, [string, string]> = {
  pending: ["--blue-chip-bg,#e8f0fe", "--blue-chip-text,#1a56db"],
  contacted: ["--blue-chip-bg,#e8f0fe", "--blue-chip-text,#1a56db"],
  reviewing: ["--warn-badge-bg,#fef3e2", "--warn-badge-text,#b7791f"],
  on_hold: ["--warn-badge-bg,#fef3e2", "--warn-badge-text,#b7791f"],
  onboarding: ["--warn-badge-bg,#fef3e2", "--warn-badge-text,#b7791f"],
  approved: ["--st-conv-bg,#efe8fd", "--st-conv-fg,#6d28d9"],
  onboarded: ["--st-active-bg,#e6f4ea", "--st-active-fg,#188038"],
  unreachable: ["--st-unreach-bg,#fdecea", "--st-unreach-fg,#c0392b"],
  rejected: ["--st-cancel-bg,#fdecea", "--st-cancel-fg,#c0392b"],
};
export const STAGE_ACCENT: Record<Stage, string> = {
  initial: "var(--blue-chip-text,#1a56db)",
  processing: "var(--warn-badge-text,#b7791f)",
  accepted: "var(--st-conv-fg,#6d28d9)",
  onboarded: "var(--st-active-fg,#188038)",
  unreachable: "var(--st-unreach-fg,#c0392b)",
  rejected: "var(--st-cancel-fg,#c0392b)",
};
export const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "pending", label: "Initial" },
  { value: "contacted", label: "Awaiting reply" },
  { value: "onboarding", label: "Onboarding" },
  { value: "approved", label: "Logged in" },
  { value: "onboarded", label: "Onboarded" },
  { value: "reviewing", label: "In review" },
  { value: "on_hold", label: "On hold" },
  { value: "unreachable", label: "Unreachable" },
  { value: "rejected", label: "Rejected" },
];
export const ACCOUNT_STATUS_OPTIONS = ["under_review", "available", "rented", "unavailable", "maintenance", "under_construction", "construction_immature", "retired"];
export const OWNER_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Auto" }, { value: "active", label: "Active" }, { value: "waiting_us", label: "Waiting on us" },
  { value: "waiting_them", label: "Waiting on them" }, { value: "offline", label: "Offline" }, { value: "onboarding", label: "Onboarding" },
  { value: "paused", label: "Paused" }, { value: "lost", label: "Lost" },
];

export const labelCss: CSSProperties = { font: `700 10px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--label,#7c8597)" };
export const inputCss: CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--input-bg,#fff)", border: "1px solid var(--input-border,#dcdce0)", borderRadius: 8, padding: "7px 9px", font: `500 13px ${F_SANS}`, color: "var(--text,#111)", outline: "none" };
export const btnSec: CSSProperties = { font: `600 12px ${F_SANS}`, color: "var(--btn-secondary-fg,#333)", background: "var(--btn-secondary-bg,#fff)", border: "1px solid var(--btn-secondary-border,#dcdce0)", padding: "7px 12px", borderRadius: 8, cursor: "pointer" };
export const btnPrimary: CSSProperties = { font: `600 12px ${F_SANS}`, color: "#fff", background: "var(--sheets-btn-bg,#1a56db)", border: "none", padding: "8px 13px", borderRadius: 8, cursor: "pointer" };
export const GRID4: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "12px 14px" };

// ── v2 "turn" model (/admin/pipeline-new) ───────────────────────────────────
// Whose move is it right now, derived from the same data the live pipeline uses.
// us = needs an admin now · them = waiting on applicant/referrer · timer = maturing
// hold (the ONLY wait) · live = onboarded & earning · dead = not progressing.
export type Turn = "us" | "recovery" | "them" | "timer" | "live" | "dead";
export const WAIT_DAYS = 1; // daily: once we've messaged, re-check for a reply the next day
export const MAX_CHASES = 3;
// Outbound chases (our messages, excluding replies/bookings/notes) — the chase counter.
// Human follow-ups only: automated nudges (Fast-track invites etc., logged by "Auto"/
// system) do NOT count toward the chase total or the "mark Stopped after 3 chases" gate.
const AUTO_BY = /^(auto|system|pipeline|scheduler)$/i;
export const chaseCount = (r: Row) => (r.outreachLog || []).filter((t) => !["reply", "booked", "done", "note"].includes(t.ch) && !AUTO_BY.test((t.by || "").trim())).length;
// Days since our last HUMAN outbound touch (or signup if none) — the "gone quiet" clock.
// Auto nudges don't count, so an automated email doesn't make a row look recently worked.
export const idleDays = (r: Row) => {
  const outbound = (r.outreachLog || []).filter((t) => !["reply", "booked", "done", "note"].includes(t.ch) && !AUTO_BY.test((t.by || "").trim()));
  const at = outbound.length ? outbound[outbound.length - 1].at : r.createdAt;
  return ageDays(at);
};
// Did we send a human outbound message TODAY? Such a row is "actioned today" → it drops to
// Waiting on them until tomorrow, so To action only shows what still needs us right now.
export const actionedToday = (r: Row): boolean => (r.outreachLog || []).some((t) => !["reply", "booked", "done", "note"].includes(t.ch) && !AUTO_BY.test((t.by || "").trim()) && ageDays(t.at) === 0);
// Has a chase been sent since the restriction was recorded? (then it's with the owner)
export const chasedSinceRestricted = (r: Row): boolean => {
  if (!r.accountRestrictedAt) return false;
  const since = +new Date(r.accountRestrictedAt);
  return (r.outreachLog || []).some((t) => !["reply", "booked", "done", "note"].includes(t.ch) && +new Date(t.at) >= since);
};
// Was the restriction re-checked today? healthCheckedAt is stamped when the admin marks
// "Still restricted", which snoozes the daily re-check until tomorrow.
export const restrictionCheckedToday = (r: Row): boolean => !!r.healthCheckedAt && ageDays(r.healthCheckedAt) === 0;
export type TurnInfo = { turn: Turn; label: string; chaseDue?: boolean; stopSuggested?: boolean; recheckDue?: boolean };
export const turnOf = (r: Row): TurnInfo => {
  // Stopped — terminal.
  if (r.status === "rejected") return { turn: "dead", label: "Closed — rejected" };
  if (r.status === "unreachable") return { turn: "dead", label: "Unreachable" };
  if (r.accountStatus === "removed") return { turn: "dead", label: "Withdrawn — account pulled" };
  if (r.accountStatus === "retired") return { turn: "dead", label: "Permanently restricted" };
  // Account-only rows = restricted inventory accounts (no ambassador application). They're
  // not active onboarding work — show as Stopped / Not progressing; manage the restriction
  // itself in Inventory (not a daily pipeline re-check).
  if (r.accountOnly) return { turn: "dead", label: "Restricted — inventory account" };

  // Onboarded & earning — done, not active pipeline work. A restriction on an ONBOARDED
  // account is handled in Inventory, so it stays in Onboarded (the red flag still shows)
  // rather than flooding To action. Only accounts still in onboarding (levels 1-4) re-check.
  if (levelOf(r) === 5) return { turn: "live", label: "Live & earning" };

  // Restriction follows whose-turn (the red flag stays regardless).
  const restricted = !!r.accountRestrictedAt || (r.accountIssue || "").toLowerCase().includes("restricted");
  if (restricted && blockKind(r) === "restricted") {
    if (r.accountId) {
      // A restricted account has its own home now — the recovery case tracker
      // (/admin/restrictions-v2). Keep it OUT of "To action" so the daily to-do isn't
      // flooded with restrictions; it lives in its own "In recovery" bucket, still with the
      // quick re-check buttons + a link into the case. Referrer-reported ones surface there too.
      if (restrictionCheckedToday(r)) return { turn: "recovery", label: "In recovery · re-checked today — due tomorrow" };
      if (r.restrictionReport) return { turn: "recovery", recheckDue: true, label: "In recovery — referrer says it's cleared, verify" };
      const last = r.healthCheckedAt ? ageDays(r.healthCheckedAt) : null;
      return { turn: "recovery", recheckDue: true, label: last == null ? "In recovery — not re-checked yet" : `In recovery · last checked ${last}d ago` };
    }
    // App-only restriction (no linked account to stamp a health-check): also lives in the
    // "In recovery" bucket — out of To action — same as account-linked ones. It still carries
    // the daily re-check buttons, but snoozed via a follow-up date instead of healthCheckedAt.
    // "Still restricted" sets follow-up to tomorrow; "Cleared" clears the accountIssue flag.
    // (No restrictions-v2 case link, since there is no account to open.)
    if (r.restrictionReport) return { turn: "recovery", recheckDue: true, label: "In recovery — referrer says it's cleared, verify" };
    if (r.nextFollowUp && +new Date(r.nextFollowUp) > Date.now()) return { turn: "recovery", label: `In recovery · re-checked — follow up ${fmtDate(r.nextFollowUp)}` };
    const flagged = (r.outreachLog || []).some((t) => !["reply", "booked", "done", "note"].includes(t.ch) && !AUTO_BY.test((t.by || "").trim()));
    return { turn: "recovery", recheckDue: true, label: flagged ? "In recovery — restriction still open?" : "In recovery — flag restriction with owner" };
  }

  const ns = nextStep(r);

  // Only Level-4 maturing with time left is a timer. QC (Level 3) is work → us.
  if (levelOf(r) === 4 && ns.state === "waiting" && ns.label === "Maturing") {
    return { turn: "timer", label: ns.timing ? `Maturing · ${ns.timing}` : "Maturing" };
  }

  // Waiting-on-them resurfacing: a "them" row gone quiet (follow-up past, or no reply
  // for WAIT_DAYS) flips back to us as a chase; at MAX_CHASES suggest stopping.
  if (ns.state === "waiting") {
    const followPast = !!r.nextFollowUp && Date.now() >= new Date(r.nextFollowUp).getTime();
    const quiet = idleDays(r) >= WAIT_DAYS;
    if (followPast || quiet) {
      const n = chaseCount(r);
      if (n >= MAX_CHASES) return { turn: "us", label: `${n} chases, no reply — mark Stopped?`, chaseDue: true, stopSuggested: true };
      return { turn: "us", label: `Chase again (#${n + 1})`, chaseDue: true };
    }
    return { turn: "them", label: ns.label };
  }

  if (ns.state === "done") return { turn: "live", label: ns.label };
  // Actioned today: if we already messaged this person/referrer today, there's nothing
  // more to do now — snooze it to Waiting on them until tomorrow, when it returns to To
  // action to check for a reply. Keeps To action to rows that still need us right now.
  if (actionedToday(r)) return { turn: "them", label: `${ns.label} — messaged today, check tomorrow` };
  return { turn: "us", label: ns.label };
};
