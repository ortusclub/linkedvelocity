import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { categoryResolver, categoriesResolver } from "@/lib/maturing/programs.mjs";
import { prisma } from "@/lib/prisma";
import { SUSPECTED_RESTRICTION } from "@/lib/suspected-restriction";
import { connectionSummary } from "@/lib/connection-count-report";

// Read-only identity feed for the Ortus Outreach app: which LinkedIn profile
// sits behind each GoLogin profile. Outreach uses it to name an account it is
// maturing and to build warm-connection target lists.
//
// Deliberately minimal — name, URL and the two identifiers Outreach matches on
// (GoLogin profile id, login email). Never add credentials, proxy or rental
// data here: the key ships inside a desktop app. It has its own secret
// (OUTREACH_ACCOUNTS_KEY) so it can be rotated without touching other feeds.
export const dynamic = "force-dynamic";

function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const reservesOnly = req.nextUrl.searchParams.get("purpose") === "lv-reserves";
  const expected = (reservesOnly ? process.env.MATURING_ENGINE_TOKEN : process.env.OUTREACH_ACCOUNTS_KEY)?.trim() || "";
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !given || !keyMatches(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.linkedInAccount.findMany({
    // Campaign-pool accounts are our own LinkedArmy outreach personas — run by hand, never
    // by the maturing/warm-up engine. Keep them out of the engine feed entirely.
    // LinkedArmy (campaign pool) accounts are included: they mature too (Sam, 18 Nov 2026).
    where: { status: { not: "removed" }, linkedinUrl: { not: null } },
    select: {
      id: true,
      inventoryPool: true,
      heldUntil: true,
      permanentlyRestricted: true,
      gologinProfileId: true,
      loginEmail: true,
      linkedinName: true,
      linkedinUrl: true,
      status: true,
      exitReason: true,
      restrictedAt: true,
      notes: true,
      twoFactorResetNeeded: true,
      maturingStartFailedAt: true,
      maturingStartFailedReason: true,
      linkedinAccountHealth: true,
      connectionHistory: true, // reduced to the engine-read summary below
      accountPassword: true, // only reduced to hasPassword below; never sent
      rentals: {
        where: { status: { in: ["active", "pending_access", "payment_failed"] } },
        select: { id: true },
        take: 1,
      },
    },
  });

  // Why an account has no maturing plan yet, and when it should start — so Profile Maturing can
  // list it as "Scheduled" instead of silently leaving it out (Sam, 18 Nov 2026). Mirrors the
  // auto-start cool-downs: 14 days' rest after a rental ends, 6 h after a failed start.
  const RELEASE_REST_MS = Math.max(0, Number(process.env.MATURING_RELEASE_COOLDOWN_DAYS ?? 14)) * 86400000;
  const STARTFAIL_MS = Math.max(1, Number(process.env.MATURING_STARTFAIL_COOLDOWN_H) || 6) * 3600000;
  const released = await prisma.rental.findMany({ where: { accessRevokedAt: { gte: new Date(Date.now() - RELEASE_REST_MS) } }, select: { linkedinAccountId: true, accessRevokedAt: true } });
  const releasedAt = new Map<string, number>();
  for (const r of released) if (r.linkedinAccountId && r.accessRevokedAt) releasedAt.set(r.linkedinAccountId, Math.max(releasedAt.get(r.linkedinAccountId) || 0, r.accessRevokedAt.getTime()));
  const waitingFor = (a: { id: string; maturingStartFailedAt: Date | null; maturingStartFailedReason: string | null }) => {
    const rel = releasedAt.get(a.id);
    if (rel) return { reason: "Resting after rental", startsAt: new Date(rel + RELEASE_REST_MS).toISOString() };
    if (a.maturingStartFailedAt) return { reason: `Start failed · ${(a.maturingStartFailedReason || "").replace(/^couldn't start\s*[—–-]\s*/i, "").slice(0, 120)}`, startsAt: new Date(a.maturingStartFailedAt.getTime() + STARTFAIL_MS).toISOString() };
    return { reason: "Starting soon", startsAt: null };
  };

  const [apps,sessions] = await Promise.all([
    prisma.ambassadorApplication.findMany({select:{id:true,verifiedAt:true,status:true,linkedinUrl:true,email:true,applicationReceived:true,paidAt:true,onboardedAt:true}}),
    prisma.selfServiceOnboarding.findMany({select:{accountId:true,applicationId:true,state:true}}),
  ]);
  const category=categoryResolver(apps,sessions);
  const categories=categoriesResolver(apps,sessions);
  const accounts = rows
    // Showcase/demo accounts are catalogue props, not real LinkedIn profiles.
    .filter((a) => !(a.notes || "").includes("[SHOWCASE]"))
    .filter((a) => !(a.status === "unavailable" && a.exitReason))
    .filter((a) => a.gologinProfileId || a.loginEmail)
    .map((raw) => ({ ...raw, hasPassword: !!raw.accountPassword, accountPassword: undefined }))
    .map((a) => ({
      // Eligibility only; assignment happens in Outreach when Start is clicked.
      reserveEligible: a.inventoryPool === "main" && a.status === "available"
        && category(a) === "available" && !a.twoFactorResetNeeded
        && !a.restrictedAt && !a.permanentlyRestricted && a.rentals.length === 0
        && (!a.heldUntil || a.heldUntil.getTime() <= Date.now())
        && !!a.gologinProfileId && !!a.loginEmail && a.hasPassword,
      maturingCategory: category(a),
      maturingCategories: categories(a),
      // Why auto-start last failed to launch this account, so the Outreach board can
      // say it under a stopped row (Sam, 2026-11-08). Cleared on a successful start.
      maturingStartFailedAt: a.maturingStartFailedAt || null,
      maturingStartFailedReason: a.maturingStartFailedReason || "",
      // Shown on Profile Maturing only when the account has no plan: why, and when it starts.
      maturingWaiting: waitingFor(a),
      // Weekly LinkedIn connection readings taken during maturing: latest count + 30-day change.
      connections: connectionSummary(a.connectionHistory),
      gologinProfileId: a.gologinProfileId || "",
      loginEmail: (a.loginEmail || "").trim().toLowerCase(),
      name: a.linkedinName,
      linkedinUrl: a.linkedinUrl,
      // Restricted profiles can still be named, but are no use as invite targets.
      restricted: a.status === "retired" || !!a.restrictedAt || a.permanentlyRestricted || a.linkedinAccountHealth === SUSPECTED_RESTRICTION,
      // LV Agent: profile not available from a healthy account. Off Profile Maturing.
      suspectedRestriction: a.linkedinAccountHealth === SUSPECTED_RESTRICTION,
      // Eligibility only: do not expose renters or rental details to Outreach.
      rented: a.status === "rented" || a.rentals.length > 0,
    }));

  return NextResponse.json({ accounts: reservesOnly ? accounts.filter(a => a.reserveEligible) : accounts });
}
