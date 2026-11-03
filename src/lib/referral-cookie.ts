// Durable referral attribution.
//
// The referral slug used to ride only in `?ref=` and sessionStorage, both of which are
// easily lost — a new tab, the DIY email-verification round-trip, or landing straight on
// /onboarding all drop it. When that happened a referred owner who used the DIY
// self-onboarding flow silently fell back to the hidden "diy" bucket, so the real referrer
// got no credit (hit: jhon-81's Nov-1 signup, Ma. Avril Yeban).
//
// Fix: the referral links also drop a long-lived cookie, and the signup endpoints read it
// back as a server-side fallback when the client forwards nothing usable. A dropped code is
// then recovered rather than lost.

export const REF_COOKIE = "lv_ref";
export const REF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const DIY = "diy";

// Parse lv_ref from a Cookie header (server) or document.cookie (client). Returns the slug
// lowercased + trimmed, or "" when absent. "diy" is treated as absent so it never blocks a
// real referrer from being recovered.
export function refFromCookieHeader(cookieHeader: string | null | undefined): string {
  if (!cookieHeader) return "";
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== REF_COOKIE) continue;
    try {
      const v = decodeURIComponent(part.slice(eq + 1).trim()).trim().toLowerCase();
      return v && v !== DIY ? v : "";
    } catch {
      return "";
    }
  }
  return "";
}

// Client-only: persist the referral slug so it survives tabs and the verify round-trip.
export function writeRefCookie(slug: string | null | undefined) {
  const clean = (slug || "").trim().toLowerCase();
  if (typeof document === "undefined" || !clean || clean === DIY) return;
  try {
    document.cookie = `${REF_COOKIE}=${encodeURIComponent(clean)}; path=/; max-age=${REF_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    /* cookies blocked — sessionStorage/URL still carry it within the tab */
  }
}
