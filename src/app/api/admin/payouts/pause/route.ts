import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendReferralOutreachEmail } from "@/services/email";
import { PAUSE_REASONS, reasonNote, ownerPauseEmail, referrerHeadsUpEmail, type PauseReason } from "@/lib/payout-pause";

// Pause a payout from the console: optionally email the owner (body edited in the UI) and/or
// a short heads-up to the referrer, then record {reason, pausedAt, emailed} so the row shows
// as held until resumed. Emails are best-effort — the pause is recorded even if a send fails.
// Moves no money.

const firstName = (full: string | null | undefined, fallback: string) => (full || fallback).trim().split(/\s+/)[0] || fallback;

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const payeeKey: string = typeof body.payeeKey === "string" ? body.payeeKey.trim() : "";
    const reason: string = typeof body.reason === "string" ? body.reason : "";
    const notifyOwner = !!body.notifyOwner;
    const notifyReferrer = !!body.notifyReferrer;
    const ownerEmailBody: string | null = typeof body.ownerEmailBody === "string" ? body.ownerEmailBody : null;
    if (!payeeKey) return NextResponse.json({ error: "payeeKey required" }, { status: 400 });
    if (!PAUSE_REASONS.includes(reason as PauseReason)) return NextResponse.json({ error: "invalid reason" }, { status: 400 });

    // Resolve who to email. Owner = the ambassador (amb:) or the referrer themselves (ref:).
    let ownerEmail: string | null = null, ownerFirst = "there";
    let referrerEmail: string | null = null;
    if (payeeKey.startsWith("amb:")) {
      const email = payeeKey.slice(4);
      const app = await prisma.ambassadorApplication.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        orderBy: { onboardedAt: "desc" },
        select: { fullName: true, email: true, referredBy: true },
      });
      ownerEmail = app?.email || email;
      ownerFirst = firstName(app?.fullName, "there");
      const slug = app?.referredBy?.trim().toLowerCase();
      if (slug) {
        const ref = await prisma.referrer.findFirst({ where: { slug: { equals: slug, mode: "insensitive" } }, select: { email: true } });
        referrerEmail = ref?.email || null;
      }
    } else if (payeeKey.startsWith("ref:")) {
      const slug = payeeKey.slice(4);
      const ref = await prisma.referrer.findFirst({ where: { slug: { equals: slug, mode: "insensitive" } }, select: { email: true, name: true, paymentName: true } });
      ownerEmail = ref?.email || null;
      ownerFirst = firstName(ref?.name || ref?.paymentName, "there");
    }

    const emailed: string[] = [];
    if (notifyOwner && ownerEmail) {
      const subject = ownerPauseEmail(reason, { first: ownerFirst, kind: "", amt: "", dest: "" }).subject;
      const text = ownerEmailBody || ownerPauseEmail(reason, { first: ownerFirst, kind: "payout", amt: "", dest: "your account" }).body;
      try { await sendReferralOutreachEmail(ownerEmail, subject, text); emailed.push("owner"); }
      catch (e) { console.error("[payouts/pause] owner email failed", e); }
    }
    if (notifyReferrer && referrerEmail) {
      const { subject, body: text } = referrerHeadsUpEmail(ownerFirst);
      try { await sendReferralOutreachEmail(referrerEmail, subject, text); emailed.push("referrer"); }
      catch (e) { console.error("[payouts/pause] referrer email failed", e); }
    }

    const pausedAt = new Date();
    await prisma.payoutOverride.upsert({
      where: { key: payeeKey },
      create: { key: payeeKey, pauseReason: reason, pausedAt, pauseNote: reasonNote(reason), pauseEmailed: emailed },
      update: { pauseReason: reason, pausedAt, pauseNote: reasonNote(reason), pauseEmailed: emailed },
    });
    return NextResponse.json({ ok: true, pause: { reason, pausedAt: pausedAt.toISOString(), note: reasonNote(reason), emailed } });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
