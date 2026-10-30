import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto-creds";
import { isCompanyEmail } from "@/lib/company";
import { currencyConfigFor, formatMoney } from "@/lib/referral-currency";
import { monthlyRentalPrice } from "@/lib/account-pricing";

// CSV export of the inventory, for Google Sheets to auto-pull via
// =IMPORTDATA("https://linkedvelocity.com/api/admin/accounts/export?key=XXXX").
// Shares the same secret as the rentals export (RENTALS_EXPORT_KEY). IMPORTDATA
// can't send headers, so auth is a shared key in the URL — keep it private.
//
// Login credentials (login email / password / 2FA / work email) are ONLY emitted
// when a SECOND key is also supplied: &ckey=<CREDENTIALS_EXPORT_KEY>. This keeps
// credential access independently revocable — rotate CREDENTIALS_EXPORT_KEY to cut
// off the credential columns without breaking the rest of the feed.
export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// CSV labels combine current restrictions and maintenance holds.
// Terminal accounts remain separate; database rental status is untouched.
const CONSTRUCTION_MAX = 100;
function displayStatus(a: { status: string; restrictedAt: Date | null; connectionCount?: number | null; twoFactorResetNeeded?: boolean }): string {
  if (a.status === "retired") return "Permanently restricted/Inaccessible";
  if (a.status === "removed") return "Removed";
  if (a.restrictedAt || a.status === "maintenance" || (a.status === "available" && a.twoFactorResetNeeded)) return "Restricted / Maintenance";
  if (a.status === "rented") return "Rented";
  if (a.status === "construction_immature") return "Construction (Immature)";
  if (a.status === "under_construction") return "Pipeline";
  if (a.status === "available") return "Available";
  if (a.status === "trial") return "Trial";
  // under_review / maintenance / unavailable / anything else → split by size
  return (a.connectionCount ?? 0) < CONSTRUCTION_MAX ? "Pipeline" : "Restricted / Maintenance";
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const expected = process.env.RENTALS_EXPORT_KEY;
  if (!expected || !key || key !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Credential columns are gated behind a second, separately-rotatable key.
  // Trim both sides so a stray space/newline in the env var can't break the match.
  const ckey = (req.nextUrl.searchParams.get("ckey") || "").trim();
  const credKey = (process.env.CREDENTIALS_EXPORT_KEY || "").trim();
  const showCreds = credKey.length > 0 && ckey === credKey;

  const allAccounts = await prisma.linkedInAccount.findMany({
    where: { status: { in: ["under_review", "available", "rented", "trial", "maintenance", "under_construction", "construction_immature", "unavailable", "retired"] } },
    include: {
      rentals: {
        where: { status: "active" },
        include: { user: { select: { fullName: true } } },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });
  // Exclude showcase/demo ("Dummy") accounts — they're public-catalogue props, not real inventory.
  const accounts = allAccounts.filter((a) => !(a.notes || "").includes("[SHOWCASE]"));

  // Resolve owner (ambassador) names from the "Owner: email" tag in notes.
  const ownerEmails = accounts
    .map((a) => (a.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, ""))
    .filter(Boolean) as string[];
  const ownerUsers = ownerEmails.length
    ? await prisma.user.findMany({ where: { email: { in: ownerEmails } }, select: { email: true, fullName: true } })
    : [];
  const ownerMap = new Map(ownerUsers.map((u) => [u.email, u.fullName]));
  // Fallback owner names for people who signed up via an application (no User row).
  // Also carry payout currency (per-owner override, else the referrer's currency) so
  // the Ambassador Payout column shows $ vs ₱ correctly — not a hardcoded peso sign.
  const ownerApps = ownerEmails.length
    ? await prisma.ambassadorApplication.findMany({ where: { email: { in: ownerEmails } }, select: { email: true, fullName: true, payoutCurrency: true, referredBy: true } })
    : [];
  const ownerAppMap = new Map(ownerApps.map((a) => [a.email, a.fullName]));
  const ownerCurrencyMap = new Map(ownerApps.map((a) => [a.email, currencyConfigFor(a.payoutCurrency, a.referredBy).currency]));

  // Keep the combined Restricted / Maintenance label together in the export.
  const rankByLabel: Record<string, number> = { Available: 0, Trial: 2, Rented: 3, Pipeline: 4, "Construction (Immature)": 4.5, "Restricted / Maintenance": 5, "Permanently restricted/Inaccessible": 6, Removed: 7 };
  const sorted = accounts.filter(a => displayStatus(a) !== "Pipeline").sort((a, b) => (rankByLabel[displayStatus(a)] ?? 9) - (rankByLabel[displayStatus(b)] ?? 9));

  // Grouped left->right: identity/quality, rental state, money, profile detail, access.
  const headers = [
    "LinkedIn Account", "Headline / Title", "Status", "Verified",
    "Renter", "Rented Until", "Auto Renew",
    "Monthly Price", "Ambassador Payout", "Owner",
    "Location", "Number of Connections", "Account Age", "Sales Navigator", "LinkedIn URL",
    "GoLogin Profile ID", "Shareable Link",
    // Access block, grouped together: their own login email, our klabber work
    // email, then the secrets.
    ...(showCreds ? ["Login Email", "Work Email", "Password", "2FA Key"] : []),
  ];

  const rows = sorted.map((a) => {
    const rental = a.rentals[0];
    const ownerEmail = (a.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "") || "";
    const profileEmail = (a.notes || "").match(/Profile email:\s*(\S+@\S+?\.\S+?)[\s.]/)?.[1];
    // Rented: the locked rate. Otherwise price live from the current grid, never the stored value.
    const price = rental?.lockedPrice != null && Number(rental.lockedPrice) > 0
      ? Number(rental.lockedPrice)
      : monthlyRentalPrice(a);
    const payout = Number(a.ambassadorPayment || 0);
    // Owner: showcase/demo accounts => "Dummy"; our own Ortus accounts => "ORTUS";
    // otherwise the ambassador who supplied it.
    const isShowcase = (a.notes || "").includes("[SHOWCASE]");
    // Company-owned when the OWNER is one of us — or, if no owner is tagged, when
    // the profile itself is on a company domain. A profile with a company *work*
    // email but an external (e.g. gmail) owner is a real ambassador, not ours.
    const isOrtus = isCompanyEmail(ownerEmail) || (!ownerEmail && isCompanyEmail(profileEmail));
    const ownerDisplay = isShowcase ? "Dummy" : isOrtus ? "Ortus" : (ownerMap.get(ownerEmail) || ownerAppMap.get(ownerEmail) || ownerEmail || "");
    return [
      a.linkedinName || profileEmail || "",
      a.linkedinHeadline || "",
      displayStatus(a),
      a.linkedinVerified ? "Yes" : "No",
      rental ? rental.user.fullName : "",
      rental ? fmtDate(rental.currentPeriodEnd) : "",
      rental ? (rental.autoRenew ? "Yes" : "No") : "",
      price > 0 ? `$${price.toFixed(0)}` : "",
      payout > 0 ? formatMoney(payout, ownerCurrencyMap.get(ownerEmail) || "PHP") : "",
      ownerDisplay,
      a.location || "",
      a.connectionCount > 0 ? String(a.connectionCount) : "",
      a.accountAgeMonths ? `${Math.floor(a.accountAgeMonths / 12)}y ${a.accountAgeMonths % 12}m` : "",
      a.hasSalesNav ? "Yes" : "No",
      a.linkedinUrl || "",
      a.gologinProfileId || "",
      a.gologinShareLink || "",
      ...(showCreds
        ? [a.loginEmail || "", a.workEmail || "", decryptSecret(a.accountPassword) || "", decryptSecret(a.twoFactor) || ""]
        : []),
    ];
  });

  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" },
  });
}
