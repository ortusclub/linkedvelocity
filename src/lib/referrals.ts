// Single source of truth for "this referred signup has earned the marketer their fee".
//
// A signup only *converts* — and only becomes payable — once the referred account is
// fully onboarded AND we've confirmed it's good to pay (verifiedAt = the admin "○ Confirm
// ok to pay" toggle). Being merely "onboarded" (accepted / transferred onto inventory) is
// NOT enough: we confirm the account is genuinely usable first, THEN the referrer earns.
//
// verifiedAt is the deliberate decision to pay the referrer. Once it's set, the referral
// is earned PERMANENTLY — a later account restriction (accountIssue) is an account-health
// problem, not a reason to un-earn (and definitely not to claw back a commission already
// paid). Earlier this also required `!accountIssue`, which caused a paid-then-restricted
// conversion to silently drop out of "earned" while its payment stayed counted — making
// the referrer's owed balance understate by that amount. So accountIssue no longer gates
// this. (To hold an as-yet-unpaid conversion, un-set verifiedAt / un-confirm it instead.)
//
// Shared by the marketer portal, the admin Referrals tab, and the payouts digest so all
// three agree on who has actually converted and what is owed.
import type { ReferralTiers } from "@/lib/referral-currency";

export interface ReferralGate {
  status: string;
  verifiedAt?: Date | string | null;
  accountIssue?: string | null;
  onboardedAt?: Date | string | null;
  // The setup fee's paid date, and the payout ledger that may hold a "setup" entry.
  // "Onboarded" means the setup fee is PAID — see isReferralOnboarded.
  paidAt?: Date | string | null;
  monthlyPayouts?: unknown;
  referralSource?: string | null;
  // For the tiered DIY commission: how the onboarding was done, and whether the
  // account was ID-verified AT onboarding (a snapshot — NOT the live linkedinVerified,
  // and NOT the admin verifiedAt "ok to pay" flag above). Locked at onboarding.
  onboardingMethod?: string | null;
  onboardingVerified?: boolean | null;
  // Account age at onboarding — sets the maturing window before the referral is payable.
  accountFreshness?: string | null;
  // When the application came in — decides which maturing policy applies (see below).
  createdAt?: Date | string | null;
  // Admin-set manual hold on THIS referral's commission (e.g. referred account restricted,
  // referrer payout details missing). While set, the commission is held — not ready to pay —
  // without un-earning it. Cleared by releasing the hold.
  referralHoldReason?: string | null;
}

// A manual hold parks an earned commission out of "ready to pay" until it's released.
export function isReferralHeld(a: ReferralGate): boolean {
  return !!(a.referralHoldReason && a.referralHoldReason.trim());
}

// Whether the setup fee for a referred account has been PAID (the "Onboarded = paid"
// milestone). Prefers a "setup" entry in the payout ledger; falls back to legacy paidAt.
function setupFeePaid(a: ReferralGate): boolean {
  if (a.paidAt) return true;
  const arr = Array.isArray(a.monthlyPayouts) ? (a.monthlyPayouts as Array<{ kind?: string; paidAt?: string }>) : [];
  return arr.some((p) => p?.kind === "setup" && !!p.paidAt);
}

// Whether the referred account is onboarded. Canonical rule (see the onboarding stage
// semantics): "Onboarded" means the setup fee is PAID — NOT merely logged in. `onboardedAt`
// is the LOGIN moment (pipeline Level 3), so it must NOT count here or a logged-in-but-
// unpaid account inflates the referrer's converted/owed totals. status "onboarded" is the
// deliberate Level-5 marker; a paid setup fee is the other true signal (covers a paid
// account whose status write lagged behind).
export function isReferralOnboarded(a: ReferralGate): boolean {
  return a.status === "onboarded" || setupFeePaid(a);
}

export function isReferralEarned(a: ReferralGate): boolean {
  return isReferralOnboarded(a) && !!a.verifiedAt;
}

// After QC passes (verifiedAt), the account still MATURES through its check window before
// anyone is paid, so a signup can be "earned" (converted, counted) yet not "ready to pay"
// until it has matured — this stops a same-day verify from reading as instantly payable. A
// fully-onboarded (Level 5) account is treated as already matured, so marking Level 5 is the
// manual lever to make a referral payable immediately.
//
// The maturation hold is a FLAT one week after QC for every account — the single clock the
// pipeline, the referrer portal and the owners views all read from, so a signup's "ready"
// date is the same everywhere. (Older accounts once used a 3-day established / 1-week split;
// that split is gone as of 2026-09-28 so the admin and portal dates never diverge.)
export function referralMatureDays(_a: Pick<ReferralGate, "accountFreshness" | "createdAt">): number {
  return 7;
}
export function referralMaturesAt(a: ReferralGate): Date | null {
  if (a.status === "onboarded" || !a.verifiedAt) return null; // null = already matured / n/a
  const base = new Date(a.verifiedAt);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + referralMatureDays(a) * 86400000);
}

// The setup fee (and the referrer's commission) come due one week after QC passes. This is
// the raw QC + 1 week date REGARDLESS of status, so the owner-side views (payouts digest,
// owners export, payouts) show the same "ready" date as the pipeline and the referrer
// portal. Unlike referralMaturesAt it doesn't null out for onboarded — those callers still
// want the date. Returns null only until QC is passed (no date to show yet).
export function setupFeeReadyDate(verifiedAt: Date | string | null): Date | null {
  if (!verifiedAt) return null;
  const d = new Date(verifiedAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 86400000);
}
export function isReferralMatured(a: ReferralGate, now: Date = new Date()): boolean {
  if (a.status === "onboarded") return true;
  const at = referralMaturesAt(a);
  return !!at && now.getTime() >= at.getTime();
}
// Payable now = earned (onboarded + QC-passed), past its maturing window, and not on a
// manual hold. A held commission stays earned/counted but is not ready to pay.
export function isReferralReadyToPay(a: ReferralGate, now: Date = new Date()): boolean {
  return isReferralEarned(a) && isReferralMatured(a, now) && !isReferralHeld(a);
}

// Tiered referral commission. A plain referral (LV onboards) pays the base `referral`
// rate. A DIY (self-service) onboarding pays more, by how it was done and whether the
// account is ID-verified:
//   phone    (referrer chased it, LV signed in) → phone.base / phone.verified
//   computer (referrer did the guided sign-in)  → computer.base / computer.verified
// `verified` is the snapshot taken AT onboarding (onboardingVerified), so the amount is
// locked then — verifying the account afterwards does NOT change what the referrer earns.
// Self-service rows without a recorded method (only pre-tier rows, since new onboardings
// always stamp it) fall back to the computer tier so the amount is never understated.
export function referralCommissionAmount(a: ReferralGate, tiers: ReferralTiers): number {
  if (a.referralSource !== "self-service" || a.onboardingMethod === "team_meeting") return tiers.referral;
  const verified = !!a.onboardingVerified;
  const band = a.onboardingMethod === "phone" ? tiers.phone : tiers.computer;
  return verified ? band.verified : band.base;
}
