import { NextRequest, NextResponse } from "next/server";
import { runBenchSweep } from "@/lib/outreach-bench-sweep";

export const maxDuration = 300;

// Automated leak sweep: bench any rented/restricted/unavailable LV account that is
// staffed in a live outreach campaign, so a renter's account is never double-booked.
// Scheduled in vercel.json; also callable manually with the CRON_SECRET.
function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  return !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runBenchSweep();
    if (result.benched > 0 || result.failed > 0) {
      console.log(`[bench-sweep] benched ${result.benched}, failed ${result.failed}, of ${result.placementsFound} ineligible placements`, result.details);
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[bench-sweep] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
