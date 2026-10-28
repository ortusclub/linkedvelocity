import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
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
  const expected = (process.env.OUTREACH_ACCOUNTS_KEY || "").trim();
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !given || !keyMatches(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.linkedInAccount.findMany({
    // Campaign-pool accounts are our own LinkedArmy outreach personas — run by hand, never
    // by the maturing/warm-up engine. Keep them out of the engine feed entirely.
    where: { status: { not: "removed" }, linkedinUrl: { not: null }, inventoryPool: { not: "campaign" } },
    select: {
      gologinProfileId: true,
      loginEmail: true,
      linkedinName: true,
      linkedinUrl: true,
      status: true,
      restrictedAt: true,
      notes: true,
      rentals: {
        where: { status: { in: ["active", "pending_access", "payment_failed"] }, isShadow: false },
        select: { id: true },
        take: 1,
      },
    },
  });

  const accounts = rows
    // Showcase/demo accounts are catalogue props, not real LinkedIn profiles.
    .filter((a) => !(a.notes || "").includes("[SHOWCASE]"))
    .filter((a) => a.gologinProfileId || a.loginEmail)
    .map((a) => ({
      gologinProfileId: a.gologinProfileId || "",
      loginEmail: (a.loginEmail || "").trim().toLowerCase(),
      name: a.linkedinName,
      linkedinUrl: a.linkedinUrl,
      // Restricted profiles can still be named, but are no use as invite targets.
      restricted: a.status === "retired" || !!a.restrictedAt,
      // Eligibility only: do not expose renters or rental details to Outreach.
      rented: a.status === "rented" || a.rentals.length > 0,
    }));

  return NextResponse.json({ accounts });
}
