import { NextResponse } from "next/server";
import { REF_COOKIE, REF_COOKIE_MAX_AGE } from "@/lib/referral-cookie";

// Short share link for marketers: /r/<slug> -> the ambassador signup form with
// their referral tag attached. Keeps the QR/link short and clean.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dest = new URL(`/become-ambassador?ref=${encodeURIComponent(slug)}`, req.url);
  const res = NextResponse.redirect(dest);
  // Persist the referral code in a long-lived cookie too, so attribution survives a new tab,
  // the DIY email-verification round-trip, or landing straight on /onboarding — otherwise a
  // referred owner who self-onboards silently drops to the "diy" bucket (see referral-cookie.ts).
  const clean = slug.trim().toLowerCase();
  if (clean && clean !== "diy") {
    res.cookies.set(REF_COOKIE, clean, { path: "/", maxAge: REF_COOKIE_MAX_AGE, sameSite: "lax" });
  }
  return res;
}
