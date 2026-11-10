import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, createSession } from "@/lib/auth";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { sendAmbassadorWelcomeEmail } from "@/services/email";
import { headers } from "next/headers";
import { formatName } from "@/lib/format-name";

const completeSchema = z.object({
  fullName: z.string().min(1).transform(formatName),
  email: z.string().email(),
  ownerEmail: z.string().email().optional(),
  linkedinUrl: z.string().optional(),
  connectionCount: z.number().int().optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
  gologinProfileId: z.string().optional(),
  offeredAmount: z.number().optional(),
  proxyHost: z.string().nullable().optional(),
  proxyPort: z.number().nullable().optional(),
  proxyUsername: z.string().nullable().optional(),
  proxyPassword: z.string().nullable().optional(),
});

async function getAuthenticatedUser() {
  const headerList = await headers();
  const authHeader = headerList.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });
    if (session && session.expiresAt > new Date()) {
      return session.user;
    }
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = completeSchema.parse(body);

    // Check if there's an authenticated user (e.g. from Electron app Bearer token)
    const authenticatedUser = await getAuthenticatedUser();
    const ownerEmail = authenticatedUser?.email || data.ownerEmail || data.email;

    // Generate a random password for the ambassador account
    const tempPassword = uuid().slice(0, 12);
    const passwordHash = await hashPassword(tempPassword);

    // Create or find the user account
    let user = authenticatedUser || await prisma.user.findUnique({ where: { email: data.email } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: data.email,
          passwordHash,
          fullName: data.fullName,
          role: "customer",
        },
      });
    }

    // Create the LinkedIn account in the admin system
    const linkedinAccount = await prisma.linkedInAccount.create({
      data: {
        gologinProfileId: data.gologinProfileId || null,
        linkedinName: data.fullName,
        linkedinHeadline: null,
        linkedinUrl: data.linkedinUrl || null,
        connectionCount: data.connectionCount || 0,
        industry: data.industry || null,
        location: data.location || null,
        monthlyPrice: data.offeredAmount || 0,
        proxyHost: data.proxyHost || null,
        proxyPort: data.proxyPort || null,
        proxyUsername: data.proxyUsername || null,
        proxyPassword: data.proxyPassword || null,
        status: "under_review",
        notes: `Ambassador account. Owner: ${ownerEmail}. Profile email: ${data.email}. Monthly payout: $${data.offeredAmount || 0}`,
      },
    });

    // Log the ambassador in (may fail if called from non-browser context)
    try { await createSession(user.id); } catch {}

    // Send welcome email with credentials (non-blocking)
    sendAmbassadorWelcomeEmail(
      data.email,
      data.fullName,
      tempPassword,
      data.offeredAmount || 0
    ).catch((err) => console.error("Failed to send welcome email:", err));

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        tempPassword,
      },
      linkedinAccount: {
        id: linkedinAccount.id,
        linkedinName: linkedinAccount.linkedinName,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    console.error("Ambassador complete error:", error instanceof Error ? error.message : error, error instanceof Error ? error.stack : "");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
