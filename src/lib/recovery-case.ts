import type { RestrictionEvent } from "@/lib/restriction";

// Restrictions v2 — the recovery CASE model. One case per restriction: the spine is a chain of
// recovery steps (Restriction email → QR → ID verification → Appeal form → LinkedIn decision),
// from which we auto-compute the "next step" and a triage bucket. Email + QR steps are DERIVED
// from the account's recovery_* fields (single source of truth); ID / Form / LinkedIn / Note
// steps are logged by the team and stored in `recovery_case`. Pure functions here — the API
// fetches accounts and calls these; no DB access so the logic stays testable.

export type StepKind = "email" | "qr" | "id" | "form" | "li" | "note" | "gl" | "pw" | "relist" | "handback";
export type Outcome = "ok" | "fail" | "pending";
export type Step = { k: StepKind; o: Outcome; at: string; err?: string; note?: string };
export type LostOutcome = "perma" | "nocontact";
export type StoredCase = { reason?: string; steps?: Step[]; outcome?: LostOutcome; closedAt?: string; outcomeNote?: string; reopened?: boolean; resolvedAt?: string };
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
  email: "Owner contacted", qr: "QR recovery link", id: "ID verification",
  form: "Appeal form", li: "LinkedIn decision", note: "Note",
  gl: "GoLogin login", pw: "Password reset", relist: "Relisted", handback: "Handed back",
};
export const OUT_LABEL: Record<StepKind, Record<Outcome, string>> = {
  email: { ok: "Sent", fail: "Bounced", pending: "Queued" },
  qr: { ok: "Scanned", fail: "Expired", pending: "Sent · not scanned" },
  id: { ok: "Passed", fail: "Failed", pending: "In progress" },
  form: { ok: "Accepted", fail: "Rejected", pending: "Under review" },
  li: { ok: "Restored", fail: "Rejected", pending: "Waiting" },
  note: { ok: "Note", fail: "Issue", pending: "Open" },
  gl: { ok: "Done", fail: "Failed", pending: "Pending" },
  pw: { ok: "Done", fail: "Failed", pending: "Pending" },
  relist: { ok: "Relisted", fail: "Failed", pending: "Pending" },
  handback: { ok: "Handed back", fail: "Failed", pending: "Pending" },
};
// Steps the team logs by hand via "Log a step". "email" = a manual "owner contacted" entry.
export const LOGGABLE: StepKind[] = ["email", "id", "form", "li", "note"];
// All kinds that can live in recovery_case.steps (the hand-logged ones plus the workflow actions).
export const STORED_KINDS: StepKind[] = ["email", "qr", "id", "form", "li", "note", "gl", "pw", "relist", "handback"];

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
  mailEvents?: Array<{ type: string; receivedAt: string; subject: string; bodyText: string }>; // captured LinkedIn appeal/ID/recovery emails
};

// Captured LinkedIn emails (AccountMailEvent) → chain steps, with the email's REAL date, so an
// appeal LinkedIn already answered doesn't sit "stale" and the ID/appeal cells reflect reality.
function mailDerivedSteps(a: CaseAccount): Step[] {
  const out: Step[] = [];
  for (const m of a.mailEvents || []) {
    const t = `${m.subject || ""} ${m.bodyText || ""}`;
    const at = m.receivedAt;
    if (m.type === "appeal_update") {
      if (/reinstat|restored?\b|access (?:has been )?restored|no longer restricted|back online/i.test(t)) out.push({ k: "li", o: "ok", at, note: "LinkedIn: appeal approved (email)" });
      else if (/remain(?:s)? restricted|does ?n.?t comply|not comply|rejected|declin|unable to (?:restore|reinstate)|will remain restricted/i.test(t)) out.push({ k: "li", o: "fail", at, err: "LinkedIn: appeal rejected (email)" });
      else out.push({ k: "li", o: "pending", at, note: "LinkedIn appeal update (email)" });
    } else if (m.type === "id_verification") {
      // Success FIRST — "removed the restriction" / "verifying your identity" means it worked.
      // (The failure patterns must be specific to verification, not generic words like "expired"
      // which also appear in the password-reset-link instructions of a SUCCESS email.)
      if (/removed (the )?restriction|restriction (has been |was )?(removed|lifted)|pleased to (let you know|inform)|thank you for verifying|verif(y|ied|ying) your identity|successfully verified|identity (has been )?(verified|confirmed)|access (has been )?restored|no longer restricted|reinstat/i.test(t))
        out.push({ k: "id", o: "ok", at, note: "LinkedIn: ID verified / restriction removed (email)" });
      else if (/unable to verify|could ?n.?t verify|couldn.?t verify|verification (was )?(unsuccessful|failed)|we (were|are) unable to|identity (could not|couldn.?t) be|does ?n.?t (meet|comply)|please resubmit/i.test(t))
        out.push({ k: "id", o: "fail", at, err: "LinkedIn: ID check failed (email)" });
      else out.push({ k: "id", o: "pending", at, note: "LinkedIn ID verification (email)" });
    } else if (m.type === "recovery_appeal" || m.type === "appeal_intake") {
      out.push({ k: "form", o: "pending", at, note: m.type === "appeal_intake" ? "LinkedIn asked for more info (email)" : "Recovery appeal (email)" });
    }
  }
  return out;
}

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
    reopened: c.reopened === true || undefined,
    resolvedAt: typeof c.resolvedAt === "string" ? c.resolvedAt : undefined,
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
  const logged = (stored.steps || []).filter((s) => STORED_KINDS.includes(s.k) && s.at);
  // A hand-logged email/qr step overrides the auto-derived one, so we don't show both.
  const derived = derivedSteps(a).filter((ds) => !((ds.k === "email" || ds.k === "qr") && logged.some((l) => l.k === ds.k)));
  const mail = mailDerivedSteps(a); // captured LinkedIn emails → id/form/li steps, with their real dates
  const steps = [...derived, ...mail, ...logged].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
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
  flags: Array<{ label: string; kind: "repeat" | "stale" | "renter" | "noqr" }>;
  chain: Array<{ k: StepKind | "na"; label: string; outcome: Outcome | "none" | "na"; tip: string }>;
};

export function deriveCase(
  a: CaseAccount,
  built: { reason: string; steps: Step[] },
  opts: { now?: number; staleDays?: number; ownerSilentHours?: number; cooldownDays?: number } = {},
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
  // Recovered = LinkedIn restored it. The case STAYS OPEN through the post-recovery workflow
  // (secure → warm-up → relist/hand-back); stored.resolvedAt marks it even before the log is read.
  const resolvedAt = stored.resolvedAt ? Date.parse(stored.resolvedAt) : (!openSince && lastRecovered ? Date.parse(lastRecovered.at) : null);
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

  const cooldownDays = opts.cooldownDays ?? 30;
  let next = "Awaiting owner", urgent = false, bucket: Bucket = "owner";
  if (lostOutcome) { next = `${LOST_LABEL[lostOutcome]}${closedAt ? ` · ${rel(closedAt, now)}` : ""}`; bucket = "lost"; }
  else if (resolvedAt) {
    // The post-recovery lifecycle (secure → warm-up → relist/hand-back) only applies to recoveries
    // taken through THIS tab (stored.resolvedAt). A recovery logged the old way (via inventory) is
    // already handled — it's just Recovered/done, not "needs securing".
    const gl = lastOf(steps, "gl"), pw = lastOf(steps, "pw"), relist = lastOf(steps, "relist"), handback = lastOf(steps, "handback");
    const rented = a.status === "rented";
    const inWorkflow = !!stored.resolvedAt;
    if (relist) { next = `Relisted ${rel(Date.parse(relist.at), now)}`; bucket = "done"; }
    else if (handback) { next = "Back with renter · gentle use"; bucket = "done"; }
    else if (!inWorkflow) { next = `Recovered ${rel(resolvedAt, now)}`; bucket = "done"; }
    else if (!gl || !pw) { next = "Log in on GoLogin + reset password"; urgent = true; bucket = "action"; }
    else if (rented) { next = "Hand back to renter (gentle)"; urgent = true; bucket = "action"; }
    else {
      const leftDays = Math.ceil((resolvedAt + cooldownDays * 86400e3 - now) / 86400e3);
      if (leftDays > 0) { next = `Warm-up · relist in ${leftDays}d`; bucket = "done"; }
      else { next = "Ready to relist"; urgent = true; bucket = "action"; }
    }
  }
  else if (qr && qr.o === "fail" && !id && !fm) { next = "Send ID verification form"; urgent = true; bucket = "action"; }
  else if (li && li.o === "fail") { next = "Retire or replace account"; urgent = true; bucket = "action"; }
  else if (em && em.o === "fail") { next = "Email bounced — get new contact"; urgent = true; bucket = "action"; }
  else if (!em) { next = "Send restriction email"; urgent = true; bucket = "action"; }
  else if (a.recoveryQrAt && !a.recoverySentAt) { next = "Send QR link to owner"; urgent = true; bucket = "action"; }
  else if (id && id.o === "fail" && !fm) { next = "Submit appeal form"; urgent = true; bucket = "action"; }
  else if (fm && fm.o === "fail") { next = "Appeal rejected — retry or retire"; urgent = true; bucket = "action"; }
  else if (fm && fm.o === "pending") { next = `Awaiting LinkedIn · ${rel(fm.at ? Date.parse(fm.at) : now, now).replace(" ago", "")}`; bucket = "linkedin"; }
  else {
    // Awaiting the owner — but if they've gone silent since we last reached out (contact / QR
    // link), flip the case back to Needs action as a chase, like a pipeline follow-up nudge.
    const contactAts = steps.filter((s) => s.k === "email" || s.k === "qr").map((s) => Date.parse(s.at));
    if (sentAt) contactAts.push(Date.parse(sentAt));
    const lastContact = contactAts.length ? Math.max(...contactAts) : 0;
    const silentH = lastContact ? (now - lastContact) / H : 0;
    const qrPending = qr && qr.o === "pending";
    if (lastContact && silentH > ownerSilentHours) {
      const span = silentH >= 48 ? `${Math.round(silentH / 24)}d` : `${Math.round(silentH)}h`;
      next = `Chase owner · silent ${span}`; urgent = true; bucket = "action";
    } else next = qrPending ? "Awaiting owner scan" : "Awaiting owner";
  }

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
  // Owner's been contacted but no QR is attached yet — someone needs to grab it from GoLogin so
  // the owner can actually clear the checkpoint. Only once recovery is underway (not pre-email).
  if (openCase && em && !a.recoveryQrAt) flags.push({ label: "No QR", kind: "noqr" });

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

// ---- Recovery workflow: the 5-step guided runbook for a case, from contacting the owner through
// post-recovery securing + warm-up + relist/hand-back. Pure: returns card STATES + which actions
// are available (as ids the UI maps to API calls); no DB access. ----
export type WfState = "done" | "todo" | "wait" | "fail" | "skip" | "lock";
export type WfAction = { id: string; label: string; variant: "primary" | "danger" | "secondary" };
export type WfCard = {
  n: number; title: string; sub: string; state: WfState; stLbl: string; stFg: string; isCurrent: boolean;
  note?: string; checks?: Array<{ key: "gl" | "pw"; label: string; on: boolean }>; hasPw?: boolean;
  hasBar?: boolean; pct?: number; barLabel?: string; actions: WfAction[];
};
export type Workflow = { cards: WfCard[]; next: string; level: string; current: number | null };

const WF_LBL: Record<WfState, [string, string]> = {
  done: ["Completed", "#0f7a3d"], todo: ["Not completed", "#5b6779"], wait: ["In progress · waiting", "#b45309"],
  fail: ["Didn't work", "#b91c1c"], skip: ["Skipped", "#9aa3b2"], lock: ["Locked", "#9aa3b2"],
};

export function buildWorkflow(a: CaseAccount, built: { steps: Step[] }, opts: { now?: number; cooldownDays?: number } = {}): Workflow {
  const now = opts.now ?? Date.now();
  const cd = opts.cooldownDays ?? 30;
  const DAY = 86400e3;
  const L = (k: StepKind) => lastOf(built.steps, k);
  const qr = L("qr"), id = L("id"), fm = L("form"), gl = L("gl"), pw = L("pw"), rl = L("relist"), hb = L("handback");
  const stored = parseStoredCase(a.recoveryCase);
  // Recovered = the case's own marker OR (no open restriction + a logged recovery) — so an account
  // recovered the old way (via inventory/pipeline, which only logs the event) still shows the
  // post-recovery steps instead of being stuck pre-recovery.
  const log = asLog(a.restrictionLog);
  const openSince = a.restrictedAt ? Date.parse(iso(a.restrictedAt)!) : null;
  const lastRec = [...log].reverse().find((e) => e.event === "recovered");
  const resolvedAt = stored.resolvedAt ? Date.parse(stored.resolvedAt) : (!openSince && lastRec ? Date.parse(lastRec.at) : null);
  const rec = !!resolvedAt, lost = !!stored.outcome, rented = a.status === "rented";
  // Securing (GoLogin + password) + warm-up only apply to recoveries taken through this tab; a
  // recovery logged the old way is already handled, so those steps show as done, not "todo".
  const securing = !!stored.resolvedAt;
  type Pre = Omit<WfCard, "stLbl" | "stFg" | "isCurrent">;
  const cards: Pre[] = [];
  const mk = (n: number, title: string, sub: string, state: WfState, extra: Partial<Pre> = {}) => cards.push({ n, title, sub, state, actions: [], ...extra });

  // 1 — Owner verifies (QR relay is the fallback, not the default)
  {
    let st: WfState = !qr ? "todo" : qr.o === "ok" ? "done" : qr.o === "fail" ? "fail" : "wait";
    if (!qr && (rec || id || fm)) st = "skip";
    const actions: WfAction[] = [];
    if (!rec && !lost && st !== "skip") {
      // Default exit: the owner verifies on their own after the email. QR relay is only for when
      // they can't reach the checkpoint (the account's in our GoLogin, so they can't see it).
      if (!qr) actions.push({ id: "recovered", label: "Owner got back in ✓", variant: "primary" }, { id: "qr_sent", label: "Relay QR instead", variant: "secondary" });
      if (qr && qr.o === "pending") actions.push({ id: "qr_ok", label: "Worked → recovered", variant: "primary" }, { id: "qr_fail", label: "Didn't work", variant: "danger" });
    }
    mk(1, "Owner verifies", qr && qr.o === "pending" ? `QR relayed ${rel(Date.parse(qr.at), now)} · waiting for them to scan` : "Usually the owner just verifies after the email. Only relay a QR if they can't reach the checkpoint themselves.", st, { actions, note: st === "todo" && !qr ? "If they got back in on their own, hit \"Owner got back in\". Only paste a QR (box below) if they're stuck at the checkpoint." : "" });
  }
  // 2 — ID verification form (opens when QR fails)
  {
    const open = !!(qr && qr.o === "fail");
    const st: WfState = id ? (id.o === "ok" ? "done" : id.o === "fail" ? "fail" : "wait") : (rec || fm) ? "skip" : open ? "todo" : "lock";
    const actions: WfAction[] = [];
    if (!rec && !lost && (open || id)) {
      if (!id) actions.push({ id: "id_sent", label: "Mark form sent", variant: "primary" });
      if (id && id.o === "pending") actions.push({ id: "id_ok", label: "Worked → recovered", variant: "primary" }, { id: "id_fail", label: "Didn't work", variant: "danger" });
    }
    mk(2, "Send ID verification form", id?.err || "If the QR doesn't work — owner submits ID through LinkedIn's form", st, { actions });
  }
  // 3 — Appeal (opens when ID fails)
  {
    const open = !!(id && id.o === "fail");
    const st: WfState = fm ? (fm.o === "ok" ? "done" : fm.o === "fail" ? "fail" : "wait") : rec ? "skip" : open ? "todo" : "lock";
    const actions: WfAction[] = [];
    if (!rec && !lost && (open || fm)) {
      if (!fm) actions.push({ id: "form_sent", label: "Mark appeal submitted", variant: "primary" });
      if (fm && fm.o === "pending") actions.push({ id: "form_ok", label: "Recovered", variant: "primary" }, { id: "form_fail", label: "Rejected", variant: "danger" });
      if (fm && fm.o === "fail") actions.push({ id: "perma", label: "Mark permanently restricted", variant: "danger" });
    }
    mk(3, "Send appeal", fm && fm.o === "pending" ? `Submitted ${rel(Date.parse(fm.at), now)} · LinkedIn usually answers in 3–10 days` : "Last resort — appeal with owner ID + explanation", st, { actions });
  }
  // 4 — GoLogin login + password reset (after recovery)
  {
    const st: WfState = gl && pw ? "done" : securing ? "todo" : rec ? "done" : "lock";
    mk(4, "Log in on GoLogin + reset password", "LinkedIn normally asks for a fresh login and new password after recovery", st, {
      checks: [{ key: "gl", label: "Logged in via GoLogin profile", on: !!gl }, { key: "pw", label: "Password reset & saved", on: !!pw }],
      hasPw: securing && !pw,
    });
  }
  // 5 — Hand back (rented) or warm-up → relist (not rented)
  {
    const ready = rec && !!gl && !!pw;
    const base = resolvedAt || 0; // warm-up counted from recovery ("construction for 30 days after restriction")
    const histDone: WfState | null = rec && !securing ? "done" : null; // old-way recovery: already handled
    if (rented && !rl) {
      mk(5, "Hand back to renter", "Rented — no cooldown. Keep activity gentle for the first 2 weeks.", hb ? "done" : ready ? "todo" : histDone || "lock", {
        actions: ready && !hb ? [{ id: "handback", label: "Mark handed back", variant: "primary" }] : [],
        note: ready ? `Tell ${a.renterName || "the renter"}: low volume, ~5–10 connection requests/day, no bulk messaging.` : "",
      });
    } else {
      const end = base + cd * DAY, left = base ? Math.max(0, Math.ceil((end - now) / DAY)) : cd;
      const pct = ready && base ? Math.min(100, Math.round(((now - base) / (cd * DAY)) * 100)) : 0;
      mk(5, `Warm up ${cd} days → relist`, "Not rented — under construction, gentle activity only, then mark available", rl ? "done" : ready ? (left ? "wait" : "todo") : histDone || "lock", {
        hasBar: ready && !rl, pct, barLabel: left ? `Day ${Math.min(cd, Math.floor((now - base) / DAY) + 1)} of ${cd} · relist ${new Date(end).toISOString().slice(0, 10)}` : "Cooldown done",
        note: ready && !rl ? "Warm-up: log in every few days, a few likes/views, ≤5 connection requests/day." : "",
        actions: ready && !rl ? [{ id: "relist", label: left ? "Relist early" : "Relist as available", variant: left ? "secondary" : "primary" }] : [],
      });
    }
  }

  const lastTouched = cards.reduce((m, x) => (["done", "fail", "wait"].includes(x.state) ? x.n : m), 0);
  let current: number | null = cards.find((x) => (x.state === "todo" || x.state === "wait") && x.n >= lastTouched)?.n ?? null;
  if (current == null) for (const x of cards) if (x.state === "todo" || x.state === "wait") current = x.n;
  if (lost) current = null;
  const doneN = cards.filter((x) => x.state === "done" || x.state === "skip").length;
  const out: WfCard[] = cards.map((x) => {
    let [stLbl, stFg] = WF_LBL[x.state];
    const isCurrent = x.n === current;
    if (isCurrent && x.state === "todo") { stLbl = "Not completed · next step"; stFg = "#1d4ed8"; }
    return { ...x, stLbl, stFg, isCurrent };
  });
  const next = lost && stored.outcome ? `${LOST_LABEL[stored.outcome]} — case closed` : current ? cards[current - 1].title : "All done";
  const level = `Step ${current ?? 5}/5${doneN === 5 ? " · done" : ""}`;
  return { cards: out, next, level, current };
}
