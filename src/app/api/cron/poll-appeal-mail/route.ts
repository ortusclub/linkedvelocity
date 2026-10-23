import { NextRequest, NextResponse } from "next/server";
import { pollAppealMail } from "@/lib/account-mail";

// Pulls LinkedIn's replies to our per-appeal mailboxes from the appeal Resend account (which has no
// inbound webhook to us) and files them onto the right restrictions-v2 case + notifies the team.
// No-op until APPEAL_RESEND_API_KEY is set. Scheduled in vercel.json.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await pollAppealMail();
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "Appeal mail poll failed." }, { status: 502 });
  }
}
