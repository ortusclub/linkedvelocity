import { prisma } from "@/lib/prisma";
import { currencyConfig, currencyConfigFor } from "@/lib/referral-currency";
import { referralCommissionAmount, setupFeeReadyDate } from "@/lib/referrals";
import { createProfile, createPublicShareLink, findProfileByName, getPublicShareLink } from "@/services/gologin";
import { selfServiceInput } from "@/lib/self-service-input";
import { z } from "zod";
import { countryCode } from "@/lib/countries";
import { proxyPurchaseLimits, quoteCheapestStaticProxy, quoteStaticProxy, purchaseStaticProxy, readPurchasedProxy, ProxyPurchaseNotSubmitted, PURCHASE_PROXY_COUNTRIES } from "@/services/proxy-cheap";
import type { Prisma } from "@/generated/prisma/client";
import { availableProxySlots } from "@/lib/onboarding-proxy-pool";
import { emailSetupSummary, requireEmailSetup } from "@/lib/onboarding-email";
import { assertPhoneVerificationToken, phoneVerificationConfigured } from "@/lib/phone-verification";

export class OnboardingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// --- DIY self-onboarding: per-session public token (ambassador drives only their own session) ---
import { randomBytes } from "crypto";

// The hidden system referrer that DIY self-serve sessions attribute to.
export const DIY_REFERRER_SLUG = "diy";

// Mint (once) and return a per-session public token for the given onboarding session.
export async function mintSelfToken(sessionId: string): Promise<string> {
  const existing = await prisma.selfServiceOnboarding.findUnique({ where: { id: sessionId }, select: { publicToken: true } });
  if (existing?.publicToken) return existing.publicToken;
  const token = randomBytes(24).toString("base64url");
  await prisma.selfServiceOnboarding.update({ where: { id: sessionId }, data: { publicToken: token } });
  return token;
}

// Resolve a per-session public token to its session id + owning referrer. Throws if unknown.
// This is the ONLY authorization for the /api/self-onboarding routes, and it scopes every
// action to exactly one session — so a token can never see or touch another person's data.
export async function resolveSelfSession(token: string): Promise<{ sessionId: string; referrerId: string; referrerSlug: string }> {
  const s = token
    ? await prisma.selfServiceOnboarding.findUnique({
        where: { publicToken: token },
        select: { id: true, referrerId: true, referrer: { select: { slug: true, active: true } } },
      })
    : null;
  if (!s || !s.referrer.active) throw new OnboardingError("This onboarding link is not valid.", 404);
  return { sessionId: s.id, referrerId: s.referrerId, referrerSlug: s.referrer.slug };
}

export async function availableProxies(db: Prisma.TransactionClient = prisma) {
  const [proxies, accounts, reservations] = await Promise.all([
    db.proxy.findMany({ orderBy: { createdAt: "asc" } }),
    db.linkedInAccount.findMany({ where: { proxyHost: { not: null }, status: { not: "removed" } }, select: { id: true, proxyHost: true, proxyPort: true, proxyUsername: true, proxyPassword: true, proxyLocation: true } }),
    db.selfServiceOnboarding.findMany({ where: { proxyId: { not: null } }, select: { accountId: true, proxyId: true, proxySlot: true } }),
  ]);
  // Include usable proxies that exist only on account rows, as in the Proxies page.
  for (const a of accounts) {
    if (!a.proxyHost || !a.proxyPort || proxies.some(p => p.host === a.proxyHost && p.port === a.proxyPort)) continue;
    const p = await db.proxy.upsert({ where: { host_port: { host: a.proxyHost, port: a.proxyPort } }, create: { host: a.proxyHost, port: a.proxyPort, username: a.proxyUsername, password: a.proxyPassword, country: a.proxyLocation, status: "active" }, update: {} });
    proxies.push(p);
  }
  return availableProxySlots(proxies, accounts, reservations);
}

const normType = (t: string | null | undefined) => (t || "").toLowerCase().replace(/[\s_-]/g, "");

// Reuse capacity from any provider/type; prefer the account country.
function reusableProxy(slots: Awaited<ReturnType<typeof availableProxies>>, accountCountry: string, verified: boolean) {
  return slots.find(proxy => proxy.country === accountCountry) || slots[0];
}

export async function onboardingCountries() {
  // DIY accounts are unverified at onboarding, so only residential (proxy-cheap)
  // capacity counts toward the countries we can start in right now.
  return [...new Set((await availableProxies()).map((p) => p.country).filter((c): c is string => !!c))].sort();
}

export async function onboardingSummary(id: string, referrerId: string) {
  const s = await prisma.selfServiceOnboarding.findFirst({
    where: { id, referrerId }, include: { account: true, application: true, referrer: true },
  });
  if (!s) throw new OnboardingError("Onboarding not found.", 404);
  const cfg = currencyConfigFor(s.application.payoutCurrency, s.referrer.slug, s.application);
  const emailSetup = await emailSetupSummary(id, referrerId);
  return {
    emailSetup,
    savedDetails: { fullName: s.application.fullName, email: s.email, linkedinUrl: s.linkedinUrl, contactNumber: s.application.contactNumber,
      paymentMethod: s.application.paymentMethod, paymentDetails: s.application.paymentDetails, payoutName: s.application.payoutName,
      bankName: s.application.bankName, bankAccountNumber: s.application.bankAccountNumber, bankRoutingNumber: s.application.bankRoutingNumber },
    diyTier: s.application.diyTier,
    meetingRequested: s.application.onboardingMethod === "team_meeting",
    twoFactorSaved: !!s.account.twoFactor,
    duplicateWarning: s.application.adminNotes?.includes("[Existing account submission]") ? "We have already received an application for this account. You can continue, but this duplicate application will likely be rejected during review." : null,
    id: s.id, name: s.application.fullName, state: s.state, opened: !!s.openedAt,
    country: countryCode(s.account.location),
    proxyAssigned: !!s.proxyId,
    proxyPriceLimit: proxyPurchaseLimits().perProxy,
    // Only a ready, owned session may expose a browser capability. Never expose credentials.
    shareLink: s.state === "ready" && (!emailSetup || emailSetup.primaryConfirmed) ? s.account.gologinShareLink : null,
    confirmedAt: s.confirmedAt,
    accountFreshness: s.application.accountFreshness,
    // The setup fee is due one week after QC (the same clock the pipeline, portal and payouts
    // show). Null until QC passes — so the done screen honestly says "after the check" rather
    // than a made-up date the referrer would repeat to the owner.
    setupDueAt: setupFeeReadyDate(s.application.verifiedAt),
    setupAmount: cfg.offer.setup, monthlyAmount: cfg.offer.monthly,
    // Actual tiered commission for this onboarding (method + verified snapshot), not a flat double.
    commission: `${cfg.symbol}${referralCommissionAmount({ status: s.application.status, referralSource: s.application.referralSource, onboardingMethod: s.application.onboardingMethod, onboardingVerified: s.application.onboardingVerified }, cfg.referralTiers).toLocaleString("en-US")}`,
    verified: !!(s.application.onboardingVerified ?? s.account.linkedinVerified),
  };
}

export async function reserveOnboarding(referrer: { id: string; slug: string; name: string; type?: string }, input: z.infer<typeof selfServiceInput>, submittedByUserId?: string, options: { publicOwner?: boolean } = {}) {
  if (!options.publicOwner && phoneVerificationConfigured()) assertPhoneVerificationToken(input.phoneVerificationToken, input.contactNumber, referrer.id);
  const cfg = currencyConfig(referrer.slug);
  const country = countryCode(input.country);
  if (!country) throw new OnboardingError("Choose a valid country.");
  if (!cfg.payoutMethods.includes(input.paymentMethod)) throw new OnboardingError("Choose a supported payout method.");
  // Short database-only transaction; external provisioning happens after commit.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(69100901)`;
    // Retrying your own unfinished submission resumes it; a different submission
    // gets isolated application/account/session records, never someone else's access.
    if (options.publicOwner && submittedByUserId) {
      const ownSession = await tx.selfServiceOnboarding.findFirst({ where: {
        referrerId: referrer.id, email: input.email, linkedinUrl: input.linkedinUrl,
        state: { in: ["reserved", "needs_help", "ready", "handed_off"] },
        application: { submittedByUserId },
      }, orderBy: { createdAt: "desc" } });
      if (ownSession) return ownSession.id;
    }
    const existing = await tx.selfServiceOnboarding.findFirst({ where: { OR: [{ email: input.email }, { linkedinUrl: input.linkedinUrl }] } });
    if (existing && !options.publicOwner) {
      if (existing.referrerId !== referrer.id || existing.email !== input.email || existing.linkedinUrl !== input.linkedinUrl) {
        throw new OnboardingError("This person already has onboarding in progress. Contact the team to locate it.", 409);
      }
      return existing.id;
    }
    // Take ONLY the profile slug — strip any ?utm=… query, #fragment or trailing path, so the
    // duplicate check below matches an existing record even when a mobile share link carries
    // junk the stored URL doesn't (otherwise a repeat onboarding slips through and duplicates).
    const urlSlug = input.linkedinUrl.split("/in/")[1]?.split(/[?#/]/)[0];
    const [application, account] = await Promise.all([
      tx.ambassadorApplication.findFirst({ where: { OR: [{ email: { equals: input.email, mode: "insensitive" } }, { linkedinUrl: { contains: `/in/${urlSlug}`, mode: "insensitive" } }] }, select: { id: true, status: true } }),
      tx.linkedInAccount.findFirst({ where: { OR: [{ personalEmail: { equals: input.email, mode: "insensitive" } }, { loginEmail: { equals: input.email, mode: "insensitive" } }, { linkedinUrl: { contains: `/in/${urlSlug}`, mode: "insensitive" } }] }, select: { id: true, status: true } }),
    ]);
    // Team/referrer-initiated onboarding: any prior record blocks (as before). A public owner
    // self-serving is normally let through (flagged, not blocked) so a first-time owner isn't
    // turned away. But if the profile is ALREADY ESTABLISHED — an onboarded application or a
    // live (non-removed) inventory account — a repeat self-signup is never legitimate: it only
    // creates a phantom duplicate that splits the person across two applications and breaks
    // owner/payout matching (a real payout row then vanishes when a hold is released). Block it.
    const established = application?.status === "onboarded" || (!!account && account.status !== "removed");
    if ((!options.publicOwner && (application || account)) || (options.publicOwner && established)) {
      throw new OnboardingError("This person is already in our system. Ask the team to continue their existing onboarding.", 409);
    }
    // Reuse existing capacity before purchasing a new proxy.
    const proxy = reusableProxy(await availableProxies(tx), country, input.linkedinVerified);
    if (!proxy && !proxyPurchaseLimits().enabled) throw new OnboardingError("No dedicated proxy is available for this country yet. Ask the team to add one, then try again.", 409);
    const now = new Date();
    const app = await tx.ambassadorApplication.create({ data: {
      submittedByUserId: submittedByUserId ?? null,
      fullName: input.fullName, email: input.email, linkedinEmail: input.email,
      linkedinUrl: input.linkedinUrl, location: country, contactNumber: input.contactNumber,
      accountFreshness: input.accountFreshness, paymentMethod: input.paymentMethod,
      paymentDetails: input.paymentDetails, payoutName: input.payoutName,
      bankName: input.bankName || null, bankAccountNumber: input.bankAccountNumber || null,
      bankRoutingNumber: input.bankRoutingNumber || null,
      // LV PoC is the internal handler (Ardi / Sam), NOT the referrer. Ortus-referred
      // owners are handled by Ton; everyone else is left Unassigned for an LV handler to
      // pick up. The referrer is tracked via referredBy, so nothing is lost.
      referredBy: referrer.slug, referralSource: "self-service", ...(referrer.type === "ortus" ? { poc: "Ton" } : {}),
      status: "onboarding", ownerStatus: "onboarding", onboardingStartedAt: now,
      payoutCurrency: cfg.currency, offeredAmount: cfg.monthlyAmount,
      adminNotes: `${options.publicOwner && (application || account || existing) ? "[Existing account submission] We have already received an application for this account. This duplicate application will likely be rejected during review. Review before activation or payout. " + (application ? `Existing application: ${application.id}. ` : "") + (account ? `Existing inventory account: ${account.id}. ` : "") : ""}Self-service onboarding; owner consent and LinkedIn minimum-age confirmation (16, or older where local law requires) recorded ${now.toISOString()}. Login not yet confirmed.${input.hasGovernmentId ? " Owner confirmed they have a physical government ID." : " Owner did NOT confirm a physical government ID."}${input.nameMatchesId ? " Name confirmed to match their ID." : ""}${input.ownerPhotoUrl ? ` Owner photo: ${input.ownerPhotoUrl}` : ""}`,
    } });
    const acc = await tx.linkedInAccount.create({ data: {
      linkedinName: input.fullName, linkedinUrl: input.linkedinUrl, personalEmail: input.email,
      location: country, gologinAccount: "klabber", status: "under_construction", listed: false,
      // Ortus/Apex referrers' onboards land in their segregated pool (hidden from the
      // public catalogue, auto-owned by their pool account); everyone else is "main".
      inventoryPool: referrer.type === "ortus" ? "ortus" : referrer.type === "apex" ? "apex" : "main",
      linkedinVerified: input.linkedinVerified,
      ambassadorPayment: cfg.monthlyAmount,
      proxyHost: proxy?.host, proxyPort: proxy?.port, proxyUsername: proxy?.username, proxyPassword: proxy?.password, proxyLocation: proxy?.country,
      notes: `Owner: ${input.email}\nSelf-service onboarding via ${referrer.slug}. Awaiting owner login confirmation.`,
    } });
    const session = await tx.selfServiceOnboarding.create({ data: {
      referrerId: referrer.id, applicationId: app.id, accountId: acc.id,
      proxyId: proxy?.id, proxySlot: proxy?.slot, email: input.email, linkedinUrl: input.linkedinUrl, consentAt: now,
    } });
    return session.id;
  }, { timeout: 15000 });
}

// A referrer who originally only took a FORM signup can switch to running the guided
// onboarding themselves (it pays more). Starting the normal wizard would re-enter the same
// person and be REJECTED by the duplicate guard in reserveOnboarding, so instead we ADOPT
// their existing application: reuse it (and its account if any), move it onto the
// self-service track, acquire a proxy, and create the onboarding session around it — mirroring
// reserveOnboarding's provisioning. Idempotent: re-adopting returns the existing session.
export async function adoptOnboarding(referrer: { id: string; slug: string; name: string; type?: string }, applicationId: string) {
  const cfg = currencyConfig(referrer.slug);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(69100901)`;
    const app = await tx.ambassadorApplication.findUnique({ where: { id: applicationId } });
    if (!app || (app.referredBy || "").trim() !== referrer.slug) throw new OnboardingError("We couldn't find that signup.", 404);
    if (app.status === "onboarded" || app.paidAt) throw new OnboardingError("This account is already onboarded.", 409);
    if (!app.email || !app.linkedinUrl) throw new OnboardingError("This signup is missing an email or LinkedIn URL — add it before onboarding.", 409);
    // Idempotent: if this application already has a session, resume it instead of duplicating.
    const existing = await tx.selfServiceOnboarding.findFirst({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" } });
    if (existing) return existing.id;
    const country = countryCode(app.location) || "PH";
    const urlSlug = app.linkedinUrl.split("/in/")[1]?.split(/[?#/]/)[0];
    // Reuse an inventory account already tied to this person; else create one (form signups
    // usually have none yet).
    const existingAcc = await tx.linkedInAccount.findFirst({ where: {
      status: { notIn: ["removed", "retired"] },
      OR: [
        { personalEmail: { equals: app.email, mode: "insensitive" } },
        { loginEmail: { equals: app.email, mode: "insensitive" } },
        ...(urlSlug ? [{ linkedinUrl: { contains: `/in/${urlSlug}`, mode: "insensitive" as const } }] : []),
      ],
    } });
    const proxy = reusableProxy(await availableProxies(tx), country, existingAcc?.linkedinVerified ?? false);
    if (!proxy && !proxyPurchaseLimits().enabled) throw new OnboardingError("No dedicated proxy is available for this country yet. Ask the team to add one, then try again.", 409);
    const now = new Date();
    const acc = existingAcc ?? await tx.linkedInAccount.create({ data: {
      linkedinName: app.fullName, linkedinUrl: app.linkedinUrl, personalEmail: app.email,
      location: country, gologinAccount: "klabber", status: "under_construction", listed: false,
      inventoryPool: referrer.type === "ortus" ? "ortus" : referrer.type === "apex" ? "apex" : "main",
      linkedinVerified: false, ambassadorPayment: cfg.monthlyAmount,
      proxyHost: proxy?.host, proxyPort: proxy?.port, proxyUsername: proxy?.username, proxyPassword: proxy?.password, proxyLocation: proxy?.country,
      notes: `Owner: ${app.email}\nSelf-service onboarding via ${referrer.slug} (switched from form). Awaiting owner login confirmation.`,
    } });
    if (existingAcc && proxy && !existingAcc.proxyHost) {
      await tx.linkedInAccount.update({ where: { id: existingAcc.id }, data: { proxyHost: proxy.host, proxyPort: proxy.port, proxyUsername: proxy.username, proxyPassword: proxy.password, proxyLocation: proxy.country } });
    }
    // Move the form application onto the guided/self-service track so the portal shows it as
    // "Guided" with a Resume link and the DIY payout tier applies.
    await tx.ambassadorApplication.update({ where: { id: app.id }, data: {
      referralSource: "self-service", status: "onboarding", ownerStatus: "onboarding",
      onboardingStartedAt: app.onboardingStartedAt ?? now,
    } });
    const session = await tx.selfServiceOnboarding.create({ data: {
      referrerId: referrer.id, applicationId: app.id, accountId: acc.id,
      proxyId: proxy?.id, proxySlot: proxy?.slot, email: app.email, linkedinUrl: app.linkedinUrl, consentAt: now,
    } });
    return session.id;
  }, { timeout: 15000 });
}

// Called under the allocation lock, including immediately before reserving a purchase.
async function reuseProxy(tx: Prisma.TransactionClient, id: string, referrerId: string, country: string) {
  const current = await tx.selfServiceOnboarding.findFirstOrThrow({ where: { id, referrerId }, include: { account: { select: { linkedinVerified: true } } } });
  if (current.proxyId) return true;
  // Reuse is safe in any state as long as no purchase is mid-flight — an account
  // can reach a later state (e.g. handed_off) without ever getting a proxy, and
  // must still be able to claim free pool capacity. The reserved-only gate stays
  // on the PURCHASE path (the double-buy guard), not here.
  if (current.proxyPurchaseAt || current.proxyOrderId) return false;
  const proxy = reusableProxy(await availableProxies(tx), country, current.account.linkedinVerified);
  if (!proxy) return false;
  await tx.linkedInAccount.update({ where: { id: current.accountId }, data: {
    proxyHost: proxy.host, proxyPort: proxy.port, proxyUsername: proxy.username,
    proxyPassword: proxy.password, proxyLocation: proxy.country,
  } });
  await tx.selfServiceOnboarding.update({ where: { id }, data: { proxyId: proxy.id, proxySlot: proxy.slot } });
  return true;
}

export async function acquireProxy(id: string, referrerId: string): Promise<boolean> {
  const s = await prisma.selfServiceOnboarding.findFirstOrThrow({ where: { id, referrerId }, include: { account: true } });
  if (s.proxyId) return true;
  const country = countryCode(s.account.location);
  if (!country) throw new OnboardingError("The account country needs a team check.", 409);
  let proxyCountry = countryCode(s.account.proxyLocation);
  let orderId = s.proxyOrderId;
  if (!orderId) {
    // Try free pool capacity first, in any state — a handed_off (or otherwise
    // advanced) account with no proxy must still be able to claim one.
    const reused = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(69100901)`;
      return reuseProxy(tx, id, referrerId, country);
    });
    if (reused) return true;
    // Only a clean "reserved" session may kick off a paid purchase (double-buy guard).
    if (s.state !== "reserved") throw new OnboardingError("The proxy purchase is running or needs a team check. Your progress is saved.", 409);
    let quote;
    try {
      quote = PURCHASE_PROXY_COUNTRIES.includes(country as typeof PURCHASE_PROXY_COUNTRIES[number])
        ? await quoteStaticProxy(country)
        : await quoteCheapestStaticProxy();
      proxyCountry = quote.order.country;
    } catch (e) {
      throw new OnboardingError(e instanceof Error && !(e instanceof z.ZodError) ? e.message : "Could not check proxy availability. Please try again.", 409);
    }
    const limits = proxyPurchaseLimits();
    const reusedBeforePurchase = await prisma.$transaction(async (tx) => {
      // Serialize budget reservations across all referrers; include unresolved orders.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(69100901)`;
      if (await reuseProxy(tx, id, referrerId, country)) return true;
      const now = new Date();
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const spent = await tx.selfServiceOnboarding.aggregate({ where: { OR: [
        { proxyPurchaseAt: { gte: month } },
        { proxyBudgetReserved: { not: null }, state: { in: ["purchasing", "purchase_unknown", "proxy_pending"] } },
      ] }, _sum: { proxyBudgetReserved: true } });
      const manual = await tx.$queryRaw<Array<{ total: number }>>`SELECT COALESCE(SUM(amount),0)::float AS total FROM proxy_purchase_attempts WHERE created_at >= ${month} OR state IN ('purchasing','unknown','pending')`;
      if (limits.monthly !== null && Math.round((Number(spent._sum.proxyBudgetReserved || 0) + Number(manual[0]?.total || 0) + quote.price) * 100) > Math.round(limits.monthly * 100)) throw new OnboardingError("The monthly proxy purchase budget has been reached. Ask the team for help.", 409);
      const claim = await tx.selfServiceOnboarding.updateMany({ where: { id, referrerId, state: "reserved", proxyId: null, proxyOrderId: null, proxyPurchaseAt: null }, data: { state: "purchasing", proxyBudgetReserved: quote.price, proxyPurchaseAt: now } });
      if (!claim.count) throw new OnboardingError("This proxy purchase is already in progress. Refresh to check it.", 409);
      await tx.linkedInAccount.update({ where: { id: s.accountId }, data: { proxyLocation: quote.order.country } });
      return false;
    });
    if (reusedBeforePurchase) return true;
    try {
      const order = await purchaseStaticProxy(quote);
      await prisma.selfServiceOnboarding.update({ where: { id }, data: { proxyOrderId: order.id, proxyBudgetReserved: order.totalPrice, state: "proxy_pending" } });
      orderId = order.id;
    } catch (error) {
      if (error instanceof ProxyPurchaseNotSubmitted) {
        await prisma.selfServiceOnboarding.update({ where: { id }, data: { state: "reserved", proxyBudgetReserved: null, proxyPurchaseAt: null } });
        throw new OnboardingError(error.message, 409);
      }
      // Never retry a charge whose outcome is uncertain, even on a future request.
      await prisma.selfServiceOnboarding.update({ where: { id }, data: { state: "purchase_unknown" } });
      throw new OnboardingError("The proxy order needs a team check. No second purchase will be attempted.", 502);
    }
  }
  proxyCountry ||= PURCHASE_PROXY_COUNTRIES.includes(country as typeof PURCHASE_PROXY_COUNTRIES[number]) ? country : null;
  if (!proxyCountry || !PURCHASE_PROXY_COUNTRIES.includes(proxyCountry as typeof PURCHASE_PROXY_COUNTRIES[number])) {
    throw new OnboardingError("The proxy order country needs a team check.", 409);
  }
  let connection;
  try { connection = await readPurchasedProxy(orderId, proxyCountry); } catch {
    throw new OnboardingError("The purchased proxy is not ready to use. Refresh its delivery status or ask the team to check the saved order.", 502);
  }
  if (!connection) return false;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(69100901)`;
    const current = await tx.selfServiceOnboarding.findUniqueOrThrow({ where: { id } });
    if (current.proxyId) return;
    const proxy = await tx.proxy.upsert({ where: { host_port: { host: connection.host, port: connection.port } },
      create: { ...connection, country: proxyCountry, type: "residential", provider: "proxy-cheap", status: "active", notes: `Dedicated static residential IPv4; order ${orderId}; auto-renew disabled.` },
      update: { ...connection, country: proxyCountry, type: "residential", provider: "proxy-cheap", status: "active" },
    });
    const [linked, reservations] = await Promise.all([
      tx.linkedInAccount.findMany({ where: { proxyHost: connection.host, proxyPort: connection.port, status: { not: "removed" } }, select: { id: true } }),
      tx.selfServiceOnboarding.findMany({ where: { proxyId: proxy.id }, select: { accountId: true, proxySlot: true } }),
    ]);
    const used = new Set([...linked.map((account) => account.id), ...reservations.map((reservation) => reservation.accountId)]);
    if (used.size >= 4) throw new OnboardingError("The delivered proxy has reached its four-account limit. The team needs to check this order.", 409);
    const slot = [1, 2, 3, 4].find((candidate) => !reservations.some((reservation) => reservation.proxySlot === candidate));
    if (!slot) throw new OnboardingError("The delivered proxy has no available account slot. The team needs to check this order.", 409);
    await tx.linkedInAccount.update({ where: { id: s.accountId }, data: { proxyHost: connection.host, proxyPort: connection.port, proxyUsername: connection.username, proxyPassword: connection.password, proxyLocation: proxyCountry } });
    await tx.selfServiceOnboarding.update({ where: { id }, data: { proxyId: proxy.id, proxySlot: slot, state: "reserved" } });
  });
  return true;
}

export async function prepareOnboarding(id: string, referrerId: string) {
  await requireEmailSetup(id, referrerId);
  const token = process.env.GOLOGIN_API_TOKEN_KLABBER;
  if (!token) throw new OnboardingError("Browser setup is not configured yet. Please contact the team.", 503);
  const owned = await prisma.selfServiceOnboarding.findFirst({ where: { id, referrerId }, select: { id: true } });
  if (!owned) throw new OnboardingError("Onboarding not found.", 404);
  if (!await acquireProxy(id, referrerId)) return;
  const s = await prisma.selfServiceOnboarding.findFirst({ where: { id, referrerId }, include: { account: true, emailSetup: true } });
  if (!s) throw new OnboardingError("Onboarding not found.", 404);
  if (["ready", "confirmed"].includes(s.state)) return;
  if (s.state === "creating") {
    throw new OnboardingError("Browser setup is still running or needs the team to check it. Your progress is saved; do not start a second signup.", 409);
  }
  let profileId = s.account.gologinProfileId;
  const issuedProfileName = s.emailSetup?.address || `onboarding-${id}`;
  if (s.state === "needs_help" && !profileId) {
    // A timed-out create can succeed upstream before our database receives the id.
    // Recover that exact named profile first; only create again when GoLogin confirms
    // that no such profile exists.
    const recovered = await findProfileByName(issuedProfileName, token);
    if (recovered) {
      await prisma.$transaction([
        prisma.linkedInAccount.update({ where: { id: s.accountId }, data: { gologinProfileId: recovered.id } }),
        prisma.selfServiceOnboarding.update({ where: { id }, data: { state: "link_pending" } }),
      ]);
      profileId = recovered.id;
    } else {
      await prisma.selfServiceOnboarding.update({ where: { id }, data: { state: "reserved" } });
    }
  }
  const claim = await prisma.selfServiceOnboarding.updateMany({ where: { id, referrerId, state: { in: ["reserved", "link_pending"] } }, data: { state: "creating" } });
  if (!claim.count) throw new OnboardingError("Setup is already in progress. Refresh to check it.", 409);
  // New profiles use the immutable issued address. Existing profiles retain their
  // real upstream name when recreating a share link (including legacy names).
  let profileName: string | undefined;
  try {
    if (!profileId) {
      profileName = issuedProfileName;
      const profile = await createProfile({
        name: profileName,
        proxy: { host: s.account.proxyHost!, port: s.account.proxyPort!, username: s.account.proxyUsername || undefined, password: s.account.proxyPassword || undefined },
      }, token);
      if (!profile || typeof profile.id !== "string") throw new Error("Missing profile id");
      // Persist before attempting the share link, so link retries reuse the profile.
      await prisma.linkedInAccount.update({ where: { id: s.accountId }, data: { gologinProfileId: profile.id } });
      profileId = profile.id;
    }
    const link = await getPublicShareLink(profileId!, profileName, token) || await createPublicShareLink(profileId!, profileName, token);
    await prisma.$transaction([
      prisma.linkedInAccount.update({ where: { id: s.accountId }, data: { gologinShareLink: link.publicUrl } }),
      prisma.selfServiceOnboarding.update({ where: { id }, data: { state: "ready" } }),
    ]);
  } catch (error) {
    console.error("Self-service GoLogin setup failed", {
      sessionId: id,
      phase: profileId ? "share-link" : "profile-create",
      message: error instanceof Error ? error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500) : "Unknown error",
    });
    // A timed-out create may have succeeded upstream. Never blindly create twice.
    await prisma.selfServiceOnboarding.update({ where: { id }, data: { state: profileId ? "link_pending" : "needs_help" } });
    throw new OnboardingError(profileId ? "Your browser is saved, but its launch link is not ready. Please retry." : "The browser could not be prepared. Please try again.", 502);
  }
}

// The pool account that owns everything in each segregated inventory pool.
const POOL_OWNER_EMAIL: Record<string, string> = {
  ortus: "info@ortus.solutions",
  apex: "info@apexstrategy.io",
};

// Give a pool's owner account (e.g. info@ortus.solutions / info@apexstrategy.io) a standing
// $0 "owned" rental of one of its accounts, so it reads as rented on their dashboard the
// moment it's onboarded. Idempotent and best-effort (never blocks onboarding): if the pool
// is unknown or the owner user doesn't exist yet, we simply skip.
export async function ensurePoolOwnership(tx: Prisma.TransactionClient, accountId: string, pool: string) {
  const ownerEmail = POOL_OWNER_EMAIL[pool];
  if (!ownerEmail) return;
  const owner = await tx.user.findFirst({
    where: { email: { equals: ownerEmail, mode: "insensitive" } },
    select: { id: true },
  });
  if (!owner) return;
  const existing = await tx.rental.findFirst({
    where: { linkedinAccountId: accountId, userId: owner.id, status: { in: ["active", "pending_access"] } },
    select: { id: true },
  });
  if (existing) return;
  await tx.rental.create({ data: {
    userId: owner.id,
    linkedinAccountId: accountId,
    status: "active",
    isShadow: false,
    autoRenew: false,
    lockedPrice: 0,
    startDate: new Date(),
    notes: `${pool[0].toUpperCase()}${pool.slice(1)} inventory — auto-owned ($0) via a ${pool} referrer.`,
  } });
}

export async function confirmOnboarding(id: string, referrerId: string, creds?: { password?: string; twoFactorKey?: string }) {
  await requireEmailSetup(id, referrerId);
  // The PC flow also captures the login here so LinkedVelocity always holds the
  // credentials (same as the phone hand-off) instead of only a signed-in session.
  const hasPassword = !!creds?.password;
  const has2fa = !!creds?.twoFactorKey;
  await prisma.$transaction(async (tx) => {
    const claim = await tx.selfServiceOnboarding.updateMany({ where: { id, referrerId, state: "ready", openedAt: { not: null } }, data: { state: "confirmed", confirmedAt: new Date() } });
    const s = await tx.selfServiceOnboarding.findFirst({ where: { id, referrerId } });
    if (!s) throw new OnboardingError("Onboarding not found.", 404);
    if (!claim.count) {
      if (s.state === "confirmed") return;
      throw new OnboardingError("Open the prepared browser and finish signing into LinkedIn first.", 409);
    }
    const acc = await tx.linkedInAccount.findUniqueOrThrow({ where: { id: s.accountId } });
    if (!acc.gologinProfileId || !acc.gologinShareLink || acc.restrictedAt || acc.status !== "under_construction") {
      throw new OnboardingError("The team needs to check this account before it can be completed.", 409);
    }
    await tx.ambassadorApplication.update({ where: { id: s.applicationId }, data: {
      // A referrer's self-reported PC sign-in is NOT trusted as "onboarded". There's no way to
      // confirm from the self-report that the login actually took (the GoLogin exists either way
      // because it's auto-provisioned), so the account sits at "approved" — GoLogin ready, login
      // reported — until a human opens the profile and confirms it's genuinely signed in. Crucially
      // onboardedAt is NOT stamped here (the team stamps it when they mark it logged in), so the
      // row does not jump to Level 5 / Onboarded and the referral does not count as a conversion
      // or become payable off an unverified self-report.
      status: "approved", ownerStatus: "onboarding",
      onboardingMethod: "computer", // referrer did the guided sign-in themselves
      onboardingVerified: acc.linkedinVerified, // snapshot: commission locks to this, not later verification
      // Payment and conversion stay blocked until an admin opens the GoLogin and confirms the sign-in.
      accountIssue: "Self-service login reported by referrer — open the GoLogin and confirm the account is actually signed in before marking it logged in.",
      adminNotes: `Self-service login reported by referrer at ${s.confirmedAt!.toISOString()}. Open the GoLogin profile, confirm it's signed into LinkedIn, mark it logged in, then QC and confirm ok to pay.${hasPassword ? " Password saved." : " Password NOT captured."}${has2fa ? " 2FA key saved." : ""}`,
    } });
    // Keep inventory unlisted and in construction until the usual admin review.
    await tx.linkedInAccount.update({ where: { id: s.accountId }, data: {
      ...(hasPassword ? { accountPassword: creds!.password! } : {}),
      ...(has2fa ? { twoFactor: creds!.twoFactorKey! } : {}),
      notes: `${acc.notes || ""}\nLogin reported successful ${s.confirmedAt!.toISOString()}; awaiting team verification.${hasPassword ? " Password saved." : ""}${has2fa ? " 2FA key saved." : ""}`,
    } });
    // Pooled (Ortus/Apex) accounts are auto-owned by their pool account on onboard.
    if (acc.inventoryPool === "ortus" || acc.inventoryPool === "apex") await ensurePoolOwnership(tx, s.accountId, acc.inventoryPool);
    // Onboarded now — purge any captured LinkedIn code so it's never retrievable post-onboarding.
    await tx.onboardingEmailSetup.updateMany({ where: { sessionId: s.id }, data: { lastCode: null, lastCodeAt: null } });
  });
}

// Phone hand-off: the referrer has no PC, so the owner shares the login and we do the
// GoLogin sign-in. We store the credentials on the account and flag it for the team.
// Save the account's authenticator 2FA key as soon as the referrer sets it up (the 2FA
// step, before sign-in), so it's recorded even if the onboarding stalls before sign-in.
// Idempotent; safe to call repeatedly as they type/continue.
export async function saveTwoFactorKey(id: string, referrerId: string, twoFactorKey: string) {
  const key = twoFactorKey.trim();
  if (!key) return;
  const s = await prisma.selfServiceOnboarding.findFirst({ where: { id, referrerId }, include: { account: { select: { id: true, twoFactor: true, notes: true } } } });
  if (!s) throw new OnboardingError("Onboarding not found.", 404);
  if (s.account.twoFactor === key) return;
  await prisma.linkedInAccount.update({ where: { id: s.accountId }, data: {
    twoFactor: key,
    notes: s.account.twoFactor ? s.account.notes || undefined : `${s.account.notes || ""}\n2FA key saved by referrer ${new Date().toISOString()}.`,
  } });
}

export async function handoffOnboarding(id: string, referrerId: string, input: { password: string; twoFactorKey: string }) {
  const s = await prisma.selfServiceOnboarding.findFirst({ where: { id, referrerId }, include: { account: true, application: true } });
  if (!s) throw new OnboardingError("Onboarding not found.", 404);
  if (s.state === "confirmed") throw new OnboardingError("This onboarding is already complete.", 409);
  const now = new Date();
  const has2fa = !!input.twoFactorKey;
  await prisma.$transaction(async (tx) => {
    await tx.linkedInAccount.update({ where: { id: s.accountId }, data: {
      accountPassword: input.password,
      ...(has2fa ? { twoFactor: input.twoFactorKey } : {}),
      notes: `${s.account.notes || ""}\nPHONE HAND-OFF ${now.toISOString()}: referrer has no PC. LV to create the proxy + GoLogin profile and sign in. Password saved.${has2fa ? " 2FA key saved." : " 2FA still needs to be set up by the team."}`,
    } });
    // Distinct from "needs_help" (a failed browser prep) so the admin can tell a
    // phone hand-off awaiting our sign-in apart from a prep that needs a retry.
    await tx.selfServiceOnboarding.update({ where: { id }, data: { state: "handed_off" } });
    await tx.ambassadorApplication.update({ where: { id: s.applicationId }, data: {
      onboardingMethod: "phone", // referrer chased it; LV does the sign-in
      onboardingVerified: s.account.linkedinVerified, // snapshot at onboarding; commission locks to this
      adminNotes: `${s.application.adminNotes || ""}\nPHONE HAND-OFF ${now.toISOString()}: owner on a phone. LV to complete the GoLogin sign-in; login saved on the account.${has2fa ? " 2FA key provided." : " 2FA NOT provided — team to set it up."}`,
    } });
  });
}

// Referrer asks the team to arrange a call; this is not a completed sign-in.
export async function requestOnboardingMeeting(id: string, referrerId: string) {
  await prisma.$transaction(async tx => {
    const s = await tx.selfServiceOnboarding.findFirst({ where: { id, referrerId }, include: { application: true } });
    if (!s || s.publicToken) throw new OnboardingError("Referral onboarding not found.", 404);
    if (!["reserved", "needs_help", "ready"].includes(s.state) || ["onboarded", "rejected", "unreachable"].includes(s.application.status) || s.application.paidAt)
      throw new OnboardingError("This application cannot be handed over for a meeting.", 409);
    if (s.application.onboardingMethod === "team_meeting") return;
    const now = new Date();
    await tx.selfServiceOnboarding.update({ where: { id }, data: { state: "needs_help" } });
    await tx.ambassadorApplication.update({ where: { id: s.applicationId }, data: {
      onboardingMethod: "team_meeting", nextFollowUp: now,
      adminNotes: `${s.application.adminNotes || ""}\nMEETING REQUEST ${now.toISOString()}: Referrer chose team-assisted setup at the standard referral fee. Please contact the owner through their saved contact channel and arrange a setup meeting. No meeting has been booked by this request.`,
    } });
  });
}

export async function updateOnboardingPayout(id: string, referrerId: string, payout: Record<string, unknown>) {
  await prisma.$transaction(async tx => {
    const s = await tx.selfServiceOnboarding.findFirst({ where: { id, referrerId }, include: { application: true } });
    if (!s || s.publicToken) throw new OnboardingError("Referral onboarding not found.", 404);
    if (!["reserved", "needs_help", "ready"].includes(s.state) || s.application.paidAt || ["onboarded", "rejected"].includes(s.application.status)) throw new OnboardingError("Contact the team to change payout details for this application.", 409);
    const input = selfServiceInput.safeParse({ ...payout, fullName: s.application.fullName, email: s.email, linkedinUrl: s.linkedinUrl,
      country: s.application.location || "PH", contactNumber: s.application.contactNumber || "unknown", accountFreshness: s.application.accountFreshness || "unknown", consent: true });
    if (!input.success) throw new OnboardingError(input.error.issues[0]?.message || "Check the payout details.");
    const cfg = currencyConfigFor(s.application.payoutCurrency, "", s.application);
    if (!cfg.payoutMethods.includes(input.data.paymentMethod)) throw new OnboardingError("Choose a supported payout method.");
    const { paymentMethod, paymentDetails, payoutName, bankName, bankAccountNumber, bankRoutingNumber } = input.data;
    await tx.ambassadorApplication.update({ where: { id: s.applicationId }, data: { paymentMethod, paymentDetails, payoutName, bankName, bankAccountNumber, bankRoutingNumber } });
  });
}

export async function undoOnboardingMeeting(id: string, referrerId: string) {
  await prisma.$transaction(async tx => {
    const s = await tx.selfServiceOnboarding.findFirst({ where: { id, referrerId }, include: { application: true } });
    if (!s || s.publicToken) throw new OnboardingError("Referral onboarding not found.", 404);
    if (!["reserved", "needs_help", "ready"].includes(s.state) || ["onboarded", "rejected", "unreachable"].includes(s.application.status) || s.application.paidAt)
      throw new OnboardingError("Contact the team to change this completed handoff.", 409);
    if (s.application.onboardingMethod !== "team_meeting") return;
    const notes = s.application.adminNotes || "";
    const requests = [...notes.matchAll(/MEETING REQUEST ([^:]+T[^ ]+): Referrer/g)];
    const requestedAt = requests.at(-1)?.[1];
    const clearFollowUp = requestedAt && s.application.nextFollowUp?.getTime() === new Date(requestedAt).getTime();
    await tx.selfServiceOnboarding.update({ where: { id }, data: { state: s.state === "needs_help" ? "reserved" : s.state } });
    await tx.ambassadorApplication.update({ where: { id: s.applicationId }, data: {
      onboardingMethod: null,
      ...(clearFollowUp ? { nextFollowUp: null } : {}),
      adminNotes: `${notes}\nMEETING REQUEST WITHDRAWN ${new Date().toISOString()}: Referrer undid the team takeover and will continue self-onboarding. Saved setup progress is retained.`,
    } });
  });
}
