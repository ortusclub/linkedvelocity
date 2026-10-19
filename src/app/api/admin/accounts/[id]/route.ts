import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { z } from "zod";
import { persistImageUrl } from "@/lib/persist-image";
import { markOwnerOnboardedIfReady } from "@/lib/onboarding";
import { decryptSecret } from "@/lib/crypto-creds";
import { provisionAccount } from "@/lib/provision-account";
import * as gologin from "@/services/gologin";
import { restrictionUpdate } from "@/lib/restriction";
import { notifyBillingPaused } from "@/lib/billing-pause-notify";
import { notifyRestrictionOwnerReferrer } from "@/lib/restrict-notify";
import { setupPaidDate } from "@/lib/payment-schedule";
import { logWarmupActivity } from "@/lib/warmup-activity";
import { rentalReadyStatus, RENTAL_READY_ITEMS, type ChecklistState } from "@/lib/rental-ready";

const updateSchema = z.object({
  linkedinName: z.string().optional(),
  linkedinHeadline: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  connectionCount: z.number().int().optional(),
  industry: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  profileScreenshotUrl: z.string().nullable().optional(),
  profilePhotoUrl: z.string().nullable().optional(),
  proxyHost: z.string().nullable().optional(),
  proxyPort: z.number().int().nullable().optional(),
  proxyUsername: z.string().nullable().optional(),
  proxyPassword: z.string().nullable().optional(),
  proxyLocation: z.string().nullable().optional(),
  loginEmail: z.string().nullable().optional(),
  personalEmail: z.string().nullable().optional(),
  accountPassword: z.string().nullable().optional(),
  twoFactor: z.string().nullable().optional(),
  workEmail: z.string().nullable().optional(),
  accountAgeMonths: z.number().int().nullable().optional(),
  hasSalesNav: z.boolean().optional(),
  listed: z.boolean().optional(),
  monthlyPrice: z.number().optional(),
  ambassadorPayment: z.number().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["under_review", "available", "rented", "unavailable", "maintenance", "under_construction", "construction_immature", "retired", "removed"]).optional(),
  // Per-account restriction flag (LinkedIn restricted this profile). Pass an ISO
  // string to mark it, or null to clear. Held accounts are excluded from the
  // owner's setup/monthly payouts on the Account Owners view.
  restrictedAt: z.string().nullable().optional(),
  // Not a model column — consumed below, then stripped before the update. When true AND this
  // edit newly restricts the account, also email the owner + referrer the restricted notice
  // (login block + 2FA recovery link when a password is saved). Off by default so a restrict
  // is never a silent credential send; the pipeline sets it from a one-tap confirm.
  notifyOwnerReferrer: z.boolean().optional(),
  // Warming-up flag: pass an ISO string to mark the account as currently warming up (Ortus
  // app), or null to clear. Orthogonal to status — an account can warm up while onboarding,
  // unavailable, or even rented.
  warmupStartedAt: z.string().nullable().optional(),
  linkedinJoinedAt: z.string().nullable().optional(),
  // Remove a single connection-history entry (correcting a mistaken reading) by its index
  // in the stored array. Not a model column — consumed below, then stripped before the update.
  deleteConnectionHistoryIndex: z.number().int().optional(),
  // Admin payout hold (account inaccessible / paused — not a LinkedIn restriction). Pass a
  // reason string to hold the owner's payout, or null to release it.
  payoutHoldReason: z.string().nullable().optional(),
  // LV handler (PoC) for an inventory-only account with no ambassador application.
  poc: z.string().nullable().optional(),
  twoFactorResetNeeded: z.boolean().optional(),
  paymentLinkedAccountId: z.string().uuid().nullable().optional(),
  gologinProfileId: z.string().nullable().optional(),
  gologinShareLink: z.string().nullable().optional(),
  verificationProof: z.string().nullable().optional(),
  linkedinVerified: z.boolean().optional(),
  linkedinAccountHealth: z.string().nullable().optional(),
}).partial();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;

    const account = await prisma.linkedInAccount.findUnique({
      where: { id },
      include: {
        rentals: {
          include: { user: { select: { id: true, fullName: true, email: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!account) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Decrypt stored secrets for the admin (legacy plaintext passes through).
    account.accountPassword = decryptSecret(account.accountPassword);
    account.twoFactor = decryptSecret(account.twoFactor);
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await req.json();
    const data = updateSchema.parse(body);
    // Opt-in owner/referrer restricted-notice email (one-tap confirm on the pipeline). Not a
    // model column — pull it out and strip it before the DB write.
    const notifyOwnerReferrer = data.notifyOwnerReferrer === true;
    delete (data as Record<string, unknown>).notifyOwnerReferrer;

    // Capture the pre-update login email so we can detect a change and keep the
    // GoLogin profile name in sync (admin is the source of truth for emails).
    let oldLoginEmail: string | null | undefined = undefined;
    if (data.loginEmail !== undefined) {
      const prev = await prisma.linkedInAccount.findUnique({ where: { id }, select: { loginEmail: true } });
      oldLoginEmail = prev?.loginEmail ?? null;
    }

    // 2FA-reset gate: a rental leaving "rented" auto-flags the account (the
    // outgoing renter had the code), and it can't be set back to "available"
    // until that flag is explicitly cleared — which only happens by passing
    // twoFactorResetNeeded: false in the same request the code is rotated.
    if (data.status !== undefined || data.twoFactorResetNeeded !== undefined) {
      const current = await prisma.linkedInAccount.findUnique({
        where: { id },
        select: { status: true, twoFactorResetNeeded: true },
      });
      if (!current) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (data.status && data.status !== "rented" && current.status === "rented" && data.twoFactorResetNeeded === undefined) {
        data.twoFactorResetNeeded = true;
      }
      const effectiveFlag = data.twoFactorResetNeeded !== undefined ? data.twoFactorResetNeeded : current.twoFactorResetNeeded;
      const effectiveStatus = data.status ?? current.status;
      if (effectiveStatus === "available" && effectiveFlag) {
        return NextResponse.json(
          { error: "This account's 2FA was exposed to the last renter and needs to be rotated before it can go back to Available." },
          { status: 409 }
        );
      }
    }

    // Guard: don't let an account be flipped to "available" (listed for rent) while its
    // linked ambassador's setup fee is still unpaid. Recording the setup fee payment is
    // what should list the account (that path sets available in prisma directly, so it
    // isn't affected here); flipping the status by hand skips it and puts an unpaid
    // account on the market. LV-owned inventory (no linked application) is exempt.
    if (data.status === "available") {
      const cur = await prisma.linkedInAccount.findUnique({
        where: { id },
        select: { status: true, notes: true, linkedinUrl: true, rentalReadyChecklist: true, restrictedAt: true, permanentlyRestricted: true, twoFactorResetNeeded: true, proxyHost: true },
      });
      if (!cur) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Only guard an actual flip INTO available — not a no-op re-save of an account
      // that is already available.
      if (cur.status !== "available") {
        // Rental-ready gate: housekeeping must be done before a renter can get instant access
        // (anti-restriction + anti-double-use). Does not retroactively block already-available
        // accounts (guarded by cur.status !== "available"), only new flips into Available.
        const shareRows = await prisma.rental.findMany({ where: { linkedinAccountId: id }, select: { gologinShareIds: true } });
        const gologinShared = shareRows.some((rr) => Array.isArray(rr.gologinShareIds) && (rr.gologinShareIds as unknown[]).length > 0);
        const rr = rentalReadyStatus({ ...cur, gologinShared }, cur.rentalReadyChecklist as ChecklistState);
        if (!rr.ready) {
          const labelOf = (k: string) => RENTAL_READY_ITEMS.find((i) => i.key === k)?.label || k;
          const missingLabels = rr.missing.map(labelOf);
          const autoLabels = rr.autoFail.map((f) => f.reason);
          return NextResponse.json(
            {
              error: `Rental-ready checklist incomplete — finish housekeeping before listing. Still needed: ${[...autoLabels, ...missingLabels].join("; ")}.`,
              rentalReady: rr,
            },
            { status: 409 }
          );
        }
      }
      if (cur.status !== "available") {
        const ownerEmail = (cur.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "") || null;
        const url = cur.linkedinUrl?.replace(/\/$/, "") || null;
        if (ownerEmail || url) {
          const app = await prisma.ambassadorApplication.findFirst({
            where: {
              OR: [
                ...(ownerEmail ? [{ email: { equals: ownerEmail, mode: "insensitive" as const } }] : []),
                ...(url ? [{ linkedinUrl: url }, { linkedinUrl: `${url}/` }] : []),
              ],
            },
            select: { paidAt: true, monthlyPayouts: true },
          });
          if (app && !setupPaidDate(app.paidAt, app.monthlyPayouts)) {
            return NextResponse.json(
              { error: "Setup fee not paid — record the setup fee payment first (that auto-lists the account). Use the payouts page to mark it paid." },
              { status: 409 }
            );
          }
        }
      }
    }

    // A manual health mark stamps the check date server-side.
    if (data.linkedinAccountHealth !== undefined) {
      (data as Record<string, unknown>).healthCheckedAt = new Date();
    }

    // Setting/clearing a payout hold stamps (or clears) the held-at date server-side.
    if (data.payoutHoldReason !== undefined) {
      const reason = data.payoutHoldReason?.trim() || null;
      (data as Record<string, unknown>).payoutHoldReason = reason;
      (data as Record<string, unknown>).payoutHeldAt = reason ? new Date() : null;
    }

    // A restriction change (restrictedAt set or cleared) is recorded to the shared
    // restrictionLog through the same helper the inventory /restricted route uses, so
    // the history is captured no matter which surface set it (pipeline or inventory).
    let newlyRestricted = false;
    if (data.restrictedAt !== undefined) {
      const cur = await prisma.linkedInAccount.findUnique({ where: { id }, select: { id: true, restrictedAt: true, restrictionLog: true } });
      // Flag an on-transition (was clear, now being set) so we can notify the renter below.
      newlyRestricted = data.restrictedAt !== null && !cur?.restrictedAt;
      if (cur) {
        const fields = await restrictionUpdate(cur, data.restrictedAt !== null);
        (data as Record<string, unknown>).restrictedAt = fields.restrictedAt;
        if (fields.restrictionLog) (data as Record<string, unknown>).restrictionLog = fields.restrictionLog;
      } else {
        (data as Record<string, unknown>).restrictedAt = data.restrictedAt ? new Date(data.restrictedAt) : null;
      }
    }

    // Warming-up flag: ISO string → Date, null to clear. A real transition (start / stop /
    // re-warm) is logged to the owner's Activity feed below so it's auditable with a date.
    let warmupChange: string | null = null;
    if (data.warmupStartedAt !== undefined) {
      const next = data.warmupStartedAt ? new Date(data.warmupStartedAt) : null;
      const cur = await prisma.linkedInAccount.findUnique({ where: { id }, select: { warmupStartedAt: true } });
      const prev = cur?.warmupStartedAt ?? null;
      if (next && !prev) warmupChange = `🔥 Marked warming up (Ortus app) · since ${next.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
      else if (!next && prev) warmupChange = `⏹️ Warm-up stopped (was running since ${prev.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })})`;
      else if (next && prev && next.getTime() !== prev.getTime()) warmupChange = `🔥 Warm-up start date set to ${next.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
      (data as Record<string, unknown>).warmupStartedAt = next;
    }

    // "Joined LinkedIn" month (from About this member): ISO string → Date, null to clear.
    // Also derive accountAgeMonths from it unless the same request sets age explicitly.
    if (data.linkedinJoinedAt !== undefined) {
      const joined = data.linkedinJoinedAt ? new Date(data.linkedinJoinedAt) : null;
      (data as Record<string, unknown>).linkedinJoinedAt = joined;
      if (joined && data.accountAgeMonths === undefined) {
        const months = (new Date().getFullYear() - joined.getFullYear()) * 12 + (new Date().getMonth() - joined.getMonth());
        (data as Record<string, unknown>).accountAgeMonths = Math.max(0, months);
      }
    }

    // Connection-history trail: append a dated point whenever the connection count changes,
    // and a "rented"/"returned" marker when the account flips in/out of rented — so we can
    // see the maturing/growth rate over time and in rental context.
    if (data.connectionCount !== undefined || data.status !== undefined) {
      const cur = await prisma.linkedInAccount.findUnique({ where: { id }, select: { connectionCount: true, connectionHistory: true, status: true } });
      if (cur) {
        const history = Array.isArray(cur.connectionHistory) ? (cur.connectionHistory as { at: string; count: number; note?: string }[]) : [];
        const additions: { at: string; count: number; note?: string }[] = [];
        const at = new Date().toISOString();
        const effectiveCount = data.connectionCount ?? cur.connectionCount;
        if (data.connectionCount !== undefined && data.connectionCount !== cur.connectionCount) additions.push({ at, count: data.connectionCount });
        if (data.status !== undefined && data.status !== cur.status) {
          if (data.status === "rented") additions.push({ at, count: effectiveCount, note: "rented" });
          else if (cur.status === "rented") additions.push({ at, count: effectiveCount, note: "returned" });
        }
        if (additions.length) (data as Record<string, unknown>).connectionHistory = [...history, ...additions].slice(-300);
      }
    }

    // Delete one connection-history entry (e.g. a mis-typed reading) by its index.
    if (data.deleteConnectionHistoryIndex !== undefined) {
      const idx = data.deleteConnectionHistoryIndex;
      const cur = await prisma.linkedInAccount.findUnique({ where: { id }, select: { connectionHistory: true } });
      const history = Array.isArray(cur?.connectionHistory) ? (cur.connectionHistory as { at: string; count: number; note?: string }[]) : [];
      (data as Record<string, unknown>).connectionHistory = history.filter((_, i) => i !== idx);
      delete (data as Record<string, unknown>).deleteConnectionHistoryIndex;
    }

    // Re-host any newly-set external profile photo (e.g. a licdn URL) onto Blob
    // so it doesn't expire. Leaves null (photo cleared) and unchanged URLs alone.
    if (data.profilePhotoUrl) {
      data.profilePhotoUrl = await persistImageUrl(data.profilePhotoUrl);
    }

    // Available ALWAYS means publicly listed. These used to be separate toggles, so an
    // account could be marked available yet left invisible when the edit form re-sent a
    // stale unchecked "Listed" box. Enforce the invariant server-side: to hide an account
    // from the catalogue, change its status (unavailable / under_review), don't unlist it
    // while leaving it available.
    if (data.status === "available") {
      data.listed = true;
    }

    const account = await prisma.linkedInAccount.update({
      where: { id },
      data,
    });

    // Log a warm-up start/stop/re-warm to the owner's Activity feed (best-effort).
    if (warmupChange) {
      try { await logWarmupActivity(id, account.linkedinUrl, account.notes, warmupChange, admin.fullName || admin.email); } catch (e) { console.error("warmup activity log failed", e); }
    }

    // Newly restricted via this edit: tell any real renter(s) their billing is paused, and
    // (when the caller opted in) email the owner + referrer the restricted notice.
    let notify: Awaited<ReturnType<typeof notifyRestrictionOwnerReferrer>> | null = null;
    if (newlyRestricted && account.restrictedAt) {
      const renters = await prisma.rental.findMany({
        where: { linkedinAccountId: id, isShadow: false, status: { in: ["active", "pending_access", "payment_failed"] } },
        select: { userId: true },
      });
      const seen = new Set<string>();
      for (const r of renters) {
        if (seen.has(r.userId)) continue;
        seen.add(r.userId);
        await notifyBillingPaused(r.userId, { trigger: "restricted", highlightAccount: account.linkedinName });
      }
      // Owner + referrer restricted notice — only when the caller opted in (one-tap confirm),
      // so a restrict is never a silent credential send. Best-effort; must not fail the edit.
      if (notifyOwnerReferrer) {
        try { notify = await notifyRestrictionOwnerReferrer(id); } catch (e) { console.error("restrict owner/referrer notify failed", e); }
      }
    }

    // If this edit just made the account runnable (a GoLogin was set/changed), advance
    // the owner's application to onboarded so a referred signup converts automatically on
    // the Referrals page. Only makes the conversion visible — payment still needs the
    // deliberate "ok to pay". Never blocks the edit.
    if (data.gologinShareLink !== undefined || data.gologinProfileId !== undefined) {
      try { await markOwnerOnboardedIfReady(account); } catch (e) { console.error("auto-onboard (update) failed:", e); }
    }

    // Sync proxy to GoLogin profile if it has one
    if (account.gologinProfileId && (data.proxyHost || data.proxyPort || data.proxyUsername || data.proxyPassword)) {
      try {
        const token = process.env.GOLOGIN_API_TOKEN!;
        const headers = {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        };

        // GoLogin PUT requires all required fields, so fetch profile first
        const profileRes = await fetch(
          `https://api.gologin.com/browser/${account.gologinProfileId}`,
          { headers }
        );
        if (profileRes.ok) {
          const profile = await profileRes.json();
          const payload = {
            name: profile.name,
            browserType: profile.browserType || "chrome",
            os: profile.os || "mac",
            navigator: profile.navigator,
            proxy: account.proxyHost
              ? {
                  mode: "http",
                  host: account.proxyHost,
                  port: account.proxyPort || 80,
                  username: account.proxyUsername || "",
                  password: account.proxyPassword || "",
                }
              : { mode: "none" },
          };

          await fetch(
            `https://api.gologin.com/browser/${account.gologinProfileId}`,
            { method: "PUT", headers, body: JSON.stringify(payload) }
          );
        }
      } catch (e) {
        console.error("Failed to sync proxy to GoLogin:", e);
      }
    }

    // Admin is the source of truth for the login email. If it changed on an account
    // that already has a GoLogin profile, rename the profile to match and regenerate
    // its share link (the g.camp link embeds the name). Skip rented accounts (a mid-
    // rental change would disrupt the renter). Best-effort — never fails the save.
    if (
      data.loginEmail !== undefined &&
      account.loginEmail &&
      oldLoginEmail !== undefined &&
      oldLoginEmail !== account.loginEmail &&
      account.gologinProfileId &&
      account.status !== "rented"
    ) {
      const token = gologin.tokenForAccount(account.gologinAccount) || undefined;
      try {
        await gologin.renameProfile(account.gologinProfileId, account.loginEmail, token);
        try {
          const link = await gologin.regeneratePublicShareLink(account.gologinProfileId, account.loginEmail, token);
          if (link) await prisma.linkedInAccount.update({ where: { id }, data: { gologinShareLink: link.publicUrl } });
        } catch (e) { console.error("share-link regen after email change failed:", e); }
      } catch (e) { console.error("GoLogin rename after email change failed:", e); }
    }

    // Instant auto-provision: the moment a login email is set and setup is still
    // incomplete, link/create the GoLogin profile, assign a proxy, and generate the
    // share link. Best-effort — never fails the save; the provision-accounts cron
    // retries anything that couldn't finish. Skips rented accounts (see provisionAccount).
    // Gated behind AUTO_PROVISION_GOLOGIN=true — OFF by default so GoLogin is created
    // manually from the pipeline "Create GoLogin" button (avoids auto-creating on save).
    if (
      process.env.AUTO_PROVISION_GOLOGIN === "true" &&
      account.loginEmail &&
      account.status !== "rented" &&
      (!account.gologinProfileId || !account.proxyHost || !account.gologinShareLink)
    ) {
      try {
        await provisionAccount(account.id);
      } catch (e) {
        console.error("auto-provision (update) failed:", e);
      }
    }

    // Return decrypted secrets so the admin UI shows the real values, not ciphertext.
    account.accountPassword = decryptSecret(account.accountPassword);
    account.twoFactor = decryptSecret(account.twoFactor);
    return NextResponse.json({ account, ...(notify ? { notify } : {}) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;

    const account = await prisma.linkedInAccount.findUnique({ where: { id } });
    if (!account) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Cancel any active rentals before deleting
    if (account.status === "rented") {
      await prisma.rental.updateMany({
        where: { linkedinAccountId: id, status: "active" },
        data: { status: "cancelled" },
      });
    }

    await prisma.linkedInAccount.update({
      where: { id },
      data: { status: "removed", removedAt: new Date(), removedBy: "admin" },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
