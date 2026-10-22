import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { sendSetupFeePaidEmail, sendMonthlyPayoutEmail } from "@/services/email";
import { currencyConfigFor } from "@/lib/referral-currency";
import { carryAppRestrictionToAccount, appIssueIsRestricted } from "@/lib/restriction";
import { notifyRestrictionOwnerReferrer } from "@/lib/restrict-notify";
import { deleteApplicationCascade } from "@/lib/application-delete";

const updateSchema = z.object({
  applicationReceived: z.boolean().optional(),
  status: z.enum(["pending", "reviewing", "approved", "rejected", "onboarding", "onboarded", "unreachable", "contacted", "on_hold"]).optional(),
  offeredAmount: z.number().optional(),
  adminNotes: z.string().optional(),
  // editable applicant details (filled in as info comes in)
  fullName: z.string().optional(),
  contactNumber: z.string().nullable().optional(),
  linkedinEmail: z.string().nullable().optional(),
  linkedinUrl: z.string().optional(),
  connectionCount: z.number().nullable().optional(),
  location: z.string().nullable().optional(),
  referralSource: z.string().nullable().optional(),
  referredBy: z.string().nullable().optional(),
  bookingEmail: z.string().nullable().optional(),
  poc: z.string().nullable().optional(),
  nextFollowUp: z.string().datetime().nullable().optional(),
  callOutcome: z.enum(["no_show", "completed"]).nullable().optional(),
  accountFreshness: z.enum(["established", "fresh"]).nullable().optional(),
  onboardingStartedAt: z.string().datetime().nullable().optional(),
  onboardedAt: z.string().datetime().nullable().optional(),
  verifiedAt: z.string().datetime().nullable().optional(),
  emailPrimaryAt: z.string().datetime().nullable().optional(),
  paidAt: z.string().datetime().nullable().optional(),
  marketerPaidAt: z.string().datetime().nullable().optional(),
  referralHoldReason: z.string().max(120).nullable().optional(),
  // Owner payout details
  paymentMethod: z.string().nullable().optional(),
  paymentDetails: z.string().nullable().optional(),
  payoutName: z.string().nullable().optional(),
  ownerStatus: z.enum(["active", "waiting_us", "waiting_them", "offline", "onboarding", "paused", "lost"]).nullable().optional(),
  payoutCurrency: z.enum(["PHP", "USD"]).nullable().optional(),
  contactChannel: z.string().nullable().optional(),
  accountIssue: z.string().nullable().optional(),
  // Post-sign-in fix the team raises for the referrer (email not primary / 2FA not set),
  // shown on their portal. null clears it. state flips to "referrer_done" from the portal.
  setOnboardingFix: z.object({
    issues: z.array(z.enum(["application_incomplete", "email_added", "email_primary", "twofa", "password"])).min(1),
    state: z.enum(["open", "referrer_done"]),
    raisedAt: z.string().datetime(),
    doneAt: z.string().datetime().optional(),
  }).nullable().optional(),
  // The referrer's own report about a restriction (owner did the QR/ID check, or says
  // it's unrestricted), raised from their portal. The team only ever clears it here
  // (null) once verified — recovering the account is a separate restriction action.
  setRestrictionReport: z.object({
    type: z.enum(["qr_done", "recovered"]),
    at: z.string(),
    by: z.string().optional(),
  }).nullable().optional(),
  // QC checklist behind verifiedAt — each check is a boolean the admin ticks.
  qcChecks: z.object({
    photo: z.boolean().optional(),
    headline: z.boolean().optional(),
    about: z.boolean().optional(),
    connections: z.boolean().optional(),
    experiences: z.boolean().optional(),
    education: z.boolean().optional(),
    // Pre-onboarding security handover check (Step 5), stored alongside the QC checks.
    sessionsOut: z.boolean().optional(),
    noRememberedPw: z.boolean().optional(),
    gologinRemoved: z.boolean().optional(),
    phoneRemoved: z.boolean().optional(),
  }).nullable().optional(),
  // Recurring ₱500/month payout: append a receipt, or remove one by index.
  // A receipt can carry proof-of-payment and its notified / acknowledged audit trail.
  addMonthlyPayout: z.object({
    amount: z.number(),
    note: z.string().optional(),
    kind: z.enum(["setup", "monthly"]).optional(),
    method: z.string().nullable().optional(),
    proofUrl: z.string().nullable().optional(),
    // Which account this payout was for (setup fees are one-off per account).
    accountId: z.string().optional(),
  }).optional(),
  removeMonthlyPayout: z.number().int().optional(),
  // Patch one existing receipt by index: attach proof, or flip notified / acknowledged.
  updateMonthlyPayout: z.object({
    index: z.number().int(),
    proofUrl: z.string().nullable().optional(),
    notified: z.boolean().optional(),
    acknowledged: z.boolean().optional(),
  }).optional(),
  addTouch: z.object({
    ch: z.enum(["whatsapp", "viber", "telegram", "email", "call", "text", "reply", "booked", "done", "note"]),
    text: z.string().min(1),
    by: z.string().optional(),
  }).optional(),
  removeTouch: z.string().optional(), // the `at` timestamp of the outreach entry to remove
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await req.json();
    const { addTouch, removeTouch, addMonthlyPayout, removeMonthlyPayout, updateMonthlyPayout, nextFollowUp, onboardingStartedAt, onboardedAt, verifiedAt, emailPrimaryAt, paidAt, marketerPaidAt, referralHoldReason, setOnboardingFix, setRestrictionReport, qcChecks, ...rest } = updateSchema.parse(body);

    // Get the current application before updating
    const currentApp = await prisma.ambassadorApplication.findUnique({ where: { id } });
    if (!currentApp) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const updateData: Prisma.AmbassadorApplicationUpdateInput = { ...rest };
    if (nextFollowUp !== undefined) updateData.nextFollowUp = nextFollowUp ? new Date(nextFollowUp) : null;
    if (onboardingStartedAt !== undefined) updateData.onboardingStartedAt = onboardingStartedAt ? new Date(onboardingStartedAt) : null;
    if (onboardedAt !== undefined) updateData.onboardedAt = onboardedAt ? new Date(onboardedAt) : null;
    if (verifiedAt !== undefined) updateData.verifiedAt = verifiedAt ? new Date(verifiedAt) : null;
    if (emailPrimaryAt !== undefined) updateData.emailPrimaryAt = emailPrimaryAt ? new Date(emailPrimaryAt) : null;
    if (paidAt !== undefined) updateData.paidAt = paidAt ? new Date(paidAt) : null;
    if (marketerPaidAt !== undefined) updateData.marketerPaidAt = marketerPaidAt ? new Date(marketerPaidAt) : null;
    if (referralHoldReason !== undefined) { const v = (referralHoldReason || "").trim(); updateData.referralHoldReason = v || null; updateData.referralHeldAt = v ? new Date() : null; }
    if (setOnboardingFix !== undefined) updateData.onboardingFix = setOnboardingFix === null ? Prisma.DbNull : setOnboardingFix;
    if (setRestrictionReport !== undefined) updateData.restrictionReport = setRestrictionReport === null ? Prisma.DbNull : setRestrictionReport;
    if (qcChecks !== undefined) updateData.qcChecks = qcChecks === null ? Prisma.DbNull : qcChecks;
    if (addTouch) {
      const log = Array.isArray(currentApp.outreachLog) ? (currentApp.outreachLog as unknown[]) : [];
      updateData.outreachLog = [
        ...log,
        { ch: addTouch.ch, text: addTouch.text, by: addTouch.by?.trim() || admin.fullName || admin.email, at: new Date().toISOString() },
      ] as Prisma.InputJsonValue;
    }
    if (removeTouch) {
      const log = Array.isArray(currentApp.outreachLog) ? (currentApp.outreachLog as { at?: string }[]) : [];
      updateData.outreachLog = log.filter((t) => t?.at !== removeTouch) as Prisma.InputJsonValue;
    }
    // When a Wise receipt is attached to a payout, we auto-email the payee and flip
    // "notified". This captures which entry to notify (set below), so the email is
    // sent AFTER the DB write succeeds — and "notified" is only set once it actually sends.
    let notifyEntry: { index: number; kind: string; amount: number; paidAt: string; receiptUrl: string } | null = null;
    if (addMonthlyPayout || removeMonthlyPayout !== undefined || updateMonthlyPayout) {
      let payouts = Array.isArray(currentApp.monthlyPayouts) ? (currentApp.monthlyPayouts as Record<string, unknown>[]) : [];
      if (removeMonthlyPayout !== undefined) {
        payouts = payouts.filter((_, i) => i !== removeMonthlyPayout);
      }
      if (updateMonthlyPayout) {
        const { index, proofUrl, notified, acknowledged } = updateMonthlyPayout;
        payouts = payouts.map((p, i) => {
          if (i !== index) return p;
          const now = new Date().toISOString();
          const next = { ...p };
          if (proofUrl !== undefined) next.proofUrl = proofUrl;
          if (notified !== undefined) { next.notified = notified; next.notifiedAt = notified ? now : null; }
          if (acknowledged !== undefined) { next.acknowledged = acknowledged; next.acknowledgedAt = acknowledged ? now : null; }
          return next;
        });
        // Attaching a receipt (proofUrl) to an entry that hasn't been notified yet, and
        // without an explicit notified toggle in this same request, triggers the email.
        const cleanUrl = proofUrl?.trim();
        const original = payouts[index] as Record<string, unknown> | undefined;
        if (cleanUrl && notified === undefined && original && !original.notified) {
          notifyEntry = { index, kind: String(original.kind || "monthly"), amount: Number(original.amount) || 0, paidAt: String(original.paidAt || new Date().toISOString()), receiptUrl: cleanUrl };
        }
      }
      if (addMonthlyPayout) {
        const payoutKind = addMonthlyPayout.kind || "monthly";
        const nowIso = new Date().toISOString();
        const cleanProof = addMonthlyPayout.proofUrl?.trim() || null;
        payouts = [
          ...payouts,
          {
            paidAt: nowIso,
            amount: addMonthlyPayout.amount,
            kind: payoutKind,
            method: addMonthlyPayout.method?.trim() || null,
            proofUrl: cleanProof,
            note: addMonthlyPayout.note?.trim() || null,
            accountId: addMonthlyPayout.accountId || null,
            by: admin.fullName || admin.email,
            notified: false,
            notifiedAt: null,
            acknowledged: false,
            acknowledgedAt: null,
          },
        ];
        // Logged with a receipt already attached → notify the payee for this new entry.
        if (cleanProof) {
          notifyEntry = { index: payouts.length - 1, kind: payoutKind, amount: Number(addMonthlyPayout.amount) || 0, paidAt: nowIso, receiptUrl: cleanProof };
        }
        // Paying the setup fee confirms a real conversion, so open the referrer's
        // commission (ok-to-pay) if it isn't already — mirroring the manual
        // verify toggle. The account_issue gate still independently holds
        // restricted/blocked accounts, so a restricted person stays in hold
        // until they're fixed, then opens automatically. Skip if this same
        // request already sets verifiedAt explicitly.
        if (payoutKind === "setup" && verifiedAt === undefined && !currentApp.verifiedAt) {
          updateData.verifiedAt = new Date();
        }
      }
      updateData.monthlyPayouts = payouts as Prisma.InputJsonValue;
    }

    const application = await prisma.ambassadorApplication.update({
      where: { id },
      data: updateData,
    });

    // Auto-notify the payee now that the receipt is saved. Only mark "notified" if the
    // email actually sends — a failed send stays un-notified so it can be retried.
    if (notifyEntry && application.email) {
      try {
        const payCurrency = currencyConfigFor(application.payoutCurrency, application.referredBy).currency;
        if (notifyEntry.kind === "setup") {
          await sendSetupFeePaidEmail(application.email, application.fullName, notifyEntry.amount, notifyEntry.receiptUrl, new Date(notifyEntry.paidAt), payCurrency);
        } else {
          const monthLabel = new Date(notifyEntry.paidAt).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "Asia/Manila" });
          await sendMonthlyPayoutEmail(application.email, application.fullName, notifyEntry.amount, notifyEntry.receiptUrl, monthLabel, payCurrency);
        }
        const fresh = Array.isArray(application.monthlyPayouts) ? (application.monthlyPayouts as Record<string, unknown>[]) : [];
        const now = new Date().toISOString();
        const marked = fresh.map((p, i) => (i === notifyEntry!.index ? { ...p, notified: true, notifiedAt: now } : p));
        await prisma.ambassadorApplication.update({ where: { id }, data: { monthlyPayouts: marked as Prisma.InputJsonValue } });
        application.monthlyPayouts = marked as Prisma.JsonValue;
      } catch (e) {
        console.error("[payout-notify] owner email failed:", e);
      }
    }

    // Surface the offline profile as soon as someone is ACCEPTED (approved) — so their
    // credentials/GoLogin can be filled in straight away — and again when onboarding
    // starts / they're onboarded, as a safety net. Make sure an account exists and isn't
    // hidden under_review, so it shows on the owners + inventory views. It sits OFFLINE
    // (unavailable) — not rentable — until flipped to "available" from the inventory view.
    const enteringPipeline =
      (rest.status === "approved" && currentApp.status !== "approved") ||
      (rest.status === "onboarding" && currentApp.status !== "onboarding") ||
      (!!application.onboardingStartedAt && !currentApp.onboardingStartedAt) ||
      (rest.status === "onboarded" && currentApp.status !== "onboarded") ||
      (!!application.onboardedAt && !currentApp.onboardedAt);
    if (enteringPipeline) {
      const existing = await prisma.linkedInAccount.findFirst({
        where: {
          status: { notIn: ["removed", "retired"] },
          OR: [
            { notes: { contains: `Owner: ${application.email}` } },
            ...(application.linkedinUrl ? [{ linkedinUrl: application.linkedinUrl }] : []),
          ],
        },
      });
      if (existing) {
        if (existing.status === "under_review") {
          await prisma.linkedInAccount.update({ where: { id: existing.id }, data: { status: "unavailable" } });
        }
        // If this lead was flagged restricted in the pipeline before the account was
        // linked, carry that onto the now-linked account so both views agree.
        if (await carryAppRestrictionToAccount(existing.id, application)) {
          try { await notifyRestrictionOwnerReferrer(existing.id); } catch (e) { console.error("restrict owner/referrer notify failed", e); }
        }
      } else {
        // Monthly rate follows the referrer's currency (PH ₱500 / non-PH USD $8 — see
        // lib/referral-currency). For PH, offered_amount is unreliable (it sometimes holds
        // a bogus small value), so only trust it when it's a plausible ₱ figure; otherwise
        // use the currency default. For USD the amounts are small by design, so default.
        const cfg = currencyConfigFor(application.payoutCurrency, application.referredBy);
        const offered = Number(application.offeredAmount) || 0;
        const monthly = cfg.currency === "PHP" && offered >= 100 ? offered : cfg.monthlyAmount;
        const created = await prisma.linkedInAccount.create({
          data: {
            linkedinName: application.fullName,
            linkedinUrl: application.linkedinUrl || null,
            connectionCount: application.connectionCount || 0,
            industry: application.industry || null,
            location: application.location || null,
            status: "unavailable",
            ambassadorPayment: monthly,
            gologinAccount: "klabber",
            listed: false,
            notes: `Owner: ${application.email}. Profile email: ${application.linkedinEmail || application.email}.`,
          },
        });
        // Carry a pre-account pipeline restriction flag onto the freshly-created account.
        if (await carryAppRestrictionToAccount(created.id, application)) {
          try { await notifyRestrictionOwnerReferrer(created.id); } catch (e) { console.error("restrict owner/referrer notify failed", e); }
        }
      }
    }

    // Forward sync: carry a pipeline restriction flag onto the linked account whenever it's set
    // — not only at onboarding-link time. So if a lead is flagged restricted AFTER their account
    // is already live, inventory reflects it too. No-ops if the account is already restricted.
    if (appIssueIsRestricted(application.accountIssue)) {
      const linked = await prisma.linkedInAccount.findFirst({
        where: {
          status: { notIn: ["removed", "retired"] },
          OR: [
            { notes: { contains: `Owner: ${application.email}` } },
            ...(application.linkedinUrl ? [{ linkedinUrl: application.linkedinUrl }] : []),
          ],
        },
        select: { id: true },
      });
      if (linked && await carryAppRestrictionToAccount(linked.id, application)) {
        try { await notifyRestrictionOwnerReferrer(linked.id); } catch (e) { console.error("restrict owner/referrer notify failed", e); }
      }
    }

    return NextResponse.json({ application });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Permanently remove a signup (e.g. clearing test data). The cascade (onboarding rows,
// then the account when it's safe throwaway data) lives in deleteApplicationCascade, shared
// with the referrer portal's own delete.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const { accountDeleted, accountKept } = await deleteApplicationCascade(id);
    // accountKept tells the admin when we kept a real account instead of deleting it.
    return NextResponse.json({ ok: true, accountDeleted, accountKept });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    console.error("Failed to delete application", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
