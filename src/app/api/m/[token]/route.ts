import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isReferralEarned, referralCommissionAmount, referralMaturesAt } from "@/lib/referrals";
import { currencyConfig } from "@/lib/referral-currency";
import { monthlyDueDate, setupPaidDate } from "@/lib/payment-schedule";
import { deleteApplicationCascade } from "@/lib/application-delete";

export const dynamic = "force-dynamic";

// Payout dates are the team's Manila wall clock — format them that way so the referrer
// sees the same day the payment actually lands on, not the server's UTC day.
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });

// The commission rate + currency are per-referrer (PH = ₱500, non-PH = USD) — see
// lib/referral-currency. A signup only counts (and pays) once the referred account
// is onboarded AND confirmed "ok to pay" (verifiedAt) with no login issue — see
// lib/referrals. Being merely accepted/onboarded is NOT enough; we confirm the
// account is good first.

// Public marketer portal data, keyed by the secret token in the URL. Returns the
// referrer's own figures, a PII-free competitive board (counts only), and the
// referrer's own signup feed (names, no email/number — never other marketers').
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const me = await prisma.referrer.findUnique({ where: { token } });
  if (!me) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [referrers, apps, accounts, payouts] = await Promise.all([
    prisma.referrer.findMany({ select: { slug: true, name: true } }),
    prisma.ambassadorApplication.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, fullName: true, referredBy: true, referralSource: true, status: true, verifiedAt: true, accountIssue: true, onboardingFix: true, restrictionReport: true, onboardedAt: true, onboardingMethod: true, onboardingVerified: true, paidAt: true, withdrawnAt: true, createdAt: true, email: true, linkedinUrl: true, accountFreshness: true, monthlyPayouts: true, selfServiceOnboarding: { select: { state: true, id: true } } },
    }),
    // For surfacing an active LinkedIn restriction to the referrer we need the linked
    // account's live restriction flag. Match the same way the admin does (below).
    prisma.linkedInAccount.findMany({ select: { id: true, linkedinUrl: true, notes: true, restrictedAt: true, status: true, restrictionLog: true } }),
    prisma.payout.findMany({ where: { referrerId: me.id }, orderBy: { createdAt: "desc" } }),
  ]);

  // Application → account matching, mirroring src/app/api/admin/onboarding/route.ts:
  // by unique LinkedIn URL first, then an "Owner: <email>" line in the account notes,
  // but only when that email maps to exactly one account (a shared owner inbox can't
  // disambiguate). Kept minimal here — we only read restrictedAt off the match.
  const normUrl = (u?: string | null) => (u || "").split("?")[0].replace(/\/+$/, "").toLowerCase().trim();
  const byUrl = new Map<string, (typeof accounts)[number]>();
  const byOwner = new Map<string, (typeof accounts)[number]>();
  const ownerCount = new Map<string, number>();
  for (const acc of accounts) {
    const u = normUrl(acc.linkedinUrl);
    if (u && !byUrl.has(u)) byUrl.set(u, acc);
    const owner = (acc.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "")?.toLowerCase();
    if (owner) { ownerCount.set(owner, (ownerCount.get(owner) || 0) + 1); if (!byOwner.has(owner)) byOwner.set(owner, acc); }
  }
  const accountFor = (a: { linkedinUrl: string | null; email: string }) => {
    const u = normUrl(a.linkedinUrl);
    const email = (a.email || "").toLowerCase();
    return (u ? byUrl.get(u) : undefined) || (ownerCount.get(email) === 1 ? byOwner.get(email) : undefined) || null;
  };

  const nameBySlug = new Map(referrers.map((r) => [r.slug, r.name]));
  const counts = new Map<string, { signups: number; converted: number; commission: number }>();
  for (const a of apps) {
    const slug = (a.referredBy || "").trim();
    if (!slug) continue;
    const c = counts.get(slug) || { signups: 0, converted: 0, commission: 0 };
    c.signups++;
    if (isReferralEarned(a)) {
      c.converted++;
      c.commission += referralCommissionAmount(a, currencyConfig(slug).referralTiers);
    }
    counts.set(slug, c);
  }

  // Competitive board — counts only, no money, no PII. Only real referrers appear:
  // an unknown/typo'd code (someone typing a nickname into the referral field) must
  // not surface as a phantom "person" on everyone's leaderboard.
  const board = [...counts.entries()]
    .filter(([slug]) => nameBySlug.has(slug))
    .map(([slug, c]) => ({
      name: nameBySlug.get(slug)!.trim().split(/\s+/)[0], signups: c.signups, converted: c.converted,
      lifetimeEarnings: `${currencyConfig(slug).symbol}${c.commission.toLocaleString("en-US")}`,
      isMe: slug === me.slug,
    }))
    .sort((a, b) => b.signups - a.signups || b.converted - a.converted);
  if (!board.some((b) => b.isMe)) board.push({ name: me.name.trim().split(/\s+/)[0], signups: 0, converted: 0, lifetimeEarnings: `${currencyConfig(me.slug).symbol}0`, isMe: true });

  const mine = counts.get(me.slug) || { signups: 0, converted: 0, commission: 0 };
  const cfg = currencyConfig(me.slug);

  // Activity feed — this marketer's own signups only, names only (no email/number).
  const activity = apps
    .filter((a) => (a.referredBy || "").trim() === me.slug)
    .slice(0, 15)
    .map((a) => ({
      kind: isReferralEarned(a) ? "converted" : "signup",
      name: a.fullName,
      referrer: null,
      mine: true,
      date: a.createdAt,
    }));

  // Rich per-signup status for the "Your onboardings" tab: where they're stuck,
  // who's running it, the path, the fee, and whether the referrer can act.
  const money = (n: number) => `${cfg.symbol}${n.toLocaleString("en-US")}`;
  const t = cfg.referralTiers;
  const range = (lo: number, hi: number) => `${money(lo)}–${money(hi)}`;
  const mappedSignups = apps
    .filter((a) => (a.referredBy || "").trim() === me.slug)
    .map((a) => {
      const isDiy = a.referralSource === "self-service";
      const method = a.onboardingMethod; // "computer" | "phone" | null
      const state = a.selfServiceOnboarding?.state || null;
      const paid = !!a.paidAt;
      // Lifecycle flag used for card rendering/journey: true once the account is at least
      // LOGGED IN (pipeline "Mark logged in" sets onboardedAt, status still "approved") —
      // from here on there's nothing for the referrer to do but wait while we verify.
      const onboarded = a.status === "onboarded" || !!a.onboardedAt;
      // Genuinely ONBOARDED (live on inventory): the pipeline's "Mark onboarded (live)" flips
      // status→onboarded (needs a GoLogin profile + security check), or it's already paid. A
      // merely-logged-in account is NOT this. Drives the portal's "Onboarded" filter chip so it
      // doesn't count accounts still being verified (which live under "With us").
      const reachedOnboarded = paid || a.status === "onboarded";
      // The referrer may delete their OWN signup only while it's still in their hands —
      // before onboarding finishes (onboarded, or handed off to us) and before any payment.
      // Server DELETE re-checks the same rule; this flag just drives the UI affordance.
      const deletable = !paid && !onboarded && state !== "handed_off";
      // Withdraw is the keep-the-record alternative to delete, for signups the referrer can no
      // longer delete (already onboarded / handed off) but wants off their portal. Never for a
      // paid signup (a real payment record) or one still deletable (use delete there).
      const withdrawn = !!a.withdrawnAt;
      const withdrawable = !deletable && !paid && !withdrawn;
      const amount = referralCommissionAmount(a, t);
      const whoLabel = method === "phone" ? "LV ran it" : (method === "computer" || (isDiy && (onboarded || state === "handed_off"))) ? "You ran it" : isDiy ? "You ran it" : "Form only";
      const path = method === "computer" ? `Guided · computer${a.onboardingVerified ? " · verified" : ""}`
        : method === "phone" ? "Guided · phone hand-off"
        : isDiy ? "Guided" : "Form only";
      // A restriction is surfaced to the referrer whenever their referred account is
      // CURRENTLY restricted (restrictedAt set on the linked account) — at any stage,
      // including onboarded/paid, since they're the one in contact with the owner who
      // has to clear it on their phone. Fall back to the free-text accountIssue for a
      // DIY onboarding still in their hands but not yet linked to an account.
      const inProgressDiy = isDiy && !paid && !onboarded && state !== "handed_off";
      const acct = accountFor(a);
      // A retired / removed account is permanently gone, not a temporary lock the owner
      // can clear — don't offer the referrer a "clear it" / "unrestricted" flow for those.
      const recoverable = acct ? acct.status !== "retired" && acct.status !== "removed" : true;
      // Retired/removed = terminal. The lifecycle pills below would wrongly read "Verifying" /
      // "No call booked" for a permanently-restricted account, so it looks fine on the portal.
      const accountEnded = !!acct && !recoverable;
      // A rejected application is closed — kept in the records, but it must not read as
      // "Verifying" on the portal just because it once logged in (has an onboardedAt).
      const appRejected = a.status === "rejected";
      const accountRestricted = recoverable && (!!acct?.restrictedAt || (inProgressDiy && !!a.accountIssue));
      let pill: { text: string; tone: "green" | "blue" | "amber" | "red" | "grey" }, line: string, sub: string, progress: number, action: "resume" | "onboard" | "clear" | null = null, fee: string, kind: "action" | "blocked" | "waiting" | "paid";
      if (paid) {
        kind = "paid"; pill = { text: "Paid", tone: "green" }; progress = 6;
        line = "Done — account is live"; sub = "Setup fee paid and your commission is in."; fee = `${money(amount)} paid`;
      } else if (onboarded) {
        kind = "waiting"; pill = { text: "Verifying", tone: "blue" }; progress = 5;
        line = "Our team is verifying the account"; sub = "Nothing for you to do — the check releases payment."; fee = `${money(amount)} pending`;
      } else if (state === "handed_off") {
        kind = "waiting"; pill = { text: "Verifying", tone: "blue" }; progress = 4;
        line = "You handed the sign-in to us"; sub = "Our team does the GoLogin sign-in, then verifies."; fee = `${money(amount)} pending`;
      } else if (isDiy) {
        kind = "action"; pill = { text: "Resume", tone: "amber" }; progress = 3; action = "resume";
        line = "Left off mid-onboarding"; sub = "Pick up where you left off while they're still with you."; fee = range(t.phone.base, t.computer.verified);
      } else {
        kind = "action"; pill = { text: "No call booked", tone: "amber" }; progress = 1; action = "onboard";
        line = "Form in — not onboarded yet"; sub = "They filled your form. Onboard them now, or get a call booked."; fee = money(t.referral);
      }
      // Restriction takes visual priority: whatever the lifecycle stage, a currently
      // restricted account reads as "Restricted" so the referrer can help clear it. The
      // restriction card (steps + report buttons) is driven by the `restricted` flag; we
      // clear `action` here so it owns the buttons rather than the generic CTA.
      if (accountRestricted) {
        kind = "blocked"; pill = { text: "Restricted", tone: "red" }; action = null;
        line = "LinkedIn restricted the account";
        sub = "The owner clears it on their own phone — usually scanning a QR code. Tell us once it's done or already unrestricted.";
      }
      // A rejected application is a closed outcome — show it plainly instead of "Verifying".
      // (A retired/removed account below still wins, as that's the more specific reason.)
      if (appRejected) {
        kind = "blocked"; action = null; progress = 0; fee = "Not proceeding";
        pill = { text: "Rejected", tone: "red" };
        line = "This signup wasn't accepted";
        sub = "It didn't pass review. It stays in your history, but won't be onboarded or paid.";
      }
      // Terminal state takes priority over every lifecycle pill: a retired/removed account is
      // permanently gone, so it must never read as "Verifying"/"okay". No clear-it buttons
      // (restricted stays false) and no payout is implied.
      if (accountEnded) {
        kind = "blocked"; action = null; progress = 0; fee = "No payout";
        if (acct!.restrictedAt) {
          pill = { text: "Restricted", tone: "red" };
          line = "LinkedIn permanently restricted this account";
          sub = "It can't be recovered — the account has been retired. Nothing more to do here.";
        } else {
          pill = { text: "Ended", tone: "red" };
          line = "This account is no longer active";
          sub = "It has been retired from the program. Nothing more to do here.";
        }
      }
      // The referrer withdrew this signup — highest priority, it owns the display. Muted/grey,
      // no action buttons; a Restore affordance is driven by the `withdrawn` flag on the client.
      if (withdrawn) {
        kind = "blocked"; action = null; progress = 0; fee = "Withdrawn";
        pill = { text: "Withdrawn", tone: "grey" };
        line = "You withdrew this signup";
        sub = "It's hidden from your active list but kept in our records. Restore it anytime.";
      }
      // Post-sign-in fixes the team raised for this signup (email not primary / 2FA not set).
      const rawFix = a.onboardingFix as { issues?: ("application_incomplete" | "email_added" | "email_primary" | "twofa" | "password")[]; state?: "open" | "referrer_done" } | null;
      const fix = rawFix?.issues?.length ? { issues: rawFix.issues, state: rawFix.state === "referrer_done" ? "referrer_done" : "open" } : null;
      // The referrer's own report about this restriction (QR done / says recovered), so we
      // can show "you told us" and hide the buttons until the team clears it. Cleared to
      // null once the team lifts the restriction (accountRestricted goes false).
      const rawReport = a.restrictionReport as { type?: "qr_done" | "recovered"; at?: string } | null;
      const restrictionReport = accountRestricted && rawReport?.type ? { type: rawReport.type, at: rawReport.at || "" } : null;
      // LinkedIn profile URL so the referrer can open the account and check it (e.g. is a
      // restriction still on?). Prefer the linked account's URL, fall back to the application's.
      const rawLi = acct?.linkedinUrl || a.linkedinUrl || "";
      const liUrl = rawLi ? (rawLi.startsWith("http") ? rawLi : `https://${rawLi}`) : null;

      // When the PERSON THEY REFERRED gets paid — referrers get asked this. Setup fee + the
      // referrer's commission both clear ~a week AFTER QC (the same maturation clock the admin
      // pipeline shows via referralMaturesAt), then monthly on the 1st. Using the same clock
      // keeps this date identical to the admin view.
      let pay: { text: string; sub?: string } | null = null;
      if (accountEnded) {
        pay = { text: "No payout — this account was retired", sub: "a permanently restricted / retired account doesn't pay out" };
      } else if (accountRestricted) {
        pay = { text: "Payment paused while restricted", sub: "the timer resumes once the account is cleared" };
      } else if (paid) {
        const paidCount = Array.isArray(a.monthlyPayouts) ? (a.monthlyPayouts as { kind?: string }[]).filter((p) => p?.kind !== "setup").length : 0;
        const nm = monthlyDueDate(setupPaidDate(a.paidAt, a.monthlyPayouts), paidCount);
        pay = { text: "Setup fee paid ✓", sub: nm ? `next monthly around ${fmtDate(nm.toISOString())}` : "monthly payouts continue in the first few days of each month" };
      } else if (onboarded) {
        const ready = referralMaturesAt(a); // QC + 1 week; null when not QC'd yet or already matured
        if (!a.verifiedAt) {
          pay = { text: "Setup fee about a week after it passes our checks", sub: "we set the date once the account passes QC; your commission follows" };
        } else if (!ready || ready.getTime() <= Date.now()) {
          pay = { text: "Setup fee is due now", sub: "we're processing it — usually within a couple of business days; your commission follows" };
        } else {
          pay = { text: `Setup fee expected around ${fmtDate(ready.toISOString())}`, sub: "once the account clears the 1-week maturation hold; your commission follows" };
        }
      } else if (state === "handed_off") {
        pay = { text: "Setup fee about a week after sign-in", sub: "we set the exact date once we've signed in" };
      } else {
        pay = { text: "Setup fee about a week after sign-in", sub: "the exact date is set once they're signed in" };
      }
      // A short dated journey so the referrer can see WHY a signup has been with us a while —
      // e.g. it onboarded fast but the 1-week hold runs from QC (verifiedAt), not signup, so a
      // card can read "2 weeks" with a real reason. Past milestones only (the pay box owns the
      // expected/next date). Only for the "with us, nothing to do" stages; action/restricted
      // cards carry their own UI.
      type JourneyStep = { label: string; date: string | null; state: "done" | "now" | "todo" | "warn" };
      let journey: JourneyStep[] | null = null;
      if (!accountRestricted && !accountEnded) {
        const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
        const qcAt = iso(a.verifiedAt);
        if (paid || onboarded) {
          // Restriction history from the linked account's log — shown even after recovery, so the
          // referrer sees that a past restriction is why the hold ran long (restricted days get
          // credited onto the maturation clock, pushing the payout date out).
          const rlog = Array.isArray(acct?.restrictionLog) ? (acct!.restrictionLog as { at?: string; event?: string }[]) : [];
          const steps: (JourneyStep & { t: number })[] = [];
          const push = (label: string, dateIso: string | null, stepState: JourneyStep["state"]) => steps.push({ label, date: dateIso, state: stepState, t: dateIso ? new Date(dateIso).getTime() : Number.MAX_SAFE_INTEGER });
          push("Signed in", iso(a.onboardedAt), "done");
          for (const ev of rlog) {
            if (ev.event === "restricted") push("Hit a LinkedIn restriction", iso(ev.at), "warn");
            else if (ev.event === "recovered") push("Restriction cleared", iso(ev.at), "done");
          }
          push(qcAt ? "Passed our checks (QC)" : "Passing our checks (QC)", qcAt, qcAt ? "done" : "now");
          if (paid) {
            push("Setup fee paid", iso(a.paidAt), "done");
            // The account's recurring monthly payout — the referrer is the contact, so they can
            // see when the owner is next due (and relay it).
            const paidCount = Array.isArray(a.monthlyPayouts) ? (a.monthlyPayouts as { kind?: string }[]).filter((p) => p?.kind !== "setup").length : 0;
            const nm = monthlyDueDate(setupPaidDate(a.paidAt, a.monthlyPayouts), paidCount);
            if (nm) push("Next monthly payout", nm.toISOString(), "todo");
          }
          steps.sort((x, y) => x.t - y.t);
          journey = steps.map(({ t: _t, ...s }) => s);
        } else if (state === "handed_off") {
          journey = [
            { label: "Handed to our team", date: null, state: "done" },
            { label: "We sign in & check it", date: null, state: "now" },
          ];
        }
      }
      // The onboarding session to resume (the portal's "Resume onboarding" link targets it so
      // the wizard reopens where they left off instead of at the details form).
      const resumeSessionId = action === "resume" ? a.selfServiceOnboarding?.id ?? null : null;
      // The onboarding session a referrer can pull the latest LinkedIn sign-in code from,
      // without walking the wizard. Codes flow only while forwarding is live — from reserve
      // through hand-off — and stop once the session is confirmed or the account onboarded/paid.
      const codeSessionId = a.selfServiceOnboarding?.id && !onboarded && !paid && state !== "confirmed" ? a.selfServiceOnboarding.id : null;
      return { id: a.id, name: a.fullName, date: a.createdAt, whoLabel, pill, line, sub, path, fee, progress, action, kind, fix, restricted: accountRestricted, restrictionReport, liUrl, pay, journey, onboarded: reachedOnboarded, deletable, withdrawable, withdrawn, resumeSessionId, codeSessionId };
    });

  // Show EVERY signup the referrer owns — no cap. Any cap (the old one was the 25 most recent
  // by date) can hide a later signup that the pipeline still flags, which is exactly the
  // portal↔pipeline discrepancy we're fixing (jemjem-16 had a restricted account at #35 of 48).
  // Action-needed ones (restricted / resume / onboard / clear) are ordered first via a stable
  // sort so nothing urgent is buried; newest-first within each group.
  // A flagged post-sign-in fix (2FA/email/password) is the referrer's to-do too, so it ranks
  // with the action cards even though the lifecycle pill still reads "Verifying".
  const signupRank = (s: { kind: string; restricted: boolean; action: string | null; fix: unknown; withdrawn: boolean }) => (s.withdrawn ? 3 : s.kind === "blocked" || s.restricted ? 0 : s.action || (s.kind === "waiting" && s.fix) ? 1 : 2);
  const signups = [...mappedSignups].sort((a, b) => signupRank(a) - signupRank(b));

  return NextResponse.json({
    me: {
      displayCurrency: me.displayCurrency,
      name: me.name,
      slug: me.slug,
      type: me.type,
      contactMethod: me.contactMethod,
      contactHandle: me.contactHandle,
      paymentMethod: me.paymentMethod,
      paymentDetails: me.paymentDetails,
      paymentName: me.paymentName,
      assignedDay: me.assignedDay,
      assignedLocation: me.assignedLocation,
    },
    stats: { signups: mine.signups, converted: mine.converted, commission: mine.commission, rate: cfg.rate },
    config: {
      currency: cfg.currency,
      symbol: cfg.symbol,
      offer: cfg.offer,
      referralTiers: cfg.referralTiers,
      payoutMethods: cfg.payoutMethods,
      defaultPayoutMethod: cfg.defaultPayoutMethod,
    },
    board,
    activity,
    signups,
    payouts: payouts.map((p) => ({
      id: p.id,
      type: p.type,
      description: p.description,
      amount: Number(p.amount),
      method: p.method,
      reference: p.reference,
      paidAt: p.paidAt,
      confirmedAt: p.confirmedAt,
    })),
  });
}

// Marketer self-edits their own contact + payment details.
export async function PATCH(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const me = await prisma.referrer.findUnique({ where: { token } });
  if (!me) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  if (body.action === "displayCurrency") {
    if (body.currency !== "USD" && body.currency !== "PHP") return NextResponse.json({ error: "Choose USD or PHP" }, { status: 400 });
    await prisma.referrer.update({ where: { id: me.id }, data: { displayCurrency: body.currency } });
    return NextResponse.json({ ok: true });
  }


  // The referrer marks a raised fix as done from their portal, so the team knows to recheck.
  // Only their own referred signups, and only a fix that's actually open.
  if (body.action === "fixDone" && typeof body.applicationId === "string") {
    const app = await prisma.ambassadorApplication.findUnique({ where: { id: body.applicationId }, select: { referredBy: true, onboardingFix: true } });
    if (!app || (app.referredBy || "").trim() !== me.slug) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const fix = app.onboardingFix as { issues?: string[]; state?: string; raisedAt?: string } | null;
    if (fix?.issues?.length) {
      await prisma.ambassadorApplication.update({ where: { id: body.applicationId }, data: { onboardingFix: { ...fix, state: "referrer_done", doneAt: new Date().toISOString() } } });
    }
    return NextResponse.json({ ok: true });
  }

  // The referrer withdraws (or restores) one of their OWN signups — a soft-hide that keeps
  // the record. Only their own signups, never a paid one (that's a real payment record).
  if ((body.action === "withdraw" || body.action === "restore") && typeof body.applicationId === "string") {
    const app = await prisma.ambassadorApplication.findUnique({ where: { id: body.applicationId }, select: { referredBy: true, paidAt: true } });
    if (!app || (app.referredBy || "").trim() !== me.slug) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (body.action === "withdraw" && app.paidAt) return NextResponse.json({ error: "A paid signup can't be withdrawn — contact the team." }, { status: 409 });
    await prisma.ambassadorApplication.update({ where: { id: body.applicationId }, data: { withdrawnAt: body.action === "withdraw" ? new Date() : null } });
    return NextResponse.json({ ok: true });
  }

  // The referrer reports on a LinkedIn restriction from their portal: either the owner
  // has done LinkedIn's QR/ID check ("qr_done"), or they say it's already unrestricted
  // ("recovered"). We only RECORD the report for the team to verify — it never touches
  // the account's restrictedAt / restrictionLog (the team confirms before clearing it).
  if (body.action === "restrictionReport" && typeof body.applicationId === "string" && (body.type === "qr_done" || body.type === "recovered")) {
    const app = await prisma.ambassadorApplication.findUnique({ where: { id: body.applicationId }, select: { referredBy: true } });
    if (!app || (app.referredBy || "").trim() !== me.slug) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.ambassadorApplication.update({
      where: { id: body.applicationId },
      data: { restrictionReport: { type: body.type, at: new Date().toISOString(), by: "referrer" } },
    });
    return NextResponse.json({ ok: true });
  }

  const updated = await prisma.referrer.update({
    where: { id: me.id },
    data: {
      contactMethod: typeof body.contactMethod === "string" ? body.contactMethod : me.contactMethod,
      contactHandle: typeof body.contactHandle === "string" ? body.contactHandle : me.contactHandle,
      paymentMethod: typeof body.paymentMethod === "string" ? body.paymentMethod : me.paymentMethod,
      paymentDetails: typeof body.paymentDetails === "string" ? body.paymentDetails : me.paymentDetails,
      paymentName: typeof body.paymentName === "string" ? body.paymentName.trim() : me.paymentName,
    },
  });
  return NextResponse.json({
    ok: true,
    me: {
      contactMethod: updated.contactMethod,
      contactHandle: updated.contactHandle,
      paymentMethod: updated.paymentMethod,
      paymentDetails: updated.paymentDetails,
      paymentName: updated.paymentName,
    },
  });
}

// The referrer deletes one of their OWN signups from the portal — but only while it's
// still in their hands. Once onboarding has finished (the account is onboarded, or the
// sign-in was handed to us) or any payment has landed, deletion is refused: at that point
// there's a real/near-real account and money in flight, and only the team can unwind it.
// This saves the referrer having to ask us to clear a mistaken or abandoned signup.
export async function DELETE(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const me = await prisma.referrer.findUnique({ where: { token } });
  if (!me) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const applicationId = new URL(req.url).searchParams.get("applicationId");
  if (!applicationId) return NextResponse.json({ error: "Missing applicationId" }, { status: 400 });

  const app = await prisma.ambassadorApplication.findUnique({
    where: { id: applicationId },
    select: { referredBy: true, status: true, onboardedAt: true, paidAt: true, selfServiceOnboarding: { select: { state: true } } },
  });
  // Scope to the referrer's own signups — never let a token touch someone else's.
  if (!app || (app.referredBy || "").trim() !== me.slug) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Re-check eligibility server-side; the client flag is only a hint. Mirrors GET's `deletable`.
  const finishedOrPaid = !!app.paidAt || app.status === "onboarded" || !!app.onboardedAt || app.selfServiceOnboarding?.state === "handed_off";
  if (finishedOrPaid) {
    return NextResponse.json({ error: "This signup can no longer be deleted — it's finished onboarding or has been paid. Ask the team if you need it removed." }, { status: 409 });
  }

  try {
    await deleteApplicationCascade(applicationId);
  } catch (e) {
    console.error("Portal application delete failed", e);
    return NextResponse.json({ error: "Could not delete this signup. Please try again or ask the team." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
