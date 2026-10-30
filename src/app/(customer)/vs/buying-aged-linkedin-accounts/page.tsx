import type { Metadata } from "next";
import Link from "next/link";
import { getBrand } from "@/lib/brand";
import { CompareStyle } from "../compare-style";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return {
    title: isArmy
      ? "Buying Aged LinkedIn Accounts vs Hiring an Operator on LinkedArmy"
      : "Buying Aged LinkedIn Accounts vs Renting on LinkedVelocity",
    description: isArmy
      ? "Aged LinkedIn accounts sold on forums and marketplaces seem like a shortcut — but they violate LinkedIn's terms, get banned fast, and cost $200-2,000+ with no refund. Hiring a verified operator through LinkedArmy is safer, cheaper, and reversible."
      : "Aged LinkedIn accounts sold on forums and marketplaces seem like a shortcut — but they violate LinkedIn's terms, get banned fast, and cost $200-2,000+ with no refund. Renting through LinkedVelocity is safer, cheaper, and reversible.",
    alternates: { canonical: "/vs/buying-aged-linkedin-accounts" },
    openGraph: {
      title: isArmy
        ? "Buying Aged LinkedIn Accounts vs Hiring via LinkedArmy"
        : "Buying Aged LinkedIn Accounts vs Renting via LinkedVelocity",
      description: "Why buying aged LinkedIn accounts from forums is risky and what to do instead.",
      url: `${brand.url}/vs/buying-aged-linkedin-accounts`,
    },
  };
}

export default async function BuyingAgedVsRentPage() {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  const B = brand.name;
  const U = brand.url;

  const comparison = [
    { feature: "LinkedIn TOS", good: "Compliant — no ownership transfer", alt: "Violates Section 8.2 (account sales prohibited)" },
    { feature: "Account origin", good: isArmy ? "Real professionals who work as verified operators" : "Real professionals who voluntarily share access", alt: "Often stolen, hacked, or abandoned accounts" },
    { feature: "Seller accountability", good: `${B} manages the relationship, support, and refunds`, alt: "Anonymous sellers on forums — no recourse after payment" },
    { feature: "Account survival", good: isArmy ? "0% restriction rate across all engagements" : "0% restriction rate across all rentals", alt: "Most bought accounts get flagged within 2-6 weeks" },
    { feature: "Price", good: "$45-110/month, cancel anytime", alt: "$200-2,000+ one-time, non-refundable" },
    { feature: isArmy ? "If an operator is lost" : "If the account dies", good: isArmy ? "Swap to another operator from your dashboard" : "Swap to another account from your dashboard", alt: "Total loss — seller won't refund" },
    { feature: "Profile authenticity", good: isArmy ? "The operator maintains their own profile (real photo, real history)" : "Original owner maintains the profile (real photo, real history)", alt: "Abandoned profile with stale content, mismatched industry" },
    { feature: "Account credentials", good: isArmy ? "The operator keeps credentials — you get a managed browser session" : "Owner keeps credentials — renter gets managed browser session", alt: "Buyer gets password — but seller may still have access" },
    { feature: "Payment safety", good: "Stripe or USDC — standard payment protection", alt: "Usually crypto or wire to anonymous accounts — irreversible" },
  ];

  const faqs = [
    {
      q: "Where do aged LinkedIn accounts come from?",
      a: "Most aged accounts sold on forums, Telegram groups, and underground marketplaces come from three sources: hacked accounts where the original owner lost access, abandoned accounts harvested through credential stuffing attacks, and accounts created in bulk years ago by farms and left to age. None of these sources provide accounts that will survive LinkedIn's detection systems long-term.",
    },
    {
      q: isArmy ? "Why do aged accounts get banned even with an anti-detect browser?" : "Why do aged accounts get banned even with GoLogin?",
      a: "An anti-detect browser protects the browser fingerprint, but LinkedIn also monitors account-level signals: sudden changes in messaging patterns, connection-request velocity that doesn't match historical behaviour, and login from a new region (even with a residential proxy, the account's historical IP region is different). When LinkedIn detects an ownership transfer — which is what buying an account is — the account gets permanently restricted regardless of browser technology.",
    },
    {
      q: isArmy ? "Isn't hiring the same as buying from LinkedIn's perspective?" : "Isn't renting the same as buying from LinkedIn's perspective?",
      a: isArmy
        ? "No. When you buy an account, the original owner loses access and the buyer takes over completely — this is account transfer, which LinkedIn explicitly prohibits. When you hire an operator through LinkedArmy, the operator keeps their credentials and continues using the account normally. You work through a separate, isolated browser session. LinkedIn sees two sessions from the same user's usual behaviour pattern, not a transfer of ownership."
        : "No. When you buy an account, the original owner loses access and the buyer takes over completely — this is account transfer, which LinkedIn explicitly prohibits. When you rent through LinkedVelocity, the original owner keeps their credentials and continues using the account normally. The renter gets a separate browser session via GoLogin. LinkedIn sees two sessions from the same user's usual behaviour pattern, not a transfer of ownership.",
    },
    {
      q: isArmy ? "I found aged accounts for $50 — isn't that cheaper than hiring?" : "I found aged accounts for $50 — isn't that cheaper than renting?",
      a: isArmy
        ? "Only if the account survives. At a 70%+ ban rate within 6 weeks, a $50 account costs ~$8/week for 6 weeks of use — and then it's gone. A comparable LinkedArmy operator at $45/month is ~$11/week, with no expiry risk and instant replacement if anything goes wrong. You pay slightly more per week for reach that won't vanish and take your campaigns down with it."
        : "Only if the account survives. At a 70%+ ban rate within 6 weeks, a $50 account costs ~$8/week for 6 weeks of use — and then it's gone. A comparable LinkedVelocity rental at $45/month is ~$11/week, with no expiry risk and instant replacement if anything goes wrong. You pay slightly more per week for an account that won't vanish and take your campaigns down with it.",
    },
    {
      q: "Can the original owner reclaim a bought account?",
      a: isArmy
        ? "Yes. LinkedIn's account recovery process favours the person who created the account. If the original owner (or a hacker who originally stole the account) submits a recovery request with the original email or phone number, LinkedIn will lock the buyer out. With LinkedArmy, this isn't a risk — the operator is a willing participant who earns monthly income from the arrangement."
        : "Yes. LinkedIn's account recovery process favours the person who created the account. If the original owner (or a hacker who originally stole the account) submits a recovery request with the original email or phone number, LinkedIn will lock the buyer out. With LinkedVelocity rentals, this isn't a risk — the owner is a willing participant who earns monthly income from the arrangement.",
    },
  ];

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: U },
      { "@type": "ListItem", position: 2, name: "Comparisons", item: `${U}/vs` },
      { "@type": "ListItem", position: 3, name: "vs Buying Aged Accounts", item: `${U}/vs/buying-aged-linkedin-accounts` },
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
          <Link href="/">Home</Link> · <Link href="/vs">Comparisons</Link> · vs Buying Aged Accounts
        </div>

        <header className="vs-header">
          <div className="vs-label">Comparison</div>
          <h1 className="vs-title">{isArmy ? "Buying aged LinkedIn accounts vs hiring an operator" : "Buying aged LinkedIn accounts vs renting through LinkedVelocity"}</h1>
          <p className="vs-subtitle">
            {isArmy ? (
              <>
                Aged LinkedIn accounts are sold on forums, Telegram groups, and underground
                marketplaces for $200-2,000+. They promise instant outreach capacity — but
                most get banned within weeks, the sellers are anonymous, and your money is
                gone. Here&apos;s why hiring an operator is the better path.
              </>
            ) : (
              <>
                Aged LinkedIn accounts are sold on forums, Telegram groups, and underground
                marketplaces for $200-2,000+. They promise instant outreach capacity — but
                most get banned within weeks, the sellers are anonymous, and your money is
                gone. Here&apos;s why renting is the better path.
              </>
            )}
          </p>
        </header>

        <div className="vs-verdict">
          <span className="vs-verdict-label">TL;DR</span>
          <p>
            {isArmy ? (
              <>
                <strong>Buying aged accounts is gambling with bad odds.</strong> Most get
                banned within 6 weeks, sellers are anonymous, and refunds don&apos;t exist.
                {" "}{B} lets you work from real operators&apos; profiles for $45-110/month with a
                0% restriction rate and instant swaps if anything goes wrong.
              </>
            ) : (
              <>
                <strong>Buying aged accounts is gambling with bad odds.</strong> Most get
                banned within 6 weeks, sellers are anonymous, and refunds don&apos;t exist.
                LinkedVelocity rents real accounts from willing owners for $45-110/month with a
                0% restriction rate and instant swaps if anything goes wrong.
              </>
            )}
          </p>
        </div>

        <section className="vs-table-section">
          <h2>Side by side</h2>
          <div className="vs-table-wrap">
            <table className="vs-table">
              <thead>
                <tr><th></th><th>{B} ({brand.term.verbLower})</th><th>Buying aged accounts</th></tr>
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
          <h2>Why aged accounts seem appealing</h2>
          <p>
            The logic is straightforward: an account created 5+ years ago with 2,000+
            connections looks established to LinkedIn and should be safe for outreach.
            And that&apos;s true — for the original owner. The problem is that buying
            the account triggers a chain of ownership-transfer signals that LinkedIn
            is specifically trained to detect.
          </p>
          <h2>How LinkedIn detects account transfers</h2>
          <p>
            LinkedIn monitors login location history, device fingerprints, messaging
            patterns, and connection-request behaviour. An account that logged in from
            London for 5 years and suddenly starts sending 50 connection requests per
            day from a New York IP — even with a residential proxy — trips multiple
            detection layers. The account gets flagged, then restricted, then
            permanently banned. This typically happens within 2-6 weeks of purchase.
          </p>
          <h2>{isArmy ? "Why hiring avoids these signals" : "Why renting avoids these signals"}</h2>
          <p>
            {isArmy ? (
              <>
                Hiring an operator doesn&apos;t involve ownership transfer. The operator
                keeps the account, keeps logging in, keeps their regular activity pattern.
                You access the account through a separate, isolated browser session with a
                residential proxy in the operator&apos;s region. To LinkedIn, it looks like
                the same person using a second device — not a new owner taking over.
              </>
            ) : (
              <>
                LinkedVelocity rentals don&apos;t involve ownership transfer. The original owner
                keeps the account, keeps logging in, keeps their regular activity pattern.
                The renter accesses the account through a separate GoLogin browser session
                with a residential proxy in the owner&apos;s region. To LinkedIn, it looks
                like the same person using a second device — not a new owner taking over.
              </>
            )}
          </p>
          <h2>The economics</h2>
          <p>
            {isArmy ? (
              <>
                A $500 aged account that gets banned after 4 weeks costs $125/week with
                zero recovery options. A comparable {B} operator at $50/month costs
                $12.50/week, includes a secure browser session and proxy, and can be swapped
                instantly if anything goes wrong. Over 6 months, hiring saves 80%+
                versus buying replacements.
              </>
            ) : (
              <>
                A $500 aged account that gets banned after 4 weeks costs $125/week with
                zero recovery options. A comparable LinkedVelocity rental at $50/month costs
                $12.50/week, includes a GoLogin browser and proxy, and can be swapped
                instantly if anything goes wrong. Over 6 months, the rental saves 80%+
                versus buying replacements.
              </>
            )}
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
          <h2>{isArmy ? "Hire real operators. Skip the risk." : "Rent real accounts. Skip the risk."}</h2>
          <p>{isArmy ? "Verified operators from real professionals. Secure browser session + residential proxy included. Cancel anytime." : "847+ verified accounts from real professionals. GoLogin browser + residential proxy included. Cancel anytime."}</p>
          <div className="vs-cta-row">
            <Link href="/catalogue" className="vs-btn-primary">{isArmy ? "Browse Operators →" : "Browse Accounts →"}</Link>
            <Link href="/how-it-works" className="vs-btn-secondary">How {B} Works</Link>
          </div>
        </section>
      </div>
    </>
  );
}
