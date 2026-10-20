import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { generateProfile, shortHeadline, PROFILE_LANES, type ProfileLane, type ProfileBuild } from "@/lib/profile-generator";
import { toIndustryBucket } from "@/lib/industry";

// Level-4 profile builder. Two actions:
//  generate — roll a fresh draft (curated pools, no AI) and save it to profileBuild. Does NOT
//             touch the inventory headline/industry/location (it's a draft to copy-paste first).
//  apply    — the team pasted it into LinkedIn: write it to inventory. Location + industry copy
//             over, but the headline is trimmed to its SHORT lead segment (before the first "|")
//             so the catalogue shows "Business Development & Partnerships", not the full tagline.
//             Stamps appliedAt so the card shows a clear "✓ Saved" state.
const schema = z.object({
  action: z.enum(["generate", "apply"]).optional(),
  lane: z.enum(["auto", ...PROFILE_LANES] as [string, ...string[]]).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const { action = "generate", lane } = schema.parse(await req.json().catch(() => ({})));
    const account = await prisma.linkedInAccount.findUnique({ where: { id }, select: { id: true, linkedinName: true, profileBuild: true } });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    if (action === "apply") {
      const build = account.profileBuild as ProfileBuild | null;
      if (!build) return NextResponse.json({ error: "Generate a profile first, then mark it saved." }, { status: 409 });
      const applied: ProfileBuild = { ...build, appliedAt: new Date().toISOString() };
      await prisma.linkedInAccount.update({
        where: { id },
        data: {
          profileBuild: applied as unknown as Prisma.InputJsonValue,
          linkedinHeadline: shortHeadline(build.headline),
          // The draft keeps LinkedIn's official industry (for pasting into the profile);
          // the catalogue column stores the short bucket so the site stays uniform.
          industry: toIndustryBucket(build.industry),
          location: build.location,
        },
      });
      return NextResponse.json({ ok: true, profileBuild: applied });
    }

    const build = generateProfile(account.linkedinName || "Account", (lane as ProfileLane | "auto") || "auto");
    await prisma.linkedInAccount.update({ where: { id }, data: { profileBuild: build as unknown as Prisma.InputJsonValue } });
    return NextResponse.json({ ok: true, profileBuild: build });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues }, { status: 400 });
    if (error instanceof Error && error.message === "Forbidden") return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
