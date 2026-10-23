import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setProviderAutoExtend } from "@/services/proxy-cheap";

export const dynamic = "force-dynamic";

// POST { host, port, enabled } — toggle Proxy-Cheap auto-renew at the provider,
// then store the fresh auto-extend/expiry on the proxy row. Only works for a
// Proxy-Cheap proxy that carries a providerProxyId.
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const host = typeof body.host === "string" ? body.host.trim() : "";
    const port = typeof body.port === "number" ? body.port : parseInt(body.port, 10);
    const enabled = !!body.enabled;
    if (!host || !Number.isFinite(port)) return NextResponse.json({ error: "host and port are required" }, { status: 400 });

    const proxy = await prisma.proxy.findUnique({ where: { host_port: { host, port } } });
    if (!proxy?.providerProxyId) {
      return NextResponse.json({ error: "This proxy has no Proxy-Cheap ID — auto-extend can only be changed for Proxy-Cheap proxies." }, { status: 400 });
    }

    const state = await setProviderAutoExtend(proxy.providerProxyId, enabled);
    const updated = await prisma.proxy.update({
      where: { host_port: { host, port } },
      data: {
        autoExtend: state && typeof state.autoExtendEnabled === "boolean" ? state.autoExtendEnabled : enabled,
        expiresAt: state?.expiresAt ? new Date(state.expiresAt) : proxy.expiresAt,
      },
    });
    return NextResponse.json({ ok: true, autoExtend: updated.autoExtend, expiresAt: updated.expiresAt });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    console.error("Proxy auto-extend error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
