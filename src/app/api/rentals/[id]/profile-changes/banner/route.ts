import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { put } from "@vercel/blob";
import { v4 as uuid } from "uuid";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — a LinkedIn banner (1584×396) is well under this.
const OK_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

// Renter uploads a banner image for a profile-change request. Scoped to the renter's own
// active rental (the generic /api/upload is admin-only). Returns the public blob URL, which
// the dashboard then includes as `fileUrl` when it submits the request.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const rental = await prisma.rental.findFirst({
      where: { id, userId: user.id },
      select: { id: true, status: true },
    });
    if (!rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    if (rental.status !== "active") {
      return NextResponse.json({ error: "This rental isn't active." }, { status: 409 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (!OK_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Please upload a PNG or JPG image." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That image is too large (max 8 MB)." }, { status: 400 });
    }

    const ext = file.type === "image/png" ? "png" : "jpg";
    const blob = await put(`profile-change-banners/${uuid()}.${ext}`, file, {
      access: "public",
      contentType: file.type,
    });

    return NextResponse.json({ url: blob.url });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Banner upload error:", error);
    return NextResponse.json({ error: "Upload failed — try again." }, { status: 500 });
  }
}
