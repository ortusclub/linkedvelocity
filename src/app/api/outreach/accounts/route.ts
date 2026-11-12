import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { categoryResolver, categoriesResolver } from "@/lib/maturing/programs.mjs";
import { prisma } from "@/lib/prisma";

// Read-only identity feed for the Ortus Outreach app: which LinkedIn profile
// sits behind each GoLogin profile. Outreach uses it to name an account it is
// maturing and to build warm-connection target lists.
//
// Deliberately minimal — name, URL and the two identifiers Outreach matches on
// (GoLogin profile id, login email). Never add credentials, proxy or rental
// data here: the key ships inside a desktop app. It has its own secret
// (OUTREACH_ACCOUNTS_KEY) so it can be rotated without touching other feeds.
export const dynamic = "force-dynamic";

function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const reservesOnly = req.nextUrl.searchParams.get("purpose") === "lv-reserves";
  const expected = (reservesOnly ? process.env.MATURING_ENGINE_TOKEN : process.env.OUTREACH_ACCOUNTS_KEY)?.trim() || "";
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !given || !keyMatches(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.linkedInAccount.findMany({
    // Campaign-pool accounts are our own LinkedArmy outreach personas — run by hand, never
    // by the maturing/warm-up engine. Keep them out of the engine feed entirely.
    where: { status: { not: "removed" }, linkedinUrl: { not: null }, inventoryPool: { not: "campaign" } },
    select: {
      id: true,
      inventoryPool: true,
      heldUntil: true,
      permanentlyRestricted: true,
      gologinProfileId: true,
      loginEmail: true,
      linkedinName: true,
      linkedinUrl: true,
      status: true,
      restrictedAt: true,
      notes: true,
      twoFactorResetNeeded: true,
      maturingStartFailedAt: true,
      maturingStartFailedReason: true,
      accountPassword: true, // only reduced to hasPassword below; never sent
      rentals: {
        where: { status: { in: ["active", "pending_access", "payment_failed"] } },
        select: { id: true },
        take: 1,
      },
    },
  });

  const [apps,sessions] = await Promise.all([
    prisma.ambassadorApplication.findMany({select:{id:true,verifiedAt:true,status:true,linkedinUrl:true,email:true,applicationReceived:true,paidAt:true,onboardedAt:true}}),
    prisma.selfServiceOnboarding.findMany({select:{accountId:true,applicationId:true,state:true}}),
  ]);
  const category=categoryResolver(apps,sessions);
  const categories=categoriesResolver(apps,sessions);
  const accounts = rows
    // Showcase/demo accounts are catalogue props, not real LinkedIn profiles.
    .filter((a) => !(a.notes || "").includes("[SHOWCASE]"))
    .filter((a) => a.gologinProfileId || a.loginEmail)
    .map((raw) => ({ ...raw, hasPassword: !!raw.accountPassword, accountPassword: undefined }))
    .map((a) => ({
      // Eligibility only; assignment happens in Outreach when Start is clicked.
      reserveEligible: a.inventoryPool === "main" && a.status === "available"
        && category(a) === "available" && !a.twoFactorResetNeeded
        && !a.restrictedAt && !a.permanentlyRestricted && a.rentals.length === 0
        && (!a.heldUntil || a.heldUntil.getTime() <= Date.now())
        && !!a.gologinProfileId && !!a.loginEmail && a.hasPassword,
      maturingCategory: category(a),
      maturingCategories: categories(a),
      // Why auto-start last failed to launch this account, so the Outreach board can
      // say it under a stopped row (Sam, 2026-11-08). Cleared on a successful start.
      maturingStartFailedAt: a.maturingStartFailedAt || null,
      maturingStartFailedReason: a.maturingStartFailedReason || "",
      gologinProfileId: a.gologinProfileId || "",
      loginEmail: (a.loginEmail || "").trim().toLowerCase(),
      name: a.linkedinName,
      linkedinUrl: a.linkedinUrl,
      // Restricted profiles can still be named, but are no use as invite targets.
      restricted: a.status === "retired" || !!a.restrictedAt || a.permanentlyRestricted,
      // Eligibility only: do not expose renters or rental details to Outreach.
      rented: a.status === "rented" || a.rentals.length > 0,
    }));

  return NextResponse.json({ accounts: reservesOnly ? accounts.filter(a => a.reserveEligible) : accounts });
}
