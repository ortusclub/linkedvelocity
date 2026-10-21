import { NextRequest, NextResponse } from "next/server";
import { getOwners, type Owner } from "@/lib/owners";
import { currencyConfigFor, formatMoney } from "@/lib/referral-currency";
import { setupFeeReadyDate } from "@/lib/referrals";

// CSV export of Account Owners for Google Sheets via
// =IMPORTDATA("https://linkedvelocity.com/api/admin/owners/export?key=XXXX").
// Reads getOwners() — the SAME aggregation the admin page uses — so the sheet is a live
// mirror of the admin view, never a hand-kept copy (one source of truth).
//
// Rows are GROUPED by relationship status (Active / Onboarding / Paused / Lost), each
// preceded by a section-header row — matching the design's buckets. Columns are grouped
// left-to-right by the card's sections: Owner → Profiles & credentials → Payout → Payment
// status. IMPORTDATA is position-based, so APPEND new columns at the end; never reorder.
//
// This sheet carries the full per-profile credentials (login email, work email, password,
// 2FA) at Sam's request — it's operational data we hold. Anyone with the tokenised export
// URL can read it, so treat the sheet's sharing settings as sensitive.
export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Amounts follow the owner's referrer currency (PH ₱ / non-PH USD — see referral-currency).

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}


// Relationship buckets — mirror the admin page's ownerStatus() / STATUS_META.
type OwnerStatus = "active" | "onboarding" | "paused" | "lost";
function ownerStatus(s: string | null): OwnerStatus {
  if (s === "onboarded") return "active";
  if (s === "on_hold") return "paused";
  if (s === "rejected" || s === "unreachable") return "lost";
  return "onboarding";
}
const STATUS_LABEL: Record<OwnerStatus, string> = {
  active: "Active", onboarding: "Onboarding", paused: "Paused", lost: "Lost",
};
const SECTIONS: [OwnerStatus, string][] = [
  ["active", "ACTIVE"],
  ["onboarding", "ONBOARDING"],
  ["paused", "PAUSED"],
  ["lost", "LOST"],
];

// Operational completeness (credential fields intentionally NOT counted here).
function missingFields(o: Owner): string[] {
  const m: string[] = [];
  if (!o.paymentMethod) m.push("Payout method");
  if (!o.paymentDetails) m.push("Payout details");
  if (!o.payoutName) m.push("Registered name");
  if (!o.contactNumber) m.push("Best contact");
  o.accounts.forEach((a) => {
    if (!a.linkedinUrl) m.push(`${o.accounts.length > 1 ? `${a.linkedinName}: ` : ""}LinkedIn URL`);
  });
  return m;
}

function setupStatus(o: Owner): string {
  if (o.setupFeePaidAt) return `Paid ${fmtDate(o.setupFeePaidAt)}`;
  const due = setupFeeReadyDate(o.verifiedAt);
  if (!due) return "Not scheduled";
  const overdue = due.getTime() < Date.now();
  return `Due ${fmtDate(due)}${overdue ? " · overdue" : ""}`;
}

function profilesCell(o: Owner): string {
  return o.accounts.map((a) => `${a.linkedinName} (${a.status})`).join("; ");
}
function profileUrlsCell(o: Owner): string {
  return o.accounts.map((a) => a.linkedinUrl).filter(Boolean).join("; ");
}

// Per-profile credential cell. For a single-account owner it's just the value; for
// multi-account owners each value is prefixed with the profile name, one per line,
// so the cell stays readable in the sheet.
function credCell(o: Owner, pick: (a: Owner["accounts"][number]) => string | null): string {
  const multi = o.accounts.length > 1;
  return o.accounts
    .map((a) => {
      const v = pick(a);
      if (!v) return null;
      return multi ? `${a.linkedinName}: ${v}` : v;
    })
    .filter(Boolean)
    .join("\n");
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const expected = process.env.RENTALS_EXPORT_KEY;
  if (!expected || !key || key !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // getOwners() now also returns pre-onboarded pipeline people (accepted / warming up)
  // so the admin page can show them; the Sheet stays a record of real supplied inventory,
  // so keep only owners who actually have a live account.
  const owners = (await getOwners()).filter((o) => o.accountCount > 0);

  const headers = [
    // Owner
    "Owner", "Email", "Best contact", "Relationship", "Onboarded",
    // Profiles & credentials
    "# Profiles", "Profiles", "LinkedIn URLs",
    "Account email (login)", "Work email (klabber.co)", "Password", "2FA / recovery",
    // Payout
    "Registered name", "Monthly payout", "Payout method", "Payout details",
    // Payment status
    "Setup fee", "Monthly payments paid", "Total paid", "Missing fields",
  ];
  const width = headers.length;

  const rowFor = (o: Owner) => {
    const ccfg = currencyConfigFor(o.payoutCurrency, o.referredBy);
    const cur = ccfg.currency;
    const money = (n: number) => formatMoney(n, cur);
    const monthlyOnly = o.monthlyPayouts.filter((p) => p.kind !== "setup");
    const hasSetupRecord = o.monthlyPayouts.some((p) => p.kind === "setup");
    const totalPaid =
      o.monthlyPayouts.reduce((s, p) => s + (Number(p.amount) || 0), 0) +
      (o.setupFeePaidAt && !hasSetupRecord ? o.setupAmount : 0);
    const missing = missingFields(o);
    return [
      // Owner
      o.fullName,
      o.email,
      o.contactNumber || "",
      STATUS_LABEL[ownerStatus(o.applicationStatus)],
      fmtDate(o.onboardedAt) || fmtDate(o.joinedAt),
      // Profiles & credentials
      String(o.accountCount),
      profilesCell(o),
      profileUrlsCell(o),
      credCell(o, (a) => a.loginEmail),
      credCell(o, (a) => a.workEmail),
      credCell(o, (a) => a.accountPassword),
      credCell(o, (a) => a.twoFactor),
      // Payout
      o.payoutName || "",
      o.monthlyPayout > 0 ? `${money(o.monthlyPayout)}/mo` : "TBC",
      o.paymentMethod || "",
      o.paymentDetails || "",
      // Payment status
      setupStatus(o),
      String(monthlyOnly.length),
      totalPaid > 0 ? money(totalPaid) : "",
      missing.length ? missing.join("; ") : "—",
    ];
  };

  const out: string[][] = [headers];
  for (const [status, label] of SECTIONS) {
    const group = owners.filter((o) => ownerStatus(o.applicationStatus) === status);
    if (group.length === 0) continue;
    const section = new Array(width).fill("");
    section[0] = `— ${label} (${group.length}) —`;
    out.push(section);
    for (const o of group) out.push(rowFor(o));
  }

  const csv = out.map((row) => row.map(csvCell).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" },
  });
}
