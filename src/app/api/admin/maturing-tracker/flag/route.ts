import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { restrictionUpdate } from "@/lib/restriction";

// Manual operator flags from the maturing tracker. Gigi/Milee report what they SEE on an
// account. Informational flags (logged_out / relogin / identity / paused / other) are stored in
// linkedin_accounts.maturing_flag and surface the account in Needs-review. "restricted" is NOT a
// flag — it goes through the real restriction flow (restrictedAt + restriction log), so recovery
// works the same as marking restricted anywhere else; "unrestrict" undoes a just-made mark.
export const dynamic = "force-dynamic";

const FLAG_KINDS = new Set(["logged_out", "relogin", "identity", "paused", "other"]);

export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    const action = typeof body.action === "string" ? body.action : "";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
    if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });

    const account = await prisma.linkedInAccount.findUnique({ where: { id: accountId } });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    if (action === "flag") {
      const kind = typeof body.kind === "string" ? body.kind : "";
      if (!FLAG_KINDS.has(kind)) return NextResponse.json({ error: "Unknown flag kind" }, { status: 400 });
      await prisma.linkedInAccount.update({
        where: { id: accountId },
        data: { maturingFlag: { kind, note: note || null, by: user.email, at: new Date().toISOString() } },
      });
      return NextResponse.json({ ok: true, flagged: kind });
    }

    if (action === "clear") {
      await prisma.linkedInAccount.update({ where: { id: accountId }, data: { maturingFlag: Prisma.DbNull } });
      return NextResponse.json({ ok: true, cleared: true });
    }

    if (action === "restrict" || action === "unrestrict") {
      const restrict = action === "restrict";
      const reason = note || (restrict ? "Flagged restricted from the maturing tracker" : "Undone from the maturing tracker");
      const fields = await restrictionUpdate(account, restrict, reason);
      await prisma.linkedInAccount.update({
        where: { id: accountId },
        data: {
          restrictedAt: fields.restrictedAt ?? null,
          ...(fields.restrictionLog ? { restrictionLog: fields.restrictionLog } : {}),
          // A manual flag is superseded by a real restriction mark; clear it either way.
          maturingFlag: Prisma.DbNull,
        },
      });
      return NextResponse.json({ ok: true, restricted: restrict });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Flag update failed.";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
