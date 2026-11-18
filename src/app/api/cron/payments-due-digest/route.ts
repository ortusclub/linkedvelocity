import { NextRequest, NextResponse } from "next/server";
import { computePaymentsDue } from "@/lib/payment-schedule";
import { sendPaymentsDueDigest } from "@/services/email";

// Weekly "who's due to be paid" digest, emailed to Milee. Ambassadors are paid on
// Thursdays, so this runs Thursday morning. Vercel cron hits it via GET.

const DIGEST_TO = process.env.PAYMENTS_DIGEST_EMAIL || "milee@linkedvelocity.com";

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

async function run(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await computePaymentsDue();
    await sendPaymentsDueDigest(DIGEST_TO, data);
    return NextResponse.json({
      ok: true,
      to: DIGEST_TO,
      due: { setup: data.setup.length, monthly: data.monthly.length, marketers: data.marketers.length },
      totalDueNow: data.totalDueNow,
    });
  } catch (e) {
    console.error("payments-due-digest cron error:", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
