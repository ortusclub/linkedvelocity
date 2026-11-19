import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

/**
 * Stripe -> ledger reconciliation (detect-only; never writes).
 *
 * The webhook records a Stripe charge only when its subscription is attached to a
 * rental (or it is a website checkout / off-session charge). Legacy multi-account
 * Payment-Link subscriptions, and anything else the webhook misses, fall through.
 * This walks every Stripe charge in a trailing window and decides whether our
 * `transactions` ledger already accounts for it, so nothing is silently lost.
 *
 * Matching is deliberately forgiving (it would rather not raise a false alarm on a
 * payment that IS recorded): a charge is "accounted" if the ledger has an id-keyed
 * sentinel for it, OR a same-amount entry near the same date for the paying user
 * (by Stripe customer or billing email), OR — for legacy payers we can't map to a
 * user — any same-amount entry near that date. Everything else is a "gap" to enter
 * by hand. It writes nothing; posting stays a human action (the amount-based match
 * can't be trusted to auto-post without double-counting the messy legacy entries).
 *
 * NOTE: charge.invoice is not reliably populated by Stripe here (undefined even when
 * an invoice exists), so we never depend on it alone — amount/date/customer carry the
 * match. Going forward every website payment is id-keyed, so this mostly confirms
 * "all accounted" and surfaces only genuine gaps.
 */

export type ReconStatus = "accounted" | "gap";

export interface ReconCharge {
  id: string;
  amount: number;
  date: string; // YYYY-MM-DD
  customerEmail: string;
  descriptor: string;
  status: ReconStatus;
  attributedTo?: string; // our user's email, when we could map the payer
  reason: string;
}

export interface ReconResult {
  windowDays: number;
  chargeCount: number;
  collected: number;
  accountedCount: number;
  gapCount: number;
  gapTotal: number;
  gaps: ReconCharge[];
  charges: ReconCharge[];
}

const SENTINEL_RE = /stripe_(sub_payment|topup|recon):|rental_renewal:/;
const DAY = 86_400_000;
const near = (aMs: number, bMs: number, days: number) => Math.abs(aMs - bMs) <= days * DAY;
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;

// Does any non-empty subset of `amountsCents` sum exactly to `targetCents`? Used to match
// one Stripe charge against several per-account ledger rows (a grouped renewal recorded as
// split entries), so a renter with more than one batch in the window still matches the
// right subset instead of the whole window. Works in integer cents; rows are capped by the
// caller, so the reachable-sums set stays small.
function subsetSumHits(amountsCents: number[], targetCents: number): boolean {
  if (targetCents <= 0) return false;
  const reachable = new Set<number>([0]);
  for (const a of amountsCents) {
    for (const s of [...reachable]) {
      const next = s + a;
      if (next > targetCents) continue; // amounts are positive — never overshoot
      if (next === targetCents) return true;
      reachable.add(next);
    }
  }
  return false;
}

export async function reconcileStripe({ sinceDays = 60 }: { sinceDays?: number } = {}): Promise<ReconResult> {
  const sinceSec = Math.floor(Date.now() / 1000) - sinceDays * 86_400;

  // 1) Ground truth: every succeeded, non-refunded Stripe charge in the window.
  const charges: Stripe.Charge[] = [];
  for await (const ch of stripe.charges.list({ created: { gte: sinceSec }, limit: 100 })) {
    if (ch.status === "succeeded" && ch.paid && !ch.refunded) charges.push(ch);
  }

  // 2) Our ledger (reach back a week so date-window matching has room at the edge).
  const ledger = await prisma.transaction.findMany({
    where: { createdAt: { gte: new Date((sinceSec - 7 * 86_400) * 1000) } },
    select: { amount: true, description: true, createdAt: true, userId: true },
  });
  const rows = ledger.map((t) => ({ amount: Number(t.amount), at: t.createdAt.getTime(), userId: t.userId, desc: t.description || "" }));
  const descBlob = rows.map((r) => r.desc).join("\n");
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) { const a = byUser.get(r.userId) || []; a.push(r); byUser.set(r.userId, a); }

  // 3) Attribute charges to users: Stripe customer id (@unique) first, then billing email.
  const custIds = [...new Set(charges.map((c) => (typeof c.customer === "string" ? c.customer : c.customer?.id)).filter(Boolean) as string[])];
  const emails = [...new Set(charges.map((c) => (c.billing_details?.email || c.receipt_email || "").toLowerCase()).filter(Boolean))];
  const [byCustList, byEmailList] = await Promise.all([
    custIds.length ? prisma.user.findMany({ where: { stripeCustomerId: { in: custIds } }, select: { id: true, email: true, stripeCustomerId: true } }) : Promise.resolve([]),
    emails.length ? prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } }) : Promise.resolve([]),
  ]);
  const userByCust = new Map(byCustList.map((u) => [u.stripeCustomerId as string, u]));
  const userByEmail = new Map(byEmailList.map((u) => [u.email.toLowerCase(), u]));

  const out: ReconCharge[] = [];
  let collected = 0;
  for (const ch of charges) {
    const amt = ch.amount / 100;
    const atMs = ch.created * 1000;
    collected += amt;
    const custId = typeof ch.customer === "string" ? ch.customer : ch.customer?.id;
    const email = (ch.billing_details?.email || ch.receipt_email || "").toLowerCase();
    const user = (custId ? userByCust.get(custId) : undefined) || (email ? userByEmail.get(email) : undefined);

    // (a) id-keyed sentinel, when we can resolve one (bonus — not relied on alone).
    const keys = [`stripe_recon:${ch.id}`];
    const rawInvoice = (ch as unknown as { invoice?: string | { id?: string } | null }).invoice;
    const invoiceId = typeof rawInvoice === "string" ? rawInvoice : rawInvoice?.id;
    if (invoiceId) keys.push(`stripe_sub_payment:${invoiceId}`);
    if (!invoiceId && ch.payment_intent) {
      try {
        const piId = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent.id;
        const ss = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 });
        if (ss.data[0]) keys.push(`stripe_topup:${ss.data[0].id}`, `rental_renewal:${ss.data[0].id}`);
      } catch { /* best-effort */ }
    }
    let accounted = keys.some((k) => descBlob.includes(k));
    let reason = accounted ? "matched by Stripe id" : "";

    // (b) same-amount entry near the date for this user; or a SUBSET of nearby per-account
    // entries summing to it (one grouped Stripe charge recorded as several split rows).
    // We look for a subset that sums to the charge — not the whole window — so a renter
    // with more than one batch in the window (e.g. back-to-back daily card runs) still
    // matches the right subset instead of overshooting.
    if (!accounted && user) {
      const mine = (byUser.get(user.id) || []).filter((r) => near(r.at, atMs, 12));
      if (mine.some((r) => eq(Math.abs(r.amount), amt))) { accounted = true; reason = "matched to this renter's ledger entry"; }
      else {
        const tight = mine
          .filter((r) => near(r.at, atMs, 3))
          .sort((a, b) => Math.abs(a.at - atMs) - Math.abs(b.at - atMs))
          .slice(0, 25); // cap so the subset-sum set stays bounded
        const cents = tight.map((r) => Math.round(Math.abs(r.amount) * 100));
        if (subsetSumHits(cents, Math.round(amt * 100))) { accounted = true; reason = "matched to this renter's split entries"; }
      }
    }

    // (c) legacy payer we can't map to a user: any same-amount entry near the date.
    if (!accounted) {
      if (rows.some((r) => near(r.at, atMs, 4) && eq(Math.abs(r.amount), amt))) {
        accounted = true;
        reason = user ? "amount matched in ledger" : "amount matched (Stripe customer not linked to a user)";
      }
    }

    out.push({
      id: ch.id,
      amount: amt,
      date: new Date(atMs).toISOString().slice(0, 10),
      customerEmail: email || "(none)",
      descriptor: ch.description || "",
      status: accounted ? "accounted" : "gap",
      attributedTo: user?.email,
      reason: accounted ? reason : user ? "no ledger entry found for this charge" : "no matching user and no ledger entry — enter by hand",
    });
  }

  const gaps = out.filter((c) => c.status === "gap");
  return {
    windowDays: sinceDays,
    chargeCount: charges.length,
    collected,
    accountedCount: out.length - gaps.length,
    gapCount: gaps.length,
    gapTotal: gaps.reduce((s, c) => s + c.amount, 0),
    gaps,
    charges: out,
  };
}
