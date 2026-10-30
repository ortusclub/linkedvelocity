import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { paymentStatus, accessStatus } from "@/lib/rental-tracker";
import { monthlyRentalPrice } from "@/lib/account-pricing";

// CSV export of the renter tracker, for Google Sheets to auto-pull via
// =IMPORTDATA("https://linkedvelocity.com/api/admin/rentals/export?key=XXXX").
// Auth is a shared secret in the URL (RENTALS_EXPORT_KEY) because IMPORTDATA
// can't send headers. Keep the key private — anyone with the link sees the data.
export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Escape quotes + wrap if it contains comma/quote/newline.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtDate(d: Date | null): string {
  if (!d) return "";
  // Human-readable (e.g. "Jun 15, 2026") so Sheets shows a real date, not a serial number.
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const expected = process.env.RENTALS_EXPORT_KEY;
  if (!expected || !key || key !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rentals = await prisma.rental.findMany({
    include: {
      user: { select: { id: true, fullName: true, email: true, contactNumber: true, company: true, industry: true } },
      linkedinAccount: { select: { linkedinName: true, linkedinUrl: true, connectionCount: true, accountAgeMonths: true, hasSalesNav: true, linkedinVerified: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Payment method by how the renter funded us (card top-up => Stripe, crypto => USDC).
  const userIds = [...new Set(rentals.map((r) => r.userId))];
  const deposits = userIds.length
    ? await prisma.transaction.findMany({ where: { userId: { in: userIds }, type: "deposit" }, select: { userId: true, description: true } })
    : [];
  const fundingByUser = new Map<string, "Stripe" | "USDC">();
  for (const d of deposits) {
    if ((d.description || "").startsWith("stripe_topup")) fundingByUser.set(d.userId, "Stripe");
    else if (!fundingByUser.has(d.userId)) fundingByUser.set(d.userId, "USDC");
  }
  const payMethod = (r: { userId: string; usdcPayment: boolean }) => fundingByUser.get(r.userId) || (r.usdcPayment ? "USDC" : "Stripe");
  // Customer-friendly label for the sheet: card top-up => "Card", crypto => "Crypto".
  const payType = (r: { userId: string; usdcPayment: boolean }) => (payMethod(r) === "USDC" ? "Crypto" : "Card");

  // Column order mirrors Sam's "Rental Dashboard" sheet so it drops straight in.
  const headers = [
    "LinkedIn Account", "LinkedIn URL", "Number of Connections", "Renter Name",
    "Renter Email", "Renter TG/WA", "Amount", "Payment Status", "Payment Type",
    "Rental Start Period", "Rental Stop Period", "Auto Renew", "LV PoC",
  ];

  const rows = rentals.map((r) => {
    // Amount = the grandfathered locked price if set, otherwise the account's list price.
    const amt = r.lockedPrice != null && Number(r.lockedPrice) > 0
      ? Number(r.lockedPrice)
      : monthlyRentalPrice(r.linkedinAccount);
    return [
      r.linkedinAccount.linkedinName,
      r.linkedinAccount.linkedinUrl || "",
      r.linkedinAccount.connectionCount > 0 ? String(r.linkedinAccount.connectionCount) : "",
      r.user.fullName,
      r.user.email,
      r.user.contactNumber || "",
      amt > 0 ? `$${amt.toFixed(0)}` : "",
      paymentStatus(r),
      payType(r),
      fmtDate(r.startDate),
      fmtDate(r.currentPeriodEnd),
      r.autoRenew ? "Yes" : "No",
      r.lvPoc || "",
    ];
  });

  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
