import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Free proxy capacity that dead accounts are silently holding.
//
// A LinkedIn account keeps its proxy assignment (proxyHost/Port) even after it is
// restricted — and getProxies() counts every non-removed account on a host:port
// toward that IP's occupancy. So long-dead restricted accounts make full IPs look
// occupied and starve new onboarding of capacity, which is a big reason the pool
// "keeps overfilling" (healthy accounts pile onto the few IPs that still look free).
//
// This runs nightly and releases the proxy (DB-side only) from accounts that are:
//   - restricted (restrictedAt set) for more than RECLAIM_AFTER_DAYS, OR permanently
//     restricted,
//   - NOT rented (a rented-but-restricted account may still be in owner recovery),
//   - actually holding a proxy.
//
// RECLAIM_AFTER_DAYS is set well past the owner-recovery window (~2 days) and any
// normal appeal, so a restriction this old is treated as dead for capacity purposes.
//
// It only nulls the DB proxy columns (never touches GoLogin), so it is safe: the
// account is dead and not browsing, the slot is freed for onboarding, and if the
// account is ever recovered the provision-accounts cron re-assigns it a proxy
// (it already keys off proxyHost IS NULL). Reversible and idempotent.

export const maxDuration = 60;

const RECLAIM_AFTER_DAYS = 14; // conservative: only clearly-dead restrictions

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const restrictedBefore = new Date(Date.now() - RECLAIM_AFTER_DAYS * 86_400_000);

  const candidates = await prisma.linkedInAccount.findMany({
    where: {
      proxyHost: { not: null },
      status: { notIn: ["rented", "retired", "removed"] },
      OR: [
        { permanentlyRestricted: true },
        { restrictedAt: { lt: restrictedBefore } },
      ],
    },
    select: { id: true, linkedinName: true, proxyHost: true },
  });

  const bySubnet: Record<string, number> = {};
  for (const a of candidates) {
    const sub = (a.proxyHost ?? "").split(".").slice(0, 3).join(".");
    bySubnet[sub] = (bySubnet[sub] ?? 0) + 1;
  }

  let freed = 0;
  for (const a of candidates) {
    await prisma.linkedInAccount.update({
      where: { id: a.id },
      data: { proxyHost: null, proxyPort: null, proxyUsername: null, proxyPassword: null },
    });
    freed++;
  }

  const result = { freed, candidates: candidates.length, bySubnet };
  console.log("[proxy-reclaim]", JSON.stringify(result));
  return NextResponse.json({ ok: true, ...result });
}
