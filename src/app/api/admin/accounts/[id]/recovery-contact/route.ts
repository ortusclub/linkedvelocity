import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto-creds";
import { messagingLinks } from "@/lib/issue-contacts";
import { matchApp, ownerEmailFromNotes } from "@/lib/recovery-case";
import { formatName } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Restrictions v2 — everything the team needs on hand to actually run a recovery, fetched only
// when a case is opened (so credentials aren't in the list payload): the owner's own contact
// channels (to chase them) and the account sign-in details (LinkedIn URL, login email, password).
// The live 2FA code comes from the existing /totp endpoint; the raw password is admin-only, same
// as inventory. Admin-gated.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const account = await prisma.linkedInAccount.findUnique({
      where: { id },
      select: { linkedinUrl: true, loginEmail: true, accountPassword: true, personalEmail: true, notes: true, twoFactor: true },
    });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const apps = await prisma.ambassadorApplication.findMany({ select: { id: true, email: true, linkedinUrl: true, fullName: true, contactNumber: true, contactChannel: true } });
    const app = matchApp(apps, account);

    const name = formatName(app?.fullName || "") || ownerEmailFromNotes(account.notes) || "the owner";
    const ownerEmail = app?.email || account.personalEmail || null;
    const prefRaw = (app?.contactChannel || "").toLowerCase();
    const pref = /whats|wa/.test(prefRaw) ? "wa" : /tele|tg|t\.me/.test(prefRaw) ? "tg" : /mail|email/.test(prefRaw) ? "email" : "";

    const links = messagingLinks(app?.contactNumber || null);
    const contacts: Array<{ key: string; label: string; value: string; href: string; open: string }> = [];
    if (links.whatsapp && app?.contactNumber) contacts.push({ key: "wa", label: "WhatsApp", value: app.contactNumber, href: links.whatsapp, open: "Chat" });
    if (links.telegram && app?.contactNumber) contacts.push({ key: "tg", label: "Telegram", value: app.contactNumber, href: links.telegram, open: "Chat" });
    if (ownerEmail) contacts.push({ key: "email", label: "Personal email", value: ownerEmail, href: `mailto:${ownerEmail}`, open: "Email" });

    return NextResponse.json({
      owner: { name, email: ownerEmail, pref, prefLabel: pref === "wa" ? "WhatsApp" : pref === "tg" ? "Telegram" : pref === "email" ? "Email" : "" },
      contacts,
      account: { linkedinUrl: account.linkedinUrl, loginEmail: account.loginEmail, password: decryptSecret(account.accountPassword) || null, has2fa: !!decryptSecret(account.twoFactor) },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}
