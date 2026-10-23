import { NextRequest, NextResponse } from "next/server";
import { runProxyChecks } from "@/lib/proxy-check";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily: health-check (LinkedIn), geo-verify (majority vote) and Proxy-Cheap
// billing sync across the fleet, stalest-first. Strict CRON_SECRET auth (the
// x-vercel-cron header is spoofable — don't trust it).
export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runProxyChecks(80);
  return NextResponse.json({ ok: true, summary });
}

export async function GET(req: NextRequest) { return POST(req); }
