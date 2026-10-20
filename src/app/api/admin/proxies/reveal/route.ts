import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST { host, port? } — return proxy credentials for the "Show passwords" path.
// Credentials are NEVER included in the normal list load; this separate call is
// audit-logged. Creds come from a linked account (source of truth) or the proxy row.
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const host = typeof body.host === "string" ? body.host.trim() : "";
    const port = body.port != null ? (typeof body.port === "number" ? body.port : parseInt(body.port, 10)) : null;
    if (!host) return NextResponse.json({ error: "host is required" }, { status: 400 });

    const accts = await prisma.linkedInAccount.findMany({
      where: { proxyHost: host, ...(port != null ? { proxyPort: port } : {}), proxyPassword: { not: null } },
      select: { proxyHost: true, proxyPort: true, proxyUsername: true, proxyPassword: true },
    });
    const metaRows = await prisma.proxy.findMany({ where: { host, ...(port != null ? { port } : {}) }, select: { host: true, port: true, username: true, password: true } });

    const byKey = new Map<string, { host: string; port: number; username: string | null; password: string | null }>();
    for (const m of metaRows) if (m.password) byKey.set(`${m.host}:${m.port}`, { host: m.host, port: m.port, username: m.username, password: m.password });
    for (const a of accts) { const k = `${a.proxyHost}:${a.proxyPort}`; if (!byKey.has(k) && a.proxyPassword) byKey.set(k, { host: a.proxyHost as string, port: a.proxyPort ?? 0, username: a.proxyUsername, password: a.proxyPassword }); }

    const creds = [...byKey.values()];
    console.warn(`[proxy-reveal] admin=${admin.email} host=${host}${port != null ? ":" + port : ""} ports=${creds.length} at=${new Date().toISOString()}`);
    return NextResponse.json({ creds });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    console.error("Proxy reveal error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
