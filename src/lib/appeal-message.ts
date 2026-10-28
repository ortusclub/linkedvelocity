// Varied appeal / contact-form messages for a restricted account. We deliberately AVOID a single
// shared template: LinkedIn (and its case system) can pattern-match identical appeal text across
// different "members" and infer the accounts are run by one party — which blows each account's cover
// as an independent individual and can get appeals denied. So each account gets ONE of several
// distinct messages (different wording, structure, length, tone), picked deterministically by the
// account id so the same account always shows the same text. All stay identity-first, offer a
// government ID, note that the owner already tried the ID/contact form with their own email (so
// LinkedIn knows the self-serve path was attempted), and never mention VPN / automation / rental.
// Each also cites the profile URL and the email on file so support can locate the account. See
// memory: appeal-messages-must-vary. (No em-dashes anywhere — house tone rule.)

// Small stable hash (FNV-1a) → a template index. Same seed always maps to the same template.
function seedIndex(seed: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % n;
}

type Ctx = { first: string; url: string; email: string };
type Template = (c: Ctx) => string;

// Account-identifying reference sentence, with a per-template lead-in so it is not word-for-word
// identical across accounts. Returns "" when we have neither a URL nor an email on file.
function ref(c: Ctx, lead: string): string {
  const parts: string[] = [];
  if (c.url) parts.push(`my profile is ${c.url}`);
  if (c.email) parts.push(`the email on the account is ${c.email}`);
  if (!parts.length) return "";
  return ` ${lead} ${parts.join(" and ")}.`;
}

const TEMPLATES: Template[] = [
  (c) => `${c.first ? `Hi, I'm ${c.first}.` : "Hello,"}\n\nI'm reaching out because my account was restricted and I'm honestly not sure why. I rely on LinkedIn for my day-to-day work, so losing access has been a real setback. I already tried verifying through the form with my own email, but it would not go through for me. I'm happy to prove who I am and I have a government-issued ID ready whenever you need it.${ref(c, "For reference,")} Could you help me get my account reviewed and reinstated?\n\nThank you so much for your time.`,
  (c) => `Hello,\n\n${c.first ? `My name is ${c.first}, and I` : "I"}'ve been locked out of my account since it was restricted, and I'd really like to get this sorted. I use LinkedIn professionally, so it's been stressful being cut off. I did attempt the verification form using my own email, but it never completed. I can verify my identity right away with a valid government ID, so please let me know the best way to send it or whether someone can review my account manually.${ref(c, "To help you find it,")} I'd appreciate any help you can give.`,
  (c) => `${c.first ? `Hi there, this is ${c.first}.` : "Hi there,"}\n\nI don't really understand why my account was restricted. I've only ever used it genuinely for my work, and being shut out has made things difficult. I already tried the ID form with my own email and it wouldn't submit. I'd be glad to confirm my identity another way, as I have official ID on hand.${ref(c, "My account details:")} Would you be able to look into my case and help restore my access?\n\nThanks very much.`,
  (c) => `To whom it may concern,\n\n${c.first ? `I'm ${c.first}, and I'm` : "I'm"} writing to appeal a restriction on my account. I'm completely willing to verify my identity with a government-issued document. I did try the ID check using my own email, but it wouldn't go through for me. Is there another way to verify, or could someone review my account directly?${ref(c, "For reference,")} Thank you for looking into this.`,
  (c) => `${c.first ? `Hi, ${c.first} here.` : "Hi,"}\n\nMy account was restricted recently and I'd really appreciate your help getting it back. It matters a lot for my work, and I've always used it the right way. I tried submitting the verification form with my own email already, but it didn't work. I can send a clear photo of my government ID to show this is really me, so please tell me what you need from me to move forward.${ref(c, "To locate the account,")} Many thanks.`,
  (c) => `Hello,\n\nI recently found my account restricted and would like to request a review. ${c.first ? `I'm ${c.first}, a real` : "I'm a real"} person using LinkedIn for professional reasons, and I'm entirely comfortable verifying that. I already tried the ID form through my own email, but it would not complete. I have a valid government ID (a passport, if that's easier) ready to submit.${ref(c, "My details for reference:")} Could you please help me appeal this and regain access?\n\nI really appreciate it.`,
];

// Deterministic, varied appeal message for an account. `seed` (the account id) keeps the pick stable.
export function buildAppealMessage(opts: { name?: string | null; seed?: string | null; url?: string | null; email?: string | null }): string {
  const first = (opts.name || "").trim().split(/\s+/)[0] || "";
  const seed = (opts.seed || opts.name || "appeal").toString();
  let url = (opts.url || "").trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  const email = (opts.email || "").trim();
  return TEMPLATES[seedIndex(seed, TEMPLATES.length)]({ first, url, email });
}

export const APPEAL_TEMPLATE_COUNT = TEMPLATES.length;
