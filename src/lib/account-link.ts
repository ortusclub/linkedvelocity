// Single source of truth for "which inventory account belongs to this application" and
// "what LinkedIn URL do we show for this person". Pipeline, payouts and inventory all read
// through here so the URL (and the account behind it) is identical on every screen.
//
// Why this exists: historically each surface matched an account to an application its own way
// (pipeline: self-service FK → exact URL → unique email; payouts: email/notes only) and then
// displayed a different field (pipeline showed the APPLICATION url, payouts the ACCOUNT url).
// When the account was renamed during profile-build its vanity slug drifted from what the
// applicant first pasted, so the same person read differently on each page. Resolving the
// account the same way and always showing the live ACCOUNT url (falling back to the
// application url only until an account exists) makes the three agree.

// Minimal shapes — callers pass whatever richer row they already have.
export interface LinkableApplication {
  email: string;
  linkedinUrl: string | null;
  selfServiceOnboarding?: { accountId: string | null } | null;
}
export interface LinkableAccount {
  id: string;
  linkedinUrl: string | null;
  personalEmail: string | null;
}

// Normalise a LinkedIn URL for comparison: drop protocol/www, query string and trailing slash.
export function normalizeLinkedinUrl(url: string | null | undefined): string {
  return (url || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").split("?")[0].replace(/\/+$/, "");
}

// Resolve the inventory account for an application, most reliable signal first:
//   1. the self-service onboarding FK (an explicit link — always trusted),
//   2. an account whose URL matches the application's (exact, normalised) and is unambiguous,
//   3. the single account whose personal email equals the application's.
// Returns undefined when there is no account yet, or the match is ambiguous (so we never
// attach the wrong account — e.g. several applications sharing one personal email).
export function resolveAccountForApplication<A extends LinkableAccount>(
  app: LinkableApplication,
  accounts: A[],
): A | undefined {
  const fkId = app.selfServiceOnboarding?.accountId;
  if (fkId) {
    const byFk = accounts.find((a) => a.id === fkId);
    if (byFk) return byFk;
  }
  if (app.linkedinUrl) {
    const key = normalizeLinkedinUrl(app.linkedinUrl);
    const urlMatches = accounts.filter((a) => normalizeLinkedinUrl(a.linkedinUrl) === key && key !== "");
    if (urlMatches.length === 1) return urlMatches[0];
    if (urlMatches.length > 1) return undefined; // ambiguous — don't guess
  }
  const email = app.email.toLowerCase();
  const emailMatches = accounts.filter((a) => a.personalEmail?.toLowerCase() === email);
  return emailMatches.length === 1 ? emailMatches[0] : undefined;
}

// The URL to show for this person everywhere: the live account's URL once an account is
// linked (it reflects profile-build renames and corrections), otherwise what the applicant
// submitted. Pass the account from resolveAccountForApplication (or null/undefined).
export function canonicalLinkedinUrl(
  app: { linkedinUrl: string | null },
  account: { linkedinUrl: string | null } | null | undefined,
): string | null {
  const acct = account?.linkedinUrl?.trim();
  if (acct) return acct;
  return app.linkedinUrl?.trim() || null;
}
