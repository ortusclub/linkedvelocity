import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Per-appeal mailbox on the appeal domain (default myvahub.fyi). Minted fresh each time because
// LinkedIn's contact/appeal form rejects an email already tied to an account — a brand-new, human
// looking address sails through. LinkedIn's reply comes back to it and the inbound webhook maps it
// to this account via the appeal_mailboxes table (resolveAccountId in account-mail.ts), so the reply
// files onto the case. Change the domain with APPEAL_EMAIL_DOMAIN; it must be verified in Resend
// (sending + receiving) and listed in ONBOARDING_CAPTURE_EXTRA_DOMAINS for capture to run.
const APPEAL_DOMAIN = (process.env.APPEAL_EMAIL_DOMAIN || "myvahub.fyi").trim().toLowerCase();

// Plausible, boring human names — nothing that reads as disposable or sequential.
const FIRST = ["maria", "angelica", "kristine", "jasmine", "rhea", "camille", "patricia", "danica",
  "michelle", "joanna", "rowena", "cherrie", "mariel", "lorraine", "aubrey", "francine", "katrina",
  "john", "mark", "paolo", "joseph", "michael", "ryan", "kevin", "daniel", "christian", "anthony"];
const LAST = ["delacruz", "santos", "reyes", "ramos", "mercado", "aquino", "navarro", "villanueva",
  "gonzales", "bautista", "domingo", "salvador", "mendoza", "castillo", "fernandez", "pascual",
  "aguilar", "velasco", "rosales", "tolentino", "cabrera", "gallardo", "escobar", "lucero"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function mintAddress(): string {
  return `${pick(FIRST)}.${pick(LAST)}${10 + Math.floor(Math.random() * 90)}@${APPEAL_DOMAIN}`;
}

// GET — list this account's appeal mailboxes, newest first (for the case panel).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const rows = await prisma.appealMailbox.findMany({
      where: { linkedinAccountId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, address: true, label: true, createdAt: true },
    });
    return NextResponse.json({ domain: APPEAL_DOMAIN, mailboxes: rows });
  } catch (e) {
    const status = (e as { status?: number })?.status === 401 ? 401 : 500;
    return NextResponse.json({ error: "Failed to load appeal mailboxes" }, { status });
  }
}

// POST — mint a fresh appeal mailbox for this account.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const acct = await prisma.linkedInAccount.findUnique({ where: { id }, select: { id: true } });
    if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    // Retry on the rare address collision (unique constraint on address).
    for (let attempt = 0; attempt < 6; attempt++) {
      const address = mintAddress();
      try {
        const row = await prisma.appealMailbox.create({
          data: { address, linkedinAccountId: id, createdBy: admin.email ?? admin.fullName ?? null },
          select: { id: true, address: true, label: true, createdAt: true },
        });
        return NextResponse.json({ ok: true, domain: APPEAL_DOMAIN, mailbox: row });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }
    return NextResponse.json({ error: "Could not mint a unique address, try again" }, { status: 409 });
  } catch (e) {
    const status = (e as { status?: number })?.status === 401 ? 401 : 500;
    return NextResponse.json({ error: "Failed to mint appeal mailbox" }, { status });
  }
}
