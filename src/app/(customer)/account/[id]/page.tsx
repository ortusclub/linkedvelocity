"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatNumber, formatCurrency, SALES_NAV_MONTHLY } from "@/lib/utils";
import { blogFontVars } from "@/lib/blog-fonts";
import { toIndustryBucket } from "@/lib/industry";

const POP = "var(--font-poppins)", INT = "var(--font-inter)", MONO = "var(--font-jbmono)";
const CALENDAR_URL = "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ1he_qAS5s8faJzrAIjTJi8KIX9xvPhGbC4Ipn38lPTLzkfSuoyMIiqUrB0viY2jpXr_W_zLSdq";

interface Account {
  id: string;
  linkedinName: string;
  linkedinHeadline: string | null;
  linkedinUrl: string | null;
  connectionCount: number;
  industry: string | null;
  location: string | null;
  profileScreenshotUrl: string | null;
  profilePhotoUrl: string | null;
  accountAgeMonths: number | null;
  hasSalesNav: boolean;
  linkedinVerified?: boolean;
  monthlyPrice: number | string;
  status: string;
  notes: string | null;
  gologinProfileId: string | null;
}
interface User { id: string; role: string; }

const shortName = (n: string) => { const p = n.replace(/\s*\(.*\)\s*$/, "").trim().split(/\s+/).filter(Boolean); return p.length < 2 ? (p[0] || "") : `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`; };

const stepsFor = (isArmy: boolean) => isArmy ? [
  { n: "1", title: "Hire the operator", body: "Subscribe monthly — access is set up instantly. No passwords to manage, no setup." },
  { n: "2", title: "Open it in your secure browser", body: "The operator's profile is established and already logged in, ready to use right away." },
  { n: "3", title: "Run your outreach", body: "Send connection requests and messages from an established, real profile. The owner's name and photo stay as-is. Cancel anytime." },
] : [
  { n: "1", title: "Rent the account", body: "Subscribe monthly — access is set up instantly. No passwords to manage, no setup." },
  { n: "2", title: "Open it in the GoLogin browser", body: "The account is pre-warmed and already logged in, ready to use right away." },
  { n: "3", title: "Run your outreach", body: "Send connection requests and messages from an established, real profile. The owner's name and photo stay as-is. Cancel anytime." },
];
const perksFor = (isArmy: boolean) => isArmy ? [
  { title: "Secure browser session", body: "The profile is shared straight to your secure browser environment." },
  { title: "Dedicated proxy", body: "A dedicated proxy assigned to this operator for a consistent session." },
  { title: "Pre-authenticated", body: "LinkedIn session already logged in and ready to use." },
  { title: "Works anywhere", body: "Access from any device." },
  { title: "Cancel anytime", body: "No lock-in — cancel your subscription whenever you want." },
  { title: "Email reminders", body: "Renewal notifications so you're always in control." },
] : [
  { title: "Opens in GoLogin", body: "Browser profile shared straight to your own GoLogin account." },
  { title: "Dedicated proxy", body: "A dedicated proxy assigned to this account for a consistent session." },
  { title: "Pre-authenticated", body: "LinkedIn session already logged in and ready to use." },
  { title: "Works anywhere", body: "Access from any device with GoLogin installed." },
  { title: "Cancel anytime", body: "No lock-in — cancel your subscription whenever you want." },
  { title: "Email reminders", body: "Renewal notifications so you're always in control." },
];

export default function AccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [showInsufficientModal, setShowInsufficientModal] = useState(false);
  const [insufficientInfo, setInsufficientInfo] = useState<{ balance: number; price: number } | null>(null);
  // Sales Navigator add-on withdrawn (2026-09-23): never offered, never priced in.
  const addSalesNav = false;
  const [isShadow, setIsShadow] = useState(false); // shadow renter (Apex $20 / Ortus $25)
  const [SHADOW_MONTHLY_PRICE, setShadowRate] = useState(20); // per-renter flat rate from the API

  useEffect(() => {
    Promise.all([
      fetch(`/api/accounts/${params.id}`).then((r) => r.json()),
      fetch("/api/auth/me").then((r) => r.json()).catch(() => ({ user: null })),
      fetch("/api/wallet/balance").then((r) => r.json()).catch(() => ({ isShadowRenter: false })),
    ]).then(([accountData, userData, balData]) => {
      setAccount(accountData.account);
      setUser(userData.user);
      setIsShadow(!!balData.isShadowRenter);
      if (balData.shadowRate) setShadowRate(Number(balData.shadowRate));
      setLoading(false);
    });
  }, [params.id]);

  const isAdmin = user?.role === "admin";
  const isArmy = typeof window !== "undefined" && window.location.hostname.includes("linkedarmy");
  const noun = isArmy ? "operator" : "account";
  const verb = isArmy ? "Hire" : "Rent";
  const brandName = isArmy ? "LinkedArmy" : "LinkedVelocity";

  const handleOpenBrowser = async () => {
    if (!account?.gologinProfileId) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/browser/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: account.gologinProfileId, accountName: account.linkedinName }) });
      const data = await res.json();
      if (res.ok) setBrowserOpen(true); else alert(data.error || "Failed to open browser");
    } catch { alert("Failed to open browser"); } finally { setActionLoading(false); }
  };

  const handleRent = async () => {
    if (!account) return;
    setActionLoading(true);
    try {
      const meRes = await fetch("/api/auth/me");
      const meData = await meRes.json();
      if (!meData.user) { router.push(`/login?redirect=${encodeURIComponent(`/account/${params.id}`)}`); return; }
      const balRes = await fetch("/api/wallet/balance");
      const balData = await balRes.json();
      const balance = parseFloat(balData.balance || "0");
      const base = typeof account.monthlyPrice === "string" ? parseFloat(account.monthlyPrice) : Number(account.monthlyPrice);
      const salesNav = !isShadow && addSalesNav && !account.hasSalesNav;
      const price = isShadow ? SHADOW_MONTHLY_PRICE : base + (salesNav ? SALES_NAV_MONTHLY : 0);
      if (balance < price) { setInsufficientInfo({ balance, price }); setShowInsufficientModal(true); return; }
      router.push(`/checkout?accounts=${params.id}${salesNav ? `&salesNav=${params.id}` : ""}`);
    } catch { alert("Something went wrong. Please try again."); } finally { setActionLoading(false); }
  };

  if (loading) return <div style={{ maxWidth: 1180, margin: "0 auto", padding: "48px 40px" }}><div style={{ height: 420, borderRadius: 18, background: "#EAECEF", animation: "pulse 1.5s ease-in-out infinite" }} /><style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style></div>;
  if (!account) return <div style={{ maxWidth: 1180, margin: "0 auto", padding: "80px 40px", textAlign: "center" }}><h1 style={{ font: `700 24px ${POP}` }}>{isArmy ? "Operator not found" : "Account not found"}</h1></div>;

  const price = typeof account.monthlyPrice === "string" ? parseFloat(account.monthlyPrice) : account.monthlyPrice;
  const name = shortName(account.linkedinName);
  const STEPS = stepsFor(isArmy);
  const PERKS = perksFor(isArmy);
  const rentable = account.status === "available";
  const salesNavEligible = rentable && !account.hasSalesNav;
  const displayPrice = isShadow ? SHADOW_MONTHLY_PRICE : price + (addSalesNav && salesNavEligible ? SALES_NAV_MONTHLY : 0);
  const initial = account.linkedinName.replace(/\s*\(.*\)\s*$/, "").charAt(0).toUpperCase();
  const detailVal = (v: string, c?: string) => ({ font: `600 14px ${POP}`, color: c || "#0B1220" });
  const ageLabel = account.accountAgeMonths ? (account.accountAgeMonths >= 12 ? `${Math.floor(account.accountAgeMonths / 12)}+ years` : `${account.accountAgeMonths} months`) : null;
  const chip = (fg: string, bg: string, bd: string) => ({ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: fg, background: bg, border: `1px solid ${bd}`, borderRadius: 8, padding: "7px 12px" } as const);

  return (
    <div className={blogFontVars} style={{ fontFamily: INT, color: "#0B1220", background: "#FBFCFD", minHeight: "100vh" }}>
      <style>{`
        .ac-grid{max-width:1180px;margin:0 auto;padding:22px 40px 72px;display:grid;grid-template-columns:minmax(0,1fr) 372px;gap:34px;align-items:start;}
        .ac-side{position:sticky;top:24px;align-self:start;}
        .ac-cta{transition:transform .18s ease, box-shadow .18s ease;}
        .ac-cta:hover{transform:translateY(-2px);}
        @media(max-width:900px){.ac-grid{grid-template-columns:1fr;padding:20px 18px 56px;}.ac-side{position:static;}}
      `}</style>

      {/* breadcrumb */}
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 40px 0" }}>
        <div style={{ fontSize: 13.5, color: "#8A93A2" }}><Link href="/catalogue" style={{ color: "#0A66C2", textDecoration: "none" }}>{isArmy ? "Browse Operators" : "Browse Accounts"}</Link>{toIndustryBucket(account.industry) ? ` · ${toIndustryBucket(account.industry)}` : ""} · {name}</div>
      </div>

      <div className="ac-grid">
        {/* LEFT */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 22 }}>
          {/* profile preview */}
          <div>
            <div style={{ font: `500 11px ${MONO}`, letterSpacing: "0.16em", textTransform: "uppercase", color: "#8A93A2", margin: "6px 0 14px 4px" }}>Profile preview</div>
            <div style={{ background: "#fff", border: "1px solid #E6E8EC", borderRadius: 18, overflow: "hidden", boxShadow: "0 10px 30px rgba(16,24,40,0.08)" }}>
              <div style={{ position: "relative", height: 88, background: "linear-gradient(120deg,#0A66C2,#0E4F98)" }}>
                <span style={{ position: "absolute", top: 14, right: 16, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#fff", background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)", borderRadius: 999, padding: "4px 12px" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: rentable ? "#3EF08A" : "#E0A43B" }} />{rentable ? "Available now" : account.status.charAt(0).toUpperCase() + account.status.slice(1)}
                </span>
              </div>
              <div style={{ padding: "0 28px 26px", marginTop: -30 }}>
                {account.profilePhotoUrl ? (
                  <img src={account.profilePhotoUrl} alt="" style={{ position: "relative", zIndex: 2, width: 92, height: 92, border: "4px solid #fff", borderRadius: "50%", objectFit: "cover", objectPosition: "center top", boxShadow: "0 4px 12px rgba(16,24,40,0.12)" }} />
                ) : (
                  <div style={{ position: "relative", zIndex: 2, width: 92, height: 92, border: "4px solid #fff", borderRadius: "50%", background: "linear-gradient(135deg,#0A66C2,#004182)", display: "flex", alignItems: "center", justifyContent: "center", font: `700 32px ${POP}`, color: "#fff", boxShadow: "0 4px 12px rgba(16,24,40,0.12)" }}>{initial}</div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                  <span style={{ font: `700 24px ${POP}`, letterSpacing: "-0.02em", color: "#0B1220" }}>{name}</span>
                  {account.linkedinVerified && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "#0A66C2", background: "#EAF2FC", borderRadius: 7, padding: "3px 9px" }}>✓ Verified</span>}
                </div>
                {account.linkedinHeadline && <div style={{ fontSize: 16, color: "#3F4856", marginTop: 5 }}>{account.linkedinHeadline}</div>}
                {account.location && <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "#8A93A2", marginTop: 4 }}><span style={{ color: "#B0B7C2" }}>◍</span>{account.location}</div>}
                <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 16 }}>
                  {account.connectionCount > 0 && <span style={chip("#0B1220", "#F1F5FA", "#E4E9F0")}><span style={{ color: "#0A66C2", font: `700 13px ${POP}` }}>{formatNumber(account.connectionCount)}</span>connections</span>}
                  {ageLabel && <span style={chip("#946011", "#FBF0DA", "#F0E1BE")}>{ageLabel} on LinkedIn</span>}
                  {account.hasSalesNav && <span style={chip("#5747C9", "#EDEBFB", "#E0DCF7")}>Sales Navigator</span>}
                  {toIndustryBucket(account.industry) && <span style={chip("#0E7C74", "#DEF3F1", "#CDECE9")}>{toIndustryBucket(account.industry)}</span>}
                </div>
                {account.profileScreenshotUrl && <div style={{ marginTop: 18, overflow: "hidden", borderRadius: 12, border: "1px solid #EDEFF2" }}><img src={account.profileScreenshotUrl} alt="" style={{ width: "100%", display: "block" }} /></div>}
                {account.linkedinUrl && (
                  <a href={account.linkedinUrl.startsWith("http") ? account.linkedinUrl : `https://${account.linkedinUrl}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", background: "#0A66C2", color: "#fff", fontSize: 14, fontWeight: 600, borderRadius: 999, padding: 11, marginTop: 20, textDecoration: "none" }}>View full profile on LinkedIn ↗</a>
                )}
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: "#96A0AD", margin: "12px 0 0 4px", display: "flex", alignItems: "center", gap: 7 }}><span>🔒</span>The owner&apos;s real name and photo stay exactly as shown — you never change the profile.</div>
          </div>

          {/* how renting works */}
          <div style={{ background: "#fff", border: "1px solid #E6E8EC", borderRadius: 18, padding: "26px 28px", boxShadow: "0 4px 14px rgba(16,24,40,0.05)" }}>
            <div style={{ font: `600 18px ${POP}`, color: "#0B1220", marginBottom: 20 }}>{isArmy ? "How hiring this operator works" : "How renting this account works"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {STEPS.map((s) => (
                <div key={s.n} style={{ display: "flex", gap: 15, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(150deg,#0A66C2,#2678DC)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: `700 14px ${POP}`, boxShadow: "0 5px 12px rgba(10,102,194,0.26)" }}>{s.n}</span>
                  <div><div style={{ font: `600 15.5px ${POP}`, color: "#0B1220", marginBottom: 3 }}>{s.title}</div><p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#5A6473", margin: 0 }}>{s.body}</p></div>
                </div>
              ))}
            </div>
          </div>

          {/* what's included */}
          <div style={{ background: "#fff", border: "1px solid #E6E8EC", borderRadius: 18, padding: "26px 28px", boxShadow: "0 4px 14px rgba(16,24,40,0.05)" }}>
            <div style={{ font: `600 18px ${POP}`, color: "#0B1220", marginBottom: 20 }}>What&apos;s included</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 22px" }}>
              {PERKS.map((p) => (
                <div key={p.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 7, background: "#E4F6EC", color: "#067A45", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>✓</span>
                  <div><div style={{ font: `600 14.5px ${POP}`, color: "#0B1220", marginBottom: 2 }}>{p.title}</div><p style={{ fontSize: 13.5, lineHeight: 1.55, color: "#8A93A2", margin: 0 }}>{p.body}</p></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="ac-side" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #E6E8EC", borderRadius: 20, padding: 26, boxShadow: "0 16px 44px rgba(16,24,40,0.12), 0 2px 6px rgba(16,24,40,0.05)" }}>
            {isAdmin ? (
              browserOpen ? (
                <div style={{ borderRadius: 12, background: "#E4F6EC", border: "1px solid #CDEBD9", padding: 16, fontSize: 14, color: "#067A45" }}>Browser is open — the {brandName} window should be visible on your screen.</div>
              ) : account.gologinProfileId ? (
                <Button size="lg" variant="outline" onClick={handleOpenBrowser} loading={actionLoading} className="w-full">Open Browser Session</Button>
              ) : (
                <div style={{ textAlign: "center" }}><p style={{ font: `800 32px ${POP}`, color: "#0B1220" }}>{formatCurrency(price)}<span style={{ fontSize: 16, color: "#8A93A2", fontWeight: 500 }}>/mo</span></p><p style={{ marginTop: 8, fontSize: 12, color: "#96A0AD" }}>Admin preview — renters see a {verb} button here.</p></div>
              )
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ font: `800 40px ${POP}`, letterSpacing: "-0.02em", color: "#0B1220" }}>{formatCurrency(displayPrice)}</span>
                  <span style={{ fontSize: 16, color: "#8A93A2", fontWeight: 500 }}>/month</span>
                </div>
                <div style={{ fontSize: 13.5, color: "#8A93A2", marginTop: 4 }}>Flat monthly rate · billed until you cancel</div>


                {rentable ? (
                  <button onClick={handleRent} disabled={actionLoading} className="ac-cta" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, background: "#0A66C2", color: "#fff", fontSize: 16, fontWeight: 600, border: "none", borderRadius: 12, padding: 15, marginTop: 20, cursor: "pointer", boxShadow: "0 12px 28px rgba(10,102,194,0.28)" }}>{actionLoading ? "Processing…" : `${verb} this ${noun} →`}</button>
                ) : (
                  <div style={{ width: "100%", textAlign: "center", background: "#F2F4F7", color: "#96A0AD", fontSize: 15, fontWeight: 600, borderRadius: 12, padding: 15, marginTop: 20 }}>Currently unavailable</div>
                )}

                <div style={{ height: 1, background: "#EEF0F3", margin: "20px 0" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {["Instant access after payment", "Cancel anytime — no lock-in", isArmy ? "Secure managed access" : "Secure managed access via GoLogin"].map((t) => (
                    <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: "#37424F" }}><span style={{ color: "#00A150", fontWeight: 700 }}>✓</span>{t}</div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* account details */}
          <div style={{ background: "#fff", border: "1px solid #E6E8EC", borderRadius: 18, padding: "22px 24px", boxShadow: "0 4px 14px rgba(16,24,40,0.05)" }}>
            <div style={{ font: `500 11px ${MONO}`, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8A93A2", marginBottom: 16 }}>{isArmy ? "Operator details" : "Account details"}</div>
            {[
              ["Connections", formatNumber(account.connectionCount), undefined],
              ...(ageLabel ? [["Account age", ageLabel, undefined] as const] : []),
              ...(toIndustryBucket(account.industry) ? [["Industry", toIndustryBucket(account.industry)!, undefined] as const] : []),
              ...(account.location ? [["Location", account.location, undefined] as const] : []),
              ["Sales Navigator", account.hasSalesNav ? "Included" : (addSalesNav && salesNavEligible ? `Added (+${formatCurrency(SALES_NAV_MONTHLY)}/mo)` : "—"), account.hasSalesNav ? "#00A150" : (addSalesNav && salesNavEligible ? "#5747C9" : undefined)],
              ["Status", account.status.charAt(0).toUpperCase() + account.status.slice(1), account.status === "available" ? "#00A150" : undefined],
            ].map(([label, value, color]) => (
              <div key={label as string} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid #F1F3F6" }}>
                <span style={{ fontSize: 14, color: "#8A93A2" }}>{label}</span>
                <span style={detailVal(value as string, color as string | undefined)}>{value}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: 11, background: "#F2F7FF", border: "1px solid #DCE9FB", borderRadius: 14, padding: "15px 18px" }}>
            <span style={{ flexShrink: 0, color: "#0A66C2" }}>💬</span>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "#37424F" }}>{isArmy ? "Questions about this operator? " : "Questions about this account? "}<a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#0A66C2", fontWeight: 600, textDecoration: "none" }}>Chat with us →</a></div>
          </div>
        </div>
      </div>

      {showInsufficientModal && insufficientInfo && (
        <div onClick={() => setShowInsufficientModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,20,25,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, maxWidth: 440, width: "100%", padding: 32, boxShadow: "0 24px 60px rgba(15,20,25,0.25)", fontFamily: INT }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "#FFF4E5", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            </div>
            <h2 style={{ font: `700 22px ${POP}`, color: "#0B1220", letterSpacing: "-0.02em", marginBottom: 8 }}>{isArmy ? "Top up to hire this operator" : "Top up to rent this account"}</h2>
            <p style={{ fontSize: 14, color: "#536471", lineHeight: 1.55, marginBottom: 20 }}>{isArmy ? "You need to deposit money to hire this operator. Top up your balance and you'll be back here in seconds." : "You need to deposit money to rent this account. Top up your balance and you'll be back here in seconds."}</p>
            <div style={{ background: "#F8F8F5", borderRadius: 12, padding: "14px 16px", marginBottom: 24, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: "#536471" }}>Your balance</span><span style={{ fontWeight: 700, color: "#0F1419" }}>${insufficientInfo.balance.toFixed(2)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: "#536471" }}>{isArmy ? "Monthly price" : "Rental price"}</span><span style={{ fontWeight: 700, color: "#0F1419" }}>${insufficientInfo.price.toFixed(2)}/mo</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, paddingTop: 8, borderTop: "1px solid #E8E6E1" }}><span style={{ color: "#991B1B", fontWeight: 600 }}>Amount needed</span><span style={{ fontWeight: 800, color: "#991B1B" }}>${(insufficientInfo.price - insufficientInfo.balance).toFixed(2)}</span></div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowInsufficientModal(false)} style={{ flex: 1, padding: 13, borderRadius: 10, background: "#fff", color: "#536471", fontSize: 14, fontWeight: 600, border: "1px solid #E8E6E1", cursor: "pointer", fontFamily: INT }}>Cancel</button>
              <button onClick={() => router.push("/dashboard?topup=1#wallet")} style={{ flex: 1.4, padding: 13, borderRadius: 10, background: "#FF6B00", color: "#fff", fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: INT }}>Top Up Now →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
