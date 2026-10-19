import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto-creds";
import { forwardingActive } from "@/lib/onboarding-email-policy";
import type { ProfileBuild } from "@/lib/profile-generator";

// Onboarding pipeline — every ambassador application, bucketed by how far along it
// is. The one non-obvious rule: an application only counts as ONBOARDED once the
// account we hold for it actually has a GoLogin profile or share link. Without one
// the account can't be run, so onboarding isn't finished no matter what the status
// column says — those rows stay in Processing, flagged.

type Bucket = "initial" | "processing" | "rejected" | "onboarded" | "unreachable";

export async function GET() {
  try {
    await requireAdmin();

    const apps = await prisma.ambassadorApplication.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, fullName: true, email: true, contactNumber: true, contactChannel: true, diyTier: true,
        linkedinUrl: true, connectionCount: true, location: true, status: true,
        applicationReceived: true, createdAt: true, onboardedAt: true, verifiedAt: true, qcChecks: true, emailPrimaryAt: true, paidAt: true,
        accountIssue: true, onboardingFix: true, restrictionReport: true, adminNotes: true, notes: true,
        outreachLog: true, nextFollowUp: true, callOutcome: true,
        onboardingMethod: true, referredBy: true, referrerId: true, payoutCurrency: true, referralSource: true, industry: true, poc: true,
        linkedinEmail: true, bookingEmail: true, accountFreshness: true,
        paymentMethod: true, paymentDetails: true, payoutName: true,
        paypalEmail: true, wiseEmail: true, ownerStatus: true,
      },
    });

    const accounts = await prisma.linkedInAccount.findMany({
      where: { status: { notIn: ["removed"] } },
      select: {
        id: true, linkedinName: true, linkedinUrl: true, loginEmail: true,
        personalEmail: true, workEmail: true, accountPassword: true, twoFactor: true,
        gologinProfileId: true, gologinShareLink: true, monthlyPrice: true,
        ambassadorPayment: true, connectionCount: true, status: true,
        restrictedAt: true, warmupStartedAt: true, maturingStartedAt: true, profileBuild: true, profilePhotoUrl: true, linkedinJoinedAt: true, connectionHistory: true, restrictionLog: true, notes: true, linkedinVerified: true, linkedinAccountHealth: true, healthCheckedAt: true,
        proxyHost: true, proxyPort: true, proxyUsername: true,
        proxyPassword: true, proxyLocation: true, provisionStatus: true, createdAt: true,
        poc: true,
      },
    });

    // DIY phone hand-offs waiting for us to do the GoLogin sign-in. state "handed_off"
    // is set only by the phone hand-off, so it marks "handed to the team" — but it is never
    // cleared once we sign in, so the "Needs sign-in" badge below also requires that the
    // account hasn't been logged in yet (onboardedAt unset). Once it's logged in, the
    // sign-in is done and the badge must drop.
    const selfSessions = await prisma.selfServiceOnboarding.findMany({ select: { id: true, referrerId: true, applicationId: true, accountId: true, state: true, emailSetup: { select: { lastCode: true, lastCodeAt: true, forwardingUntil: true, destinationVerifiedAt: true, consentAt: true } } } });
    // Latest LinkedIn code per application — shown to the team ONLY while forwarding is active
    // (session not confirmed / not onboarded) and fresh (<15 min); mirrors the referrer wizard.
    const latestCodeByApp = new Map<string, string>();
    for (const s of selfSessions) {
      const e = s.emailSetup;
      if (e?.lastCode && e.lastCodeAt && forwardingActive(e, s.state) && Date.now() - e.lastCodeAt.getTime() < 15 * 60000) latestCodeByApp.set(s.applicationId, e.lastCode);
    }
    const inProgressAppIds = new Set(selfSessions.filter(s => ["reserved", "needs_help", "ready"].includes(s.state)).map(s => s.applicationId));
    const handoffAppIds = new Set(selfSessions.filter(s => s.state === "handed_off").map(s => s.applicationId));
    const sessionByApplication = new Map(selfSessions.map(s => [s.applicationId, s]));
    const sessionAccount = new Map(selfSessions.map(s => [s.applicationId, s.accountId]));
    const accountById = new Map(accounts.map(a => [a.id, a]));

    // Referrer contact lookup (by slug) — used to build reminder links (WhatsApp
    // click-to-send / Telegram) next to a raised onboarding issue on the pipeline.
    const referrers = await prisma.referrer.findMany({
      select: { id: true, active: true, slug: true, name: true, email: true, token: true, contactMethod: true, contactHandle: true, contacts: true },
    });
    const refBySlug = new Map(referrers.map((r) => [r.slug.toLowerCase(), r]));
    const refById = new Map(referrers.map((r) => [r.id, r]));
    // When an account owner is ALSO a referrer (app.referrerId set), surface that link so
    // the pipeline can show it and the referral invite can use their live portal token.
    const asReferrer = (referrerId?: string | null) => {
      const rf = referrerId ? refById.get(referrerId) : null;
      return rf ? { slug: rf.slug, token: rf.token, name: rf.name } : null;
    };
    // LV PoC = the LinkedVelocity rep who onboards an account, set by hand. We only blank a
    // poc that matches the ambassador's OWN name (self-referential bad data). A name that also
    // belongs to a referrer is allowed — an LV handler can be a referrer too, and the PoC is
    // now assigned deliberately (not the old DIY auto-set-from-referrer that this once guarded).
    const notPocNames = new Set<string>();
    for (const ap of apps) if (ap.fullName) notPocNames.add(ap.fullName.trim().toLowerCase());
    const cleanPoc = (poc?: string | null) => {
      const p = (poc || "").trim();
      return p && !notPocNames.has(p.toLowerCase()) ? p : null;
    };
    type RefC = { method?: string; handle?: string; preferred?: boolean };
    const refContact = (slug?: string | null) => {
      const rf = refBySlug.get((slug || "").trim().toLowerCase());
      if (!rf) return null;
      const list: RefC[] = Array.isArray(rf.contacts)
        ? (rf.contacts as RefC[])
        : rf.contactHandle
          ? [{ method: rf.contactMethod || "WhatsApp", handle: rf.contactHandle, preferred: true }]
          : [];
      const byMethod = (m: string) => list.find((c) => (c.method || "").toLowerCase() === m)?.handle || null;
      const wa = byMethod("whatsapp");
      const tg = byMethod("telegram");
      const pref = list.find((c) => c.preferred) || list[0];
      return {
        name: rf.name,
        email: rf.email || byMethod("email"),
        viber: byMethod("viber"),
        token: rf.token,
        whatsapp: wa ? wa.replace(/[^0-9]/g, "") : null,
        telegram: tg ? tg.replace(/^@/, "").trim() : null,
        preferred: pref?.method || null,
      };
    };

    // Match an application to its account the same way the rest of the admin does:
    // Match an application to its account by the UNIQUE LinkedIn URL first, then fall
    // back to the "Owner: <email>" line in the account notes — but ONLY when that email
    // maps to a single account. A shared owner email (e.g. a POC/referrer inbox used by
    // several applicants, like najendeleon@gmail.com) can't disambiguate, so email-only
    // matching there would wrongly hand every applicant the same first account.
    const normUrl = (u?: string | null) => (u || "").split("?")[0].replace(/\/+$/, "").toLowerCase().trim();
    const byOwner = new Map<string, (typeof accounts)[number]>();
    const ownerCount = new Map<string, number>();
    const byUrl = new Map<string, (typeof accounts)[number]>();
    for (const a of accounts) {
      const owner = (a.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "")?.toLowerCase();
      if (owner) {
        ownerCount.set(owner, (ownerCount.get(owner) || 0) + 1);
        if (!byOwner.has(owner)) byOwner.set(owner, a);
      }
      const u = normUrl(a.linkedinUrl);
      if (u && !byUrl.has(u)) byUrl.set(u, a);
    }

    const rows = apps.map((app) => {
      const appUrl = normUrl(app.linkedinUrl);
      const email = app.email.toLowerCase();
      const acct =
        accountById.get(sessionAccount.get(app.id) || "") ||
        (appUrl ? byUrl.get(appUrl) : undefined) ||
        (ownerCount.get(email) === 1 ? byOwner.get(email) : undefined) ||
        null;

      const hasGologin = !!(acct?.gologinProfileId || acct?.gologinShareLink);
      const hasLogin = !!(acct?.loginEmail && acct?.accountPassword);

      // Bucketing. "onboarded" only sticks if a GoLogin actually exists; otherwise the
      // row drops back into Processing so it shows up as work still to do.
      let bucket: Bucket;
      let reason = "";
      if (app.status === "rejected") { bucket = "rejected"; reason = "Rejected"; }
      else if (app.status === "pending") { bucket = "initial"; reason = "New application"; }
      // Contacted = we've reached out and are waiting to hear back. Kept in the Initial
      // section (still a lead you're chasing, not yet in the pipeline), badged apart.
      else if (app.status === "contacted") { bucket = "initial"; reason = "Awaiting reply"; }
      else if (app.status === "onboarded") {
        // Onboarded rows stay in the Onboarded section even without a GoLogin — they
        // sort to the bottom of it and carry a "No GoLogin found" badge, so the gap is
        // visible without hiding someone who has otherwise been onboarded.
        bucket = "onboarded";
        reason = hasGologin ? "Onboarded" : acct ? "Onboarded · no GoLogin found" : "Onboarded · no account linked";
      }
      else if (app.status === "unreachable") { bucket = "unreachable"; reason = "Unreachable"; }
      else {
        bucket = "processing";
        reason = app.status === "onboarding" ? "Level 1 · waiting (before GoLogin / login)" : app.status === "approved" ? "Level 2 · GoLogin ready, verifying before payout" : app.status === "on_hold" ? "On hold" : "In review";
      }

      return {
        id: app.id,
        setupInProgress: inProgressAppIds.has(app.id),
        meetingRequested: app.onboardingMethod === "team_meeting" && inProgressAppIds.has(app.id),
        referrerResumeUrl: (() => {
          const session = sessionByApplication.get(app.id);
          const ref = refBySlug.get((app.referredBy || "").trim().toLowerCase());
          return session && ref?.active && ref.id === session.referrerId && inProgressAppIds.has(app.id)
            ? `https://linkedvelocity.com/m/${encodeURIComponent(ref.token)}/onboarding?session=${encodeURIComponent(session.id)}` : null;
        })(),
        existingAccountSubmission: !!app.adminNotes?.includes("[Existing account submission]"),
        diyTier: app.diyTier,
        onboardingMethod: app.onboardingMethod,
        fullName: app.fullName,
        email: app.email,
        contactNumber: app.contactNumber,
        contactChannel: app.contactChannel,
        linkedinUrl: app.linkedinUrl,
        location: app.location,
        status: app.status,
        createdAt: app.createdAt,
        onboardedAt: app.onboardedAt,
        accountIssue: app.accountIssue,
        onboardingFix: app.onboardingFix,
        restrictionReport: app.restrictionReport,
        adminNotes: app.adminNotes,
        applicationNotes: app.notes,
        outreachLog: (app.outreachLog as { ch: string; text: string; by?: string; at: string }[] | null) || null,
        nextFollowUp: app.nextFollowUp,
        callOutcome: app.callOutcome,
        referredBy: app.referredBy,
        referrer: refContact(app.referredBy),
        asReferrer: asReferrer(app.referrerId),
        payoutCurrency: app.payoutCurrency,
        referralSource: app.referralSource,
        industry: app.industry,
        // POC is stored on the application AND (for some paths) on the linked account —
        // read a coalesce so an assignment made against either sticks regardless of level.
        poc: cleanPoc(app.poc) ?? cleanPoc(acct?.poc),
        linkedinEmail: app.linkedinEmail,
        bookingEmail: app.bookingEmail,
        accountFreshness: app.accountFreshness,
        ownerStatus: app.ownerStatus,
        paymentMethod: app.paymentMethod || (app.paypalEmail ? `PayPal: ${app.paypalEmail}` : app.wiseEmail ? `Wise: ${app.wiseEmail}` : null),
        paymentDetails: app.paymentDetails,
        payoutName: app.payoutName,
        verifiedAt: app.verifiedAt,
        qcChecks: app.qcChecks,
        applicationReceived: app.applicationReceived,
        emailPrimaryAt: app.emailPrimaryAt,
        setupPaidAt: app.paidAt,
        bucket,
        reason,
        hasGologin,
        hasLogin,
        accountId: acct?.id || null,
        accountName: acct?.linkedinName || null,
        accountStatus: acct?.status || null,
        loginEmail: acct?.loginEmail || null,
        personalEmail: acct?.personalEmail || null,
        workEmail: acct?.workEmail || null,
        hasPassword: !!acct?.accountPassword,
        has2fa: !!acct?.twoFactor,
        accountPassword: decryptSecret(acct?.accountPassword) || null,
        twoFactor: decryptSecret(acct?.twoFactor) || null,
        gologinProfileId: acct?.gologinProfileId || null,
        gologinShareLink: acct?.gologinShareLink || null,
        proxyHost: acct?.proxyHost || null,
        proxyPort: acct?.proxyPort ?? null,
        proxyUsername: acct?.proxyUsername || null,
        proxyPassword: acct?.proxyPassword || null,
        proxyLocation: acct?.proxyLocation || null,
        accountRestrictedAt: acct?.restrictedAt || null,
        warmupStartedAt: acct?.warmupStartedAt ? new Date(acct.warmupStartedAt).toISOString() : null,
        maturingStartedAt: acct?.maturingStartedAt ? new Date(acct.maturingStartedAt).toISOString() : null,
        profileBuild: (acct?.profileBuild as ProfileBuild | null) || null,
        profilePhotoUrl: acct?.profilePhotoUrl || null,
        linkedinJoinedAt: acct?.linkedinJoinedAt ? new Date(acct.linkedinJoinedAt).toISOString() : null,
        connectionHistory: (acct?.connectionHistory as { at: string; count: number; note?: string }[] | null) || null,
        accountRestrictionLog: acct?.restrictionLog || null,
        linkedinAccountHealth: acct?.linkedinAccountHealth || null,
        healthCheckedAt: acct?.healthCheckedAt ? acct.healthCheckedAt.toISOString() : null,
        monthlyPrice: acct?.monthlyPrice != null ? Number(acct.monthlyPrice) : null,
        ambassadorPayment: acct?.ambassadorPayment != null ? Number(acct.ambassadorPayment) : null,
        accountNotes: acct?.notes || null,
        linkedinVerified: !!acct?.linkedinVerified,
        provisionStatus: acct?.provisionStatus || null,
        connectionCount: acct?.connectionCount ?? app.connectionCount ?? null,
        // DIY phone hand-off: owner is on a phone, so LinkedVelocity must do the sign-in.
        // Only "pending" until the account is actually logged in (onboardedAt stamped).
        phoneHandoffPending: handoffAppIds.has(app.id) && !app.onboardedAt,
        latestCode: latestCodeByApp.get(app.id) || null,
      };
    });

    // Inventory-only accounts: LinkedIn accounts we hold that never came through an
    // ambassador application, so no row above represents them. Surface the RESTRICTED ones
    // as lightweight "account-only" rows so a restriction set on the inventory side is
    // visible (and recoverable) here too. They carry accountOnly:true; the pipeline renders
    // them with a compact card and excludes them from the level/onboarding metrics.
    const matchedAccountIds = new Set(rows.map((r) => r.accountId).filter(Boolean) as string[]);
    const orphanRows = accounts
      .filter((a) => a.restrictedAt && !matchedAccountIds.has(a.id) && a.status !== "retired")
      .map((a) => ({
        id: `acct:${a.id}`,
        accountOnly: true,
        fullName: a.linkedinName,
        email: a.loginEmail || "",
        contactNumber: null, contactChannel: null,
        linkedinUrl: a.linkedinUrl,
        location: null,
        status: "reviewing",
        createdAt: a.createdAt,
        onboardedAt: null,
        accountIssue: null, onboardingFix: null, restrictionReport: null,
        adminNotes: null, applicationNotes: null, outreachLog: null,
        nextFollowUp: null, callOutcome: null,
        referredBy: null, referrer: null, asReferrer: null, payoutCurrency: null, referralSource: null,
        industry: null, poc: a.poc || null, linkedinEmail: null, bookingEmail: null,
        accountFreshness: null, ownerStatus: null,
        paymentMethod: null, paymentDetails: null, payoutName: null,
        verifiedAt: null, qcChecks: null, emailPrimaryAt: null, setupPaidAt: null,
        bucket: "onboarded" as Bucket, reason: "Inventory account · no application",
        hasGologin: !!(a.gologinProfileId || a.gologinShareLink),
        hasLogin: !!(a.loginEmail && a.accountPassword),
        accountId: a.id,
        accountName: a.linkedinName,
        accountStatus: a.status,
        loginEmail: a.loginEmail || null,
        personalEmail: a.personalEmail || null,
        workEmail: a.workEmail || null,
        hasPassword: !!a.accountPassword, has2fa: !!a.twoFactor,
        accountPassword: null, twoFactor: null,
        gologinProfileId: a.gologinProfileId || null,
        gologinShareLink: a.gologinShareLink || null,
        proxyHost: a.proxyHost || null, proxyPort: a.proxyPort ?? null,
        proxyUsername: a.proxyUsername || null, proxyPassword: a.proxyPassword || null,
        proxyLocation: a.proxyLocation || null,
        accountRestrictedAt: a.restrictedAt,
        warmupStartedAt: a.warmupStartedAt ? new Date(a.warmupStartedAt).toISOString() : null,
        maturingStartedAt: a.maturingStartedAt ? new Date(a.maturingStartedAt).toISOString() : null,
        profileBuild: (a.profileBuild as ProfileBuild | null) || null,
        profilePhotoUrl: a.profilePhotoUrl || null,
        linkedinJoinedAt: a.linkedinJoinedAt ? new Date(a.linkedinJoinedAt).toISOString() : null,
        connectionHistory: (a.connectionHistory as { at: string; count: number; note?: string }[] | null) || null,
        accountRestrictionLog: a.restrictionLog || null,
        linkedinAccountHealth: a.linkedinAccountHealth || null,
        healthCheckedAt: a.healthCheckedAt ? a.healthCheckedAt.toISOString() : null,
        monthlyPrice: a.monthlyPrice != null ? Number(a.monthlyPrice) : null,
        ambassadorPayment: a.ambassadorPayment != null ? Number(a.ambassadorPayment) : null,
        accountNotes: a.notes || null,
        linkedinVerified: !!a.linkedinVerified,
        provisionStatus: a.provisionStatus || null,
        connectionCount: a.connectionCount ?? null,
        phoneHandoffPending: false,
        latestCode: null,
      }));

    return NextResponse.json({ rows: [...rows, ...orphanRows] });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
