import { NextResponse } from "next/server";
import { getBrowserSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AGENT_TOKEN_PREFIX, createAgentToken, agentTokenHash } from "@/lib/agent-token";

export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const user = await getBrowserSession();
  if (!user) return response({ error: "Sign in to manage agent keys" }, 401);
  const keys = await prisma.session.findMany({
    where: { userId: user.id, token: { startsWith: AGENT_TOKEN_PREFIX }, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, expiresAt: true }, orderBy: { createdAt: "desc" },
  });
  return response({ keys });
}

function sameOrigin(request: Request) {
  // Browser mutations must originate from this site; no cross-site key minting.
  return request.headers.get("origin") === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return response({ error: "Invalid origin" }, 403);
  const user = await getBrowserSession();
  if (!user) return response({ error: "Sign in to create an agent key" }, 401);
  const count = await prisma.session.count({ where: { userId: user.id, token: { startsWith: AGENT_TOKEN_PREFIX }, expiresAt: { gt: new Date() } } });
  if (count >= 10) return response({ error: "Revoke an existing key first (maximum 10)." }, 409);
  const token = createAgentToken();
  const key = await prisma.session.create({ data: {
    userId: user.id, token: agentTokenHash(token), expiresAt: new Date(Date.now() + 90 * 86400000),
  }, select: { id: true, createdAt: true, expiresAt: true } });
  return response({ key, token }, 201);
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return response({ error: "Invalid origin" }, 403);
  const user = await getBrowserSession();
  if (!user) return response({ error: "Sign in to revoke an agent key" }, 401);
  const { id } = await request.json();
  if (typeof id !== "string") return response({ error: "Key ID required" }, 400);
  await prisma.session.deleteMany({ where: { id, userId: user.id, token: { startsWith: AGENT_TOKEN_PREFIX } } });
  return response({ ok: true });
}
