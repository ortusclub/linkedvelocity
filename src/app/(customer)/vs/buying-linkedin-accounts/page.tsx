import type { Metadata } from "next";
import Link from "next/link";
import { getBrand } from "@/lib/brand";
import { CompareStyle } from "../compare-style";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return {
    title: isArmy
      ? "Hiring an Operator vs Buying LinkedIn Accounts — Why Hiring Is Safer"
      : "Renting vs Buying LinkedIn Accounts — Why Renting Is Safer",
    description: isArmy
      ? "Comparing hiring a verified LinkedIn operator (via LinkedArmy) to buying accounts outright. Buying violates LinkedIn's terms, exposes you to permanent bans, and offers no recovery if the account dies. Hiring an established operator in a secure session sidesteps all three risks."
      : "Comparing renting LinkedIn accounts (via LinkedVelocity) to buying them outright. Buying violates LinkedIn's terms, exposes you to permanent bans, and offers no recovery if the account dies. Renting via GoLogin browser sessions sidesteps all three risks.",
    alternates: { canonical: "/vs/buying-linkedin-accounts" },
    openGraph: {
      title: isArmy
        ? "Hiring an Operator vs Buying LinkedIn Accounts — Side-by-Side"
        : "Renting vs Buying LinkedIn Accounts — Side-by-Side",
      description: isArmy
        ? "Why hiring a verified LinkedIn operator through LinkedArmy is safer, cheaper, and faster than buying accounts on marketplaces."
        : "Why renting LinkedIn accounts through LinkedVelocity is safer, cheaper, and faster than buying accounts on marketplaces.",
      url: `${brand.url}/vs/buying-linkedin-accounts`,
    },
  };
}

export default async function BuyingVsRentPage() {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  const B = brand.name;
  const U = brand.url;

  const comparison = [
    { feature: "LinkedIn TOS compliance", good: isArmy ? "Compliant — the operator keeps and owns their profile" : "Compliant — account is never transferred", alt: "Violates LinkedIn TOS (account sales prohibited)" },
    { feature: "Risk of permanent ban", good: "0% restriction rate to date", alt: "High — flagged accounts get permanently banned" },
    { feature: isArmy ? "Recovery if an operator is lost" : "Recovery if account dies", good: isArmy ? "Swap to another operator in your dashboard" : "Swap to another account in your dashboard", alt: "You lose the full purchase price" },
    { feature: "Upfront cost", good: "$45-110/month, cancel anytime", alt: "$100-2,000+ per account, non-refundable" },
    { feature: isArmy ? "Warm-up period" : "Account warming period", good: isArmy ? "None — operators are established and active" : "None — accounts are pre-warmed and active", alt: "1-3 months before safe for outreach" },
    { feature: "Verification & 2FA", good: isArmy ? "Already verified, handled in a secure session" : "Already verified, 2FA handled in GoLogin session", alt: "Often unverified, 2FA disputes common" },
    { feature: "Profile content control", good: isArmy ? "The operator curates their own real profile" : "Original owner curates profile (looks real)", alt: "You inherit a fake or abandoned profile" },
    { feature: "Time to first message sent", good: "Same day", alt: "Weeks — buy, warm, verify, then send" },
  ];

  const faqs = [
    {
      q: "Why is buying LinkedIn accounts risky?",
      a: isArmy
        ? "Account sales violate LinkedIn's User Agreement (Section 8.2). When LinkedIn detects a sold account — usually via login location, IP, or device fingerprint changes — they permanently restrict it. You lose both the account and whatever you paid. LinkedArmy sidesteps this: you run outreach from a verified operator's profile that stays with its original owner and is never transferred."
        : "Account sales violate LinkedIn's User Agreement (Section 8.2). When LinkedIn detects a sold account — usually via login location, IP, or device fingerprint changes — they permanently restrict it. You lose both the account and whatever you paid. LinkedVelocity sidesteps this by renting access to active accounts that stay with their original owner.",
    },
    {
      q: isArmy ? "What happens if an operator gets restricted?" : "What happens if a rented account gets restricted?",
      a: isArmy
        ? "Across thousands of engagements, LinkedArmy has maintained a 0% restriction rate thanks to isolated sessions and dedicated residential proxies. If an operator is ever restricted while you're working with them, you can switch to another available operator from your dashboard at no extra cost."
        : "Across thousands of rentals, LinkedVelocity has maintained a 0% restriction rate thanks to isolated GoLogin sessions and dedicated residential proxies. If an account is ever restricted while you're renting it, you can switch to another available account from your dashboard at no extra cost.",
    },
    {
      q: isArmy ? "Isn't hiring an operator more expensive than buying an account?" : "Aren't rented accounts more expensive than bought ones?",
      a: isArmy
        ? "Only if you measure single-month cost. A bought account typically costs $200-2,000 upfront and may die before you recoup the value. Hiring at $45-110/month means you only pay while it's producing results, and you can cancel anytime."
        : "Only if you measure single-month cost. A bought account typically costs $200-2,000 upfront and may die before you recoup the value. Renting at $45-110/month means you only pay while the account is producing results, and you can cancel anytime.",
    },
    {
      q: isArmy ? "Can I run automation tools from an operator?" : "Can I run automation tools on a rented account?",
      a: isArmy
        ? "Yes — you work inside a real Chrome session, so any LinkedIn automation tool works: Dripify, Expandi, Linked Helper, Phantombuster, Lemlist's LinkedIn module, and any Chrome extension you'd normally install."
        : "Yes — rented accounts run inside a real Chrome session (via GoLogin), so any LinkedIn automation tool works: Dripify, Expandi, Linked Helper, Phantombuster, Lemlist's LinkedIn module, and any Chrome extension you'd normally install.",
    },
  ];

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: U },
      { "@type": "ListItem", position: 2, name: "Comparisons", item: `${U}/vs` },
      { "@type": "ListItem", position: 3, name: "vs Buying LinkedIn Accounts", item: `${U}/vs/buying-linkedin-accounts` },
    ],
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <>
      <CompareStyle />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <div className="vs-page">
        <div className="vs-crumb">
          <Link href="/">Home</Link> · <Link href="/how-it-works">How It Works</Link> · vs Buying Accounts
        </div>

        <header className="vs-header">
          <div className="vs-label">Comparison</div>
          <h1 className="vs-title">{isArmy ? "Hiring an operator vs buying LinkedIn accounts" : "Renting vs buying LinkedIn accounts"}</h1>
          <p className="vs-subtitle">
            {isArmy ? (
              <>
                Buying a LinkedIn account is the fastest way to lose money to a permanent ban.
                LinkedIn explicitly prohibits account sales — every bought account is on borrowed
                time. Hiring a verified {B} operator gets you the same outreach reach, from an
                established profile LinkedIn already trusts, at a fraction of the upfront cost,
                with a 0% restriction rate to date.
              </>
            ) : (
              <>
                Buying a LinkedIn account is the fastest way to lose money to a permanent ban.
                LinkedIn explicitly prohibits account sales — every bought account is on borrowed
                time. Renting via LinkedVelocity gets you the same outreach capacity, legally, at a
                fraction of the upfront cost, with a 0% restriction rate to date.
              </>
            )}
          </p>
        </header>

        <div className="vs-verdict">
          <span className="vs-verdict-label">TL;DR</span>
          <p>
            {isArmy ? (
              <>
                <strong>Hire, don&apos;t buy.</strong> Buying violates LinkedIn&apos;s terms and
                usually ends in a permanent restriction within weeks. Hiring through {B} means you
                work from an established operator&apos;s profile in an isolated browser session,
                and costs $45-110/month with no upfront risk.
              </>
            ) : (
              <>
                <strong>Rent, don&apos;t buy.</strong> Buying violates LinkedIn&apos;s terms and
                usually ends in a permanent restriction within weeks. Renting through LinkedVelocity
                keeps the account with its original owner, runs in an isolated browser session,
                and costs $45-110/month with no upfront risk.
              </>
            )}
          </p>
        </div>

        <section className="vs-table-section">
          <h2>Side by side</h2>
          <div className="vs-table-wrap">
            <table className="vs-table">
              <thead>
                <tr><th></th><th>{B} ({brand.term.verbLower})</th><th>Buying accounts</th></tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.feature}>
                    <td className="vs-feature">{row.feature}</td>
                    <td className="vs-good">{row.good}</td>
                    <td className="vs-bad">{row.alt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="vs-detail">
          <h2>Why buying is structurally broken</h2>
          <p>
            LinkedIn&apos;s detection model is built around login behaviour, not profile
            content. When a sold account suddenly logs in from a new country, browser, or
            device, LinkedIn flags it within days. The buyer has no recourse — the seller is
            usually anonymous, payment is irreversible (often crypto), and the account is
            gone forever.
          </p>
          <h2>{isArmy ? "Why hiring works" : "Why renting works"}</h2>
          <p>
            {isArmy ? (
              <>
                {B} gives you a managed, isolated session on an established operator&apos;s
                profile — you&apos;re not buying or taking over anything. The operator&apos;s
                credentials, recovery email, and 2FA stay with them. You work through a secure
                browser profile on a dedicated residential proxy in the operator&apos;s region.
                From LinkedIn&apos;s perspective, nothing unusual is happening.
              </>
            ) : (
              <>
                LinkedVelocity rents the <em>session</em>, not the account. The original
                owner&apos;s credentials, recovery email, and 2FA stay with them. The renter
                accesses the account through a managed GoLogin browser profile with a dedicated
                residential proxy in the same region as the owner. From LinkedIn&apos;s
                perspective, nothing unusual is happening.
              </>
            )}
          </p>
          <h2>{isArmy ? "The cost math favours hiring" : "The cost math actually favours renting"}</h2>
          <p>
            A $500 bought account that dies after six weeks costs ~$80/week. A comparable
            {" "}{B} {isArmy ? "operator" : "rental"} at $50/month costs ~$12/week, with no
            upfront risk and no account-death cliff. If outreach doesn&apos;t work, you cancel.
          </p>
        </section>

        <section className="vs-faq">
          <h2>FAQs</h2>
          {faqs.map((f) => (
            <details key={f.q} className="vs-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>

        <section className="vs-cta">
          <h2>{isArmy ? "Browse available operators" : "Browse rentable accounts"}</h2>
          <p>Filter by industry, connection count, and Sales Navigator. No upfront fee. Cancel anytime.</p>
          <div className="vs-cta-row">
            <Link href="/catalogue" className="vs-btn-primary">{isArmy ? "Browse Operators →" : "Browse Catalogue →"}</Link>
            <Link href="/how-it-works" className="vs-btn-secondary">How {B} Works</Link>
          </div>
        </section>
      </div>
    </>
  );
}
