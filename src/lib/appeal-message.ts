// Varied contact-form messages for a restricted account (Issue Type = Verifications). We deliberately
// AVOID a single shared template: LinkedIn's case system can pattern-match identical text across
// different "members" and infer the accounts are run by one party, which blows each account's cover
// and can get the request denied. So each account gets ONE of several distinct messages (different
// wording, structure, length, tone), picked deterministically by the account id so the same account
// always shows the same text.
//
// FRAMING (Oct-29 2026): every message now leads with "I can't access MY OWN account and the identity
// verification won't go through" and states plainly "I am NOT reporting another member". This is
// deliberate: when the message read like a complaint about being restricted, agents kept misrouting it
// to the "report a member" lane (they replied asking for the reported profile / screenshot), which is
// a dead end. Framing it as a self-service verification error that the member can't complete keeps it
// in the identity-verification lane. Still identity-first, offers a government ID, cites the profile
// URL + the email on file, and never mentions VPN / automation / rental. See memory:
// appeal-messages-must-vary and linkedin-restriction-appeal. (No em-dashes anywhere, house tone rule.)

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
  (c) => `${c.first ? `Hi, I'm ${c.first}.` : "Hello,"}\n\nI'm trying to get back into my own LinkedIn account, but it keeps asking me to verify my identity and I can't get past that step. Just to be clear, I am not reporting another member, this is about my own account that I am locked out of. I have a government-issued ID ready and I am happy to verify however you need. Could you help me complete the identity verification so I can regain access?${ref(c, "For reference,")} Thank you so much.`,
  (c) => `Hello,\n\n${c.first ? `My name is ${c.first}. ` : ""}I have lost access to my own account and LinkedIn is asking me to confirm my identity, but the verification will not go through for me. To be clear, I am not trying to report anyone, I simply need to prove this account is really mine. I can provide a valid government ID right away, so please let me know the best way to verify so my access can be restored.${ref(c, "To help you find it,")} I would really appreciate your help.`,
  (c) => `${c.first ? `Hi there, this is ${c.first}.` : "Hi there,"}\n\nI keep running into a verification error when I try to access my own account, and I cannot complete the identity check. This is not a report about anyone else, it is my own account that I am locked out of. I have official ID on hand and I am ready to verify. Could you point me to the right way to confirm my identity so I can get back in?${ref(c, "My account details:")} Thanks very much.`,
  (c) => `To whom it may concern,\n\n${c.first ? `I'm ${c.first}, and I am` : "I am"} writing because I cannot access my own account. LinkedIn is asking me to verify my identity, but I am unable to finish the verification. I am not reporting a member, this is purely about recovering my own account. I am completely willing to confirm who I am with a government-issued document. Is there another way to verify, or could someone review my account directly?${ref(c, "For reference,")} Thank you for looking into this.`,
  (c) => `${c.first ? `Hi, ${c.first} here.` : "Hi,"}\n\nI am locked out of my own account and the identity verification step is not working for me. I want to be clear that I am not reporting anyone, I just need to prove the account belongs to me. I can send a clear photo of my government ID to show this is really me. What do you need from me to verify my identity and restore access?${ref(c, "To locate the account,")} Many thanks.`,
  (c) => `Hello,\n\nI am trying to recover my own account and would really appreciate your help. ${c.first ? `I'm ${c.first}, and I am` : "I am"} being asked to verify my identity, but the check keeps failing on my end. This is not a report about another member, it is about my own account access. I have a valid government ID (a passport, if that helps) ready to submit. Could you help me complete the verification so I can sign in again?${ref(c, "My details for reference:")} I really appreciate it.`,
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
