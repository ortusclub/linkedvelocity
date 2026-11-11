import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { list, engine } from "@/lib/maturing/service.mjs";

// "Is maturing actually sending?" health check for the tracker.
//
// The count match on /admin/maturing-tracker only proves each account is classified into the
// right bucket — it says NOTHING about whether the engine is actually sending connection
// requests. A campaign can show status "running" for days while every send fails (e.g. the
// GoLogin key was deleted), so the status label alone is not trustworthy. The ONLY reliable
// signal is the campaign's real send log: counts.sent / accepted / errors from the engine
// workbook. This endpoint reads those for every actively-maturing campaign, rolls them up per
// account, and returns a plain green/amber/red verdict so a non-technical operator can tell at
// a glance whether maturing is working — no numbers to interpret.
//
// It is intentionally on-demand (a button), not part of the normal page load, because it makes
// one engine call per active campaign.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Statuses that mean "this campaign is supposed to be actively maturing right now". We check
// these. `scheduled` is counted separately as "queued" (legitimately waiting its turn for the
// auto-start trickle); done/cancelled are history and ignored.
const ACTIVE = new Set(["running", "waiting_daily_reset", "needs_review", "monitoring"]);
const HOUR = 3600000;

type Camp = { id: string; name?: string; status: string; profileIds?: string[]; createdAt?: string };
type Counts = { sent: number; accepted: number; errors: number; total: number };
type Acct = {
  key: string;
  email: string;
  name: string;
  statuses: Set<string>;
  created: number;
  sent: number;
  accepted: number;
  errors: number;
  total: number;
};

async function countsFor(id: string): Promise<Counts> {
  // A very high offset returns the campaign-wide counts with an empty rows array, so we read
  // the totals without dragging ~100 lead rows per campaign over the wire.
  try {
    const d = (await engine(`/api/maturing/workbook/${id}?offset=100000`)) as { counts?: Record<string, unknown> };
    const c = d.counts || {};
    return { sent: Number(c.sent) || 0, accepted: Number(c.accepted) || 0, errors: Number(c.errors) || 0, total: Number(c.total) || 0 };
  } catch {
    return { sent: 0, accepted: 0, errors: 0, total: -1 }; // -1 total = couldn't read; don't misreport as "no leads"
  }
}

// Run promise-returning tasks with a small concurrency cap so we don't open hundreds of engine
// connections at once.
async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function POST() {
  try {
    await requireAdmin();

    const data = (await list()) as { campaigns: Camp[]; engineError?: string };
    if (data.engineError) return NextResponse.json({ error: data.engineError }, { status: 502 });

    // The engine is shared — renter / Ortus-outreach campaigns run on it too. LV maturing
    // campaigns are the only ones keyed `lv_<profileId>_warm|cold`, so filter to those; a
    // client's campaign must never show up in our maturing health.
    const campaigns = (data.campaigns || []).filter((c) => String(c.id || "").startsWith("lv_"));
    const active = campaigns.filter((c) => ACTIVE.has(c.status));
    const queued = campaigns.filter((c) => c.status === "scheduled").length;

    const withCounts = await pool(active, 8, async (c) => ({ c, counts: await countsFor(c.id) }));

    // Roll warm + cold up to one row per account (keyed on the profile id, else the email).
    const now = Date.now();
    const byAcct = new Map<string, Acct>();
    for (const { c, counts } of withCounts) {
      const email = String(c.name || "").replace(/\s*·\s*cold$/i, "").trim().toLowerCase();
      const key = (c.profileIds && c.profileIds[0]) || email || c.id;
      let a = byAcct.get(key);
      if (!a) {
        a = { key, email, name: "", statuses: new Set(), created: Date.parse(c.createdAt || "") || now, sent: 0, accepted: 0, errors: 0, total: 0 };
        byAcct.set(key, a);
      }
      a.statuses.add(c.status);
      a.created = Math.min(a.created, Date.parse(c.createdAt || "") || now);
      a.sent += counts.sent;
      a.accepted += counts.accepted;
      a.errors += counts.errors;
      a.total += Math.max(0, counts.total);
      if (!a.email && email) a.email = email;
    }

    // Classify each account with a plain-language verdict.
    //  sending  (green) — it has actually sent requests
    //  starting (amber) — a campaign exists but nothing sent yet AND it only launched recently
    //  attention (red)  — not sending for a reason that needs a human
    const sending: { email: string; accepted: number; sent: number }[] = [];
    const starting: { email: string; reason: string }[] = [];
    const attention: { email: string; reason: string }[] = [];

    for (const a of byAcct.values()) {
      const ageH = (now - a.created) / HOUR;
      const label = a.email || a.key;
      if (a.sent > 0) {
        sending.push({ email: label, accepted: a.accepted, sent: a.sent });
      } else if (a.statuses.has("needs_review")) {
        attention.push({ email: label, reason: "Parked on a login/identity check — needs the account re-logged-in, then Re-check / resume" });
      } else if (a.total === 0) {
        attention.push({ email: label, reason: "No leads loaded, so it can never send — needs a human to set it up" });
      } else if (a.errors > 0) {
        attention.push({ email: label, reason: "The engine keeps hitting errors on every send (nothing is going out)" });
      } else if (ageH < 24) {
        starting.push({ email: label, reason: "Just launched — give it up to a day to send its first requests" });
      } else {
        attention.push({ email: label, reason: "Launched but has not sent anything — needs a look" });
      }
    }

    const cmp = (x: { email: string }, y: { email: string }) => x.email.localeCompare(y.email);
    attention.sort(cmp);
    starting.sort(cmp);

    return NextResponse.json(
      {
        checkedAt: new Date().toISOString(),
        summary: { sending: sending.length, starting: starting.length, attention: attention.length, queued, accounts: byAcct.size },
        attention,
        starting,
        // The happy list is not shown by default (nothing to act on) but returned for completeness.
        sendingSample: sending.sort((a, b) => b.sent - a.sent).slice(0, 5),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed.";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
