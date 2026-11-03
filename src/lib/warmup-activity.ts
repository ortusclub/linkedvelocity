import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

const normUrl = (u?: string | null) => (u || "").split("?")[0].replace(/\/+$/, "").toLowerCase().trim();

/**
 * Append a note to the owner application's Activity (outreach) log, so an account event
 * (warm-up start/stop, a proxy change, an issue) is auditable with a date and the admin
 * who did it. Resolves the application the same way the pipeline does, in order: a
 * self-service onboarding session pinned to this account, else the same LinkedIn URL,
 * else the "Owner: <email>" on the account's notes matched to an application's email
 * (the URL can be stored with a reversed or utm-tagged slug, so email is the reliable
 * fallback). Returns false (silent no-op) for account-only inventory with no application,
 * so callers that need a guaranteed trail can fall back to the account's own notes.
 */
export async function logAccountActivity(
  accountId: string,
  linkedinUrl: string | null,
  notes: string | null,
  text: string,
  by: string,
): Promise<boolean> {
  const session = await prisma.selfServiceOnboarding.findUnique({
    where: { accountId },
    select: { applicationId: true },
  });
  let appId = session?.applicationId || null;

  if (!appId && linkedinUrl) {
    const u = normUrl(linkedinUrl);
    if (u) {
      const apps = await prisma.ambassadorApplication.findMany({ select: { id: true, linkedinUrl: true } });
      appId = apps.find((a) => normUrl(a.linkedinUrl) === u)?.id || null;
    }
  }

  // Fallback: the account's "Owner: <email>" note → an application on that email. Prefer a
  // live one (onboarded/approved) if the email has more than one application on it.
  if (!appId) {
    const ownerEmail = (notes || "").match(/Owner:\s*(\S+@\S+)/i)?.[1]?.replace(/[.,;]+$/, "").toLowerCase();
    if (ownerEmail) {
      const byEmail = await prisma.ambassadorApplication.findMany({
        where: { email: { equals: ownerEmail, mode: "insensitive" } },
        select: { id: true, status: true },
      });
      if (byEmail.length) {
        const live = byEmail.find((a) => a.status === "onboarded") || byEmail.find((a) => a.status === "approved");
        appId = (live || byEmail[0]).id;
      }
    }
  }
  if (!appId) return false;

  const app = await prisma.ambassadorApplication.findUnique({ where: { id: appId }, select: { outreachLog: true } });
  const log = Array.isArray(app?.outreachLog) ? (app!.outreachLog as unknown[]) : [];
  await prisma.ambassadorApplication.update({
    where: { id: appId },
    data: { outreachLog: [...log, { ch: "note", text, by, at: new Date().toISOString() }] as Prisma.InputJsonValue },
  });
  return true;
}

// Back-compat alias — warm-up toggles still call this name.
export const logWarmupActivity = logAccountActivity;
