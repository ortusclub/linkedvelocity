import { NextRequest, NextResponse } from "next/server";
import { revokeRentedReserves } from "@/lib/lv-reserve-revocation";

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try { return NextResponse.json(await revokeRentedReserves()); }
  catch { return NextResponse.json({ error: "Rental stops not confirmed; reconciliation will retry" }, { status: 503 }); }
}
