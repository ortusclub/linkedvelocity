import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// Referrer origin, computed at request time (no stored link relied on). For every referrer
// slug that appears as someone's referredBy, decide whether that referrer is one of our
// ambassadors and, if so, whether their account is still live:
//   existing → matched to an ambassador account that is still in inventory
//   former   → matched, but that account is unavailable / removed / retired (taken out)
//   outside  → no reliable match to an ambassador (a pure referrer, or we can't bridge it)
//
// Matching is deliberately conservative: email first, then a UNIQUE phone. A referrer whose
// record has no email and no uniquely-matching phone (often just a first name) stays "outside"
// rather than risk a wrong match — the referrerId backlink that would make this exact is almost
// never set, so we reconstruct it from contact details instead. "Former" keys on the account
// being pulled from inventory, NOT on a restrictedAt stamp: a still-available account can carry a
// recent/recovering restriction flag and is still an existing ambassador.

export const dynamic = "force-dynamic";

type Origin = "existing" | "former" | "outside";

const norm = (s?: string | null) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
// Last 9 digits, leading zeros/formatting stripped — enough to match PH mobiles across +63/0 forms.
const phone = (s?: string | null) => {
  const d = (s || "").replace(/\D/g, "").replace(/^0+/, "");
  return d.length >= 9 ? d.slice(-9) : "";
};
const DEAD_STATUS = new Set(["unavailable", "removed", "retired"]);

// Human-curated overrides for referrers the automatic match can't bridge — their referrer record
// shares no email/phone with their ambassador account (e.g. the account is held under a different
// name). Confirmed by the team; takes precedence over the computed origin. Add a slug here when a
// known ambassador keeps showing as "outside".
const MANUAL_ORIGINS: Record<string, Origin> = {
  "william-11": "existing", // William Relacio Jr. — onboarded ambassador; referrer record has no email
  "verah-77": "former",     // Verah — account held as "Janevil Gamalo", now unavailable
};

export async function GET() {
  try {
    await requireAdmin();

    const [referrers, apps, accounts] = await Promise.all([
      prisma.referrer.findMany({ select: { slug: true, email: true, contactHandle: true, contacts: true } }),
      prisma.ambassadorApplication.findMany({ select: { id: true, email: true, contactNumber: true, linkedinUrl: true } }),
      prisma.linkedInAccount.findMany({ select: { linkedinUrl: true, notes: true, status: true, permanentlyRestricted: true } }),
    ]);

    // Index ambassador applications by email (unique) and phone (may collide → keep lists).
    const appByEmail = new Map<string, (typeof apps)[number]>();
    const appByPhone = new Map<string, (typeof apps)[number][]>();
    for (const a of apps) {
      if (a.email) appByEmail.set(norm(a.email), a);
      const p = phone(a.contactNumber);
      if (p) (appByPhone.get(p) ?? appByPhone.set(p, []).get(p)!).push(a);
    }

    // Index accounts by LinkedIn URL (unique) and by the "Owner: <email>" note (unique only).
    const acctByUrl = new Map<string, (typeof accounts)[number]>();
    const acctByOwner = new Map<string, (typeof accounts)[number][]>();
    for (const ac of accounts) {
      if (ac.linkedinUrl) acctByUrl.set(ac.linkedinUrl.replace(/\/+$/, ""), ac);
      const m = (ac.notes || "").match(/Owner:\s*([^\s,;]+@[^\s,;]+)/i);
      if (m) (acctByOwner.get(norm(m[1])) ?? acctByOwner.set(norm(m[1]), []).get(norm(m[1]))!).push(ac);
    }

    const accountFor = (app: (typeof apps)[number]) => {
      if (app.linkedinUrl) { const ac = acctByUrl.get(app.linkedinUrl.replace(/\/+$/, "")); if (ac) return ac; }
      const owned = app.email ? acctByOwner.get(norm(app.email)) : undefined;
      return owned && owned.length === 1 ? owned[0] : null; // skip shared owner inboxes
    };

    const origins: Record<string, Origin> = {};
    for (const r of referrers) {
      // referrer → ambassador application
      let app = r.email ? appByEmail.get(norm(r.email)) : undefined;
      if (!app) {
        const handles = [r.contactHandle, ...(Array.isArray(r.contacts) ? (r.contacts as { handle?: string }[]).map(c => c?.handle) : [])];
        for (const h of handles) {
          const p = phone(h);
          const hit = p ? appByPhone.get(p) : undefined;
          if (hit && hit.length === 1) { app = hit[0]; break; }
        }
      }
      if (!app) { origins[r.slug.toLowerCase()] = "outside"; continue; }
      const ac = accountFor(app);
      const former = !!ac && (DEAD_STATUS.has(ac.status) || ac.permanentlyRestricted);
      origins[r.slug.toLowerCase()] = former ? "former" : "existing";
    }

    Object.assign(origins, MANUAL_ORIGINS); // curated overrides win over the computed guess

    return NextResponse.json({ origins });
  } catch (e) {
    const status = e instanceof Error && /unauthor|forbidden/i.test(e.message) ? 401 : 500;
    return NextResponse.json({ origins: {} }, { status });
  }
}
