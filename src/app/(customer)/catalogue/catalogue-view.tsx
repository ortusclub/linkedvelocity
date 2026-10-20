"use client";

import { tierPricing } from "@/lib/account-pricing";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatNumber, formatCurrency, formatName } from "@/lib/utils";
import { toIndustryBucket } from "@/lib/industry";

interface Account {
  id: string;
  linkedinName: string;
  linkedinHeadline: string | null;
  connectionCount: number;
  industry: string | null;
  location: string | null;
  profilePhotoUrl: string | null;
  accountAgeMonths: number | null;
  hasSalesNav: boolean;
  linkedinVerified?: boolean;
  monthlyPrice: number;
  status: string;
  linkedinUrl: string | null;
  // Ortus / Apex segregated-pool accounts: shown as teasers, not rentable yet.
  availableSoon?: boolean;
}

const POP = "var(--font-poppins)", INT = "var(--font-inter)", MONO = "var(--font-jbmono)";
const TELEGRAM_URL = "https://t.me/linkedvelocity_support_bot";
const CALENDAR_URL = "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ1he_qAS5s8faJzrAIjTJi8KIX9xvPhGbC4Ipn38lPTLzkfSuoyMIiqUrB0viY2jpXr_W_zLSdq";

// Public catalogue shows at most this many accounts in total (server enforces the same
// cap in /api/accounts); the full-roster password lifts it.
const MAX_TOTAL = 20;
const FULL_KEY_STORAGE = "lv_full_roster_key";
// Selected accounts persist here so the cart survives "back to browse" / revisits
// (renters build multi-account orders across several browse sessions). Cleared on a
// completed checkout. Bumped key = ignore any older/incompatible saved cart.
const CART_KEY = "lv_cart_v1";
const AVATAR_COLORS = ["#0A66C2", "#0E7C74", "#5747C9", "#B23150", "#946011", "#067A45", "#0D1B2A", "#C2410C"];
const INDUSTRY_COLORS: Record<string, string> = { Sales: "#5747C9", Marketing: "#B23150", Technology: "#0A66C2", Operations: "#0E7C74", Finance: "#946011" };

function getAvatarColor(name: string) { return AVATAR_COLORS[(name.charCodeAt(0) + name.length) % AVATAR_COLORS.length]; }
function getInitials(name: string) { return name.replace(/\s*\(.*\)\s*$/, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase(); }
// Compact, uniform display name: "Tony Otto" -> "Tony O." (View Profile still links the full identity)
function shortName(name: string) { const p = formatName(name.replace(/\s*\(.*\)\s*$/, "")).trim().split(/\s+/).filter(Boolean); return p.length < 2 ? (p[0] || "") : `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`; }
// Account age in months -> compact label, e.g. 38 -> "3y 2m", 5 -> "5m".
function ageLabel(m: number | null | undefined) { if (!m || m <= 0) return ""; const y = Math.floor(m / 12), mo = m % 12; return y > 0 ? `${y}y${mo ? ` ${mo}m` : ""}` : `${mo}m`; }

// Tiered rental pricing by connection count + account age. Highest tier the
// profile qualifies for wins (evaluated top-down). The last tier is the FLOOR —
// every profile that doesn't reach a higher tier (incl. tiny/new ones, <30
// connections) gets the bottom rate. Never returns null.

const money = (n: number) => (n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`);
const monthlyOf = (a: Account) => tierPricing(a.connectionCount, a.accountAgeMonths, a.hasSalesNav, a.linkedinVerified).monthly;

const SORTS: Record<string, (a: Account, b: Account) => number> = {
  "conn-desc": (a, b) => b.connectionCount - a.connectionCount,
  "conn-asc": (a, b) => a.connectionCount - b.connectionCount,
  "age-desc": (a, b) => (b.accountAgeMonths || 0) - (a.accountAgeMonths || 0),
  "price-asc": (a, b) => monthlyOf(a) - monthlyOf(b),
  "price-desc": (a, b) => monthlyOf(b) - monthlyOf(a),
};

export function CatalogueView({ isArmy }: { isArmy: boolean }) {
  const router = useRouter();
  // LinkedArmy reword + accent nudge; LinkedVelocity unchanged. Status words ("Rented",
  // "Available") stay factual — only the action verb changes.
  const verb = isArmy ? "Hire" : "Rent";
  const noun = isArmy ? "operator" : "account";
  const Noun = isArmy ? "Operator" : "Account";
  const ACCENT = "#0A66C2";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("");
  const [sort, setSort] = useState("conn-desc");
  const [activeFilter, setActiveFilter] = useState("All");
  const [availFilter, setAvailFilter] = useState("All"); // All | Available | Available soon | Rented
  const [view, setView] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [myIds, setMyIds] = useState<Set<string>>(new Set()); // accounts the viewer currently rents (incl. shadow)
  const [viewerIsShadow, setViewerIsShadow] = useState(false);
  const [shadowTaken, setShadowTaken] = useState<Set<string>>(new Set()); // shadow-bought by any shadow renter
  // Public share variant: /catalogue?pricing=off hides all prices (for sharing the
  // inventory with prospects/partners without revealing rates). Default = pricing on.
  const [showPricing, setShowPricing] = useState(true);
  // Full-roster password: from ?key= in the URL or the "Show full roster" box; kept in
  // sessionStorage so filters/searches keep the unlocked view. Validated server-side only.
  const [fullList, setFullList] = useState(false);
  const [fullKeyInput, setFullKeyInput] = useState("");
  const [fullKeyError, setFullKeyError] = useState(false);
  const readFullKey = () => {
    if (typeof window === "undefined") return null;
    const fromUrl = new URLSearchParams(window.location.search).get("key");
    if (fromUrl) { try { sessionStorage.setItem(FULL_KEY_STORAGE, fromUrl); } catch { /* ignore */ } return fromUrl; }
    try { return sessionStorage.getItem(FULL_KEY_STORAGE); } catch { return null; }
  };

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => { if (d.user) setUser(d.user); }).catch(() => {});
    // Accounts the viewer currently rents (incl. shadow rentals) — badged "Rented by you".
    fetch("/api/rentals").then((r) => (r.ok ? r.json() : { rentals: [] })).then((d) => {
      const active = new Set(["active", "pending_access", "payment_failed"]);
      setMyIds(new Set<string>(((d.rentals || []) as Array<{ status: string; linkedinAccount?: { id?: string } }>).filter((rt) => active.has(rt.status)).map((rt) => rt.linkedinAccount?.id).filter((x): x is string => !!x)));
    }).catch(() => {});
    // Shadow buyers: an account already shadow-bought reads as unavailable to them.
    fetch("/api/wallet/balance").then((r) => (r.ok ? r.json() : {})).then((d: { isShadowRenter?: boolean; shadowTakenIds?: string[] }) => {
      setViewerIsShadow(!!d.isShadowRenter);
      setShadowTaken(new Set<string>(d.shadowTakenIds || []));
    }).catch(() => {});
    if (typeof window !== "undefined") setShowPricing(new URLSearchParams(window.location.search).get("pricing") !== "off");
  }, []);

  // Cart persistence (#1 of PP's fixes): restore the selection on load so going
  // "back to browse" no longer wipes it, then save on every change. Hydrate guard
  // stops the empty initial set from clobbering a saved cart before load runs.
  const cartHydrated = useRef(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CART_KEY);
      if (saved) { const ids = JSON.parse(saved); if (Array.isArray(ids) && ids.length) setSelected(new Set(ids as string[])); }
    } catch { /* private mode / blocked storage — cart just won't persist */ }
    cartHydrated.current = true;
  }, []);
  useEffect(() => {
    if (!cartHydrated.current) return;
    try { localStorage.setItem(CART_KEY, JSON.stringify([...selected])); } catch { /* ignore */ }
  }, [selected]);

  const fetchAccounts = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (industry) params.set("industry", industry);
    const key = readFullKey();
    if (key) params.set("key", key);
    const res = await fetch(`/api/accounts?${params}`);
    const data = await res.json();
    setFullList(!!data.fullList);
    if (key && !data.fullList) { setFullKeyError(true); try { sessionStorage.removeItem(FULL_KEY_STORAGE); } catch { /* ignore */ } }
    setAccounts(data.accounts || []);
    setLoading(false);
  };

  useEffect(() => { fetchAccounts(); }, [industry]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); fetchAccounts(); };
  const lockFullList = () => {
    try { sessionStorage.removeItem(FULL_KEY_STORAGE); } catch { /* ignore */ }
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("key")) {
      const u = new URL(window.location.href); u.searchParams.delete("key"); window.history.replaceState(null, "", u.toString());
    }
    setFullList(false);
    fetchAccounts();
  };
  const handleFullKey = (e: React.FormEvent) => {
    e.preventDefault();
    const k = fullKeyInput.trim();
    if (!k) return;
    setFullKeyError(false);
    try { sessionStorage.setItem(FULL_KEY_STORAGE, k); } catch { /* ignore */ }
    setFullKeyInput("");
    fetchAccounts();
  };
  const handleFilterClick = (f: string) => { setActiveFilter(f); setIndustry(f === "All" ? "" : f); };

  const toggleSelect = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleBulkRent = () => {
    if (selected.size === 0) return;
    if (!user) { router.push(`/login?message=You must sign in or sign up before you can ${verb.toLowerCase()} ${noun}s.`); return; }
    router.push(`/checkout?accounts=${Array.from(selected).join(",")}`);
  };
  const selectedTotal = accounts.filter((a) => selected.has(a.id)).reduce((s, a) => s + monthlyOf(a), 0);

  // Rentable available first, then "available soon" (Ortus/Apex pool teasers), then
  // rented — chosen sort applied within each group.
  const isRentable = (a: Account) => a.status === "available" && !a.availableSoon;
  const statusRank = (a: Account) => (isRentable(a) ? 0 : a.availableSoon ? 1 : 2);
  // Only a slice of the inventory is public (MAX_TOTAL in total, rentable first). The API
  // already enforces this (see lib/public-inventory); the client cap is belt-and-braces.
  // The full-roster password lifts it.
  const visible = useMemo(() => {
    const sorted = [...accounts].sort((a, b) => statusRank(a) - statusRank(b) || SORTS[sort](a, b));
    const capped = fullList ? sorted : sorted.slice(0, MAX_TOTAL);
    const avail = capped.filter(isRentable);
    const soon = capped.filter((a) => a.availableSoon);
    const rented = capped.filter((a) => !isRentable(a) && !a.availableSoon);
    const groups: Record<string, Account[]> = { All: [...avail, ...soon, ...rented], Available: avail, "Available soon": soon, Rented: rented };
    return groups[availFilter] || groups.All;
  }, [accounts, sort, availFilter, fullList]);
  // Bulk-select only ever covers the rentable rows actually on screen (never pool teasers).
  const rentable = visible.filter(isRentable);
  const toggleSelectAll = () => setSelected(selected.size === rentable.length && rentable.length > 0 ? new Set() : new Set(rentable.map((a) => a.id)));

  const chip = (on: boolean) => ({ cursor: "pointer", font: `${on ? 600 : 500} 13.5px ${INT}`, color: on ? "#FFFFFF" : "#3F4856", background: on ? "#0B1220" : "#FFFFFF", border: "1px solid " + (on ? "#0B1220" : "#E0E3E9"), borderRadius: 999, padding: "9px 18px", transition: "all .15s" } as const);
  const seg = (on: boolean) => ({ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", font: `600 13px ${INT}`, color: on ? "#0B1220" : "#8A93A2", background: on ? "#FFFFFF" : "transparent", border: "none", borderRadius: 8, padding: "7px 14px", boxShadow: on ? "0 1px 2px rgba(16,24,40,0.12)" : "none" } as const);

  return (
    <div style={{ fontFamily: INT, color: "#0B1220", background: "#FBFCFD", minHeight: "100vh" }}>
      <style>{`
        .cat2-wrap{max-width:1220px;margin:0 auto;padding:0 40px;}
        .cat2-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}
        .cat2-card{transition:transform .2s cubic-bezier(.2,.7,.3,1), box-shadow .2s ease, border-color .2s ease;}
        .cat2-card:hover{transform:translateY(-5px);border-color:#0A66C2!important;box-shadow:0 18px 44px rgba(10,102,194,0.28), 0 6px 16px rgba(10,102,194,0.16), 0 0 0 1px rgba(10,102,194,0.25)!important;}
        .cat2-row:hover{background:#F8FAFC;}
        input::placeholder{color:#9AA4B2;}
        @media(max-width:1040px){.cat2-grid{grid-template-columns:1fr 1fr;}}
        @media(max-width:900px){.cat2-wrap{padding:0 18px;}.cat2-grid{grid-template-columns:1fr;}.cat2-listhead,.cat2-row{grid-template-columns:28px minmax(0,2.2fr) 1fr 1.4fr!important;}.cat2-hide{display:none!important;}}
      `}</style>

      {/* header */}
      <div className="cat2-wrap" style={{ paddingTop: 44 }}>
        <div style={{ font: `500 12px ${MONO}`, letterSpacing: "0.16em", textTransform: "uppercase", color: ACCENT, marginBottom: 14 }}>Marketplace</div>
        <h1 style={{ font: `700 clamp(30px,4vw,44px) ${POP}`, lineHeight: 1.05, letterSpacing: "-0.03em", margin: "0 0 12px" }}>{isArmy ? "Browse available operators" : "Browse available accounts"}</h1>
        <p style={{ fontSize: 17, color: "#5A6473", margin: 0 }}>{isArmy ? "Verified, pre-warmed operators — ready to hire right now." : "Verified, pre-warmed profiles — ready to rent right now."}</p>
      </div>

      {/* controls */}
      <div className="cat2-wrap" style={{ paddingTop: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            {["All", "Sales", "Marketing", "Technology", "Operations", "Finance"].map((c) => (
              <button key={c} onClick={() => handleFilterClick(c)} style={chip(activeFilter === c)}>{c}</button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ appearance: "none", WebkitAppearance: "none", background: "#FFFFFF", border: "1px solid #E0E3E9", borderRadius: 10, padding: "10px 38px 10px 14px", font: `500 13.5px ${INT}`, color: "#3F4856", cursor: "pointer" }}>
                <option value="conn-desc">Most Connections</option>
                <option value="conn-asc">Fewest Connections</option>
                <option value="age-desc">Oldest Accounts</option>
                {showPricing && <option value="price-asc">Price: Low to High</option>}
                {showPricing && <option value="price-desc">Price: High to Low</option>}
              </select>
              <span style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#8A93A2", fontSize: 11 }}>▼</span>
            </div>
            <form onSubmit={handleSearch}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts…" style={{ background: "#FFFFFF", border: "1px solid #E0E3E9", borderRadius: 10, padding: "10px 14px", font: `400 13.5px ${INT}`, color: "#0B1220", width: 210 }} />
            </form>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ font: `500 11px ${MONO}`, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A93A2", marginRight: 2 }}>Availability</span>
            {["All", "Available", "Available soon", "Rented"].map((c) => (
              <button key={c} onClick={() => setAvailFilter(c)} style={chip(availFilter === c)}>{c}</button>
            ))}
          </div>
          <div style={{ display: "inline-flex", background: "#EEF1F5", borderRadius: 10, padding: 3, gap: 2 }}>
            <button onClick={() => setView("list")} style={seg(view === "list")}>▤ List</button>
            <button onClick={() => setView("grid")} style={seg(view === "grid")}>▦ Grid</button>
          </div>
        </div>
      </div>

      {/* bulk-rent bar */}
      {selected.size > 0 && (
        <div className="cat2-wrap" style={{ marginTop: 16 }}>
          <div style={{ background: ACCENT, borderRadius: 12, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", color: "#fff", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{selected.size} {noun}{selected.size > 1 ? "s" : ""} selected</span>
              {showPricing && <span style={{ fontSize: 13, opacity: 0.85 }}>Total: {formatCurrency(selectedTotal)}/mo</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setSelected(new Set())} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.3)", background: "transparent", color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: INT }}>Clear</button>
              <button onClick={handleBulkRent} style={{ padding: "6px 18px", borderRadius: 8, border: "none", background: "#fff", color: ACCENT, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: INT }}>{verb} {selected.size} {Noun}{selected.size > 1 ? "s" : ""}</button>
            </div>
          </div>
        </div>
      )}

      {/* body */}
      <div className="cat2-wrap" style={{ paddingTop: 22, paddingBottom: 8 }}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} style={{ height: 60, borderRadius: 14, background: "#EAECEF", animation: "pulse 1.5s ease-in-out infinite" }} />)}</div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#5A6473" }}>
            <p style={{ fontSize: 16, fontWeight: 500 }}>No accounts match your filters.</p>
            <p style={{ fontSize: 14, marginTop: 8 }}>Try clearing a filter or check back soon.</p>
          </div>
        ) : view === "grid" ? (
          <div className="cat2-grid">
            {visible.map((a) => <GridCard key={a.id} a={a} selected={selected.has(a.id)} onToggle={toggleSelect} showPricing={showPricing} isArmy={isArmy} />)}
          </div>
        ) : (
          <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}>
            <div className="cat2-listhead" style={{ display: "grid", gridTemplateColumns: "28px minmax(0,2.4fr) minmax(0,0.9fr) minmax(0,1.1fr) minmax(0,1.3fr) minmax(0,1fr) minmax(230px,1.6fr)", alignItems: "center", gap: 16, padding: "14px 22px", background: "#F8FAFC", borderBottom: "1px solid #EDEFF2", font: `500 11px ${MONO}`, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8A93A2" }}>
              <input type="checkbox" checked={selected.size > 0 && selected.size === rentable.length} onChange={toggleSelectAll} style={{ accentColor: "#0A66C2", cursor: "pointer" }} />
              <span>Profile</span><span className="cat2-hide">Connections</span><span className="cat2-hide">Industry</span><span className="cat2-hide">Location</span><span>Price</span><span></span>
            </div>
            {visible.map((a) => <ListRow key={a.id} a={a} selected={selected.has(a.id)} onToggle={toggleSelect} showPricing={showPricing} mine={myIds.has(a.id)} taken={viewerIsShadow && shadowTaken.has(a.id) && !myIds.has(a.id)} isArmy={isArmy} />)}
          </div>
        )}
      </div>

      {/* full-roster banner — makes the unlocked state obvious and lets you drop back to the public view */}
      {!loading && fullList && (
        <div className="cat2-wrap" style={{ marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "#FFF7E6", border: "1px solid #F3D9A4", borderRadius: 12, padding: "12px 18px" }}>
            <span style={{ font: `600 13.5px ${INT}`, color: "#7A4B00" }}>Full roster unlocked — you&apos;re seeing every account, not the public selection.</span>
            <button onClick={lockFullList} style={{ border: "1px solid #7A4B00", background: "transparent", color: "#7A4B00", borderRadius: 8, padding: "7px 12px", font: `600 13px ${INT}`, cursor: "pointer" }}>Back to public view</button>
          </div>
        </div>
      )}
      {/* inventory gate — the catalogue only ever shows a slice of the roster */}
      {!loading && accounts.length > 0 && !fullList && (
        <div className="cat2-wrap" style={{ marginTop: 18 }}>
          <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "26px 32px", textAlign: "center" }}>
            <h3 style={{ font: `700 19px ${POP}`, color: "#0B1220", margin: "0 0 6px" }}>There&apos;s more where these came from</h3>
            <p style={{ fontSize: 14, color: "#5A6473", lineHeight: 1.5, maxWidth: 480, margin: "0 auto 18px" }}>
              This is only a selection of our roster — we have plenty of other accounts. Get in touch and we&apos;ll send you the full list to choose from, matched to your industry, region and connection size.
            </p>
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", borderRadius: 10, background: ACCENT, color: "#fff", fontSize: 14.5, fontWeight: 600, textDecoration: "none" }}>Get in touch with one of our agents →</a>
            <form onSubmit={handleFullKey} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 18, paddingTop: 16, borderTop: "1px solid #EEF1F5" }}>
              <span style={{ fontSize: 13, color: "#8A93A2" }}>Already have a password from us?</span>
              <input type="password" value={fullKeyInput} onChange={(e) => setFullKeyInput(e.target.value)} placeholder="Full roster password" autoComplete="off" style={{ border: "1px solid " + (fullKeyError ? "#B23150" : "#E0E3E9"), borderRadius: 8, padding: "8px 12px", font: `500 13px ${INT}`, width: 190 }} />
              <button type="submit" style={{ border: "1px solid #0B1220", background: "#0B1220", color: "#fff", borderRadius: 8, padding: "8px 14px", font: `600 13px ${INT}`, cursor: "pointer" }}>Show full roster</button>
              {fullKeyError && <span style={{ fontSize: 12.5, color: "#B23150", width: "100%" }}>That password didn&apos;t work.</span>}
            </form>
          </div>
        </div>
      )}

      {/* logged-out gate */}
      {!loading && !user && (
        <div className="cat2-wrap" style={{ marginTop: 24 }}>
          <div style={{ background: "#fff", border: "1px solid #E9ECF0", borderRadius: 16, padding: "28px 32px", textAlign: "center" }}>
            <h3 style={{ font: `700 20px ${POP}`, color: "#0B1220", marginBottom: 6 }}>{isArmy ? "Ready to hire?" : "Ready to rent?"}</h3>
            <p style={{ fontSize: 14, color: "#5A6473", marginBottom: 18, maxWidth: 460, margin: "0 auto 18px", lineHeight: 1.5 }}>Create a free account to {verb.toLowerCase()} any of these profiles — it only takes a minute.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/register" style={{ padding: "11px 22px", borderRadius: 10, background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Create free account</Link>
              <Link href="/login" style={{ padding: "11px 22px", borderRadius: 10, background: "#EEF1F5", color: "#0B1220", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Sign in</Link>
            </div>
          </div>
        </div>
      )}

      {/* dark CTA */}
      {!loading && accounts.length > 0 && (
        <div className="cat2-wrap" style={{ marginTop: 36, paddingBottom: 64 }}>
          <div style={{ background: "radial-gradient(130% 150% at 12% 0%, #12305F 0%, #0A1826 65%)", borderRadius: 20, padding: "40px 44px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 28, flexWrap: "wrap" }}>
            <div style={{ maxWidth: 560 }}>
              <div style={{ font: `500 11px ${MONO}`, letterSpacing: "0.16em", textTransform: "uppercase", color: "#7FA8E0", marginBottom: 10 }}>Need a hand?</div>
              <div style={{ font: `700 27px ${POP}`, color: "#fff", marginBottom: 8, letterSpacing: "-0.01em" }}>Looking for something specific?</div>
              <p style={{ fontSize: 15.5, lineHeight: 1.55, color: "#AFC0D6", margin: 0 }}>Book a quick call and we&apos;ll match you to the right account for your campaign.</p>
            </div>
            <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "#fff", color: "#0B1220", fontSize: 15, fontWeight: 600, padding: "14px 24px", borderRadius: 12, whiteSpace: "nowrap", textDecoration: "none" }}>Book a Meeting →</a>
          </div>
        </div>
      )}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}

function StatusBadge({ rented, mine, taken, soon }: { rented: boolean; mine?: boolean; taken?: boolean; soon?: boolean }) {
  if (soon) return (
    <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: "4px 11px", color: "#6D28D9", background: "#EDE9FE" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#7C3AED" }} />Available soon
    </span>
  );
  if (taken) return (
    <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: "4px 11px", color: "#6B7280", background: "#F1F3F5" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#9AA0A6" }} />Shadow-taken
    </span>
  );
  if (mine) return (
    <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: "4px 11px", color: "#0A66C2", background: "#EAF2FC" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#0A66C2" }} />Rented by you
    </span>
  );
  return (
    <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: "4px 11px", color: rented ? "#946011" : "#067A45", background: rented ? "#FBF0DA" : "#E4F6EC" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: rented ? "#E0A43B" : "#00B85C" }} />{rented ? "Rented" : "Available"}
    </span>
  );
}

function Verified() {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 600, color: "#0A66C2", background: "#EAF2FC", borderRadius: 6, padding: "2px 7px" }}>✓ Verified</span>;
}

function IndustryTag({ industry }: { industry: string }) {
  const label = toIndustryBucket(industry) || industry;
  const c = INDUSTRY_COLORS[label] || "#0A66C2";
  return <span style={{ font: `500 11px ${MONO}`, letterSpacing: "0.04em", color: c, background: c + "14", borderRadius: 6, padding: "4px 9px" }}>{label}</span>;
}

function Actions({ a, isArmy }: { a: Account; isArmy: boolean }) {
  const soon = !!a.availableSoon;
  const isAvailable = a.status === "available" && !soon;
  const verb = isArmy ? "Hire" : "Rent";
  const viewStyle = { fontSize: 13, fontWeight: 600, color: "#0A66C2", background: "#EAF2FC", borderRadius: 9, padding: "9px 13px", textDecoration: "none", whiteSpace: "nowrap" } as const;
  // Pool teasers 404 on the account-detail page, so only link out to the real LinkedIn
  // profile when we have a URL — otherwise drop the View action for them.
  const view = a.linkedinUrl ? (
    <a href={a.linkedinUrl.startsWith("http") ? a.linkedinUrl : `https://${a.linkedinUrl}`} target="_blank" rel="noopener noreferrer" style={viewStyle}>View</a>
  ) : soon ? null : (
    <Link href={`/account/${a.id}`} style={viewStyle}>View</Link>
  );
  return (
    <>
      {view}
      {isAvailable ? (
        <Link href={`/account/${a.id}`} style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: "#00A150", borderRadius: 9, padding: "9px 17px", textDecoration: "none", whiteSpace: "nowrap" }}>{verb}</Link>
      ) : soon ? (
        // "Available soon" is already shown by the status badge (list) / corner tag
        // (grid) — no second action pill, which kept overflowing onto the price column.
        null
      ) : (
        <span style={{ fontSize: 13, fontWeight: 600, color: "#96A0AD", background: "#F2F4F7", borderRadius: 9, padding: "9px 15px", whiteSpace: "nowrap" }}>Rented</span>
      )}
    </>
  );
}

// Shows the tiered weekly / monthly / daily price (monthly headline, wk + day
// underneath). Falls back to the stored price when a profile fits no tier.
function PriceBlock({ a, showPricing, compact }: { a: Account; showPricing: boolean; compact?: boolean }) {
  if (!showPricing) return <span style={{ fontSize: compact ? 12.5 : 14, color: "#96A0AD", fontWeight: 600 }}>{compact ? "On request" : "Price on request"}</span>;
  const t = tierPricing(a.connectionCount, a.accountAgeMonths, a.hasSalesNav, a.linkedinVerified);
  return (
    <div style={{ lineHeight: 1.25 }}>
      <div><span style={{ font: `700 ${compact ? 15 : 20}px ${POP}`, color: "#0B1220" }}>{money(t.monthly)}</span><span style={{ fontSize: 12, color: "#96A0AD" }}>/mo</span>{a.hasSalesNav && <span style={{ fontSize: 10, color: "#0A66C2", fontWeight: 700, marginLeft: 5 }}>+SN</span>}</div>
      <div style={{ fontSize: compact ? 10.5 : 12, color: "#5A6473", marginTop: 2, whiteSpace: "nowrap" }}>{money(t.weekly)}/wk · {money(t.daily)}/day</div>
    </div>
  );
}

function Avatar({ a, rented, soon }: { a: Account; rented: boolean; soon?: boolean }) {
  const dot = soon ? "#7C3AED" : rented ? "#E0A43B" : "#00B85C";
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <span style={{ width: 46, height: 46, borderRadius: "50%", background: getAvatarColor(a.linkedinName), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: `600 15px ${POP}`, overflow: "hidden", filter: rented ? "grayscale(0.5)" : "none" }}>
        {a.profilePhotoUrl ? <img src={a.profilePhotoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : getInitials(a.linkedinName)}
      </span>
      <span style={{ position: "absolute", bottom: 1, right: 1, width: 12, height: 12, borderRadius: "50%", border: "2px solid #fff", background: dot }} />
    </div>
  );
}

function GridCard({ a, selected, onToggle, showPricing, isArmy }: { a: Account; selected: boolean; onToggle: (id: string) => void; showPricing: boolean; isArmy: boolean }) {
  const soon = !!a.availableSoon;
  const rentable = a.status === "available" && !soon;
  const rented = !rentable && !soon;
  const displayName = shortName(a.linkedinName);
  return (
    <div className="cat2-card" style={{ position: "relative", background: "#FFFFFF", border: "1px solid #DFE3E9", borderRadius: 16, padding: 20, boxShadow: "0 8px 24px rgba(16,24,40,0.07), 0 1px 3px rgba(16,24,40,0.05)", opacity: rented ? 0.72 : 1, display: "flex", flexDirection: "column" }}>
      {soon && (
        <span style={{ position: "absolute", top: 14, right: 14, fontSize: 10.5, fontWeight: 600, color: "#6D28D9", background: "#EDE9FE", borderRadius: 999, padding: "3px 9px" }}>Available soon</span>
      )}
      {rentable && (
        <input type="checkbox" checked={selected} onChange={() => onToggle(a.id)} title={isArmy ? "Select" : "Select for bulk rent"} style={{ position: "absolute", top: 16, right: 16, accentColor: "#0A66C2", cursor: "pointer", width: 16, height: 16 }} />
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 13, marginBottom: 16 }}>
        <Avatar a={a} rented={rented} soon={soon} />
        <div style={{ minWidth: 0, flex: 1, paddingRight: rentable ? 20 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ font: `600 16px ${POP}`, color: "#0B1220", lineHeight: 1.2 }}>{displayName}</span>
            {a.linkedinVerified && <Verified />}
          </div>
          {a.linkedinHeadline && <div style={{ fontSize: 13, color: "#8A93A2", marginTop: 3, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{a.linkedinHeadline}</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {a.industry && <IndustryTag industry={a.industry} />}
        {a.location && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "#5A6473" }}><span style={{ color: "#B0B7C2" }}>◍</span>{a.location}</span>}
        {ageLabel(a.accountAgeMonths) && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, font: `700 12.5px ${POP}`, color: "#0A66C2", background: "#EAF3FF", border: "1px solid #CFE4FB", borderRadius: 999, padding: "3px 10px" }}>⏳ {ageLabel(a.accountAgeMonths)} old</span>}
      </div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ background: "#F8FAFC", border: "1px solid #EDEFF2", borderRadius: 10, padding: "11px 13px" }}>
          <div style={{ font: `700 16px ${POP}`, color: "#0B1220" }}>{a.connectionCount > 0 ? formatNumber(a.connectionCount) : "—"}</div>
          <div style={{ fontSize: 11, color: "#96A0AD", marginTop: 2 }}>connections</div>
        </div>
      </div>
      <div style={{ height: 1, background: "#EDEFF2", marginBottom: 14 }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <PriceBlock a={a} showPricing={showPricing} />
        <div style={{ display: "flex", gap: 8 }}><Actions a={a} isArmy={isArmy} /></div>
      </div>
    </div>
  );
}

function ListRow({ a, selected, onToggle, showPricing, mine, taken, isArmy }: { a: Account; selected: boolean; onToggle: (id: string) => void; showPricing: boolean; mine?: boolean; taken?: boolean; isArmy: boolean }) {
  const soon = !!a.availableSoon;
  const rented = (a.status !== "available" || !!taken) && !soon;
  const rentable = a.status === "available" && !taken && !soon;
  const displayName = shortName(a.linkedinName);
  return (
    <div className="cat2-row" style={{ display: "grid", gridTemplateColumns: "28px minmax(0,2.4fr) minmax(0,0.9fr) minmax(0,1.1fr) minmax(0,1.3fr) minmax(0,1fr) minmax(230px,1.6fr)", alignItems: "center", gap: 16, padding: "15px 22px", borderBottom: "1px solid #F0F2F5", opacity: rented ? 0.66 : 1, background: selected ? "#F0F7FF" : "transparent", transition: "background .15s" }}>
      {rentable ? <input type="checkbox" checked={selected} onChange={() => onToggle(a.id)} style={{ accentColor: "#0A66C2", cursor: "pointer" }} /> : <input type="checkbox" disabled style={{ opacity: 0.3 }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
        <Avatar a={a} rented={rented} soon={soon} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ font: `600 15px ${POP}`, color: "#0B1220", lineHeight: 1.2 }}>{displayName}</span>
            {a.linkedinVerified && <Verified />}
          </div>
          {a.linkedinHeadline && <div style={{ fontSize: 12.5, color: "#8A93A2", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.linkedinHeadline}</div>}
          {ageLabel(a.accountAgeMonths) && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, font: `700 11.5px ${POP}`, color: "#0A66C2", background: "#EAF3FF", border: "1px solid #CFE4FB", borderRadius: 999, padding: "2px 9px", marginTop: 4 }}>⏳ {ageLabel(a.accountAgeMonths)} old</span>}
        </div>
      </div>
      <span className="cat2-hide" style={{ font: `700 15px ${POP}`, color: "#0B1220" }}>{a.connectionCount > 0 ? formatNumber(a.connectionCount) : "—"}</span>
      <span className="cat2-hide">{a.industry ? <IndustryTag industry={a.industry} /> : "—"}</span>
      <span className="cat2-hide" style={{ fontSize: 13, color: "#5A6473", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.location || "—"}</span>
      <span><PriceBlock a={a} showPricing={showPricing} compact /></span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}><StatusBadge rented={rented} mine={mine} taken={taken} soon={soon} /><Actions a={a} isArmy={isArmy} /></div>
    </div>
  );
}
