"use client";

import { useEffect, useMemo, useState } from "react";

const F_SANS = "var(--font-sans),system-ui,sans-serif";
const F_GRO = "var(--font-grotesk),system-ui,sans-serif";

type CohortRow = {
  bucket: string;
  total: number;
  restricted: number;
  restrictionRate: number;
  recovered: number;
  open: number;
  recoveryRate: number | null;
};
type StageEventRow = { stage: string; events: number; share: number; recovered: number; open: number; recoveryRate: number | null };
type OpenRestrictionRow = { account: string; url: string | null; since: string | null; days: number | null; verified: boolean; status: string; stage: string; clients: string[]; note?: string };
type FeedItem = { at: string; event: "restricted" | "recovered"; account: string; note?: string; creditedDays?: number };
type Analytics = {
  generatedAt: string;
  totals: {
    accounts: number; everRestricted: number; everRestrictedRate: number; open: number;
    recovered: number; recoveryRate: number | null; repeatRestricted: number; loggedEvents: number;
    avgDaysToRecover: number | null; medianDaysToRecover: number | null; avgOpenDays: number | null;
  };
  cohorts: {
    verified: CohortRow[]; lifecycle: CohortRow[]; proxy: CohortRow[]; proxyGeo: CohortRow[];
    age: CohortRow[]; connections: CohortRow[]; emailDomain: CohortRow[]; client: CohortRow[];
    proxyHost: CohortRow[];
  };
  reasonBreakdown: { cause: string; restricted: number; open: number; recovered: number }[];
  timing: CohortRow[];
  stageAtRestriction: StageEventRow[];
  openRestrictions: OpenRestrictionRow[];
  feed: FeedItem[];
};

const pct = (x: number | null | undefined, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const num = (x: number | null | undefined, d = 1) => (x == null ? "—" : x.toFixed(d));
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 16, boxShadow: "var(--card-shadow)", padding: "18px 20px", ...style }}>
      {children}
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" | "green" | "warn" }) {
  const valColor = tone === "danger" ? "var(--danger)" : tone === "green" ? "var(--green)" : tone === "warn" ? "var(--warn-num)" : "var(--text)";
  const warn = tone === "warn";
  return (
    <div style={{ background: warn ? "var(--warn-bg)" : "var(--card)", border: "1px solid", borderColor: warn ? "var(--warn-border)" : "var(--card-border)", borderRadius: 13, padding: 14, minHeight: 108, boxShadow: "var(--card-shadow)", display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ font: `600 11.5px ${F_SANS}`, color: "var(--muted)", letterSpacing: 0.2 }}>{label}</span>
      <span style={{ font: `700 27px ${F_GRO}`, color: valColor, lineHeight: 1 }}>{value}</span>
      {sub && <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted)", marginTop: "auto" }}>{sub}</span>}
    </div>
  );
}

// A cohort table: one row per bucket, with an inline meter for the restriction rate and a
// recovery-rate column. maxRate scales the meters so the worst cohort fills the bar.
function CohortTable({ title, hint, rows, denomLabel = "accounts" }: { title: string; hint?: string; rows: CohortRow[]; denomLabel?: string }) {
  const maxRate = Math.max(0.0001, ...rows.map((r) => r.restrictionRate));
  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
        <h3 style={{ font: `700 14px ${F_GRO}`, color: "var(--text)", margin: 0 }}>{title}</h3>
      </div>
      {hint && <p style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted)", margin: "0 0 10px" }}>{hint}</p>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", font: `500 12.5px ${F_SANS}` }}>
          <thead>
            <tr style={{ color: "var(--muted)", textAlign: "left", font: `600 11px ${F_SANS}` }}>
              <th style={{ padding: "6px 8px 6px 0", fontWeight: 600 }}>Cohort</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>{denomLabel}</th>
              <th style={{ padding: "6px 8px", minWidth: 150 }}>Restriction rate</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Restricted</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Recovered</th>
              <th style={{ padding: "6px 0 6px 8px", textAlign: "right" }}>Recovery</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "12px 0", color: "var(--muted)" }}>No data.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.bucket} style={{ borderTop: "1px solid var(--divider)" }}>
                <td style={{ padding: "9px 8px 9px 0", color: "var(--text)", fontWeight: 600 }}>{r.bucket}</td>
                <td style={{ padding: "9px 8px", textAlign: "right", color: "var(--muted)" }}>{r.total.toLocaleString()}</td>
                <td style={{ padding: "9px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 7, borderRadius: 999, background: "var(--track)", overflow: "hidden", minWidth: 60 }}>
                      <div style={{ width: `${(r.restrictionRate / maxRate) * 100}%`, height: "100%", background: r.restrictionRate > 0 ? "var(--danger)" : "var(--track)", borderRadius: 999 }} />
                    </div>
                    <span style={{ font: `600 12px ${F_GRO}`, color: r.restrictionRate > 0 ? "var(--danger)" : "var(--muted)", width: 42, textAlign: "right" }}>{pct(r.restrictionRate, 1)}</span>
                  </div>
                </td>
                <td style={{ padding: "9px 8px", textAlign: "right", color: "var(--text)" }}>
                  {r.restricted}{r.open > 0 && <span style={{ color: "var(--warn-num)" }}> · {r.open} open</span>}
                </td>
                <td style={{ padding: "9px 8px", textAlign: "right", color: "var(--green)", fontWeight: 600 }}>{r.recovered || "—"}</td>
                <td style={{ padding: "9px 0 9px 8px", textAlign: "right", color: r.recoveryRate == null ? "var(--muted)" : "var(--green)", fontWeight: 600 }}>{pct(r.recoveryRate, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// HISTORICAL: how restriction EVENTS distribute across the lifecycle stage the account was
// in AT THE TIME each one happened (not its current stage). The bar shows each stage's
// share of all datable restrictions, so the spike shows where accounts actually get hit.
function StageEventTable({ rows }: { rows: StageEventRow[] }) {
  const maxShare = Math.max(0.0001, ...rows.map((r) => r.share));
  const totalEvents = rows.reduce((s, r) => s + r.events, 0);
  return (
    <Card style={{ padding: "16px 18px" }}>
      <h3 style={{ font: `700 14px ${F_GRO}`, color: "var(--text)", margin: 0 }}>Stage when the restriction happened</h3>
      <p style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted)", margin: "4px 0 10px" }}>
        Each logged restriction attributed to the stage the account was in when it hit — by its event date vs the account&apos;s milestone dates. {totalEvents.toLocaleString()} datable restriction{totalEvents === 1 ? "" : "s"}.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", font: `500 12.5px ${F_SANS}` }}>
          <thead>
            <tr style={{ color: "var(--muted)", textAlign: "left", font: `600 11px ${F_SANS}` }}>
              <th style={{ padding: "6px 8px 6px 0", fontWeight: 600 }}>Stage at restriction</th>
              <th style={{ padding: "6px 8px", minWidth: 150 }}>Share of restrictions</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Restrictions</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Recovered</th>
              <th style={{ padding: "6px 0 6px 8px", textAlign: "right" }}>Recovery</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ padding: "12px 0", color: "var(--muted)" }}>No datable restriction events yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.stage} style={{ borderTop: "1px solid var(--divider)" }}>
                <td style={{ padding: "9px 8px 9px 0", color: "var(--text)", fontWeight: 600 }}>{r.stage}</td>
                <td style={{ padding: "9px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 7, borderRadius: 999, background: "var(--track)", overflow: "hidden", minWidth: 60 }}>
                      <div style={{ width: `${(r.share / maxShare) * 100}%`, height: "100%", background: "var(--danger)", borderRadius: 999 }} />
                    </div>
                    <span style={{ font: `600 12px ${F_GRO}`, color: "var(--danger)", width: 42, textAlign: "right" }}>{pct(r.share, 0)}</span>
                  </div>
                </td>
                <td style={{ padding: "9px 8px", textAlign: "right", color: "var(--text)" }}>
                  {r.events}{r.open > 0 && <span style={{ color: "var(--warn-num)" }}> · {r.open} open</span>}
                </td>
                <td style={{ padding: "9px 8px", textAlign: "right", color: "var(--green)", fontWeight: 600 }}>{r.recovered || "—"}</td>
                <td style={{ padding: "9px 0 9px 8px", textAlign: "right", color: r.recoveryRate == null ? "var(--muted)" : "var(--green)", fontWeight: 600 }}>{pct(r.recoveryRate, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Live roster of currently-restricted accounts, longest-down first. The days-down chip
// warms from amber to red as downtime grows, so the stalest recoveries jump out.
function OpenRestrictionsTable({ rows }: { rows: OpenRestrictionRow[] }) {
  const daysTone = (d: number | null): { bg: string; fg: string } => {
    if (d == null) return { bg: "var(--track)", fg: "var(--muted)" };
    if (d >= 30) return { bg: "var(--danger-chip-bg, rgba(220,38,38,0.14))", fg: "var(--danger)" };
    if (d >= 14) return { bg: "var(--warn-badge-bg)", fg: "var(--warn-badge-text)" };
    return { bg: "var(--track)", fg: "var(--text)" };
  };
  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
        <h3 style={{ font: `700 14px ${F_GRO}`, color: "var(--text)", margin: 0 }}>Currently restricted — {rows.length}</h3>
      </div>
      <p style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted)", margin: "0 0 10px" }}>
        Every account open-restricted right now, longest-down first. Days count from when the restriction was logged (or the restricted-at flag for older ones).
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", font: `500 12.5px ${F_SANS}` }}>
          <thead>
            <tr style={{ color: "var(--muted)", textAlign: "left", font: `600 11px ${F_SANS}` }}>
              <th style={{ padding: "6px 8px 6px 0", fontWeight: 600 }}>Account</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Days down</th>
              <th style={{ padding: "6px 8px" }}>Since</th>
              <th style={{ padding: "6px 8px" }}>Stage when hit</th>
              <th style={{ padding: "6px 0 6px 8px" }}>Renter</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ padding: "12px 0", color: "var(--muted)" }}>Nothing currently restricted.</td></tr>
            )}
            {rows.map((r, i) => {
              const tone = daysTone(r.days);
              return (
                <tr key={`${r.account}-${i}`} style={{ borderTop: "1px solid var(--divider)" }}>
                  <td style={{ padding: "9px 8px 9px 0", color: "var(--text)", fontWeight: 600 }}>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)", textDecoration: "none" }}>{r.account}</a>
                    ) : r.account}
                    {r.verified && <span title="Verified" style={{ marginLeft: 6, font: `600 10px ${F_SANS}`, color: "var(--green)" }}>✓</span>}
                    {r.note && <div style={{ font: `500 11px ${F_SANS}`, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{r.note}</div>}
                  </td>
                  <td style={{ padding: "9px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ font: `700 12px ${F_GRO}`, padding: "3px 9px", borderRadius: 999, background: tone.bg, color: tone.fg }}>
                      {r.days == null ? "—" : `${r.days}d`}
                    </span>
                  </td>
                  <td style={{ padding: "9px 8px", color: "var(--muted)", whiteSpace: "nowrap" }}>{r.since ? fmtDate(r.since) : "—"}</td>
                  <td style={{ padding: "9px 8px", color: "var(--text)" }}>{r.stage}</td>
                  <td style={{ padding: "9px 0 9px 8px", color: r.clients.length ? "var(--text)" : "var(--muted)" }}>{r.clients.length ? r.clients.join(", ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function RestrictionsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/restrictions")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(String(e)));
  }, []);

  const t = data?.totals;
  const recoveryChip = useMemo(() => {
    if (!t) return "";
    return `${t.recovered} of ${t.everRestricted} restricted accounts back`;
  }, [t]);

  if (error) return <Card style={{ color: "var(--danger)" }}>Couldn&apos;t load restrictions: {error}</Card>;
  if (!data || !t) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 12 }}>
        {[1, 2, 3, 4, 5].map((i) => <div key={i} style={{ height: 108, borderRadius: 13, background: "var(--card)", border: "1px solid var(--card-border)" }} />)}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h1 style={{ font: `700 22px ${F_GRO}`, color: "var(--text)", margin: 0 }}>Restrictions</h1>
        <p style={{ font: `500 13px ${F_SANS}`, color: "var(--muted)", margin: "4px 0 0" }}>
          How many accounts get restricted, how many recover, and what they have in common. Excludes removed accounts.
        </p>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(178px,1fr))", gap: 12 }}>
        <StatTile label="Accounts tracked" value={t.accounts.toLocaleString()} sub="active inventory" />
        <StatTile label="Ever restricted" value={t.everRestricted.toLocaleString()} sub={pct(t.everRestrictedRate, 1) + " of accounts"} tone="danger" />
        <StatTile label="Currently restricted" value={t.open.toLocaleString()} sub={t.avgOpenDays != null ? `avg ${num(t.avgOpenDays, 0)}d down` : "in recovery"} tone="warn" />
        <StatTile label="Recovered" value={t.recovered.toLocaleString()} sub={recoveryChip} tone="green" />
        <StatTile label="Recovery rate" value={pct(t.recoveryRate, 0)} sub="recovered ÷ ever-restricted" tone="green" />
        <StatTile label="Avg days to recover" value={t.avgDaysToRecover != null ? num(t.avgDaysToRecover, 1) : "—"} sub={t.medianDaysToRecover != null ? `median ${num(t.medianDaysToRecover, 0)}d` : "completed cycles"} />
        <StatTile label="Repeat restrictions" value={t.repeatRestricted.toLocaleString()} sub="restricted 2+ times" tone={t.repeatRestricted ? "warn" : undefined} />
        <StatTile label="Events logged" value={t.loggedEvents.toLocaleString()} sub="restrict + recover" />
      </div>

      {/* Data caveat */}
      <div style={{ font: `500 12px ${F_SANS}`, color: "var(--muted)", background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "9px 13px" }}>
        Rates are exact from when event logging started. A restrict→recover that happened before then (flag already cleared, no log entry) isn&apos;t counted, so older history is undercounted. Every restriction/recovery from the pipeline or inventory now writes to the shared log.
      </div>

      {/* Why they got restricted — cause breakdown from captured LinkedIn mail */}
      {data.reasonBreakdown.length > 0 && (() => {
        const maxR = Math.max(...data.reasonBreakdown.map((r) => r.restricted), 1);
        const TONE: Record<string, string> = {
          "Automation / excessive activity": "var(--danger)",
          "Identity / verification": "#2563eb",
          "Policy violation (generic)": "var(--warn-num)",
          "Duplicate account": "#7c3aed",
        };
        return (
          <Card>
            <h3 style={{ font: `700 15px ${F_GRO}`, color: "var(--text)", margin: "0 0 4px" }}>Why they got restricted</h3>
            <p style={{ font: `500 12px ${F_SANS}`, color: "var(--muted)", margin: "0 0 14px" }}>Cause of each ever-restricted account, read from LinkedIn&apos;s own words in captured appeal / ID-verification mail. &ldquo;Unknown&rdquo; = no email on file (phone / Persona checkpoints don&apos;t email).</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {data.reasonBreakdown.map((r) => (
                <div key={r.cause} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, font: `600 12.5px ${F_SANS}`, color: "var(--text)" }}>
                    <span>{r.cause}</span>
                    <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}><b style={{ color: "var(--text)" }}>{r.restricted}</b> restricted · {r.open} still down · {r.recovered} recovered</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: "var(--card-border)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(r.restricted / maxR) * 100}%`, background: TONE[r.cause] || "var(--muted)", borderRadius: 999 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}

      {/* Currently-restricted roster */}
      <OpenRestrictionsTable rows={data.openRestrictions} />

      {/* Cohort grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 14, alignItems: "start" }}>
        <StageEventTable rows={data.stageAtRestriction} />
        <CohortTable title="Verified vs unverified" rows={data.cohorts.verified} />
        <CohortTable title="Current stage of accounts" hint="Where each account sits now (L1→L5, then Rented) and its ever-restricted rate — not when the restriction happened." rows={data.cohorts.lifecycle} />
        <CohortTable title="Proxy vs no proxy" rows={data.cohorts.proxy} />
        <CohortTable title="By proxy geo" hint="Leading region token from the proxy location field." rows={data.cohorts.proxyGeo} />
        <CohortTable title="Account age" rows={data.cohorts.age} />
        <CohortTable title="Connection count" rows={data.cohorts.connections} />
        <CohortTable title="By client (renter)" hint="Restriction rate of the accounts each renter holds; an account rented by several clients counts under each." rows={data.cohorts.client} denomLabel="rented" />
        <CohortTable title="By proxy IP (shared hosts)" hint="Specific proxy hosts carrying 2+ accounts, worst first — surfaces shared or datacenter IPs where one bad IP can take down everything on it." rows={data.cohorts.proxyHost} />
        <CohortTable title="Login email domain" hint="Domains with 3+ accounts; the rest grouped." rows={data.cohorts.emailDomain} />
        <CohortTable title="Restriction timing vs onboarding" hint="Among restricted accounts: when the first restriction hit relative to onboarding." rows={data.timing} denomLabel="restricted" />
      </div>

      {/* Recent events feed */}
      <Card style={{ padding: "16px 18px" }}>
        <h3 style={{ font: `700 14px ${F_GRO}`, color: "var(--text)", margin: "0 0 8px" }}>Recent restriction activity</h3>
        {data.feed.length === 0 ? (
          <p style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted)", margin: 0 }}>No logged events yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {data.feed.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i === 0 ? "none" : "1px solid var(--divider)" }}>
                <span style={{ font: `600 10.5px ${F_SANS}`, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", background: f.event === "restricted" ? "var(--warn-badge-bg)" : "var(--green-chip-bg)", color: f.event === "restricted" ? "var(--warn-badge-text)" : "var(--green-chip-text)" }}>
                  {f.event === "restricted" ? "Restricted" : "Recovered"}
                </span>
                <span style={{ font: `600 12.5px ${F_SANS}`, color: "var(--text)" }}>{f.account}</span>
                {f.note && <span style={{ font: `500 12px ${F_SANS}`, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.note}</span>}
                {f.creditedDays ? <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted)" }}>+{f.creditedDays}d credited</span> : null}
                <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted)", marginLeft: "auto", whiteSpace: "nowrap" }}>{fmtDate(f.at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p style={{ font: `500 11px ${F_SANS}`, color: "var(--muted)", margin: 0, textAlign: "right" }}>Generated {fmtDate(data.generatedAt)}</p>
    </div>
  );
}
