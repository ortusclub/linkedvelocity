import { existingApplicationAccount, establishedDuplicate, openDuplicateApplication } from "@/lib/application-duplicates";
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { meetingToken } from "@/lib/meeting-token";
import { getSession } from "@/lib/auth";
import { z } from "zod";
import { assessFromApplication } from "@/services/profile-assessor";
import { sendAmbassadorApplicationLead } from "@/services/email";

const applySchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  linkedinEmail: z.string().email().optional(),
  contactNumber: z.string().optional(),
  linkedinUrl: z.string().optional(),
  connectionCount: z.number().int().optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  referralSource: z.string().optional(),
  referredBy: z.string().optional(),
  diyTier: z.enum(["standard", "partial", "full"]).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = applySchema.parse(body);
    const submitter = await getSession();
    const linkedinUrl = data.linkedinUrl || "";
    const hasUrl = linkedinUrl.length > 0;

    // Canonicalize a referral code to the matching referrer's slug, so a manually-typed
    // code ("Lewis-4823", "lewis 4823", "LEWIS-4823") credits the same person as the QR.
    let referredBy = data.referredBy?.trim() || undefined;
    let referrerType: string | undefined;
    if (referredBy) {
      const norm = referredBy.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const match = norm ? await prisma.referrer.findUnique({ where: { slug: norm } }) : null;
      if (match) { referredBy = match.slug; referrerType = match.type; }
    }

    // Leads without a LinkedIn URL (e.g. a field-day walk-up who skipped the valuation)
    // are captured as "pending" for the team to follow up — no auto-assessment or account.
    // Double-submit guard for URL-less leads, which the check above skips — that gap let
    // one field-day walk-up file six identical applications in a single minute. Treat a
    // repeat from the same email within a few minutes as the same submission and hand back
    // what we already stored, so the applicant still moves on to the booking step and we
    // don't re-notify the team.
    // Matched on linkedinUrl too (both empty for a walk-up lead) so someone genuinely
    // signing up a SECOND account on the same email isn't blocked.
    const recent = await prisma.ambassadorApplication.findFirst({
      where: {
        email: data.email,
        linkedinUrl,
        submittedByUserId: submitter?.id ?? null,
        createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recent) {
      return NextResponse.json({ application: recent, meetingToken: meetingToken(recent.id), assessment: null, duplicate: true }, { status: 200 });
    }

    // Re-signup by an email or profile already established with us (an onboarded application
    // OR a live, non-removed inventory account): never a legitimate new signup. Hand back the
    // existing application where there is one, otherwise refuse. This is what stops an
    // already-onboarded owner filing a fresh duplicate every time they re-submit. Matching now
    // includes the email (not only the profile slug) and a live account that has no application
    // (e.g. the application was deleted) — the two gaps that previously let repeats through.
    const established = await establishedDuplicate(data.email, linkedinUrl);
    if (established) {
      // Already established with us — an onboarded application OR a live, non-removed account.
      // They're done, not a new signup, so NEVER hand back an onboarding-call booking: previously
      // the existing app was returned WITH a meetingToken, which let an already-onboarded owner
      // re-book the onboarding call just by re-submitting the form. Tell them to contact the team.
      return NextResponse.json({ duplicate: true, alreadyRegistered: true, error: "This account is already registered with LinkedVelocity. If you need to make a change, contact the team instead of submitting a new application." }, { status: 200 });
    }

    // A still-open application for the same LinkedIn profile (any email / submitter / time),
    // or the same URL-less lead re-submitting — a repeat, not a new signup. Hand back the
    // original so the applicant still moves on to the booking step and the team gets neither a
    // second row nor a duplicate lead email. (The narrow same-submitter 10-min guard above only
    // catches an instant double-tap; this catches the minutes-apart, different-email repeats.)
    const openDup = await openDuplicateApplication(data.email, linkedinUrl);
    if (openDup) {
      return NextResponse.json({ application: openDup, meetingToken: meetingToken(openDup.id), assessment: null, duplicate: true }, { status: 200 });
    }

    const duplicateNote = await existingApplicationAccount(data.email, linkedinUrl);

    // Auto-assess the profile — only when we have a URL to value.
    const assessment = hasUrl
      ? assessFromApplication({
          connectionCount: data.connectionCount,
          industry: data.industry,
          location: data.location,
          notes: data.notes,
        })
      : null;

    // Create application with auto-assessment results (or as a pending lead).
    const application = await prisma.ambassadorApplication.create({
      data: {
        ...data,
        submittedByUserId: submitter?.id ?? null,
        diyTier: data.diyTier ?? "standard",
        linkedinUrl,
        referredBy,
        // Ortus-referred signups are handled by Ton as the LV point of contact.
        ...(referrerType === "ortus" ? { poc: "Ton" } : {}),
        // Every new signup lands in Initial (reviewing = assessed-but-not-yet-reviewed,
        // pending = no LinkedIn URL). The team promotes to Level 1 by hand — no
        // auto-approval to Level 2.
        status: assessment ? "reviewing" : "pending",
        offeredAmount: assessment?.offeredAmount,
        adminNotes: (duplicateNote ? duplicateNote + "\n" : "") + (assessment
          ? `Auto-assessed: Score ${assessment.score}/100, Tier: ${assessment.tier}. ${assessment.breakdown.map((b) => `${b.category}: ${b.points}/${b.maxPoints}`).join(", ")}`
          : "Lead captured without LinkedIn URL — pending follow-up."),
      },
    });

    // No auto-account on signup — the inventory account is created when the team
    // actually onboards them, so a fresh signup stays a clean Initial lead.

    // The lead is saved before responding; email delivery must not delay signup.
    after(async () => {
    try {
      await sendAmbassadorApplicationLead({
        fullName: data.fullName,
        email: data.email,
        linkedinEmail: data.linkedinEmail,
        contactNumber: data.contactNumber,
        linkedinUrl,
        connectionCount: data.connectionCount,
        industry: data.industry,
        location: data.location,
        notes: data.notes,
        status: application.status,
        offeredAmount: assessment?.offeredAmount,
      });
    } catch (emailError) {
      console.error("Ambassador lead email failed:", emailError);
    }
    });

    return NextResponse.json({
      application,
      meetingToken: meetingToken(application.id),
      assessment: assessment
        ? {
            score: assessment.score,
            tier: assessment.tier,
            offeredAmount: assessment.offeredAmount,
            breakdown: assessment.breakdown,
            autoApproved: assessment.autoApproved,
          }
        : null,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    console.error("Ambassador apply error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
