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

// Known Proxy6 datacenter egress. 45.32.117.124 is the dead SG box behind the Oct wave; the
// 168.227.142.x block is Proxy6 PH. Everything else with a proxy is treated as residential
// (proxy-cheap / Lumina pools). This is best-effort — we don't store a provider field.
const WAVE_HOST = "45.32.117.124";
const isDatacenter = (host: string | null) => !!host && (host === WAVE_HOST || host.startsWith("168.227.142."));

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
      prisma.rental.findMany({ select: { linkedinAccountId: true, user: { select: { company: true, fullName: true, email: true } } } }),
      prisma.accountMailEvent.findMany({ where: { type: { in: ["id_verification", "appeal_update", "recovery_appeal", "appeal_intake", "restriction"] } }, select: { linkedinAccountId: true, type: true } }),
    ]);

    // Renters per account (canonical-ish labels), and a rented-ever flag.
    const rentersByAccount = new Map<string, Set<string>>();
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
    }

    // Cause signal: an id_verification email means an identity-type restriction. Appeal/recovery
    // mail are responses, not causes, so they don't set the cause on their own.
    const hasIdVerif = new Set(mail.filter((m) => m.type === "id_verification").map((m) => m.linkedinAccountId));

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
      const cause = hasIdVerif.has(a.id) ? "Identity verification"
        : /automat|bot|scrap/i.test(firstNote) ? "Automation"
        : /new account/i.test(firstNote) ? "New-account checkpoint"
        : everRestricted ? "Unknown / no email" : "—";

      // Wave membership: on the dead SG datacenter host with a restriction in Oct 2026.
      const wave = host === WAVE_HOST && episodes.some((e) => e.at.slice(0, 7) === "2026-10");

      const rentersSet = rentersByAccount.get(a.id) || new Set<string>();
      const renters = [...rentersSet].filter((x) => x !== "__rented__");

      return {
        id: a.id, name: a.linkedinName, url: a.linkedinUrl, status: a.status, verified: a.linkedinVerified,
        createdAt: a.createdAt ? a.createdAt.toISOString() : null,
        everRestricted, open: openNow, recovered: everRestricted && !openNow, perma: !!a.permanentlyRestricted,
        restrictCount, firstRestrictedAt, lastRestrictedAt, episodes,
        proxyHost: host, proxyType, geo, ageMonths: a.accountAgeMonths,
        rentedEver: rentersSet.size > 0, renters,
        emailDomain: domainOf(a.loginEmail) || domainOf(a.workEmail),
        cause,
        wave,
      };
    });

    return NextResponse.json({ now, waveHost: WAVE_HOST, accounts: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : msg === "Unauthorized" ? 401 : 500 });
  }
}
