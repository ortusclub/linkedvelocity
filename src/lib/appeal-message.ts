// Varied appeal / contact-form messages for a restricted account. We deliberately AVOID a single
// shared template: LinkedIn (and its case system) can pattern-match identical appeal text across
// different "members" and infer the accounts are run by one party — which blows each account's cover
// as an independent individual and can get appeals denied. So each account gets ONE of several
// distinct messages (different wording, structure, length, tone), picked deterministically by the
// account id so the same account always shows the same text. All stay identity-first, offer a
// government ID, and never mention VPN / automation / rental. See memory: appeal-messages-must-vary.

// Small stable hash (FNV-1a) → a template index. Same seed always maps to the same template.
function seedIndex(seed: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % n;
}

type Template = (first: string) => string;

const TEMPLATES: Template[] = [
  (f) => `${f ? `Hi, I'm ${f}.` : "Hello,"}\n\nI'm reaching out because my account was restricted and I'm honestly not sure why. I rely on LinkedIn for my day-to-day work, so losing access has been a real setback. I'm happy to prove who I am — I have a government-issued ID ready whenever you need it. Could you help me get my account reviewed and reinstated?\n\nThank you so much for your time.`,
  (f) => `Hello,\n\n${f ? `My name is ${f}, and I` : "I"}'ve been locked out of my account since it was restricted, and I'd really like to get this sorted. I use LinkedIn professionally, so it's been stressful being cut off. I can verify my identity right away with a valid government ID — please just let me know the best way to send it, or whether someone can review my account manually.\n\nI'd appreciate any help you can give.`,
  (f) => `${f ? `Hi there, this is ${f}.` : "Hi there,"}\n\nI don't really understand why my account was restricted. I've only ever used it genuinely for my work, and being shut out has made things difficult. I'd be glad to confirm my identity — I have official ID on hand. Would you be able to look into my case and help restore my access?\n\nThanks very much.`,
  (f) => `To whom it may concern,\n\n${f ? `I'm ${f}, and I'm` : "I'm"} writing to appeal a restriction on my account. I'm completely willing to verify my identity with a government-issued document — I did try the ID check, but it wouldn't go through for me. Is there another way to verify, or could someone review my account directly?\n\nThank you for looking into this.`,
  (f) => `${f ? `Hi, ${f} here.` : "Hi,"}\n\nMy account was restricted recently and I'd really appreciate your help getting it back. It matters a lot for my work, and I've always used it the right way. I can send a clear photo of my government ID to show this is really me — please tell me what you need from me to move forward.\n\nMany thanks.`,
  (f) => `Hello,\n\nI recently found my account restricted and would like to request a review. ${f ? `I'm ${f} — a real` : "I'm a real"} person using LinkedIn for professional reasons, and I'm entirely comfortable verifying that. I have a valid government ID (a passport, if that's easier) ready to submit. Could you please help me appeal this and regain access?\n\nI really appreciate it.`,
];

// Deterministic, varied appeal message for an account. `seed` (the account id) keeps the pick stable.
export function buildAppealMessage(opts: { name?: string | null; seed?: string | null }): string {
  const first = (opts.name || "").trim().split(/\s+/)[0] || "";
  const seed = (opts.seed || opts.name || "appeal").toString();
  return TEMPLATES[seedIndex(seed, TEMPLATES.length)](first);
}

export const APPEAL_TEMPLATE_COUNT = TEMPLATES.length;
