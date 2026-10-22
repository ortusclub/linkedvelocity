import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { getCallMaps, pickCall } from "@/lib/calendar-calls";

export async function GET() {
  try {
    await requireAdmin();

    const applications = await prisma.ambassadorApplication.findMany({
      orderBy: { createdAt: "desc" },
      include: { scheduledMeeting: true, selfServiceOnboarding: { select: { accountId: true } } },
    });

    // Enrich with current contact number from user profiles
    const emails = [...new Set(applications.map(a => a.email))];
    const users = emails.length > 0
      ? await prisma.user.findMany({
          where: { email: { in: emails } },
          select: { email: true, contactNumber: true },
        })
      : [];
    const contactMap = new Map(users.map(u => [u.email, u.contactNumber]));

    // Live call status from info@'s Google Calendar (matched by the guest's email).
    const calls = await getCallMaps();

    // Private admin views read the inventory notes from the account itself.
    const accounts = await prisma.linkedInAccount.findMany({ select: { id: true, linkedinUrl: true, personalEmail: true, notes: true, restrictedAt: true, permanentlyRestricted: true, status: true } });
    const norm = (url: string | null) => (url || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").split("?")[0].replace(/\/+$/, "");
    const accountFor = (a: typeof applications[number]) => {
      if (a.selfServiceOnboarding?.accountId) return accounts.find(account => account.id === a.selfServiceOnboarding!.accountId);
      const urlMatches = a.linkedinUrl ? accounts.filter(account => norm(account.linkedinUrl) === norm(a.linkedinUrl)) : [];
      if (urlMatches.length === 1) return urlMatches[0];
      if (urlMatches.length > 1) return undefined;
      const emailMatches = accounts.filter(account => account.personalEmail?.toLowerCase() === a.email.toLowerCase());
      return emailMatches.length === 1 ? emailMatches[0] : undefined;
    };
    const enriched = applications.map(a => {
      const acct = accountFor(a);
      return {
      accountId: acct?.id || null,
      accountNotes: acct?.notes || null,
      // Account-level restriction truth (restrictedAt is set, and accountIssue cleared, once
      // carryAppRestrictionToAccount runs) so per-referrer quality metrics aren't undercounted.
      accountRestrictedAt: acct?.restrictedAt ? acct.restrictedAt.toISOString() : null,
      accountPermanentlyRestricted: acct?.permanentlyRestricted || false,
      accountStatus: acct?.status || null,
      ...a,
      contactNumber: contactMap.get(a.email) || a.contactNumber,
      call: a.scheduledMeeting ? { stage: a.scheduledMeeting.startsAt > new Date() ? "booked" : "done", scheduledAt: a.scheduledMeeting.startsAt.toISOString(), meetLink: null, channel: "Application contact", title: "30-minute onboarding call", cancelled: false } : pickCall(calls, { email: a.email, bookingEmail: a.bookingEmail, fullName: a.fullName }).call,
      };
    });

    return NextResponse.json({ applications: enriched });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
