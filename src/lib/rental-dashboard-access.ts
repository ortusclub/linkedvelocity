type RentalAccessState = {
  status: string;
  isShadow?: boolean;
  handoverAt?: string | Date | null;
  paused?: boolean;
  linkedinAccount: { restrictedAt?: string | Date | null; twoFactorResetNeeded?: boolean };
};

export function isRentalBeingPrepared(rental: RentalAccessState): boolean {
  return !rental.isShadow && !!rental.handoverAt && rental.status === "pending_access";
}

export function canShowRentalShareLink(rental: RentalAccessState): boolean {
  // The g.camp public share link is self-serve by design: anyone signed in to GoLogin who opens
  // it gets the profile under "Shared with me" — no per-email grant needed. So expose it as soon
  // as the rental is a real, openable one: active OR pending_access. The per-email grant cron
  // still runs (flips status, emails "you're live"), but access no longer waits on it. Excluded:
  // a shadow-handover prep (handoverAt), paused, restricted, or a pending 2FA reset.
  return (rental.status === "active" || rental.status === "pending_access")
    && !rental.handoverAt && !rental.paused
    && !rental.linkedinAccount.restrictedAt && !rental.linkedinAccount.twoFactorResetNeeded;
}
