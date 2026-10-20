// Copy + types for the referral-outreach admin (/admin/referral-outreach). Four segments,
// email + chat each. Offer: refer = ₱500, help them set up = up to ₱1,000, paid same day.
// [₱X] top-referrer figure is phrased loosely so it doesn't need weekly updates.
export type OutreachSegment = "1a" | "1b" | "2" | "3";
export type OutreachChannel = "email" | "chat";

export const TOP_REFERRER = "over ₱17,000";

export const SEGMENT_LABEL: Record<OutreachSegment, string> = {
  "1a": "Referrer · never referred",
  "1b": "Referrer · gone quiet",
  "2": "Ambassador",
  "3": "Rejected / unreachable",
};

export type OutreachRow = {
  kind: "referrer" | "ambassador";
  id: string;
  name: string;
  segment: OutreachSegment;
  email: string | null;
  chatMethod: "whatsapp" | "telegram" | "viber" | null;
  chatHandle: string | null;
  link: string;       // their /r/<slug>, or the /become-a-referrer signup URL when they have no link yet
  isSignup: boolean;  // true = link is the signup CTA (no referrer record yet)
  contacted: boolean; // we've already emailed them for this campaign
  lastChatCh: "whatsapp" | "telegram" | "viber" | null; // last chat channel we messaged them on
  lastChatAt: string | null; // when we last messaged them on a chat channel (ISO)
  signedUpAt: string | null; // when they signed up / applied (ISO)
  signedUpAfterEmailAt: string | null; // set when they signed up AFTER we emailed them (ISO) — a conversion
  suppressed: boolean;       // on the do-not-contact list
  suppressReason: string | null;
};

const first = (name: string) => (name || "").trim().split(/\s+/)[0] || "there";

// The subjects are fixed per segment — also used to detect "already contacted" from the email log.
export const SEGMENT_SUBJECTS: Record<OutreachSegment, (name: string) => string> = {
  "1a": () => "Your first referral could pay ₱1,000",
  "1b": (n) => `Your referral link still works, ${first(n)}`,
  "2": () => "You know how it works, now earn from it",
  "3": () => "You can still earn with LinkedVelocity",
};

export function outreachCopy(segment: OutreachSegment, channel: OutreachChannel, name: string, link: string, isSignup: boolean): { subject: string; text: string } {
  const f = first(name);
  const subject = SEGMENT_SUBJECTS[segment](name);
  const linkLine = isSignup ? `Sign up and get your link (takes 30 seconds): ${link}` : `Your link: ${link}`;
  const chatLink = isSignup ? `Sign up and get your link: ${link}` : `Your link: ${link}`;

  if (channel === "chat") {
    const text = {
      "1a": `Hi ${f}! You're all set up as a LinkedVelocity referrer, and your first referral is waiting 🙌 Earn ₱500 per signup, or up to ₱1,000 if you help them set up. You're paid the same day they are. Start with friends and family, verified or not. ${chatLink}`,
      "1b": `Hi ${f}! Your LinkedVelocity link is still active 🙌 Every signup through it earns you ₱500, or up to ₱1,000 if you help them set up. You're paid the same day they are. Our top referrer has made ${TOP_REFERRER} so far. Start with friends and family, verified or not. ${chatLink}`,
      "2": `Hi ${f}! You already know how LinkedVelocity works and how payouts land. Want to earn more? Refer someone for ₱500, or up to ₱1,000 if you help them set up. That's on top of your own payout. Start with friends and family, verified or not. ${chatLink}`,
      "3": `Hi ${f}! Your account didn't get through, but you can still earn with LinkedVelocity. Refer someone for ₱500, or up to ₱1,000 if you help them set up. You don't need your own account. Start with friends and family, verified or not. ${chatLink}`,
    }[segment];
    return { subject, text };
  }

  const text = {
    "1a": `Hi ${f},\n\nYou signed up as a LinkedVelocity referrer but haven't sent anyone yet. Your first referral is easier than you'd think.\n\n₱500 when someone signs up through your link\nUp to ₱1,000 if you help them get set up\nYou get paid the same day they do. Our top referrer has made ${TOP_REFERRER} so far, and they started with one.\n\nStart with friends and family. Verified or not, we accept both.\n\n${linkLine}\n\n— LinkedVelocity`,
    "1b": `Hi ${f},\n\nIt's been a while since your last referral, so here's a reminder of what each one is worth:\n\n₱500 when someone signs up through your link\nUp to ₱1,000 if you help them get set up\nYou get paid the same day they do. Our top referrer has made ${TOP_REFERRER} so far.\n\nStart with friends and family. Verified or not, we accept both.\n\n${linkLine}\n\n— LinkedVelocity`,
    "2": `Hi ${f},\n\nYou've been through setup and you've seen the payouts come in. That makes you the best person to explain LinkedVelocity to others.\n\nRefer someone and you earn:\n\n₱500 when they sign up through your link\nUp to ₱1,000 if you walk them through setup yourself\nYou get paid on the same day they do, on top of your own monthly payout. Our top referrer has made ${TOP_REFERRER} so far.\n\nStart with friends and family. Verified or not, we accept both.\n\n${linkLine}\n\n— LinkedVelocity`,
    "3": `Hi ${f},\n\nYour own account didn't make it through, but you can still earn with us as a referrer. You don't need an active account to do it.\n\n₱500 when someone signs up through your link\nUp to ₱1,000 if you help them get set up\nYou get paid on the same day they do. Our top referrer has made ${TOP_REFERRER} so far.\n\nStart with friends and family. Verified or not, we accept both.\n\n${linkLine}\n\n— LinkedVelocity`,
  }[segment];
  return { subject, text };
}
