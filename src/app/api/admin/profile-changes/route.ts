import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { FIELD_LABEL, requestDetail, type ProfileChangeFieldKey, type ExperiencePayload } from "@/lib/profile-changes";

// Admin queue for renter profile-change requests (Renter Dashboard v3, Phase 2). Lists every
// request with its rental / renter / account, newest-planned work first so the team can apply
// them in order. The POST sibling ([id]/route.ts) marks each done / needs_info / rejected.
export async function GET() {
  try {
    await requireAdmin();

    const rows = await prisma.profileChangeRequest.findMany({
      orderBy: [{ plannedFor: "asc" }, { createdAt: "asc" }],
      include: {
        rental: { select: { id: true, user: { select: { fullName: true, email: true } } } },
        linkedinAccount: { select: { linkedinName: true, linkedinUrl: true } },
      },
    });

    const requests = rows.map((r) => {
      const field = r.field as ProfileChangeFieldKey;
      return {
        id: r.id,
        status: r.status,
        field,
        label: FIELD_LABEL[field],
        detail: requestDetail({ field, value: r.value, fileUrl: r.fileUrl, experience: (r.experience as ExperiencePayload | null) ?? null }),
        value: r.value,
        fileUrl: r.fileUrl,
        experience: r.experience as ExperiencePayload | null,
        plannedFor: r.plannedFor.toISOString(),
        appliedAt: r.appliedAt ? r.appliedAt.toISOString() : null,
        adminNote: r.adminNote,
        createdAt: r.createdAt.toISOString(),
        rentalId: r.rentalId,
        account: { name: r.linkedinAccount.linkedinName, url: r.linkedinAccount.linkedinUrl },
        renter: { name: r.rental.user.fullName || r.rental.user.email, email: r.rental.user.email },
      };
    });

    return NextResponse.json({ requests });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Admin profile-changes list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
