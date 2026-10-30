import Link from "next/link";
import type { Metadata } from "next";
import { Montserrat, Karla } from "next/font/google";
import { getBrand } from "@/lib/brand";

const heading = Montserrat({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-heading" });
const body = Karla({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return {
    title: isArmy
      ? `Operator Guide — How it works & using LinkedIn safely | ${brand.name}`
      : "Renter Guide — How it works & using LinkedIn safely | LinkedVelocity",
    description: isArmy
      ? `Everything you need to hire a LinkedIn operator on ${brand.name}: setting up GoLogin, daily limits, what to expect, do's & don'ts, and using your operator safely.`
      : "Everything you need to rent a LinkedIn account on LinkedVelocity: setting up GoLogin, daily limits, what to expect, do's & don'ts, and using your rented account safely.",
  };
}

export default async function GuidePage() {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  const B = brand.name;
  const tgHandle = (brand.supportTelegram || "").replace(/^@/, "");

  const STEPS = [
    { n: "1", title: isArmy ? "Sign up & browse the roster" : "Sign up & browse the catalogue", body: `Create your account on ${brand.domain} and browse available profiles. Each listing shows the ${isArmy ? "operator" : "account"}'s location, connection count, and industry.` },
    { n: "2", title: isArmy ? "Select an operator & pay" : "Select an account & pay", body: `Choose the ${isArmy ? "operator" : "account"} that fits your target audience and pay securely (card or wallet). It's reserved for you and you'll get a confirmation email straight away.` },
    { n: "3", title: "Set up GoLogin (or sign in if you have it)", body: `GoLogin is the tool that gives you secure access to ${isArmy ? "your operator's profile" : "the rented account"}. Install it and sign in with the same email you used here (steps below). Already have GoLogin? Just make sure you're signed in with this email.` },
    { n: "4", title: "Open it instantly", body: "It's ready right away — from your dashboard, click 'Open in GoLogin' and the profile opens with LinkedIn already logged in. No waiting." },
    { n: "5", title: "Run your outreach campaign", body: "You're live! Open the profile in GoLogin (LinkedIn already logged in) and start sending connection requests and messages. Your Account Guide covers the daily limits to keep the profile healthy." },
    { n: "6", title: "Renew or cancel", body: `${isArmy ? "Operators" : "Accounts"} renew monthly. You'll get a reminder before your next billing date — cancel any time before renewal if you no longer need it.` },
  ];

  const GET = isArmy
    ? [
        "A real, established LinkedIn operator with genuine connections and history",
        "Secure access through GoLogin's anti-detect browser — same proxy, cookies and fingerprint every time",
        "Simultaneous access (you and the operator never clash)",
        "Pause, resume and cancellation handled by us if anything comes up",
      ]
    : [
        "A real, aged LinkedIn account with established connections and history",
        "Secure access through GoLogin's anti-detect browser — same proxy, cookies and fingerprint every time",
        "Simultaneous access (you and the owner never clash)",
        "Pause, resume and cancellation handled by us if anything comes up",
      ];

  const GOLOGIN_STEPS = [
    `Go to gologin.com and create a free account using the same email you registered with on ${B}.`,
    "Download and install the GoLogin desktop app on your computer.",
    "Open the app and log in with your GoLogin account.",
    `Your ${isArmy ? "operator's" : "rented"} profile will appear automatically in your dashboard — we share it directly to your account.`,
    "Click 'Run' on the profile to open a browser session.",
    "The LinkedIn account loads automatically — you're now logged in securely.",
  ];

  return (
    <div className={`${heading.variable} ${body.variable}`} style={{ fontFamily: "var(--font-body),system-ui,sans-serif", color: "#0F1419", background: "#FAFAF8" }}>
      <style>{`
        .g-h{font-family:var(--font-heading),system-ui,sans-serif;letter-spacing:-0.02em}
        .g-wrap{max-width:880px;margin:0 auto;padding:0 24px}
        .g-card{background:#fff;border:1px solid #E8E6E1;border-radius:16px;padding:24px 26px}
        .g-hl{color:#34d399}
        .g-limit-row{display:grid;grid-template-columns:1fr 1.4fr;gap:16px;padding:14px 0;border-bottom:1px solid #F0EFEB;font-size:14.5px}
        .g-limit-row:last-child{border-bottom:none}
        @media(max-width:680px){.g-grid{grid-template-columns:1fr !important}.g-limit-row{grid-template-columns:1fr;gap:2px}}
      `}</style>

      {/* Hero */}
      <section style={{ background: "radial-gradient(circle at 50% 14%,#103a6b 0%,#0B1A2E 64%)", color: "#fff", padding: "72px 24px 64px", textAlign: "center" }}>
        <div className="g-wrap">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "6px 14px", marginBottom: 18 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#34d399" }} /> {isArmy ? "Operator guide" : "Renter guide"}
          </div>
          <h1 className="g-h" style={{ fontSize: "clamp(32px,5vw,48px)", fontWeight: 800, margin: "0 auto 14px", maxWidth: 660 }}>{isArmy ? "How hiring works" : "How renting works"} — and using LinkedIn <span className="g-hl">safely with us</span></h1>
          <p style={{ fontSize: 17, color: "rgba(255,255,255,0.82)", maxWidth: 560, margin: "0 auto", lineHeight: 1.6 }}>Everything you need to get started, run your first campaign, and keep your {isArmy ? "operator" : "rented account"} healthy. Give it a read before you begin.</p>
        </div>
      </section>

      {/* What is <brand> */}
      <section style={{ padding: "56px 0 0" }}>
        <div className="g-wrap">
          <h2 className="g-h" style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>What is {B}?</h2>
          <p style={{ fontSize: 15.5, color: "#374151", lineHeight: 1.7, margin: "0 0 12px" }}>
            {B} is a B2B marketplace that gives your sales team access to additional LinkedIn {isArmy ? "operators" : "accounts"} — so you can run outreach at greater scale without creating new profiles or hiring more people.
          </p>
          <p style={{ fontSize: 15.5, color: "#374151", lineHeight: 1.7, margin: 0 }}>
            {isArmy
              ? "You hire an established LinkedIn operator and use their profile to send connection requests and messages to your target audience. Simple as that."
              : "You rent access to a real, established LinkedIn profile and use it to send connection requests and messages to your target audience. Simple as that."}
          </p>
        </div>
      </section>

      {/* Steps */}
      <section style={{ padding: "48px 0 0" }}>
        <div className="g-wrap">
          <h2 className="g-h" style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>How it works, start to finish</h2>
          <div style={{ display: "grid", gap: 14 }}>
            {STEPS.map((s) => (
              <div key={s.n} className="g-card" style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
                <div className="g-h" style={{ flex: "0 0 40px", width: 40, height: 40, borderRadius: 11, background: "linear-gradient(135deg,#0A66C2,#004182)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16 }}>{s.n}</div>
                <div>
                  <h3 className="g-h" style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{s.title}</h3>
                  <p style={{ fontSize: 15, color: "#536471", lineHeight: 1.6, margin: 0 }}>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GoLogin setup */}
      <section style={{ padding: "48px 0 0" }}>
        <div className="g-wrap">
          <div className="g-card" style={{ background: "#F3F8FE", borderColor: "#D6E3F2" }}>
            <h2 className="g-h" style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "#0A66C2" }}>Setting up GoLogin</h2>
            <p style={{ fontSize: 15, color: "#374151", lineHeight: 1.7, margin: "0 0 16px" }}>
              GoLogin is what lets you securely access {isArmy ? "your operator's profile" : "the rented account"} without triggering any flags — LinkedIn always sees one consistent device, proxy and fingerprint. <strong>Use the same email you registered with on {B}</strong> — that&apos;s how we share your profile directly to your account.
            </p>
            <ol style={{ fontSize: 15, color: "#374151", lineHeight: 1.85, margin: "0 0 18px", paddingLeft: 20 }}>
              {GOLOGIN_STEPS.map((s) => <li key={s}>{s}</li>)}
            </ol>
            <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10, padding: "12px 14px", marginBottom: 18, fontSize: 14, color: "#9A3412", lineHeight: 1.6 }}>
              <strong>Important:</strong> Always access the account through GoLogin. Never log in directly on linkedin.com or the LinkedIn phone app — this can trigger a security flag on the account.
            </div>
            <a href="https://gologin.com/download" target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", background: "#0A66C2", color: "#fff", textDecoration: "none", fontWeight: 600, fontSize: 14, padding: "12px 22px", borderRadius: 10 }}>Download GoLogin</a>
          </div>
        </div>
      </section>

      {/* Using your account — pointer to the Account Guide */}
      <section style={{ padding: "48px 0 0" }}>
        <div className="g-wrap">
          <div className="g-card" style={{ background: "#F3F8FE", borderColor: "#D6E3F2", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
            <div>
              <h2 className="g-h" style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: "#0A66C2" }}>Using your account day-to-day</h2>
              <p style={{ fontSize: 15, color: "#374151", lineHeight: 1.6, margin: 0, maxWidth: 520 }}>Once you&apos;re {isArmy ? "set up" : "renting"}, your <strong>Account Guide</strong> has everything you need: daily limits, do&apos;s &amp; don&apos;ts, and exactly what happens if an account ever gets restricted.</p>
            </div>
            <Link href="/account-guide-v2" style={{ background: "#0A66C2", color: "#fff", textDecoration: "none", fontWeight: 600, fontSize: 14, padding: "12px 22px", borderRadius: 10, whiteSpace: "nowrap" }}>Open the Account Guide →</Link>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section style={{ padding: "48px 0 0" }}>
        <div className="g-wrap">
          <h2 className="g-h" style={{ fontSize: 28, fontWeight: 700, marginBottom: 20 }}>What you get</h2>
          <div className="g-card">
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
              {GET.map((g) => (
                <li key={g} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 15, color: "#374151", lineHeight: 1.5 }}>
                  <span style={{ flex: "0 0 20px", width: 20, height: 20, borderRadius: "50%", background: "#E6F9EE", color: "#00B85C", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, marginTop: 1 }}>✓</span>
                  {g}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Pricing & billing */}
      <section style={{ padding: "48px 0 0" }}>
        <div className="g-wrap">
          <h2 className="g-h" style={{ fontSize: 28, fontWeight: 700, marginBottom: 20 }}>Pricing &amp; billing</h2>
          <div className="g-card">
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
              {[
                `${isArmy ? "Operators" : "Accounts"} are billed monthly from your start date.`,
                "Payment is processed automatically (card via Stripe, or from your wallet balance).",
                "You'll receive a reminder before your renewal date.",
                "To cancel, turn off renewal (or notify us) at least 48 hours before your renewal date.",
                `Volume discounts available for 10+ ${isArmy ? "operators" : "accounts"} — contact us to discuss.`,
              ].map((p) => (
                <li key={p} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 15, color: "#374151", lineHeight: 1.5 }}>
                  <span style={{ flex: "0 0 6px", width: 6, height: 6, borderRadius: "50%", background: "#0A66C2", marginTop: 8 }} />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Need help / CTA */}
      <section style={{ padding: "48px 24px 80px" }}>
        <div className="g-wrap">
          <div className="g-card" style={{ textAlign: "center", padding: "40px 26px" }}>
            <h2 className="g-h" style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Need help?</h2>
            <p style={{ fontSize: 15, color: "#536471", margin: "0 0 6px", lineHeight: 1.6 }}>We&apos;re here to make sure your campaigns run smoothly. Reach out any time.</p>
            <p style={{ fontSize: 14, color: "#8899A6", margin: "0 0 22px" }}>Telegram <a href={`https://t.me/${tgHandle}`} target="_blank" rel="noopener noreferrer" style={{ color: "#0A66C2", fontWeight: 700, textDecoration: "none" }}>{brand.supportTelegram}</a> &nbsp;·&nbsp; Response within a few hours during business hours</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/catalogue" style={{ background: "#0A66C2", color: "#fff", textDecoration: "none", fontWeight: 600, fontSize: 14, padding: "12px 22px", borderRadius: 10 }}>{isArmy ? "Browse operators" : "Browse accounts"}</Link>
              <Link href="/dashboard" style={{ background: "#F3F2EE", color: "#0F1419", textDecoration: "none", fontWeight: 600, fontSize: 14, padding: "12px 22px", borderRadius: 10 }}>Go to dashboard</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
