import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { currencyConfigFor, currencyConfig } from "@/lib/referral-currency";
import { sendSetupFeePaidEmail, sendMonthlyPayoutEmail, sendReferralPayoutEmail } from "@/services/email";

// Record a payout made manually in Wise, from the unified console: append it to the ledger,
// attach the Wise receipt, and email the payee (the receipt notification). One action for all
// three payout kinds. Moves no money — it logs a payment the admin already sent in Wise.
//
// Body: { id (row id), payeeKey, kind, amount, receiptUrl }. For referrals the row id is
// "ref:<applicationId>"; for ambassadors payeeKey is "amb:<email>".

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const id: string = typeof body.id === "string" ? body.id : "";
    const payeeKey: string = typeof body.payeeKey === "string" ? body.payeeKey : "";
    const kind: "setup" | "monthly" | "referral" = body.kind === "setup" ? "setup" : body.kind === "referral" ? "referral" : "monthly";
    const amount = Number(body.amount);
    const receiptUrl: string = typeof body.receiptUrl === "string" ? body.receiptUrl.trim() : "";
    if (!receiptUrl) return NextResponse.json({ error: "A Wise receipt link is required." }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "A positive amount is required." }, { status: 400 });
    const by = admin.fullName || admin.email || "admin";
    const nowISO = new Date().toISOString();

    if (kind === "referral") {
      const applicationId = id.startsWith("ref:") ? id.slice(4) : id;
      const app = await prisma.ambassadorApplication.findUnique({
        where: { id: applicationId },
        select: { fullName: true, referredBy: true },
      });
      if (!app) return NextResponse.json({ error: "Referral application not found." }, { status: 404 });
      const slug = (app.referredBy || "").trim();
      const referrer = slug ? await prisma.referrer.findFirst({
        where: { OR: [{ slug: { equals: slug, mode: "insensitive" } }, { name: { equals: slug, mode: "insensitive" } }] },
        select: { id: true, slug: true, name: true, email: true },
      }) : null;
      if (!referrer) return NextResponse.json({ error: `Referrer "${slug}" not found.` }, { status: 404 });

      const existing = await prisma.payout.findFirst({
        where: { type: "commission", ambassadorApplicationId: applicationId, paidAt: { not: null } },
        select: { id: true },
      });
      if (existing) return NextResponse.json({ ok: true, alreadyPaid: true });

      await prisma.payout.create({
        data: {
          referrerId: referrer.id, type: "commission", ambassadorApplicationId: applicationId,
          amount, description: `Commission for ${app.fullName}`, paidAt: new Date(), paidBy: by,
          reference: receiptUrl, notifiedAt: new Date(),
        },
      });
      const cur = currencyConfig(referrer.slug).currency;
      if (referrer.email) {
        try { await sendReferralPayoutEmail(referrer.email, referrer.name || referrer.slug, amount, receiptUrl, app.fullName, 1, cur); }
        catch (e) { console.error("[mark-paid] referral email failed", e); }
      }
      return NextResponse.json({ ok: true });
    }

    // Ambassador setup / monthly — append to the owner application's monthlyPayouts ledger.
    const email = payeeKey.startsWith("amb:") ? payeeKey.slice(4) : payeeKey;
    const app = await prisma.ambassadorApplication.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      orderBy: { onboardedAt: "desc" },
      select: { id: true, email: true, fullName: true, monthlyPayouts: true, paidAt: true, payoutCurrency: true, referredBy: true, diyTier: true },
    });
    if (!app) return NextResponse.json({ error: "No ambassador application for this payee." }, { status: 404 });

    const entries = Array.isArray(app.monthlyPayouts) ? [...(app.monthlyPayouts as unknown[])] : [];
    entries.push({ kind, amount, paidAt: nowISO, proofUrl: receiptUrl, by, notified: true, notifiedAt: nowISO });
    await prisma.ambassadorApplication.update({
      where: { id: app.id },
      data: { monthlyPayouts: entries as never, ...(kind === "setup" && !app.paidAt ? { paidAt: new Date() } : {}) },
    });

    const cur = currencyConfigFor(app.payoutCurrency, app.referredBy, app).currency;
    try {
      if (kind === "setup") await sendSetupFeePaidEmail(app.email, app.fullName || app.email, amount, receiptUrl, new Date(), cur);
      else {
        const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "Asia/Manila" });
        await sendMonthlyPayoutEmail(app.email, app.fullName || app.email, amount, receiptUrl, monthLabel, cur);
      }
    } catch (e) { console.error("[mark-paid] ambassador email failed", e); }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Couldn't record the payment." }, { status: 500 });
  }
}
