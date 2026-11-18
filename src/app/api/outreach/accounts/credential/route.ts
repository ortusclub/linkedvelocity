import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Sign-in details for ONE LinkedVelocity account, for the maturing engine's automatic login
// (engine campaign-lv-auto-login.js, LV Agent — Sam, 18 Nov 2026: "it should try and log in by
// opening the GoLogin and trying to use the password which is in the backend").
//
// Engine-only: authenticated with MATURING_ENGINE_TOKEN (the engine's APP_PASSWORD), never
// the outreach feed key, which ships to browsers. One account per call, by GoLogin profile id,
// and never for removed, retired or restricted accounts. Not cached; values are never logged.
export const dynamic = "force-dynamic";

function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const noStore = { "Cache-Control": "no-store, private" };

export async function GET(req: NextRequest) {
  const expected = process.env.MATURING_ENGINE_TOKEN?.trim() || "";
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !given || !keyMatches(given, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });

  const profileId = (req.nextUrl.searchParams.get("profile") || "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(profileId)) return NextResponse.json({ error: "profile required" }, { status: 400, headers: noStore });

  const rows = await prisma.linkedInAccount.findMany({
    where: { gologinProfileId: profileId, status: { notIn: ["removed", "retired"] }, restrictedAt: null, permanentlyRestricted: false },
    select: { id: true, loginEmail: true, accountPassword: true, twoFactor: true, linkedinName: true, linkedinUrl: true },
    take: 2,
  });
  if (rows.length !== 1) return NextResponse.json({ error: rows.length ? "ambiguous profile" : "not available" }, { status: 404, headers: noStore });
  const a = rows[0];
  if (!a.loginEmail || !a.accountPassword) return NextResponse.json({ error: "no saved login" }, { status: 404, headers: noStore });
  console.log(`engine credential read for account ${a.id}`);
  return NextResponse.json({
    email: a.loginEmail.trim(),
    password: a.accountPassword,
    secret: a.twoFactor || "",
    expectedName: a.linkedinName || "",
    expectedUrl: (a.linkedinUrl || "").split("?")[0],
  }, { headers: noStore });
}
