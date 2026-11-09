import { prisma } from "@/lib/prisma";

// Rental records are the durable retry source: the cron replays current rentals
// after an interrupted checkout or unavailable engine. No customer data is sent.
export async function revokeRentedReserves(accountId?: string) {
  const accounts = await prisma.linkedInAccount.findMany({
    where: {
      ...(accountId ? { id: accountId } : {}),
      gologinProfileId: { not: null },
      OR: [
        { status: "rented" },
        { rentals: { some: { isShadow: false, status: { in: ["active", "pending_access", "payment_failed"] } } } },
      ],
    },
    select: { gologinProfileId: true },
  });
  const profileIds = [...new Set(accounts.map(a => a.gologinProfileId).filter(Boolean))];
  if (!profileIds.length) return { blocked: 0 };
  const base = process.env.MATURING_ENGINE_URL;
  const token = process.env.MATURING_ENGINE_TOKEN;
  if (!base || !token) throw new Error("LV reserve rental stop connection is not configured");
  for (let i = 0; i < profileIds.length; i += 500) {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/campaign/lv-reserves/revoke`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profileIds: profileIds.slice(i, i + 500) }),
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) throw new Error(`LV reserve rental stop not confirmed (${response.status})`);
  }
  return { blocked: profileIds.length };
}

export async function notifyReserveRental(accountId: string) {
  try { await revokeRentedReserves(accountId); }
  catch (error) {
    // Do not turn a committed payment into a checkout error or repeat a payment.
    console.error("LV reserve rental stop queued for reconciliation", accountId, error instanceof Error ? error.message : "engine unavailable");
  }
}
