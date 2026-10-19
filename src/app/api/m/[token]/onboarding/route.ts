import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { currencyConfig } from "@/lib/referral-currency";
import { selfServiceInput, selfServiceAction, selfServiceHandoff, selfServiceConfirm } from "@/lib/self-service-input";
import { proxyPurchaseLimits } from "@/services/proxy-cheap";
import { emailSetupConfig, EmailSetupError } from "@/lib/onboarding-email-policy";
import { requireEmailSetup } from "@/lib/onboarding-email";
import { OnboardingError, onboardingCountries, onboardingSummary, reserveOnboarding, adoptOnboarding, prepareOnboarding, confirmOnboarding, handoffOnboarding, saveTwoFactorKey, requestOnboardingMeeting, updateOnboardingPayout, undoOnboardingMeeting } from "@/lib/self-service-onboarding";
import { phoneVerificationConfigured } from "@/lib/phone-verification";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Context = { params: Promise<{ token: string }> };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

async function authenticate(context: Context, req?: Request) {
  if (req) {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) throw new OnboardingError("Request origin not allowed.", 403);
  }
  const { token } = await context.params;
  const me = await prisma.referrer.findUnique({ where: { token } });
  if (!me || !me.active) throw new OnboardingError("This referral portal is not available.", 404);
  return me;
}

function failure(error: unknown, operation: "load" | "save" = "save") {
  if (error instanceof EmailSetupError) return json({ error: error.message }, error.status);
  // Log diagnostic identifiers only; full Prisma errors may contain private inputs.
  if (!(error instanceof OnboardingError)) {
    const known = error instanceof Prisma.PrismaClientKnownRequestError ? error : null;
    console.error("Onboarding request failed", {
      operation, kind: error instanceof Error ? error.name : "Unknown",
      code: known?.code, model: known?.meta?.modelName, column: known?.meta?.column,
      field: error instanceof Error ? error.message.match(/Unknown (?:argument|field) `([^`]+)`/)?.[1] : undefined,
    });
  }
  if (error instanceof OnboardingError) return json({ error: error.message }, error.status);
  if (error instanceof SyntaxError) return json({ error: "Invalid request." }, 400);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
    return json({ error: "Onboarding is not enabled in this database yet. The team needs to apply the onboarding database migration." }, 503);
  }
  // Provider payloads and database errors can contain secrets; don't return or log them.
  return json({ error: operation === "load" ? "We couldn't load onboarding. Please refresh and try again." : "We couldn't save your progress. Please refresh and try again." }, 500);
}

export async function GET(req: Request, context: Context) {
  try {
    const me = await authenticate(context);
    const id = new URL(req.url).searchParams.get("id");
    if (id && !selfServiceAction.shape.id.safeParse(id).success) return json({ error: "Invalid onboarding reference." }, 400);
    if (id) return json({ session: await onboardingSummary(id, me.id) });
    const [countries, sessions, doneMethods] = await Promise.all([
      onboardingCountries(),
      prisma.selfServiceOnboarding.findMany({ where: { referrerId: me.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, state: true, application: { select: { fullName: true, status: true, onboardedAt: true, paidAt: true } } } }),
      // Which onboarding paths this referrer has done — the first-timer tour keeps
      // showing until they've completed a computer AND a phone onboarding at least once.
      prisma.ambassadorApplication.findMany({ where: { referredBy: me.slug, onboardingMethod: { not: null } }, select: { onboardingMethod: true } }),
    ]);
    const methods = new Set(doneMethods.map((m) => m.onboardingMethod));
    return json({ displayCurrency: me.displayCurrency, emailEnabled: emailSetupConfig().enabled, phoneVerificationEnabled: phoneVerificationConfigured(), countries, autoPurchase: proxyPurchaseLimits().enabled, config: currencyConfig(me.slug), configured: !!process.env.GOLOGIN_API_TOKEN_KLABBER,
      doneComputer: methods.has("computer"), donePhone: methods.has("phone"),
      // `done` = no longer resumable (signed in / handed to us / onboarded / paid). The saved
      // list shows these as a summary, not a "Resume" that would restart an onboarded account.
      sessions: sessions.map((s) => ({ id: s.id, state: s.state, name: s.application.fullName,
        done: s.state === "confirmed" || s.state === "handed_off" || s.application.status === "onboarded" || !!s.application.onboardedAt || !!s.application.paidAt })) });
  } catch (error) { return failure(error, "load"); }
}

export async function POST(req: Request, context: Context) {
  try {
    const me = await authenticate(context, req);
    if (!process.env.GOLOGIN_API_TOKEN_KLABBER) throw new OnboardingError("Browser setup is not configured yet.", 503);
    const body = await req.json();
    // Adopt an existing form signup into a guided onboarding this referrer runs themselves
    // (reuses the application instead of creating a duplicate).
    if (body && typeof body === "object" && (body as { action?: string }).action === "adopt") {
      const appId = (body as { applicationId?: unknown }).applicationId;
      if (typeof appId !== "string" || !selfServiceAction.shape.id.safeParse(appId).success) return json({ error: "Invalid signup reference." }, 400);
      const id = await adoptOnboarding(me, appId);
      return json({ session: await onboardingSummary(id, me.id) });
    }
    const parsed = selfServiceInput.safeParse(body);
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Please check the details." }, 400);
    const id = await reserveOnboarding(me, parsed.data);
    return json({ session: await onboardingSummary(id, me.id) });
  } catch (error) { return failure(error); }
}

export async function PATCH(req: Request, context: Context) {
  try {
    const me = await authenticate(context, req);
    const body = await req.json();
    if (body && typeof body === "object" && (body as { action?: string }).action === "handoff") {
      const handoff = selfServiceHandoff.safeParse(body);
      if (!handoff.success) return json({ error: "Invalid hand-off details." }, 400);
      await requireEmailSetup(handoff.data.id, me.id);
      await handoffOnboarding(handoff.data.id, me.id, { password: handoff.data.password, twoFactorKey: handoff.data.twoFactorKey });
      return json({ session: await onboardingSummary(handoff.data.id, me.id) });
    }
    if (body && typeof body === "object" && (body as { action?: string }).action === "meeting") {
      const id = (body as { id?: unknown }).id;
      if (typeof id !== "string" || !selfServiceAction.shape.id.safeParse(id).success) return json({ error: "Invalid onboarding reference." }, 400);
      await requestOnboardingMeeting(id, me.id);
      return json({ session: await onboardingSummary(id, me.id) });
    }
    if (body && typeof body === "object" && (body as { action?: string }).action === "payout") {
      const id = (body as { id?: unknown }).id;
      if (typeof id !== "string" || !selfServiceAction.shape.id.safeParse(id).success) return json({ error: "Invalid onboarding reference." }, 400);
      await updateOnboardingPayout(id, me.id, body as Record<string, unknown>);
      return json({ session: await onboardingSummary(id, me.id) });
    }
    if (body && typeof body === "object" && (body as { action?: string }).action === "undo_meeting") {
      const id = (body as { id?: unknown }).id;
      if (typeof id !== "string" || !selfServiceAction.shape.id.safeParse(id).success) return json({ error: "Invalid onboarding reference." }, 400);
      await undoOnboardingMeeting(id, me.id);
      return json({ session: await onboardingSummary(id, me.id) });
    }
    // Save the 2FA key at the two-step-verification step (before sign-in) so it's recorded
    // even if the onboarding stalls. Not gated on email setup — recording the key is safe.
    if (body && typeof body === "object" && (body as { action?: string }).action === "twofactor") {
      const b = body as { id?: unknown; twoFactorKey?: unknown };
      if (typeof b.id !== "string" || !selfServiceAction.shape.id.safeParse(b.id).success) return json({ error: "Invalid onboarding reference." }, 400);
      if (typeof b.twoFactorKey !== "string" || b.twoFactorKey.length > 128) return json({ error: "Invalid 2FA key." }, 400);
      await saveTwoFactorKey(b.id, me.id, b.twoFactorKey);
      return json({ session: await onboardingSummary(b.id, me.id) });
    }
    // Confirm carries the captured login (PC flow), so parse it with its own schema.
    if (body && typeof body === "object" && (body as { action?: string }).action === "confirm") {
      const confirm = selfServiceConfirm.safeParse(body);
      if (!confirm.success) return json({ error: "Invalid confirmation details." }, 400);
      await requireEmailSetup(confirm.data.id, me.id);
      await confirmOnboarding(confirm.data.id, me.id, { password: confirm.data.password, twoFactorKey: confirm.data.twoFactorKey });
      return json({ session: await onboardingSummary(confirm.data.id, me.id) });
    }
    const parsed = selfServiceAction.safeParse(body);
    if (!parsed.success) return json({ error: "Invalid onboarding action." }, 400);
    const { id, action } = parsed.data;
    await requireEmailSetup(id, me.id);
    if (action === "prepare") await prepareOnboarding(id, me.id);
    if (action === "opened") {
      const updated = await prisma.selfServiceOnboarding.updateMany({ where: { id, referrerId: me.id, state: "ready" }, data: { openedAt: new Date() } });
      if (!updated.count) throw new OnboardingError("The browser is not ready to open yet.", 409);
    }
    if (action === "confirm") await confirmOnboarding(id, me.id);
    return json({ session: await onboardingSummary(id, me.id) });
  } catch (error) { return failure(error); }
}
