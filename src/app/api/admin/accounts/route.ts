import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { z } from "zod";
import * as gologin from "@/services/gologin";
import { persistImageUrl } from "@/lib/persist-image";
import { markOwnerOnboardedIfReady } from "@/lib/onboarding";
import { decryptSecret } from "@/lib/crypto-creds";

const createAccountSchema = z.object({
  linkedinName: z.string().min(1),
  linkedinHeadline: z.string().optional(),
  linkedinUrl: z.string().optional(),
  connectionCount: z.number().int().min(0).default(0),
  industry: z.string().optional(),
  location: z.string().optional(),
  profileScreenshotUrl: z.string().optional(),
  profilePhotoUrl: z.string().optional(),
  proxyHost: z.string().optional(),
  proxyPort: z.number().int().optional(),
  proxyUsername: z.string().optional(),
  proxyPassword: z.string().optional(),
  proxyLocation: z.string().optional(),
  accountAgeMonths: z.number().int().optional(),
  hasSalesNav: z.boolean().default(false),
  listed: z.boolean().default(true),
  monthlyPrice: z.number().optional(),
  ambassadorPayment: z.number().optional(),
  notes: z.string().optional(),
  cookies: z.array(z.record(z.string(), z.unknown())).optional(),
  createGologinProfile: z.boolean().default(false),
  gologinShareLink: z.string().optional(),
  status: z.enum(["under_review", "available", "unavailable", "rented", "maintenance", "under_construction", "construction_immature", "retired", "removed"]).default("under_review"),
});

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    } else {
      // By default, exclude removed accounts
      where.status = { in: ["under_review", "available", "rented", "trial", "maintenance", "under_construction", "construction_immature", "unavailable", "retired"] };
    }

    const accounts = await prisma.linkedInAccount.findMany({
      where,
      include: {
        rentals: {
          // "active" = healthy renter; also surface a renter whose charge just
          // failed (payment_failed) so the inventory can show WHO is overdue
          // rather than "no renter on file". Newest first. Shadow rentals
          // are excluded here — they don't occupy the account, and are surfaced
          // separately as `shadowRenter` so an "Available" row still reads Available.
          where: { status: { in: ["active", "payment_failed"] }, isShadow: false },
          include: { user: { select: { id: true, fullName: true, email: true } } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        cryptoPayments: {
          select: { amount: true, paidAt: true },
          orderBy: { paidAt: "desc" },
          take: 100,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Which accounts a shadow renter is currently sitting on. These stay
    // "Available" but the inventory row identifies the shadow renter so the team
    // knows someone's using it even though it's still rentable.
    const shadowRentals = accounts.length
      ? await prisma.rental.findMany({
          where: {
            isShadow: true,
            status: { in: ["active", "pending_access", "payment_failed"] },
            linkedinAccountId: { in: accounts.map((a) => a.id) },
          },
          select: { linkedinAccountId: true, user: { select: { email: true } } },
        })
      : [];
    const shadowByAccount = new Map(shadowRentals.map((r) => [r.linkedinAccountId, r.user.email]));

    // Resolve owner names from notes
    const ownerEmails = accounts
      .map((a) => (a.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, ""))
      .filter(Boolean) as string[];

    const ownerUsers = ownerEmails.length > 0
      ? await prisma.user.findMany({
          where: { email: { in: ownerEmails } },
          select: { email: true, fullName: true },
        })
      : [];

    const ownerMap = new Map(ownerUsers.map((u) => [u.email, u.fullName]));

    // The ambassador's own contact details live on their application, not on the
    // account — pull them so the inventory row can show who to actually contact.
    const ownerApps = ownerEmails.length > 0
      ? await prisma.ambassadorApplication.findMany({
          where: { email: { in: ownerEmails } },
          select: {
            id: true,
            email: true, linkedinUrl: true, fullName: true, contactNumber: true, contactChannel: true,
            referredBy: true, referralSource: true, poc: true, ownerStatus: true, payoutCurrency: true, status: true,
            paymentMethod: true, paymentDetails: true, payoutName: true,
            paypalEmail: true, wiseEmail: true, onboardedAt: true, paidAt: true,
            // Shared outreach/notes tracker: the account view reads/writes the SAME
            // pipeline log (via ownerApplicationId), so both pages stay in sync.
            outreachLog: true, nextFollowUp: true, updatedAt: true,
          },
        })
      : [];
    // One payee (Owner: email) can front MANY accounts, each its own application.
    // Keying only by email collapses those siblings to one arbitrary app, so an
    // account inherits the wrong paidAt/onboarded/contact — e.g. a paid, onboarded
    // ambassador reads as unpaid and drops out of inventory. Match each account to
    // ITS OWN application by LinkedIn URL first (unique per person), and fall back to
    // the email map only when there's no URL to match on (single-owner accounts).
    const normUrl = (u?: string | null) =>
      (u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("?")[0].replace(/\/+$/, "");
    const appMap = new Map(ownerApps.map((x) => [x.email.toLowerCase(), x]));
    const appByUrl = new Map(ownerApps.filter((x) => x.linkedinUrl).map((x) => [normUrl(x.linkedinUrl), x]));

    const referrers = await prisma.referrer.findMany({ select: { slug: true, name: true, email: true, contacts: true, contactMethod: true, contactHandle: true } });
    const refBySlug = new Map(referrers.map(r => [r.slug.toLowerCase(), r]));
    const issueContactFor = (slug?: string | null) => {
      const r = refBySlug.get((slug || "").trim().toLowerCase());
      if (!r) return null;
      const contacts = (Array.isArray(r.contacts) ? r.contacts : []) as Array<{ method?: string; handle?: string; preferred?: boolean }>;
      const byMethod = (method: string) => contacts.find(c => c.preferred && c.method?.toLowerCase() === method)?.handle || contacts.find(c => c.method?.toLowerCase() === method)?.handle || (r.contactMethod?.toLowerCase() === method ? r.contactHandle : null);
      return { email: r.email || byMethod("email"), whatsapp: byMethod("whatsapp"), telegram: byMethod("telegram"), viber: byMethod("viber") };
    };

    const accountsWithOwner = accounts.map((a) => {
      const ownerEmail = (a.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "") || "";
      const app = (a.linkedinUrl ? appByUrl.get(normUrl(a.linkedinUrl)) : undefined)
        || (ownerEmail ? appMap.get(ownerEmail.toLowerCase()) : undefined);
      return {
        ...a,
        accountPassword: decryptSecret(a.accountPassword),
        twoFactor: decryptSecret(a.twoFactor),
        ownerName: ownerMap.get(ownerEmail) || app?.fullName || ownerEmail || null,
        ownerEmail: ownerEmail || null,
        ownerApplicationId: app?.id || null,
        issueReferrerName: refBySlug.get((app?.referredBy || "").trim().toLowerCase())?.name || null,
        issueEmailFrom: process.env.RESEND_FROM_EMAIL || "LinkedVelocity <info@linkedvelocity.com>",
        issueAmbassadorEmail: app?.email || ownerEmail || null,
        issueReferrerContact: issueContactFor(app?.referredBy),
        ownerUpdatedAt: app?.updatedAt ?? null,
        ownerOutreachLog: app?.outreachLog ?? null,
        ownerNextFollowUp: app?.nextFollowUp ?? null,
        ownerPhone: app?.contactNumber || null,
        contactChannel: app?.contactChannel || null,
        ownerReferredBy: app?.referredBy || null,
        ownerPayoutCurrency: app?.payoutCurrency || null,
        ownerReferralSource: app?.referralSource || null,
        // Coalesce: POC lives on the application and (some paths) the account itself.
        ownerPoc: app?.poc || a.poc || null,
        ownerStatus: app?.ownerStatus || null,
        ownerPaymentMethod: app?.paymentMethod || (app?.paypalEmail ? `PayPal: ${app.paypalEmail}` : app?.wiseEmail ? `Wise: ${app.wiseEmail}` : null),
        ownerPaymentDetails: app?.paymentDetails || null,
        ownerPayoutName: app?.payoutName || null,
        ownerOnboardedAt: app?.onboardedAt || null,
        ownerSetupPaidAt: app?.paidAt || null,
        // "Onboarded" = the owner's application was explicitly marked onboarded (which
        // only happens after the setup fee is paid). Drives inventory Pipeline visibility.
        ownerOnboarded: app?.status === "onboarded",
        shadowRenter: shadowByAccount.get(a.id) || null,
      };
    });

    return NextResponse.json({ accounts: accountsWithOwner });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();

    const body = await req.json();
    const data = createAccountSchema.parse(body);

    let gologinProfileId: string | undefined;

    // Create GoLogin profile if requested
    if (data.createGologinProfile) {
      try {
        const profile = await gologin.createProfile({
          name: data.linkedinName,
          proxy:
            data.proxyHost && data.proxyPort
              ? {
                  host: data.proxyHost,
                  port: data.proxyPort,
                  username: data.proxyUsername || undefined,
                  password: data.proxyPassword || undefined,
                }
              : undefined,
        });
        gologinProfileId = profile.id;

        if (data.cookies && gologinProfileId) {
          await gologin.addCookies(gologinProfileId, data.cookies);
        }
      } catch (err) {
        console.error("GoLogin profile creation failed:", err);
      }
    }

    const account = await prisma.linkedInAccount.create({
      data: {
        gologinProfileId,
        linkedinName: data.linkedinName,
        linkedinHeadline: data.linkedinHeadline,
        linkedinUrl: data.linkedinUrl,
        connectionCount: data.connectionCount,
        industry: data.industry,
        location: data.location,
        profileScreenshotUrl: data.profileScreenshotUrl,
        profilePhotoUrl: await persistImageUrl(data.profilePhotoUrl),
        proxyHost: data.proxyHost,
        proxyPort: data.proxyPort,
        proxyUsername: data.proxyUsername,
        proxyPassword: data.proxyPassword,
        proxyLocation: data.proxyLocation,
        accountAgeMonths: data.accountAgeMonths,
        hasSalesNav: data.hasSalesNav,
        monthlyPrice: data.monthlyPrice || 0,
        ambassadorPayment: data.ambassadorPayment || 0,
        notes: data.notes,
        gologinShareLink: data.gologinShareLink,
        status: data.status,
      },
    });

    // If the account is already runnable (created with a GoLogin), mark its owner's
    // application onboarded so a referred signup converts on the Referrals page without
    // a manual status flip. Never blocks account creation.
    try { await markOwnerOnboardedIfReady(account); } catch (e) { console.error("auto-onboard (create) failed:", e); }

    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Create account error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
