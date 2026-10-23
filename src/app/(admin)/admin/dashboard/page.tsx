"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDate, formatPeso } from "@/lib/utils";

interface Stats {
  netProfit: number; mrr: number; payouts: number; activeRentals: number;
  payoutsPhp?: number | null;
  collected: number; collectedCount: number;
  totalCustomers: number; newCustomers30d: number; renewalsDue30d: number;
  vettingStarted: number; vettingDropped: number; atRisk: number;
  totalAccounts: number; availableAccounts: number; rentedAccounts: number;
  offlineAccounts: number; restrictedAccounts: number; utilization: number; appsToReview: number;
  month: string; isCurrentMonth: boolean; hasMonthData: boolean; availableMonths: string[];
  mrrTrend?: number | null; netProfitTrend?: number | null; activeRentalsTrend?: number | null;
  customersTrend?: number | null; utilizationTrend?: number | null;
}
interface Activity { type: "rental" | "signup" | "submission" | "restricted"; label: string; date: string; isTest: boolean; }

const F_SANS = "var(--font-sans),system-ui,sans-serif";
const F_GRO = "var(--font-grotesk),system-ui,sans-serif";

export default function AdminDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeTest, setIncludeTest] = useState(false);
  const [month, setMonth] = useState<string>("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/admin/stats?includeTest=${includeTest ? "1" : "0"}${month ? `&month=${month}` : ""}`)
      .then((r) => r.json())
      .then((data) => { if (!active) return; setStats(data.stats); setActivity(data.recentActivity || []); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [includeTest, month]);

  const labelMonth = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    const cur = new Date();
    if (y === cur.getFullYear() && m - 1 === cur.getMonth()) return "This month";
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  };

  if (loading || !stats) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {[1, 2, 3, 4].map((i) => <div key={i} style={{ height: 120, borderRadius: 16, background: "var(--card)", border: "1px solid var(--card-border)" }} />)}
      </div>
    );
  }

  const margin = stats.mrr > 0 ? Math.round((stats.netProfit / stats.mrr) * 100) : 0;
  const circ = 2 * Math.PI * 25;
  const utilDash = (Math.min(100, Math.max(0, stats.utilization)) / 100) * circ;
  const rentedPct = stats.totalAccounts > 0 ? (stats.rentedAccounts / stats.totalAccounts) * 100 : 0;
  const availPct = stats.totalAccounts > 0 ? (stats.availableAccounts / stats.totalAccounts) * 100 : 0;
  const renewPct = stats.activeRentals > 0 ? Math.min(100, (stats.renewalsDue30d / stats.activeRentals) * 100) : 0;
  const vetPct = stats.vettingStarted > 0 ? Math.round((stats.vettingDropped / stats.vettingStarted) * 100) : 0;

  type Att = { label: string; tone: "warn" | "info" | "neutral"; action: string; href: string };
  const attention: Att[] = [];
  if (stats.restrictedAccounts > 0) attention.push({ label: `${stats.restrictedAccounts} account${stats.restrictedAccounts > 1 ? "s" : ""} restricted — access & billing paused`, tone: "warn", action: "Resolve", href: "/admin/inventory-v2" });
  if (stats.renewalsDue30d > 0) attention.push({ label: `${stats.renewalsDue30d} renewal${stats.renewalsDue30d > 1 ? "s" : ""} due in the next 30 days`, tone: "info", action: "View", href: "/admin/rentals" });
  if (stats.atRisk > 0) attention.push({ label: `${stats.atRisk} rental${stats.atRisk > 1 ? "s" : ""} at-risk — auto-renew off / payment failed`, tone: "warn", action: "View", href: "/admin/rentals" });
  if (stats.appsToReview > 0) attention.push({ label: `${stats.appsToReview} ambassador application${stats.appsToReview > 1 ? "s" : ""} to review`, tone: "info", action: "Review", href: "/admin/pipeline" });
  if (stats.availableAccounts > 0) attention.push({ label: `${stats.availableAccounts} account${stats.availableAccounts > 1 ? "s" : ""} idle — available, not earning`, tone: "neutral", action: "Assign", href: "/admin/inventory-v2" });
  if (stats.offlineAccounts > 0) attention.push({ label: `${stats.offlineAccounts} account${stats.offlineAccounts > 1 ? "s" : ""} offline`, tone: "warn", action: "View", href: "/admin/inventory-v2" });

  const dotColor = (tone: string) => tone === "warn" ? "var(--warn-dot)" : tone === "neutral" ? "var(--neutral-dot)" : "var(--accent)";
  const actDot = (t: Activity["type"]) => t === "restricted" ? "var(--warn-dot)" : t === "signup" ? "var(--green)" : "var(--accent)";

  const sectionLabel: React.CSSProperties = { font: `700 11.5px ${F_SANS}`, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--section-label)", margin: "0 0 11px" };
  const cardLabel: React.CSSProperties = { font: `700 10px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--label)" };
  const cardSub: React.CSSProperties = { font: `500 11.5px ${F_SANS}`, color: "var(--muted)" };
  const num = (size: number, color = "var(--text)"): React.CSSProperties => ({ font: `600 ${size}px/1 ${F_GRO}`, color, fontVariantNumeric: "tabular-nums", letterSpacing: "-.02em" });

  const StatCard = ({ label, value, sub, valueColor, warn, href, extra, trend }: { label: string; value: React.ReactNode; sub?: React.ReactNode; valueColor?: string; warn?: boolean; href?: string; extra?: React.ReactNode; trend?: React.ReactNode }) => (
    <div
      onClick={href ? () => router.push(href) : undefined}
      style={{
        background: warn ? "var(--warn-bg)" : "var(--card)", border: "1px solid", borderColor: warn ? "var(--warn-border)" : "var(--card-border)",
        borderRadius: 13, padding: 14, display: "flex", flexDirection: "column", gap: 6, minHeight: 112,
        boxShadow: warn ? "none" : "var(--card-shadow)", cursor: href ? "pointer" : "default",
      }}
    >
      <span style={warn ? { ...cardLabel, color: "var(--warn-label)" } : cardLabel}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={num(26, valueColor || (warn ? "var(--warn-num)" : "var(--text)"))}>{value}</span>
        {trend}
      </div>
      <span style={warn ? { ...cardSub, color: "var(--warn-label)" } : cardSub}>{sub}</span>
      {extra}
    </div>
  );

  const Spark = ({ path, points, stroke, fill, h = 30 }: { path?: string; points: string; stroke: string; fill?: string; h?: number }) => (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block", marginTop: 8 }}>
      {fill && path && <path d={path} fill={fill} />}
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  const upPath = "M0,30 L13,26 L26,27 L39,20 L52,15 L65,12 L78,8 L91,6 L100,4 L100,34 L0,34 Z";
  const upPts = "0,30 13,26 26,27 39,20 52,15 65,12 78,8 91,6 100,4";
  const seg = (active: boolean): React.CSSProperties => ({ font: `600 12.5px ${F_SANS}`, padding: "6px 14px", borderRadius: 7, cursor: "pointer", border: "none", color: active ? "var(--seg-active-text)" : "var(--seg-inactive-text)", background: active ? "var(--seg-active-bg)" : "transparent" });

  // Month-over-month chip. undefined => no prior-month snapshot yet (no chip);
  // null => baseline was 0 but there's a value now ("new"); 0 => unchanged (no chip).
  const Trend = ({ v }: { v: number | null | undefined }) => {
    if (v === undefined || v === 0) return null;
    const isNew = v === null;
    const up = isNew || (v as number) > 0;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, font: `600 11px ${F_SANS}`, padding: "3px 8px", borderRadius: 999, background: up ? "var(--green-chip-bg)" : "var(--warn-badge-bg)", color: up ? "var(--green-chip-text)" : "var(--warn-badge-text)", whiteSpace: "nowrap" }}>
        {up ? "▲" : "▼"} {isNew ? "new" : `${Math.abs(v as number)}%`}
      </span>
    );
  };

  return (
    <div>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ font: `600 30px/1 ${F_GRO}`, color: "var(--text)", margin: "0 0 7px", letterSpacing: "-.02em" }}>Dashboard</h1>
          <p style={{ font: `500 13.5px ${F_SANS}`, color: "var(--muted)", margin: 0 }}>How the business is doing — money, demand and supply at a glance.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: "var(--seg-bg)", border: "1px solid var(--seg-border)", borderRadius: 10, padding: 3 }}>
            <button onClick={() => setIncludeTest(false)} style={seg(!includeTest)}>Live</button>
            <button onClick={() => setIncludeTest(true)} style={seg(includeTest)}>All (incl. test)</button>
          </div>
          <select value={month || stats.month} onChange={(e) => setMonth(e.target.value)}
            style={{ font: `600 12.5px ${F_SANS}`, color: "var(--muted)", background: "var(--seg-bg)", border: "1px solid var(--seg-border)", padding: "7px 12px", borderRadius: 9, cursor: "pointer" }}>
            {(stats.availableMonths || [stats.month]).map((m) => <option key={m} value={m}>{labelMonth(m)}</option>)}
          </select>
        </div>
      </div>

      {!stats.isCurrentMonth && (
        <div style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted)", background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "9px 13px", marginBottom: 18 }}>
          Showing <strong style={{ color: "var(--text2)" }}>{labelMonth(stats.month)}</strong> — month-end snapshot. The right-hand panels (Needs attention, Recent activity) always show live status.
        </div>
      )}

      {/* MONEY */}
      <div style={{ marginBottom: 20 }}>
        <div style={sectionLabel}>Money</div>
        <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr 1fr 1fr 1fr", gap: 14 }}>
          <div onClick={() => router.push("/admin/rentals")} style={{ background: "var(--money-bg)", border: "1px solid var(--money-border)", borderRadius: 16, padding: "17px 19px 14px", boxShadow: "var(--money-shadow)", cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ font: `700 11px ${F_SANS}`, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--money-label)" }}>Net profit / mo</span>
              <Trend v={stats.netProfitTrend} />
            </div>
            <div style={{ ...num(38, "var(--money-num)"), marginTop: 9 }}>{formatCurrency(stats.netProfit)}</div>
            <div style={{ font: `500 12.5px ${F_SANS}`, color: "var(--money-label)", marginTop: 5 }}>{margin}% margin</div>
            <Spark path={upPath} points={upPts} stroke="var(--money-spark-stroke)" fill="var(--money-spark-fill)" h={42} />
          </div>
          <MoneyCard label="Monthly rev." value={formatCurrency(stats.mrr)} sub="recurring · money in" stroke="var(--accent)" fill="var(--blue-spark-fill)" num={num} cardSub={cardSub} Spark={Spark} path={upPath} pts={upPts} trendEl={<Trend v={stats.mrrTrend} />} />
          <MoneyCard label="Collected / mo" value={formatCurrency(stats.collected)} sub={`${stats.collectedCount} payment${stats.collectedCount === 1 ? "" : "s"} · received`} stroke="var(--green)" fill="var(--blue-spark-fill)" num={num} cardSub={cardSub} Spark={Spark} path={upPath} pts={upPts} />
          <MoneyCard label="Payouts paid" value={formatCurrency(stats.payouts)} sub={stats.payoutsPhp != null ? `${formatPeso(stats.payoutsPhp)} out · amb + referral` : "money out"} stroke="var(--gray-spark-stroke)" fill="var(--gray-spark-fill)" num={num} cardSub={cardSub} Spark={Spark} path="M0,25 L13,25 L26,24 L39,25 L52,25 L65,24 L78,25 L91,25 L100,25 L100,34 L0,34 Z" pts="0,25 13,25 26,24 39,25 52,25 65,24 78,25 91,25 100,25" />
          <div onClick={() => router.push("/admin/rentals")} style={{ background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 16, padding: "17px 18px 14px", boxShadow: "var(--card-shadow)", cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ font: `700 11px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--muted)" }}>Active rentals</span>
              <Trend v={stats.activeRentalsTrend} />
            </div>
            <div style={{ ...num(30, "var(--accent)"), marginTop: 9 }}>{stats.activeRentals}</div>
            <div style={{ font: `500 12px ${F_SANS}`, color: "var(--muted)", marginTop: 5 }}>live now</div>
            <Spark path="M0,28 L13,25 L26,26 L39,22 L52,19 L65,16 L78,13 L91,11 L100,9 L100,34 L0,34 Z" points="0,28 13,25 26,26 39,22 52,19 65,16 78,13 91,11 100,9" stroke="var(--accent)" fill="var(--blue-spark-fill)" />
          </div>
        </div>
      </div>

      {/* two-col */}
      <div className="dash-grid" style={{ display: "grid", gridTemplateColumns: "1fr 372px", gap: 18, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

          <div>
            <div style={sectionLabel}>Demand · renters</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
              <StatCard label="Customers" value={stats.totalCustomers} sub={`renting ${stats.rentedAccounts} accounts`} href="/admin/renters" trend={<Trend v={stats.customersTrend} />}
                extra={<svg viewBox="0 0 100 22" preserveAspectRatio="none" style={{ width: "100%", height: 18, display: "block", marginTop: "auto" }}><polyline points="0,18 20,16 40,17 60,12 80,9 100,6" fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>} />
              <StatCard label="New (30d)" value={stats.newCustomers30d} sub="new this month" href="/admin/renters" />
              <StatCard label="Renewals ≤30d" value={stats.renewalsDue30d} sub="coming up" href="/admin/rentals"
                extra={<div style={{ height: 5, borderRadius: 999, background: "var(--track)", marginTop: "auto", overflow: "hidden" }}><div style={{ width: `${renewPct}%`, height: "100%", background: "var(--accent)", borderRadius: 999 }} /></div>} />
              <StatCard label="At-risk" value={stats.atRisk} sub="may churn" warn href="/admin/rentals" valueColor={stats.atRisk > 0 ? "var(--warn-num)" : "var(--faint-num)"} />
              <StatCard label="Vetting drop-off" value={`${stats.vettingDropped}/${stats.vettingStarted}`} sub={stats.vettingStarted > 0 ? `${vetPct}% opened, didn't finish` : "opened form, didn't finish"} href="/admin/renters" valueColor={stats.vettingDropped > 0 ? "var(--warn-num)" : "var(--faint-num)"} />
            </div>
          </div>

          <div>
            <div style={sectionLabel}>Supply · accounts &amp; ambassadors</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
              <StatCard label="Total accounts" value={stats.totalAccounts} sub="" href="/admin/inventory-v2"
                extra={<>
                  <div style={{ display: "flex", height: 6, borderRadius: 999, overflow: "hidden", background: "var(--track)", marginTop: 2 }}><div style={{ width: `${rentedPct}%`, background: "var(--accent)" }} /><div style={{ width: `${availPct}%`, background: "var(--green)" }} /></div>
                  <div style={{ display: "flex", gap: 9, marginTop: "auto", font: `500 10.5px ${F_SANS}`, color: "var(--muted)" }}><span style={{ color: "var(--accent)" }}>● {stats.rentedAccounts} rented</span><span style={{ color: "var(--green)" }}>● {stats.availableAccounts} avail</span></div>
                </>} />
              <StatCard label="Restricted" value={stats.restrictedAccounts} sub="recovering · access & billing paused" warn href="/admin/inventory-v2" valueColor={stats.restrictedAccounts > 0 ? "var(--warn-num)" : "var(--faint-num)"} />
              <div onClick={() => router.push("/admin/inventory-v2")} style={{ background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 13, padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 112, boxShadow: "var(--card-shadow)", cursor: "pointer" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={cardLabel}>Utilization</span>
                  <span style={{ ...cardSub, maxWidth: 78 }}>accounts earning</span>
                  <Trend v={stats.utilizationTrend} />
                </div>
                <div style={{ position: "relative", width: 62, height: 62, flex: "none" }}>
                  <svg width="62" height="62" viewBox="0 0 62 62"><circle cx="31" cy="31" r="25" fill="none" stroke="var(--track)" strokeWidth="7" /><circle cx="31" cy="31" r="25" fill="none" stroke="var(--accent)" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${utilDash} ${circ}`} transform="rotate(-90 31 31)" /></svg>
                  <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", font: `600 15px ${F_GRO}`, color: "var(--text)" }}>{stats.utilization}%</span>
                </div>
              </div>
              <StatCard label="Idle (available)" value={stats.availableAccounts} sub="not earning" href="/admin/inventory-v2" valueColor={stats.availableAccounts > 0 ? "var(--warn-num)" : "var(--faint-num)"}
                extra={<span style={{ font: `600 10.5px ${F_SANS}`, color: "var(--link)", marginTop: "auto" }}>Assign renters →</span>} />
              <StatCard label="Apps to review" value={stats.appsToReview} sub="ambassador applications" href="/admin/pipeline" valueColor={stats.appsToReview > 0 ? "var(--text)" : "var(--faint-num)"} />
            </div>
          </div>
        </div>

        {/* right rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 16, padding: "18px 20px", boxShadow: "var(--card-shadow)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--warn-dot)", display: "inline-block", transform: "rotate(45deg)" }} />
              <span style={{ font: `700 13.5px ${F_SANS}`, color: "var(--text)" }}>Needs attention</span>
              <span style={{ marginLeft: "auto", font: `700 11px ${F_SANS}`, color: "var(--warn-badge-text)", background: "var(--warn-badge-bg)", padding: "3px 9px", borderRadius: 999 }}>{attention.length}</span>
            </div>
            {attention.length === 0 ? (
              <p style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted)", padding: "8px 0", margin: 0 }}>All clear — nothing needs you right now. 🎉</p>
            ) : attention.map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "11px 0", borderTop: "1px solid var(--divider)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: dotColor(a.tone), flex: "none" }} /><span style={{ font: `500 12.5px ${F_SANS}`, color: "var(--text2)" }}>{a.label}</span></div>
                <button onClick={() => router.push(a.href)} style={{ font: `600 11px ${F_SANS}`, color: "var(--link)", background: "var(--blue-chip-bg)", padding: "4px 10px", borderRadius: 7, whiteSpace: "nowrap", border: "none", cursor: "pointer" }}>{a.action}</button>
              </div>
            ))}
          </div>

          <div style={{ background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 16, padding: "18px 20px", boxShadow: "var(--card-shadow)" }}>
            <div style={{ font: `700 13.5px ${F_SANS}`, color: "var(--text)", marginBottom: 6 }}>Recent activity</div>
            {activity.length === 0 ? (
              <p style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted)", padding: "8px 0", margin: 0 }}>No activity yet</p>
            ) : activity.map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--divider)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: actDot(a.type), flex: "none" }} /><span style={{ font: `500 12.5px ${F_SANS}`, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}{a.isTest ? " · TEST" : ""}</span></div>
                <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--date-color)", whiteSpace: "nowrap" }}>{formatDate(a.date)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@media (max-width: 1024px){ .dash-grid{grid-template-columns:1fr !important} }`}</style>
    </div>
  );
}

function MoneyCard({ label, value, sub, stroke, fill, path, pts, num, cardSub, Spark, trendEl }: {
  label: string; value: React.ReactNode; sub: string; stroke: string; fill: string; path: string; pts: string;
  num: (s: number, c?: string) => React.CSSProperties; cardSub: React.CSSProperties;
  Spark: (p: { path?: string; points: string; stroke: string; fill?: string; h?: number }) => React.ReactNode;
  trendEl?: React.ReactNode;
}) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 16, padding: "17px 18px 14px", boxShadow: "var(--card-shadow)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ font: `700 11px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</span>
        {trendEl}
      </div>
      <div style={{ ...num(30), marginTop: 9 }}>{value}</div>
      <div style={{ ...cardSub, marginTop: 5 }}>{sub}</div>
      {Spark({ path, points: pts, stroke, fill })}
    </div>
  );
}
