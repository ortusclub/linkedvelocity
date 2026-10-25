import { agentTokenHash, isAgentToken } from "@/lib/agent-token";
import { prisma } from "@/lib/prisma";
import { compare, hash } from "bcryptjs";
import { cookies, headers } from "next/headers";
import { v4 as uuid } from "uuid";
import type { User } from "@/generated/prisma/client";

const SESSION_COOKIE = "session_token";
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const ADMIN_SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days — stay signed in on the admin

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return compare(password, hashedPassword);
}

export async function createSession(userId: string, isAdmin: boolean = false) {
  const token = uuid();
  const maxAge = isAdmin ? ADMIN_SESSION_MAX_AGE : SESSION_MAX_AGE;
  const expiresAt = new Date(Date.now() + maxAge);

  await prisma.session.create({
    data: { userId, token, expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

// Developer-key management uses this cookie-only entrypoint, never an agent key.
export async function getBrowserSession(): Promise<(User & { sessionId: string }) | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.startsWith("agent:")) return null;
  return resolveSession(token);
}

async function resolveSession(token: string): Promise<(User & { sessionId: string }) | null> {
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || session.user.status !== "active") return null;
  return { ...session.user, sessionId: session.id };
}

export async function getSession(): Promise<(User & { sessionId: string }) | null> {
  // An explicit credential takes precedence; invalid keys cannot fall back to cookies.
  const authorization = (await headers()).get("authorization");
  if (authorization) {
    const match = /^Bearer (\S+)$/i.exec(authorization);
    if (!match) return null;
    const token = match[1];
    if (token.startsWith("agent:")) return null; // stored hashes are never credentials
    if (token.startsWith("lvk_")) {
      if (!isAgentToken(token)) return null;
      return resolveSession(agentTokenHash(token));
    }
    return resolveSession(token); // existing desktop sessions
  }
  return getBrowserSession();
}

export async function requireAuth(): Promise<User> {
  const user = await getSession();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireAuth();
  if (user.role !== "admin") throw new Error("Forbidden");
  return user;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
    cookieStore.delete(SESSION_COOKIE);
  }
}
