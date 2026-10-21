"use client";

import { AccountNotes } from "@/components/admin/account-notes";
import { Fragment, useEffect, useMemo, useState } from "react";
import { isReferralEarned, isReferralOnboarded, isReferralReadyToPay, isReferralHeld, referralMaturesAt, referralCommissionAmount } from "@/lib/referrals";
import { type Currency, CURRENCY_CONFIG, formatMoney, referralCurrency } from "@/lib/referral-currency";

// A single ambassador application, reduced to what the referral roll-up needs.
interface App {
  accountId?: string | null;
  accountNotes?: string | null;
  outreachLog?: Array<{ ch: string; text: string; at: string }> | null;
  fullName: string;
  referredBy: string | null;
  status: string;
  verifiedAt?: string | null;
  accountIssue?: string | null;
  onboardedAt?: string | null;
  // "Onboarded" for referral purposes means the setup fee is PAID (see isReferralOnboarded).
  paidAt?: string | null;
  monthlyPayouts?: unknown;
  referralSource?: string | null;
  onboardingMethod?: string | null;
  onboardingVerified?: boolean | null;
  accountFreshness?: string | null;
  createdAt?: string | null;
  referralHoldReason?: string | null;
}

interface RefContact { method: string; handle: string; preferred?: boolean }
interface Referrer { id: string; slug: string; token: string; name: string; type: string; channel: string | null; assignedDay: string | null; assignedLocation: string | null; contactMethod: string | null; contactHandle: string | null; contacts: RefContact[] | null; email: string | null; paymentMethod: string | null; paymentDetails: string | null; paymentName: string | null; }

const F_SANS = "var(--font-sans),system-ui,sans-serif";
const F_GRO = "var(--font-grotesk),system-ui,sans-serif";

// ---- Printable field-day collateral (shared by cards + flyers) ----
// One B&W card design, authored at 105mm x 148.5mm (a quartered A4). Cards print
// 4-up on A4; the flyer is the same card scaled up to fill a single A5 sheet.
// Every copy carries the marketer's own /r/ link + QR, so each print is unique.
const CARD_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">`;
// Wait for QR images + web fonts before printing, so nothing prints half-loaded.
const PRINT_BOOT = `<script>window.addEventListener('load',function(){var imgs=[].slice.call(document.images);Promise.all(imgs.map(function(im){return im.complete?1:new Promise(function(res){im.onload=im.onerror=res;});})).then(function(){return (document.fonts&&document.fonts.ready)||1;}).then(function(){setTimeout(function(){window.print();},250);});});<\/script>`;
const RESET_CSS = `*{box-sizing:border-box;margin:0;padding:0}html,body{margin:0;padding:0}body{font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}`;
const CARD_CSS = `.card{position:relative;border:0.3mm dashed #b6b6b6;padding:16px 17px 14px;display:flex;flex-direction:column;background:#fff;color:#000;overflow:hidden}.brandrow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:11px}.brand{font:700 13px 'Space Grotesk';color:#000}.badge{font:700 7.5px 'Plus Jakarta Sans';letter-spacing:.04em;text-transform:uppercase;color:#000;border:1px solid #000;border-radius:999px;padding:3px 8px}.hl{font:700 23px/1.02 'Space Grotesk';color:#000;margin:0 0 6px;letter-spacing:-.02em}.lead{font:500 10.5px/1.4 'Plus Jakarta Sans';color:#333;margin:0 0 12px}.tiles{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:13px}.tile{border:1.4px solid #000;border-radius:9px;padding:8px 4px;text-align:center}.tile.dark{background:#000}.tile b{display:block;font:700 14px/1 'Space Grotesk';color:#000}.tile.dark b{color:#fff}.tile span{display:block;font:600 8px 'Plus Jakarta Sans';color:#555;margin-top:3px}.tile.dark span{color:#cfcfcf}.exp{display:flex;flex-direction:column;gap:7px;margin-bottom:12px}.exp div{font:500 9px/1.35 'Plus Jakarta Sans';color:#333}.exp b{font-weight:700;color:#000}.sect{font:700 8px 'Plus Jakarta Sans';letter-spacing:.06em;text-transform:uppercase;color:#000;margin-bottom:8px}.sect.sm{font-size:7.5px;letter-spacing:.07em;margin-bottom:6px}.steps{display:flex;flex-direction:column;gap:7px;margin-bottom:11px}.step{display:flex;gap:8px;align-items:flex-start}.num{width:15px;height:15px;border-radius:999px;background:#000;color:#fff;font:700 8.5px 'Space Grotesk';display:flex;align-items:center;justify-content:center;flex:none;margin-top:1px}.st{font:500 9.5px/1.25 'Plus Jakarta Sans';color:#1a1a1a}.st b{font-weight:700;color:#000}.whygrid{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-bottom:7px}.why{display:flex;gap:5px;align-items:flex-start}.why i{font:700 8.5px 'Plus Jakarta Sans';line-height:1.2;flex:none;font-style:normal}.why span{font:500 8.5px/1.2 'Plus Jakarta Sans';color:#1a1a1a}.note{font:600 8px 'Plus Jakarta Sans';color:#444;margin-bottom:6px}.signup{margin-top:auto;border-top:1px solid #000;padding-top:12px;display:flex;align-items:center;gap:13px}.qr{width:82px;height:82px;flex:none;border:1px solid #000;padding:4px;background:#fff}.su-head{font:700 15px/1 'Space Grotesk';color:#000;margin-bottom:5px}.su-or{font:500 9px 'Plus Jakarta Sans';color:#555;margin-bottom:2px}.su-url{font:700 10.5px/1.2 'Plus Jakarta Sans';color:#000;word-break:break-all;margin-bottom:5px}.su-more{font:500 9px 'Plus Jakarta Sans';color:#333;margin-bottom:6px}.su-more b{font-weight:700;color:#000}.su-ref{font:500 8.5px 'Plus Jakarta Sans';color:#555}.su-ref b{font-weight:700;color:#000}`;
// One card's markup, carrying this marketer's /r/ link + QR.
const cardMarkup = (origin: string, r: { slug: string; name: string }) => {
  const link = `${origin}/r/${r.slug}`;
  const shortLink = link.replace(/^https?:\/\//, "");
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=0&data=${encodeURIComponent(link)}`;
  return `<div class="card">
    <div class="brandrow"><span class="brand">&#10022; LinkedVelocity</span><span class="badge">For students &amp; professionals</span></div>
    <h1 class="hl">Get paid for your LinkedIn</h1>
    <p class="lead">Earn every month just by lending us your account. It stays yours &mdash; take it back anytime after a light 6-month minimum.</p>
    <div class="tiles">
      <div class="tile"><b>&#8369;1,000</b><span>to start</span></div>
      <div class="tile dark"><b>&#8369;500</b><span>every month</span></div>
      <div class="tile"><b>&#8776;&#8369;7k</b><span>first year</span></div>
    </div>
    <div class="exp">
      <div><b>What it is &mdash; </b>LinkedVelocity pays you to lend your LinkedIn to vetted businesses that use it for professional outreach.</div>
      <div><b>Why your LinkedIn &mdash; </b>Real, established profiles perform far better than brand-new ones, so we pay to borrow yours.</div>
      <div><b>What's in it for you &mdash; </b>&#8369;1,000 to start, &#8369;500 every month, zero effort &mdash; and your profile always stays yours.</div>
    </div>
    <div class="sect">How it works</div>
    <div class="steps">
      <div class="step"><span class="num">1</span><span class="st">Scan the code and sign up &mdash; takes 2 minutes.</span></div>
      <div class="step"><span class="num">2</span><span class="st">We set it up and rent it to a vetted business. Your <b>name &amp; password stay yours</b>, and we polish your photo to look professional.</span></div>
      <div class="step"><span class="num">3</span><span class="st">Get <b>&#8369;500 every month</b> &mdash; after a light 6-month minimum, take it back anytime, no penalties.</span></div>
    </div>
    <div class="sect sm">Why people say yes</div>
    <div class="whygrid">
      <div class="why"><i>&#10003;</i><span>Name &amp; photo never change</span></div>
      <div class="why"><i>&#10003;</i><span>You keep full access anytime</span></div>
      <div class="why"><i>&#10003;</i><span>Cancel anytime after a 6-month minimum</span></div>
      <div class="why"><i>&#10003;</i><span>Vetted, legitimate businesses</span></div>
      <div class="why"><i>&#10003;</i><span>Password is never shared</span></div>
      <div class="why"><i>&#10003;</i><span>Add accounts to earn more</span></div>
    </div>
    <div class="note">LinkedIn minimum age: 16, or older where local law requires &middot; paid to GCash, Maya or your bank.</div>
    <div class="signup">
      <img class="qr" src="${qr}" alt="QR"/>
      <div style="min-width:0">
        <div class="su-head">Scan to sign up</div>
        <div class="su-or">or sign up at</div>
        <div class="su-url">${shortLink}</div>
        <div class="su-more">Curious first? Learn more at <b>linkedvelocity.com</b></div>
        <div class="su-ref">Referred by <b>${r.name}</b> &middot; code <b>${r.slug}</b></div>
      </div>
    </div>
  </div>`;
};

// Commission per converted signup follows the referrer's currency (₱500 PH / $8 non-PH)
// — see lib/referral-currency. A referrer's currency is keyed off their slug (which is
// what `referredBy` stores). rateFor/curFor resolve it from the row's referredBy key.
const curFor = (referredBy: string) => referralCurrency(referredBy);
// A referrer is "top" once this many of their signups convert.
const TOP_THRESHOLD = 5;

// "Onboarded" = the setup fee is PAID (or status "onboarded"), NOT merely logged in.
// onboarded_at is the login moment (pipeline Level 3) and does NOT count. See isReferralOnboarded.
const isOnboarded = (a: App) => isReferralOnboarded(a);
// "Converted" = a SUCCESSFUL onboarding. An account that's onboarded but currently
// sidelined by an account issue (restricted / can't log in) is NOT a real conversion, so
// it doesn't inflate the count, the % or what's owed. Exception: if the referrer was
// already confirmed-to-pay on it (earned), it stays counted so the total never drops below
// what's already been paid out — mirrors the "earned is permanent" rule in isReferralEarned.
const isConverted = (a: App) => isOnboarded(a) && (!a.accountIssue || isReferralEarned(a));

// A commission is "ready" only once the account passes its stability check
// (marked good-to-go on the ambassador card, after the 3-day / 1-week hold).

const initialsOf = (name: string) => { const p = (name || "?").trim().split(/\s+/); return (p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase() || "?"; };
// Money totals span referrers of different currencies, which can't be summed — render
// each currency present, joined by " · " (e.g. "₱2,500 · $16").
const fmtByCur = (rec: Record<Currency, number>) =>
  (["PHP", "USD"] as Currency[]).filter((c) => rec[c] > 0).map((c) => formatMoney(rec[c], c)).join(" · ") || formatMoney(0, "PHP");

interface Row {
  name: string; initials: string; signups: number; converted: number; currency: Currency;
  isTop: boolean; active: boolean; convRate: string; earned: number; owed: number;
  readyOwed: number; heldOwed: number; pool: "ortus" | "apex" | null;
}

interface Payout {
  id: string; referrerId: string; type: string; description: string | null; amount: number;
  method: string | null; reference: string | null; paidAt: string | null; paidBy: string | null;
  notifiedAt: string | null;
  confirmedAt: string | null; confirmedBy: string | null;
  referrer: { id: string; name: string; slug: string; paymentMethod: string | null; paymentDetails: string | null };
}

const PAYOUT_TYPES: [string, string][] = [
  ["day_rate", "Field day rate"],
  ["commission", "Signup commission"],
  ["bonus", "Bonus"],
  ["other", "Other"],
];

// Pool referrer grouping (Ortus / Apex) — order, labels, badge colours, tooltip.
const poolRank = (p: "ortus" | "apex" | null) => (p === "ortus" ? 0 : p === "apex" ? 1 : 2);
const POOL_META: Record<"ortus" | "apex", { label: string; bg: string; fg: string; badge: string; note: string }> = {
  ortus: { label: "Ortus referrers", bg: "#f5f3ff", fg: "#6d28d9", badge: "◆ Ortus", note: "Ortus referrer — onboards land in the Ortus inventory (owned by info@ortus.solutions), not the main catalogue." },
  apex: { label: "Apex referrers", bg: "#e0f2fe", fg: "#0369a1", badge: "◆ Apex", note: "Apex referrer — onboards land in the Apex inventory (owned by info@apexstrategy.io), not the main catalogue." },
};

const CHIPS: [string, string, string | null][] = [
  ["all", "All", null],
  ["top", "Top performers", "var(--green)"],
  ["owed", "Has unpaid", "var(--warn-num)"],
  ["inactive", "Inactive", "var(--muted2)"],
];

export default function AdminReferralsPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState("all");
  const [query, setQuery] = useState("");
  const [refApplied, setRefApplied] = useState(false);
  // Deep-link focus: the referrer to open on load, tracked by ID (not name) so it
  // survives the row being renamed slug↔display-name when applications load in.
  const [focusRefId, setFocusRefId] = useState<string | null>(null);
  const [referrers, setReferrers] = useState<Referrer[]>([]);
  const [visibleCount, setVisibleCount] = useState(20);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", type: "marketer", channel: "", assignedDay: "", assignedLocation: "" });
  const [creating, setCreating] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dForm, setDForm] = useState<{ email: string; contacts: RefContact[]; preferred: number; paymentMethod: string; paymentDetails: string; paymentName: string }>({ email: "", contacts: [{ method: "WhatsApp", handle: "" }], preferred: 0, paymentMethod: "GCash", paymentDetails: "", paymentName: "" });
  const [dSaving, setDSaving] = useState(false);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [pForm, setPForm] = useState({ referrerId: "", type: "day_rate", amount: "", description: "" });
  const [pBusy, setPBusy] = useState("");
  const [paidDates, setPaidDates] = useState<Record<string, string>>({});
  const [today, setToday] = useState("");
  const [expandedRef, setExpandedRef] = useState<Set<string>>(new Set());
  const [refEdit, setRefEdit] = useState<string | null>(null);
  const toggleRef = (name: string) => setExpandedRef((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  const reloadPayouts = () => fetch("/api/admin/payouts").then((r) => r.json()).then((d) => setPayouts(d.payouts || [])).catch(() => {});

  useEffect(() => {
    fetch("/api/admin/ambassadors").then((r) => r.json()).then((d) => setApps(d.applications || [])).finally(() => setLoading(false));
    fetch("/api/admin/referrers").then((r) => r.json()).then((d) => setReferrers(d.referrers || [])).catch(() => {});
    reloadPayouts();
    // Local YYYY-MM-DD for the date inputs (client-only to avoid hydration mismatch).
    const n = new Date();
    setToday(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`);
  }, []);

  // Deep-link: /admin/referrals?ref=<slug> (from the pipeline "View referrer →" button)
  // focuses the search on that referrer once the registry has loaded. Applied once.
  useEffect(() => {
    if (refApplied || typeof window === "undefined" || !referrers.length) return;
    const slug = new URLSearchParams(window.location.search).get("ref");
    if (!slug) { setRefApplied(true); return; }
    const match = referrers.find((x) => x.slug.toLowerCase() === slug.toLowerCase() || x.name.toLowerCase() === slug.toLowerCase());
    if (match) {
      // Focus this referrer by ID — the directory row is named by slug when the
      // referrer has signups but by display-name when they don't, so a name/query
      // match is unreliable. Show everyone (no pagination), expand + open its
      // Details editor, and the scroll effect below brings it into view.
      setTier("all");
      setVisibleCount(9999);
      setFocusRefId(match.id);
      openDetails(match);
    }
    setRefApplied(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referrers, refApplied]);

  // Once a referrer is focused (deep-link), scroll its row into view and flash it.
  // Re-runs when the row set changes (applications load in and rename the row).
  useEffect(() => {
    if (!focusRefId || typeof document === "undefined") return;
    const t = setTimeout(() => {
      const el = document.getElementById(`refrow-${focusRefId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const prev = el.style.background;
      el.style.transition = "background .35s";
      el.style.background = "var(--chip-active-bg, rgba(10,102,194,.10))";
      setTimeout(() => { el.style.background = prev; }, 1700);
    }, 140);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRefId, referrers, apps]);

  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, { name: string; signups: number; converted: number; earned: number; ready: number; held: number }>();
    for (const a of apps) {
      const name = (a.referredBy || "").trim();
      if (!name) continue;
      // Group case-insensitively so "Franceliorah" and "franceliorah" (free-text
      // from the signup form) are one referrer, not two. Keep the nicest-cased
      // spelling for display (prefer one that isn't all-lowercase).
      const key = name.toLowerCase();
      const r = m.get(key) || { name, signups: 0, converted: 0, earned: 0, ready: 0, held: 0 };
      if (r.name === r.name.toLowerCase() && name !== name.toLowerCase()) r.name = name;
      r.signups++;
      if (isConverted(a)) {
        const commission = referralCommissionAmount(a, CURRENCY_CONFIG[curFor(name)].referralTiers);
        r.converted++;
        r.earned += commission;
        // Ready to pay only once past the maturing window; verified-but-maturing sits in hold.
        if (isReferralReadyToPay(a)) r.ready += commission;
        else r.held += commission;
      }
      m.set(key, r);
    }
    // Include every registry referrer, even those with no signups yet — otherwise a
    // freshly-added marketer (0 activity) would be invisible/unmanageable now that the
    // separate "Referral links" card is gone. Skip any already present (by slug or name)
    // to avoid duplicating one that already has attributed applications.
    for (const rf of referrers) {
      const sk = rf.slug.toLowerCase(), nk = rf.name.toLowerCase();
      if (m.has(sk) || m.has(nk)) continue;
      m.set(nk, { name: rf.name, signups: 0, converted: 0, earned: 0, ready: 0, held: 0 });
    }
    // Pool referrers (Referrer.type = "ortus" | "apex") are grouped apart from standard ones.
    const poolKeys = new Map<string, "ortus" | "apex">();
    for (const rf of referrers) if (rf.type === "ortus" || rf.type === "apex") {
      poolKeys.set(rf.slug.toLowerCase(), rf.type); poolKeys.set(rf.name.toLowerCase(), rf.type);
    }
    return [...m.values()]
      .map((r) => {
        return {
          name: r.name,
          initials: initialsOf(r.name),
          signups: r.signups,
          converted: r.converted,
          currency: curFor(r.name),
          isTop: r.converted >= TOP_THRESHOLD,
          active: r.converted > 0,
          convRate: r.signups > 0 ? Math.round((r.converted / r.signups) * 100) + "%" : "—",
          earned: r.earned,               // DIY onboarding earns twice the base rate
          owed: r.earned,                 // Phase 1: nothing paid yet, so all owed
          readyOwed: r.ready,             // hold cleared — payable now
          heldOwed: r.held,               // onboarded but still in the stability hold
          pool: poolKeys.get(r.name.toLowerCase()) ?? null,
        };
      })
      // Pool referrers first (Ortus, then Apex), then standard — each alphabetical.
      .sort((a, b) => (poolRank(a.pool) - poolRank(b.pool)) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [apps, referrers]);

  const chart = useMemo(() => {
    const withSignups = rows.filter((r) => r.signups > 0);
    const max = Math.max(1, ...withSignups.map((r) => r.signups));
    return [...withSignups].sort((a, b) => b.signups - a.signups).map((r) => ({ name: r.name, signups: r.signups, pct: Math.round((r.signups / max) * 100) }));
  }, [rows]);

  const tierOf = (r: Row) => {
    const t = ["all"];
    if (r.isTop) t.push("top");
    if (r.owed > 0) t.push("owed");
    if (!r.active) t.push("inactive");
    return t;
  };
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, top: 0, owed: 0, inactive: 0 };
    for (const r of rows) { if (r.isTop) c.top++; if (r.owed > 0) c.owed++; if (!r.active) c.inactive++; }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (tier === "all" || tierOf(r).includes(tier)) && (!q || r.name.toLowerCase().includes(q)));
  }, [rows, tier, query]);
  // Paginate the directory: 20 at a time, "show more"/"show all". A search always
  // runs across everyone (filtered already applied it), so results aren't paginated.
  const shown = useMemo(() => (query.trim() ? filtered : filtered.slice(0, visibleCount)), [filtered, query, visibleCount]);

  const totals = useMemo(() => {
    const owed: Record<Currency, number> = { PHP: 0, USD: 0 };
    const ready: Record<Currency, number> = { PHP: 0, USD: 0 };
    const held: Record<Currency, number> = { PHP: 0, USD: 0 };
    for (const r of rows) { owed[r.currency] += r.owed; ready[r.currency] += r.readyOwed; held[r.currency] += r.heldOwed; }
    return {
      active: rows.filter((r) => r.signups > 0).length,
      signups: rows.reduce((s, r) => s + r.signups, 0),
      converted: rows.reduce((s, r) => s + r.converted, 0),
      owed, ready, held,
    };
  }, [rows]);

  // referredBy is the slug (e.g. "sheila-24"); map rows to their Referrer + payouts.
  const refBySlug = useMemo(() => {
    const m = new Map<string, Referrer>();
    for (const rf of referrers) { m.set(rf.slug.toLowerCase(), rf); m.set(rf.name.toLowerCase(), rf); }
    return m;
  }, [referrers]);
  const payoutsByRef = useMemo(() => {
    const m = new Map<string, Payout[]>();
    for (const p of payouts) { const a = m.get(p.referrerId) || []; a.push(p); m.set(p.referrerId, a); }
    return m;
  }, [payouts]);
  // Ready commission not yet covered by logged commission payments.
  const refInfo = (rowName: string, readyOwed: number) => {
    const ref = refBySlug.get(rowName.toLowerCase()) || null;
    const pays = ref ? (payoutsByRef.get(ref.id) || []).slice().sort((a, b) => (b.paidAt || b.id).localeCompare(a.paidAt || a.id)) : [];
    const commissionPaid = pays.filter((p) => p.type === "commission" && p.paidAt).reduce((s, p) => s + p.amount, 0);
    const outstanding = Math.max(0, readyOwed - commissionPaid);
    return { ref, pays, commissionPaid, outstanding };
  };

  // The converted ambassadors behind a referrer's numbers — who they are and where each
  // sits (payable now vs still in the hold, and why). Drives the expanded-panel list.
  const convertedFor = (rowName: string) => {
    const nm = (rowName || "").trim().toLowerCase();
    return apps
      .filter((a) => (a.referredBy || "").trim().toLowerCase() === nm && isOnboarded(a))
      .map((a) => {
        const earned = isReferralEarned(a);
        const readyToPay = isReferralReadyToPay(a);
        const maturesAt = referralMaturesAt(a);
        const issueLabel = a.accountIssue ? (a.accountIssue === "restricted" ? "restricted" : "login issue") : null;
        // How it was onboarded + the tiered fee that drives the commission, per person, so
        // the total is auditable: Form (LV onboards) / DIY phone / DIY computer, ±verified.
        const cur = curFor(rowName);
        const fee = referralCommissionAmount(a, CURRENCY_CONFIG[cur].referralTiers);
        const method = a.referralSource === "self-service"
          ? (a.onboardingMethod === "phone" ? "You ran it · phone" : a.onboardingMethod === "computer" ? "You ran it · computer" : "You ran it") + (a.onboardingVerified ? " · verified" : "")
          : "Form · LV onboards";
        return {
          accountId: a.accountId, accountNotes: a.accountNotes, outreachLog: a.outreachLog,
          name: a.fullName || "—",
          counts: isConverted(a), // false = restricted/held-back, shown but not counted
          method, fee, cur,
          state: readyToPay ? "Ready to pay"
            : isReferralHeld(a) ? `On hold · ${a.referralHoldReason}`
            : earned ? `Maturing · until ${maturesAt ? maturesAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "the check clears"}`
            : issueLabel ? `In hold · ${issueLabel}` : "In hold · verifying",
          tone: readyToPay ? "ready" : (isReferralHeld(a) || issueLabel) ? "issue" : "hold",
          title: a.referralHoldReason || a.accountIssue || "",
        };
      })
      // ready first, then counted (verifying) above not-counted (restricted), then name
      .sort((x, y) => (x.tone === "ready" ? -1 : y.tone === "ready" ? 1 : 0) || (Number(y.counts) - Number(x.counts)) || x.name.localeCompare(y.name));
  };

  // Every referrer's converted ambassadors with how they were onboarded + the fee, for
  // computing/paying commissions in a spreadsheet.
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const out: string[] = [["Referrer", "Ambassador", "Onboarded by", "Fee", "Currency", "Status", "Counts"].join(",")];
    for (const r of rows) {
      for (const c of convertedFor(r.name)) {
        out.push([r.name, c.name, c.method, c.fee, c.cur, c.state, c.counts ? "yes" : "no"].map(esc).join(","));
      }
    }
    const blob = new Blob([out.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `referral-breakdown-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const logCommission = async (referrerId: string, amount: number, description = "Signup commission") => {
    if (!referrerId || amount <= 0) return;
    setPBusy(referrerId);
    try {
      await fetch("/api/admin/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ referrerId, type: "commission", amount, description }) });
      await reloadPayouts();
    } finally { setPBusy(""); }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const refLink = (r: Referrer) => `${origin}/become-ambassador?ref=${r.slug}`;
  const portalLink = (r: Referrer) => `${origin}/m/${r.token}`;
  // A5 flyer — the same card design scaled up to fill one A5 sheet, one per marketer.
  // Pass a single referrer to print just theirs; omit to print one sheet per marketer.
  const printFlyers = (only?: Referrer) => {
    const list = only ? [only] : referrers;
    if (!list.length) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const sheets = list.map((r) => `<div class="sheet">${cardMarkup(origin, r)}</div>`).join("");
    // Card is authored at 105x148.5mm; scale 1.409x fills an A5 sheet (148x210mm).
    const css = `${RESET_CSS}.sheet{width:148mm;height:210mm;overflow:hidden;background:#fff;page-break-after:always}.sheet .card{width:105mm;height:148.5mm;border:none;transform:scale(1.409);transform-origin:top left}${CARD_CSS}@page{size:A5;margin:0}`;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Field Day Flyers</title>${CARD_FONTS}<style>${css}</style></head><body>${sheets}${PRINT_BOOT}</body></html>`);
    win.document.close();
  };
  // B&W cards — 4 identical cards per A4 page (quartered). One full page of cuttable
  // cards per marketer, each carrying that marketer's own /r/ link + QR. Pass a single
  // referrer to print just their page; omit to print one page for every marketer.
  const printCards = (only?: Referrer) => {
    const list = only ? [only] : referrers;
    if (!list.length) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const pages = list.map((r) => `<div class="page">${cardMarkup(origin, r).repeat(4)}</div>`).join("");
    const css = `${RESET_CSS}.page{width:210mm;height:297mm;display:grid;grid-template-columns:105mm 105mm;grid-template-rows:148.5mm 148.5mm;background:#fff;page-break-after:always}${CARD_CSS}@page{size:A4;margin:0}`;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Field Day Cards</title>${CARD_FONTS}<style>${css}</style></head><body>${pages}${PRINT_BOOT}</body></html>`);
    win.document.close();
  };
  const copy = (key: string, text: string) => { navigator.clipboard?.writeText(text); setCopiedKey(key); setTimeout(() => setCopiedKey(""), 1500); };
  const addReferrer = async () => {
    if (!addForm.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/referrers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(addForm) });
      if (res.ok) { const d = await res.json(); setReferrers((prev) => [d.referrer, ...prev]); setAddForm({ name: "", type: "marketer", channel: "", assignedDay: "", assignedLocation: "" }); setShowAdd(false); }
    } finally { setCreating(false); }
  };
  const openDetails = (r: Referrer) => {
    if (detailId === r.id) { setDetailId(null); return; }
    // Seed the contact list from `contacts` if present, else fall back to the legacy
    // single contactMethod/contactHandle. Always keep at least one editable row.
    const contacts: RefContact[] = Array.isArray(r.contacts) && r.contacts.length
      ? r.contacts.map((c) => ({ method: c.method || "WhatsApp", handle: c.handle || "", preferred: !!c.preferred }))
      : (r.contactHandle ? [{ method: r.contactMethod || "WhatsApp", handle: r.contactHandle, preferred: true }] : [{ method: "WhatsApp", handle: "" }]);
    let preferred = contacts.findIndex((c) => c.preferred);
    if (preferred < 0) preferred = 0;
    // Default the payout method to the referrer's currency default (Wise for USD, GCash for PH)
    // rather than always GCash, so an overseas referrer isn't seeded a PH-only method.
    const defaultMethod = CURRENCY_CONFIG[referralCurrency(r.slug)].defaultPayoutMethod;
    setDForm({ email: r.email || "", contacts, preferred, paymentMethod: r.paymentMethod || defaultMethod, paymentDetails: r.paymentDetails || "", paymentName: r.paymentName || "" });
    setDetailId(r.id);
  };
  const saveDetails = async (r: Referrer) => {
    setDSaving(true);
    try {
      const contacts: RefContact[] = dForm.contacts
        .map((c, i) => ({ method: c.method || "WhatsApp", handle: c.handle.trim(), preferred: i === dForm.preferred }))
        .filter((c) => c.handle);
      // fall back the preferred flag to the first entry if the chosen one was blank/removed
      if (contacts.length && !contacts.some((c) => c.preferred)) contacts[0].preferred = true;
      const pref = contacts.find((c) => c.preferred) || contacts[0] || null;
      const payload = {
        email: dForm.email.trim() || null,
        contacts,
        contactMethod: pref?.method ?? null,
        contactHandle: pref?.handle ?? null,
        paymentMethod: dForm.paymentMethod,
        paymentDetails: dForm.paymentDetails,
        paymentName: dForm.paymentName.trim(),
      };
      const res = await fetch(`/api/admin/referrers/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) { setReferrers((prev) => prev.map((x) => (x.id === r.id ? { ...x, email: payload.email, contacts, contactMethod: payload.contactMethod, contactHandle: payload.contactHandle, paymentMethod: dForm.paymentMethod, paymentDetails: dForm.paymentDetails, paymentName: payload.paymentName } : x))); setDetailId(null); }
    } finally { setDSaving(false); }
  };
  const deleteReferrer = async (r: Referrer) => {
    if (!confirm(`Remove ${r.name}? Their QR/portal links stop working.`)) return;
    setReferrers((prev) => prev.filter((x) => x.id !== r.id));
    try { await fetch(`/api/admin/referrers/${r.id}`, { method: "DELETE" }); } catch {}
  };

  const addPayout = async () => {
    const amount = Number(pForm.amount);
    if (!pForm.referrerId || !Number.isFinite(amount) || amount <= 0) return;
    setPBusy("new");
    try {
      await fetch("/api/admin/payouts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pForm, amount }),
      });
      setPForm({ referrerId: "", type: "day_rate", amount: "", description: "" });
      await reloadPayouts();
    } finally { setPBusy(""); }
  };

  const patchPayout = async (id: string, body: Record<string, unknown>) => {
    setPBusy(id);
    try {
      await fetch(`/api/admin/payouts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await reloadPayouts();
    } finally { setPBusy(""); }
  };

  // A payout's currency follows its referrer's slug.
  const curOfPayout = (p: Payout) => referralCurrency(p.referrer.slug);
  const moneyOfPayout = (p: Payout) => formatMoney(p.amount, curOfPayout(p));

  const deletePayout = async (p: Payout) => {
    if (!confirm(`Delete the ${moneyOfPayout(p)} payment for ${p.referrer.name}? This can't be undone.`)) return;
    setPBusy(p.id);
    try {
      await fetch(`/api/admin/payouts/${p.id}`, { method: "DELETE" });
      await reloadPayouts();
    } finally { setPBusy(""); }
  };

  const owedTotal: Record<Currency, number> = { PHP: 0, USD: 0 };
  for (const p of payouts) if (!p.paidAt) owedTotal[curOfPayout(p)] += p.amount;
  const paidToDate: Record<Currency, number> = { PHP: 0, USD: 0 };
  for (const p of payouts) if (p.paidAt) paidToDate[curOfPayout(p)] += p.amount;
  const owedTotalSum = owedTotal.PHP + owedTotal.USD;
  const awaitingCount = payouts.filter((p) => p.paidAt && !p.confirmedAt).length;

  const label: React.CSSProperties = { font: `700 10.5px ${F_SANS}`, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--label)" };
  const th: React.CSSProperties = { font: `700 10px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--label)" };
  const chip = (active: boolean): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 999, cursor: "pointer", font: `600 12.5px ${F_SANS}`, color: "var(--text)", border: "1px solid", borderColor: active ? "var(--chip-active-border)" : "var(--card-border)", background: active ? "var(--chip-active-bg)" : "transparent" });
  const inpStyle: React.CSSProperties = { background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 8, padding: "9px 11px", font: `500 12.5px ${F_SANS}`, color: "var(--input-fg)", outline: "none" };
  const copyBtn: React.CSSProperties = { font: `600 11.5px ${F_SANS}`, color: "var(--btn-secondary-fg)", background: "var(--btn-secondary-bg)", border: "1px solid var(--btn-secondary-border)", padding: "6px 10px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" };
  const roleBadge = (t: string): React.CSSProperties => ({ font: `700 9.5px ${F_SANS}`, letterSpacing: ".03em", padding: "2px 7px", borderRadius: 5, flex: "none", textTransform: "capitalize", background: t === "ambassador" ? "var(--blue-chip-bg)" : "var(--test-bg)", color: t === "ambassador" ? "var(--blue-chip-text)" : "var(--test-fg)" });
  const tile = (labelText: string, value: string, valueColor: string, sub: string) => (
    <div style={{ background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 14, padding: "16px 18px", boxShadow: "var(--card-shadow)" }}>
      <div style={{ ...label, marginBottom: 8 }}>{labelText}</div>
      <div style={{ font: `600 24px/1 ${F_GRO}`, color: valueColor, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted)", marginTop: 6 }}>{sub}</div>
    </div>
  );

  if (loading) return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{[1, 2].map((i) => <div key={i} style={{ height: 90, borderRadius: 16, background: "var(--card)", border: "1px solid var(--card-border)" }} />)}</div>;

  return (
    <div>
      {/* title */}
      <div style={{ marginBottom: 22, maxWidth: 660 }}>
        <h1 style={{ font: `600 30px/1 ${F_GRO}`, color: "var(--text)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Referrals</h1>
        <p style={{ font: `500 13.5px/1.5 ${F_SANS}`, color: "var(--muted)", margin: 0 }}>Who&apos;s bringing in new ambassador signups. Track referral volume, see how many convert into inventory, spot your top performers to re-invite, and see commissions owed — {formatMoney(CURRENCY_CONFIG.PHP.referralTiers.referral, "PHP")}–{formatMoney(CURRENCY_CONFIG.PHP.referralTiers.computer.verified, "PHP")} per converted signup by how it&apos;s onboarded ({formatMoney(CURRENCY_CONFIG.USD.referralTiers.referral, "USD")}–{formatMoney(CURRENCY_CONFIG.USD.referralTiers.computer.verified, "USD")} for overseas referrers).</p>
      </div>

      {/* Referral links merged into the referrer directory below (each row's expanded panel). */}

      {/* summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, marginBottom: 22 }}>
        {tile("Active referrers", String(totals.active), "var(--text)", "brought ≥1 signup")}
        {tile("Total signups", String(totals.signups), "var(--accent)", `${totals.converted} converted to inventory`)}
        {tile("Commission owed", fmtByCur(totals.owed), "var(--warn-num)", `${fmtByCur(totals.ready)} ready · ${fmtByCur(totals.held)} held`)}
        {tile("Paid to date", fmtByCur(paidToDate), "var(--green)", awaitingCount ? `${awaitingCount} awaiting confirmation` : "all payments confirmed")}
      </div>

      {/* payments & receipts */}
      <div style={{ background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 14, marginBottom: 22, boxShadow: "var(--card-shadow)", overflow: "hidden" }}>
        <div onClick={() => setPayOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "15px 20px", cursor: "pointer", userSelect: "none", flexWrap: "wrap" }}>
          <span style={{ font: `600 12px ${F_SANS}`, color: "var(--muted)", width: 12, textAlign: "center", flex: "none", transition: "transform .18s ease", transform: payOpen ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
          <span style={{ font: `700 13.5px ${F_SANS}`, color: "var(--text)" }}>Payments &amp; receipts</span>
          {owedTotalSum > 0 && <span style={{ font: `600 11px ${F_SANS}`, color: "var(--warn-num)", background: "var(--tag-bg)", padding: "2px 9px", borderRadius: 999 }}>{fmtByCur(owedTotal)} to send</span>}
          {awaitingCount > 0 && <span style={{ font: `600 11px ${F_SANS}`, color: "var(--muted)", background: "var(--tag-bg)", padding: "2px 9px", borderRadius: 999 }}>{awaitingCount} awaiting confirmation</span>}
          <span style={{ font: `500 12px ${F_SANS}`, color: "var(--muted2)" }}>cash &amp; GCash — the marketer confirms receipt in their own portal</span>
        </div>

        {payOpen && (
          <div style={{ borderTop: "1px solid var(--divider)", padding: "16px 20px" }}>
            {/* add a payment */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
              <select value={pForm.referrerId} onChange={(e) => setPForm({ ...pForm, referrerId: e.target.value })} style={{ ...inpStyle, minWidth: 150 }}>
                <option value="">Who…</option>
                {referrers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select value={pForm.type} onChange={(e) => setPForm({ ...pForm, type: e.target.value })} style={{ ...inpStyle, minWidth: 150 }}>
                {PAYOUT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input value={pForm.amount} onChange={(e) => setPForm({ ...pForm, amount: e.target.value })} placeholder="Amount" inputMode="decimal" style={{ ...inpStyle, width: 110 }} />
              <input value={pForm.description} onChange={(e) => setPForm({ ...pForm, description: e.target.value })} placeholder="What it's for (e.g. Field day 1 — BGC)" style={{ ...inpStyle, flex: 1, minWidth: 200 }} />
              <button onClick={addPayout} disabled={!pForm.referrerId || !pForm.amount || pBusy === "new"} style={{ font: `600 12px ${F_SANS}`, color: "#fff", background: "var(--sheets-btn-bg)", border: "none", padding: "9px 15px", borderRadius: 8, cursor: pForm.referrerId && pForm.amount ? "pointer" : "default", opacity: pForm.referrerId && pForm.amount ? 1 : 0.5 }}>
                {pBusy === "new" ? "Adding…" : "+ Add payment"}
              </button>
            </div>

            {payouts.length === 0 ? (
              <div style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted)" }}>No payments logged yet. Add one above, mark it sent once you&apos;ve handed over the cash or sent the GCash, then the marketer confirms it from their portal — that confirmation is your receipt.</div>
            ) : payouts.map((p) => {
              const busy = pBusy === p.id;
              return (
                <div key={p.id} style={{ borderTop: "1px solid var(--divider)", padding: "12px 0", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ font: `600 13px ${F_SANS}`, color: "var(--text)", minWidth: 120 }}>{p.referrer.name}</span>
                  <span style={{ font: `600 14px ${F_GRO}`, color: "var(--text2)", fontVariantNumeric: "tabular-nums", minWidth: 70 }}>{moneyOfPayout(p)}</span>
                  <span style={{ font: `500 12px ${F_SANS}`, color: "var(--muted)", flex: 1, minWidth: 140 }}>{p.description || (PAYOUT_TYPES.find(([v]) => v === p.type)?.[1] ?? "Payment")}</span>

                  {!p.paidAt ? (
                    <>
                      <input defaultValue={p.method || "GCash"} onBlur={(e) => e.target.value !== (p.method || "") && patchPayout(p.id, { method: e.target.value })} placeholder="Cash / GCash" style={{ ...inpStyle, width: 100 }} />
                      <input defaultValue={p.reference || ""} onBlur={(e) => e.target.value !== (p.reference || "") && patchPayout(p.id, { reference: e.target.value })} placeholder="Ref no." style={{ ...inpStyle, width: 110 }} />
                      <input type="date" value={paidDates[p.id] ?? today} max={today} onChange={(e) => setPaidDates({ ...paidDates, [p.id]: e.target.value })} title="Date the payment was made" style={{ ...inpStyle, width: 140 }} />
                      <button onClick={() => patchPayout(p.id, { markPaid: true, paidAt: paidDates[p.id] ?? today })} disabled={busy} style={{ font: `600 11.5px ${F_SANS}`, color: "#fff", background: "var(--green)", border: "none", padding: "7px 12px", borderRadius: 7, cursor: "pointer" }}>{busy ? "…" : "Mark sent"}</button>
                    </>
                  ) : p.confirmedAt ? (
                    <span style={{ font: `600 11.5px ${F_SANS}`, color: "var(--green)", whiteSpace: "nowrap" }}>
                      ✓ Paid {new Date(p.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{p.method ? ` · ${p.method}` : ""} · confirmed by {p.confirmedBy} {new Date(p.confirmedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  ) : (
                    <span style={{ font: `600 11.5px ${F_SANS}`, color: "var(--warn-num)", whiteSpace: "nowrap" }}>Sent {new Date(p.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{p.method ? ` · ${p.method}` : ""} — awaiting confirmation</span>
                  )}

                  {p.paidAt && p.notifiedAt && (
                    <span title={`Receipt auto-emailed to the referrer ${new Date(p.notifiedAt).toLocaleString()}`} style={{ font: `600 10px ${F_SANS}`, color: "var(--muted)", whiteSpace: "nowrap" }}>✉ emailed</span>
                  )}
                  {p.paidAt && !p.confirmedAt && (
                    <button onClick={() => patchPayout(p.id, { markPaid: false })} disabled={busy} title="Undo — marks this as not sent" style={{ ...copyBtn, padding: "6px 9px" }}>Undo</button>
                  )}
                  {!p.confirmedAt && (
                    <button onClick={() => deletePayout(p)} disabled={busy} title="Delete this payment" style={{ ...copyBtn, padding: "6px 9px", color: "var(--warn-num)" }}>✕</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* payout schedule banner */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--band)", border: "1px solid var(--card-border)", borderRadius: 12, padding: "12px 16px", marginBottom: 22, flexWrap: "wrap" }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--accent)", flex: "none" }} />
        <span style={{ font: `600 12.5px ${F_SANS}`, color: "var(--text2)" }}>We pay out daily.</span>
        <span style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted)" }}>A commission becomes payable once the account passes its stability check (after the 3-day / 1-week hold), then it&apos;s paid out — around the same time the account owner is paid.</span>
      </div>

      {/* leaderboard */}
      <div style={{ background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 16, padding: "20px 22px", marginBottom: 22, boxShadow: "var(--card-shadow)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ font: `700 13.5px ${F_SANS}`, color: "var(--text)" }}>Signups by referrer</span>
          <span style={{ font: `500 11.5px ${F_SANS}`, color: "var(--muted2)" }}>all time</span>
        </div>
        {chart.length === 0 ? (
          <div style={{ padding: 16, font: `500 13px ${F_SANS}`, color: "var(--muted)" }}>No referred signups yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {chart.map((c) => (
              <div key={c.name} style={{ display: "grid", gridTemplateColumns: "150px 1fr 96px", gap: 14, alignItems: "center" }}>
                <span style={{ font: `600 13px ${F_SANS}`, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <div style={{ height: 22, background: "var(--track)", borderRadius: 7, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${c.pct}%`, minWidth: 6, borderRadius: 7, backgroundImage: "linear-gradient(90deg, var(--accent), var(--green))" }} />
                </div>
                <span style={{ font: `600 13px ${F_GRO}`, color: "var(--text)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{c.signups} <span style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2)" }}>signups</span></span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CHIPS.map(([key, lbl, dot]) => (
            <button key={key} onClick={() => setTier(key)} style={chip(tier === key)}>
              {dot && <span style={{ width: 7, height: 7, borderRadius: 999, background: dot }} />}
              {lbl}<span style={{ color: "var(--muted)" }}>{counts[key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input value={query} onChange={(e) => { setFocusRefId(null); setQuery(e.target.value); }} placeholder="Search referrer…" style={{ width: 240, maxWidth: "100%", background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 9, padding: "9px 12px", font: `500 13px ${F_SANS}`, color: "var(--input-fg)", outline: "none" }} />
          <button onClick={() => printCards()} disabled={!referrers.length} title="Print a 4-up card page for every marketer (one page each)" style={{ font: `600 12px ${F_SANS}`, color: "var(--btn-secondary-fg)", background: "var(--btn-secondary-bg)", border: "1px solid var(--btn-secondary-border)", padding: "9px 13px", borderRadius: 8, cursor: referrers.length ? "pointer" : "default", opacity: referrers.length ? 1 : 0.5 }}>All cards · 4/page</button>
          <button onClick={() => printFlyers()} disabled={!referrers.length} title="Print an A5 flyer for every marketer (one sheet each)" style={{ font: `600 12px ${F_SANS}`, color: "var(--btn-secondary-fg)", background: "var(--btn-secondary-bg)", border: "1px solid var(--btn-secondary-border)", padding: "9px 13px", borderRadius: 8, cursor: referrers.length ? "pointer" : "default", opacity: referrers.length ? 1 : 0.5 }}>All flyers · A5</button>
          <button onClick={exportCsv} title="Download every referrer's converted ambassadors with how each was onboarded + the fee" style={{ font: `600 12px ${F_SANS}`, color: "var(--btn-secondary-fg)", background: "var(--btn-secondary-bg)", border: "1px solid var(--btn-secondary-border)", padding: "9px 13px", borderRadius: 8, cursor: "pointer" }}>Export breakdown · CSV</button>
          <button onClick={() => setShowAdd((v) => !v)} style={{ font: `600 12px ${F_SANS}`, color: "#fff", background: "var(--sheets-btn-bg)", border: "none", padding: "9px 13px", borderRadius: 8, cursor: "pointer" }}>{showAdd ? "Cancel" : "+ Add referrer"}</button>
        </div>
      </div>

      {/* referrer list */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", borderRadius: 16, overflow: "hidden", boxShadow: "var(--panel-shadow)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 100px 120px 110px 140px 120px", gap: 14, padding: "13px 22px", borderBottom: "1px solid var(--divider)" }}>
          <span style={th}>Referrer</span>
          <span style={{ ...th, textAlign: "right" }}>Signups</span>
          <span style={{ ...th, textAlign: "right" }}>Converted</span>
          <span style={{ ...th, textAlign: "right" }}>Earned</span>
          <span style={{ ...th, textAlign: "right" }}>Owed</span>
          <span style={{ ...th, textAlign: "right" }}>Action</span>
        </div>
        {showAdd && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, padding: "14px 22px", borderBottom: "1px solid var(--divider)", background: "var(--card)" }}>
            <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Name *" style={inpStyle} />
            <select value={addForm.type} onChange={(e) => setAddForm({ ...addForm, type: e.target.value })} style={inpStyle}><option value="marketer">Marketer</option><option value="ambassador">Ambassador</option><option value="ortus">Ortus referrer</option><option value="apex">Apex referrer</option></select>
            <input value={addForm.channel} onChange={(e) => setAddForm({ ...addForm, channel: e.target.value })} placeholder="Channel (optional)" style={inpStyle} />
            <input value={addForm.assignedDay} onChange={(e) => setAddForm({ ...addForm, assignedDay: e.target.value })} placeholder="Day (optional)" style={inpStyle} />
            <input value={addForm.assignedLocation} onChange={(e) => setAddForm({ ...addForm, assignedLocation: e.target.value })} placeholder="Location (optional)" style={inpStyle} />
            <button onClick={addReferrer} disabled={creating || !addForm.name.trim()} style={{ font: `600 12.5px ${F_SANS}`, color: "#fff", background: "var(--accent)", border: "none", padding: "9px 14px", borderRadius: 9, cursor: creating || !addForm.name.trim() ? "default" : "pointer", opacity: creating || !addForm.name.trim() ? 0.6 : 1 }}>{creating ? "Creating…" : "Create + links"}</button>
          </div>
        )}
        {filtered.length === 0 ? (
          <div style={{ padding: 44, textAlign: "center", font: `500 13.5px ${F_SANS}`, color: "var(--muted)" }}>No referrers match.</div>
        ) : shown.map((r, i) => {
          // Show the pool dividers ("Ortus referrers" / "Apex referrers" / "Standard
          // referrers") only when more than one kind is present in the current view.
          const showGroupHeaders = new Set(shown.map((x) => x.pool)).size > 1;
          const firstOfGroup = i === 0 || shown[i - 1].pool !== r.pool;
          const { ref, pays, commissionPaid, outstanding } = refInfo(r.name, r.readyOwed);
          const rid = ref?.id || null;
          const open = expandedRef.has(r.name) || (!!focusRefId && rid === focusRefId);
          const busy = ref ? pBusy === ref.id : false;
          const rate = CURRENCY_CONFIG[r.currency].rate; // this referrer's commission rate
          const money = (n: number) => formatMoney(n, r.currency);
          // Mark earned people as Paid once logged commission payments cover them
          // (amount-based, matching the outstanding math). Confirmed payments settle
          // first; paid-but-unconfirmed ones show as awaiting the marketer's confirmation.
          // Match "Paid" to the actual person a commission payout names. The
          // description carries the credited ambassador name(s) — often within a
          // freeform note ("₱500 c/o Princess ... overpaid, credited to Gabriel"),
          // so we substring-match each ready ambassador's full name against the
          // paid payout descriptions rather than requiring an exact string. Only
          // generic, un-named payments fall back to amount-based slots — so the
          // badge lands on the right person, not whoever sorts first alphabetically.
          const normName = (s: string) => (s || "").trim().toLowerCase();
          const confirmedDescs: string[] = [];
          const paidDescs: string[] = [];
          let unnamedConfirmed = 0;
          let unnamedPaid = 0;
          for (const p of pays) {
            if (p.type !== "commission" || !p.paidAt) continue;
            const desc = (p.description || "").trim();
            const named = desc && desc !== "Signup commission";
            if (named) {
              const nd = normName(desc);
              paidDescs.push(nd);
              if (p.confirmedAt) confirmedDescs.push(nd);
            } else {
              unnamedPaid += p.amount;
              if (p.confirmedAt) unnamedConfirmed += p.amount;
            }
          }
          let confSlots = Math.floor(unnamedConfirmed / rate);
          let paidSlots = Math.floor(unnamedPaid / rate);
          const converted = convertedFor(r.name).map((c) => {
            if (c.tone !== "ready") return c;
            const n = normName(c.name);
            if (n && confirmedDescs.some((d) => d.includes(n))) return { ...c, state: "Paid", tone: "paid" };
            if (n && paidDescs.some((d) => d.includes(n))) return { ...c, state: "Paid · awaiting confirmation", tone: "paidpending" };
            if (confSlots > 0) { confSlots--; paidSlots--; return { ...c, state: "Paid", tone: "paid" }; }
            if (paidSlots > 0) { paidSlots--; return { ...c, state: "Paid · awaiting confirmation", tone: "paidpending" }; }
            return c;
          });
          const readyNames = converted.filter((c) => c.tone === "ready").map((c) => c.name);
          const countedConverted = converted.filter((c) => c.counts).length;
          const notCounted = converted.length - countedConverted;
          return (
            <Fragment key={r.name}>
            {showGroupHeaders && firstOfGroup && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 22px", background: r.pool ? POOL_META[r.pool].bg : "var(--subtle-bg, rgba(0,0,0,.02))", borderBottom: "1px solid var(--divider)", borderTop: i === 0 ? "none" : "1px solid var(--divider)" }}>
                <span style={{ font: `700 10.5px ${F_SANS}`, letterSpacing: ".06em", textTransform: "uppercase", color: r.pool ? POOL_META[r.pool].fg : "var(--muted)" }}>{r.pool ? POOL_META[r.pool].label : "Standard referrers"}</span>
                <span style={{ font: `600 10.5px ${F_SANS}`, color: "var(--muted2)" }}>{shown.filter((x) => x.pool === r.pool).length}</span>
              </div>
            )}
            <div id={rid ? `refrow-${rid}` : undefined} style={{ borderBottom: "1px solid var(--divider)" }}>
              <div onClick={() => toggleRef(r.name)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 100px 120px 110px 140px 120px", gap: 14, alignItems: "center", padding: "15px 22px", cursor: "pointer", userSelect: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                  <span style={{ font: `600 11px ${F_SANS}`, color: "var(--muted)", width: 10, textAlign: "center", transform: open ? "rotate(90deg)" : "none", transition: "transform .18s" }}>▸</span>
                  <div style={{ width: 38, height: 38, borderRadius: 10, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", font: `600 14px ${F_GRO}`, background: "var(--avatar-bg)", color: "var(--avatar-fg)" }}>{r.initials}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ font: `600 14px ${F_SANS}`, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ref?.name || r.name}</span>
                    {r.pool && <span title={POOL_META[r.pool].note} style={{ font: `700 9.5px ${F_SANS}`, padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap", background: POOL_META[r.pool].bg, color: POOL_META[r.pool].fg }}>{POOL_META[r.pool].badge}</span>}
                    {r.isTop && <span style={{ font: `700 9.5px ${F_SANS}`, padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap", background: "var(--st-active-bg)", color: "var(--st-active-fg)" }}>★ Top</span>}
                    {!r.active && <span style={{ font: `600 9.5px ${F_SANS}`, padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap", background: "var(--neutral-chip-bg)", color: "var(--neutral-chip-text)" }}>Inactive</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}><span style={{ font: `600 17px ${F_GRO}`, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{r.signups}</span></div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ font: `600 17px ${F_GRO}`, color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>{r.converted}</span>
                  <span style={{ font: `500 10.5px ${F_SANS}`, color: "var(--muted2)", display: "block" }}>{r.convRate}</span>
                </div>
                <div style={{ textAlign: "right" }}><span style={{ font: `600 14px ${F_GRO}`, color: "var(--text2)", fontVariantNumeric: "tabular-nums" }}>{money(r.earned)}</span></div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ font: `600 14px ${F_GRO}`, fontVariantNumeric: "tabular-nums", color: outstanding > 0 ? "var(--warn-num)" : "var(--muted2)" }}>{money(outstanding)}</span>
                  <span style={{ font: `500 10.5px ${F_SANS}`, display: "block", color: outstanding > 0 ? "var(--warn-num)" : r.heldOwed > 0 ? "var(--muted2)" : "var(--muted2)" }}>{outstanding > 0 ? "needs paying" : r.heldOwed > 0 ? "in hold" : "all settled"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <span style={{ font: `600 12px ${F_SANS}`, color: outstanding > 0 ? "var(--warn-num)" : "var(--muted)", border: "1px solid var(--btn-secondary-border)", padding: "7px 14px", borderRadius: 8, whiteSpace: "nowrap" }}>{outstanding > 0 ? `Pay ${money(outstanding)}` : "History"}</span>
                </div>
              </div>

              {open && (
                <div style={{ padding: "2px 22px 20px 63px", display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* commission + payout summary */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-end" }}>
                    <div><div style={label}>Ready to pay</div><div style={{ font: `700 16px ${F_GRO}`, color: outstanding > 0 ? "var(--green)" : "var(--muted2)", fontVariantNumeric: "tabular-nums" }}>{money(outstanding)} <span style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2)" }}>· {Math.round(outstanding / rate)} onboarded</span></div></div>
                    <div><div style={label}>In hold</div><div style={{ font: `700 16px ${F_GRO}`, color: "var(--muted2)", fontVariantNumeric: "tabular-nums" }}>{money(r.heldOwed)} <span style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2)" }}>· {Math.round(r.heldOwed / rate)} verifying</span></div></div>
                    <div><div style={label}>Paid (commission)</div><div style={{ font: `700 16px ${F_GRO}`, color: "var(--text2)", fontVariantNumeric: "tabular-nums" }}>{money(commissionPaid)}</div></div>
                    <div style={{ flex: 1 }} />
                    <div style={{ textAlign: "right" }}>
                      <div style={label}>Payout to</div>
                      <div style={{ font: `600 13px ${F_SANS}`, color: "var(--text)" }}>{ref?.paymentName || r.name}</div>
                      <div style={{ font: `500 12px ${F_SANS}`, color: ref?.paymentDetails ? "var(--text2)" : "var(--warn-num)", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{ref?.paymentDetails ? `${ref.paymentMethod || "—"} · ${ref.paymentDetails}` : "No payout details set"}</div>
                    </div>
                    {ref && outstanding > 0 && (
                      <button type="button" onClick={() => logCommission(ref.id, outstanding, readyNames.length ? readyNames.join(", ") : "Signup commission")} disabled={busy} style={{ font: `600 12.5px ${F_SANS}`, color: "#fff", background: "var(--sheets-btn-bg)", border: "none", padding: "9px 15px", borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}>+ Log {money(outstanding)} paid</button>
                    )}
                  </div>

                  {/* share, print & edit — moved here from the old Referral links card */}
                  {ref && (
                    <div>
                      <div style={{ ...label, marginBottom: 8 }}>Links, print &amp; details · ref: {ref.slug}</div>
                      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                        <button onClick={() => copy(`portal-${ref.id}`, portalLink(ref))} style={copyBtn}>{copiedKey === `portal-${ref.id}` ? "Copied ✓" : "Copy portal link"}</button>
                        <button onClick={() => copy(`ref-${ref.id}`, refLink(ref))} style={copyBtn}>{copiedKey === `ref-${ref.id}` ? "Copied ✓" : "Copy QR"}</button>
                        <button onClick={() => printCards(ref)} title={`Print a 4/page card sheet for ${ref.name} (their QR)`} style={copyBtn}>Cards · 4/page</button>
                        <button onClick={() => printFlyers(ref)} title={`Print an A5 flyer for ${ref.name} (their QR)`} style={copyBtn}>Flyer · A5</button>
                        <button onClick={() => openDetails(ref)} style={{ ...copyBtn, ...(detailId === ref.id ? { borderColor: "var(--chip-active-border)", background: "var(--chip-active-bg)" } : {}) }}>{detailId === ref.id ? "Close details" : "Edit details"}</button>
                        <button onClick={() => deleteReferrer(ref)} title="Remove referrer" style={{ ...copyBtn, color: "var(--danger)", borderColor: "var(--danger-border)" }}>✕ Remove</button>
                      </div>
                      {detailId === ref.id && (
                        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", marginTop: 12 }}>
                          {/* contacts (multiple, one preferred) + email */}
                          <div style={{ flex: "1 1 360px", minWidth: 290 }}>
                            <div style={{ font: `600 10px ${F_SANS}`, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--label)", marginBottom: 6 }}>Contact · tick the preferred one</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                              {dForm.contacts.map((c, i) => (
                                <div key={i} style={{ display: "flex", gap: 7, alignItems: "center" }}>
                                  <input type="radio" name={`pref-${ref.id}`} checked={dForm.preferred === i} onChange={() => setDForm((f) => ({ ...f, preferred: i }))} title="Preferred contact method" style={{ width: 16, height: 16, accentColor: "var(--sheets-btn-bg)", cursor: "pointer", flex: "none" }} />
                                  <select value={c.method} onChange={(e) => setDForm((f) => ({ ...f, contacts: f.contacts.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)) }))} style={{ ...inpStyle, width: 104, flex: "none" }}><option>WhatsApp</option><option>Telegram</option><option>Viber</option><option>Phone</option><option>SMS</option></select>
                                  <input value={c.handle} onChange={(e) => setDForm((f) => ({ ...f, contacts: f.contacts.map((x, j) => (j === i ? { ...x, handle: e.target.value } : x)) }))} placeholder="number / @handle" style={inpStyle} />
                                  {dForm.contacts.length > 1 && (
                                    <button type="button" onClick={() => setDForm((f) => { const contacts = f.contacts.filter((_, j) => j !== i); let preferred = f.preferred; if (preferred === i) preferred = 0; else if (preferred > i) preferred -= 1; return { ...f, contacts, preferred }; })} title="Remove this number" style={{ font: `600 15px ${F_SANS}`, color: "var(--danger)", background: "transparent", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1, flex: "none" }}>✕</button>
                                  )}
                                </div>
                              ))}
                            </div>
                            <button type="button" onClick={() => setDForm((f) => ({ ...f, contacts: [...f.contacts, { method: "WhatsApp", handle: "" }] }))} style={{ font: `600 12px ${F_SANS}`, color: "var(--sheets-btn-bg)", background: "transparent", border: "none", cursor: "pointer", padding: "7px 0 0" }}>+ Add another number</button>

                            <div style={{ font: `600 10px ${F_SANS}`, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--label)", margin: "12px 0 5px" }}>Email</div>
                            <input type="email" value={dForm.email} onChange={(e) => setDForm((f) => ({ ...f, email: e.target.value }))} placeholder="name@email.com" style={{ ...inpStyle, maxWidth: 320 }} />
                          </div>
                          {/* pay via + save */}
                          <div style={{ flex: "1 1 240px", minWidth: 220 }}>
                            <div style={{ font: `600 10px ${F_SANS}`, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--label)", marginBottom: 6 }}>Pay via</div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <select value={dForm.paymentMethod} onChange={(e) => setDForm({ ...dForm, paymentMethod: e.target.value })} style={{ ...inpStyle, width: 108, flex: "none" }}>{[...new Set([...CURRENCY_CONFIG.PHP.payoutMethods, ...CURRENCY_CONFIG.USD.payoutMethods])].map((m) => <option key={m}>{m}</option>)}</select>
                              <input value={dForm.paymentDetails} onChange={(e) => setDForm({ ...dForm, paymentDetails: e.target.value })} placeholder="account number / details" style={inpStyle} />
                            </div>
                            <input value={dForm.paymentName} onChange={(e) => setDForm({ ...dForm, paymentName: e.target.value })} placeholder="account name (registered name)" style={{ ...inpStyle, marginTop: 8 }} />
                            <button onClick={() => saveDetails(ref)} disabled={dSaving} style={{ font: `600 12.5px ${F_SANS}`, color: "#fff", background: "var(--sheets-btn-bg)", border: "none", padding: "9px 16px", borderRadius: 9, cursor: "pointer", opacity: dSaving ? 0.6 : 1, marginTop: 10 }}>{dSaving ? "Saving…" : "Save"}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* who converted — the ambassadors behind the numbers */}
                  {converted.length > 0 && (
                    <div>
                      <div style={{ ...label, marginBottom: 8 }}>Converted ambassadors · {countedConverted}{notCounted ? ` · ${notCounted} restricted (not counted)` : ""}</div>
                      {(() => {
                        const counted = converted.filter((c) => c.counts);
                        if (!counted.length) return null;
                        const byFee = new Map<number, number>();
                        let sum = 0;
                        for (const c of counted) { byFee.set(c.fee, (byFee.get(c.fee) || 0) + 1); sum += c.fee; }
                        const parts = [...byFee.entries()].sort((a, b) => a[0] - b[0]).map(([fee, n]) => `${n} × ${formatMoney(fee, counted[0].cur)}`).join("  +  ");
                        return <div style={{ font: `600 12px ${F_SANS}`, color: "var(--muted)", marginBottom: 10, fontVariantNumeric: "tabular-nums" }}>{parts} = <span style={{ color: "var(--text)" }}>{formatMoney(sum, counted[0].cur)}</span></div>;
                      })()}
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {converted.map((c, i) => {
                          const tone = c.tone === "ready" ? "var(--green)" : c.tone === "paid" ? "var(--green)" : c.tone === "issue" ? "var(--warn-num)" : c.tone === "paidpending" ? "var(--blue-chip-text)" : "var(--muted2)";
                          return (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }} title={c.title || undefined}>
                              <span style={{ width: 7, height: 7, borderRadius: 999, background: tone, flex: "none" }} />
                              <div style={{ flex: 1, minWidth: 0 }}><span style={{ font: `500 13px ${F_SANS}`, color: "var(--text)" }}>{c.name}</span>
                                {c.accountId && <details style={{ marginTop: 6 }}><summary style={{ cursor: "pointer", fontSize: 12 }}>Shared account notes</summary><AccountNotes accountId={c.accountId} notes={c.accountNotes || null} proof={null} sharedLog={c.outreachLog} onNotesSaved={notes => setApps(previous => previous.map(app => app.accountId === c.accountId ? { ...app, accountNotes: notes } : app))} onProofSaved={async () => {}} /></details>}
                              </div>
                              <span style={{ font: `500 11px ${F_SANS}`, color: "var(--muted2)", whiteSpace: "nowrap" }}>{c.method}</span>
                              <span style={{ font: `700 12px ${F_SANS}`, color: "var(--text2)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", minWidth: 52, textAlign: "right" }}>{formatMoney(c.fee, c.cur)}</span>
                              <span style={{ font: `600 11px ${F_SANS}`, color: tone, whiteSpace: "nowrap", minWidth: 96, textAlign: "right" }}>{c.state}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* payment history */}
                  <div>
                    <div style={{ ...label, marginBottom: 8 }}>Payment history</div>
                    {pays.length === 0 ? (
                      <div style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted)" }}>No payments logged yet{ref ? "" : " — this referrer isn't in the registry"}.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {pays.map((p) => {
                          const stat = !p.paidAt ? { t: "Unpaid", bg: "var(--warn-badge-bg)", fg: "var(--warn-badge-text)" } : !p.confirmedAt ? { t: "Paid · awaiting confirmation", bg: "var(--blue-chip-bg)", fg: "var(--blue-chip-text)" } : { t: `Confirmed${p.confirmedBy ? ` · ${p.confirmedBy}` : ""}`, bg: "var(--st-active-bg)", fg: "var(--st-active-fg)" };
                          const typeLabel = (PAYOUT_TYPES.find((t) => t[0] === p.type) || [null, p.type])[1];
                          const showDesc = !!p.description && p.description !== typeLabel;
                          const refIsUrl = !!p.reference && /^https?:\/\//i.test(p.reference);
                          const editingRef = refEdit === p.id;
                          return (
                            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--card)", border: "1px solid var(--divider)", borderRadius: 10, padding: "10px 13px" }}>
                              <span style={{ font: `500 12px ${F_SANS}`, color: "var(--muted2)", width: 92, flex: "none" }}>{p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ font: `700 13px ${F_GRO}`, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{money(p.amount)}</span>
                                <span style={{ font: `500 12px ${F_SANS}`, color: "var(--muted)" }}> · {typeLabel}{showDesc ? ` · ${p.description}` : ""}{p.method ? ` · ${p.method}` : ""}{p.reference && !refIsUrl ? ` · ${p.reference}` : ""}</span>
                              </div>
                              {editingRef ? (
                                <input autoFocus defaultValue={p.reference || ""} placeholder="Paste transfer link…" onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v !== (p.reference || "")) patchPayout(p.id, { reference: v }); setRefEdit(null); } else if (e.key === "Escape") setRefEdit(null); }} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.reference || "")) patchPayout(p.id, { reference: v }); setRefEdit(null); }} style={{ ...inpStyle, width: 220 }} />
                              ) : (
                                <>
                                  {refIsUrl && <a href={p.reference!} target="_blank" rel="noopener noreferrer" style={{ font: `600 11.5px ${F_SANS}`, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}>🔗 Receipt</a>}
                                  <button type="button" onClick={() => setRefEdit(p.id)} title={refIsUrl ? "Edit transfer link" : "Attach a transfer link / reference"} style={{ font: `600 11px ${F_SANS}`, color: "var(--muted2)", background: "transparent", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>{refIsUrl ? "✎" : "+ link"}</button>
                                </>
                              )}
                              <span style={{ font: `600 10.5px ${F_SANS}`, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", background: stat.bg, color: stat.fg }}>{stat.t}</span>
                              {!p.paidAt && <button type="button" onClick={() => patchPayout(p.id, { paidAt: new Date().toISOString() })} disabled={pBusy === p.id} style={{ font: `600 11.5px ${F_SANS}`, color: "var(--text)", background: "var(--btn-secondary-bg)", border: "1px solid var(--btn-secondary-border)", padding: "5px 10px", borderRadius: 7, cursor: "pointer" }}>Mark paid</button>}
                              <button type="button" onClick={() => deletePayout(p)} disabled={pBusy === p.id} title="Delete" style={{ font: `600 13px ${F_SANS}`, color: "var(--muted2)", background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            </Fragment>
          );
        })}
        {!query.trim() && filtered.length > shown.length && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: "16px 22px" }}>
            <span style={{ font: `500 12.5px ${F_SANS}`, color: "var(--muted)" }}>Showing {shown.length} of {filtered.length}</span>
            <button onClick={() => setVisibleCount((c) => c + 100)} style={{ font: `600 12px ${F_SANS}`, color: "var(--btn-secondary-fg)", background: "var(--btn-secondary-bg)", border: "1px solid var(--btn-secondary-border)", padding: "8px 14px", borderRadius: 8, cursor: "pointer" }}>Show 100 more</button>
            <button onClick={() => setVisibleCount(filtered.length)} style={{ font: `600 12px ${F_SANS}`, color: "#fff", background: "var(--sheets-btn-bg)", border: "none", padding: "8px 14px", borderRadius: 8, cursor: "pointer" }}>Show all ({filtered.length})</button>
          </div>
        )}
        {!query.trim() && visibleCount > 20 && filtered.length <= shown.length && (
          <div style={{ display: "flex", justifyContent: "center", padding: "14px 22px" }}>
            <button onClick={() => setVisibleCount(20)} style={{ font: `600 12px ${F_SANS}`, color: "var(--muted)", background: "transparent", border: "1px solid var(--btn-secondary-border)", padding: "8px 14px", borderRadius: 8, cursor: "pointer" }}>Show fewer</button>
          </div>
        )}
      </div>
    </div>
  );
}
