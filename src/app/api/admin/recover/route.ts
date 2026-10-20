import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// Admin: the currently-restricted accounts, for the /admin/recover QR-relay tool. Newest
// restrictions first, so a freshly-hit account (best recovery odds) surfaces at the top to act
// on fast, instead of being buried under the long tail. Flags whether a recovery QR is attached.
export async function GET() {
  try {
    await requireAdmin();
    const accounts = await prisma.linkedInAccount.findMany({
      where: { status: { not: "removed" }, restrictedAt: { not: null } },
      select: { id: true, linkedinName: true, status: true, loginEmail: true, linkedinVerified: true, restrictedAt: true, recoveryQrUrl: true, recoveryQrAt: true },
      orderBy: { restrictedAt: "desc" },
    });
    return NextResponse.json({ accounts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}
