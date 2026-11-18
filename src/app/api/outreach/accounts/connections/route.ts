import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decideConnectionUpdate, parseJoinedMonth } from "@/lib/connection-count-report";

// The maturing engine reports an account's LinkedIn connection count, read from the account's
// own session during a maturing turn, about once a week. Matched by GoLogin profile id.
// Uses the engine's existing LinkedVelocity feed key (LV_ACCOUNTS_KEY there,
// OUTREACH_ACCOUNTS_KEY here); the write is narrow and validated in connection-count-report.ts.
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

  let body: { gologinProfileId?: unknown; count?: unknown; joined?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const profileId = typeof body.gologinProfileId === "string" ? body.gologinProfileId.trim() : "";
  const count = typeof body.count === "number" ? body.count : Number.NaN;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(profileId)) return NextResponse.json({ error: "gologinProfileId required" }, { status: 400 });

  const matches = await prisma.linkedInAccount.findMany({
    where: { gologinProfileId: profileId, status: { not: "removed" } },
    select: { id: true, connectionCount: true, connectionHistory: true, linkedinJoinedAt: true },
    take: 2,
  });
  if (matches.length !== 1) return NextResponse.json({ status: "skipped", reason: matches.length ? "profile matches several accounts" : "unknown profile" });
  const account = matches[0];

  // Account age: the real "Joined LinkedIn" month replaces a typed or estimated one.
  const joined = parseJoinedMonth(body.joined);
  const joinedChanged = !!joined && account.linkedinJoinedAt?.getTime() !== joined.getTime();
  if (joinedChanged) await prisma.linkedInAccount.update({ where: { id: account.id }, data: { linkedinJoinedAt: joined } });

  const decision = decideConnectionUpdate(account, count);
  if (decision.action === "skip") return NextResponse.json({ status: "skipped", reason: decision.reason, current: account.connectionCount, joinedUpdated: joinedChanged });
  await prisma.linkedInAccount.update({ where: { id: account.id }, data: { connectionCount: count, connectionHistory: decision.history } });
  return NextResponse.json({ status: "updated", previous: account.connectionCount, count, joinedUpdated: joinedChanged });
}
