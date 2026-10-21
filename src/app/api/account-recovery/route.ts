import { NextResponse } from "next/server";
import { z } from "zod";
import { startPrimaryRecovery, verifyPrimaryRecovery } from "@/lib/primary-email-recovery";
import { ownerSignInCode, privateOwnerSignInCode } from "@/lib/owner-sign-in-code";
import { ownerRecoveryInfo, recordOwnerRecoveryOutcome } from "@/lib/owner-recovery";
import { EmailSetupError } from "@/lib/onboarding-email-policy";
export const runtime = "nodejs";
const token = z.string().regex(/^[a-f0-9]{64}$/);
const loginEmail = z.string().trim().email().max(254).transform(s => s.toLowerCase());
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("private_code"), access: z.string().min(20).max(1000), loginEmail }),
  z.object({ action: z.literal("recovery_info"), access: z.string().min(20).max(1000) }),
  z.object({ action: z.literal("recovery_outcome"), access: z.string().min(20).max(1000), outcome: z.enum(["worked", "stuck"]) }),
  z.object({ action: z.literal("start"), email: z.string().trim().email().max(254).transform(s => s.toLowerCase()), consent: z.literal(true) }),
  z.object({ action: z.literal("verify"), token, loginEmail, code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("code"), token, loginEmail }),
]);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
export async function POST(req: Request) {
  try {
    if (req.headers.get("origin") !== new URL(req.url).origin) return json({ error: "Open the guide on this website to continue." }, 403);
    if (Number(req.headers.get("content-length") || 0) > 2000) return json({ error: "Request too large" }, 413);
    const raw = await req.text();
    if (raw.length > 2000) return json({ error: "Request too large" }, 413);
    const input = schema.parse(JSON.parse(raw));
    if (input.action === "private_code") return json(await privateOwnerSignInCode(input.access, input.loginEmail));
    if (input.action === "recovery_info") return json(await ownerRecoveryInfo(input.access));
    if (input.action === "recovery_outcome") return json(await recordOwnerRecoveryOutcome(input.access, input.outcome));
    if (input.action === "start") return json(await startPrimaryRecovery(input.email, req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown", "restriction"));
    if (input.action === "verify") await verifyPrimaryRecovery(input.token, input.code);
    return json(await ownerSignInCode(input.token, input.loginEmail));
  } catch (error) {
    if (error instanceof EmailSetupError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "Check your email, consent and six-digit verification code." }, 400);
    return json({ error: "We could not complete this step. Please try again or book a call." }, 503);
  }
}
