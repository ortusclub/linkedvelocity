import { monthlyRentalPrice } from "@/lib/account-pricing";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { maskPublicAccount } from "@/lib/mask";
import { SEGREGATED_POOLS } from "@/lib/public-inventory";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const account = await prisma.linkedInAccount.findUnique({
    where: { id },
    select: {
      id: true,
      linkedinName: true,
      linkedinHeadline: true,
      linkedinUrl: true,
      connectionCount: true,
      industry: true,
      location: true,
      profileScreenshotUrl: true,
      profilePhotoUrl: true,
      accountAgeMonths: true,
      hasSalesNav: true,
      linkedinVerified: true,
      monthlyPrice: true,
      status: true,
      notes: true,
      inventoryPool: true,
    },
  });

  // Segregated-pool accounts (Ortus/Apex referrer pools, or our own campaign pool) are not
  // exposed via the public detail endpoint.
  if (!account || SEGREGATED_POOLS.includes(account.inventoryPool)) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  return NextResponse.json({ account: maskPublicAccount({ ...account, monthlyPrice: monthlyRentalPrice(account) }) });
}
