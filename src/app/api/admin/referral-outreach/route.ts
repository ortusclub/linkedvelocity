import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { OutreachRow, OutreachSegment } from "@/lib/referral-outreach";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
const SIGNUP_URL = `${APP_URL}/become-a-referrer`;
const SYSTEM = new Set(["diy", "test-43", "sam-38", "ton-77"]);
const QUIET_DAYS = 45;
const norm = (s?: string | null) => (s || "").trim().toLowerCase();

// The fixed campaign subjects (mirror SEGMENT_SUBJECTS) — used to detect "already emailed"
// in this campaign and, for conversion tracking, when we first emailed each address.
const isCampaignSubject = (s: string) =>
  ["Your first referral could pay ₱1,000", "You know how it works, now earn from it", "You can still earn with LinkedVelocity"].includes(s) ||
  s.startsWith("Your referral link still works,");

type ChatC = { method: "whatsapp" | "telegram" | "viber"; handle: string } | null;
// Normalize a stored handle into the exact form contactLink accepts, so the chat buttons
// actually open. Stored handles are messy: "telegram:@@x", "telegram: name", 0-prefixed PH
// mobiles (contactLink rejects a leading 0), "+63…", bare usernames, etc.
function normChat(method: string, raw: string): ChatC {
  const s = raw.replace(/^(whatsapp|telegram|viber|phone)\s*:/i, "").trim();
  const intl = (digits: string) => (digits.startsWith("0") && digits.length === 11 ? "63" + digits.slice(1) : digits);
  if (method === "telegram") {
    const u = (s.match(/(?:t\.me\/|@)+([a-z][a-z0-9_]{3,31})/i) || [])[1] || s.replace(/^@+/, "").trim();
    if (/^[a-z][a-z0-9_]{3,31}$/i.test(u)) return { method: "telegram", handle: u };
    const d = intl(s.replace(/\D/g, ""));
    return d.length >= 10 && d.length <= 15 && !d.startsWith("0") ? { method: "telegram", handle: "+" + d } : null;
  }
  const d = intl(s.replace(/\D/g, ""));
  if (d.length < 10 || d.length > 15 || d.startsWith("0")) return null;
  return { method: method as "whatsapp" | "viber", handle: "+" + d };
}

function pickChat(method?: string | null, handle?: string | null, contacts?: unknown): ChatC {
  const list = Array.isArray(contacts) ? (contacts as Array<{ method?: string; handle?: string; preferred?: boolean }>) : [];
  const pref = list.find(c => c.preferred && c.handle) || list.find(c => c.handle);
  let m = (pref?.method || method || "").toLowerCase();
  const h = (pref?.handle || handle || "").trim();
  if (!h) return null;
  // An email stored as a contact is NOT a chat channel — its "@" must not be read as Telegram.
  const bare = h.replace(/^(telegram|whatsapp|viber|phone|email)\s*:/i, "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bare)) return null;
  const blob = `${m} ${h}`.toLowerCase();
  if (/telegram|t\.me|@/.test(blob)) m = "telegram";
  else if (/viber/.test(blob)) m = "viber";
  else m = "whatsapp";
  return normChat(m, h);
}

// Most-recent REFERRAL-PROGRAM chat touch (WhatsApp/Telegram/Viber) from an outreach_log, so the
// page shows "already messaged about the referral program on <channel> <date>". Deliberately
// ignores chats about anything else (onboarding/pipeline follow-ups) and email. Referral touches
// are tagged by the /log endpoint: id "referral:…" and text "Referral program invite sent …".
const CHAT_CH = new Set(["whatsapp", "telegram", "viber"]);
function lastChat(log: unknown): { ch: "whatsapp" | "telegram" | "viber"; at: string } | null {
  if (!Array.isArray(log)) return null;
  let best: { ch: "whatsapp" | "telegram" | "viber"; at: string } | null = null;
  for (const e of log as Array<{ id?: string; ch?: string; at?: string; text?: string }>) {
    if (!e || !e.at || !CHAT_CH.has(String(e.ch))) continue;
    const isReferral = String(e.id || "").startsWith("referral:") || /^Referral program invite sent/i.test(String(e.text || ""));
    if (!isReferral) continue;
    if (!best || e.at > best.at) best = { ch: e.ch as "whatsapp" | "telegram" | "viber", at: String(e.at) };
  }
  return best;
}

export async function GET() {
  try {
    await requireAdmin();
    const [referrers, apps, suppressions] = await Promise.all([
      prisma.referrer.findMany({ select: { id: true, slug: true, name: true, email: true, contactMethod: true, contactHandle: true, contacts: true, outreachLog: true, createdAt: true } }),
      prisma.ambassadorApplication.findMany({ select: { id: true, fullName: true, email: true, status: true, referredBy: true, referrerId: true, createdAt: true, onboardedAt: true, contactNumber: true, contactChannel: true, outreachLog: true } }),
      prisma.outreachSuppression.findMany({ select: { email: true, reason: true } }).catch(() => [] as Array<{ email: string; reason: string | null }>),
    ]);
    // Best-effort: an email-log hiccup must not break the page (just no "contacted" badges).
    // 120-day window so we can still see the send time behind a conversion; the "contacted"
    // badge + send-skip stays on the original 45-day cutoff (CONTACTED_CUTOFF below).
    const logs = await prisma.$queryRaw<Array<{ to: string; subject: string; created_at: Date }>>`SELECT lower("to") AS to, subject, created_at FROM email_log WHERE created_at > NOW() - INTERVAL '120 days' AND status <> 'failed'`.catch(() => []);
    const suppressed = new Map(suppressions.map(s => [norm(s.email), s.reason]));

    // referrals per slug + latest referral date (for 1a/1b)
    const refdCount = new Map<string, number>(), lastRefd = new Map<string, number>();
    for (const a of apps) { const k = norm(a.referredBy); if (!k) continue; refdCount.set(k, (refdCount.get(k) || 0) + 1); const t = a.createdAt.getTime(); if (t > (lastRefd.get(k) || 0)) lastRefd.set(k, t); }
    const refById = new Map(referrers.map(r => [r.id, r]));

    // "already contacted" = campaign email to this address in the last 45 days (badge + send-skip).
    // firstEmailedAt = the earliest campaign email per address (within 120d) — the anchor a
    // later signup is compared against to count it as "signed up after being emailed".
    const CONTACTED_CUTOFF = Date.now() - 45 * 864e5;
    const contactedEmails = new Set<string>();
    const firstEmailedAt = new Map<string, number>();
    for (const l of logs) {
      if (!isCampaignSubject(l.subject)) continue;
      const e = norm(l.to);
      const t = new Date(l.created_at).getTime();
      if (t >= CONTACTED_CUTOFF) contactedEmails.add(e);
      if (t < (firstEmailedAt.get(e) ?? Infinity)) firstEmailedAt.set(e, t);
    }
    // A signup counts as a conversion when the record was created AFTER we first emailed
    // that address in the campaign. Returns the signup date (ISO) or null.
    const convertedAfter = (email: string | null, signedUpAtMs: number): string | null => {
      if (!email) return null;
      const t = firstEmailedAt.get(norm(email));
      return t != null && signedUpAtMs > t ? new Date(signedUpAtMs).toISOString() : null;
    };

    const rows: OutreachRow[] = [];
    const takenEmails = new Set<string>();   // dedupe a person across tables/segments
    const takenRefIds = new Set<string>();

    // 1 — referrers (link is their own /r/<slug>)
    for (const r of referrers) {
      if (SYSTEM.has(r.slug)) continue;
      const n = refdCount.get(norm(r.slug)) || 0;
      const last = lastRefd.get(norm(r.slug));
      let seg: OutreachSegment | null = null;
      if (n === 0) seg = "1a";
      else if (last && last < Date.now() - QUIET_DAYS * 864e5) seg = "1b";
      if (!seg) continue;
      const chat = pickChat(r.contactMethod, r.contactHandle, r.contacts);
      const lc = lastChat(r.outreachLog);
      rows.push({ kind: "referrer", id: r.id, name: r.name, segment: seg, email: r.email || null, chatMethod: chat?.method || null, chatHandle: chat?.handle || null, link: `${APP_URL}/r/${r.slug}`, isSignup: false, contacted: !!r.email && contactedEmails.has(norm(r.email)), lastChatCh: lc?.ch ?? null, lastChatAt: lc?.at ?? null, signedUpAt: r.createdAt.toISOString(), signedUpAfterEmailAt: convertedAfter(r.email, r.createdAt.getTime()), suppressed: !!r.email && suppressed.has(norm(r.email)), suppressReason: r.email ? suppressed.get(norm(r.email)) ?? null : null });
      if (r.email) takenEmails.add(norm(r.email));
      takenRefIds.add(r.id);
    }

    // 2 / 3 — ambassadors (link = their linked referrer's /r/<slug>, else the signup CTA)
    for (const a of apps) {
      if (a.email && takenEmails.has(norm(a.email))) continue;
      if (a.referrerId && takenRefIds.has(a.referrerId)) continue;
      // Segment 3 is only people who dropped out — rejected or unreachable. Everyone still
      // in progress (pending/reviewing/approved/onboarding/contacted/on_hold) is actively
      // being onboarded and must NOT be told their account "didn't make it through".
      let seg: OutreachSegment | null = null;
      if (a.status === "onboarded") seg = "2";
      else if (a.status === "rejected" || a.status === "unreachable") seg = "3";
      if (!seg) continue;
      const linkedRef = a.referrerId ? refById.get(a.referrerId) : null;
      const chat = pickChat(a.contactChannel, a.contactNumber, null);
      const lc = lastChat(a.outreachLog);
      rows.push({ kind: "ambassador", id: a.id, name: a.fullName, segment: seg, email: a.email || null, chatMethod: chat?.method || null, chatHandle: chat?.handle || null, link: linkedRef ? `${APP_URL}/r/${linkedRef.slug}` : SIGNUP_URL, isSignup: !linkedRef, contacted: !!a.email && contactedEmails.has(norm(a.email)), lastChatCh: lc?.ch ?? null, lastChatAt: lc?.at ?? null, signedUpAt: a.createdAt.toISOString(), signedUpAfterEmailAt: convertedAfter(a.email, a.createdAt.getTime()), suppressed: !!a.email && suppressed.has(norm(a.email)), suppressReason: a.email ? suppressed.get(norm(a.email)) ?? null : null });
      if (a.email) takenEmails.add(norm(a.email));
    }

    const counts = rows.reduce((m, r) => { m[r.segment] = (m[r.segment] || 0) + 1; return m; }, {} as Record<string, number>);
    const convertedCount = rows.filter(r => r.signedUpAfterEmailAt).length;
    return NextResponse.json({ rows, counts, convertedCount });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500 });
  }
}
