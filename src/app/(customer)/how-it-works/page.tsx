import type { Metadata } from "next";
import Link from "next/link";
import { blogFontVars } from "@/lib/blog-fonts";
import { getBrand } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return {
    title: isArmy
      ? "How It Works — Hiring a LinkedIn Operator"
      : "How It Works — Renting & Sharing LinkedIn Accounts",
    description: isArmy
      ? "Step-by-step guide to how LinkedArmy works. Hire a verified LinkedIn Operator in minutes to run outreach from an established, credible profile, or become an operator and earn."
      : "Step-by-step guide to how LinkedVelocity works. Rent a verified, pre-warmed LinkedIn account in minutes with GoLogin browser access, or earn $10-500/month sharing an account you no longer use.",
    alternates: { canonical: "/how-it-works" },
    openGraph: {
      title: isArmy
        ? "How LinkedArmy Works — Hire LinkedIn Operators"
        : "How LinkedVelocity Works — Rent or Share LinkedIn Accounts",
      description: isArmy
        ? "Browse, hire, and work with verified LinkedIn Operators in minutes. Or become an operator and earn."
        : "Browse, rent, and access pre-warmed LinkedIn accounts in minutes. Or earn passive income by sharing accounts you no longer use.",
      url: `${brand.url}/how-it-works`,
    },
  };
}

const POP = "var(--font-poppins)", INT = "var(--font-inter)", MONO = "var(--font-jbmono)";

const STEPS_BY_BRAND = {
  linkedvelocity: [
    { n: "1", tag: "Browse", title: "Browse the catalogue", body: "Open the catalogue and filter by industry, connection count, geography, and Sales Navigator availability. Every account shows its price, stats, and current status." },
    { n: "2", tag: "Select", title: "Select your account(s)", body: "Tick one or more accounts and proceed to checkout. Rent a single account, or bulk-rent across a multi-account campaign in one flow." },
    { n: "3", tag: "Top up", title: "Top up your balance", body: "Add funds to your wallet — pay by card via Stripe, or deposit USDC on Base from any wallet. Your balance updates within seconds." },
    { n: "4", tag: "Confirm", title: "Pay and confirm rental", body: "Rentals are monthly and paid from your balance, renewing automatically. Cancel anytime from your dashboard — no penalty." },
    { n: "5", tag: "Connect", title: "Open your account in GoLogin", body: "Each rented account's browser profile is shared straight to your own GoLogin account — its own isolated profile with a dedicated proxy. No password to manage." },
    { n: "6", tag: "Launch", title: "Run your campaigns", body: "Click the account to open it as a real Chrome session. Install Dripify, Expandi, Linked Helper, or any extension, and run connection, intro, and open-profile campaigns exactly as you would on your own account." },
  ],
  linkedarmy: [
    { n: "1", tag: "Browse", title: "Browse the catalogue", body: "Open the catalogue and filter by industry, connection count, geography, and Sales Navigator availability. Every operator shows its price, stats, and current status." },
    { n: "2", tag: "Select", title: "Select your operator(s)", body: "Tick one or more operators and proceed to checkout. Hire a single operator, or hire several across a multi-operator campaign in one flow." },
    { n: "3", tag: "Top up", title: "Top up your balance", body: "Add funds to your wallet — pay by card via Stripe, or deposit USDC on Base from any wallet. Your balance updates within seconds." },
    { n: "4", tag: "Confirm", title: "Pay and confirm", body: "Engagements are monthly and paid from your balance, renewing automatically. Cancel anytime from your dashboard — no penalty." },
    { n: "5", tag: "Connect", title: "Get connected", body: "Your operator's profile is set up in a secure, isolated environment with a dedicated IP, ready for you in minutes. Nothing to configure." },
    { n: "6", tag: "Launch", title: "Go live", body: "Launch your outreach from an established, credible profile and start landing connection requests, intros, and open-profile messages that a brand-new account never could." },
  ],
} as const;

export default async function HowItWorksPage() {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  const steps = STEPS_BY_BRAND[brand.id];
  return (
    <div className={blogFontVars} style={{ fontFamily: INT, color: "#0B1220", background: "#FBFCFD" }}>
      <style>{`
        .hiw-line{position:absolute;left:23px;top:12px;bottom:12px;width:2px;background:linear-gradient(180deg,#0A66C2,#4B9BEA 60%,rgba(75,155,234,0.2));z-index:0;}
        .hiw-card{transition:transform .18s cubic-bezier(.2,.7,.3,1), box-shadow .18s ease, border-color .18s ease;}
        .hiw-card:hover{transform:translateX(4px);border-color:#C3D6EE!important;box-shadow:0 14px 32px rgba(16,24,40,0.10), 0 3px 8px rgba(16,24,40,0.06)!important;}
        @media(max-width:640px){.hiw-line{display:none;}.hiw-node{width:38px!important;height:38px!important;}.hiw-cta{padding-left:0!important;}}
      `}</style>

      {/* HERO */}
      <section style={{ position: "relative", overflow: "hidden", background: "radial-gradient(80% 70% at 50% -10%, rgba(10,102,194,0.28) 0%, rgba(10,24,38,0) 60%), radial-gradient(60% 60% at 88% 15%, rgba(38,120,220,0.16) 0%, rgba(10,24,38,0) 60%), linear-gradient(180deg,#0F2439 0%,#0A1826 100%)", padding: "60px 24px 84px", color: "#EAF0FA" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#7FA0C4", marginBottom: 22 }}>Home · How It Works</div>
          <h1 style={{ font: `800 clamp(34px,5.6vw,56px) ${POP}`, lineHeight: 1.05, letterSpacing: "-0.03em", margin: "0 auto 22px", color: "#fff", maxWidth: 760 }}>{isArmy ? "Hire a LinkedIn Operator in minutes — no warm-up, no setup wizard" : "Rent a LinkedIn account in minutes — no warm-up, no setup wizard"}</h1>
          <p style={{ fontSize: 19, lineHeight: 1.6, color: "#AFC4DB", margin: "0 auto", maxWidth: 600 }}>{isArmy ? "Every operator comes with a secure, dedicated environment ready to go. No setup wizard, no verification step, pick an operator and you're live." : "Every rented account comes with its own GoLogin anti-detect browser profile and dedicated proxy. No password to manage, no verification step — click an account and you're in."}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "center", marginTop: 34 }}>
            <Link href="/catalogue" style={{ background: "#fff", color: "#0B1220", fontSize: 15, fontWeight: 600, padding: "14px 24px", borderRadius: 12, textDecoration: "none", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>{isArmy ? "Browse Operators →" : "Browse Available Accounts →"}</Link>
            <Link href="/faqs" style={{ background: "rgba(255,255,255,0.08)", color: "#EAF0FA", border: "1px solid rgba(255,255,255,0.18)", fontSize: 15, fontWeight: 600, padding: "14px 24px", borderRadius: 12, textDecoration: "none" }}>FAQs</Link>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#8FA8C6", marginLeft: 4 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00E676", boxShadow: "0 0 6px 2px rgba(0,230,118,0.4)" }} />Ready in minutes</span>
          </div>
        </div>
      </section>

      {/* STEPS */}
      <section style={{ background: "#FBFCFD", padding: "76px 24px 40px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <h2 style={{ font: `700 clamp(26px,3.4vw,30px) ${POP}`, letterSpacing: "-0.02em", margin: "0 0 6px", textAlign: "center" }}>Six steps from browsing to sending</h2>
          <p style={{ fontSize: 16, color: "#5A6473", margin: "0 0 52px", textAlign: "center" }}>For growth teams, agencies, and SDRs.</p>

          <div style={{ position: "relative" }}>
            <div className="hiw-line" />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {steps.map((s) => (
                <div key={s.n} style={{ position: "relative", zIndex: 1, display: "flex", gap: 24, alignItems: "flex-start" }}>
                  <div className="hiw-node" style={{ flexShrink: 0, width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(150deg,#0A66C2,#2678DC)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: `700 18px ${POP}`, boxShadow: "0 8px 18px rgba(10,102,194,0.28)", border: "4px solid #FBFCFD" }}>{s.n}</div>
                  <div className="hiw-card" style={{ flex: 1, background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "20px 24px", boxShadow: "0 4px 14px rgba(16,24,40,0.05), 0 1px 3px rgba(16,24,40,0.04)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{ font: `500 10.5px ${MONO}`, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0A66C2", background: "#EAF2FC", padding: "4px 10px", borderRadius: 6 }}>{s.tag}</span>
                      <span style={{ font: `600 18px ${POP}`, color: "#0B1220" }}>{s.title}</span>
                    </div>
                    <p style={{ fontSize: 15, lineHeight: 1.65, color: "#5A6473", margin: 0 }}>{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="hiw-cta" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 40, paddingLeft: 47 }}>
            <Link href="/catalogue" style={{ background: "#0A66C2", color: "#fff", fontSize: 15, fontWeight: 600, padding: "13px 22px", borderRadius: 12, textDecoration: "none", boxShadow: "0 10px 26px rgba(10,102,194,0.24)" }}>{isArmy ? "Browse Operators →" : "Browse Available Accounts →"}</Link>
            <Link href="/faqs" style={{ background: "#fff", border: "1px solid #DFE3E9", color: "#0B1220", fontSize: 15, fontWeight: 600, padding: "13px 22px", borderRadius: 12, textDecoration: "none" }}>FAQs</Link>
          </div>
        </div>
      </section>

      {/* WHY GOLOGIN */}
      <section style={{ background: "#FBFCFD", padding: "24px 24px 88px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 18, alignItems: "flex-start", background: "#F2F7FF", border: "1px solid #DCE9FB", borderLeft: "4px solid #0A66C2", borderRadius: 16, padding: "26px 28px" }}>
            <span style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12, background: "linear-gradient(150deg,#0A66C2,#2678DC)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 18px rgba(10,102,194,0.24)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
            </span>
            <div>
              <div style={{ font: `600 17px ${POP}`, color: "#0B1220", marginBottom: 6 }}>{isArmy ? "Why it stays secure" : "Why GoLogin matters"}</div>
              <p style={{ fontSize: 15, lineHeight: 1.7, color: "#37424F", margin: 0 }}>{isArmy ? <>Each operator works in a secure, isolated environment with its own dedicated IP, so every session stays consistent and the profile stays protected. And in the rare case an operator is ever restricted, we <strong>pause your billing for it and move you to a replacement</strong> so your campaigns keep running.</> : <>Each rented account runs in an isolated browser fingerprint with its own dedicated IP. To LinkedIn, the session looks like the original account holder logging in from their usual location — one consistent user. And in the rare case an account is ever restricted, we <strong>pause your billing for it and move you to a replacement</strong> so your campaigns keep running.</>}</p>
            </div>
          </div>
        </div>
      </section>

      {/* AMBASSADOR CROSS-LINK — hidden on LinkedArmy (no public operator recruitment for now) */}
      {!isArmy && (
      <section style={{ background: "#F6F5F1", padding: "56px 24px 72px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 28, flexWrap: "wrap", background: "#fff", border: "1px solid #E6E8EC", borderRadius: 16, padding: "24px 28px", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 11, background: "#E4F6EC", color: "#067A45", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}>$</span>
              <div>
                <div style={{ font: `600 16px ${POP}`, color: "#0B1220" }}>Have an account instead of needing one?</div>
                <div style={{ fontSize: 14, color: "#5A6473", marginTop: 2 }}>Professionals earn $10–500/month sharing a dormant profile — you keep full ownership.</div>
              </div>
            </div>
            <Link href="/become-ambassador" style={{ flexShrink: 0, color: "#00A150", fontWeight: 600, fontSize: 14.5, textDecoration: "none" }}>See how earning works →</Link>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}
