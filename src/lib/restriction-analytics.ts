// Restriction analytics: turns the per-account restrictionLog (append-only history of
// "restricted"/"recovered" events, see src/lib/restriction.ts) plus account + application
// facts into the cohort breakdowns shown on /admin/restrictions. Pure functions — the API
// route does the prisma reads and hands the rows in, so this stays easy to reason about.
//
// CAVEAT the UI surfaces: restrictionLog is recent, so a restrict→recover that happened
// before logging existed (restrictedAt already cleared, empty log) is invisible here. Rates
// are exact going forward; older history is undercounted.

export type RestrictionEvent = {
  at: string;
  event: "restricted" | "recovered";
  note?: string;
  creditedDays?: number;
};

export type AnalyticsAccount = {
  id: string;
  linkedinName: string;
  linkedinUrl: string | null;
  linkedinVerified: boolean;
  createdAt: Date | string | null; // when the account joined our inventory — the cohort anchor
  restrictedAt: Date | string | null;
  restrictionLog: unknown;
  connectionCount: number;
  accountAgeMonths: number | null;
  loginEmail: string | null;
  workEmail: string | null;
  proxyHost: string | null;
  proxyLocation: string | null;
  status: string;
  notes: string | null;
};

export type AnalyticsApp = {
  linkedinUrl: string | null;
  email: string;
  status: string | null;
  emailPrimaryAt: Date | string | null;
  onboardedAt: Date | string | null;
  verifiedAt: Date | string | null;
  paidAt: Date | string | null;
};

// One row of the historical "stage when the restriction happened" breakdown: each
// restriction EVENT is attributed to the stage the account was in at that moment
// (by comparing the event timestamp to the account's milestone dates), not where the
// account sits now. Denominator is events, not accounts.
export type StageEventRow = {
  stage: string;
  events: number; // restriction events that happened at this stage
  share: number; // events / all datable restriction events
  recovered: number; // of those, how many were later cleared
  open: number; // still restricted / never recovered
  recoveryRate: number | null; // recovered / events
};

export type CohortRow = {
  bucket: string;
  total: number;
  restricted: number; // ever restricted
  restrictionRate: number; // restricted / total
  recovered: number;
  open: number; // currently restricted
  recoveryRate: number | null; // recovered / (recovered + open), null if none restricted
};

export type FeedItem = {
  at: string;
  event: "restricted" | "recovered";
  account: string;
  note?: string;
  creditedDays?: number;
};

// One currently-restricted account: the live roster of who's down and for how long.
export type OpenRestrictionRow = {
  account: string;
  url: string | null;
  since: string | null; // ISO date the current restriction opened
  days: number | null; // days restricted so far
  verified: boolean;
  status: string;
  stage: string; // stage the account was in WHEN this restriction hit (historical)
  clients: string[]; // renters currently holding the account
  note?: string; // note on the opening restricted event
};

// One month on the restriction trend: how many restrictions happened that month, and the
// rate against accounts live by then (so a growing book doesn't inflate the curve).
export type TrendMonth = {
  month: string; // "2026-10"
  label: string; // "Oct"
  active: number; // accounts in inventory by end of month (denominator)
  restrictions: number; // restriction events that month
  rate: number; // restrictions / active
  recovDenom: number; // episodes that month old enough to judge 30-day recovery
  recoveredWithin30: number;
  recoveryRate: number | null;
  partial: boolean; // the current (incomplete) month
};

// One cohort row of "restricted within N days of joining inventory", censored so each cell
// only counts accounts old enough to have reached that window.
export type CohortWindowRow = {
  bucket: string; // "H1 2026" or "Mar 2026"
  isHalf: boolean; // half-year summary row (bold) vs month row
  total: number;
  cells: { days: number; eligible: number; restricted: number; rate: number | null }[];
};

export type RestrictionTrend = {
  monthly: TrendMonth[];
  // First-month restriction rate, among accounts old enough (30d+), overall + by half-year.
  firstMonth: { bucket: string; total: number; restricted: number; rate: number }[];
  cohortWindows: CohortWindowRow[];
  // Retrieval: of restriction episodes old enough, what share recovered within the window.
  retrieval: { window: number; eligible: number; recovered: number; rate: number | null }[];
};

export type RestrictionAnalytics = {
  generatedAt: string;
  trend: RestrictionTrend;
  totals: {
    accounts: number;
    everRestricted: number;
    everRestrictedRate: number;
    open: number; // currently restricted
    recovered: number;
    recoveryRate: number | null; // recovered / everRestricted
    repeatRestricted: number; // restricted 2+ times
    loggedEvents: number; // total events in all logs
    avgDaysToRecover: number | null;
    medianDaysToRecover: number | null;
    avgOpenDays: number | null; // avg downtime of currently-open restrictions
  };
  cohorts: {
    verified: CohortRow[];
    lifecycle: CohortRow[];
    proxy: CohortRow[];
    proxyGeo: CohortRow[];
    age: CohortRow[];
    connections: CohortRow[];
    emailDomain: CohortRow[];
    client: CohortRow[]; // restriction rate by renter (only rented accounts)
    proxyHost: CohortRow[]; // restriction rate by specific proxy IP/host (shared hosts, 2+ accounts)
  };
  // WHY accounts got restricted, from LinkedIn's own words in captured security mail.
  reasonBreakdown: Array<{ cause: string; restricted: number; open: number; recovered: number }>;
  timing: CohortRow[]; // restriction timing relative to onboarding (denominator = ever-restricted)
  stageAtRestriction: StageEventRow[]; // HISTORICAL: which stage each restriction happened at
  openRestrictions: OpenRestrictionRow[]; // currently-restricted roster, longest-down first
  feed: FeedItem[];
};

const DAY = 86400000;

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function parseLog(raw: unknown): RestrictionEvent[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RestrictionEvent[])
    .filter((e) => e && (e.event === "restricted" || e.event === "recovered") && typeof e.at === "string")
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at));
}

// Per-account restriction facts derived from the log + the current open flag.
type AcctFacts = {
  everRestricted: boolean;
  open: boolean; // currently restricted
  recovered: boolean; // was restricted, now clear
  restrictCount: number;
  firstRestrictedAt: Date | null;
  completedDowntimeDays: number[]; // one per restrict→recover pair
  openDays: number | null; // downtime of the current open restriction
  openSince: Date | null; // when the current open restriction started
  openNote?: string; // note on the opening restricted event
};

function acctFacts(a: AnalyticsAccount, now: number): AcctFacts {
  const events = parseLog(a.restrictionLog);
  const openNow = !!toDate(a.restrictedAt);
  const restrictEvents = events.filter((e) => e.event === "restricted");

  // Pair restricted→recovered in order to measure downtime of completed cycles.
  const completed: number[] = [];
  let openSince: Date | null = null;
  let openNote: string | undefined;
  for (const e of events) {
    const d = toDate(e.at);
    if (!d) continue;
    if (e.event === "restricted") {
      if (!openSince) { openSince = d; openNote = e.note; }
    } else if (e.event === "recovered" && openSince) {
      completed.push(Math.max(0, d.getTime() - openSince.getTime()) / DAY);
      openSince = null;
      openNote = undefined;
    }
  }

  // everRestricted: the log has restrict events, OR it's flagged restricted now even if the
  // log predates logging (older open restrictions have restrictedAt but maybe no event).
  const everRestricted = restrictEvents.length > 0 || openNow;
  const firstRestrictedAt = restrictEvents[0] ? toDate(restrictEvents[0].at) : toDate(a.restrictedAt);

  let openDays: number | null = null;
  // The open restriction's start: the unmatched "restricted" event if the log has one,
  // else the restrictedAt flag (older restrictions that predate event logging).
  const openSinceDate = openNow ? openSince || toDate(a.restrictedAt) : null;
  if (openSinceDate) openDays = Math.max(0, now - openSinceDate.getTime()) / DAY;

  const restrictCount = Math.max(restrictEvents.length, openNow ? 1 : 0);

  return {
    everRestricted,
    open: openNow,
    recovered: everRestricted && !openNow,
    restrictCount,
    firstRestrictedAt,
    completedDowntimeDays: completed,
    openDays,
    openSince: openSinceDate,
    openNote: openNow ? openNote : undefined,
  };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Build a cohort table: for each bucket, how many accounts and what share were restricted /
// recovered. keyFn returns the bucket label, or null to drop the account from this cohort.
function cohort(
  accounts: { a: AnalyticsAccount; f: AcctFacts }[],
  keyFn: (a: AnalyticsAccount, f: AcctFacts) => string | null,
  order?: string[],
): CohortRow[] {
  const map = new Map<string, { total: number; restricted: number; recovered: number; open: number }>();
  for (const { a, f } of accounts) {
    const k = keyFn(a, f);
    if (k == null) continue;
    const row = map.get(k) || { total: 0, restricted: 0, recovered: 0, open: 0 };
    row.total += 1;
    if (f.everRestricted) row.restricted += 1;
    if (f.recovered) row.recovered += 1;
    if (f.open) row.open += 1;
    map.set(k, row);
  }
  let rows = Array.from(map.entries()).map(([bucket, r]) => ({
    bucket,
    total: r.total,
    restricted: r.restricted,
    restrictionRate: r.total ? r.restricted / r.total : 0,
    recovered: r.recovered,
    open: r.open,
    recoveryRate: r.restricted ? r.recovered / r.restricted : null,
  }));
  if (order) {
    rows = rows.sort((a, b) => {
      const ia = order.indexOf(a.bucket);
      const ib = order.indexOf(b.bucket);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return b.total - a.total;
    });
  } else {
    rows = rows.sort((a, b) => b.restricted - a.restricted || b.total - a.total);
  }
  return rows;
}

const domainOf = (email: string | null): string | null => {
  if (!email) return null;
  const at = email.indexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase().trim() || null;
};

// A rough country/region token out of the free-text proxyLocation ("US", "United States ·
// New York", "PH - proxy-cheap"). We take the leading segment before a separator.
const geoOf = (loc: string | null): string | null => {
  if (!loc) return null;
  const first = loc.split(/[·|,\-/]/)[0].trim();
  return first || null;
};

const ageBucket = (m: number | null): string => {
  if (m == null) return "Unknown";
  if (m < 3) return "< 3 mo";
  if (m < 6) return "3–6 mo";
  if (m < 12) return "6–12 mo";
  if (m < 24) return "1–2 yr";
  return "2 yr+";
};
const AGE_ORDER = ["< 3 mo", "3–6 mo", "6–12 mo", "1–2 yr", "2 yr+", "Unknown"];

const connBucket = (c: number): string => {
  if (c < 100) return "0–99";
  if (c < 300) return "100–299";
  if (c < 500) return "300–499";
  if (c < 1000) return "500–999";
  if (c < 5000) return "1,000–4,999";
  return "5,000+";
};
const CONN_ORDER = ["0–99", "100–299", "300–499", "500–999", "1,000–4,999", "5,000+"];

// Classify WHY an account was restricted, from LinkedIn's own words in its captured security
// mail (appeal replies, ID-verification notices, restriction emails). Priority: the specific
// behavioural signal ("excessive/systematic viewing") over the generic "doesn't comply", since
// that's the actionable root cause.
export function classifyRestrictionCause(text: string): string {
  const t = (text || "").toLowerCase();
  if (/excessively high number of|systematically view|systematic\w* (viewing|form)|third[- ]party (software|app|tool|application)|browser (plugin|extension)|\bscrap|\bautomat|\bbots?\b/.test(t)) return "Automation / excessive activity";
  if (/more than one account|multiple accounts|duplicate account/.test(t)) return "Duplicate account";
  if (/verify your identity|identity (check|verification)|government id|\bpersona\b|two[- ]?step|verification code|confirm it.?s you|new device|unusual (sign|activity)|please verify/.test(t)) return "Identity / verification";
  if (/does ?n.?t (comply|meet)|not comply|professional community|user agreement|violat|misuse/.test(t)) return "Policy violation (generic)";
  return "Other LinkedIn notice";
}

export function computeRestrictionAnalytics(
  accountsIn: AnalyticsAccount[],
  appsIn: AnalyticsApp[],
  // Earliest rental start per account id (ISO or Date) — the date the account first went
  // out on rent, used to attribute a restriction to the "Rented" stage historically.
  rentalStartById: Record<string, string | Date> = {},
  // Every distinct client (renter) that has rented each account — for the by-client
  // restriction rate. An account rented by two clients counts under both.
  clientsByAccountId: Record<string, string[]> = {},
  // Pre-classified restriction cause per account id (from captured LinkedIn security mail).
  reasonByAccountId: Record<string, string> = {},
  now: number = Date.now(),
): RestrictionAnalytics {
  // Match an account to its application the same way the rest of admin does: by unique
  // LinkedIn URL first, then a unique "Owner: <email>" line in the account notes.
  const normUrl = (u?: string | null) => (u || "").split("?")[0].replace(/\/+$/, "").toLowerCase().trim();
  const appByUrl = new Map<string, AnalyticsApp>();
  for (const app of appsIn) {
    const u = normUrl(app.linkedinUrl);
    if (u && !appByUrl.has(u)) appByUrl.set(u, app);
  }
  const appByEmail = new Map<string, AnalyticsApp>();
  const emailCount = new Map<string, number>();
  for (const app of appsIn) {
    const e = app.email.toLowerCase();
    emailCount.set(e, (emailCount.get(e) || 0) + 1);
    if (!appByEmail.has(e)) appByEmail.set(e, app);
  }
  const appFor = (a: AnalyticsAccount): AnalyticsApp | null => {
    const u = normUrl(a.linkedinUrl);
    if (u && appByUrl.has(u)) return appByUrl.get(u)!;
    const owner = (a.notes || "").match(/Owner:\s*(\S+@\S+)/)?.[1]?.replace(/\.$/, "")?.toLowerCase();
    if (owner && emailCount.get(owner) === 1) return appByEmail.get(owner) || null;
    return null;
  };

  const accounts = accountsIn.map((a) => ({ a, f: acctFacts(a, now) }));

  // Totals.
  let everRestricted = 0, open = 0, recovered = 0, repeat = 0, loggedEvents = 0;
  const downtimes: number[] = [];
  const openDaysArr: number[] = [];
  for (const { a, f } of accounts) {
    if (f.everRestricted) everRestricted += 1;
    if (f.open) open += 1;
    if (f.recovered) recovered += 1;
    if (f.restrictCount >= 2) repeat += 1;
    downtimes.push(...f.completedDowntimeDays);
    if (f.openDays != null) openDaysArr.push(f.openDays);
    loggedEvents += parseLog(a.restrictionLog).length;
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  // Lifecycle stage cohort — the pipeline's onboarding ladder (L1→L5) plus a Rented
  // split, so restriction rate is visible at each stage: before onboarding, while
  // warming up / logging in, in the QC-maturation hold, live, and once actually rented.
  // Mirrors levelOf() in admin/pipeline/page.tsx, from whichever signal is present
  // (account status first since restricted accounts keep their real status, then the
  // application milestone timestamps). Rented accounts stay in "Rented" even when their
  // real lifecycle is further along — that's the split we want to see.
  const lifecycle = cohort(
    accounts,
    (a) => {
      const app = appFor(a);
      if (a.status === "rented") return "Rented";
      if (a.status === "available" || a.status === "trial" || app?.status === "onboarded") return "Onboarded · live (L5)";
      if (a.linkedinVerified || toDate(app?.verifiedAt ?? null)) return "Maturing (L4)";
      if (toDate(app?.onboardedAt ?? null) || a.loginEmail || app?.status === "approved") return "Logged in · QC (L3)";
      if (toDate(app?.emailPrimaryAt ?? null)) return "Email & 2FA (L2)";
      return "Pre-onboarding (L1)";
    },
    ["Pre-onboarding (L1)", "Email & 2FA (L2)", "Logged in · QC (L3)", "Maturing (L4)", "Onboarded · live (L5)", "Rented"],
  );

  // Restriction timing relative to onboarding — denominator is ever-restricted accounts only.
  const restrictedAccounts = accounts.filter(({ f }) => f.everRestricted);
  const timing = cohort(
    restrictedAccounts,
    (a, f) => {
      const app = appFor(a);
      const onb = toDate(app?.onboardedAt ?? null);
      const when = f.firstRestrictedAt;
      if (!onb || !when) return "No onboarding date";
      const d = (when.getTime() - onb.getTime()) / DAY;
      if (d < 0) return "Before onboarding";
      if (d < 7) return "0–7 days after";
      if (d < 30) return "7–30 days after";
      return "30+ days after";
    },
    ["Before onboarding", "0–7 days after", "7–30 days after", "30+ days after", "No onboarding date"],
  );

  // HISTORICAL stage-at-restriction: attribute every restriction EVENT to the stage the
  // account was in WHEN it happened — compare the event date to the account's milestone
  // dates (email-primary → logged in → verified → setup paid/live → first rented). An
  // account restricted right after login counts as "Logged in" even if it's rented now.
  const LADDER = ["Pre-onboarding (L1)", "Email & 2FA (L2)", "Logged in · QC (L3)", "Maturing (L4)", "Onboarded · live (L5)", "Rented", "Undatable"];
  const ms = (v: Date | string | null | undefined): number | null => {
    const d = toDate(v ?? null);
    return d ? d.getTime() : null;
  };
  type Milestones = { l2: number | null; l3: number | null; l4: number | null; l5: number | null; rented: number | null };
  const stageAt = (t: number, m: Milestones): string => {
    if (m.rented != null && t >= m.rented) return "Rented";
    if (m.l5 != null && t >= m.l5) return "Onboarded · live (L5)";
    if (m.l4 != null && t >= m.l4) return "Maturing (L4)";
    if (m.l3 != null && t >= m.l3) return "Logged in · QC (L3)";
    if (m.l2 != null && t >= m.l2) return "Email & 2FA (L2)";
    // Before the earliest known milestone, but we DO know some milestone → pre-onboarding.
    if (m.l2 != null || m.l3 != null || m.l4 != null || m.l5 != null || m.rented != null) return "Pre-onboarding (L1)";
    return "Undatable"; // no milestone dates at all (e.g. inventory-only account) — can't place it
  };
  // The restriction events for an account, each flagged closed (a recovery followed) or
  // still open. Falls back to a single synthetic open event at restrictedAt when the log
  // predates event logging.
  const restrictEventsOf = (a: AnalyticsAccount): { at: Date; closed: boolean }[] => {
    const events = parseLog(a.restrictionLog);
    const out: { at: Date; closed: boolean }[] = [];
    let openIdx = -1;
    for (const e of events) {
      const d = toDate(e.at);
      if (!d) continue;
      if (e.event === "restricted") {
        if (openIdx === -1) { out.push({ at: d, closed: false }); openIdx = out.length - 1; }
      } else if (e.event === "recovered" && openIdx !== -1) {
        out[openIdx].closed = true; openIdx = -1;
      }
    }
    if (out.length === 0 && toDate(a.restrictedAt)) out.push({ at: toDate(a.restrictedAt)!, closed: false });
    return out;
  };
  const stageAgg = new Map<string, { events: number; recovered: number }>();
  let stageTotal = 0;
  for (const { a } of accounts) {
    const app = appFor(a);
    const m: Milestones = {
      l2: ms(app?.emailPrimaryAt),
      l3: ms(app?.onboardedAt),
      l4: ms(app?.verifiedAt),
      l5: ms(app?.paidAt),
      rented: ms(rentalStartById[a.id]),
    };
    for (const ev of restrictEventsOf(a)) {
      const s = stageAt(ev.at.getTime(), m);
      const row = stageAgg.get(s) || { events: 0, recovered: 0 };
      row.events += 1;
      if (ev.closed) row.recovered += 1;
      stageAgg.set(s, row);
      stageTotal += 1;
    }
  }
  const stageAtRestriction: StageEventRow[] = LADDER
    .map((stage) => {
      const r = stageAgg.get(stage) || { events: 0, recovered: 0 };
      return {
        stage,
        events: r.events,
        share: stageTotal ? r.events / stageTotal : 0,
        recovered: r.recovered,
        open: r.events - r.recovered,
        recoveryRate: r.events ? r.recovered / r.events : null,
      };
    })
    .filter((r) => r.events > 0);

  // Live roster of currently-restricted accounts — who's down and for how long. Each gets
  // the stage it was in WHEN the restriction hit (same historical attribution as above),
  // sorted longest-down first so the most urgent recoveries surface at the top.
  const openRestrictions: OpenRestrictionRow[] = accounts
    .filter(({ f }) => f.open)
    .map(({ a, f }) => {
      const app = appFor(a);
      const m: Milestones = {
        l2: ms(app?.emailPrimaryAt),
        l3: ms(app?.onboardedAt),
        l4: ms(app?.verifiedAt),
        l5: ms(app?.paidAt),
        rented: ms(rentalStartById[a.id]),
      };
      const stage = f.openSince ? stageAt(f.openSince.getTime(), m) : "Undatable";
      return {
        account: a.linkedinName,
        url: a.linkedinUrl,
        since: f.openSince ? f.openSince.toISOString() : null,
        days: f.openDays != null ? Math.round(f.openDays) : null,
        verified: a.linkedinVerified,
        status: a.status,
        stage,
        clients: clientsByAccountId[a.id] || [],
        ...(f.openNote ? { note: f.openNote } : {}),
      };
    })
    .sort((x, y) => (y.days ?? -1) - (x.days ?? -1) || x.account.localeCompare(y.account));

  // By-client (renter) restriction rate. Unlike the single-key cohorts, an account rented
  // by several clients counts under each of them, so we aggregate directly instead of via
  // cohort(). Single-account clients with no restriction are folded into one tail row to
  // keep the table focused on where the risk is.
  type ClientAgg = { total: number; restricted: number; recovered: number; open: number };
  const clientAgg = new Map<string, ClientAgg>();
  for (const { a, f } of accounts) {
    const seen = new Set<string>();
    for (const label of clientsByAccountId[a.id] || []) {
      const name = (label || "").trim();
      if (!name || seen.has(name)) continue; // guard dup labels on one account
      seen.add(name);
      const row = clientAgg.get(name) || { total: 0, restricted: 0, recovered: 0, open: 0 };
      row.total += 1;
      if (f.everRestricted) row.restricted += 1;
      if (f.recovered) row.recovered += 1;
      if (f.open) row.open += 1;
      clientAgg.set(name, row);
    }
  }
  const clientRowsAll = Array.from(clientAgg.entries()).map(([bucket, r]) => ({ bucket, ...r }));
  const tail = clientRowsAll.filter((r) => r.total === 1 && r.restricted === 0);
  const kept = clientRowsAll.filter((r) => !(r.total === 1 && r.restricted === 0));
  const toRow = (bucket: string, r: ClientAgg): CohortRow => ({
    bucket,
    total: r.total,
    restricted: r.restricted,
    restrictionRate: r.total ? r.restricted / r.total : 0,
    recovered: r.recovered,
    open: r.open,
    recoveryRate: r.restricted ? r.recovered / r.restricted : null,
  });
  const client: CohortRow[] = kept
    .map((r) => toRow(r.bucket, r))
    .sort((x, y) => y.restricted - x.restricted || y.total - x.total);
  if (tail.length) {
    const agg = tail.reduce((s, r) => ({ total: s.total + r.total, restricted: 0, recovered: s.recovered + r.recovered, open: 0 }), { total: 0, restricted: 0, recovered: 0, open: 0 });
    client.push(toRow(`${tail.length} single-account clients · no restrictions`, agg));
  }

  // Email domain cohort — group tiny domains together to keep the table readable.
  const rawDomain = cohort(accounts, (a) => domainOf(a.loginEmail) || domainOf(a.workEmail));
  const bigDomains = new Set(rawDomain.filter((r) => r.total >= 3).map((r) => r.bucket));
  const emailDomain = cohort(accounts, (a) => {
    const d = domainOf(a.loginEmail) || domainOf(a.workEmail);
    if (!d) return "No login email";
    return bigDomains.has(d) ? d : "Other domains";
  });

  const feed: FeedItem[] = [];
  for (const { a } of accounts) {
    for (const e of parseLog(a.restrictionLog)) {
      feed.push({ at: e.at, event: e.event, account: a.linkedinName, ...(e.note ? { note: e.note } : {}), ...(e.creditedDays ? { creditedDays: e.creditedDays } : {}) });
    }
  }
  feed.sort((x, y) => y.at.localeCompare(x.at));

  // ----- Time trend (anchored on createdAt) -----
  // Every restriction episode (a restricted→recovered pair, or an open restriction), with its
  // start date and how long recovery took — paired sequentially so one recovery closes one
  // restriction. Falls back to the restrictedAt flag when the log predates event logging.
  type Episode = { restrictedAt: Date; recovDays: number | null };
  const episodesOf = (a: AnalyticsAccount): Episode[] => {
    const eps: Episode[] = [];
    let openAt: Date | null = null;
    for (const e of parseLog(a.restrictionLog)) {
      const d = toDate(e.at);
      if (!d) continue;
      if (e.event === "restricted") { if (!openAt) openAt = d; }
      else if (e.event === "recovered" && openAt) { eps.push({ restrictedAt: openAt, recovDays: (d.getTime() - openAt.getTime()) / DAY }); openAt = null; }
    }
    if (openAt) eps.push({ restrictedAt: openAt, recovDays: null });
    const flag = toDate(a.restrictedAt);
    if (eps.length === 0 && flag) eps.push({ restrictedAt: flag, recovDays: null });
    return eps;
  };
  const allEps = accounts.flatMap(({ a }) => episodesOf(a));
  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthLabel = (k: string) => { const [y, m] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }); };
  const halfBucket = (d: Date) => `${d.getUTCFullYear()} ${d.getUTCMonth() < 6 ? "H1" : "H2"}`;
  const nowD = new Date(now);
  const nowMonth = monthKey(nowD);

  // Month axis from the earliest account to now.
  const createdDates = accountsIn.map((a) => toDate(a.createdAt)).filter((d): d is Date => !!d);
  const minCreated = createdDates.length ? new Date(Math.min(...createdDates.map((d) => d.getTime()))) : nowD;
  const months: string[] = [];
  for (let cur = new Date(Date.UTC(minCreated.getUTCFullYear(), minCreated.getUTCMonth(), 1)); cur <= nowD; cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1))) months.push(monthKey(cur));

  const monthAgg = new Map<string, { restrictions: number; recovDenom: number; rec30: number }>();
  for (const ep of allEps) {
    const k = monthKey(ep.restrictedAt);
    const row = monthAgg.get(k) || { restrictions: 0, recovDenom: 0, rec30: 0 };
    row.restrictions += 1;
    if ((now - ep.restrictedAt.getTime()) / DAY >= 30) { row.recovDenom += 1; if (ep.recovDays != null && ep.recovDays <= 30) row.rec30 += 1; }
    monthAgg.set(k, row);
  }
  const monthly: TrendMonth[] = months.map((k) => {
    const [y, m] = k.split("-").map(Number);
    const endOfMonth = Date.UTC(y, m, 0, 23, 59, 59); // day 0 of next month = last day of this one
    const active = accountsIn.filter((a) => { const c = toDate(a.createdAt); return c && c.getTime() <= endOfMonth; }).length;
    const r = monthAgg.get(k) || { restrictions: 0, recovDenom: 0, rec30: 0 };
    return { month: k, label: monthLabel(k), active, restrictions: r.restrictions, rate: active ? r.restrictions / active : 0, recovDenom: r.recovDenom, recoveredWithin30: r.rec30, recoveryRate: r.recovDenom ? r.rec30 / r.recovDenom : null, partial: k === nowMonth };
  });

  // First-month rate + cohort windows, keyed on createdAt. firstRestrictedAt comes from facts.
  const firstGapDays = (a: AnalyticsAccount, f: AcctFacts): number | null => {
    const c = toDate(a.createdAt);
    if (!c || !f.firstRestrictedAt) return null;
    return (f.firstRestrictedAt.getTime() - c.getTime()) / DAY;
  };
  const WINDOWS = [30, 60, 90, 180];
  const firstMonthAgg = new Map<string, { total: number; restricted: number }>();
  const cwAgg = new Map<string, { isHalf: boolean; order: number; total: number; cells: Map<number, { eligible: number; restricted: number }> }>();
  for (const { a, f } of accounts) {
    const c = toDate(a.createdAt);
    if (!c) continue;
    const ageD = (now - c.getTime()) / DAY;
    const gap = firstGapDays(a, f);
    const half = halfBucket(c);
    // First-month rate (only accounts old enough to have had a full first month).
    for (const key of ["All accounts", half]) {
      if (ageD < 30) continue;
      const g = firstMonthAgg.get(key) || { total: 0, restricted: 0 };
      g.total += 1;
      if (gap != null && gap <= 30 && gap >= -1) g.restricted += 1;
      firstMonthAgg.set(key, g);
    }
    // Cohort windows (half-year summary row + month row).
    for (const [key, isHalf, order] of [[half, true, Date.UTC(c.getUTCFullYear(), c.getUTCMonth() < 6 ? 0 : 6, 1)], [monthKey(c), false, Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), 1)]] as [string, boolean, number][]) {
      const row = cwAgg.get(key) || { isHalf, order, total: 0, cells: new Map() };
      row.total += 1;
      for (const w of WINDOWS) {
        const cell = row.cells.get(w) || { eligible: 0, restricted: 0 };
        if (ageD >= w) { cell.eligible += 1; if (gap != null && gap <= w && gap >= -1) cell.restricted += 1; }
        row.cells.set(w, cell);
      }
      cwAgg.set(key, row);
    }
  }
  const firstMonthOrder = ["All accounts"];
  const firstMonth = Array.from(firstMonthAgg.entries())
    .map(([bucket, g]) => ({ bucket, total: g.total, restricted: g.restricted, rate: g.total ? g.restricted / g.total : 0 }))
    .sort((x, y) => { const ix = firstMonthOrder.indexOf(x.bucket), iy = firstMonthOrder.indexOf(y.bucket); if (ix !== -1 || iy !== -1) return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy); return x.bucket.localeCompare(y.bucket); });
  const cohortWindows: CohortWindowRow[] = Array.from(cwAgg.entries())
    .map(([bucket, r]) => ({ bucket: r.isHalf ? `${bucket.slice(5)} ${bucket.slice(0, 4)}` : `${monthLabel(bucket)} ${bucket.slice(0, 4)}`, isHalf: r.isHalf, order: r.order, total: r.total, cells: WINDOWS.map((w) => { const c = r.cells.get(w) || { eligible: 0, restricted: 0 }; return { days: w, eligible: c.eligible, restricted: c.restricted, rate: c.eligible ? c.restricted / c.eligible : null }; }) }))
    .sort((x, y) => x.order - y.order || (x.isHalf === y.isHalf ? 0 : x.isHalf ? -1 : 1))
    .map(({ order: _order, ...row }) => row);

  const retrieval = [30, 180].map((w) => {
    const elig = allEps.filter((ep) => (now - ep.restrictedAt.getTime()) / DAY >= w);
    const rec = elig.filter((ep) => ep.recovDays != null && ep.recovDays <= w).length;
    return { window: w, eligible: elig.length, recovered: rec, rate: elig.length ? rec / elig.length : null };
  });

  const trend: RestrictionTrend = { monthly, firstMonth, cohortWindows, retrieval };

  // WHY they got restricted — group ever-restricted accounts by the cause classified from their
  // captured LinkedIn security mail; accounts with no such email (phone/ID checkpoints) fall into
  // an "unknown" bucket, which is itself a signal.
  const reasonAgg = new Map<string, { restricted: number; open: number; recovered: number }>();
  for (const { a, f } of accounts) {
    if (!f.everRestricted) continue;
    const cause = reasonByAccountId[a.id] || "Unknown · no LinkedIn email (phone/ID checkpoint)";
    const row = reasonAgg.get(cause) || { restricted: 0, open: 0, recovered: 0 };
    row.restricted += 1;
    if (f.open) row.open += 1;
    if (f.recovered) row.recovered += 1;
    reasonAgg.set(cause, row);
  }
  const reasonBreakdown = Array.from(reasonAgg.entries()).map(([cause, r]) => ({ cause, ...r })).sort((x, y) => y.restricted - x.restricted);

  // By specific proxy IP/host — surfaces shared or datacenter IPs under several accounts, a major
  // restriction driver (one bad IP can take down everything on it). Shared hosts only (2+ accounts).
  const proxyHost = cohort(accounts, (a) => a.proxyHost || null)
    .filter((r) => r.total >= 2)
    .sort((x, y) => y.restricted - x.restricted || y.restrictionRate - x.restrictionRate)
    .slice(0, 15);

  return {
    generatedAt: new Date(now).toISOString(),
    trend,
    totals: {
      accounts: accounts.length,
      everRestricted,
      everRestrictedRate: accounts.length ? everRestricted / accounts.length : 0,
      open,
      recovered,
      recoveryRate: everRestricted ? recovered / everRestricted : null,
      repeatRestricted: repeat,
      loggedEvents,
      avgDaysToRecover: avg(downtimes),
      medianDaysToRecover: median(downtimes),
      avgOpenDays: avg(openDaysArr),
    },
    cohorts: {
      verified: cohort(accounts, (a) => (a.linkedinVerified ? "Verified" : "Unverified"), ["Verified", "Unverified"]),
      lifecycle,
      proxy: cohort(accounts, (a) => (a.proxyHost ? "Has proxy" : "No proxy"), ["Has proxy", "No proxy"]),
      proxyGeo: cohort(accounts, (a) => (a.proxyHost ? geoOf(a.proxyLocation) || "Proxy · geo unknown" : null)),
      age: cohort(accounts, (a) => ageBucket(a.accountAgeMonths), AGE_ORDER),
      connections: cohort(accounts, (a) => connBucket(a.connectionCount), CONN_ORDER),
      emailDomain,
      client,
      proxyHost,
    },
    reasonBreakdown,
    timing,
    stageAtRestriction,
    openRestrictions,
    feed: feed.slice(0, 60),
  };
}
