import { currencyConfigFor } from "@/lib/referral-currency";
import { prisma } from "@/lib/prisma";
import { monthlyRentalPrice } from "@/lib/account-pricing";

// ── Single source of truth for the Account Owners view ──
// Both the admin page (/api/admin/owners) and the Google-Sheets CSV export
// (/api/admin/owners/export) call getOwners(), so the sheet can never drift
// from what the admin sees. Change the shape here and both update together.

export interface OwnerAccount {
  id: string;
  linkedinName: string;
  status: string;
  linkedinUrl: string | null;
  monthlyPrice: unknown;
  ambassadorPayment: unknown;
  loginEmail: string | null;
  personalEmail: string | null;
  accountPassword: string | null;
  twoFactor: string | null;
  workEmail: string | null;
  restrictedAt: Date | string | null;
}

export interface MonthlyPayout {
  paidAt?: string;
  amount?: number;
  kind?: "setup" | "monthly" | null;
  method?: string | null;
  [k: string]: unknown;
}

export interface Owner {
  email: string;
  fullName: string;
  contactNumber: string | null;
  joinedAt: Date | null;
  accountCount: number;
  applicationCount: number;
  applicationStatus: string | null;
  monthlyPayout: number;
  applicationId: string | null;
  paymentMethod: string | null;
  paymentDetails: string | null;
  payoutName: string | null;
  ownerStatus: string | null;
  contactChannel: string | null;
  accountIssue: string | null;
  setupFeePaidAt: Date | null;
  setupAmount: number;
  monthlyPayouts: MonthlyPayout[];
  onboardingStartedAt: Date | null;
  onboardedAt: Date | null;
  verifiedAt: Date | null;
  accountFreshness: string | null;
  referredBy: string | null; // referrer slug — drives payout currency (PH ₱ / non-PH USD)
  payoutCurrency: string | null; // per-owner currency override ("PHP" | "USD"); null = inherit referrer
  accounts: OwnerAccount[];
}

const ACCOUNT_SELECT = {
  id: true,
  linkedinName: true,
  status: true,
  linkedinUrl: true,
  connectionCount: true,
  accountAgeMonths: true,
  hasSalesNav: true,
  linkedinVerified: true,
  ambassadorPayment: true,
  loginEmail: true,
  personalEmail: true,
  accountPassword: true,
  twoFactor: true,
  workEmail: true,
  restrictedAt: true,
} as const;

function toAccount(a: {
  id: string; linkedinName: string; status: string; linkedinUrl: string | null;
  connectionCount: number; accountAgeMonths: number | null; hasSalesNav: boolean; linkedinVerified: boolean;
  ambassadorPayment: unknown;
  loginEmail: string | null; personalEmail: string | null; accountPassword: string | null; twoFactor: string | null; workEmail: string | null;
  restrictedAt: Date | null;
}): OwnerAccount {
  return {
    id: a.id,
    linkedinName: a.linkedinName,
    status: a.status,
    linkedinUrl: a.linkedinUrl,
    // Live grid price (connections × age × verified), not the stored snapshot — stays current.
    monthlyPrice: monthlyRentalPrice(a),
    ambassadorPayment: a.ambassadorPayment,
    loginEmail: a.loginEmail,
    personalEmail: a.personalEmail,
    accountPassword: a.accountPassword,
    twoFactor: a.twoFactor,
    workEmail: a.workEmail,
    restrictedAt: a.restrictedAt,
  };
}

// Returns onboarded account owners (those with at least one live inventory account),
// sorted with the biggest suppliers first — the exact list the admin page renders.
export async function getOwners(): Promise<Owner[]> {
  // Source 1: LinkedIn accounts that name an owner in notes.
  // Exclude removed/retired/under-review so only live inventory shows.
  const accounts = await prisma.linkedInAccount.findMany({
    where: { notes: { contains: "Owner:" }, status: { notIn: ["removed", "retired", "under_review"] } },
    select: { ...ACCOUNT_SELECT, notes: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // Source 2: all ambassador applications (the person side — payout details live here).
  const allApplications = await prisma.ambassadorApplication.findMany({
    select: {
      id: true,
      email: true,
      fullName: true,
      contactNumber: true,
      linkedinUrl: true,
      linkedinEmail: true,
      status: true,
      paymentMethod: true,
      paymentDetails: true,
      payoutName: true,
      ownerStatus: true,
      contactChannel: true,
      accountIssue: true,
      paidAt: true,
      monthlyPayouts: true,
      onboardingStartedAt: true,
      onboardedAt: true,
      verifiedAt: true,
      accountFreshness: true,
      offeredAmount: true,
      referredBy: true,
      payoutCurrency: true,
      diyTier: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const ownerMap = new Map<string, {
    email: string;
    accounts: OwnerAccount[];
    applicationCount: number;
    applicationStatus: string | null;
  }>();

  // Owners from LinkedIn account notes ("Owner: someone@x.com")
  for (const account of accounts) {
    const ownerEmail = (account.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "") || "";
    if (!ownerEmail) continue;
    if (!ownerMap.has(ownerEmail)) {
      ownerMap.set(ownerEmail, { email: ownerEmail, accounts: [], applicationCount: 0, applicationStatus: null });
    }
    ownerMap.get(ownerEmail)!.accounts.push(toAccount(account));
  }

  // Applications contribute owner status + the payout record.
  for (const app of allApplications) {
    if (!ownerMap.has(app.email)) {
      ownerMap.set(app.email, { email: app.email, accounts: [], applicationCount: 0, applicationStatus: null });
    }
    const entry = ownerMap.get(app.email)!;
    entry.applicationCount++;
    if (!entry.applicationStatus || app.status === "onboarded" || app.status === "onboarding" || app.status === "approved") {
      entry.applicationStatus = app.status;
    }
  }

  // The most relevant application per owner (prefer onboarded/approved, else newest).
  const appByEmail = new Map<string, (typeof allApplications)[number]>();
  for (const app of allApplications) {
    const cur = appByEmail.get(app.email);
    if (!cur) { appByEmail.set(app.email, app); continue; }
    const rank = (s: string) => (s === "onboarded" ? 3 : s === "onboarding" ? 2 : s === "approved" ? 1 : 0);
    if (rank(app.status) > rank(cur.status)) appByEmail.set(app.email, app);
  }

  // Match applications to accounts by LinkedIn URL (covers accounts whose notes
  // don't carry an Owner: tag).
  const appsByUrl = new Map<string, string>();
  for (const app of allApplications) {
    if (app.linkedinUrl) {
      appsByUrl.set(app.linkedinUrl, app.email);
      appsByUrl.set(app.linkedinUrl.replace(/\/$/, ""), app.email);
    }
  }

  const allLinkedInAccounts = await prisma.linkedInAccount.findMany({
    where: { status: { notIn: ["removed", "retired", "under_review"] } },
    select: ACCOUNT_SELECT,
  });

  for (const account of allLinkedInAccounts) {
    if (!account.linkedinUrl) continue;
    const ownerEmail = appsByUrl.get(account.linkedinUrl) || appsByUrl.get(account.linkedinUrl.replace(/\/$/, ""));
    if (!ownerEmail) continue;
    if (!ownerMap.has(ownerEmail)) {
      ownerMap.set(ownerEmail, { email: ownerEmail, accounts: [], applicationCount: 0, applicationStatus: null });
    }
    const entry = ownerMap.get(ownerEmail)!;
    if (!entry.accounts.some((a) => a.id === account.id)) {
      entry.accounts.push(toAccount(account));
    }
  }

  // User names / join dates
  const emails = Array.from(ownerMap.keys());
  const users = emails.length > 0
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { email: true, fullName: true, createdAt: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.email, u]));

  const owners: Owner[] = Array.from(ownerMap.entries()).map(([email, data]) => {
    const user = userMap.get(email);
    const app = appByEmail.get(email);
    const monthlyPayout = data.accounts.reduce((sum, a) => sum + Number(a.ambassadorPayment || 0), 0);
    return {
      email,
      fullName: user?.fullName || app?.fullName || email,
      contactNumber: app?.contactNumber || null,
      joinedAt: user?.createdAt || null,
      accountCount: data.accounts.length,
      applicationCount: data.applicationCount,
      applicationStatus: data.applicationStatus,
      monthlyPayout,
      // Payout record (from the application)
      applicationId: app?.id || null,
      paymentMethod: app?.paymentMethod || null,
      paymentDetails: app?.paymentDetails || null,
      payoutName: app?.payoutName || null,
      ownerStatus: app?.ownerStatus || null,
      contactChannel: app?.contactChannel || null,
      accountIssue: app?.accountIssue || null,
      setupFeePaidAt: app?.paidAt || null,
      setupAmount: currencyConfigFor(app?.payoutCurrency, app?.referredBy, app).setupAmount,
      monthlyPayouts: Array.isArray(app?.monthlyPayouts) ? (app!.monthlyPayouts as MonthlyPayout[]) : [],
      onboardingStartedAt: app?.onboardingStartedAt || null,
      onboardedAt: app?.onboardedAt || null,
      verifiedAt: app?.verifiedAt || null,
      accountFreshness: app?.accountFreshness || null,
      referredBy: app?.referredBy || null,
      payoutCurrency: app?.payoutCurrency || null,
      // Contact email always auto-populates from the application form when the account
      // has none of its own: matched to THIS account by LinkedIn URL first (correct for
      // POC-owned multi-account owners), then the owner's own application email. Keeps
      // /admin/owners and the Sheets export filled without anyone typing it in.
      accounts: data.accounts.map((a) => ({
        ...a,
        personalEmail:
          a.personalEmail ||
          (a.linkedinUrl ? appsByUrl.get(a.linkedinUrl) || appsByUrl.get(a.linkedinUrl.replace(/\/$/, "")) : null) ||
          app?.email ||
          null,
      })),
    };
  });

  // Owners in the supply pipeline: anyone with a live inventory account, PLUS people who
  // are accepted or mid-onboarding (warming up) even before an account exists — so the
  // page can show their pre-onboarded stage. Leads still in pending/reviewing/rejected/
  // unreachable (and no account) are not owners yet, so they stay out.
  const pipelineOwners = owners.filter(
    (o) => o.accountCount > 0 || o.applicationStatus === "approved" || o.applicationStatus === "onboarding",
  );
  pipelineOwners.sort((a, b) => b.accountCount - a.accountCount || b.applicationCount - a.applicationCount);

  return pipelineOwners;
}
