import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// A separate, Apex-only identity feed. No login credentials, access links,
// proxy details, payment details or other customers are selected or returned.
export async function GET(req: NextRequest) {
  const expected = process.env.SOAPEX_RENTALS_SYNC_KEY?.trim() || "";
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rentals = await prisma.rental.findMany({
    where: { user: { email: { equals: "info@apexstrategy.io", mode: "insensitive" } } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, paused: true, handoverAt: true,
      linkedinAccount: { select: {
        id: true, loginEmail: true, linkedinName: true, linkedinUrl: true,
        hasSalesNav: true, linkedinVerified: true, restrictedAt: true,
        permanentlyRestricted: true,
      } },
    },
  });
  return NextResponse.json({
    schemaVersion: 1, renter: "info@apexstrategy.io", fetchedAt: new Date().toISOString(),
    rentals: rentals.map(r => ({
      rentalId: r.id, accountId: r.linkedinAccount.id,
      email: r.linkedinAccount.loginEmail?.trim().toLowerCase() || "",
      name: r.linkedinAccount.linkedinName, url: r.linkedinAccount.linkedinUrl || "",
      hasSalesNav: r.linkedinAccount.hasSalesNav,
      verified: r.linkedinAccount.linkedinVerified,
      restricted: !!r.linkedinAccount.restrictedAt || r.linkedinAccount.permanentlyRestricted,
      status: r.status, paused: r.paused, beingPrepared: !!r.handoverAt,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
