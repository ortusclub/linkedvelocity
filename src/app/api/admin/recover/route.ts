import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// Admin: the currently-restricted accounts, for the /admin/recover QR-relay tool. Longest-down
// first so the stalest recoveries surface. Includes whether a recovery QR is already attached.
export async function GET() {
  try {
    await requireAdmin();
    const accounts = await prisma.linkedInAccount.findMany({
      where: { status: { not: "removed" }, restrictedAt: { not: null } },
      select: { id: true, linkedinName: true, status: true, loginEmail: true, linkedinVerified: true, restrictedAt: true, recoveryQrUrl: true, recoveryQrAt: true },
      orderBy: { restrictedAt: "asc" },
    });
    return NextResponse.json({ accounts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}
