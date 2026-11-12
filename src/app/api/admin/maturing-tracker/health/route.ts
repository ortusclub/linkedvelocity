import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { list, engine } from "@/lib/maturing/service.mjs";

// "Is maturing actually sending?" health check for the tracker.
//
// The count match on /admin/maturing-tracker only proves each account is classified into the
// right bucket — it says NOTHING about whether the engine is actually sending connection
// requests. A campaign can show status "running" for days while every send fails (e.g. the
// GoLogin key was deleted), so the status label is not trustworthy on its own. The reliable
// signal is the real send log plus the engine's live campaign state.
//
// For each actively-maturing campaign this reads TWO things from the engine and rolls them up
// per account (warm + cold combined):
//   - the workbook counts/rows  -> sent / accepted / errors + how many went out TODAY
//   - the campaign detail        -> status + whether it is paused for the day or the week and
//                                   when it sends again (resumeTaskReason / resumeTaskDueAt)
// so it can show a plain green/amber/red verdict AND a dev-board-style status line per account
// ("6 sent today", "Done for today, sends again 9:00 AM", "Weekly limit reached, sends again
// Mon", "Checking who accepted"). On-demand (a button), not on page load, because it makes a
// couple of engine calls per active campaign.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Statuses that mean "this campaign is supposed to be actively maturing right now".
// `scheduled` is counted separately as "queued"; done/cancelled are history and ignored.
const ACTIVE = new Set(["running", "waiting_daily_reset", "needs_review", "monitoring"]);
const HOUR = 3600000;
const TZ = "Asia/Manila"; // the accounts run on PH time; "today" and reset times are shown in it

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const todayStr = () => dayFmt.format(new Date());
const isToday = (iso?: string | null) => !!iso && dayFmt.format(new Date(iso)) === todayStr();
const fmtWhen = (iso?: string | null, dateOnly = false) => {
  if (!iso) return "";
  const t = new Date(iso);
  if (isNaN(t.getTime())) return "";
  return dateOnly ? dateFmt.format(t) : timeFmt.format(t);
};

type Camp = { id: string; name?: string; status: string; profileIds?: string[]; createdAt?: string };
type Probe = {
  key: string; email: string; status: string; created: number;
  sentToday: number; sentTotal: number; accepted: number; errors: number; pending: number;
  resumeReason: string; resumeAt: string | null;
  // Latest future account cooldown on this campaign (the engine benches an account until Monday
  // after repeated unconfirmed sends: a suspected weekly invite limit). null = not benched.
  pausedUntil: string | null;
};

async function probe(c: Camp): Promise<Probe> {
  const email = String(c.name || "").replace(/\s*·\s*cold$/i, "").trim().toLowerCase();
  const key = (c.profileIds && c.profileIds[0]) || email || c.id;
  const base: Probe = { key, email, status: c.status, created: Date.parse(c.createdAt || "") || Date.now(), sentToday: 0, sentTotal: 0, accepted: 0, errors: 0, pending: 0, resumeReason: "", resumeAt: null, pausedUntil: null };

  const [wbR, detR] = await Promise.allSettled([
    engine(`/api/maturing/workbook/${c.id}?offset=0`),
    engine(`/api/campaign/${c.id}`),
  ]);

  if (wbR.status === "fulfilled") {
    const wb = wbR.value as { counts?: Record<string, unknown>; rows?: { status?: string; sentAt?: string }[] };
    const counts = wb.counts || {};
    base.sentTotal = Number(counts.sent) || 0;
    base.accepted = Number(counts.accepted) || 0;
    base.errors = Number(counts.errors) || 0;
    base.pending = Number(counts.pending) || 0;
    // sent rows come first (planned-day order) and maturing daily caps are small, so page 1 holds
    // them all; count the ones whose send landed today in PH time.
    base.sentToday = (wb.rows || []).filter((r) => r.status === "sent" && isToday(r.sentAt)).length;
  }
  if (detR.status === "fulfilled") {
    const det = detR.value as { campaign?: Record<string, unknown>; campaignStatus?: { next?: { resumeAt?: string } }; leadCounts?: Record<string, unknown> };
    const cc = det.campaign || {};
    if (typeof cc.status === "string") base.status = cc.status;
    base.resumeReason = typeof cc.resumeTaskReason === "string" ? cc.resumeTaskReason : "";
    const blocks = Array.isArray(cc.matureAccountBlocks) ? (cc.matureAccountBlocks as { reason?: string; until?: string }[]) : [];
    for (const b of blocks) {
      const until = typeof b?.until === "string" ? Date.parse(b.until) : NaN;
      if (b?.reason === "cooldown" && until > Date.now() && (!base.pausedUntil || until > Date.parse(base.pausedUntil))) base.pausedUntil = b.until as string;
    }
    base.resumeAt = (typeof cc.resumeTaskDueAt === "string" ? cc.resumeTaskDueAt : null) || det.campaignStatus?.next?.resumeAt || null;
    // If the workbook read failed, fall back to the detail's own counts so a transient error
    // can't make a healthy, sending account look like "no leads loaded".
    if (wbR.status !== "fulfilled" && det.leadCounts) {
      base.sentTotal = Number(det.leadCounts.sent) || 0;
      base.pending = Number(det.leadCounts.pending) || 0;
    }
  }
  if (wbR.status !== "fulfilled" && detR.status !== "fulfilled") base.pending = -1; // couldn't read either; don't claim "no leads"
  return base;
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

type Acct = {
  email: string; statuses: Set<string>; created: number;
  sentToday: number; sentTotal: number; accepted: number; errors: number; pending: number;
  resumeReason: string; resumeAt: string | null; pausedUntil: string | null;
};

export async function POST() {
  try {
    await requireAdmin();

    const data = (await list()) as { campaigns: Camp[]; engineError?: string };
    if (data.engineError) return NextResponse.json({ error: data.engineError }, { status: 502 });

    // The engine is shared — only LV maturing campaigns are keyed `lv_<profileId>_warm|cold`.
    const campaigns = (data.campaigns || []).filter((c) => String(c.id || "").startsWith("lv_"));
    const active = campaigns.filter((c) => ACTIVE.has(c.status));
    const queued = campaigns.filter((c) => c.status === "scheduled").length;

    const probes = await pool(active, 6, probe);

    // Roll warm + cold up to one row per account.
    const now = Date.now();
    const byAcct = new Map<string, Acct>();
    for (const p of probes) {
      let a = byAcct.get(p.key);
      if (!a) { a = { email: p.email, statuses: new Set(), created: p.created, sentToday: 0, sentTotal: 0, accepted: 0, errors: 0, pending: 0, resumeReason: "", resumeAt: null, pausedUntil: null }; byAcct.set(p.key, a); }
      a.statuses.add(p.status);
      a.created = Math.min(a.created, p.created);
      a.sentToday += p.sentToday; a.sentTotal += p.sentTotal; a.accepted += p.accepted; a.errors += p.errors; a.pending += p.pending;
      if (!a.email && p.email) a.email = p.email;
      if (p.resumeReason === "weekly" || (!a.resumeReason && p.resumeReason)) a.resumeReason = p.resumeReason;
      if (p.pausedUntil && (!a.pausedUntil || Date.parse(p.pausedUntil) > Date.parse(a.pausedUntil))) a.pausedUntil = p.pausedUntil;
      if (p.resumeAt && (!a.resumeAt || Date.parse(p.resumeAt) < Date.parse(a.resumeAt))) a.resumeAt = p.resumeAt;
    }

    // One plain, dev-board-style status line per account + a green/amber/red state.
    // Order matters: a campaign can show "running" while sending nothing, so we never call an
    // account healthy on its status label alone — "sending" requires it to have actually sent.
    type Row = { email: string; state: "sending" | "starting" | "attention"; line: string };
    const rows: Row[] = [];
    for (const a of byAcct.values()) {
      // Dropped out of the active set since the list snapshot (now queued/done/cancelled): it is
      // not actively maturing right now, so leave it out rather than mislabel it as broken.
      if (![...a.statuses].some((s) => ACTIVE.has(s))) continue;

      const soFar = `${a.sentTotal} sent, ${a.accepted} connected so far`;
      const ageH = (now - a.created) / HOUR;
      let state: Row["state"];
      let line: string;

      if (a.statuses.has("needs_review")) {
        // Parked on a login/identity check — not sending now, regardless of past sends.
        state = "attention";
        line = a.sentTotal > 0
          ? `Was sending but now parked — re-login, then Re-check / resume (${a.sentTotal} sent so far)`
          : "Parked on a login/identity check — re-login the account, then Re-check / resume";
      } else if (a.sentTotal > 0) {
        // It has actually sent — pick the wording from its live rhythm.
        state = "sending";
        if (a.resumeReason === "weekly") {
          line = `Weekly limit reached — sends again ${fmtWhen(a.resumeAt, true) || "next week"} · ${soFar}`;
        } else if (a.statuses.has("running")) {
          line = `Sending now${a.sentToday ? ` — ${a.sentToday} sent today` : ""} · ${soFar}`;
        } else if (a.statuses.has("waiting_daily_reset")) {
          line = `Done for today${a.sentToday ? ` (${a.sentToday} sent)` : ""} — sends again ${fmtWhen(a.resumeAt) || "tomorrow"} · ${soFar}`;
        } else if (a.statuses.has("monitoring")) {
          line = `Checking who accepted · ${soFar}`;
        } else {
          line = `${a.sentToday} sent today · ${soFar}`;
        }
      } else if (a.pending === 0) {
        state = "attention";
        line = "No leads loaded, so it can never send — needs a human to set it up";
      } else if (a.pausedUntil) {
        // Benched by the engine: LinkedIn didn't confirm its invites (Send clicked, never went
        // Pending), so it is paused until the weekly reset. Name that plainly instead of calling
        // it an engine error, so the operator checks for a restriction and otherwise leaves it.
        state = "attention";
        line = `Suspected weekly limit — LinkedIn didn't accept its invites. Paused until ${fmtWhen(a.pausedUntil, true)}, then restarts itself. Check it in GoLogin for a restriction; if it looks fine, leave it`;
      } else if (a.errors > 0) {
        state = "attention";
        line = "The engine keeps hitting errors on every send (nothing is going out)";
      } else if (ageH < 24) {
        state = "starting";
        line = "Just launched — give it up to a day to send its first requests";
      } else {
        state = "attention";
        line = "Launched but has not sent anything — needs a look";
      }
      rows.push({ email: a.email, state, line });
    }

    const rank = { attention: 0, starting: 1, sending: 2 } as const;
    rows.sort((x, y) => rank[x.state] - rank[y.state] || x.email.localeCompare(y.email));

    const summary = {
      sending: rows.filter((r) => r.state === "sending").length,
      starting: rows.filter((r) => r.state === "starting").length,
      attention: rows.filter((r) => r.state === "attention").length,
      queued,
      accounts: rows.length,
    };

    return NextResponse.json(
      { checkedAt: new Date().toISOString(), summary, rows },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed.";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
