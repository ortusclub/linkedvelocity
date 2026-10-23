import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runProxyChecks } from "@/lib/proxy-check";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST — run health + geo + billing checks now (bounded). Used by "Run check now".
export async function POST() {
  try {
    await requireAdmin();
    const summary = await runProxyChecks(60);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    console.error("Proxy check error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
