"use client";

// Inventory v2 — parallel preview route (/admin/inventory-v2), built to the
// "Inventory v2" design mock. Dense operator TABLE + KPI tiles + LV-PoC pills +
// filter bar + daily-check mode + grouped rows + tabbed expanded detail
// (Overview / Sign-in & credentials). Reads the live /api/admin/inventory-v2
// endpoint and reuses the same action endpoints as the live inventory, so this is
// real data and real writes. The live /admin/accounts page is untouched until this
// is blessed and promoted (same play as pipeline-new → pipeline).
//
// Colours are the mock's literal light palette (not the CSS-var theme) so it looks
// exactly like the approved design when shown to Sam. Theming is a promotion-time task.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { tierPricing } from "@/lib/account-pricing";
import { formatName } from "@/lib/utils";
import { isCompanyEmail } from "@/lib/company";
import { RENTAL_READY_ITEMS, RENTAL_READY_OPTIONAL, rentalReadyStatus, type ChecklistState } from "@/lib/rental-ready";
import { SHARED_TOGGLES, OFFBOARDING_ITEMS, offboardingAuto, offboardingLeft, type Offboarding, type SharedWithRenter } from "@/lib/offboarding";
import { currencyConfigFor, formatMoney } from "@/lib/referral-currency";
import { sortAccountsByLastUpdated } from "@/lib/account-notes";
import { IssueActions } from "@/components/admin/issue-actions";
import { ambassadorIssueContact } from "@/lib/issue-contacts";

type Touch = { ch: string; text: string; by: string; at: string; [k: string]: unknown };
type ConnPoint = { at: string; count: number; note?: "rented" | "returned" | string };
type RestrictEvent = { at: string; event: "restricted" | "recovered"; note?: string; creditedDays?: number };

interface Account {
  id: string;
  linkedinName: string;
  linkedinHeadline: string | null;
  linkedinUrl: string | null;
  connectionCount: number;
  industry: string | null;
  location: string | null;
  status: string;
  notes: string | null;
  loginEmail: string | null;
  personalEmail: string | null;
  workEmail: string | null;
  accountPassword: string | null;
  gologinShareLink: string | null;
  gologinProfileId: string | null;
  monthlyPrice: string | number;
  ambassadorPayment: string | number;
  hasSalesNav: boolean;
  listed: boolean;
  linkedinVerified: boolean;
  accountAgeMonths: number | null;
  linkedinJoinedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  ownerUpdatedAt: string | null;
  restrictedAt: string | null;
  permanentlyRestricted: boolean;
  proxyHost: string | null;
  proxyLocation: string | null;
  warmupStartedAt: string | null;
  maturingStartedAt: string | null;
  healthCheckedAt: string | null;
  linkedinAccountHealth: string | null;
  twoFactor: string | null;
  twoFactorResetNeeded: boolean;
  twoFactorReceivedAt: string | null;
  trialEndsAt: string | null;
  heldUntil: string | null;
  heldFor: string | null;
  heldBy: string | null;
  rentalReadyChecklist: Record<string, { done?: boolean; by?: string | null; at?: string | null }> | null;
  offboarding: Offboarding | null;
  rentalReady: boolean;
  gologinStillShared: boolean;
  manualPaidUntil: string | null;
  inventoryPool?: string | null;
  shadowRenter: string | null;
  connectionHistory: ConnPoint[] | null;
  restrictionLog: RestrictEvent[] | null;
  // derived by /api/admin/inventory-v2
  earnedTotal: number;
  mailNeedsReview: number;
  mailIncidentOpen: number;
  utilisation: number;
  // owner-resolved
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  contactChannel: string | null;
  ownerApplicationId: string | null;
  ownerReferredBy: string | null;
  ownerPayoutCurrency: string | null;
  ownerStatus: string | null;
  ownerPoc: string | null;
  ownerOnboarded: boolean;
  ownerOnboardedAt: string | null;
  ownerSetupPaidAt: string | null;
  ownerOutreachLog: Touch[] | null;
  ownerNextFollowUp: string | null;
  ownerReferralSource: string | null;
  profilePhotoUrl: string | null;
  profileScreenshotUrl: string | null;
  issueReferrerName: string | null;
  issueEmailFrom: string;
  issueAmbassadorEmail: string | null;
  issueReferrerContact: { email?: string | null; whatsapp?: string | null; telegram?: string | null; viber?: string | null } | null;
  rentals: Array<{ lockedPrice: string | number | null; currentPeriodEnd: string | null; status: string; user: { id: string; fullName: string; email: string } }>;
}

// ── palette (mock literals) ──
const INK = "#0b1220", SUB = "#5b6779", MUT = "#8a93a3", LINE = "#e3e6ec", LINE2 = "#eef0f4", BG = "#eef0f4";
const BLUE = "#2563eb", GREEN = "#12a150", GREEND = "#0f7a3d", RED = "#dc2626", REDD = "#b91c1c", AMBER = "#92400e";
const F = "'Plus Jakarta Sans',system-ui,sans-serif", G = "'Space Grotesk',system-ui,sans-serif";

const isDummy = (a: Account) => (a.notes || "").includes("[SHOWCASE]");
// Daily-check eligibility: every account we still operate — all live, incl. restricted (you check
// whether they recovered). Only retired accounts and showcase/dummy rows are out of scope.
const checkable = (a: Account) => a.status !== "retired" && !isDummy(a);
// Settable statuses for the inline row quick-edit (rented/trial are driven by rentals, not set here).
const STATUS_OPTS: [string, string][] = [["available", "Available"], ["unavailable", "Unavailable"], ["maintenance", "Maintenance"], ["under_construction", "Construction"], ["construction_immature", "Construction (immature)"], ["under_review", "Under review"], ["retired", "Retired"]];

function canonicalStatus(a: Account): string {
  if (a.status === "retired") return "Permanently restricted/Inaccessible";
  if (a.status === "removed") return "Removed";
  if (a.status !== "rented" && a.ownerApplicationId && !a.ownerSetupPaidAt) return "Initial";
  if (a.restrictedAt || a.status === "maintenance") return "Maintenance";
  if (a.status === "rented") return "Rented";
  if (a.ownerApplicationId && !a.ownerOnboarded) return "Construction";
  if (a.status === "construction_immature" || a.status === "under_construction") return a.ownerOnboarded ? "Construction" : "Initial";
  if (a.status === "available") return a.twoFactorResetNeeded ? "Maintenance" : "Available";
  if (a.status === "trial") return "Trial";
  if (!a.loginEmail || !isCompanyEmail(a.loginEmail) || !a.accountPassword) return "Initial";
  return a.ownerOnboarded ? "Construction" : "Initial";
}

// Which action-needed flags an account currently carries — the key set that drives the "Needs
// attention" filter. KEEP IN SYNC with the row flag block in the render loop (search "Flag
// conditions"): the same booleans, so filtering by a flag shows exactly the rows wearing that pill.
// Only actionable flags live here (benign markers like +SN / shadow / warm-up are not filterable).
type AttnKey = "unverified" | "mail" | "incident" | "overdue" | "rotate" | "2fa" | "restricted" | "incomplete" | "held";
const ATTN_ACTIONABLE: AttnKey[] = ["incident", "overdue", "rotate", "2fa", "restricted", "unverified", "mail", "incomplete"];
function attention(a: Account): Set<AttnKey> {
  const f = new Set<AttnKey>();
  const now = Date.now();
  const retired = canonicalStatus(a) === "Permanently restricted/Inaccessible";
  const rt0 = a.rentals?.[0];
  if (!!a.heldUntil && new Date(a.heldUntil).getTime() > now) f.add("held");
  if (canonicalStatus(a) === "Available" && !a.rentalReady) f.add("unverified");
  if (rt0?.status === "payment_failed"
    || (rt0?.status === "active" && !!rt0.currentPeriodEnd && new Date(rt0.currentPeriodEnd).getTime() < now)
    || (a.status === "rented" && !!a.manualPaidUntil && new Date(a.manualPaidUntil).getTime() < now)) f.add("overdue");
  if (a.twoFactorResetNeeded) f.add("rotate");
  if (!a.twoFactor && (a.status === "rented" || a.status === "available" || a.status === "trial")) f.add("2fa");
  if (a.mailIncidentOpen > 0) f.add("incident");
  if (a.mailNeedsReview > 0) f.add("mail");
  if (a.restrictedAt && !retired) f.add("restricted");
  if (!retired && !isDummy(a) && (((!a.profilePhotoUrl && !a.profileScreenshotUrl)) || !a.location || !a.linkedinHeadline || !a.industry)) f.add("incomplete");
  return f;
}
// Label + short tip per filter option; counts are appended live in the <select>.
const ATTN_OPTS: { key: AttnKey | "attention"; label: string }[] = [
  { key: "attention", label: "⚠ Needs attention" },
  { key: "unverified", label: "⚠ Unverified (rental-ready)" },
  { key: "mail", label: "✉ Mail to review" },
  { key: "incident", label: "🔴 Open incident" },
  { key: "overdue", label: "Overdue payment" },
  { key: "rotate", label: "Rotate 2FA" },
  { key: "2fa", label: "2FA reset needed" },
  { key: "restricted", label: "Restricted" },
  { key: "incomplete", label: "Incomplete catalogue" },
];

const GROUPS: { key: string; title: string; note: string; dot: string }[] = [
  { key: "Available", title: "Available", note: "live & rentable", dot: GREEN },
  { key: "Trial", title: "Trial", note: "3-day hold", dot: AMBER },
  { key: "Rented", title: "Rented", note: "with a customer", dot: BLUE },
  { key: "Construction", title: "Construction", note: "warming up", dot: "#b45309" },
  { key: "Maintenance", title: "Restricted / Maintenance", note: "needs attention", dot: "#64748b" },
  { key: "Initial", title: "Initial / pipeline", note: "not yet in inventory", dot: MUT },
  { key: "Permanently restricted/Inaccessible", title: "Permanently restricted", note: "retired", dot: RED },
  { key: "Showcase", title: "Showcase", note: "demo accounts", dot: AMBER },
];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtD = (d: string | null) => { if (!d) return "—"; const x = new Date(d); return `${MON[x.getMonth()]} ${x.getDate()}`; };
const fmtDY = (d: string | null) => { if (!d) return "—"; const x = new Date(d); return `${MON[x.getMonth()]} ${x.getDate()}, ${x.getFullYear()}`; };
const fmtDYT = (d: string | null) => { if (!d) return "—"; const x = new Date(d); return `${MON[x.getMonth()]} ${x.getDate()}, ${x.getFullYear()} · ${x.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`; };
// Short "updated" recency: hours within the day, days beyond. Fed by updatedAt.
const agoShort = (d: string | null) => { if (!d) return "—"; const h = (Date.now() - new Date(d).getTime()) / 3600000; return h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`; };
const ageStr = (a: Account) => { const m = a.accountAgeMonths; if (m == null) return "—"; const y = Math.floor(m / 12), mm = m % 12; return y ? `${y}y${mm ? ` ${mm}m` : ""}` : `${mm}m`; };
// Approximate "Joined LinkedIn" month (YYYY-MM) from the stored age-in-months, for accounts
// that never had the exact About-this-member date recorded. Used only to PREFILL the editable
// input as a suggestion — nothing is written until the admin hits Save.
const estMonthFromAge = (months: number | null): string => { if (months == null) return ""; const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - months); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const money = (n: number) => (n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`);

const CC: Record<string, string> = { philippines: "PH", "united states": "US", usa: "US", us: "US", india: "IN", "united kingdom": "UK", uk: "UK", canada: "CA", australia: "AU", singapore: "SG", nigeria: "NG", germany: "DE" };
function countryOf(loc: string | null): string {
  if (!loc) return "—";
  const last = loc.split(",").pop()!.trim().toLowerCase();
  return CC[last] || CC[loc.trim().toLowerCase()] || last.slice(0, 2).toUpperCase();
}

const SHADOW_NAMES: Record<string, string> = { "info@ortus.solutions": "Ortus", "info@apexstrategy.io": "Apex" };
const shadowName = (email: string | null): string => (email ? (SHADOW_NAMES[email.trim().toLowerCase()] || email.split("@")[0]) : "");

const priceOf = (a: Account): number => {
  const locked = a.rentals[0]?.lockedPrice;
  if (locked != null && Number(locked) > 0) return Number(locked);
  const mp = Number(a.monthlyPrice);
  if (mp > 0) return mp;
  return tierPricing(a.connectionCount, a.accountAgeMonths, a.hasSalesNav, a.linkedinVerified).monthly;
};

// avatar colour from a string
const AV = ["#2563eb", "#7c3aed", "#0891b2", "#db2777", "#ea580c", "#059669", "#4f46e5"];
const colorOf = (s: string) => AV[[...s].reduce((h, c) => (h + c.charCodeAt(0)) | 0, 0) % AV.length];
const iniOf = (s: string) => (s || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";

function Totp({ accountId }: { accountId: string }) {
  type S = { status: "loading" | "none" | "error" } | { status: "ok"; code: string; expiresIn: number; period: number };
  const [s, setS] = useState<S>({ status: "loading" });
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setInterval>;
    const load = async () => {
      try {
        const res = await fetch(`/api/admin/accounts/${accountId}/totp`, { cache: "no-store" });
        if (!alive) return;
        if (!res.ok) return setS({ status: "error" });
        const d = await res.json();
        if (d.configured === false || d.invalid) return setS({ status: "none" });
        setS({ status: "ok", code: d.code, expiresIn: d.expiresIn, period: d.period });
      } catch { if (alive) setS({ status: "error" }); }
    };
    load();
    timer = setInterval(() => setS((p) => { if (p.status !== "ok") return p; const n = p.expiresIn - 1; if (n <= 0) { load(); return { ...p, expiresIn: 0 }; } return { ...p, expiresIn: n }; }), 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [accountId]);
  if (s.status !== "ok") {
    const label = s.status === "loading" ? "…" : s.status === "none" ? "No 2FA key set" : "2FA unavailable";
    return <div style={{ background: INK, borderRadius: 14, padding: "14px 16px", font: `500 13px ${F}`, color: "#a7b0bf" }}>{label}</div>;
  }
  const pretty = `${s.code.slice(0, 3)} ${s.code.slice(3)}`;
  const pct = Math.round((s.expiresIn / s.period) * 100);
  return (
    <div style={{ background: INK, borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ font: `500 12px ${F}`, color: "#a7b0bf" }}>Type into LinkedIn · new code in {s.expiresIn}s</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ font: `700 30px ${G}`, letterSpacing: ".06em", color: "#fff", fontVariantNumeric: "tabular-nums" }}>{pretty}</span>
        <button onClick={() => { navigator.clipboard?.writeText(s.code); setCopied(true); setTimeout(() => setCopied(false), 1200); }} style={{ marginLeft: "auto", border: "none", background: "#fff", color: INK, borderRadius: 9, padding: "8px 14px", font: `700 13px ${F}`, cursor: "pointer" }}>{copied ? "Copied ✓" : "Copy code"}</button>
      </div>
      <span style={{ height: 4, borderRadius: 4, background: "#1f2a3c", overflow: "hidden", display: "block" }}><span style={{ display: "block", height: "100%", width: `${pct}%`, background: "#34d399", transition: "width 1s linear" }} /></span>
    </div>
  );
}

function Copyable({ value }: { value: string | null }) {
  const [c, setC] = useState(false);
  if (!value) return <span style={{ color: MUT }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
      <span style={{ minWidth: 0, font: `600 13.5px/1.45 ${F}`, color: INK, overflowWrap: "anywhere" }}>{value}</span>
      <button onClick={() => { navigator.clipboard?.writeText(value); setC(true); setTimeout(() => setC(false), 1200); }} title="Copy" style={{ flex: "none", border: "none", background: "none", padding: "0 2px", color: c ? GREEND : "#a3abb8", font: `600 12px ${F}`, cursor: "pointer" }}>{c ? "✓" : "⧉"}</button>
    </span>
  );
}

const Lbl = ({ children }: { children: React.ReactNode }) => <span style={{ font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: MUT }}>{children}</span>;
const Card = ({ children, span, pad = "12px 14px" }: { children: React.ReactNode; span?: number; pad?: string }) => <div style={{ background: "#fff", border: `1px solid #e6e9ee`, borderRadius: 12, padding: pad, display: "flex", flexDirection: "column", gap: 10, minWidth: 0, gridColumn: span ? `span ${span}` : undefined }}>{children}</div>;

export default function InventoryV2Page() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState(""), [cty, setCty] = useState("all"), [renter, setRenter] = useState("all");
  const [ver, setVer] = useState("all"), [conn, setConn] = useState("all"), [supply, setSupply] = useState("all"), [age, setAge] = useState("all");
  const [sort, setSort] = useState("upd");
  const [poc, setPoc] = useState("all");
  const [needs, setNeeds] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Record<string, "account" | "mail" | "activity" | "overview">>({});
  const [toast, setToast] = useState("");
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 1800); };
  const copyWorkEmail = (email: string) => { if (navigator.clipboard?.writeText) navigator.clipboard.writeText(email).then(() => flash("Work email copied")).catch(() => flash("Work email copied")); else flash("Work email copied"); };
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [checkMode, setCheckMode] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [connDraft, setConnDraft] = useState<Record<string, string>>({});
  const [editConn, setEditConn] = useState<string | null>(null); // row whose connections are being quick-edited (outside daily-check)
  const [bannerOpen, setBannerOpen] = useState(true);
  const [sheetFormula, setSheetFormula] = useState<string | null>(null);
  const [copiedFormula, setCopiedFormula] = useState(false);
  // CSV bulk import (ported from the retired live-inventory page — same template + POST /api/admin/accounts).
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; failed: number } | null>(null);

  const load = () => fetch("/api/admin/inventory-v2").then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  useEffect(() => { fetch("/api/admin/accounts/export-url").then((r) => r.json()).then((d) => { if (d.url) setSheetFormula(`=IMPORTDATA("${d.url}")`); }).catch(() => {}); }, []);
  const copyFormula = () => { if (!sheetFormula) return; navigator.clipboard?.writeText(sheetFormula); setCopiedFormula(true); setTimeout(() => setCopiedFormula(false), 1400); };
  const csvTemplate = `Account Email,LinkedIn Name,LinkedIn URL,Connections,Industry,Location,Sales Navigator,Account Opened,Rental Price,Ambassador Payment,Status,Profile Photo URL,GoLogin Share Link
mikka@example.com,Mikka Aloria,https://www.linkedin.com/in/mikka-aloria/,5000,Technology,London,no,2020-01-15,50,25,available,https://example.com/photo.jpg,https://app.gologin.com/share/abc123`;
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => setCsvText((ev.target?.result as string) || ""); reader.readAsText(file); };
  const parseCsvLine = (line: string): string[] => { const r: string[] = []; let cur = "", q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { r.push(cur.trim()); cur = ""; } else cur += ch; } r.push(cur.trim()); return r; };
  const handleCsvImport = async () => {
    if (!csvText.trim()) return;
    setImporting(true); setImportResult(null);
    const lines = csvText.trim().split("\n");
    const firstLine = lines[0].toLowerCase().trim();
    const isHeaderRow = firstLine.includes("account email") || firstLine.includes("linkedin name") || firstLine.includes("email");
    const headerCols = isHeaderRow ? parseCsvLine(lines[0]).map((c) => c.trim().toLowerCase()) : [];
    const dataLines = isHeaderRow ? lines.slice(1) : lines;
    const colIndex = (name: string) => headerCols.findIndex((h) => h.includes(name));
    const getCol = (cols: string[], name: string, fb: number) => { const idx = isHeaderRow ? colIndex(name) : fb; return idx >= 0 && idx < cols.length ? cols[idx]?.trim() : ""; };
    let success = 0, failed = 0;
    for (const line of dataLines) {
      if (!line.trim()) continue;
      const cols = parseCsvLine(line);
      const accountEmail = getCol(cols, "account email", 0) || getCol(cols, "email", 0);
      const accountOpened = getCol(cols, "account opened", 7) || getCol(cols, "opened", 7);
      let ageM: number | undefined;
      if (accountOpened) { const o = new Date(accountOpened); if (!isNaN(o.getTime())) { const n = new Date(); ageM = (n.getFullYear() - o.getFullYear()) * 12 + (n.getMonth() - o.getMonth()); } }
      const status = getCol(cols, "status", 10);
      try {
        const res = await fetch("/api/admin/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          linkedinName: getCol(cols, "linkedin name", 1) || getCol(cols, "name", 1) || accountEmail?.split("@")[0] || "Unknown",
          linkedinUrl: getCol(cols, "linkedin url", 2) || getCol(cols, "url", 2) || undefined,
          connectionCount: parseInt(getCol(cols, "connections", 3)) || 0,
          industry: getCol(cols, "industry", 4) || undefined,
          location: getCol(cols, "location", 5) || undefined,
          hasSalesNav: ["yes", "true"].includes((getCol(cols, "sales nav", 6) || "").toLowerCase()),
          accountAgeMonths: ageM || undefined,
          monthlyPrice: parseFloat(getCol(cols, "rental price", 8) || getCol(cols, "rental", 8)) || 0,
          ambassadorPayment: parseFloat(getCol(cols, "ambassador payment", 9) || getCol(cols, "ambassador", 9) || getCol(cols, "payout", 9)) || 0,
          profilePhotoUrl: getCol(cols, "photo", 11) || getCol(cols, "image", 11) || undefined,
          gologinShareLink: getCol(cols, "gologin", 12) || getCol(cols, "share link", 12) || undefined,
          notes: `Ambassador account. Owner: admin. Profile email: ${accountEmail || ""}.`,
          status: ["under_review", "available", "unavailable", "rented", "maintenance", "retired"].includes(status?.trim().toLowerCase()) ? status.trim().toLowerCase() : "under_review",
        }) });
        if (res.ok) success++; else failed++;
      } catch { failed++; }
    }
    setImportResult({ success, failed }); setImporting(false); load();
  };
  const patchApp = async (appId: string, body: Record<string, unknown>) => { const res = await fetch(`/api/admin/ambassadors/${appId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (res.ok) await load(); return res; };

  const patch = async (id: string, body: Record<string, unknown>, reload = true) => {
    setBusy(id);
    try { const res = await fetch(`/api/admin/accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (res.ok && reload) await load(); return res; }
    finally { setBusy(null); }
  };
  // Marking a RENTED account restricted pauses the renter's billing and emails them right
  // away, so a stray ✕/pill click is costly. Require an explicit confirm naming the renter.
  const confirmRestrict = (a: Account): boolean => {
    const r = (a.rentals || []).find((x) => x.status === "active" || x.status === "pending_access" || x.status === "payment_failed");
    if (a.status !== "rented" && !r) return true;
    const who = r?.user?.fullName || r?.user?.email || "the current renter";
    return window.confirm(`Mark ${a.linkedinName} restricted?\n\nThis account is rented by ${who}. This pauses their billing and emails them that the account is restricted. Only do this if LinkedIn actually restricted it.`);
  };
  // Optimistic: update the row instantly and fire the write in the background, so the
  // ✓/✕ buttons respond on the first click instead of waiting on a full refetch.
  const setRestricted = (a: Account, restricted: boolean) => {
    if (restricted && !confirmRestrict(a)) return;
    const now = new Date().toISOString();
    setAccounts((p) => p.map((x) => (x.id === a.id ? { ...x, restrictedAt: restricted ? now : null, healthCheckedAt: now, updatedAt: now, linkedinAccountHealth: restricted ? x.linkedinAccountHealth : "active" } : x)));
    fetch(`/api/admin/accounts/${a.id}/restricted`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restricted }) }).catch(() => load());
  };
  const markActive = (a: Account) => {
    const now = new Date().toISOString();
    setAccounts((p) => p.map((x) => (x.id === a.id ? { ...x, linkedinAccountHealth: "active", healthCheckedAt: now, updatedAt: now } : x)));
    fetch(`/api/admin/accounts/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linkedinAccountHealth: "active", healthCheckedAt: now }) }).catch(() => load());
  };
  // Inline quick-edits from the collapsed row (optimistic, no full reload so the row doesn't jump).
  const setVerified = (a: Account, v: boolean) => {
    const now = new Date().toISOString();
    setAccounts((p) => p.map((x) => (x.id === a.id ? { ...x, linkedinVerified: v, updatedAt: now } : x)));
    patch(a.id, { linkedinVerified: v }, false);
  };
  const setStatus = async (a: Account, status: string) => {
    const prev = a.status;
    const now = new Date().toISOString();
    setAccounts((p) => p.map((x) => (x.id === a.id ? { ...x, status, updatedAt: now, listed: status === "available" ? x.listed : false } : x)));
    const res = await patch(a.id, { status }, false);
    // The server gates a flip into Available on the rental-ready checklist (and 2FA/setup fee).
    // On a block, revert the optimistic change and surface why.
    if (res && !res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }));
      setAccounts((p) => p.map((x) => (x.id === a.id ? { ...x, status: prev } : x)));
      alert(d.error || "Couldn't change the status.");
    }
  };
  // Reserve/hold an account (1 or 2 days) so it drops out of every catalogue while held.
  const hold = async (a: Account, days: number, heldFor: string) => {
    setBusy(a.id);
    try {
      const res = await fetch(`/api/admin/accounts/${a.id}/hold`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days, heldFor }) });
      const d = await res.json().catch(() => ({} as { heldUntil?: string }));
      if (res.ok) setAccounts((p) => p.map((x) => (x.id === a.id ? { ...x, heldUntil: d.heldUntil ?? x.heldUntil, heldFor: heldFor || null, heldBy: "you" } : x)));
    } finally { setBusy(null); }
  };
  const release = async (a: Account) => {
    setBusy(a.id);
    try {
      const res = await fetch(`/api/admin/accounts/${a.id}/hold`, { method: "DELETE" });
      if (res.ok) setAccounts((p) => p.map((x) => (x.id === a.id ? { ...x, heldUntil: null, heldFor: null, heldBy: null } : x)));
    } finally { setBusy(null); }
  };
  const recheck = async (a: Account) => { setBusy(a.id); try { await fetch(`/api/admin/accounts/${a.id}/check-health`, { method: "POST" }); await load(); } finally { setBusy(null); } };
  // Status-strip state machine. Active/Restricted go through /restricted (keeps downtime-credit +
  // billing-paused logic in one place); Perm./Withdrawn through /state; and listing an unrented
  // account Active runs the rental-ready gate (blocked → the server's reason is shown).
  const setState = async (a: Account, pill: "active" | "restricted" | "perm" | "withdrawn") => {
    if (pill === "restricted" && !confirmRestrict(a)) return;
    const H = { "Content-Type": "application/json" };
    setBusy(a.id);
    try {
      if (pill === "restricted") {
        await fetch(`/api/admin/accounts/${a.id}/restricted`, { method: "POST", headers: H, body: JSON.stringify({ restricted: true }) });
      } else if (pill === "perm" || pill === "withdrawn") {
        await fetch(`/api/admin/accounts/${a.id}/state`, { method: "POST", headers: H, body: JSON.stringify({ state: pill }) });
      } else {
        // Active: clear whatever non-active state it's in, then (if unrented) list it through the gate.
        if (a.restrictedAt) await fetch(`/api/admin/accounts/${a.id}/restricted`, { method: "POST", headers: H, body: JSON.stringify({ restricted: false }) });
        if (a.permanentlyRestricted || a.status === "retired" || a.status === "unavailable" || a.status === "removed") {
          await fetch(`/api/admin/accounts/${a.id}/state`, { method: "POST", headers: H, body: JSON.stringify({ state: "clear" }) });
        } else {
          await fetch(`/api/admin/accounts/${a.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ linkedinAccountHealth: "active", healthCheckedAt: new Date().toISOString() }) });
        }
        const rented = a.status === "rented" || (a.rentals && a.rentals.length > 0);
        if (!rented) {
          const res = await fetch(`/api/admin/accounts/${a.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "available" }) });
          if (res && !res.ok) { const d = await res.json().catch(() => ({} as { error?: string })); alert(d.error || "Couldn't set Active."); }
        }
      }
      await load();
    } finally { setBusy(null); }
  };
  const trial = async (a: Account) => { setBusy(a.id); try { await fetch(`/api/admin/accounts/${a.id}/trial`, { method: "POST" }); await load(); } finally { setBusy(null); } };
  const toggleRent = async (a: Account) => {
    if (a.status === "rented" || a.status === "trial") return;
    const next = a.status === "available" ? "unavailable" : "available";
    if (next === "available" && a.twoFactorResetNeeded) { alert("Rotate the 2FA code before making this available again (it was exposed to the last renter)."); return; }
    setAccounts((p) => p.map((x) => (x.id === a.id ? { ...x, status: next, listed: next === "available" } : x)));
    await patch(a.id, { status: next, listed: next === "available" });
  };
  const saveConn = async (a: Account, raw: string) => {
    const n = parseInt((raw || "").replace(/[^0-9]/g, ""), 10);
    if (Number.isNaN(n) || n === a.connectionCount) return;
    // Mirror the server's connection-history append locally (same {at,count}, cap 300) so the
    // Owner & activity log/sparkline shows the new point immediately — this save skips the full
    // reload, so without this the count looks overwritten with no logged entry.
    const at = new Date().toISOString();
    setAccounts((p) => p.map((x) => (x.id === a.id ? { ...x, connectionCount: n, updatedAt: at, connectionHistory: [...(Array.isArray(x.connectionHistory) ? x.connectionHistory : []), { at, count: n }].slice(-300) } : x)));
    await patch(a.id, { connectionCount: n }, false);
  };

  const withGroup = useMemo(() => accounts.map((a) => ({ a, g: isDummy(a) ? "Showcase" : canonicalStatus(a) })), [accounts]);

  const pocCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const { a } of withGroup) { const p = (a.ownerPoc || "").trim(); if (p) m.set(p, (m.get(p) || 0) + 1); }
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [withGroup]);

  const renterOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const { a } of withGroup) { const r = a.rentals[0]?.user; if (r) m.set(r.id, r.fullName || r.email); }
    return [...m.entries()];
  }, [withGroup]);

  const countryOpts = useMemo(() => {
    const m = new Map<string, number>();
    for (const { a } of withGroup) { const c = countryOf(a.location); m.set(c, (m.get(c) || 0) + 1); }
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [withGroup]);

  const connBucket = (n: number) => (n < 50 ? "0" : n < 100 ? "1" : n < 500 ? "2" : n < 1000 ? "3" : "4");
  const ageBucket = (m: number | null) => (m == null ? "x" : m < 12 ? "0" : m < 36 ? "1" : m < 60 ? "2" : m < 120 ? "3" : "4");

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return withGroup.filter(({ a }) => {
      if (groupFilter !== "all" && (isDummy(a) ? "Showcase" : canonicalStatus(a)) !== groupFilter) return false;
      if (poc !== "all" && (a.ownerPoc || "").trim() !== poc) return false;
      if (cty !== "all" && countryOf(a.location) !== cty) return false;
      if (renter !== "all" && a.rentals[0]?.user?.id !== renter) return false;
      if (ver === "v" && !a.linkedinVerified) return false;
      if (ver === "u" && a.linkedinVerified) return false;
      if (conn !== "all" && connBucket(a.connectionCount) !== conn) return false;
      if (age !== "all" && ageBucket(a.accountAgeMonths) !== age) return false;
      if (supply === "offer" && !(canonicalStatus(a) === "Available" && !a.shadowRenter)) return false;
      if (supply === "unverified" && !(canonicalStatus(a) === "Available" && !a.rentalReady)) return false;
      if (supply === "shadow" && !a.shadowRenter) return false;
      if (needs !== "all") { const fl = attention(a); if (needs === "attention" ? !ATTN_ACTIONABLE.some((k) => fl.has(k)) : !fl.has(needs as AttnKey)) return false; }
      if (ql) { const hay = [a.linkedinName, a.loginEmail, a.ownerName, a.rentals[0]?.user?.fullName, a.location, a.industry].join(" ").toLowerCase(); if (!hay.includes(ql)) return false; }
      return true;
    }).map((x) => x.a);
  }, [withGroup, groupFilter, poc, cty, renter, ver, conn, supply, age, needs, q]);

  // Live counts per attention flag (over the whole inventory) — shown in the filter so you can see
  // how many unverified / mail / overdue there are before drilling in.
  const attnCounts = useMemo(() => {
    const c: Record<string, number> = { attention: 0 };
    for (const a of accounts) {
      const fl = attention(a);
      for (const k of fl) c[k] = (c[k] || 0) + 1;
      if (ATTN_ACTIONABLE.some((k) => fl.has(k))) c.attention++;
    }
    return c;
  }, [accounts]);

  // Stable row order: the live sort (esp. "Last updated") is re-derived only when the sort or the
  // SET of visible accounts changes — not when an existing row's sort field changes. So editing a
  // row (connections, health, …) no longer bumps it to the top of its group mid-work ("goes up").
  // A fresh order is picked up on reload or when you change the sort / filters.
  const orderRef = useRef<{ key: string; ids: string[] }>({ key: "", ids: [] });
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const fresh = (() => {
      if (sort === "upd") return sortAccountsByLastUpdated(arr, "newest");
      if (sort === "price") return arr.sort((x, y) => priceOf(y) - priceOf(x));
      if (sort === "conn") return arr.sort((x, y) => y.connectionCount - x.connectionCount);
      if (sort === "age") return arr.sort((x, y) => (y.accountAgeMonths || 0) - (x.accountAgeMonths || 0));
      if (sort === "name") return arr.sort((x, y) => (x.linkedinName || "").localeCompare(y.linkedinName || ""));
      return arr;
    })();
    const key = sort + "|" + arr.map((a) => a.id).sort().join(",");
    if (orderRef.current.key !== key) orderRef.current = { key, ids: fresh.map((a) => a.id) };
    const pos = new Map(orderRef.current.ids.map((id, i) => [id, i]));
    return [...arr].sort((x, y) => (pos.get(x.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(y.id) ?? Number.MAX_SAFE_INTEGER));
  }, [filtered, sort]);

  const grouped = useMemo(() => {
    const m = new Map<string, Account[]>();
    for (const a of sorted) { const g = isDummy(a) ? "Showcase" : canonicalStatus(a); (m.get(g) || m.set(g, []).get(g)!).push(a); }
    return GROUPS.map((g) => ({ ...g, rows: m.get(g.key) || [] })).filter((g) => g.rows.length);
  }, [sorted]);

  // Daily check: in-scope = every live account except retired + showcase/dummy (matches the
  // design's `checkable`). "done" = health checked today. Health buttons show only for in-scope
  // rows, so the progress counter and what you can tick always line up.
  const checkScope = useMemo(() => accounts.filter(checkable), [accounts]);
  const isDoneToday = (a: Account) => !!a.healthCheckedAt && new Date(a.healthCheckedAt).toDateString() === new Date().toDateString();
  const dcDone = checkScope.filter(isDoneToday).length, dcTotal = checkScope.length;

  const tiles = useMemo(() => {
    const count = (k: string) => withGroup.filter(({ g }) => g === k).length;
    const avail = count("Available"), rented = count("Rented");
    const totalEarn = accounts.reduce((s, a) => s + (a.earnedTotal || 0), 0);
    const avgUtil = accounts.length ? Math.round((accounts.reduce((s, a) => s + (a.utilisation || 0), 0) / accounts.length) * 100) : 0;
    return [
      { key: "Available", label: "Available", n: avail, sub: "ready to offer", dot: GREEN, subFg: GREEND },
      { key: "Rented", label: "Rented", n: rented, sub: "with a customer", dot: BLUE, subFg: SUB },
      { key: "Construction", label: "Construction", n: count("Construction"), sub: "warming up", dot: "#b45309", subFg: SUB },
      { key: "Maintenance", label: "Restricted / Maint.", n: count("Maintenance"), sub: "needs attention", dot: "#64748b", subFg: REDD },
      { key: "__earn", label: "Earned, all-time", n: Math.round(totalEarn), sub: "gross collected", dot: "#7c3aed", subFg: SUB, money: true },
      { key: "__util", label: "Avg utilisation", n: avgUtil, sub: "rented share, lifetime", dot: GREEN, subFg: SUB, pct: true },
    ];
  }, [withGroup, accounts]);

  const totalShown = sorted.length;
  const hasFilters = q || cty !== "all" || renter !== "all" || ver !== "all" || conn !== "all" || age !== "all" || supply !== "all" || needs !== "all" || poc !== "all" || groupFilter !== "all";
  const clearAll = () => { setQ(""); setCty("all"); setRenter("all"); setVer("all"); setConn("all"); setAge("all"); setSupply("all"); setNeeds("all"); setPoc("all"); setGroupFilter("all"); };

  const inp: React.CSSProperties = { border: `1px solid #dde1e8`, background: "#fff", borderRadius: 10, padding: "9px 10px", font: `600 13px ${F}`, color: INK, outline: "none" };
  const headCols = "minmax(0,2.2fr) 78px 64px minmax(0,1.3fr) 104px minmax(0,1.2fr) 100px 92px 52px 56px 16px";

  if (loading) return <div style={{ padding: 28, font: `500 14px ${F}`, color: SUB, background: BG, minHeight: "100vh" }}>Loading inventory…</div>;

  return (
    <div style={{ minHeight: "100vh", background: BG, padding: "24px 24px 80px", margin: "-24px", fontFamily: F }}>
      <style>{`.lv-we:hover{color:#2563eb}`}</style>
      {toast && <div style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 50, background: INK, color: "#fff", font: `700 13px ${F}`, padding: "9px 16px", borderRadius: 999, boxShadow: "0 6px 20px rgba(0,0,0,.18)" }}>{toast}</div>}
      {showImport && (
        <div onClick={() => setShowImport(false)} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", background: "rgba(11,18,32,.5)", padding: "6vh 16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 640, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: 24, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px -20px rgba(0,0,0,.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ font: `700 18px ${G}`, color: INK, margin: 0 }}>Import accounts from CSV</h2>
              <button onClick={() => setShowImport(false)} style={{ font: "400 22px/1 sans-serif", color: MUT, background: "none", border: "none", cursor: "pointer" }}>×</button>
            </div>
            <p style={{ font: `500 12.5px ${F}`, color: SUB, margin: "0 0 12px" }}>Upload a CSV or paste rows below. Each row creates an account with &ldquo;Under review&rdquo; status.</p>
            <input type="file" accept=".csv" onChange={handleFileUpload} style={{ font: `500 12.5px ${F}`, color: SUB, marginBottom: 12 }} />
            <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={csvTemplate} rows={7} style={{ width: "100%", resize: "vertical", border: `1px solid ${LINE}`, borderRadius: 10, padding: "9px 11px", font: `500 12px ${G}`, color: INK, outline: "none", boxSizing: "border-box" }} />
            {importResult && <p style={{ font: `700 13px ${F}`, color: importResult.failed ? AMBER : GREEND, margin: "12px 0 0" }}>Imported {importResult.success} · {importResult.failed} failed</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setCsvText(csvTemplate)} style={{ border: `1px solid ${LINE}`, background: "#fff", color: INK, borderRadius: 10, padding: "9px 16px", font: `600 13px ${F}`, cursor: "pointer" }}>Load template</button>
              <button onClick={handleCsvImport} disabled={importing || !csvText.trim()} style={{ font: `700 13px ${F}`, color: "#fff", background: INK, border: "none", padding: "9px 16px", borderRadius: 10, cursor: "pointer", opacity: importing || !csvText.trim() ? 0.5 : 1 }}>{importing ? "Importing…" : "Import"}</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ maxWidth: 1360, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ font: `700 30px ${G}`, color: INK, margin: "0 0 4px", letterSpacing: "-.01em" }}>Inventory</h1>
            <p style={{ font: `500 14px ${F}`, color: SUB, margin: 0 }}>Every account we own, what state it&apos;s in, and who&apos;s on it.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {sheetFormula && <button onClick={copyFormula} title="Copy the IMPORTDATA formula for the live Google Sheet" style={{ border: "1px solid #cdebd9", background: "#f4fbf7", color: GREEND, borderRadius: 10, padding: "8px 12px", font: `700 12.5px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>{copiedFormula ? "Copied ✓" : "Sheets formula"}</button>}
            <button onClick={() => { setShowImport(true); setImportResult(null); }} title="Bulk-create accounts from a CSV" style={{ border: "1px solid #dde1e8", background: "#fff", color: INK, borderRadius: 10, padding: "8px 12px", font: `600 12.5px ${F}`, cursor: "pointer" }}>Import CSV</button>
            <label style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, border: "1px solid #dde1e8", background: "#fff", color: INK, borderRadius: 10, padding: "8px 12px", font: `600 12.5px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>Catalogue ↗<span style={{ font: `600 10px ${F}`, color: MUT }}>▾</span>
              <select defaultValue="" onChange={(e) => { if (e.target.value === "with") window.open("/catalogue", "_blank"); else if (e.target.value === "without") window.open("/catalogue?pricing=off", "_blank"); e.target.value = ""; }} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}><option value="">Open catalogue…</option><option value="with">With pricing</option><option value="without">Without pricing</option></select>
            </label>
            <Link href="/admin/accounts/new" style={{ border: "none", background: INK, color: "#fff", borderRadius: 10, padding: "9px 14px", font: `700 12.5px ${F}`, textDecoration: "none" }}>+ Add account</Link>
          </div>
        </div>

        {/* rotate reminder banner */}
        {bannerOpen && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "9px 14px", font: `500 13px/1.45 ${F}`, color: "#7f1d1d" }}>
            <span style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", background: RED, color: "#fff", display: "grid", placeItems: "center", font: `800 11px ${F}` }}>!</span>
            <span style={{ flex: 1 }}>When a rental or trial ends, rotate <b>both</b> the 2FA key and the GoLogin share link before re-renting. Accounts that still need it are flagged <b>🔑 Rotate</b>.</span>
            <button onClick={() => setBannerOpen(false)} style={{ flex: "none", border: "none", background: "none", color: REDD, font: `700 12px ${F}`, cursor: "pointer" }}>Hide</button>
          </div>
        )}

        {/* KPI tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          {tiles.map((t) => {
            const active = groupFilter === t.key;
            const clickable = !t.key.startsWith("__");
            return (
              <button key={t.key} onClick={() => clickable && setGroupFilter(active ? "all" : t.key)} style={{ textAlign: "left", cursor: clickable ? "pointer" : "default", background: "#fff", border: `1.5px solid ${active ? INK : "#e9ecf1"}`, borderRadius: 14, padding: "13px 15px", display: "flex", flexDirection: "column", gap: 3, boxShadow: active ? "0 4px 14px rgba(16,24,40,.10)" : "0 1px 2px rgba(16,24,40,.04), 0 6px 14px rgba(16,24,40,.035)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, font: `700 11px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: SUB, whiteSpace: "nowrap" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: t.dot }} />{t.label}</span>
                <span style={{ font: `700 26px ${G}`, color: INK }}>{t.money ? money(t.n) : t.pct ? `${t.n}%` : t.n}</span>
                <span style={{ font: `600 12px ${F}`, color: t.subFg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.sub}</span>
              </button>
            );
          })}
        </div>

        {/* PoC pills + filter bar */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 1px 2px rgba(16,24,40,.04)" }}>
          {pocCounts.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ font: `700 11px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: MUT, marginRight: 4 }}>LV PoC</span>
              <button onClick={() => setPoc("all")} style={{ border: `1.5px solid ${poc === "all" ? INK : "#e3e6ec"}`, background: poc === "all" ? "#f3f5f8" : "#fff", borderRadius: 999, padding: "5px 12px", font: `700 12.5px ${F}`, color: INK, cursor: "pointer" }}>All</button>
              {pocCounts.map(([name, n]) => (
                <button key={name} onClick={() => setPoc(poc === name ? "all" : name)} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", border: `1.5px solid ${poc === name ? INK : "#e3e6ec"}`, background: poc === name ? "#f3f5f8" : "#fff", borderRadius: 999, padding: "4px 11px 4px 4px", font: `700 12.5px ${F}`, color: INK, whiteSpace: "nowrap" }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: colorOf(name), color: "#fff", font: `700 10px ${F}`, display: "flex", alignItems: "center", justifyContent: "center" }}>{iniOf(name)}</span>{name}
                  <span style={{ font: `700 11px ${G}`, color: SUB, background: BG, borderRadius: 999, padding: "1px 7px" }}>{n}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${LINE2}`, paddingTop: 10 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, renter, location, industry…" style={{ flex: 1, minWidth: 220, border: `1px solid #dde1e8`, background: "#f8f9fb", borderRadius: 10, padding: "9px 12px", font: `500 13.5px ${F}`, color: INK, outline: "none" }} />
            <select value={cty} onChange={(e) => setCty(e.target.value)} style={inp}><option value="all">Any country</option>{countryOpts.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}</select>
            <select value={renter} onChange={(e) => setRenter(e.target.value)} style={inp}><option value="all">Any renter</option>{renterOpts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
            <select value={ver} onChange={(e) => setVer(e.target.value)} style={inp}><option value="all">Verified + unverified</option><option value="v">Verified only</option><option value="u">Unverified only</option></select>
            <select value={conn} onChange={(e) => setConn(e.target.value)} style={inp}><option value="all">Any connections</option><option value="0">&lt; 50</option><option value="1">50–100</option><option value="2">100–500</option><option value="3">500–999</option><option value="4">1k+</option></select>
            <select value={age} onChange={(e) => setAge(e.target.value)} style={inp}><option value="all">Any age</option><option value="0">&lt; 1 year</option><option value="1">1–3 years</option><option value="2">3–5 years</option><option value="3">5–10 years</option><option value="4">10+ years</option></select>
            <select value={supply} onChange={(e) => setSupply(e.target.value)} style={inp}><option value="all">All supply</option><option value="offer">Available to offer</option><option value="unverified">Available · unverified</option><option value="shadow">Shadow</option></select>
            <select value={needs} onChange={(e) => setNeeds(e.target.value)} title="Show only accounts carrying a flag that needs fixing" style={{ ...inp, ...(needs !== "all" ? { borderColor: "#f59e0b", background: "#fffbeb", color: "#92400e", fontWeight: 700 } : {}) }}>
              <option value="all">Any flag</option>
              {ATTN_OPTS.map((o) => { const n = attnCounts[o.key] || 0; return <option key={o.key} value={o.key} disabled={n === 0}>{o.label}{n ? ` (${n})` : ""}</option>; })}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} style={inp}><option value="upd">Last updated</option><option value="price">Price, high → low</option><option value="conn">Connections, most first</option><option value="age">Age, oldest first</option><option value="name">Name A–Z</option></select>
            {hasFilters && <button onClick={clearAll} style={{ border: "none", background: "none", color: BLUE, font: `700 12.5px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>Clear filters</button>}
          </div>
        </div>

        {/* daily-check sticky bar */}
        {checkMode && (
          <div style={{ position: "sticky", top: 10, zIndex: 5, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: INK, color: "#fff", borderRadius: 12, padding: "10px 14px", boxShadow: "0 10px 30px rgba(11,18,32,.2)" }}>
            <span style={{ font: `700 13.5px ${F}`, whiteSpace: "nowrap" }}>Daily check</span>
            <div style={{ flex: "1 1 200px", display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ flex: 1, height: 6, borderRadius: 6, background: "#273246", overflow: "hidden", display: "block" }}><span style={{ display: "block", height: "100%", width: `${dcTotal ? (dcDone / dcTotal) * 100 : 0}%`, background: "#34d399", transition: "width .3s" }} /></span>
              <span style={{ font: `700 13px ${G}`, whiteSpace: "nowrap" }}>{dcDone} / {dcTotal}</span>
            </div>
            <span style={{ font: `500 12px ${F}`, color: "#a7b0bf", whiteSpace: "nowrap" }}>Type connections + Enter · tick ✓ or ✕ for health</span>
            <button onClick={() => setHideDone((h) => !h)} style={{ border: "1px solid #2a3344", background: hideDone ? "#1f2a3c" : "transparent", color: "#fff", borderRadius: 8, padding: "6px 11px", font: `700 12px ${F}`, cursor: "pointer" }}>{hideDone ? "Show done" : "Hide done"}</button>
            <button onClick={() => setCheckMode(false)} style={{ border: "none", background: "#fff", color: INK, borderRadius: 8, padding: "6px 12px", font: `700 12px ${F}`, cursor: "pointer" }}>Done</button>
          </div>
        )}

        {/* counts + controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 4px -4px", font: `500 12.5px ${F}`, color: SUB, flexWrap: "wrap" }}>
          <span><b style={{ color: INK, fontFamily: G }}>{totalShown}</b> of {accounts.length} accounts</span>
          {!checkMode && <button onClick={() => setCheckMode(true)} style={{ display: "flex", alignItems: "center", gap: 7, border: `1.5px solid ${INK}`, background: "#fff", color: INK, borderRadius: 999, padding: "5px 12px", font: `700 12.5px ${F}`, cursor: "pointer" }}>✓ Start daily check<span style={{ font: `700 11px ${G}`, color: SUB, background: BG, borderRadius: 999, padding: "1px 7px" }}>{dcTotal - dcDone} left</span></button>}
          <button onClick={() => setCollapsed((c) => (c.size ? new Set() : new Set(grouped.map((g) => g.key))))} style={{ marginLeft: "auto", border: "none", background: "none", color: BLUE, font: `700 12.5px ${F}`, cursor: "pointer" }}>{collapsed.size ? "Expand all" : "Collapse all"}</button>
        </div>

        {/* table */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, overflow: "auto", boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 8px 24px rgba(16,24,40,.04)" }}>
          <div style={{ minWidth: 1360 }}>
            <div style={{ display: "grid", gridTemplateColumns: headCols, gap: 12, alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${LINE2}`, background: "#fafbfc", font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: MUT }}>
              <span>Account</span><span>Conn.</span><span>Age</span><span>Flags</span><span>Price</span><span>Renter / status</span><span>LV PoC</span><span>{checkMode ? "Health" : "Updated"}</span><span>Rent</span><span></span><span></span>
            </div>
            {grouped.length === 0 && <div style={{ padding: 40, textAlign: "center", font: `500 13.5px ${F}`, color: MUT }}>No accounts match.</div>}
            {grouped.map((g) => {
              const gOpen = !collapsed.has(g.key);
              const rows = checkMode && hideDone ? g.rows.filter((r) => !isDoneToday(r)) : g.rows;
              return (
                <div key={g.key}>
                  <button onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, border: "none", background: "#f6f7f9", borderBottom: `1px solid ${LINE2}`, padding: "9px 16px", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ font: `700 12px ${F}`, color: MUT, display: "inline-block", transform: gOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.dot }} />
                    <span style={{ font: `700 13.5px ${F}`, color: INK }}>{g.title}</span>
                    <span style={{ font: `700 11.5px ${G}`, color: SUB, background: "#e9ecf1", borderRadius: 999, padding: "1px 8px" }}>{g.rows.length}</span>
                    <span style={{ font: `500 12px ${F}`, color: MUT }}>{g.note}</span>
                  </button>
                  {gOpen && (() => {
                    type Item = { client: { name: string; count: number; mrr: number; next: string | null } } | { row: Account };
                    const items: Item[] = [];
                    if (g.key === "Rented") {
                      const byClient = new Map<string, Account[]>();
                      for (const rr of rows) { const id = rr.rentals[0]?.user?.id || "__none"; const arr = byClient.get(id) || []; arr.push(rr); byClient.set(id, arr); }
                      for (const rs of byClient.values()) {
                        const u = rs[0].rentals[0]?.user;
                        items.push({ client: { name: u ? (u.fullName || u.email) : "Shadow / no renter", count: rs.length, mrr: rs.reduce((s, x) => s + priceOf(x), 0), next: rs.map((x) => x.rentals[0]?.currentPeriodEnd).filter(Boolean).sort()[0] || null } });
                        for (const rr of rs) items.push({ row: rr });
                      }
                    } else {
                      for (const rr of rows) items.push({ row: rr });
                    }
                    return items.map((it) => {
                      if ("client" in it) {
                        const c = it.client;
                        return (
                          <div key={`c-${g.key}-${c.name}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px 7px 28px", background: "#f5f8ff", borderBottom: "1px solid #e6edfb" }}>
                            <span style={{ flex: "none", width: 22, height: 22, borderRadius: "50%", background: colorOf(c.name), color: "#fff", font: `700 10px ${F}`, display: "flex", alignItems: "center", justifyContent: "center" }}>{iniOf(c.name)}</span>
                            <span style={{ font: `700 13px ${F}`, color: INK }}>{c.name}</span>
                            <span style={{ font: `700 11px ${G}`, color: BLUE, background: "#e3ebfd", borderRadius: 999, padding: "1px 8px" }}>{c.count}</span>
                            <span style={{ font: `600 12px ${F}`, color: SUB }}>${c.mrr}/mo</span>
                            {c.next && <span style={{ font: `600 12px ${F}`, color: MUT }}>next {fmtD(c.next)}</span>}
                          </div>
                        );
                      }
                      const r = it.row;
                    // ── Flag conditions (match the Inventory v2 design) ──
                    const nowMs = Date.now();
                    const rt0 = r.rentals[0];
                    const overdue = rt0?.status === "payment_failed"
                      || (rt0?.status === "active" && !!rt0.currentPeriodEnd && new Date(rt0.currentPeriodEnd).getTime() < nowMs)
                      || (r.status === "rented" && !!r.manualPaidUntil && new Date(r.manualPaidUntil).getTime() < nowMs);
                    const needsRotate = r.twoFactorResetNeeded;   // 2FA key + GoLogin link rotation after a rental ends
                    // "2FA reset needed": a rentable account with no 2FA secret stored (the ~9 flagged in the audit).
                    const needs2fa = !r.twoFactor && (r.status === "rented" || r.status === "available" || r.status === "trial");
                    const proxyDown = false;      // no stored proxy/GoLogin-check-failed flag yet (Phase 2)
                    const proxyExpiring = false;  // no stored proxy-expiry field on the account yet (Phase 2)
                    const linkedArmy = false;     // no per-account LinkedArmy marker yet (inventoryPool is all "main")
                    const retired = canonicalStatus(r) === "Permanently restricted/Inaccessible";
                    const warmDays = r.warmupStartedAt ? Math.max(0, Math.floor((nowMs - new Date(r.warmupStartedAt).getTime()) / 86400000)) : null;
                    // Auto maturing flag (reconcile-maturing cron): a live LinkedVelocity warm/cold campaign is running.
                    const matDays = r.maturingStartedAt ? Math.max(0, Math.floor((nowMs - new Date(r.maturingStartedAt).getTime()) / 86400000)) : null;
                    // Recently recovered: not currently restricted, last restriction-log event was a recovery <=30d ago.
                    const recovered = !r.restrictedAt && (() => { const log = Array.isArray(r.restrictionLog) ? r.restrictionLog : []; const last = log[log.length - 1]; return !!last && last.event === "recovered" && (nowMs - new Date(last.at).getTime()) <= 30 * 86400000; })();
                    const isConstruction = r.status === "under_construction" || r.status === "construction_immature";
                    // Catalogue-readiness: fields needed to list an account (edit them in the expanded detail). Skip retired/dummy.
                    const missingCat = (!retired && !isDummy(r)) ? ([
                      (!r.profilePhotoUrl && !r.profileScreenshotUrl) ? "photo" : null,
                      !r.location ? "location" : null,
                      !r.linkedinHeadline ? "headline" : null,
                      !r.industry ? "industry" : null,
                    ].filter(Boolean) as string[]) : [];
                    // Left edge is red ONLY for action-needed signals (never repeats status, which lives on the group dot).
                    const edge = (overdue || needsRotate || needs2fa || proxyDown) ? RED : "transparent";
                    const rentOn = r.listed && r.status === "available";
                    const price = priceOf(r);
                    const rn = r.rentals[0]?.user;
                    const isOpen = open.has(r.id);
                    const curTab = tab[r.id] || "account";
                    const done = isDoneToday(r);
                    // Pills in the design's fixed order; wrap left-to-right. Red pill = #fef2f2/#b91c1c.
                    const RP = { bg: "#fef2f2", fg: "#b91c1c" };
                    const flags: { l: string; bg: string; fg: string; tip?: string }[] = [];
                    const heldActive = !!r.heldUntil && new Date(r.heldUntil) > new Date();
                    if (heldActive) flags.push({ l: `⏸ Held${r.heldFor ? ` · ${r.heldFor}` : ""}`, bg: "#f1f5f9", fg: "#334155", tip: `Reserved${r.heldFor ? ` for ${r.heldFor}` : ""}${r.heldBy ? ` by ${r.heldBy}` : ""} until ${fmtDYT(r.heldUntil)} — hidden from all catalogues` });
                    // Available but rental-ready checklist not complete → needs a housekeeping sweep.
                    if (canonicalStatus(r) === "Available" && !r.rentalReady) flags.push({ l: "⚠ unverified", bg: "#fff7ed", fg: "#9a3412", tip: "Rental-ready checklist not complete — open Sign-in & credentials to sweep it" });
                    if (overdue) flags.push({ l: `Overdue ${money(price)}`, ...RP, tip: "Renewal payment failed — chase the renter" });
                    if (needsRotate) flags.push({ l: "Rotate", ...RP, tip: "Rotate 2FA key + GoLogin link before re-renting" });
                    // Open access issues: no stored per-account access-issue list yet (IssueActions only emails) — inert for now.
                    if (needs2fa) flags.push({ l: "2FA reset needed", ...RP, tip: "No 2FA is set on this account — configure/reset it" });
                    if (r.mailIncidentOpen > 0) flags.push({ l: `🔴 ${r.mailIncidentOpen} incident`, bg: "#fee2e2", fg: "#991b1b", tip: `${r.mailIncidentOpen} open account-mail incident${r.mailIncidentOpen === 1 ? "" : "s"} — open the Account mail tab` });
                    if (r.mailNeedsReview > 0) flags.push({ l: `✉ ${r.mailNeedsReview} mail`, bg: "#eef2ff", fg: "#4338ca", tip: `${r.mailNeedsReview} security email${r.mailNeedsReview === 1 ? "" : "s"} need review — open the Account mail tab` });
                    if (r.restrictedAt && !retired) flags.push({ l: `Restricted ${fmtD(r.restrictedAt)}`, bg: "#fff7ed", fg: "#c2410c", tip: "Currently restricted by LinkedIn" });
                    if (missingCat.length) flags.push({ l: `Incomplete: ${missingCat.join(", ")}`, bg: "#fffbeb", fg: "#92400e", tip: `Missing for catalogue: ${missingCat.join(", ")}` });
                    if (proxyDown) flags.push({ l: "Proxy down", ...RP, tip: "GoLogin proxy check failed" });
                    if (proxyExpiring) flags.push({ l: "Proxy expiring", bg: "#fffbeb", fg: "#92400e", tip: "Proxy plan expires within 7 days" });
                    if (linkedArmy) flags.push({ l: "⚑ LinkedArmy", bg: "#ecfeff", fg: "#0e7490", tip: "Running LinkedArmy campaigns" });
                    if (matDays != null) flags.push({ l: `🔥 Maturing${matDays ? ` · ${matDays}d` : ""}`, bg: "#fff7ed", fg: "#c2410c", tip: "Currently maturing — a LinkedVelocity warm/cold campaign is running (auto)" });
                    else if (warmDays != null && isConstruction) flags.push({ l: `🔥 ${warmDays}d`, bg: "#fff7ed", fg: "#c2410c", tip: "Days in warm-up" });
                    if (recovered) flags.push({ l: "Recovered", bg: "#fffbeb", fg: "#92400e", tip: "Recently restricted, now recovered" });
                    if (r.shadowRenter) flags.push({ l: `◐ Shadow · ${shadowName(r.shadowRenter)}`, bg: "#eff4ff", fg: "#2563eb", tip: `Shadow supply (${shadowName(r.shadowRenter)}) — still available to rent` });
                    if (r.hasSalesNav) flags.push({ l: "+SN", bg: "#eff4ff", fg: "#2563eb", tip: "Has Sales Navigator" });
                    if (isConstruction && warmDays == null && !flags.length) flags.push({ l: "Warm-up", bg: "#f1f3f6", fg: "#5b6779", tip: "Account in build / warm-up" });
                    // Conn. column (match design): log-scale bar + bucketed colour (10≈33%, 100≈66%, 1000+=100%).
                    const cCount = r.connectionCount;
                    const cW = Math.min(100, (Math.log10(Math.max(1, cCount)) / 3) * 100);
                    const cBar = cCount < 50 ? "#c3c9d3" : cCount < 100 ? "#94a3b8" : cCount < 500 ? "#2563eb" : cCount < 1000 ? "#1d4ed8" : "#12a150";
                    return (
                      <div key={r.id} style={{ borderBottom: `1px solid ${LINE2}` }}>
                        <div onClick={() => setOpen((o) => { const n = new Set(o); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} style={{ display: "grid", gridTemplateColumns: headCols, gap: 12, alignItems: "center", padding: "10px 16px", cursor: "pointer", boxShadow: `inset 3px 0 0 ${edge}` }}>
                          {/* account */}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                              <span style={{ font: `700 14px/1.3 ${F}`, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatName(r.linkedinName)}</span>
                              {r.linkedinUrl && <a href={r.linkedinUrl.startsWith("http") ? r.linkedinUrl : `https://${r.linkedinUrl}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="LinkedIn" style={{ flex: "none", padding: "2px 7px", borderRadius: 7, background: "#e8f0fe", color: "#0a66c2", font: `800 11.5px ${F}`, textDecoration: "none" }}>in ↗</a>}
                              <button onClick={(e) => { e.stopPropagation(); setVerified(r, !r.linkedinVerified); }} title={r.linkedinVerified ? "Verified — click to mark unverified" : "Not verified — click to mark verified"} style={{ flex: "none", border: "none", cursor: "pointer", font: `800 10px ${F}`, color: r.linkedinVerified ? BLUE : "#aab2bf", background: r.linkedinVerified ? "#e8f0fe" : "#f1f3f6", borderRadius: 6, padding: "2px 5px" }}>{r.linkedinVerified ? "✓" : "○"}</button>
                              <span title={r.location || ""} style={{ flex: "none", font: `700 10.5px ${F}`, padding: "2px 6px", borderRadius: 6, background: "#f1f3f6", color: SUB }}>{countryOf(r.location)}</span>
                              {isDummy(r) && <span style={{ flex: "none", font: `800 9.5px ${F}`, padding: "2px 6px", borderRadius: 5, background: "#fef3c7", color: AMBER }}>DUMMY</span>}
                            </div>
                            {r.loginEmail && <div className="lv-we" onClick={(e) => { e.stopPropagation(); copyWorkEmail(r.loginEmail!); }} title="Copy work email" style={{ font: `500 11.5px ${F}`, color: "#8a93a3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer", width: "fit-content", maxWidth: "100%" }}>✉ {r.loginEmail}</div>}
                            <div style={{ font: `500 12px ${F}`, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.linkedinHeadline || "No headline yet"}</div>
                          </div>
                          {/* conn — inline input during the daily check or when quick-editing; click the number to edit otherwise */}
                          {(checkMode && checkable(r)) || editConn === r.id ? (
                            <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <input autoFocus={editConn === r.id} defaultValue={r.connectionCount} key={`c-${r.id}-${r.connectionCount}`} onChange={(e) => setConnDraft((d) => ({ ...d, [r.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} onBlur={() => { if (connDraft[r.id] != null) saveConn(r, connDraft[r.id]); setEditConn((c) => (c === r.id ? null : c)); }} inputMode="numeric" title="Connection count — saves on blur / Enter" style={{ width: 72, border: `1.5px solid ${connDraft[r.id] != null && connDraft[r.id] !== String(r.connectionCount) ? BLUE : "#dde1e8"}`, background: "#fff", borderRadius: 8, padding: "5px 8px", font: `700 13.5px ${G}`, color: INK, outline: "none" }} />
                              <span style={{ height: 3, width: 64, borderRadius: 3, background: LINE2, overflow: "hidden", display: "block" }}><span style={{ display: "block", height: "100%", width: `${cW}%`, background: cBar }} /></span>
                            </div>
                          ) : (
                            <div onClick={(e) => { e.stopPropagation(); setEditConn(r.id); }} title="Click to edit connections" style={{ display: "flex", flexDirection: "column", gap: 3, cursor: "pointer" }}>
                              <span style={{ font: `700 15px ${G}`, color: cCount === 0 ? "#c3c9d3" : INK }}>{cCount.toLocaleString()}</span>
                              <span style={{ height: 3, width: 56, borderRadius: 3, background: LINE2, overflow: "hidden", display: "block" }}><span style={{ display: "block", height: "100%", width: `${cW}%`, background: cBar }} /></span>
                            </div>
                          )}
                          {/* age */}
                          <span style={{ font: `700 15px ${G}`, color: INK, whiteSpace: "nowrap" }}>{ageStr(r)}</span>
                          {/* flags */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, minWidth: 0 }}>
                            {flags.map((f, i) => <span key={i} title={f.tip} style={{ font: `700 11.5px ${F}`, padding: "3px 8px", borderRadius: 999, background: f.bg, color: f.fg, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{f.l}</span>)}
                          </div>
                          {/* price */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            <span style={{ font: `700 14px ${G}`, color: INK }}>${price}<span style={{ font: `500 11px ${F}`, color: MUT }}>/mo</span></span>
                            <span style={{ font: `600 10.5px ${F}`, color: MUT, whiteSpace: "nowrap" }}>{r.hasSalesNav ? "SalesNav" : r.linkedinVerified ? "verified" : "standard"}</span>
                          </div>
                          {/* renter — or, for non-rented rows, an inline status quick-edit */}
                          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                            {rn ? (<>
                              <span style={{ font: `600 13px ${F}`, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rn.fullName || rn.email}</span>
                              <span style={{ font: `600 11px ${F}`, color: rt0?.status === "pending_access" ? "#c2410c" : SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rt0?.status === "pending_access" ? "awaiting access" : `next ${fmtD(r.rentals[0]?.currentPeriodEnd || null)}`}</span>
                            </>) : r.shadowRenter ? (<>
                              <span style={{ font: `600 13px ${F}`, color: BLUE, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{shadowName(r.shadowRenter)}</span>
                              <span style={{ font: `600 11px ${F}`, color: MUT, whiteSpace: "nowrap" }}>shadow · yields on rent</span>
                            </>) : (
                              <select value={r.status} onClick={(e) => e.stopPropagation()} onChange={(e) => setStatus(r, e.target.value)} title="Account status — change to move it between groups" style={{ maxWidth: "100%", border: "1px solid #dde1e8", background: "#fff", borderRadius: 8, padding: "4px 6px", font: `600 12px ${F}`, color: INK, outline: "none", cursor: "pointer" }}>
                                {!STATUS_OPTS.some(([v]) => v === r.status) && <option value={r.status}>{r.status}</option>}
                                {STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            )}
                          </div>
                          {/* poc */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            {r.ownerPoc ? <><span style={{ flex: "none", width: 22, height: 22, borderRadius: "50%", background: colorOf(r.ownerPoc), color: "#fff", font: `700 10px ${F}`, display: "flex", alignItems: "center", justifyContent: "center" }}>{iniOf(r.ownerPoc)}</span><span style={{ font: `600 12.5px ${F}`, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.ownerPoc}</span></> : <span style={{ font: `600 12.5px ${F}`, color: MUT }}>—</span>}
                          </div>
                          {/* updated recency + last health-check date; ✓/✕ buttons only during the daily check */}
                          {(() => {
                            // Health sub-line: absolute date ("✓ checked Oct 13"), never a rolling "today".
                            // Permanently-restricted/retired rows show their restriction, not a check date.
                            const retired = canonicalStatus(r) === "Permanently restricted/Inaccessible";
                            const hcText = r.restrictedAt ? `restricted ${fmtD(r.restrictedAt)}` : retired ? "permanently restricted" : r.healthCheckedAt ? `✓ checked ${fmtD(r.healthCheckedAt)}` : "not yet checked";
                            const hcFg = r.restrictedAt || retired ? REDD : r.healthCheckedAt ? GREEND : MUT;
                            return checkMode && checkable(r) ? (
                              <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 4 }}>
                                <button onClick={() => markActive(r)} title="Healthy — mark active" style={{ width: 34, height: 30, borderRadius: 8, border: `1.5px solid ${GREEN}`, background: !r.restrictedAt && done ? GREEN : "#fff", color: !r.restrictedAt && done ? "#fff" : GREEND, font: `800 14px ${F}`, cursor: "pointer" }}>✓</button>
                                <button onClick={() => setRestricted(r, true)} title="Restricted" style={{ width: 34, height: 30, borderRadius: 8, border: `1.5px solid ${RED}`, background: r.restrictedAt ? RED : "#fff", color: r.restrictedAt ? "#fff" : REDD, font: `800 13px ${F}`, cursor: "pointer" }}>✕</button>
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                                <span title={r.updatedAt ? `Last updated ${fmtDY(r.updatedAt)}` : ""} style={{ font: `700 13px ${G}`, color: INK, whiteSpace: "nowrap" }}>{agoShort(r.updatedAt || r.createdAt)}</span>
                                <span title={r.healthCheckedAt ? `Health checked ${fmtDY(r.healthCheckedAt)}` : "Never health-checked"} style={{ font: `600 10.5px ${F}`, color: hcFg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hcText}</span>
                              </div>
                            );
                          })()}
                          {/* rent toggle */}
                          <div onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => toggleRent(r)} disabled={r.status === "rented" || r.status === "trial"} title={rentOn ? "Listed for rent" : "Not listed"} style={{ position: "relative", width: 36, height: 20, borderRadius: 999, border: "none", cursor: r.status === "rented" || r.status === "trial" ? "not-allowed" : "pointer", padding: 0, background: rentOn ? GREEN : "#cbd2dc", opacity: r.status === "rented" || r.status === "trial" ? 0.5 : 1 }}><span style={{ position: "absolute", top: 2, left: rentOn ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .15s" }} /></button>
                          </div>
                          {/* trial */}
                          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", justifyContent: "flex-end" }}>
                            {canonicalStatus(r) === "Available" && !r.shadowRenter && <button onClick={() => trial(r)} disabled={busy === r.id} style={{ border: `1px solid #dde1e8`, background: "#fff", color: INK, borderRadius: 8, padding: "5px 10px", font: `700 12px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>Trial</button>}
                          </div>
                          <span style={{ font: `700 14px ${F}`, color: MUT, display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
                        </div>

                        {isOpen && <ExpandedDetail r={r} tab={curTab} setTab={(t) => setTab((m) => ({ ...m, [r.id]: t }))} busy={busy === r.id} price={price} setState={(pill) => setState(r, pill)} recheck={() => recheck(r)} hold={(days, heldFor) => hold(r, days, heldFor)} release={() => release(r)} onRentalReady={(ready) => setAccounts((p) => p.map((x) => (x.id === r.id ? { ...x, rentalReady: ready } : x)))} patch={patch} patchApp={patchApp} reload={load} />}
                      </div>
                    );
                  }); })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Expanded detail: Overview / Sign-in tabs ──
// ── Account mail: captured LinkedIn security-email timeline + triage (it-was-us / we-know /
// wasn't-us → incident). Pure UI copies of the server checklist/labels so this client file doesn't
// import the server-only lib/account-mail module. ──
type MailEvent = { id: string; receivedAt: string; fromAddr: string; subject: string; bodyText: string; type: string; severity: "benign" | "review" | "danger"; status: string; locationLabel: string | null; actionedBy: string | null; actionedAt: string | null; incidentOpenedAt: string | null; resolution: string | null };
type MailSummary = { logged: number; needReview: number; acknowledged: number; incidents: number; resolved: number };
const MAIL_LABEL: Record<string, string> = { new_login: "New login", location_change: "Location change", password_changed: "Password changed", email_changed: "Email changed", name_changed: "Name changed", photo_changed: "Photo changed", restriction: "Restriction", email_verify: "Email verify", other: "Security email" };
const mailSev = (s: string) => (s === "danger" ? { bg: "#fee2e2", fg: "#991b1b", edge: RED } : s === "review" ? { bg: "#fef3c7", fg: "#854d0e", edge: "#d97706" } : { bg: "#dcfce7", fg: GREEND, edge: "#16a34a" });
// Recommended-response checklist by email type — mirrors INCIDENT_STEPS in lib/account-mail.ts.
const INCIDENT_STEPS: Record<string, string[]> = {
  password_changed: ["Reset the password from our recovery email and set a fresh one.", "Sign out of all other sessions in LinkedIn settings.", "Re-check 2FA is ours and the recovery email is ours."],
  email_changed: ["Remove the email address they added.", "Re-add our address as the primary email and confirm it.", "Reset the password and sign out of all other sessions."],
  new_login: ["Sign out of all other sessions in LinkedIn settings.", "Change the password to a fresh one.", "Check whether this is a renter leak (shared GoLogin / wrong IP) before re-sharing."],
  location_change: ["Sign out of all other sessions in LinkedIn settings.", "Change the password to a fresh one.", "Check the proxy/GoLogin for a geo mismatch or a renter leak."],
  restriction: ["Open the restriction-appeal flow and submit identity-first (offer ID, never mention a VPN).", "Pause renter access until the appeal clears.", "Log the restriction on the account record."],
};
const INCIDENT_STEPS_DEFAULT = ["Change the password and sign out of all other sessions.", "Verify 2FA and the recovery email are both ours.", "Watch the account for further security emails."];
const incidentSteps = (type: string) => INCIDENT_STEPS[type] ?? INCIDENT_STEPS_DEFAULT;

function AccountMail({ accountId }: { accountId: string }) {
  const [data, setData] = useState<{ events: MailEvent[]; summary: MailSummary } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    fetch(`/api/admin/accounts/${accountId}/mail`).then((r) => r.json()).then((d) => { if (on) setData(d); }).catch(() => { if (on) setErr(true); });
    return () => { on = false; };
  }, [accountId]);
  const act = async (eventId: string, action: string) => {
    setBusy(eventId);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/mail`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId, action }) });
      if (!res.ok) return;
      const d = await res.json() as { event: MailEvent; summary: MailSummary };
      setData((prev) => prev ? { summary: d.summary, events: prev.events.map((e) => e.id === eventId ? d.event : e) } : prev);
    } finally { setBusy(null); }
  };
  if (err) return <Card pad="14px"><span style={{ font: `500 13px ${F}`, color: MUT }}>Couldn&apos;t load account mail.</span></Card>;
  if (!data) return <Card pad="14px"><span style={{ font: `500 13px ${F}`, color: MUT }}>Loading…</span></Card>;
  const { events, summary } = data;
  return (
    <Card pad="14px">
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Lbl>Account mail</Lbl>
        <span style={{ marginLeft: "auto", display: "flex", gap: 14, flexWrap: "wrap", font: `700 12px ${F}` }}>
          <span style={{ color: GREEND }}>🟢 {summary.logged} logged</span>
          <span style={{ color: AMBER }}>🟠 {summary.needReview} need review</span>
          {summary.acknowledged > 0 && <span style={{ color: SUB }}>👁 {summary.acknowledged} known</span>}
          <span style={{ color: REDD }}>🔴 {summary.incidents} incidents</span>
          {summary.resolved > 0 && <span style={{ color: GREEND }}>✓ {summary.resolved} resolved</span>}
        </span>
      </div>
      {events.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 0" }}>
          <span style={{ font: `600 13px ${F}`, color: SUB }}>No account emails captured yet.</span>
          <span style={{ font: `500 12px/1.5 ${F}`, color: MUT }}>Only genuine LinkedIn security emails (sign-in, password, email, restriction, verify) to accounts whose login email is on our domains route here. Routine notifications and accounts on the owner&apos;s own email show nothing — that&apos;s expected, not a bug.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {events.map((e) => {
            const sev = mailSev(e.severity);
            const incident = e.status === "incident";
            const resolved = e.status === "resolved";
            const acknowledged = e.status === "acknowledged";
            const edge = incident ? RED : resolved ? "#16a34a" : sev.edge;
            const isOpen = open === e.id;
            const b = busy === e.id;
            const when = e.actionedAt ? fmtDYT(e.actionedAt) : "";
            return (
              <div key={e.id} style={{ borderLeft: `3px solid ${edge}`, background: incident ? "#fffafa" : "#fafbfc", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ padding: "8px 10px 2px", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ flex: "none", font: `700 10.5px ${F}`, padding: "2px 7px", borderRadius: 999, background: sev.bg, color: sev.fg, whiteSpace: "nowrap" }}>{MAIL_LABEL[e.type] || "Security email"}</span>
                  {incident && <span style={{ flex: "none", font: `800 10px ${F}`, padding: "2px 7px", borderRadius: 999, background: RED, color: "#fff", whiteSpace: "nowrap" }}>INCIDENT</span>}
                  {acknowledged && <span style={{ flex: "none", font: `700 10px ${F}`, padding: "2px 7px", borderRadius: 999, background: "#e5e7eb", color: SUB, whiteSpace: "nowrap" }}>✓ known</span>}
                  {resolved && <span style={{ flex: "none", font: `700 10px ${F}`, padding: "2px 7px", borderRadius: 999, background: "#dcfce7", color: GREEND, whiteSpace: "nowrap" }}>✓ resolved</span>}
                  <span style={{ flex: 1, minWidth: 0, font: `600 12.5px ${F}`, color: resolved ? SUB : INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.subject}>{e.subject}{e.locationLabel ? ` · ${e.locationLabel}` : ""}</span>
                  <span style={{ flex: "none", font: `500 11px ${F}`, color: MUT, whiteSpace: "nowrap" }}>{fmtDYT(e.receivedAt)}</span>
                </div>
                {/* Always-visible actions + outcome line (no need to expand to triage). */}
                <div style={{ padding: "2px 10px 8px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {incident ? (
                    <>
                      <MailBtn onClick={() => act(e.id, "resolve")} busy={b} bg="#16a34a" fg="#fff">Mark resolved</MailBtn>
                      <MailBtn onClick={() => act(e.id, "undo")} busy={b} bg="#f3f4f6" fg={SUB}>Undo</MailBtn>
                    </>
                  ) : resolved || acknowledged ? (
                    <MailBtn onClick={() => act(e.id, "undo")} busy={b} bg="#f3f4f6" fg={SUB}>Undo</MailBtn>
                  ) : (
                    <>
                      <MailBtn onClick={() => act(e.id, "it_was_us")} busy={b} bg="#dcfce7" fg={GREEND}>It was us</MailBtn>
                      <MailBtn onClick={() => act(e.id, "we_know")} busy={b} bg="#fef3c7" fg="#854d0e">We know</MailBtn>
                      <MailBtn onClick={() => act(e.id, "wasnt_us")} busy={b} bg="#fee2e2" fg="#991b1b">Wasn&apos;t us</MailBtn>
                    </>
                  )}
                  {(e.actionedBy || resolved || acknowledged || incident) && (
                    <span style={{ font: `500 11px ${F}`, color: MUT }}>{resolved ? "Resolved" : incident ? "Opened" : "Marked known"}{e.actionedBy ? ` · ${e.actionedBy}` : ""}{when ? ` · ${when}` : ""}{e.resolution ? ` · ${e.resolution}` : ""}</span>
                  )}
                  <button onClick={() => setOpen(isOpen ? null : e.id)} style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", font: `700 11px ${F}`, color: BLUE, whiteSpace: "nowrap" }}>{isOpen ? "Hide email ▴" : "Read email ▾"}</button>
                </div>
                {isOpen && (
                  <div style={{ padding: "0 12px 12px" }}>
                    <pre style={{ margin: "0 0 10px", font: `500 12px/1.5 ${F}`, color: SUB, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{e.bodyText || "(no body)"}</pre>
                    {incident && (
                      <div style={{ background: "#fef2f2", border: `1px solid #fecaca`, borderRadius: 8, padding: "10px 12px" }}>
                        <div style={{ font: `800 11.5px ${F}`, color: REDD, margin: "0 0 6px" }}>⚠ Incident open — treat this account as possibly compromised. Team notified by email.</div>
                        <div style={{ font: `700 11px ${F}`, color: INK, margin: "0 0 4px" }}>Recommended response</div>
                        <ol style={{ margin: 0, paddingLeft: 18, font: `500 12px/1.6 ${F}`, color: SUB }}>
                          {incidentSteps(e.type).map((s, i) => <li key={i}>{s}</li>)}
                        </ol>
                        {e.type === "restriction" && <a href="/restriction-guide" target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, font: `700 12px ${F}`, color: BLUE, textDecoration: "none" }}>Open restriction-appeal guide →</a>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function MailBtn({ onClick, busy, bg, fg, children }: { onClick: () => void; busy: boolean; bg: string; fg: string; children: ReactNode }) {
  return <button onClick={onClick} disabled={busy} style={{ border: "none", cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1, borderRadius: 7, padding: "6px 12px", font: `700 12px ${F}`, background: bg, color: fg, whiteSpace: "nowrap" }}>{children}</button>;
}

// ── End-of-rental: lock the account down (rotate 2FA / password / sessions) before it re-lists ──
function EndOfRental({ r, onOpenChange, onClosed }: { r: Account; onOpenChange: (open: boolean) => void; onClosed: () => void }) {
  const [ob, setOb] = useState<Offboarding>(r.offboarding || {});
  const [busy, setBusy] = useState(false);
  // Opens when explicitly started OR when the account already needs rotation (a rental just ended).
  const open = !!ob.open || !!r.twoFactorResetNeeded;
  const rented = r.status === "rented" || (r.rentals && r.rentals.length > 0);
  const autoAcc = { gologinShared: r.gologinStillShared, hasActiveRental: r.rentals && r.rentals.length > 0, proxyHost: r.proxyHost };
  const auto = offboardingAuto(autoAcc);
  const left = offboardingLeft(autoAcc, ob);
  const renter = r.rentals[0]?.user ? (r.rentals[0].user.fullName || r.rentals[0].user.email) : "the renter";
  const call = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${r.id}/offboarding`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({} as { error?: string })); alert(d.error || "Couldn't update."); return false; }
      return true;
    } finally { setBusy(false); }
  };
  const start = async () => { if (await call({ action: "start" })) { setOb((o) => ({ ...o, open: true, shared: { gologin: true, totp: false, password: false, workEmail: false, ...(o.shared || {}) }, ticks: o.ticks || {} })); onOpenChange(true); } };
  const toggleShared = async (key: keyof SharedWithRenter, on: boolean) => { setOb((o) => ({ ...o, shared: { ...(o.shared || {}), [key]: on } })); await call({ action: "shared", key, on }); };
  const tick = async (key: string, done: boolean) => { setOb((o) => ({ ...o, ticks: { ...(o.ticks || {}), [key]: done } })); await call({ action: "tick", key, done }); };
  const close = async () => { if (await call({ action: "close" })) { setOb((o) => ({ ...o, open: false })); onOpenChange(false); onClosed(); } };

  if (!open) {
    if (!rented) return null;
    return (
      <Card pad="14px">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ font: `700 12.5px ${F}`, color: INK }}>Rental ending?</span>
          <span style={{ font: `500 12px/1.5 ${F}`, color: SUB }}>Lock it down before it goes back to Available.</span>
          <button onClick={start} disabled={busy} style={{ alignSelf: "flex-start", border: `1.5px solid #fecaca`, background: "#fff", color: "#b91c1c", borderRadius: 10, padding: "8px 14px", font: `700 13px ${F}`, cursor: "pointer" }}>Start end-of-rental</button>
        </div>
      </Card>
    );
  }
  const shared = ob.shared || {};
  const ticks = ob.ticks || {};
  const items = OFFBOARDING_ITEMS.filter((i) => !i.needs || shared[i.needs]);
  return (
    <Card pad="14px">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ font: `800 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: "#b91c1c" }}>End-of-rental checklist</span>
        <span style={{ marginLeft: "auto", font: `800 11px ${F}`, color: left === 0 ? GREEND : "#b91c1c", background: left === 0 ? "#dcfce7" : "#fee2e2", borderRadius: 999, padding: "2px 9px" }}>{left === 0 ? "✓ Locked down" : `${left} left`}</span>
      </div>
      <span style={{ font: `500 11.5px/1.5 ${F}`, color: SUB }}>Do this the moment {renter} stops renting. Only items for what they had are shown.</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ font: `800 10px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: MUT }}>What did the renter have?</span>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {SHARED_TOGGLES.map((t) => {
            const on = t.locked ? true : !!shared[t.key];
            return <button key={t.key} title={t.hint} disabled={busy || t.locked} onClick={() => !t.locked && toggleShared(t.key, !on)} style={{ border: `1px solid ${on ? "#bfd2fb" : "#dde1e8"}`, background: on ? "#eff4ff" : "#fff", color: on ? "#2563eb" : "#5b6779", borderRadius: 999, padding: "5px 11px", font: `700 12px ${F}`, cursor: t.locked ? "default" : "pointer" }}>{on ? "✓ " : ""}{t.label}</button>;
          })}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, background: "#f6f8fb", border: `1px solid ${LINE2}`, borderRadius: 8, padding: "8px 10px" }}>
        <span style={{ font: `800 10px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: MUT }}>Auto-checked by the system</span>
        {auto.map((c) => <span key={c.key} style={{ font: `650 11.5px ${F}`, color: c.ok ? GREEND : "#b91c1c" }}>{c.ok ? "✓" : "✕"} {c.label}</span>)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((i) => {
          const done = !!ticks[i.key];
          return (
            <label key={i.key} style={{ display: "flex", gap: 9, alignItems: "flex-start", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
              <input type="checkbox" checked={done} disabled={busy} onChange={(e) => tick(i.key, e.target.checked)} style={{ width: 17, height: 17, marginTop: 1, flex: "none", accentColor: "#12a150", cursor: "inherit", ...(done ? {} : { outline: "1.5px solid #fca5a5", outlineOffset: -1, borderRadius: 4 }) }} />
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ font: `650 12.5px ${F}`, color: done ? GREEND : INK, textDecoration: done ? "line-through" : "none" }}>{i.label}{i.optional && <span style={{ font: `600 10.5px ${F}`, color: MUT }}> · optional</span>}</span>
                <span style={{ font: `500 11px/1.4 ${F}`, color: MUT }}>{i.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      <button onClick={close} disabled={busy || left > 0} style={{ border: "none", background: left > 0 ? "#c3c9d3" : "#0b1220", color: "#fff", borderRadius: 10, padding: "9px 14px", font: `700 13px ${F}`, cursor: left > 0 ? "default" : "pointer" }}>{left > 0 ? `Finish ${left} more to close out` : "Close out rental → back to rental-ready"}</button>
    </Card>
  );
}

// ── Rental-ready: housekeeping that must be done before an account is listed Available (hard gate) ──
function RentalReady({ r, onReady, locked }: { r: Account; onReady?: (ready: boolean) => void; locked?: boolean }) {
  const [checklist, setChecklist] = useState<ChecklistState>((r.rentalReadyChecklist as ChecklistState) || {});
  const [busy, setBusy] = useState<string | null>(null);
  const autoAcc = { restrictedAt: r.restrictedAt, permanentlyRestricted: r.permanentlyRestricted, twoFactorResetNeeded: r.twoFactorResetNeeded, proxyHost: r.proxyHost, gologinShared: r.gologinStillShared };
  const st = rentalReadyStatus(autoAcc, checklist);
  const toggle = async (key: string, done: boolean) => {
    setBusy(key);
    setChecklist((c) => ({ ...c, [key]: done ? { done: true } : { done: false } }));
    try {
      const res = await fetch(`/api/admin/accounts/${r.id}/rental-ready`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, done }) });
      // Response carries the server-computed readiness → update the row's ⚠ unverified flag live.
      if (res.ok) { const d = await res.json() as { checklist?: ChecklistState; ready?: boolean }; setChecklist(d.checklist || {}); onReady?.(!!d.ready); }
    } finally { setBusy(null); }
  };
  const Row = ({ k, label, hint, gated }: { k: string; label: string; hint: string; gated: boolean }) => {
    const done = !!checklist[k]?.done; const b = busy === k;
    return (
      <label style={{ display: "flex", gap: 9, alignItems: "flex-start", cursor: b ? "default" : "pointer", opacity: b ? 0.5 : 1 }}>
        <input type="checkbox" checked={done} disabled={b} onChange={(e) => toggle(k, e.target.checked)} style={{ width: 17, height: 17, marginTop: 1, flex: "none", accentColor: GREEN, cursor: "inherit" }} />
        <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <span style={{ font: `650 12.5px ${F}`, color: done ? GREEND : INK }}>{label}{!gated && <span style={{ font: `600 10.5px ${F}`, color: MUT }}> · optional</span>}</span>
          <span style={{ font: `500 11px/1.4 ${F}`, color: MUT }}>{hint}</span>
        </span>
      </label>
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${LINE2}`, paddingTop: 12, opacity: locked ? 0.45 : 1, pointerEvents: locked ? "none" : "auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <Lbl>Rental-ready checklist</Lbl>
        <span style={{ marginLeft: "auto", font: `800 11px ${F}`, color: st.ready ? GREEND : "#854d0e", background: st.ready ? "#dcfce7" : "#fef3c7", borderRadius: 999, padding: "2px 9px" }}>{st.ready ? "✓ Ready to list" : `Not ready · ${st.missing.length + st.autoFail.length} left`}</span>
      </div>
      <span style={{ font: `500 11.5px/1.5 ${F}`, color: SUB }}>{locked ? "Unlocks after the end-of-rental checklist is closed out." : "Finish this before marking the account Available — it can't be listed until it passes. Covers the two risks: getting restricted, and two people on the account at once."}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, background: "#f6f8fb", border: `1px solid ${LINE2}`, borderRadius: 8, padding: "8px 10px" }}>
        <span style={{ font: `800 10px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: MUT }}>Auto-checked by the system</span>
        {[
          { label: "Not restricted", ok: !(r.restrictedAt || r.permanentlyRestricted) },
          { label: "2FA not pending rotation", ok: !r.twoFactorResetNeeded },
          { label: "Proxy assigned", ok: !!r.proxyHost },
          { label: "GoLogin share cleared (no renter still has access)", ok: !r.gologinStillShared },
        ].map((a) => (
          <span key={a.label} style={{ font: `650 11.5px ${F}`, color: a.ok ? GREEND : REDD }}>{a.ok ? "✓" : "✕"} {a.label}</span>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {RENTAL_READY_ITEMS.map((i) => <Row key={i.key} k={i.key} label={i.label} hint={i.hint} gated />)}
        {RENTAL_READY_OPTIONAL.map((i) => <Row key={i.key} k={i.key} label={i.label} hint={i.hint} gated={false} />)}
      </div>
    </div>
  );
}

// ── Rental history: every rental this account has had (real + shadow, active + ended), newest first ──
type RentalRow = { id: string; status: string; isShadow: boolean; startDate: string | null; currentPeriodEnd: string | null; accessGrantedAt: string | null; accessRevokedAt: string | null; createdAt: string; lockedPrice: string | number | null; user: { fullName: string | null; email: string } | null };
const monYr = (d: Date) => `${MON[d.getMonth()]} ${d.getFullYear()}`;

function RentalHistory({ accountId, fallbackRate }: { accountId: string; fallbackRate: number }) {
  const [rentals, setRentals] = useState<RentalRow[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    fetch(`/api/admin/accounts/${accountId}/rentals`).then((r) => r.json()).then((d) => { if (on) setRentals(d.rentals || []); }).catch(() => { if (on) setErr(true); });
    return () => { on = false; };
  }, [accountId]);
  const rows = (rentals || []).map((rt) => {
    const rate = rt.lockedPrice != null && Number(rt.lockedPrice) > 0 ? Number(rt.lockedPrice) : fallbackRate;
    const start = new Date(rt.startDate || rt.createdAt);
    const current = rt.status === "active" || rt.status === "pending_access" || rt.status === "payment_failed";
    const endRef = rt.accessRevokedAt ? new Date(rt.accessRevokedAt) : current ? new Date() : rt.currentPeriodEnd ? new Date(rt.currentPeriodEnd) : new Date();
    const months = Math.max(1, Math.round((endRef.getTime() - start.getTime()) / (30 * 86400000)));
    return { rt, rate, start, current, months, amount: Math.round(rate * months) };
  });
  const total = rows.reduce((s, x) => s + x.amount, 0);
  return (
    <Card pad="14px">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}><Lbl>Rental history</Lbl>{rows.length > 0 && <span style={{ marginLeft: "auto", font: `600 11.5px ${F}`, color: MUT }}>{rows.length} rental{rows.length === 1 ? "" : "s"} · <b style={{ color: SUB, fontFamily: G }}>${total.toLocaleString()}</b> total</span>}</div>
      {err ? <span style={{ font: `500 13px ${F}`, color: MUT }}>Couldn&apos;t load rental history.</span>
        : !rentals ? <span style={{ font: `500 13px ${F}`, color: MUT }}>Loading…</span>
        : rows.length === 0 ? <span style={{ font: `600 13px ${F}`, color: SUB }}>Never rented.</span>
        : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rows.map(({ rt, rate, start, current, months, amount }) => {
              const renter = rt.user?.fullName || rt.user?.email || (rt.isShadow ? "Shadow renter" : "—");
              // End note — Current must match the Rental card's Next billing.
              let note: string, noteFg = SUB;
              if (current) {
                if (rt.status === "payment_failed") { note = `Overdue $${rate}`; noteFg = "#b91c1c"; }
                else { note = rt.currentPeriodEnd ? `Renews ${fmtDY(rt.currentPeriodEnd)}` : "Current"; noteFg = GREEND; }
              } else if (rt.status === "cancelled") { note = "Ended · cancelled"; }
              else if (rt.accessRevokedAt) { note = `Ended ${fmtDY(rt.accessRevokedAt)}`; }
              else { note = rt.currentPeriodEnd ? `Ended ${fmtDY(rt.currentPeriodEnd)}` : "Ended"; }
              return (
                <div key={rt.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "2px 10px", borderTop: `1px solid #f4f5f7`, padding: "9px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    <span style={{ font: `700 13px ${F}`, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{renter}</span>
                    {rt.isShadow && <span style={{ flex: "none", font: `700 10px ${F}`, padding: "1px 7px", borderRadius: 999, background: "#ede9fe", color: "#6d28d9" }}>◐ Shadow</span>}
                    <span style={{ flex: "none", font: `700 10px ${F}`, padding: "1px 7px", borderRadius: 999, background: current ? "#e7f7ee" : "#f1f3f6", color: current ? "#0f7a3d" : "#5b6779" }}>{current ? "Current" : "Past"}</span>
                  </div>
                  <span style={{ justifySelf: "end", font: `700 13px ${G}`, color: INK }}>${amount.toLocaleString()}</span>
                  <span style={{ font: `500 11.5px ${F}`, color: MUT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{monYr(start)} → {current ? "now" : monYr(new Date(rt.accessRevokedAt || rt.currentPeriodEnd || rt.createdAt))} · {months} mo · ${rate}/mo</span>
                  <span style={{ justifySelf: "end", font: `600 11.5px ${F}`, color: noteFg, whiteSpace: "nowrap" }}>{note}</span>
                </div>
              );
            })}
          </div>
        )}
    </Card>
  );
}

function ExpandedDetail({ r, tab, setTab, busy, price, setState, recheck, hold, release, onRentalReady, patch, patchApp, reload }: {
  r: Account; tab: "account" | "mail" | "activity" | "overview"; setTab: (t: "account" | "mail" | "activity" | "overview") => void; busy: boolean; price: number;
  setState: (pill: "active" | "restricted" | "perm" | "withdrawn") => void; recheck: () => void;
  hold: (days: number, heldFor: string) => void; release: () => void; onRentalReady: (ready: boolean) => void;
  patch: (id: string, body: Record<string, unknown>, reload?: boolean) => Promise<Response | undefined>;
  patchApp: (appId: string, body: Record<string, unknown>) => Promise<Response | undefined>; reload: () => void;
}) {
  const [note, setNote] = useState("");
  const [who, setWho] = useState("");
  const [holdFor, setHoldFor] = useState("");
  const [obOpen, setObOpen] = useState(!!r.offboarding?.open || !!r.twoFactorResetNeeded);
  const [copied, setCopied] = useState(false);
  const copyRentLink = () => {
    const link = `${typeof window !== "undefined" ? window.location.origin : ""}/checkout?accounts=${r.id}&direct=1`;
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1800); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done).catch(done); else done();
  };
  const CopyRentBtn = () => <button onClick={copyRentLink} style={{ border: `1.5px solid ${BLUE}`, background: "#fff", color: BLUE, borderRadius: 10, padding: "8px 14px", font: `700 13px ${F}`, cursor: "pointer" }}>{copied ? "✓ Link copied" : "Copy rent link"}</button>;
  const [joined, setJoined] = useState(r.linkedinJoinedAt ? r.linkedinJoinedAt.slice(0, 7) : estMonthFromAge(r.accountAgeMonths));
  const [connVal, setConnVal] = useState(String(r.connectionCount));
  // Catalogue fields (photo + headline/location/industry) — the data needed to list an account.
  const [headlineV, setHeadlineV] = useState(r.linkedinHeadline || "");
  const [locationV, setLocationV] = useState(r.location || "");
  const [industryV, setIndustryV] = useState(r.industry || "");
  const [urlV, setUrlV] = useState(r.linkedinUrl || "");
  const [uploading, setUploading] = useState(false);
  const uploadPhoto = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({} as { url?: string; error?: string }));
      if (res.ok && data.url) await patch(r.id, { profilePhotoUrl: data.url });
      else alert(`Upload failed: ${data.error || res.status}`);
    } finally { setUploading(false); }
  };
  const catDirty = headlineV !== (r.linkedinHeadline || "") || locationV !== (r.location || "") || industryV !== (r.industry || "") || urlV !== (r.linkedinUrl || "");
  const saveCatalogue = () => {
    const body: Record<string, unknown> = {};
    if (headlineV !== (r.linkedinHeadline || "")) body.linkedinHeadline = headlineV.trim() || null;
    if (locationV !== (r.location || "")) body.location = locationV.trim() || null;
    if (industryV !== (r.industry || "")) body.industry = industryV.trim() || null;
    if (urlV !== (r.linkedinUrl || "")) body.linkedinUrl = urlV.trim() || null;
    if (Object.keys(body).length) patch(r.id, body);
  };
  const hist = Array.isArray(r.connectionHistory) ? r.connectionHistory.filter((p) => typeof p.count === "number" && !p.note) : [];
  const restr = Array.isArray(r.restrictionLog) ? r.restrictionLog : [];
  const rCnt = restr.filter((e) => e.event === "restricted").length;
  // sparkline from the last up-to-12 points
  const pts = hist.slice(-12);
  const spark = (() => {
    if (pts.length < 2) return { line: "", area: "", d30: null as number | null };
    const vals = pts.map((p) => p.count); const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
    const X = (i: number) => (i / (pts.length - 1)) * 240; const Y = (v: number) => 44 - ((v - min) / range) * 40 + 2;
    const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.count).toFixed(1)}`).join(" ");
    const area = `0,48 ${line} 240,48`;
    const cutoff = Date.now() - 30 * 86400000;
    const old = [...hist].reverse().find((p) => new Date(p.at).getTime() <= cutoff);
    const d30 = old ? r.connectionCount - old.count : null;
    return { line, area, d30 };
  })();

  // composed timeline
  const events = useMemo(() => {
    const ev: { at: string; t: string; s?: string; dot: string }[] = [];
    if (r.ownerSetupPaidAt) ev.push({ at: r.ownerSetupPaidAt, t: "Setup fee paid", dot: GREEN });
    if (r.ownerOnboardedAt) ev.push({ at: r.ownerOnboardedAt, t: "Onboarded", dot: BLUE });
    for (const e of restr) ev.push({ at: e.at, t: e.event === "restricted" ? "Restricted" : "Recovered", s: e.note || (e.creditedDays ? `+${e.creditedDays}d credit` : undefined), dot: e.event === "restricted" ? RED : GREEN });
    for (const p of (r.connectionHistory || [])) if (p.note) ev.push({ at: p.at, t: p.note === "rented" ? "Rented out" : "Returned", s: `${p.count} connections`, dot: p.note === "rented" ? BLUE : MUT });
    return ev.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  }, [r, restr]);

  const Tab = ({ k, l }: { k: "account" | "mail" | "activity" | "overview"; l: ReactNode }) => <button onClick={() => setTab(k)} style={{ border: "none", cursor: "pointer", borderRadius: 7, padding: "6px 12px", whiteSpace: "nowrap", font: `700 12px ${F}`, background: tab === k ? "#fff" : "transparent", color: tab === k ? INK : SUB, boxShadow: tab === k ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}>{l}</button>;
  const rn = r.rentals[0]?.user;

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: "sticky", left: 0, width: "calc(100vw - 96px)", maxWidth: 1328, padding: "4px 16px 14px", background: "#fafbfc", cursor: "default" }}>
      {/* Status strip — the one place to change account state (replaces Mark active / Mark restricted). */}
      {(() => {
        const sel = (r.permanentlyRestricted || r.status === "retired") ? "perm" : r.restrictedAt ? "restricted" : (r.status === "unavailable" || r.status === "removed") ? "withdrawn" : "active";
        const PILLS: { k: "active" | "restricted" | "perm" | "withdrawn"; l: string; bg: string; fg: string }[] = [
          { k: "active", l: "Active", bg: "#e7f7ee", fg: "#0f7a3d" },
          { k: "restricted", l: "Restricted", bg: "#fff7ed", fg: "#c2410c" },
          { k: "perm", l: "Perm. restricted", bg: "#fef2f2", fg: "#b91c1c" },
          { k: "withdrawn", l: "Withdrawn", bg: "#f1f3f6", fg: "#5b6779" },
        ];
        const warmDays = r.warmupStartedAt ? Math.max(0, Math.floor((Date.now() - new Date(r.warmupStartedAt).getTime()) / 86400000)) : null;
        const matDays = r.maturingStartedAt ? Math.max(0, Math.floor((Date.now() - new Date(r.maturingStartedAt).getTime()) / 86400000)) : null;
        return (
          <div style={{ background: "#fff", border: `1px solid #e6e9ee`, borderRadius: 12, padding: "11px 14px", margin: "4px 0 10px", display: "flex", alignItems: "center", gap: "12px 28px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Lbl>Status</Lbl>
              {PILLS.map((p) => {
                const on = sel === p.k;
                return <button key={p.k} onClick={() => { if (!on) setState(p.k); }} disabled={busy} style={{ border: on ? `1px solid ${p.bg}` : `1px solid #dde1e8`, background: on ? p.bg : "#fff", color: on ? p.fg : SUB, borderRadius: 999, padding: "5px 12px", font: `700 12px ${F}`, cursor: busy ? "default" : "pointer" }}>{on ? "● " : ""}{p.l}</button>;
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ font: `500 11.5px ${F}`, color: MUT }}>{r.healthCheckedAt ? `Last checked ${fmtDY(r.healthCheckedAt)}` : "Not yet checked"}</span>
              <button onClick={recheck} disabled={busy} style={{ border: `1px solid #dde1e8`, background: "#fff", color: SUB, borderRadius: 999, padding: "3px 10px", font: `700 11px ${F}`, cursor: "pointer" }}>↻ Re-check</button>
            </div>
            {matDays !== null
              ? <span title="Currently maturing — a LinkedVelocity warm/cold campaign is running (auto)" style={{ font: `700 11.5px ${F}`, color: "#c2410c", background: "#fff7ed", borderRadius: 999, padding: "3px 10px" }}>🔥 Maturing{matDays ? ` · ${matDays}d` : ""}</span>
              : warmDays !== null && (r.status === "under_construction" || r.status === "construction_immature") && <span style={{ font: `700 11.5px ${F}`, color: "#c2410c", background: "#fff7ed", borderRadius: 999, padding: "3px 10px" }}>🔥 {warmDays}d</span>}
          </div>
        );
      })()}
      <div style={{ display: "flex", gap: 3, background: BG, borderRadius: 10, padding: 3, margin: "4px 0 12px", width: "max-content" }}>
        <Tab k="account" l="Account" /><Tab k="mail" l={<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>Account mail{r.mailNeedsReview + r.mailIncidentOpen > 0 && <span style={{ font: `800 9.5px ${F}`, color: "#fff", background: RED, borderRadius: 999, padding: "1px 5px", lineHeight: 1.3 }}>{r.mailNeedsReview + r.mailIncidentOpen}</span>}</span>} /><Tab k="activity" l="Activity" /><Tab k="overview" l="Overview" />
      </div>

      {tab === "account" && (() => {
        const field = (label: string, value: string | null, copyable?: boolean) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}><Lbl>{label}</Lbl>{copyable ? <Copyable value={value} /> : <span style={{ font: `600 13.5px/1.45 ${F}`, color: value ? INK : MUT, overflowWrap: "anywhere" }}>{value || "—"}</span>}</div>
        );
        const heldActive = !!r.heldUntil && new Date(r.heldUntil) > new Date();
        const complete = !!(r.linkedinHeadline && r.location && r.industry && (r.profilePhotoUrl || r.profileScreenshotUrl));
        const fieldStyle = { border: "1px solid #dde1e8", background: "#fff", borderRadius: 9, padding: "8px 10px", font: `500 13px ${F}`, color: INK, outline: "none", width: "100%" } as const;
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 10, alignItems: "start" }}>
            {/* Column 1 — Owner & rental */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <Card pad="14px">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Lbl>Account owner</Lbl>{r.linkedinUrl && <a href={r.linkedinUrl.startsWith("http") ? r.linkedinUrl : `https://${r.linkedinUrl}`} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", font: `700 12.5px ${F}`, color: BLUE, textDecoration: "none" }}>View profile ↗</a>}</div>
                <div style={{ background: "#f6f7f9", borderRadius: 12, padding: 12, display: "flex", gap: 14, alignItems: "center" }}>
                  {r.profilePhotoUrl || r.profileScreenshotUrl
                    ? <img src={(r.profilePhotoUrl || r.profileScreenshotUrl)!} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover", flex: "none" }} />
                    : <div style={{ width: 64, height: 64, borderRadius: 12, background: "#dfe5ee", color: SUB, display: "grid", placeItems: "center", font: `700 18px ${F}`, flex: "none" }}>{iniOf(r.linkedinName)}</div>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <span style={{ font: `500 12.5px/1.4 ${F}`, color: SUB }}>Profile photo{r.profilePhotoUrl ? " · uploaded" : r.profileScreenshotUrl ? " · onboarding original" : " not set"}.</span>
                    <label style={{ font: `700 12px ${F}`, color: BLUE, cursor: uploading ? "default" : "pointer", opacity: uploading ? 0.5 : 1 }}>
                      {uploading ? "Uploading…" : r.profilePhotoUrl || r.profileScreenshotUrl ? "Replace photo" : "Upload photo"}
                      <input type="file" accept="image/*" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }} style={{ display: "none" }} />
                    </label>
                  </div>
                </div>
                {field("Full name", formatName(r.linkedinName), true)}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
                  {field("Applied with (email)", r.ownerEmail || r.issueAmbassadorEmail, true)}
                  {field("Contact number / handle", r.ownerPhone ? `${r.ownerPhone}${r.contactChannel ? ` · ${r.contactChannel}` : ""}` : null, true)}
                  {field("Location", r.location)}
                  {field("Connections", String(r.connectionCount))}
                  {field("Found us via", r.ownerReferralSource)}
                  {field("Referred by", r.ownerReferredBy)}
                  {field("LV handler (PoC)", r.ownerPoc)}
                  {field("Owner status", r.ownerStatus)}
                </div>
              </Card>
              <Card>
                <Lbl>Rental</Lbl>
                <div style={{ display: "grid", gridTemplateColumns: "92px minmax(0,1fr)", gap: "5px 12px", font: `500 12.5px ${F}`, color: SUB }}>
                  <span>Account age</span><b style={{ color: INK }}>{ageStr(r)}</b>
                  <span>Supply</span><b style={{ color: INK }}>{canonicalStatus(r)}</b>
                  <span>In inventory</span><b style={{ color: INK }}>{fmtDY(r.createdAt)}</b>
                  <span>Renter</span><b style={{ color: INK }}>{rn ? (rn.fullName || rn.email) : "—"}</b>
                  <span>Rate</span><b style={{ color: INK }}>${price}/mo</b>
                  <span>Next billing</span><b style={{ color: INK }}>{fmtDY(r.rentals[0]?.currentPeriodEnd || null)}</b>
                  <span>Health</span><b style={{ color: r.restrictedAt ? REDD : INK }}>{r.restrictedAt ? "restricted" : (r.linkedinAccountHealth || "unchecked")}</b>
                </div>
              </Card>
              <RentalHistory accountId={r.id} fallbackRate={price} />
              <Card pad="14px">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Lbl>Catalogue details</Lbl><span style={{ marginLeft: "auto", font: `700 11px ${F}`, color: complete ? GREEND : "#b45309" }}>{complete ? "✓ complete" : "incomplete"}</span></div>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><Lbl>LinkedIn URL</Lbl><input value={urlV} onChange={(e) => setUrlV(e.target.value)} placeholder="https://www.linkedin.com/in/…" style={fieldStyle} /></label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><Lbl>Headline</Lbl><textarea value={headlineV} onChange={(e) => setHeadlineV(e.target.value)} rows={2} placeholder="e.g. B2B Business Development | SaaS | Pipeline & revenue growth" style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.4 }} /></label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><Lbl>Location</Lbl><input value={locationV} onChange={(e) => setLocationV(e.target.value)} placeholder="e.g. New York, NY, USA" style={fieldStyle} /></label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><Lbl>Industry</Lbl><input value={industryV} onChange={(e) => setIndustryV(e.target.value)} list="inv2-industries" placeholder="e.g. Computer Software" style={fieldStyle} /></label>
                </div>
                <datalist id="inv2-industries">
                  <option value="Information Technology & Services" /><option value="Computer Software" /><option value="Marketing & Advertising" /><option value="Business Consulting & Services" /><option value="Financial Services" /><option value="Staffing & Recruiting" />
                </datalist>
                <button onClick={saveCatalogue} disabled={busy || !catDirty} style={{ border: "1px solid #dde1e8", background: "#fff", color: INK, borderRadius: 9, padding: 9, font: `700 12.5px ${F}`, cursor: catDirty ? "pointer" : "default", opacity: catDirty ? 1 : 0.5 }}>{catDirty ? "Save catalogue details" : "✓ Saved"}</button>
              </Card>
            </div>

            {/* Column 2 — Log in */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <Card pad="14px">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Lbl>Log in</Lbl><a href={`/admin/accounts/${r.id}`} target="_blank" rel="noreferrer" title="Open the full editor — login/personal/work email, password, GoLogin, pricing… (changing the login email here also renames the GoLogin profile)" style={{ marginLeft: "auto", font: `700 12.5px ${F}`, color: BLUE, textDecoration: "none" }}>Edit account ↗</a>{r.gologinShareLink && <a href={r.gologinShareLink} target="_blank" rel="noreferrer" style={{ font: `700 12.5px ${F}`, color: BLUE, textDecoration: "none" }}>↗ Open GoLogin</a>}</div>
                <Totp accountId={r.id} />
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}><Lbl>Login email (work)</Lbl><Copyable value={r.loginEmail} /></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}><Lbl>Personal email</Lbl><Copyable value={r.personalEmail} /></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}><Lbl>Work / recovery email</Lbl><Copyable value={r.workEmail} /></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}><Lbl>Password</Lbl><Copyable value={r.accountPassword} /></div>
                {r.gologinProfileId && <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}><Lbl>GoLogin profile ID</Lbl><Copyable value={r.gologinProfileId} /></div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}><Lbl>Proxy location</Lbl><span style={{ font: `600 13.5px/1.45 ${F}`, color: r.proxyLocation ? INK : MUT }}>{r.proxyLocation || "—"}</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Lbl>LinkedIn verified</Lbl><span style={{ marginLeft: "auto", font: `700 12px ${F}`, color: r.linkedinVerified ? GREEND : MUT }}>{r.linkedinVerified ? "✓ verified" : "not verified"}</span></div>
              </Card>
            </div>

            {/* Column 3 — Hold, readiness, chase */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <Card pad="14px">
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><Lbl>Reserve / hold</Lbl>{heldActive && <span style={{ marginLeft: "auto", font: `600 11.5px ${F}`, color: "#334155" }}>⏸ held until {fmtDYT(r.heldUntil)}</span>}</div>
                {heldActive ? (
                  <>
                    <span style={{ font: `500 12px/1.5 ${F}`, color: SUB }}>Reserved{r.heldFor ? ` for ${r.heldFor}` : ""}{r.heldBy ? ` · by ${r.heldBy}` : ""}. Hidden from every catalogue and the normal checkout until then (or until you release it). Auto-releases when it lapses. Send them the rent link below so they can rent it while it&apos;s held.</span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><CopyRentBtn /><button onClick={release} disabled={busy} style={{ border: `1.5px solid ${LINE}`, background: "#fff", color: "#3b4657", borderRadius: 10, padding: "8px 14px", font: `700 13px ${F}`, cursor: "pointer" }}>Release now</button></div>
                  </>
                ) : r.status === "available" ? (
                  <>
                    <span style={{ font: `500 12px/1.5 ${F}`, color: MUT }}>Hold this account for someone for a day or two so it can&apos;t get snagged. It disappears from all catalogues while held.</span>
                    <input value={holdFor} onChange={(e) => setHoldFor(e.target.value)} placeholder="Held for (name / who it's for)" style={fieldStyle} />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => hold(1, holdFor)} disabled={busy} style={{ border: `1.5px solid ${LINE}`, background: "#fff", color: "#334155", borderRadius: 10, padding: "8px 14px", font: `700 13px ${F}`, cursor: "pointer" }}>Hold 1 day</button>
                      <button onClick={() => hold(2, holdFor)} disabled={busy} style={{ border: `1.5px solid ${LINE}`, background: "#fff", color: "#334155", borderRadius: 10, padding: "8px 14px", font: `700 13px ${F}`, cursor: "pointer" }}>Hold 2 days</button>
                      <CopyRentBtn />
                    </div>
                  </>
                ) : (
                  <span style={{ font: `500 12px/1.5 ${F}`, color: MUT }}>Only available accounts can be reserved.</span>
                )}
              </Card>
              <EndOfRental r={r} onOpenChange={setObOpen} onClosed={reload} />
              <Card pad="14px">
                <RentalReady r={r} onReady={onRentalReady} locked={obOpen} />
              </Card>
              <Card pad="14px">
                <Lbl>Chase an issue</Lbl>
                <IssueActions twoFactorReceivedAt={r.twoFactorReceivedAt} originalEmail={r.personalEmail} lvEmail={r.loginEmail} referralPartner={r.issueReferrerName} from={r.issueEmailFrom} accountId={r.id} profile={r.linkedinUrl} onSent={reload} name={formatName(r.linkedinName)} ambassador={ambassadorIssueContact(r.issueAmbassadorEmail, r.ownerPhone, r.contactChannel, r.location)} referrer={r.issueReferrerContact} />
              </Card>
            </div>
          </div>
        );
      })()}

      {tab === "mail" && <AccountMail accountId={r.id} />}

      {tab === "activity" && (() => {
        const connLog = hist.map((p, i) => ({ at: p.at, count: p.count, delta: i > 0 ? p.count - hist[i - 1].count : null })).reverse().slice(0, 8);
        const rh = restr.slice().reverse().slice(0, 10);
        const touches = (r.ownerOutreachLog || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 10);
        const appId = r.ownerApplicationId;
        const saveOwnerConn = () => { const body: Record<string, unknown> = { linkedinJoinedAt: joined ? new Date(joined + "-01T00:00:00Z").toISOString() : null }; const n = parseInt(connVal.replace(/[^0-9]/g, ""), 10); if (!Number.isNaN(n)) body.connectionCount = n; patch(r.id, body); };
        const logTouch = (ch: string) => { if (!appId) return; patchApp(appId, { addTouch: { ch, text: note.trim() || undefined, by: who.trim() || undefined } }).then(() => setNote("")); };
        const connDirty = joined !== (r.linkedinJoinedAt ? r.linkedinJoinedAt.slice(0, 7) : "") || connVal !== String(r.connectionCount);
        const joinIsEstimate = !r.linkedinJoinedAt && !!joined && joined === estMonthFromAge(r.accountAgeMonths);
        const d30 = (() => { const cutoff = Date.now() - 30 * 86400000; const old = [...hist].reverse().find((p) => new Date(p.at).getTime() <= cutoff); return old ? r.connectionCount - old.count : null; })();
        const CHIP: Record<string, string> = { whatsapp: "WhatsApp", viber: "Viber", telegram: "Telegram", email: "Email", text: "Text", note: "Note" };
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 10, alignItems: "start" }}>
            <Card pad="14px">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><Lbl>Activity</Lbl><span style={{ font: `500 12.5px ${F}`, color: SUB }}>{touches.length} {touches.length === 1 ? "touch" : "touches"}</span>
                <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, font: `600 12px ${F}`, color: SUB }}>Follow up<input type="date" value={r.ownerNextFollowUp ? new Date(r.ownerNextFollowUp).toISOString().slice(0, 10) : ""} onChange={(e) => appId && patchApp(appId, { nextFollowUp: e.target.value ? new Date(e.target.value).toISOString() : null })} disabled={!appId} style={{ border: "1px solid #dde1e8", background: "#fff", borderRadius: 9, padding: "6px 8px", font: `500 13px ${F}`, color: INK, outline: "none" }} /></label>
              </div>
              {appId ? <>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened? Logged with the date and your name" style={{ border: "1px solid #dde1e8", background: "#fff", borderRadius: 9, padding: "8px 10px", font: `500 13px ${F}`, color: INK, outline: "none" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Who sent it?" style={{ border: "1px solid #dde1e8", background: "#fff", borderRadius: 9, padding: "8px 10px", font: `500 13px ${F}`, color: INK, outline: "none", width: 150 }} />
                  <Lbl>Log</Lbl>
                  {["whatsapp", "email", "text", "note"].map((ch) => <button key={ch} onClick={() => logTouch(ch)} disabled={busy} style={{ border: "1px solid #dde1e8", background: "#fff", color: "#3b4657", borderRadius: 9, padding: "7px 12px", font: `600 12.5px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>+ {CHIP[ch]}</button>)}
                </div>
              </> : <span style={{ font: `500 12px ${F}`, color: MUT }}>No ambassador application linked — activity log is for owner-linked accounts.</span>}
              {touches.length > 0 && <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${LINE2}` }}>{touches.map((t, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "84px minmax(0,1fr) auto 16px", gap: 12, alignItems: "start", padding: "10px 0", borderBottom: `1px solid #f6f7f9` }}>
                  <span style={{ justifySelf: "start", font: `700 10.5px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 7, background: BG, color: SUB }}>{CHIP[t.ch] || t.ch}</span>
                  <span style={{ font: `500 13px/1.45 ${F}`, color: INK }}>{t.text}</span>
                  <span style={{ font: `500 11.5px ${F}`, color: MUT, whiteSpace: "nowrap" }}>{t.by || "—"} · {fmtD(t.at)}</span>
                  <button onClick={() => appId && patchApp(appId, { removeTouch: t.at })} title="Delete" style={{ border: "none", background: "none", color: MUT, font: `700 13px ${F}`, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
                </div>
              ))}</div>}
            </Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <Card pad="14px">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Lbl>Connections</Lbl>{d30 != null && <span style={{ marginLeft: "auto", font: `700 12px ${F}`, color: d30 >= 0 ? GREEND : REDD }}>{d30 >= 0 ? "+" : ""}{d30} / 30d</span>}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><Lbl>Joined LinkedIn</Lbl><input type="month" value={joined} onChange={(e) => setJoined(e.target.value)} style={{ border: `1px solid ${joinIsEstimate ? "#f1d9a6" : "#dde1e8"}`, background: joinIsEstimate ? "#fffbf2" : "#fff", borderRadius: 9, padding: "8px 10px", font: `500 13px ${F}`, color: INK, outline: "none", minWidth: 0 }} />{joinIsEstimate && <span style={{ font: `600 10px ${F}`, color: AMBER }}>≈ estimated from {ageStr(r)} age · Save to confirm</span>}</label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><Lbl>Connections now</Lbl><input value={connVal} onChange={(e) => setConnVal(e.target.value)} inputMode="numeric" style={{ border: "1px solid #dde1e8", background: "#fff", borderRadius: 9, padding: "8px 10px", font: `500 13px ${F}`, color: INK, outline: "none", minWidth: 0 }} /></label>
                </div>
                <button onClick={saveOwnerConn} disabled={busy || !connDirty} style={{ border: "1px solid #dde1e8", background: "#fff", color: INK, borderRadius: 9, padding: 8, font: `700 12.5px ${F}`, cursor: connDirty ? "pointer" : "default", opacity: connDirty ? 1 : 0.5 }}>{connDirty ? "Save to inventory" : "✓ Saved"}</button>
                {connLog.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 5, borderTop: `1px solid ${LINE2}`, paddingTop: 10 }}>{connLog.map((c, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "96px 56px minmax(0,1fr)", gap: 8, font: `500 12.5px ${F}`, color: SUB }}><span style={{ color: MUT }}>{fmtDY(c.at)}</span><b style={{ color: INK, fontFamily: G }}>{c.count}</b>{c.delta != null && c.delta !== 0 && <span style={{ color: c.delta > 0 ? GREEND : REDD, fontWeight: 600 }}>{c.delta > 0 ? "+" : ""}{c.delta}</span>}</div>
                ))}</div>}
              </Card>
              <Card pad="14px">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Lbl>Restriction history</Lbl><span style={{ marginLeft: "auto", font: `700 12px ${F}`, color: rCnt ? REDD : GREEND }}>{rCnt ? `${rCnt} restriction${rCnt === 1 ? "" : "s"}` : "clean"}</span></div>
                {rh.length > 0 ? <div style={{ display: "flex", flexDirection: "column", gap: 5, borderTop: `1px solid ${LINE2}`, paddingTop: 10 }}>{rh.map((h, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "96px 86px minmax(0,1fr)", gap: 8, font: `500 12.5px ${F}`, color: SUB }}><span style={{ color: MUT }}>{fmtDY(h.at)}</span><b style={{ color: h.event === "recovered" ? GREEND : REDD }}>{h.event === "recovered" ? "Recovered" : "Restricted"}</b><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h.note || ""}>{h.note || (h.creditedDays ? `+${h.creditedDays}d credit` : "—")}</span></div>
                ))}</div> : <span style={{ font: `500 12.5px ${F}`, color: MUT }}>Never restricted.</span>}
              </Card>
            </div>
          </div>
        );
      })()}

      {tab === "overview" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
            <Card span={2}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><Lbl>Connections</Lbl><span style={{ marginLeft: "auto", font: `600 11px ${F}`, color: MUT }}>recent</span></div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "none" }}>
                  <span style={{ font: `700 24px ${G}`, color: INK }}>{r.connectionCount}</span>
                  {spark.d30 != null && <span style={{ font: `700 12px ${F}`, color: spark.d30 >= 0 ? GREEND : REDD }}>{spark.d30 >= 0 ? "+" : ""}{spark.d30} / 30d</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {spark.line ? <svg viewBox="0 0 240 48" preserveAspectRatio="none" style={{ width: "100%", height: 48, display: "block" }}><polygon points={spark.area} fill="#e8f0fe" /><polyline points={spark.line} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg> : <span style={{ font: `500 12px ${F}`, color: MUT }}>No history yet — fills as checks are logged.</span>}
                </div>
              </div>
            </Card>
            <Card><Lbl>Restrictions</Lbl><span style={{ font: `700 24px ${G}`, color: rCnt ? REDD : INK }}>{rCnt}</span><span style={{ font: `600 12px ${F}`, color: SUB }}>{r.restrictedAt ? "currently restricted" : rCnt ? "recovered" : "clean record"}</span></Card>
            <Card><Lbl>Earned, all-time</Lbl><span style={{ font: `700 24px ${G}`, color: INK }}>{money(Math.round(r.earnedTotal || 0))}</span><span style={{ font: `600 12px ${F}`, color: SUB }}>gross collected</span></Card>
            <Card><Lbl>Utilisation</Lbl><span style={{ font: `700 24px ${G}`, color: INK }}>{Math.round((r.utilisation || 0) * 100)}%</span><span style={{ height: 4, borderRadius: 4, background: LINE2, overflow: "hidden", display: "block", margin: "2px 0" }}><span style={{ display: "block", height: "100%", width: `${Math.round((r.utilisation || 0) * 100)}%`, background: GREEN }} /></span><span style={{ font: `600 12px ${F}`, color: SUB }}>rented, lifetime</span></Card>
          </div>
          <div style={{ marginTop: 10 }}>
          <Card>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><Lbl>History</Lbl><span style={{ font: `600 11px ${F}`, color: MUT }}>newest first</span></div>
            {events.length === 0 ? <span style={{ font: `500 12.5px ${F}`, color: MUT }}>No events recorded yet.</span> : <div style={{ display: "flex", flexDirection: "column" }}>{events.map((e, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "62px 14px minmax(0,1fr)", gap: 10 }}>
                <span style={{ font: `600 11.5px/1.5 ${F}`, color: MUT, textAlign: "right", padding: "1px 0 12px" }}>{fmtD(e.at)}</span>
                <span style={{ position: "relative", display: "flex", justifyContent: "center" }}><span style={{ position: "absolute", top: 0, bottom: 0, width: 2, background: LINE2 }} /><span style={{ position: "relative", marginTop: 5, width: 10, height: 10, borderRadius: "50%", background: e.dot, boxShadow: "0 0 0 3px #fff" }} /></span>
                <div style={{ minWidth: 0, paddingBottom: 12 }}><div style={{ font: `700 13px/1.5 ${F}`, color: INK }}>{e.t}</div>{e.s && <div style={{ font: `500 12px/1.45 ${F}`, color: SUB }}>{e.s}</div>}</div>
              </div>
            ))}</div>}
          </Card>
          </div>
        </>
      )}
    </div>
  );
}
