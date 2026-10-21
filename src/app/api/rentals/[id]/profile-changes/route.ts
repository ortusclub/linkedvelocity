import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import {
  type ProfileChangeFieldKey,
  type ExperiencePayload,
  PROFILE_CHANGE_FIELD_KEYS,
  FIELD_MAX,
  isChangeValid,
  firstPlannedFrom,
  CHANGE_SPACING_DAYS,
} from "@/lib/profile-changes";

interface IncomingChange {
  field: ProfileChangeFieldKey;
  value?: string | null;
  fileUrl?: string | null;
  experience?: ExperiencePayload | null;
}

// Renters can't safely edit a rented profile themselves (big edits at once get accounts
// restricted), so they REQUEST changes here and the LV team applies them ~1 every 2 days.
// POST creates one ProfileChangeRequest per submitted change, each on its own planned date.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const rental = await prisma.rental.findFirst({
      where: { id, userId: user.id },
      include: { linkedinAccount: { select: { id: true, restrictedAt: true } } },
    });
    if (!rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    if (rental.status !== "active") {
      return NextResponse.json({ error: "This rental isn't active, so profile changes can't be requested yet." }, { status: 409 });
    }
    if (rental.linkedinAccount.restrictedAt) {
      return NextResponse.json({ error: "This account is restricted right now — we can't change the profile until it's recovered." }, { status: 409 });
    }

    const body = await req.json().catch(() => null);
    const raw: unknown = body?.changes;
    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ error: "Pick at least one change to request." }, { status: 400 });
    }
    if (raw.length > PROFILE_CHANGE_FIELD_KEYS.length) {
      return NextResponse.json({ error: "Too many changes in one request." }, { status: 400 });
    }

    const changes: IncomingChange[] = [];
    const seen = new Set<string>();
    for (const c of raw as IncomingChange[]) {
      if (!c || !PROFILE_CHANGE_FIELD_KEYS.includes(c.field)) {
        return NextResponse.json({ error: "Unknown change type." }, { status: 400 });
      }
      if (seen.has(c.field)) {
        return NextResponse.json({ error: "Each change can only be requested once per submission." }, { status: 400 });
      }
      seen.add(c.field);
      const max = FIELD_MAX[c.field];
      if (max && typeof c.value === "string" && c.value.length > max) {
        return NextResponse.json({ error: `A change is too long (max ${max} characters).` }, { status: 400 });
      }
      if (!isChangeValid(c)) {
        return NextResponse.json({ error: "One of the changes is incomplete." }, { status: 400 });
      }
      changes.push(c);
    }

    // Each change gets its own planned date, spaced 2 days apart, starting 2 days after the
    // last pending change on this rental (or tomorrow if nothing is pending).
    const pending = await prisma.profileChangeRequest.findMany({
      where: { rentalId: rental.id, status: "planned" },
      select: { plannedFor: true },
    });
    let next = firstPlannedFrom(pending.map((p) => p.plannedFor));

    const toCreate = changes.map((c, i) => {
      const plannedFor = new Date(next);
      if (i < changes.length - 1) {
        next = new Date(next);
        next.setDate(next.getDate() + CHANGE_SPACING_DAYS);
      }
      return {
        rentalId: rental.id,
        accountId: rental.linkedinAccount.id,
        field: c.field,
        value: c.field === "banner" || c.field === "experience" ? null : (c.value || "").trim(),
        fileUrl: c.field === "banner" ? c.fileUrl ?? null : null,
        experience: c.field === "experience" ? (c.experience as object) : undefined,
        plannedFor,
        createdById: user.id,
      };
    });

    await prisma.profileChangeRequest.createMany({ data: toCreate });

    const finishBy = toCreate[toCreate.length - 1].plannedFor;
    return NextResponse.json({ created: toCreate.length, finishBy: finishBy.toISOString() });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Profile change request error:", error);
    return NextResponse.json({ error: "Couldn't save your request — try again." }, { status: 500 });
  }
}
