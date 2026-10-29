import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import type { RestrictionEvent } from "@/lib/restriction";

export const dynamic = "force-dynamic";

// Per-account dataset for the Restriction Analysis dashboard (/admin/restrictions). We ship one
// compact row per account and let the page compute every tab (overview, drivers, compare, cohort)
// and the drill-down drawer client-side — that keeps the comparisons and filters instant. Pure
// facts here; all bucketing/ranking is in the page.

const DAY = 86400000;
const asLog = (v: unknown): RestrictionEvent[] => (Array.isArray(v) ? (v as RestrictionEvent[]) : []);

// Recovery holding IPs: when an account's proxy was freed up (to avoid buying more), the
// already-restricted account gets consolidated onto a shared IP as a recovery holding pen. Its
// restrictions happened BEFORE the move, so its high restriction rate is reverse causation — the
// page drops these from the proxy-driver rates so the IP doesn't read as a false cause. We only
// store an account's CURRENT proxy, never the one it was on when restricted, so this matters.
const RECOVERY_HOSTS = new Set<string>(["45.32.117.124"]);
// Known Proxy6 datacenter egress (best-effort — no provider field stored).
const isDatacenter = (host: string | null) => !!host && host.startsWith("168.227.142.");

const domainOf = (email: string | null): string | null => {
  if (!email) return null;
  const at = email.indexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase().trim() || null;
};

export async function GET() {
  try {
    await requireAdmin();
    const now = Date.now();

    const [accounts, rentals, mail] = await Promise.all([
      prisma.linkedInAccount.findMany({
        where: { status: { not: "removed" } },
        select: {
          id: true, linkedinName: true, linkedinUrl: true, status: true, linkedinVerified: true,
          createdAt: true, restrictedAt: true, restrictionLog: true, permanentlyRestricted: true,
          accountAgeMonths: true, loginEmail: true, workEmail: true, proxyHost: true, proxyLocation: true,
        },
      }),
      prisma.rental.findMany({ select: { linkedinAccountId: true, accessGrantedAt: true, accessRevokedAt: true, user: { select: { company: true, fullName: true, email: true } } } }),
      prisma.accountMailEvent.findMany({ where: { type: { in: ["id_verification", "appeal_update", "recovery_appeal", "appeal_intake", "restriction"] } }, select: { linkedinAccountId: true, type: true, subject: true, bodyText: true } }),
    ]);

    // Renters per account (canonical-ish labels), and a rented-ever flag. We also keep each named
    // renter's ACCESS WINDOW ([access granted, access revoked ?? now]) so a restriction can be
    // attributed to whoever actually held the account when it fired — "restricted while rented" —
    // rather than to anyone who ever touched it. A rental with no accessGrantedAt (never opened /
    // still pending) gets no window, so a restriction before the renter opened it never counts.
    const rentersByAccount = new Map<string, Set<string>>();
    const rentalWindows = new Map<string, { label: string; start: number; end: number }[]>();
    const alias: Record<string, string> = { "lydia@profilepartner.net": "ProfilePartner", "info@ortus.solutions": "Ortus", "info@apexstrategy.io": "Apex" };
    const exclude = new Set(["samuel.adcock@gmail.com", "sdnuqwdfnuwq@ortus.solutions"]);
    for (const r of rentals) {
      const mailA = (r.user?.email || "").toLowerCase().trim();
      if (exclude.has(mailA) || mailA.endsWith("@telegram.local") || mailA.endsWith("@whatsapp.local")) {
        const set = rentersByAccount.get(r.linkedinAccountId) || new Set(); set.add("__rented__"); rentersByAccount.set(r.linkedinAccountId, set); continue;
      }
      const label = alias[mailA] || r.user?.company || r.user?.fullName || "Renter";
      const set = rentersByAccount.get(r.linkedinAccountId) || new Set(); set.add(label); rentersByAccount.set(r.linkedinAccountId, set);
      rentersByAccount.set(r.linkedinAccountId, set);
      if (r.accessGrantedAt) {
        const start = r.accessGrantedAt.getTime();
        const end = r.accessRevokedAt ? r.accessRevokedAt.getTime() : now;
        const arr = rentalWindows.get(r.linkedinAccountId) || [];
        arr.push({ label, start, end });
        rentalWindows.set(r.linkedinAccountId, arr);
      }
    }

    // Cause signal: an id_verification email means an identity-type restriction. Appeal/recovery
    // mail are responses, not causes, so they don't set the cause on their own.
    const hasIdVerif = new Set(mail.filter((m) => m.type === "id_verification").map((m) => m.linkedinAccountId));
    // Combined subject+body text per account — LinkedIn encodes the real reason both in the link
    // tokens (ek=profile_ato_appeal_fake_account) and in the prose ("we suspected someone else might
    // be using it", "doesn't comply with our Professional Community Policies"), so we read both.
    const mailTextByAccount = new Map<string, string>();
    for (const m of mail) mailTextByAccount.set(m.linkedinAccountId, `${mailTextByAccount.get(m.linkedinAccountId) || ""} ${m.subject || ""} ${m.bodyText || ""}`);
    // Most specific first: ATO/fake-account outranks policy outranks identity.
    const causeFromText = (text: string, idVerif: boolean): string | null => {
      if (/profile_ato|fake[_\s-]?account|account[_\s-]?takeover|someone else (might|may|could|is|was)[\w\s]{0,12}using|suspect\w* (that )?someone (else )?(might|may|is|was|could)|unauthoriz|believe .{0,20}not (really )?you/i.test(text)) return "Account takeover / fake account";
      if (/professional[_\s-]?community[_\s-]?policies|does(n.?t| not) comply|policy[_\s-]?violation|violat\w* .{0,20}(policy|policies|agreement)/i.test(text)) return "Policy violation";
      if (idVerif || /verify your identity|identity (check|verification)|government[_\s-]?issued|upload .{0,15}id\b/i.test(text)) return "Identity verification";
      if (/automat|scrap|\bbot\b/i.test(text)) return "Automation";
      return null;
    };

    const rows = accounts.map((a) => {
      const events = asLog(a.restrictionLog).filter((e) => e && e.at && (e.event === "restricted" || e.event === "recovered")).sort((x, y) => x.at.localeCompare(y.at));
      // Episodes: pair restricted→recovered sequentially; fall back to the restrictedAt flag.
      const episodes: { at: string; recovDays: number | null }[] = [];
      let openAt: string | null = null;
      for (const e of events) {
        if (e.event === "restricted") { if (!openAt) openAt = e.at; }
        else if (e.event === "recovered" && openAt) { episodes.push({ at: openAt, recovDays: (Date.parse(e.at) - Date.parse(openAt)) / DAY }); openAt = null; }
      }
      if (openAt) episodes.push({ at: openAt, recovDays: null });
      const flag = a.restrictedAt ? (typeof a.restrictedAt === "string" ? a.restrictedAt : a.restrictedAt.toISOString()) : null;
      if (episodes.length === 0 && flag) episodes.push({ at: flag, recovDays: null });

      const restrictCount = episodes.length;
      const openNow = !!flag;
      const everRestricted = restrictCount > 0 || openNow;
      const firstRestrictedAt = episodes[0]?.at || flag || null;
      const lastRestrictedAt = episodes.length ? episodes[episodes.length - 1].at : flag;

      const host = a.proxyHost || null;
      const proxyType = !host ? "none" : isDatacenter(host) ? "datacenter" : "residential";
      const loc = (a.proxyLocation || "").toLowerCase();
      const geo = !host ? "none" : /ph|phil/.test(loc) ? "match" : loc ? "mismatch" : "unknown";
      const firstNote = (episodes.length ? events.find((e) => e.event === "restricted")?.note : "") || "";
      const cause = causeFromText(`${mailTextByAccount.get(a.id) || ""} ${firstNote}`, hasIdVerif.has(a.id))
        || (/automat|bot|scrap/i.test(firstNote) ? "Automation"
        : /new account/i.test(firstNote) ? "New-account checkpoint"
        : everRestricted ? "Unknown / no email" : "—");

      // Recovery holding pen: restricted account parked on a consolidation IP after its proxy was
      // freed. Excluded from the proxy-driver rates (reverse causation), still counted everywhere else.
      const recoveryPool = !!host && RECOVERY_HOSTS.has(host);

      const rentersSet = rentersByAccount.get(a.id) || new Set<string>();
      const renters = [...rentersSet].filter((x) => x !== "__rented__");

      // Restricted-while-rented: the renters whose access window contained at least one restriction
      // episode. This is the fair "on their watch" attribution (vs. ever-rented × ever-restricted).
      const windows = rentalWindows.get(a.id) || [];
      const rwrSet = new Set<string>();
      if (windows.length) {
        for (const ep of episodes) {
          const epMs = Date.parse(ep.at);
          if (Number.isNaN(epMs)) continue;
          for (const w of windows) if (epMs >= w.start && epMs <= w.end) rwrSet.add(w.label);
        }
      }
      const restrictedWhileRentedBy = [...rwrSet];

      return {
        id: a.id, name: a.linkedinName, url: a.linkedinUrl, status: a.status, verified: a.linkedinVerified,
        createdAt: a.createdAt ? a.createdAt.toISOString() : null,
        everRestricted, open: openNow, recovered: everRestricted && !openNow, perma: !!a.permanentlyRestricted,
        restrictCount, firstRestrictedAt, lastRestrictedAt, episodes,
        proxyHost: host, proxyType, geo, ageMonths: a.accountAgeMonths,
        rentedEver: rentersSet.size > 0, renters, restrictedWhileRentedBy,
        emailDomain: domainOf(a.loginEmail) || domainOf(a.workEmail),
        cause,
        recoveryPool,
      };
    });

    return NextResponse.json({ now, recoveryHosts: [...RECOVERY_HOSTS], accounts: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}
