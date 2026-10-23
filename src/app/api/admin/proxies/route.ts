import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProxies } from "@/lib/proxies";

export const dynamic = "force-dynamic";

// GET — the live proxy list (one source of truth, shared with the CSV export).
export async function GET() {
  try {
    await requireAdmin();
    const proxies = await getProxies();
    return NextResponse.json({ proxies });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") {
      return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    }
    console.error("Proxies API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH — upsert the metadata (label / provider / type / country / status / notes)
// for one proxy, keyed by host:port. Only the editable fields live here; the
// account mapping is never touched.
const EDITABLE = ["label", "provider", "type", "country", "status", "notes", "providerProxyId"] as const;

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const host = typeof body.host === "string" ? body.host.trim() : "";
    const port = typeof body.port === "number" ? body.port : parseInt(body.port, 10);
    if (!host || !Number.isFinite(port)) {
      return NextResponse.json({ error: "host and port are required" }, { status: 400 });
    }

    // Normalise blanks to null so clearing a field removes it.
    const data: Record<string, string | null> = {};
    for (const f of EDITABLE) {
      if (f in body) {
        const v = body[f];
        data[f] = typeof v === "string" && v.trim() ? v.trim() : null;
      }
    }

    const proxy = await prisma.proxy.upsert({
      where: { host_port: { host, port } },
      create: { host, port, ...data },
      update: data,
    });
    return NextResponse.json({ proxy });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") {
      return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    }
    console.error("Proxies PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
