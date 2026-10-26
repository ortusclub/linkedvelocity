// Invites sent from the onboarded pipeline row: convert a just-onboarded ambassador
// into a referrer, re-engage the referrer who brought them in, and nudge an ambassador
// who is ALREADY a referrer. Offer: refer = ₱500, onboard it yourself (DIY) = up to ₱1,000.
// A portalUrl is passed for anyone who already has a portal (referrers, and ambassadors
// who are also referrers); a bare ambassador with no portal gets the self-signup link
// (/become-a-referrer) so they can create their own link right away — no back-and-forth.
export type InviteRecipient = "ambassador" | "referrer";
export type InviteChannel = "email" | "chat";

export function referralInviteMessage(
  recipient: InviteRecipient,
  channel: InviteChannel,
  name: string,
  portalUrl?: string | null,
  signupUrl?: string | null,
): { subject: string; text: string } {
  const hi = name?.trim() ? `Hi ${name.trim()}` : "Hi";

  if (recipient === "referrer") {
    // The referrer who brought this account in — re-engage them (they have a portal).
    const subject = "Your referrals are worth more now";
    if (channel === "chat") {
      return { subject, text: `${hi}, it's Ortus from LinkedVelocity. Thanks again for the accounts you've sent our way. Quick heads up: the payout just got better. On top of the ₱500 for a referral, you now earn up to ₱1,000 when you set the account up yourself. Same process you already know, just more for your time. We're still taking on new accounts whenever you have someone in mind.${portalUrl ? ` Your dashboard and share link are here: ${portalUrl}` : ""}` };
    }
    return { subject, text: `${hi},\n\nThanks again for the accounts you've sent our way.\n\nQuick heads up: the payout just got better. On top of the ₱500 for a referral, you now earn up to ₱1,000 when you set the account up yourself. Same process you already know, just more for your time, and we're still taking on new accounts whenever you have someone in mind.${portalUrl ? `\n\nYour dashboard and share link are here:\n${portalUrl}` : ""}\n\nHappy to help if you have any questions.\nOrtus, LinkedVelocity` };
  }

  // Ambassador who is ALSO a referrer already — nudge, don't re-pitch from scratch.
  if (portalUrl) {
    const subject = "Your referrals are worth more now";
    if (channel === "chat") {
      return { subject, text: `${hi}, it's Ortus from LinkedVelocity. Quick nudge, since you're already set up as a referrer: the payout just got better. On top of the ₱500 for a referral, you now earn up to ₱1,000 when you set the account up yourself, the same way you did with yours. We're still taking on new accounts. Your dashboard and share link are right here: ${portalUrl}` };
    }
    return { subject, text: `${hi},\n\nQuick heads up, since you're already one of our referrers: the payout just got better. On top of the ₱500 for a referral, you now earn up to ₱1,000 when you set the account up yourself, the same way you did with yours. We're still taking on new accounts whenever you have someone in mind.\n\nEverything's in your dashboard:\n${portalUrl}\n\nOrtus, LinkedVelocity` };
  }

  // Ambassador, just onboarded, not a referrer yet — send them straight to self-signup
  // so they create their own referral link immediately (/become-a-referrer, 30 seconds).
  const subject = "Earn on the side with LinkedVelocity";
  const signupLine = signupUrl || "https://linkedvelocity.com/become-a-referrer";
  if (channel === "chat") {
    return { subject, text: `${hi}, it's Ortus from LinkedVelocity. You've been through the whole setup now, so you already know how it works, which puts you in a good spot to earn on the side. It's ₱500 when you refer someone, or up to ₱1,000 when you set the account up yourself, the same way you just did with yours. Sign up here and your link is ready instantly (takes about 30 seconds): ${signupLine}` };
  }
  return { subject, text: `${hi},\n\nYou've been through the whole setup now, so you already know how it works. That puts you in a good spot to earn on the side.\n\nIt's ₱500 when you refer someone to us, or up to ₱1,000 when you set the account up yourself, the same way you just did with yours. We're always glad to take on more.\n\nSign up here and your link is ready instantly (takes about 30 seconds):\n${signupLine}\n\nOrtus, LinkedVelocity` };
}
