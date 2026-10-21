import type { RestrictionEvent } from "@/lib/restriction";

// Restrictions v2 — the recovery CASE model. One case per restriction: the spine is a chain of
// recovery steps (Restriction email → QR → ID verification → Appeal form → LinkedIn decision),
// from which we auto-compute the "next step" and a triage bucket. Email + QR steps are DERIVED
// from the account's recovery_* fields (single source of truth); ID / Form / LinkedIn / Note
// steps are logged by the team and stored in `recovery_case`. Pure functions here — the API
// fetches accounts and calls these; no DB access so the logic stays testable.

export type StepKind = "email" | "qr" | "id" | "form" | "li" | "note";
export type Outcome = "ok" | "fail" | "pending";
export type Step = { k: StepKind; o: Outcome; at: string; err?: string; note?: string };
export type LostOutcome = "perma" | "nocontact";
export type StoredCase = { reason?: string; steps?: Step[]; outcome?: LostOutcome; closedAt?: string; outcomeNote?: string; reopened?: boolean };
export type Bucket = "action" | "owner" | "linkedin" | "done" | "lost";

// Phase = how we prioritise by account status: a restricted RENTED account (a renter is blocked,
// losing us money) outranks an onboarded one, which outranks one still under construction.
export const PHASE: Record<string, { label: string; pr: number }> = {
  rented: { label: "Rented", pr: 1 }, available: { label: "Onboarded", pr: 2 }, under_construction: { label: "Under construction", pr: 3 },
};
export const phaseOf = (status: string) => PHASE[status] || { label: status, pr: 4 };

// Terminal "lost" outcomes — the case is closed without recovering the account.
export const LOST_LABEL: Record<LostOutcome, string> = { perma: "Permanently restricted", nocontact: "Can't contact owner" };

// Link an account to its ambassador application the SAME way inventory / onboarding do, so the
// LV PoC we show (and edit) is the one PoC everywhere: by LinkedIn URL first (unique per person),
// then by the "Owner: <email>" note tag. The PoC is then `app.poc || account.poc`.
export const normUrl = (u: string | null | undefined) => (u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("?")[0].replace(/\/+$/, "");
export const ownerEmailFromNotes = (notes: string | null | undefined) => (notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "") || "";
export function matchApp<T extends { email: string; linkedinUrl: string | null }>(apps: T[], account: { linkedinUrl: string | null; notes: string | null }): T | null {
  if (account.linkedinUrl) {
    const u = normUrl(account.linkedinUrl);
    const byUrl = u ? apps.find((a) => a.linkedinUrl && normUrl(a.linkedinUrl) === u) : null;
    if (byUrl) return byUrl;
  }
  const oe = ownerEmailFromNotes(account.notes).toLowerCase();
  return oe ? apps.find((a) => a.email.toLowerCase() === oe) || null : null;
}

export const STEP_TITLES: Record<StepKind, string> = {
  email: "Restriction email to owner", qr: "QR recovery link", id: "ID verification",
  form: "Appeal form", li: "LinkedIn decision", note: "Note",
};
export const OUT_LABEL: Record<StepKind, Record<Outcome, string>> = {
  email: { ok: "Sent", fail: "Bounced", pending: "Queued" },
  qr: { ok: "Scanned", fail: "Expired", pending: "Sent · not scanned" },
  id: { ok: "Passed", fail: "Failed", pending: "In progress" },
  form: { ok: "Accepted", fail: "Rejected", pending: "Under review" },
  li: { ok: "Restored", fail: "Rejected", pending: "Waiting" },
  note: { ok: "Note", fail: "Issue", pending: "Open" },
};
// Steps the team logs by hand (email + qr are driven by their own actions, not this form).
export const LOGGABLE: StepKind[] = ["id", "form", "li", "note"];

export type CaseAccount = {
  id: string;
  linkedinName: string;
  loginEmail: string | null;
  status: string;
  linkedinVerified?: boolean;
  restrictedAt: Date | string | null;
  restrictionLog: unknown;
  recoveryQrUrl: string | null;
  recoveryQrAt: Date | string | null;
  recoverySentAt: Date | string | null;
  recoverySentVia: string | null;
  recoveryOutcome: string | null;
  recoveryOutcomeAt: Date | string | null;
  recoveryCase: unknown;
  poc?: string | null;
  notes?: string | null;
  renterName?: string | null;
  // Backtracked from the linked application (pipeline/inventory parity):
  accountIssue?: string | null; // free-text pipeline issue flag ("restricted", "permanently restricted", …)
  restrictionReport?: { type?: "qr_done" | "recovered"; at?: string } | null; // owner self-report from the portal
  outreachEmailAt?: string | null; // a restriction email touch found in the shared outreach log
};

// Signals we backtrack from the account notes (written by the auto-notify / recover-send flows
// and by hand), so a case reflects history we already have instead of starting blank.
const parseStamp = (v: unknown): string | null => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };
// First notes line matching `re`, with its leading `[ISO]` timestamp if present.
function notesSignal(notes: string | null | undefined, re: RegExp): { at: string | null } | null {
  for (const line of (notes || "").split("\n")) {
    if (re.test(line)) return { at: parseStamp(line.match(/^\s*\[([^\]]+)\]/)?.[1]) };
  }
  return null;
}
// A restriction email was sent to the owner (auto-notify or the recover QR link relay).
const EMAIL_SENT_RE = /auto-notified\b.*\brestriction|emailed\s+recover(?:\s+qr)?\s+link|restriction\s+(?:notice|email)\b.*\bsent/i;
// The account has been written off as permanently restricted.
const PERMA_RE = /permanent(?:ly)?[\s-]*restrict/i;
export const notesEmailSent = (notes: string | null | undefined): { at: string | null } | null => notesSignal(notes, EMAIL_SENT_RE);
export const notesSaysPerma = (notes: string | null | undefined): { at: string | null } | null => notesSignal(notes, PERMA_RE);

const iso = (d: Date | string | null | undefined): string | null => (d ? (typeof d === "string" ? d : d.toISOString()) : null);
const asLog = (v: unknown): RestrictionEvent[] => (Array.isArray(v) ? (v as RestrictionEvent[]) : []);

export function parseStoredCase(v: unknown): StoredCase {
  if (!v || typeof v !== "object") return { steps: [] };
  const c = v as StoredCase;
  const outcome = c.outcome === "perma" || c.outcome === "nocontact" ? c.outcome : undefined;
  return {
    reason: typeof c.reason === "string" ? c.reason : undefined,
    steps: Array.isArray(c.steps) ? c.steps : [],
    outcome, closedAt: typeof c.closedAt === "string" ? c.closedAt : undefined,
    outcomeNote: typeof c.outcomeNote === "string" ? c.outcomeNote : undefined,
  };
}

// Email + QR steps reconstructed from the recovery_* fields, so the chain reflects the owner
// link + the owner's self-reported scan outcome without any extra storage.
function derivedSteps(a: CaseAccount): Step[] {
  const steps: Step[] = [];
  const sentAt = iso(a.recoverySentAt);
  // Email sent — backtrack from, in order: the recover-send field, the notes log line, the
  // shared outreach log (the pipeline Issue email).
  const notesEmail = sentAt ? null : notesEmailSent(a.notes);
  const emailAt = sentAt || notesEmail?.at || (notesEmail ? iso(a.restrictedAt) : null) || a.outreachEmailAt || null;
  if (emailAt) steps.push({ k: "email", o: "ok", at: emailAt, note: sentAt ? (a.recoverySentVia ? `Owner link sent via ${a.recoverySentVia}` : "Owner link sent") : "Restriction email sent (from history)" });

  const qrAt = iso(a.recoveryQrAt);
  const outAt = iso(a.recoveryOutcomeAt) || sentAt || qrAt;
  const report = a.restrictionReport;
  if (a.recoveryOutcome === "worked" && outAt) steps.push({ k: "qr", o: "ok", at: outAt, note: "Owner reported back in" });
  else if (a.recoveryOutcome === "stuck" && outAt) steps.push({ k: "qr", o: "fail", at: outAt, note: "Owner reported still stuck" });
  else if (report?.type === "qr_done") steps.push({ k: "qr", o: "ok", at: report.at || sentAt || qrAt || emailAt || new Date(0).toISOString(), note: "Owner reported the QR check done" });
  else if (qrAt && sentAt) steps.push({ k: "qr", o: "pending", at: sentAt });
  return steps;
}

export function buildCase(a: CaseAccount): { reason: string; steps: Step[] } {
  const stored = parseStoredCase(a.recoveryCase);
  const logged = (stored.steps || []).filter((s) => LOGGABLE.includes(s.k) && s.at);
  const steps = [...derivedSteps(a), ...logged].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  const log = asLog(a.restrictionLog);
  const lastRestricted = [...log].reverse().find((e) => e.event === "restricted");
  // Reason falls back to the pipeline issue flag when it carries more than the bare keyword.
  const issue = (a.accountIssue || "").trim();
  const issueReason = issue && !/^(restricted|permanent(ly)?( restricted)?)$/i.test(issue) ? issue : "";
  const reason = stored.reason || lastRestricted?.note || issueReason || "Restriction";
  return { reason, steps };
}

const lastOf = (steps: Step[], k: StepKind): Step | null => {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].k === k) return steps[i];
  return null;
};
const rel = (t: number, now: number): string => {
  const m = Math.max(1, Math.round((now - t) / 6e4));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const ord = (n: number): string => n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");

export type DerivedCase = {
  next: string;
  urgent: boolean;
  bucket: Bucket;
  cnt: number;
  restrictedMs: number;
  resolvedAt: number | null;
  closedAt: number | null;
  lostOutcome: LostOutcome | null;
  openSince: number | null;
  lastErr: string;
  phase: { label: string; pr: number };
  flags: Array<{ label: string; kind: "repeat" | "stale" | "renter" }>;
  chain: Array<{ k: StepKind | "na"; label: string; outcome: Outcome | "none" | "na"; tip: string }>;
};

export function deriveCase(
  a: CaseAccount,
  built: { reason: string; steps: Step[] },
  opts: { now?: number; staleDays?: number; ownerSilentHours?: number } = {},
): DerivedCase {
  const now = opts.now ?? Date.now();
  const staleDays = opts.staleDays ?? 7;
  const ownerSilentHours = opts.ownerSilentHours ?? 48;
  const H = 3600e3;
  const steps = built.steps;
  const stored = parseStoredCase(a.recoveryCase);
  const log = asLog(a.restrictionLog);
  const openSince = a.restrictedAt ? Date.parse(iso(a.restrictedAt)!) : null;
  const lastRecovered = [...log].reverse().find((e) => e.event === "recovered");
  const resolvedAt = !openSince && lastRecovered ? Date.parse(lastRecovered.at) : null;
  // An explicit admin mark wins; otherwise backtrack "permanently restricted" from the account
  // status (retired), the pipeline issue flag, or a note — unless the case was explicitly reopened.
  // Perma applies even with no open restrictedAt (a retired account may have had it cleared).
  const logRestricted = log.some((e) => e.event === "restricted");
  const issuePerma = /permanent/i.test(a.accountIssue || "");
  const retiredPerma = a.status === "retired" && (logRestricted || /restrict/i.test(a.accountIssue || "") || !!notesSaysPerma(a.notes));
  const notesPerma = notesSaysPerma(a.notes);
  const permaSignal = !stored.reopened && !stored.outcome && (issuePerma || retiredPerma || !!notesPerma);
  let lostOutcome: LostOutcome | null = null;
  let closedAt: number | null = null;
  if (stored.outcome) { lostOutcome = stored.outcome; closedAt = stored.closedAt ? Date.parse(stored.closedAt) : null; }
  else if (permaSignal) { lostOutcome = "perma"; closedAt = notesPerma?.at ? Date.parse(notesPerma.at) : null; }

  const em = lastOf(steps, "email"), qr = lastOf(steps, "qr"), id = lastOf(steps, "id"), fm = lastOf(steps, "form"), li = lastOf(steps, "li");
  const sentAt = iso(a.recoverySentAt);

  let next = "Awaiting owner", urgent = false, bucket: Bucket = "owner";
  if (lostOutcome) { next = `${LOST_LABEL[lostOutcome]}${closedAt ? ` · ${rel(closedAt, now)}` : ""}`; bucket = "lost"; }
  else if (resolvedAt) { next = `Recovered ${rel(resolvedAt, now)}`; bucket = "done"; }
  else if (li && li.o === "fail") { next = "Retire or replace account"; urgent = true; bucket = "action"; }
  else if (em && em.o === "fail") { next = "Email bounced — get new contact"; urgent = true; bucket = "action"; }
  else if (!em) { next = "Send restriction email"; urgent = true; bucket = "action"; }
  else if (a.recoveryQrAt && !a.recoverySentAt) { next = "Send QR link to owner"; urgent = true; bucket = "action"; }
  else if (id && id.o === "fail" && !fm) { next = "Submit appeal form"; urgent = true; bucket = "action"; }
  else if (fm && fm.o === "fail") { next = "Appeal rejected — retry or retire"; urgent = true; bucket = "action"; }
  else if (fm && fm.o === "pending") { next = `Awaiting LinkedIn · ${rel(fm.at ? Date.parse(fm.at) : now, now).replace(" ago", "")}`; bucket = "linkedin"; }
  else if (qr && qr.o === "pending") {
    const silentH = sentAt ? (now - Date.parse(sentAt)) / H : 0;
    if (silentH > ownerSilentHours) { next = `Chase owner · silent ${Math.round(silentH)}h`; urgent = true; bucket = "action"; }
    else next = "Awaiting owner scan";
  } else next = "Awaiting owner";

  // Count restrictions: the "restricted" events in the log, or 1 if currently restricted with none logged.
  const restrictedEvents = log.filter((e) => e.event === "restricted").length;
  const cnt = Math.max(restrictedEvents, openSince ? 1 : resolvedAt ? 1 : 0, 1);

  // Duration of the current/last case.
  let restrictedMs = 0;
  if (openSince) restrictedMs = (closedAt || now) - openSince;
  else if (resolvedAt) {
    const restrictBefore = [...log].filter((e) => e.event === "restricted" && Date.parse(e.at) <= resolvedAt).pop();
    restrictedMs = restrictBefore ? resolvedAt - Date.parse(restrictBefore.at) : 0;
  } else if (lostOutcome) {
    // Retired/perma with no open restrictedAt — measure from the last logged restriction.
    const lastR = [...log].reverse().find((e) => e.event === "restricted");
    restrictedMs = lastR ? (closedAt || now) - Date.parse(lastR.at) : 0;
  }

  const errs = steps.filter((s) => s.err);
  const lastErr = errs.length ? errs[errs.length - 1].err || "" : "";
  const openCase = !resolvedAt && !lostOutcome;

  const flags: DerivedCase["flags"] = [];
  if (cnt >= 3) flags.push({ label: `${ord(cnt)} restriction`, kind: "repeat" });
  if (openCase && restrictedMs / H / 24 > staleDays) flags.push({ label: `Stale ${Math.floor(restrictedMs / H / 24)}d`, kind: "stale" });
  if (a.renterName && openCase && a.status === "rented") flags.push({ label: a.renterName, kind: "renter" });

  const chip = (s: Step | null, k: StepKind, emptyTip: string) =>
    s ? { k, label: OUT_LABEL[s.k][s.o], outcome: s.o, tip: `${STEP_TITLES[s.k]}: ${OUT_LABEL[s.k][s.o]}` } : { k, label: "—", outcome: "none" as const, tip: emptyTip };
  const idSkip = !id && li && li.o === "ok";
  const chain: DerivedCase["chain"] = [
    em ? chip(em, "email", "Not sent") : { k: "email" as const, label: "Not sent", outcome: "none" as const, tip: "No restriction email sent yet" },
    idSkip ? { k: "na" as const, label: "n/a", outcome: "na" as const, tip: "ID check not needed" } : chip(id, "id", "Not attempted"),
    chip(fm, "form", id && id.o === "fail" ? "Needed — ID failed" : "Not needed yet"),
    chip(li, "li", "No decision yet"),
  ];

  return { next, urgent, bucket, cnt, restrictedMs, resolvedAt, closedAt, lostOutcome, openSince, lastErr, phase: phaseOf(a.status), flags, chain };
}
