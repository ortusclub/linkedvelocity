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
      // A consolidated referrer row covers several referrals (body.apps); a single-referral
      // row falls back to the one id. Record one attributed commission payout per referral
      // (mirrors /admin/referrals — no amount-netting), then email the referrer once for the
      // combined total. Already-paid referrals are skipped so re-recording never double-pays.
      const apps: { applicationId: string; amount: number }[] = Array.isArray(body.apps) && body.apps.length
        ? body.apps
            .filter((a: unknown): a is { applicationId: string; amount: unknown } => !!a && typeof (a as { applicationId?: unknown }).applicationId === "string")
            .map((a: { applicationId: string; amount: unknown }) => ({ applicationId: a.applicationId, amount: Number(a.amount) || 0 }))
        : [{ applicationId: id.startsWith("ref:") ? id.slice(4) : id, amount }];

      let referrer: { id: string; slug: string; name: string | null; email: string | null } | null = null;
      const paidNames: string[] = [];
      let total = 0;
      for (const a of apps) {
        const app = await prisma.ambassadorApplication.findUnique({
          where: { id: a.applicationId },
          select: { fullName: true, referredBy: true },
        });
        if (!app) continue;
        if (!referrer) {
          const slug = (app.referredBy || "").trim();
          referrer = slug ? await prisma.referrer.findFirst({
            where: { OR: [{ slug: { equals: slug, mode: "insensitive" } }, { name: { equals: slug, mode: "insensitive" } }] },
            select: { id: true, slug: true, name: true, email: true },
          }) : null;
          if (!referrer) return NextResponse.json({ error: `Referrer "${slug}" not found.` }, { status: 404 });
        }
        const existing = await prisma.payout.findFirst({
          where: { type: "commission", ambassadorApplicationId: a.applicationId, paidAt: { not: null } },
          select: { id: true },
        });
        if (existing) continue;
        await prisma.payout.create({
          data: {
            referrerId: referrer.id, type: "commission", ambassadorApplicationId: a.applicationId,
            amount: a.amount, description: `Commission for ${app.fullName}`, paidAt: new Date(), paidBy: by,
            reference: receiptUrl, notifiedAt: new Date(),
          },
        });
        paidNames.push(app.fullName || "referral"); total += a.amount;
      }
      if (!referrer) return NextResponse.json({ error: "Referral application not found." }, { status: 404 });
      if (paidNames.length === 0) return NextResponse.json({ ok: true, alreadyPaid: true });
      const cur = currencyConfig(referrer.slug).currency;
      if (referrer.email) {
        try { await sendReferralPayoutEmail(referrer.email, referrer.name || referrer.slug, total, receiptUrl, paidNames.join(", "), paidNames.length, cur); }
        catch (e) { console.error("[mark-paid] referral email failed", e); }
      }
      return NextResponse.json({ ok: true });
    }

    // A consolidated setup row (body.setups) covers several ambassadors whose setup fee lands in
    // one payout account — one Wise transfer. Record one setup entry per ambassador and email
    // each with the shared receipt. Already-settled setups are skipped so re-recording is safe.
    if (kind === "setup" && Array.isArray(body.setups) && body.setups.length) {
      const setups = body.setups
        .filter((s: unknown): s is { email: string; amount: unknown } => !!s && typeof (s as { email?: unknown }).email === "string")
        .map((s: { email: string; amount: unknown }) => ({ email: s.email, amount: Number(s.amount) || 0 }));
      const paidNames: string[] = [];
      for (const s of setups) {
        const app = await prisma.ambassadorApplication.findFirst({
          where: { email: { equals: s.email, mode: "insensitive" } },
          orderBy: { onboardedAt: "desc" },
          select: { id: true, email: true, fullName: true, monthlyPayouts: true, paidAt: true, payoutCurrency: true, referredBy: true, diyTier: true },
        });
        if (!app) continue;
        const entries = Array.isArray(app.monthlyPayouts) ? [...(app.monthlyPayouts as Array<{ kind?: string; proofUrl?: string | null }>)] : [];
        if (entries.some((e) => e?.kind === "setup" && !!e?.proofUrl)) continue; // already settled
        entries.push({ kind: "setup", amount: s.amount, paidAt: nowISO, proofUrl: receiptUrl, by, notified: true, notifiedAt: nowISO } as never);
        await prisma.ambassadorApplication.update({
          where: { id: app.id },
          data: { monthlyPayouts: entries as never, ...(app.paidAt ? {} : { paidAt: new Date() }) },
        });
        const cur = currencyConfigFor(app.payoutCurrency, app.referredBy, app).currency;
        try { await sendSetupFeePaidEmail(app.email, app.fullName || app.email, s.amount, receiptUrl, new Date(), cur); }
        catch (e) { console.error("[mark-paid] setup email failed", e); }
        paidNames.push(app.fullName || app.email);
      }
      return NextResponse.json({ ok: true, paid: paidNames.length });
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
