import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { restrictionUpdate } from "@/lib/restriction";
import { notifyBillingPaused } from "@/lib/billing-pause-notify";

// Restriction report from the Ortus Outreach engine. When the engine's SoO check
// sees that a LinkedIn profile it is maturing has been restricted, it POSTs here so
// the restriction lands on our side with a timestamp — the same mark a human makes
// via /admin/accounts/[id]/restricted. Without this, restrictions detected DURING
// maturing never reach lv-main, so the during-maturing vs post-onboarding counts
// under-report.
//
// Keyed by gologinProfileId (or loginEmail) because the engine does not hold our
// account id. Shares OUTREACH_ACCOUNTS_KEY with the read feed (/api/outreach/accounts),
// the key that already ships inside the engine.
//
// MARK ONLY: this never clears a restriction. Recovery credits rental downtime (money)
// and stays with our human/QR recovery flow, so an automated source can't trigger it.
export const dynamic = "force-dynamic";

function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = (process.env.OUTREACH_ACCOUNTS_KEY || "").trim();
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !given || !keyMatches(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const gologinProfileId = typeof body.gologinProfileId === "string" ? body.gologinProfileId.trim() : "";
  const loginEmail = typeof body.loginEmail === "string" ? body.loginEmail.trim().toLowerCase() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!gologinProfileId && !loginEmail) {
    return NextResponse.json({ error: "gologinProfileId or loginEmail required" }, { status: 400 });
  }

  // Prefer the GoLogin id (stable); fall back to login email. loginEmail is not unique in
  // the schema, so match defensively on the lowercased value.
  const account = gologinProfileId
    ? await prisma.linkedInAccount.findFirst({ where: { gologinProfileId } })
    : await prisma.linkedInAccount.findFirst({ where: { loginEmail: { equals: loginEmail, mode: "insensitive" } } });
  if (!account) {
    return NextResponse.json({ error: "Account not found", matched: false }, { status: 404 });
  }

  // Already restricted, rented-out handling, retired etc. are all respected by
  // restrictionUpdate (it no-ops a repeat restrict and keeps the original timestamp),
  // so repeated engine pushes are safe and create no duplicate log entries.
  const wasRestricted = !!account.restrictedAt;
  const reason = note || "Auto-detected during maturing (engine SoO)";
  const fields = await restrictionUpdate(account, true, reason);
  const updated = await prisma.linkedInAccount.update({
    where: { id: account.id },
    data: { restrictedAt: fields.restrictedAt, ...(fields.restrictionLog ? { restrictionLog: fields.restrictionLog } : {}) },
  });

  const newlyRestricted = !wasRestricted && !!updated.restrictedAt;

  // Newly restricted (was clear, now set): tell any real renter(s) their billing is paused,
  // exactly as the admin mark does.
  if (newlyRestricted) {
    const renters = await prisma.rental.findMany({
      where: { linkedinAccountId: account.id, isShadow: false, status: { in: ["active", "pending_access", "payment_failed"] } },
      select: { userId: true },
    });
    const seen = new Set<string>();
    for (const r of renters) {
      if (seen.has(r.userId)) continue;
      seen.add(r.userId);
      await notifyBillingPaused(r.userId, { trigger: "restricted", highlightAccount: account.linkedinName });
    }
  }

  return NextResponse.json({
    matched: true,
    accountId: account.id,
    restrictedAt: updated.restrictedAt,
    newlyRestricted,
  });
}
