import Link from "next/link";

// LinkedArmy homepage — its own character (brutalist: teal ink + electric lime + coral on
// paper, 2px borders, big tight lowercase headlines) with CLEAR "hire a LinkedIn operator"
// messaging (obvious what we do; rental implied, not stated). Rendered for brand=linkedarmy;
// the global Navbar/Footer are suppressed on this page (it ships its own).

export type ArmyRosterCard = {
  id: string;
  name: string;
  headline: string | null;
  connections: number;
  industry: string | null;
  location: string | null;
  hasSalesNav: boolean;
  verified: boolean;
  photo: string | null;
  rented?: boolean; // currently rented / showcase — shown as labelled social proof, not hireable
};

const fmtConns = (c: number) =>
  c >= 1000 ? `${(c / 1000).toFixed(c % 1000 >= 100 ? 1 : 0)}k+` : c > 0 ? `${c}` : "—";

const CALENDAR_URL =
  "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ1he_qAS5s8faJzrAIjTJi8KIX9xvPhGbC4Ipn38lPTLzkfSuoyMIiqUrB0viY2jpXr_W_zLSdq";

export function LinkedArmyHome({ roster }: { roster: ArmyRosterCard[] }) {
  return (
    <div className="la3">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=Space+Mono:wght@400;700&display=swap" />
      <style>{`
        .la3{
          --paper:#f0f0ee; --ink:#0e404b; --lime:#e4fb25; --coral:#ff7a59;
          --teal:#2e6f78; --footer:#072a32; --hl:#f4fdc4; --accent-700:#5a6100;
          --n700:#5f5f63; --n800:#434346;
          --divider:color-mix(in srgb,#0e404b 32%,transparent);
          --disp:'Archivo',system-ui,sans-serif; --mono:'Space Mono',ui-monospace,monospace;
          background:var(--paper);color:var(--ink);font-weight:500;
        }
        .la3 h1,.la3 h2,.la3 h3{font-family:var(--disp);margin:0;text-wrap:balance;letter-spacing:-0.045em;line-height:0.92;text-transform:lowercase}
        .la3 a{color:inherit;text-decoration:none}
        .la3 .ey{font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase}
        .la3 .btn{display:inline-flex;align-items:center;justify-content:space-between;gap:20px;background:var(--ink);color:var(--paper);font-weight:800;font-family:var(--disp);text-transform:lowercase;letter-spacing:-0.02em;padding:16px 20px;transition:background .15s}
        .la3 .btn:hover{background:#0a3139}
        .la3 .lnk:hover{color:var(--accent-700)}
        .la3 .wrap{max-width:1200px;margin:0 auto;padding:0 clamp(16px,4vw,48px)}
        .la3 .mk{display:inline-block;width:9px;height:9px;background:var(--lime);margin-left:2px}
        .la3 .cells{display:grid;border-top:2px solid var(--ink)}
        .la3 .cell{border-bottom:2px solid var(--ink);padding:clamp(20px,2.4vw,30px)}
        @media(min-width:760px){.la3 .c3{grid-template-columns:repeat(3,1fr)}.la3 .cell{border-right:2px solid var(--ink)}}
        @media(prefers-reduced-motion:reduce){.la3 *{transition:none!important}}
      `}</style>

      {/* ===== TOP LIME BLOCK: nav + hero + strip ===== */}
      <div style={{ background: "var(--lime)", borderBottom: "2px solid var(--ink)" }}>
        <nav className="wrap" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 22, paddingTop: 16, paddingBottom: 16, borderBottom: "2px solid var(--ink)", fontWeight: 700, fontSize: 14 }}>
          <a href="#top" style={{ fontFamily: "var(--disp)", fontWeight: 900, fontSize: 24, letterSpacing: "-0.05em", marginRight: "auto", textTransform: "lowercase", display: "flex", alignItems: "center", gap: 10 }}>
            <svg width={30} height={30} viewBox="0 0 400 400" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
              <rect width="400" height="400" fill="#0e404b" />
              <path d="M96 214 L200 128 L304 214" fill="none" stroke="#e4fb25" strokeWidth={40} strokeLinecap="square" />
              <path d="M96 282 L200 196 L304 282" fill="none" stroke="#ff7a59" strokeWidth={40} strokeLinecap="square" />
            </svg>
            <span>linkedarmy<span className="mk" /></span>
          </a>
          <a href="#how" className="lnk">how it works</a>
          <a href="#operators" className="lnk">operators</a>
          <a href="#pricing" className="lnk">pricing</a>
          <a href="#faq" className="lnk">faq</a>
          <Link href="/catalogue" className="btn" style={{ padding: "10px 16px" }}>browse operators</Link>
        </nav>

        <header id="top" className="wrap" style={{ paddingTop: "clamp(44px,7vw,92px)", paddingBottom: "clamp(32px,5vw,60px)", display: "flex", flexDirection: "column", gap: "clamp(22px,3vw,36px)" }}>
          <div className="ey">verified linkedin operators</div>
          <h1 style={{ fontSize: "clamp(52px,10vw,150px)", fontWeight: 900 }}>skip the warm-up.<br />hire an operator.</h1>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: 28, alignItems: "end" }}>
            <p style={{ margin: 0, fontSize: "clamp(17px,1.5vw,21px)", lineHeight: 1.5, fontWeight: 600, maxWidth: 560 }}>Hire verified LinkedIn operators with established networks and a mature online presence to run outreach for you and hit pipeline targets in weeks, not quarters. Their reach and credibility do the work a brand-new account cannot.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
              <Link href="/catalogue" className="btn" style={{ fontSize: 16 }}><span>browse operators</span><span>→</span></Link>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--mono)" }}>from $45/mo · month to month · cancel anytime</span>
            </div>
          </div>
        </header>

        <div className="wrap" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", borderTop: "2px solid var(--ink)", background: "var(--paper)", padding: 0 }}>
          {[["real", "profiles, real people"], ["0", "warm-up needed"], ["fully", "managed & secured"], ["m2m", "cancel anytime"]].map(([n, l]) => (
            <div key={l} style={{ padding: "14px clamp(16px,2vw,26px)", borderRight: "2px solid var(--ink)", fontSize: 13, fontWeight: 700 }}><strong style={{ fontFamily: "var(--disp)", fontSize: 20 }}>{n}</strong>{l.startsWith("-") ? l : " " + l}</div>
          ))}
        </div>
      </div>

      {/* ===== BUILD VS HIRE ===== */}
      <section className="wrap" style={{ paddingTop: "clamp(48px,7vw,92px)", paddingBottom: "clamp(48px,7vw,92px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: "clamp(32px,5vw,64px)", borderBottom: "2px solid var(--divider)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="ey" style={{ color: "var(--accent-700)" }}>building vs hiring</div>
          <h2 style={{ fontSize: "clamp(38px,5.5vw,76px)", fontWeight: 800 }}>building a profile takes months. hiring one takes minutes.</h2>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: "var(--n800)", maxWidth: 460 }}>A brand-new account gets ignored. An operator brings an aged, connected, credible profile that LinkedIn already trusts, so your outreach lands from day one.</p>
        </div>
        <div style={{ borderTop: "2px solid var(--ink)", minWidth: 0 }}>
          <div className="ey" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 12, padding: "12px 0", borderBottom: "2px solid var(--ink)" }}><span /><span style={{ color: "var(--n700)" }}>new account</span><span>an operator</span></div>
          {[["ready to send", "4–6 weeks", "day one"], ["network", "starts at 0", "500–10k+"], ["credibility", "cold", "aged + verified"], ["scale", "one at a time", "hire several"]].map(([k, a, b]) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 12, padding: "16px 0", borderBottom: "1px solid var(--divider)", alignItems: "baseline" }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{k}</span>
              <span style={{ fontSize: 18, color: "var(--n700)", textDecoration: "line-through" }}>{a}</span>
              <span style={{ fontSize: 18, fontWeight: 800 }}><span style={{ background: "var(--hl)", padding: "0 4px", boxShadow: "inset 0 -3px 0 var(--lime)" }}>{b}</span></span>
            </div>
          ))}
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section id="how" style={{ borderBottom: "2px solid var(--ink)" }}>
        <div className="wrap" style={{ paddingTop: "clamp(44px,6vw,76px)", paddingBottom: 28, display: "flex", flexWrap: "wrap", alignItems: "end", gap: 24, justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "clamp(38px,5.5vw,76px)", fontWeight: 800 }}>how it works</h2>
          <span style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--mono)" }}>browse → hire → launch · live in minutes</span>
        </div>
        <div className="cells c3">
          {[["01", "browse", "Filter operators by industry, location, connections and account age. Every one is a real, established, verified profile."], ["02", "hire", "Hire one or several, flat monthly fee each. No contracts, no setup fee. Scale up or down anytime."], ["03", "launch", "Go live from an established, secured profile and start landing with reach and trust from day one. Multiply your results, not your risk."]].map(([n, t, d], i) => (
            <div key={n} className="cell" style={i === 2 ? { borderRight: "none" } : undefined}>
              <span style={{ display: "inline-block", background: "var(--teal)", color: "var(--paper)", fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, padding: "4px 8px" }}>{n}</span>
              <h3 style={{ fontSize: 30, fontWeight: 800, margin: "14px 0 10px" }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--n800)" }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== OPERATORS / CATALOGUE TEASER ===== */}
      <section id="operators" style={{ background: "var(--ink)", color: "var(--paper)", borderBottom: "2px solid var(--ink)" }}>
        <div className="wrap" style={{ paddingTop: "clamp(44px,6vw,76px)", paddingBottom: 28, display: "flex", flexWrap: "wrap", alignItems: "end", gap: 24, justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ alignSelf: "flex-start", background: "var(--coral)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, padding: "5px 10px", textTransform: "uppercase", letterSpacing: "0.08em" }}>real people, real profiles</span>
            <h2 style={{ fontSize: "clamp(38px,5.5vw,76px)", fontWeight: 800 }}>meet the operators</h2>
          </div>
          <Link href="/catalogue" className="btn" style={{ background: "var(--lime)", color: "var(--ink)" }}><span>browse the full roster</span><span>→</span></Link>
        </div>
        {roster.length > 0 && (
          <div className="wrap" style={{ paddingBottom: "clamp(44px,6vw,76px)", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,220px),1fr))", gap: 0, borderTop: "2px solid var(--teal)" }}>
            {roster.map((p) => (
              <div key={p.id} style={{ borderRight: "2px solid var(--teal)", borderBottom: "2px solid var(--teal)" }}>
                <div style={{ position: "relative", aspectRatio: "4/5", background: "repeating-linear-gradient(45deg,#164851 0 8px,#123b43 8px 16px)", overflow: "hidden" }}>
                  {p.photo && (
                    // Real masked profile photo (self-hosted, same source as the catalogue avatars).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photo} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: p.rented ? "grayscale(0.85) contrast(0.98) brightness(0.82)" : "grayscale(0.4) contrast(1.02)" }} />
                  )}
                  {p.rented && (
                    // Honest social proof: rented/showcase profiles are clearly marked, never
                    // presented as hireable alongside the available operators above them.
                    <span style={{ position: "absolute", right: 10, top: 10, background: "var(--coral)", color: "var(--ink)", fontFamily: "var(--mono)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", padding: "3px 8px" }}>rented</span>
                  )}
                  <span style={{ position: "absolute", left: 10, bottom: 10, background: "rgba(7,42,50,0.82)", color: "#9cc3c7", fontFamily: "var(--mono)", fontSize: 11, padding: "3px 7px" }}>operator{p.industry ? " · " + p.industry.toLowerCase() : ""}</span>
                </div>
                <div style={{ padding: "12px 16px 16px" }}>
                  <div style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 17, textTransform: "lowercase" }}><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--coral)", marginRight: 7 }} />{p.name.toLowerCase()}</div>
                  <div style={{ fontSize: 13, color: "#9cc3c7", marginTop: 3 }}>{fmtConns(p.connections)} connections{p.verified ? " · verified" : ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== PRICING ===== */}
      <section id="pricing" style={{ borderBottom: "2px solid var(--ink)" }}>
        <div className="wrap" style={{ paddingTop: "clamp(44px,6vw,76px)", paddingBottom: 28, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="ey" style={{ color: "var(--accent-700)" }}>pricing</div>
          <h2 style={{ fontSize: "clamp(38px,5.5vw,76px)", fontWeight: 800 }}>simple pricing.</h2>
          <p style={{ margin: 0, fontSize: 16, color: "var(--n800)", maxWidth: 580 }}>Hire an established operator and run outreach from a profile LinkedIn already trusts. Flat monthly fee per operator, scale up or down anytime.</p>
        </div>
        <div className="cells" style={{ borderTop: "2px solid var(--ink)", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))" }}>
          <div className="cell" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontFamily: "var(--disp)", fontSize: 34, fontWeight: 800, textTransform: "lowercase" }}>self-serve</span><span className="ey" style={{ color: "var(--n700)" }}>you run it</span></div>
            <p style={{ margin: 0, fontSize: 15, color: "var(--n800)", lineHeight: 1.55 }}>Hire the operator and run your own campaigns. Go live in a secure environment in minutes, use your own targeting and tools.</p>
            <div style={{ fontFamily: "var(--disp)", fontSize: 42, fontWeight: 900 }}>from $45<span style={{ fontSize: 14, fontWeight: 700, display: "block" }}>per operator / month</span></div>
            <Link href="/catalogue" className="btn" style={{ marginTop: "auto" }}><span>browse operators</span><span>→</span></Link>
          </div>
        </div>
        <div className="wrap" style={{ paddingTop: 34, paddingBottom: 12 }}>
          <div className="ey" style={{ color: "var(--accent-700)" }}>self-serve · priced by the profile</div>
        </div>
        <div className="cells c3" style={{ borderTop: "2px solid var(--ink)" }}>
          {[
            { name: "entry", badge: "<500 conns", price: "$45", items: ["Newer profiles, lower connections", "Great for volume testing"], featured: false, cta: "browse entry" },
            { name: "established", badge: "most picked", price: "$75", items: ["Verified, 500+ connections", "Aged and outreach-ready"], featured: true, cta: "browse established" },
            { name: "premium", badge: "1k+ conns", price: "$110+", items: ["Senior titles, deep reach", "Our most credible profiles"], featured: false, cta: "browse premium" },
          ].map((t, i) => (
            <div key={t.name} className="cell" style={{ display: "flex", flexDirection: "column", gap: 18, ...(t.featured ? { background: "var(--hl)", boxShadow: "inset 0 6px 0 var(--lime)" } : {}), ...(i === 2 ? { borderRight: "none" } : {}) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontFamily: "var(--disp)", fontSize: 34, fontWeight: 800, textTransform: "lowercase" }}>{t.name}</span><span className="ey" style={t.featured ? undefined : { color: "var(--n700)" }}>{t.badge}</span></div>
              <div style={{ fontFamily: "var(--disp)", fontSize: 48, fontWeight: 900 }}>{t.price}<span style={{ fontSize: 15, fontWeight: 700, fontFamily: "inherit" }}>/mo</span></div>
              <div style={{ borderTop: "2px solid var(--ink)", fontSize: 15 }}>{t.items.map((it) => <div key={it} style={{ padding: "10px 0", borderBottom: "1px solid var(--divider)" }}>{it}</div>)}</div>
              <Link href="/catalogue" className="btn" style={{ marginTop: "auto" }}><span>{t.cta}</span><span>→</span></Link>
            </div>
          ))}
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section id="faq" className="wrap" style={{ paddingTop: "clamp(44px,6vw,76px)", paddingBottom: "clamp(44px,6vw,76px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))", gap: "clamp(28px,5vw,64px)", borderBottom: "2px solid var(--ink)" }}>
        <h2 style={{ fontSize: "clamp(38px,5.5vw,76px)", fontWeight: 800 }}>fair questions.</h2>
        <div style={{ borderTop: "2px solid var(--ink)" }}>
          {[
            ["whose profiles are these?", "Real professionals who opted in. Every operator is a consenting, verified person with an established network."],
            ["is it safe for the profile?", "Each operator works from a secure, dedicated environment inside safe sending limits, so activity stays consistent and the profile stays protected."],
            ["how soon can i start?", "Usually within minutes of hiring, once a quick one-time setup is done."],
            ["can i cancel?", "Yes. Flat monthly fee per operator, month to month, cancel anytime from your dashboard."],
          ].map(([q, a]) => (
            <div key={q} style={{ padding: "20px 0", borderBottom: "1px solid var(--divider)" }}>
              <div style={{ fontFamily: "var(--disp)", fontSize: 20, fontWeight: 800, textTransform: "lowercase" }}>{q}</div>
              <div style={{ fontSize: 15, lineHeight: 1.55, color: "var(--n800)", marginTop: 6 }}>{a}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== EARN BAND ===== */}
      <section style={{ background: "var(--lime)", borderBottom: "2px solid var(--ink)" }}>
        <div className="wrap" style={{ paddingTop: "clamp(40px,6vw,72px)", paddingBottom: "clamp(40px,6vw,72px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", gap: 28, alignItems: "center" }}>
          <div>
            <div className="ey" style={{ marginBottom: 14 }}>for professionals</div>
            <h2 style={{ fontSize: "clamp(34px,4.6vw,60px)", fontWeight: 900 }}>have a strong linkedin profile? get paid monthly.</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, fontWeight: 600, maxWidth: 460 }}>Become an operator and earn a fixed monthly payment. You stay in control, leave anytime after a light 6-month minimum, and your account stays secured.</p>
            <Link href="/become-ambassador" className="btn" style={{ alignSelf: "flex-start" }}><span>become an operator</span><span>→</span></Link>
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA ===== */}
      <section className="wrap" style={{ paddingTop: "clamp(56px,9vw,120px)", paddingBottom: "clamp(56px,9vw,120px)", display: "flex", flexDirection: "column", gap: 30 }}>
        <h2 style={{ fontSize: "clamp(48px,9vw,140px)", fontWeight: 900 }}>ready when you are.</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 22, alignItems: "center" }}>
          <Link href="/catalogue" className="btn" style={{ fontSize: 16, minWidth: 260 }}><span>browse operators</span><span>→</span></Link>
          <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--mono)" }}>or book a 15-min call →</a>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer style={{ background: "var(--footer)", color: "var(--paper)" }}>
        <div className="wrap" style={{ paddingTop: 28, paddingBottom: 28, display: "flex", flexWrap: "wrap", gap: 22, alignItems: "baseline", fontSize: 13 }}>
          <span style={{ fontFamily: "var(--disp)", fontWeight: 900, fontSize: 20, letterSpacing: "-0.05em", marginRight: "auto", textTransform: "lowercase", display: "inline-flex", alignItems: "center", gap: 9 }}>
            <svg width={26} height={26} viewBox="40 108 320 220" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
              <path d="M96 214 L200 128 L304 214" fill="none" stroke="#e4fb25" strokeWidth={40} strokeLinecap="square" />
              <path d="M96 282 L200 196 L304 282" fill="none" stroke="#ff7a59" strokeWidth={40} strokeLinecap="square" />
            </svg>
            <span>linkedarmy<span style={{ display: "inline-block", width: 6, height: 6, background: "var(--coral)", marginLeft: 2 }} /></span>
          </span>
          <a href="#how" style={{ color: "var(--paper)" }}>how it works</a>
          <a href="#operators" style={{ color: "var(--paper)" }}>operators</a>
          <a href="#pricing" style={{ color: "var(--paper)" }}>pricing</a>
          <a href="#faq" style={{ color: "var(--paper)" }}>faq</a>
          <span style={{ color: "#9cc3c7" }}>© 2026 linkedarmy.com</span>
        </div>
      </footer>
    </div>
  );
}
