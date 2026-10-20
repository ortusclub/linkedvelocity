import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { onboardingMailRequest } from "@/services/onboarding-mail";
import { emailSetupConfig, linkedinSender, forwardedText } from "@/lib/onboarding-email-policy";

// Mirrors the (unexported) shape used by forwardOnboardingEmail in lib/onboarding-email.ts.
const incomingEmail = z.object({
  id: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  created_at: z.string(),
  subject: z.string(),
  text: z.string().nullable(),
  html: z.string().nullable(),
});

export type MailType =
  | "new_login" | "location_change" | "password_changed" | "email_changed"
  | "name_changed" | "photo_changed" | "restriction" | "email_verify" | "other"
  // LinkedIn appeal / recovery case correspondence — responses to the restriction appeals
  // WE file (from messages-noreply@linkedin.com, not a security sender). appeal_update carries
  // the outcome (reinstated / rejected); appeal_intake is LinkedIn asking us for more info.
  | "appeal_update" | "appeal_intake" | "recovery_appeal" | "id_verification";
export type MailSeverity = "benign" | "review" | "danger";

// Recommended-response checklist shown when an email is flagged "Wasn't us" (incident). Keyed by
// email type; the API emails these same steps to the team, the UI renders them inline. The
// restriction case points at our appeal flow.
export const RESTRICTION_GUIDE_PATH = "/restriction-guide";
export const INCIDENT_STEPS: Record<string, string[]> = {
  password_changed: [
    "Reset the password from our recovery email and set a fresh one.",
    "Sign out of all other sessions in LinkedIn settings.",
    "Re-check 2FA is ours and the recovery email is ours.",
  ],
  email_changed: [
    "Remove the email address they added.",
    "Re-add our address as the primary email and confirm it.",
    "Reset the password and sign out of all other sessions.",
  ],
  new_login: [
    "Sign out of all other sessions in LinkedIn settings.",
    "Change the password to a fresh one.",
    "Check whether this is a renter leak (shared GoLogin / wrong IP) before re-sharing.",
  ],
  location_change: [
    "Sign out of all other sessions in LinkedIn settings.",
    "Change the password to a fresh one.",
    "Check the proxy/GoLogin for a geo mismatch or a renter leak.",
  ],
  restriction: [
    "Open the restriction-appeal flow and submit identity-first (offer ID, never mention a VPN).",
    "Pause renter access until the appeal clears.",
    "Log the restriction on the account record.",
  ],
  appeal_intake: [
    "LinkedIn is asking for more info to process the appeal — reply identity-first (offer ID, never mention a VPN).",
    "Note the Case # on the account so replies stay on the same thread.",
    "Keep renter access paused until the appeal clears.",
  ],
};
export const INCIDENT_STEPS_DEFAULT = [
  "Change the password and sign out of all other sessions.",
  "Verify 2FA and the recovery email are both ours.",
  "Watch the account for further security emails.",
];
export const incidentSteps = (type: string): string[] => INCIDENT_STEPS[type] ?? INCIDENT_STEPS_DEFAULT;

export const MAIL_TYPE_LABEL: Record<string, string> = {
  new_login: "New login", location_change: "Location change", password_changed: "Password changed",
  email_changed: "Email changed", name_changed: "Name changed", photo_changed: "Photo changed",
  restriction: "Restriction", email_verify: "Email verify", other: "Security email",
  appeal_update: "Appeal update", appeal_intake: "Appeal — info needed",
  recovery_appeal: "Recovery appeal", id_verification: "ID verification",
};
export const mailTypeLabel = (type: string): string => MAIL_TYPE_LABEL[type] ?? "Security email";

const has = (s: string, re: RegExp) => re.test(s);

// Classify a captured LinkedIn security email by subject (+ body as a tiebreaker). No "our
// actions" log exists, so severity is a pure type heuristic: benign = log only, review = needs a
// look, danger = restriction/takeover. "New sign-in" is benign UNLESS it signals a new
// device/location, which bumps it to review.
//
// Returns null when the subject isn't a recognised account-security event. LinkedIn sends a flood
// of non-security mail from the same linkedin.com domain (invitations, messages, job alerts,
// digests, "people you may know") — those must NOT be logged here. Capture only trusts this
// classifier or a dedicated security sender (see isSecuritySender), never "from linkedin.com".
export function classifyAccountMail(subject: string, body: string): { type: MailType; severity: MailSeverity; location?: string } | null {
  const s = (subject || "").toLowerCase();
  const b = (body || "").toLowerCase();
  const location = extractLocation(body);
  const newPlace = has(s, /new (device|location|place)/) || has(b, /new (device|location|place)|didn.?t recognize|don.?t recognize|was this you/);

  if (has(s, /restrict|account (has been|was) (restricted|suspended)|we.?ve restricted|temporarily restricted|unusual activity on your account/)) return { type: "restriction", severity: "danger", location };
  // Appeal / recovery case mail (responses to OUR appeals). These come from a non-security
  // LinkedIn sender, so without these branches they'd be dropped as "not_security". The Case #
  // lives in the subject (intake/recovery/id) or body, so it stays queryable from what we store.
  if (has(s, /appeals? intake|request for (more|additional) information|additional information needed/)) return { type: "appeal_intake", severity: "review", location };
  if (has(s, /account recovery appeal/)) return { type: "recovery_appeal", severity: "review", location };
  if (has(s, /(two.?step authentication|2fa|two.?factor).*(id )?verification|id verification update/)) return { type: "id_verification", severity: "review", location };
  // Outcome of an appeal. "update on your appeal" is unambiguous; "update on your request" is
  // generic, so require appeal/recovery context in the body before claiming it.
  if (has(s, /an update on your appeal/) || (has(s, /an update on your request/) && has(b, /appeal|reinstat|restrict|verif(y|ied|ication)|cooperation in verifying|case\b/))) return { type: "appeal_update", severity: "review", location };
  // Password change/reset — allow intervening words ("password was successfully reset", "we reset
  // your password"), and LinkedIn's forced-reset prompt ("Account security alert — create a new
  // password"), rather than requiring the verb to butt right up against "password".
  if (has(s, /password\b[\w\s]{0,24}\b(changed|reset|updated)|(changed|reset|updated)\b[\w\s]{0,24}\bpassword|you (changed|reset) your password|create a new password/)) return { type: "password_changed", severity: "review", location };
  if (has(s, /email address (was|has been)? ?(changed|added|updated)|you (added|changed) (a new )?email|primary email/)) return { type: "email_changed", severity: "review", location };
  // New-device / "is this you?" challenge — a login from an unrecognised device that LinkedIn wants
  // confirmed. This is review-worthy (possible takeover), so it sits ABOVE the benign email_verify
  // branch and the "it's you / was this you" phrasing lives here, not there.
  if (has(s, /verify your (new )?(device|sign-?in|log-?in)|new device|device verification|please verify it.?s really you|verify it.?s you|is it (really )?you\b|was this you\b|do(n.?t| not)? you recognize/)) return { type: "location_change", severity: "review", location };
  // Benign email confirmation / one-time codes & PINs — NOT a device challenge (handled above).
  if (has(s, /confirm your email|verify your email|email verification|confirm this email|verification code|security code|one-?time (code|pin)|here.?s your pin|your pin is\b|your pin:? \d/)) return { type: "email_verify", severity: "benign", location };
  // Routine informational security-channel mail — logged but doesn't need a look.
  if (has(s, /remember me is no longer active/)) return { type: "other", severity: "benign", location };
  // Sign-in alerts: only the account-security phrasing, so notification mail ("…just signed in to
  // post") can't trip it.
  if (has(s, /new sign-?in|new sign in to|a new sign|signed in to your (linkedin )?account|we noticed a (new )?(login|sign-?in)|recent login to your account/)) return { type: newPlace ? "location_change" : "new_login", severity: newPlace ? "review" : "benign", location };
  if (has(s, /signing in from a new|signed in from a new (device|location|place)/)) return { type: "location_change", severity: "review", location };
  if (has(s, /you changed your name|your name (was|has been) (changed|updated)/)) return { type: "name_changed", severity: "benign", location };
  if (has(s, /you changed your (profile )?photo|your profile photo (was|has been)|new profile picture/)) return { type: "photo_changed", severity: "benign", location };
  return null;
}

// True when the sender is LinkedIn's dedicated account-security channel (security-noreply@ and the
// like). Mail from here is always worth logging even if the subject doesn't match a known pattern.
export function isSecuritySender(from: string): boolean {
  const address = (from.match(/<([^<>]+)>\s*$/)?.[1] || from).trim().toLowerCase();
  const [local, domain] = address.split("@");
  if (!/^(?:[a-z0-9-]+\.)*linkedin\.com$/.test(domain || "")) return false;
  return /(?:^|[.-])(account-)?security(-noreply)?$|^password-noreply$/.test(local || "");
}

// Best-effort location label from a LinkedIn sign-in email body (e.g. "Location: Lagos, NG").
function extractLocation(body: string): string | undefined {
  const m = body.match(/location[:\s]+([A-Z][A-Za-z .'-]+(?:,\s*[A-Za-z .'-]+){0,2})/)
    || body.match(/\bnear\s+([A-Z][A-Za-z .'-]+(?:,\s*[A-Za-z .'-]+){1,2})/);
  return m ? m[1].trim().replace(/\s+/g, " ").slice(0, 80) : undefined;
}

// Resolve an inbound recipient address to the LinkedInAccount it belongs to. The account's
// loginEmail IS the address LinkedIn mails; fall back to the onboarding email-setup → session.
async function resolveAccountId(toAddr: string): Promise<string | null> {
  const byLogin = await prisma.linkedInAccount.findFirst({
    where: { loginEmail: { equals: toAddr, mode: "insensitive" } },
    select: { id: true },
  });
  if (byLogin) return byLogin.id;
  const setup = await prisma.onboardingEmailSetup.findUnique({
    where: { address: toAddr },
    select: { session: { select: { accountId: true } } },
  });
  return setup?.session?.accountId ?? null;
}

// Capture one inbound LinkedIn email as an AccountMailEvent. Additive + idempotent: deduped by
// emailId, no-ops when the recipient isn't one of our account addresses or isn't from LinkedIn.
// Never throws to the caller's critical path — the webhook wraps it in try/catch anyway.
export async function captureAccountMail(emailId: string): Promise<{ stored: boolean; reason?: string }> {
  const cfg = emailSetupConfig();
  if (!cfg.ready) return { stored: false, reason: "not_ready" };

  const existing = await prisma.accountMailEvent.findUnique({ where: { emailId }, select: { id: true } });
  if (existing) return { stored: false, reason: "duplicate" };

  const msg = incomingEmail.parse(await onboardingMailRequest(`/emails/receiving/${encodeURIComponent(emailId)}`));
  if (msg.to.length !== 1) return { stored: false, reason: "fanout" };
  const toAddr = msg.to[0].trim().toLowerCase();
  const domain = toAddr.split("@")[1] || "";
  if (!cfg.captureDomains.includes(domain)) return { stored: false, reason: "foreign_domain" };
  if (!linkedinSender(msg.from)) return { stored: false, reason: "not_linkedin" };

  const accountId = await resolveAccountId(toAddr);
  if (!accountId) return { stored: false, reason: "no_account" };

  const bodyText = forwardedText(msg.text, msg.html);
  // Log only genuine account-security mail: a recognised security subject, or anything from the
  // dedicated security sender. Everything else from linkedin.com (invitations, messages, job
  // alerts, digests) is skipped so the log stays signal, not an inbox mirror.
  const cls = classifyAccountMail(msg.subject, bodyText);
  if (!cls && !isSecuritySender(msg.from)) return { stored: false, reason: "not_security" };
  const { type, severity, location } = cls ?? { type: "other" as MailType, severity: "review" as MailSeverity, location: extractLocation(bodyText) };
  const status = severity === "benign" ? "logged" : "needs_review";

  await prisma.accountMailEvent.create({
    data: {
      emailId,
      linkedinAccountId: accountId,
      receivedAt: new Date(msg.created_at),
      fromAddr: msg.from.slice(0, 320),
      toAddr,
      subject: (msg.subject || "").slice(0, 500),
      bodyText,
      type,
      severity,
      status,
      locationLabel: location ?? null,
    },
  });
  return { stored: true };
}
