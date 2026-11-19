import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decideRecoveryProbe } from "@/lib/recovery-probe";

// The LV Agent rechecks RESTRICTED accounts for recovery: it loads the account's own linkedinUrl
// from a healthy, logged-in LV session and reports whether the profile still renders. Matched by
// GoLogin profile id. Uses the same feed key as the connection report (OUTREACH_ACCOUNTS_KEY).
// This only records the observation — it NEVER clears restrictedAt. A `loaded` profile surfaces a
// "verify" flag on Restrictions v2; a human confirms and recovers through the recovery-case flow.
export const dynamic = "force-dynamic";

function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = process.env.OUTREACH_ACCOUNTS_KEY?.trim() || "";
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !given || !keyMatches(given, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { gologinProfileId?: unknown; loaded?: unknown; from?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const profileId = typeof body.gologinProfileId === "string" ? body.gologinProfileId.trim() : "";
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(profileId)) return NextResponse.json({ error: "gologinProfileId required" }, { status: 400 });
  if (typeof body.loaded !== "boolean") return NextResponse.json({ error: "loaded (boolean) required" }, { status: 400 });

  const matches = await prisma.linkedInAccount.findMany({
    where: { gologinProfileId: profileId, status: { not: "removed" } },
    select: { id: true, restrictedAt: true, permanentlyRestricted: true, status: true },
    take: 2,
  });
  if (matches.length !== 1) return NextResponse.json({ status: "skipped", reason: matches.length ? "profile matches several accounts" : "unknown profile" });
  const account = matches[0];

  const decision = decideRecoveryProbe(account, body.loaded, typeof body.from === "string" ? body.from : undefined);
  if (decision.action === "skip") return NextResponse.json({ status: "skipped", reason: decision.reason });
  await prisma.linkedInAccount.update({ where: { id: account.id }, data: { recoveryProbe: decision.probe } });
  return NextResponse.json({ status: "recorded", loaded: decision.probe.loaded, flagsRecovery: decision.probe.loaded });
}
