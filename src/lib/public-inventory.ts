import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { activeShadowAccountIds } from "@/lib/shadow-rental";

// Hard cap on how much of the roster is ever exposed publicly (catalogue, /api/accounts,
// sitemap) — to anonymous visitors AND signed-in renters alike. Limits the blast radius
// if a bad actor scrapes the site: they only ever learn about this fixed slice, never
// the whole inventory. Everything else is "get in touch for the full list".
//
// The slice is deterministic (top-N by connections, id as tiebreak) so search / filter
// params can't be used to page through the rest of the roster — filters only narrow
// WITHIN this slice.
export const PUBLIC_TOTAL_CAP = 20;

// Inventory pools that are NEVER rentable and NEVER shown publicly (catalogue, /api/accounts,
// sitemap, checkout). "ortus"/"apex" are referrer-brought pools auto-owned at $0; "campaign" is
// our own idle/fresh accounts earmarked to run LinkedArmy outreach (warmed by the engine, never
// rented). Add a pool here once and every public/rental guard that imports this stays in sync.
// NOTE: this does NOT affect the warming/outreach engine feed (/api/outreach/accounts), which
// intentionally ignores pool so campaign accounts still get matured.
export const SEGREGATED_POOLS = ["ortus", "apex", "campaign"];

// Password that unlocks the FULL roster on the catalogue / API. Set via the
// FULL_LIST_PASSWORD env var on Vercel (never in code). Unset = feature off. Works via
// the "Show full roster" box on /catalogue or a link: /catalogue?key=<password>.
export const hasFullListAccess = (key: string | null | undefined) => {
  const pw = process.env.FULL_LIST_PASSWORD;
  return !!pw && !!key && key === pw;
};

// Public rentable "available" definition — mirrors the admin canonicalStatus: must be
// listed, not restricted, and not awaiting a 2FA reset. Segregated pools never show.
// [SHOWCASE] dummy accounts are NEVER rentable/available — they exist only as catalogue
// teasers (shown as "Rented" social proof via a separate query). Excluding them here means
// a showcase can't be checked out or offered as a replacement even if someone mistakenly
// flips its status to "available". Null-safe: a null `notes` is treated as non-showcase,
// matching the app-level isDummy convention ((notes||"").includes("[SHOWCASE]")).
// Genuinely rentable, IGNORING any short-term hold. Used by the direct per-account rent link so
// an account reserved/held for someone can still be rented by them (the link is the credential).
export const RENTABLE_WHERE: Prisma.LinkedInAccountWhereInput = {
  inventoryPool: { notIn: SEGREGATED_POOLS },
  status: "available",
  listed: true,
  restrictedAt: null,
  twoFactorResetNeeded: false,
  OR: [{ notes: null }, { notes: { not: { contains: "[SHOWCASE]" } } }],
};

// Public/catalogue "available" = rentable AND not currently held. A hold (heldUntil in the future)
// hides the account from the public catalogue, the unlisted catalogues and the normal checkout, so
// it can't be snagged while reserved. Expired holds are cleared back to null by the release-holds
// cron, so `heldUntil: null` is the correct "not held" test.
export const PUBLIC_AVAILABLE_WHERE: Prisma.LinkedInAccountWhereInput = {
  ...RENTABLE_WHERE,
  heldUntil: null,
};

export type PublicSlice = { availableIds: string[]; rentedIds: string[]; shadowIds: Set<string> };

/**
 * The fixed public slice of the inventory: at most PUBLIC_TOTAL_CAP accounts in total.
 * Rentable "available" accounts fill the slice first; any remaining room is filled with
 * rented / trial / shadow-held ("available soon") accounts as social proof.
 */
export async function publicInventorySlice(): Promise<PublicSlice> {
  const shadowIds = await activeShadowAccountIds();
  const order = [{ connectionCount: "desc" as const }, { id: "asc" as const }];
  const [avail, rented] = await Promise.all([
    prisma.linkedInAccount.findMany({
      where: { ...PUBLIC_AVAILABLE_WHERE, id: { notIn: [...shadowIds] } },
      orderBy: order,
      take: PUBLIC_TOTAL_CAP,
      select: { id: true },
    }),
    prisma.linkedInAccount.findMany({
      where: {
        inventoryPool: { notIn: SEGREGATED_POOLS },
        // [SHOWCASE] dummies are no longer shown as "Rented" social proof anywhere public
        // (catalogue + homepage roster) — real rented inventory carries the proof now.
        NOT: { notes: { contains: "[SHOWCASE]" } },
        OR: [{ status: { in: ["rented", "trial"] } }, { id: { in: [...shadowIds] } }],
      },
      orderBy: order,
      take: PUBLIC_TOTAL_CAP,
      select: { id: true },
    }),
  ]);
  const availableIds = avail.map((a) => a.id);
  const rentedIds = rented.map((a) => a.id).slice(0, Math.max(0, PUBLIC_TOTAL_CAP - availableIds.length));
  return { availableIds, rentedIds, shadowIds };
}
