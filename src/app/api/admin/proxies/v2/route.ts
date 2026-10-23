import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getProxiesV2 } from "@/lib/proxies-v2";

export const dynamic = "force-dynamic";

// GET — egress IPs with ports, derived geo/billing and live account flags, in one query.
export async function GET() {
  try {
    await requireAdmin();
    const ips = await getProxiesV2();
    return NextResponse.json({ ips });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    console.error("Proxies v2 GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
