import type { Metadata } from "next";
import Link from "next/link";
import { blogFontVars } from "@/lib/blog-fonts";
import { getBrand } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return {
    title: isArmy ? "Pricing — How LinkedArmy Operator Pricing Works" : "Pricing — How LinkedVelocity Account Rental Pricing Works",
    description: isArmy
      ? "Every LinkedIn Operator is priced by quality — connections, account age, the verified badge and more. See the pricing tiers and what sets each price."
      : "Every LinkedIn account is priced by quality — connections, account age, the verified badge and more. See the pricing tiers and what sets each price.",
    alternates: { canonical: "/pricing" },
  };
}

const POP = "var(--font-poppins)", INT = "var(--font-inter)", MONO = "var(--font-jbmono)";
const CALENDAR_URL = "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ1he_qAS5s8faJzrAIjTJi8KIX9xvPhGbC4Ipn38lPTLzkfSuoyMIiqUrB0viY2jpXr_W_zLSdq";

type Tier = {
  eyebrow: string; eyebrowBg: string; eyebrowFg: string; name: string; topColor: string; dots: string[];
  person: string; role: string; initials: string; avatarBg: string;
  connections: string; age: string;
  desc: string; price: string; featured?: boolean; ribbon?: string;
};

const TIERS: Tier[] = [
  {
    eyebrow: "Entry", eyebrowBg: "#EAF2FC", eyebrowFg: "#0A66C2", name: "New / Basic", topColor: "#4B9BEA", dots: ["#0A66C2", "#D3DAE3", "#D3DAE3"],
    person: "Jordan T.", role: "Sales Associate", initials: "JT", avatarBg: "#4B9BEA",
    connections: "<500", age: "Newer",
    desc: "Newer profiles with under 500 connections. Great for testing or higher-volume, lower-stakes outreach.",
    price: "from $45",
  },
  {
    eyebrow: "Sweet spot", eyebrowBg: "#0A66C2", eyebrowFg: "#FFFFFF", name: "Established", topColor: "#0A66C2", dots: ["#0A66C2", "#0A66C2", "#D3DAE3"],
    person: "Anna K.", role: "Marketing Manager", initials: "AK", avatarBg: "#0A66C2",
    connections: "500+", age: "1 yr+",
    desc: "Established profiles with 500+ connections and a year or more of history. The reliable middle ground most teams choose.",
    price: "from $75", featured: true, ribbon: "Most popular",
  },
  {
    eyebrow: "Top tier", eyebrowBg: "#0D1B2A", eyebrowFg: "#FFFFFF", name: "Premium", topColor: "#0D1B2A", dots: ["#0A66C2", "#0A66C2", "#0A66C2"],
    person: "Marcus L.", role: "VP of Sales", initials: "ML", avatarBg: "#0D1B2A",
    connections: "1,000+", age: "2 yr+",
    desc: "Senior profiles with large, mature networks. Maximum reach and credibility for serious outreach.",
    price: "from $110",
  },
];

const stroke = { fill: "none", stroke: "#0A66C2", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const FACTORS = [
  { icon: <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>, title: "Connections", desc: "More connections = more reach." },
  { icon: <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>, title: "Account age", desc: "Older = more trusted, lower risk. Two accounts with the same connections can price differently on age alone." },
  { icon: <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}><path d="M12 2l2.4 1.8 3 .2.9 2.9 2.1 2.1-1.1 2.8 1.1 2.8-2.1 2.1-.9 2.9-3 .2L12 22l-2.4-1.8-3-.2-.9-2.9-2.1-2.1L4.7 12 3.6 9.2l2.1-2.1.9-2.9 3-.2z" /><path d="M9 12l2 2 4-4" /></svg>, title: "Verified badge", desc: "The blue check adds trust — a +$20/mo add-on." },
  { icon: <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>, title: "Seniority & industry", desc: "Senior titles open more doors." },
];

export default async function PricingPage() {
  const isArmy = (await getBrand()).id === "linkedarmy";
  return (
    <div className={blogFontVars} style={{ fontFamily: INT, color: "#0B1220", background: "linear-gradient(180deg,#F4F7FB 0%,#FBFCFD 340px,#FBFCFD 100%)" }}>
      <style>{`
        .pp2-tiers{max-width:1160px;margin:0 auto;padding:44px 40px 0;display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;align-items:stretch;}
        .pp2-factors{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
        .pp2-card{transition:transform .22s cubic-bezier(.2,.7,.3,1), box-shadow .22s ease;}
        .pp2-card:hover{transform:translateY(-7px)!important;box-shadow:0 22px 48px rgba(16,24,40,0.13), 0 4px 12px rgba(16,24,40,0.07)!important;}
        .pp2-featured:hover{transform:translateY(-16px)!important;box-shadow:0 34px 70px rgba(10,102,194,0.26), 0 6px 18px rgba(10,102,194,0.14)!important;}
        .pp2-factor{transition:transform .2s cubic-bezier(.2,.7,.3,1), box-shadow .2s ease;}
        .pp2-factor:hover{transform:translateY(-6px);box-shadow:0 18px 38px rgba(16,24,40,0.12), 0 4px 10px rgba(16,24,40,0.06);}
        @media(max-width:900px){
          .pp2-tiers{grid-template-columns:1fr;padding:36px 18px 0;}
          .pp2-factors{grid-template-columns:repeat(2,1fr);}
          .pp2-featured{transform:none!important;}
          .pp2-wrap{padding-left:18px!important;padding-right:18px!important;}
        }
      `}</style>

      {/* header */}
      <div style={{ textAlign: "center", padding: "60px 24px 8px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#FFFFFF", border: "1px solid #E6E8EC", borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, color: "#3F4856", marginBottom: 22, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #4BE08C 0%, #00B85C 65%)", boxShadow: "0 0 5px 1px rgba(0,184,92,0.40), 0 0 12px 4px rgba(0,184,92,0.22), 0 0 20px 7px rgba(0,184,92,0.12)" }} />Pricing
        </div>
        <h1 style={{ fontFamily: POP, fontWeight: 700, fontSize: "clamp(34px,4.6vw,54px)", lineHeight: 1.04, letterSpacing: "-0.03em", margin: "0 0 20px" }}>{isArmy ? "Pay per operator —" : "Pay per account —"}<br />priced by quality</h1>
        <p style={{ fontSize: 19, lineHeight: 1.55, color: "#5A6473", margin: "0 auto", maxWidth: 560 }}>Every profile is priced on its own merits, so costs range. Here&apos;s what you&apos;re paying for, and how to pick the right fit.</p>
      </div>

      {/* tiers */}
      <div className="pp2-tiers">
        {TIERS.map((t) => (
          <div key={t.name} className={"pp2-card" + (t.featured ? " pp2-featured" : "")} style={{
            position: "relative", background: "linear-gradient(180deg,#FFFFFF 0%,#FCFDFE 100%)", borderRadius: 20,
            border: "1px solid " + (t.featured ? "#0A66C2" : "#E9ECF0"), borderTop: "3px solid " + t.topColor,
            boxShadow: t.featured ? "0 24px 56px rgba(10,102,194,0.20), 0 4px 14px rgba(10,102,194,0.10)" : "0 10px 30px rgba(16,24,40,0.07), 0 2px 6px rgba(16,24,40,0.04)",
            transform: t.featured ? "translateY(-10px)" : "none", display: "flex", flexDirection: "column",
          }}>
            {t.ribbon && <div style={{ position: "absolute", top: -13, left: "50%", transform: "translateX(-50%)", background: "#00B85C", color: "#fff", fontFamily: MONO, fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", padding: "5px 14px", borderRadius: 999, whiteSpace: "nowrap", boxShadow: "0 4px 12px rgba(0,184,92,0.3)" }}>{t.ribbon}</div>}
            <div style={{ padding: "30px 28px 28px", display: "flex", flexDirection: "column", height: "100%" }}>
              <span style={{ alignSelf: "flex-start", fontFamily: MONO, fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", color: t.eyebrowFg, background: t.eyebrowBg, padding: "5px 11px", borderRadius: 7, textTransform: "uppercase" }}>{t.eyebrow}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 20px" }}>
                <span style={{ fontFamily: POP, fontWeight: 700, fontSize: 24, letterSpacing: "-0.01em", color: "#0B1220" }}>{t.name}</span>
                <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  {t.dots.map((d, i) => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: d, display: "inline-block" }} />)}
                </span>
              </div>

              {/* example person */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#F8FAFC", border: "1px solid #EDEFF2", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
                <span style={{ flexShrink: 0, width: 38, height: 38, borderRadius: "50%", background: t.avatarBg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: POP, fontWeight: 600, fontSize: 13 }}>{t.initials}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontWeight: 600, fontSize: 14.5, color: "#0B1220" }}>{t.person}</span>
                    <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#96A0AD", border: "1px solid #E2E6EB", borderRadius: 5, padding: "2px 6px" }}>Example</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#8A93A2", marginTop: 2 }}>{t.role}</div>
                </div>
              </div>

              {/* stats */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
                {[
                  { v: t.connections, l: "connections", c: "#0A66C2" },
                  { v: t.age, l: "account age", c: "#0A66C2" },
                ].map((s) => (
                  <div key={s.l} style={{ background: "#F8FAFC", border: "1px solid #EDEFF2", borderRadius: 10, padding: "12px 6px", textAlign: "center" }}>
                    <div style={{ fontFamily: POP, fontWeight: 700, fontSize: 17, color: s.c }}>{s.v}</div>
                    <div style={{ fontSize: 11, color: "#96A0AD", marginTop: 3 }}>{s.l}</div>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#5A6473", margin: "0 0 22px" }}>{t.desc}</p>

              <div style={{ marginTop: "auto" }}>
                <div style={{ height: 1, background: "#EDEFF2", marginBottom: 16 }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: POP, fontWeight: 700, fontSize: 26, color: "#0A66C2" }}>{t.price}</span>
                  <span style={{ fontSize: 13.5, color: "#96A0AD" }}>/mo</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* add-ons */}
      <div className="pp2-wrap" style={{ maxWidth: 1160, margin: "30px auto 0", padding: "0 40px" }}>
        <div style={{ display: "flex", gap: "14px 28px", flexWrap: "wrap", alignItems: "center", justifyContent: "center", textAlign: "center", background: "#FFFFFF", border: "1px solid #EAECEF", borderRadius: 14, padding: "18px 24px", boxShadow: "0 1px 2px rgba(16,24,40,0.03)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 14.5, color: "#37424F" }}>
            <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", background: "#0A66C2", color: "#fff" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </span>
            <span><strong style={{ color: "#0B1220" }}>Verified badge</strong> &mdash; add <strong style={{ color: "#0A66C2" }}>+$20/mo</strong> on profiles with the blue check</span>
          </span>
          <span style={{ fontSize: 14.5, color: "#5A6473" }}>Weekly &amp; daily rates available on request</span>
        </div>
      </div>

      {/* managed option (LinkedArmy only) — the tiers above are "run it yourself", this is "we run it" */}
      {isArmy && (
        <div className="pp2-wrap" style={{ maxWidth: 1160, margin: "40px auto 0", padding: "0 40px" }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(150deg,#0A66C2 0%,#0D1B2A 100%)", borderRadius: 20, padding: "32px 34px", color: "#fff" }}>
            <div style={{ maxWidth: 580, minWidth: 260 }}>
              <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9DC2F0" }}>Option 2 · we run it</span>
              <h2 style={{ fontFamily: POP, fontWeight: 700, fontSize: "clamp(24px,3vw,32px)", letterSpacing: "-0.02em", margin: "10px 0 10px" }}>Prefer we run the outreach?</h2>
              <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "#C8D6EA", margin: 0 }}>The tiers above are for running it yourself. With managed outreach our team builds the list, writes the sequences, runs several operators, and books qualified calls into your calendar. From $900/month for roughly 10 qualified calls, no setup fee, exact scope set on a quick call.</p>
            </div>
            <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 9, background: "#fff", color: "#0B1220", fontSize: 16, fontWeight: 600, padding: "15px 26px", borderRadius: 12, textDecoration: "none" }}>Book a call →</a>
          </div>
        </div>
      )}

      {/* what sets price */}
      <div className="pp2-wrap" style={{ maxWidth: 1160, margin: "40px auto 0", padding: "0 40px" }}>
        <div style={{ background: "#FFFFFF", border: "1px solid #EAECEF", borderRadius: 20, padding: "36px 36px 40px", boxShadow: "0 1px 2px rgba(16,24,40,0.03)" }}>
          <h2 style={{ fontFamily: POP, fontWeight: 700, fontSize: 26, letterSpacing: "-0.02em", margin: "0 0 8px" }}>What sets each price</h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "#5A6473", margin: "0 0 26px", maxWidth: 720 }}>{isArmy ? "Every operator is scored on the same factors" : "Every account is scored on the same factors"} — the higher it scores, the more reach and trust it carries (and the more it costs).</p>
          <div className="pp2-factors">
            {FACTORS.map((f) => (
              <div key={f.title} className="pp2-factor" style={{ background: "#FFFFFF", border: "1px solid #EAECEF", borderRadius: 16, padding: "26px 18px 24px", textAlign: "center", boxShadow: "0 6px 18px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.04)" }}>
                <div style={{ width: 50, height: 50, margin: "0 auto 15px", borderRadius: 14, background: "linear-gradient(150deg,#EAF2FC 0%,#D6E7FB 100%)", boxShadow: "0 6px 14px rgba(10,102,194,0.16), inset 0 1px 0 rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>{f.icon}</div>
                <div style={{ fontFamily: POP, fontWeight: 600, fontSize: 15, color: "#0B1220", marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "#8A93A2" }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* reassurance */}
      <div className="pp2-wrap" style={{ maxWidth: 1160, margin: "20px auto 0", padding: "0 40px" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "#F2F7FF", border: "1px solid #DCE9FB", borderRadius: 14, padding: "18px 22px" }}>
          <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 9, background: "#0A66C2", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 16v-4" /><path d="M12 8h.01" /><circle cx="12" cy="12" r="9" /></svg>
          </span>
          <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "#37424F", margin: 0 }}><strong>Exact prices are set per profile and shown on each listing</strong> — these tiers just explain the <em>why</em>. You&apos;ll always see the real monthly price before you {isArmy ? "hire" : "rent"}. No hidden fees, cancel anytime.</p>
        </div>
      </div>

      {/* dark CTA */}
      <div style={{ marginTop: 64, background: "radial-gradient(120% 130% at 22% 0%, #12305F 0%, #0A1826 62%)", padding: "72px 40px 78px", textAlign: "center" }}>
        <h2 style={{ fontFamily: POP, fontWeight: 700, fontSize: "clamp(28px,3.6vw,40px)", letterSpacing: "-0.02em", color: "#fff", margin: "0 0 14px" }}>Find the right {isArmy ? "operator" : "account"} for your budget</h2>
        <p style={{ fontSize: 17, color: "#AFC0D6", margin: "0 auto 30px", maxWidth: 480 }}>Browse live profiles and see the real price for each.</p>
        <Link href="/catalogue" style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "#fff", color: "#0B1220", fontSize: 16, fontWeight: 600, padding: "15px 28px", borderRadius: 12, textDecoration: "none" }}>Browse available profiles →</Link>
      </div>
    </div>
  );
}
