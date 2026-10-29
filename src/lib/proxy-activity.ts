import { prisma } from "@/lib/prisma";
import { logAccountActivity } from "@/lib/warmup-activity";
import type { Prisma } from "@/generated/prisma/client";

// A proxy change is a meaningful account event (it can line up against a later restriction —
// see restriction.ts, which stamps the proxy into each "restricted" event). Record it on the
// account's Activity feed with a date and who did it, so "when did this account's proxy last
// change?" is answerable. Primary surface is the shared Activity (outreach) log — the same
// place warm-up start/stop logs to. Account-only inventory has no application, so we fall back
// to a dated line on the account's own notes, guaranteeing the change is never lost.

type ProxyRef = { host: string | null; port: number | null; location?: string | null };

function fmt(p: ProxyRef): string {
  if (!p.host || !p.port) return "none";
  return `${p.host}:${p.port}${p.location ? ` (${p.location})` : ""}`;
}

export async function logProxyChange(
  account: { id: string; linkedinUrl: string | null; notes: string | null },
  from: ProxyRef,
  to: ProxyRef,
  by: string,
): Promise<void> {
  // Nothing actually moved — don't log a no-op (e.g. an edit that only touched the password).
  if (from.host === to.host && from.port === to.port) return;

  const text = from.host && from.port
    ? `🔁 Proxy changed ${fmt(from)} → ${fmt(to)}`
    : `🔗 Proxy set ${fmt(to)}`;

  // Primary: the shared Activity feed (shows on the Inventory card + pipeline).
  const attached = await logAccountActivity(account.id, account.linkedinUrl, account.notes, text, by);

  // Durable fallback for inventory with no owner application.
  if (!attached) {
    const dated = `[${new Date().toISOString().slice(0, 10)}] ${text} · ${by}`;
    const notes = account.notes ? `${account.notes}\n${dated}` : dated;
    await prisma.linkedInAccount.update({
      where: { id: account.id },
      data: { notes } as Prisma.LinkedInAccountUpdateInput,
    });
  }
}
