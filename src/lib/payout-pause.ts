// Pure, dependency-free constants + templates for the payout Pause flow. Imported by both
// the server (pause endpoint, unified layer) and the client (the editable email preview in
// the pause form), so it must not import prisma, next, or anything server-only.

export type PauseReason = "cant_login" | "restricted" | "wrong_info" | "inaccessible" | "owner_request" | "other";
export const PAUSE_REASONS: PauseReason[] = ["cant_login", "restricted", "wrong_info", "inaccessible", "owner_request", "other"];

export const REASON_LABEL: Record<PauseReason, string> = {
  cant_login: "Can't log in",
  restricted: "Restricted",
  wrong_info: "Wrong payment info",
  inaccessible: "Account inaccessible",
  owner_request: "Owner request",
  other: "Other",
};

// The note shown on the paused strip, by reason.
export const REASON_NOTE: Record<PauseReason, string> = {
  cant_login: "Resume once we can log in again.",
  restricted: "Resume once the account is recovered or replaced.",
  wrong_info: "Fix the details in Account owners, then resume.",
  inaccessible: "No payouts are sent while paused.",
  owner_request: "No payouts are sent while paused.",
  other: "No payouts are sent while paused.",
};

export const reasonLabel = (r: string): string => REASON_LABEL[r as PauseReason] || "On hold";
export const reasonNote = (r: string): string => REASON_NOTE[r as PauseReason] || "No payouts are sent while paused.";
// Restricted paints the paused strip red; everything else amber.
export const reasonIsRestricted = (r: string): boolean => r === "restricted";

export interface OwnerEmailVars { first: string; kind: string; amt: string; dest: string }

// Owner email template per reason. Every body ends with the standard sign-off.
const SIGN_OFF = "\n\nThanks,\nLinkedVelocity";
export function ownerPauseEmail(reason: string, v: OwnerEmailVars): { subject: string; body: string } {
  const { first, kind, amt, dest } = v;
  switch (reason as PauseReason) {
    case "cant_login":
      return {
        subject: "We can't log in to your LinkedIn account",
        body: `Hi ${first},\n\nWe tried to log in to your LinkedIn account and couldn't get in. This usually happens after a password, email or 2FA change.\n\nYour ${kind} payout of ${amt} is on hold until we can log in again. Please reply to this email so we can sort it out.${SIGN_OFF}`,
      };
    case "restricted":
      return {
        subject: "Your LinkedIn account has been restricted",
        body: `Hi ${first},\n\nLinkedIn has restricted your account and we're working on recovering it. Your ${kind} payout of ${amt} is on hold until the account is recovered or replaced.\n\nYou don't need to do anything right now. We'll email you if we need your help.${SIGN_OFF}`,
      };
    case "wrong_info":
      return {
        subject: "Please check your payment details",
        body: `Hi ${first},\n\nWe couldn't send your ${kind} payout of ${amt} to ${dest}. The details on file look wrong.\n\nPlease reply with the correct account name and number and we'll send it right away.${SIGN_OFF}`,
      };
    case "inaccessible":
      return {
        subject: "We can't access your LinkedIn account",
        body: `Hi ${first},\n\nWe can't access your LinkedIn account right now. Your ${kind} payout of ${amt} is on hold until we can.\n\nPlease reply to this email so we can sort it out.${SIGN_OFF}`,
      };
    case "owner_request":
      return {
        subject: "Your payout is on hold",
        body: `Hi ${first},\n\nAs you asked, we've put your ${kind} payout of ${amt} on hold. Reply when you'd like us to send it.${SIGN_OFF}`,
      };
    default:
      return {
        subject: "Your payout is on hold",
        body: `Hi ${first},\n\nWe've put your ${kind} payout of ${amt} on hold because ...${SIGN_OFF}`,
      };
  }
}

export function referrerHeadsUpEmail(ownerFirst: string): { subject: string; body: string } {
  return {
    subject: `Heads up: ${ownerFirst}'s payout is on hold`,
    body: `Hi,\n\nHeads up: ${ownerFirst}'s payout is on hold while we sort out an account issue. Nothing is needed from you — just letting you know in case they mention it.${SIGN_OFF}`,
  };
}
