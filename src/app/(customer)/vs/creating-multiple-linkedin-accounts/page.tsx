import type { Metadata } from "next";
import Link from "next/link";
import { getBrand } from "@/lib/brand";
import { CompareStyle } from "../compare-style";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return {
    title: isArmy
      ? "Creating Multiple LinkedIn Accounts vs Hiring Operators on LinkedArmy"
      : "Creating Multiple LinkedIn Accounts vs Renting on LinkedVelocity",
    description: isArmy
      ? "Creating multiple LinkedIn accounts yourself means 3+ months of warming, constant ban risk, and managing fake personas. LinkedArmy gives you established, real operators in minutes — no warming, no fake profiles, no ban risk."
      : "Creating multiple LinkedIn accounts yourself means 3+ months of warming, constant ban risk, and managing fake personas. LinkedVelocity gives you pre-warmed, real accounts in minutes — no warming, no fake profiles, no ban risk.",
    alternates: { canonical: "/vs/creating-multiple-linkedin-accounts" },
    openGraph: {
      title: isArmy
        ? "Creating Multiple LinkedIn Accounts vs Hiring via LinkedArmy"
        : "Creating Multiple LinkedIn Accounts vs Renting via LinkedVelocity",
      description: "Why DIY multi-account setups fail and what to do instead.",
      url: `${brand.url}/vs/creating-multiple-linkedin-accounts`,
    },
  };
}

export default async function CreatingMultiVsRentPage() {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  const B = brand.name;
  const U = brand.url;

  const comparison = [
    { feature: "Time to first message sent", good: "Same day", alt: "8-12 weeks of warming per account" },
    { feature: "Account legitimacy", good: "Real, established profiles with real connections", alt: "Fake personas — easy for LinkedIn to detect" },
    { feature: "Warming required", good: isArmy ? "None — operators are already established" : "None — accounts are already pre-warmed", alt: "Daily profile views, post engagement, slow connection growth" },
    { feature: "Connection-request acceptance rate", good: "Normal (15-30% on quality lists)", alt: "Very low — new accounts get ignored or flagged as spam" },
    { feature: "Account survival rate", good: isArmy ? "0% restriction across all engagements to date" : "0% restriction across all rentals to date", alt: "70%+ of self-created multi-accounts get restricted within 90 days" },
    { feature: "Cost per usable account/month", good: isArmy ? "$45-110/month, pay only while hired" : "$45-110/month, pay only while rented", alt: "Phone numbers, proxies, browsers, time — $200+/month all-in even before bans" },
    { feature: "Phone verification", good: isArmy ? "Already handled — the operator's phone, not yours" : "Already handled — owner's phone, not yours", alt: "Need a new SIM per account; LinkedIn detects VoIP" },
    { feature: "Sales Navigator access", good: isArmy ? "Available on selected operators" : "Available on selected listings", alt: "Each new account needs its own Sales Nav subscription" },
  ];

  const faqs = [
    {
      q: "Why does LinkedIn restrict self-created accounts so aggressively?",
      a: "LinkedIn's anti-fraud system looks at signup signals: phone number reputation, IP reputation, browser fingerprint uniqueness, profile-completion velocity, connection-request patterns, and content engagement. New accounts run by automation tools fail almost every one of these checks, which is why 70%+ of self-created multi-account setups get restricted within 90 days.",
    },
    {
      q: "Can't I just buy aged accounts to skip the warming?",
      a: isArmy
        ? "Bought accounts have their own problems — LinkedIn explicitly prohibits account sales, the original owner can reclaim the account at any time, and detection of ownership transfer almost always leads to a permanent ban. See our breakdown of <a href='/vs/buying-linkedin-accounts' style='color:#0A66C2'>hiring vs buying</a> for the full comparison."
        : "Bought accounts have their own problems — LinkedIn explicitly prohibits account sales, the original owner can reclaim the account at any time, and detection of ownership transfer almost always leads to a permanent ban. See our breakdown of <a href='/vs/buying-linkedin-accounts' style='color:#0A66C2'>renting vs buying</a> for the full comparison.",
    },
    {
      q: "What does 'pre-warmed' actually mean?",
      a: isArmy
        ? "LinkedArmy operators are real profiles that have been active for years — with real posts, real engagement, real connections, and real industry context. They aren't 'warmed' by simulating activity; they're established because they're actual professional accounts the owner built over time and now isn't actively using."
        : "LinkedVelocity accounts are real profiles that have been active for years — with real posts, real engagement, real connections, and real industry context. They aren't 'warmed' by simulating activity; they're warmed by being actual professional accounts that the original owner built over time and now isn't actively using.",
    },
    {
      q: isArmy ? "How fast can I scale with LinkedArmy vs DIY?" : "How fast can I scale with LinkedVelocity vs DIY?",
      a: isArmy
        ? "With DIY, a team of 5 accounts takes 8-12 weeks to get fully warmed and adds another $1,000+ in costs for phones, proxies, and tools. With LinkedArmy, you can hire 5 operators in 5 minutes and send your first campaign the same day. The break-even point versus DIY is usually month one."
        : "With DIY, a team of 5 accounts takes 8-12 weeks to get fully warmed and adds another $1,000+ in costs for phones, proxies, and tools. With LinkedVelocity, you can rent 5 accounts in 5 minutes and send your first campaign the same day. The break-even point versus DIY is usually month one.",
    },
  ];

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: U },
      { "@type": "ListItem", position: 2, name: "Comparisons", item: `${U}/vs` },
      { "@type": "ListItem", position: 3, name: "vs Creating Multiple Accounts", item: `${U}/vs/creating-multiple-linkedin-accounts` },
    ],
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a.replace(/<[^>]+>/g, "") },
    })),
  };

  return (
    <>
      <CompareStyle />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <div className="vs-page">
        <div className="vs-crumb">
          <Link href="/">Home</Link> · <Link href="/how-it-works">How It Works</Link> · vs Creating Multiple Accounts
        </div>

        <header className="vs-header">
          <div className="vs-label">Comparison</div>
          <h1 className="vs-title">{isArmy ? "Creating multiple LinkedIn accounts vs hiring operators" : "Creating multiple LinkedIn accounts vs renting them"}</h1>
          <p className="vs-subtitle">
            {isArmy ? (
              <>
                Spinning up extra LinkedIn accounts yourself sounds cheap until you add up the
                phone numbers, residential proxies, warming time, and ban replacements.
                {" "}{B} gives you real, established operators in minutes — same outreach capacity,
                none of the DIY pain.
              </>
            ) : (
              <>
                Spinning up extra LinkedIn accounts yourself sounds cheap until you add up the
                phone numbers, residential proxies, warming time, and ban replacements.
                LinkedVelocity rents real, pre-warmed accounts in minutes — same outreach capacity,
                none of the DIY pain.
              </>
            )}
          </p>
        </header>

        <div className="vs-verdict">
          <span className="vs-verdict-label">TL;DR</span>
          <p>
            {isArmy ? (
              <>
                <strong>DIY multi-account is the slowest, riskiest, and most expensive option.</strong>{" "}
                70%+ of self-created accounts get restricted within 90 days. {B} gives you real,
                established operators for $45-110/month with same-day access and a 0% restriction
                rate to date.
              </>
            ) : (
              <>
                <strong>DIY multi-account is the slowest, riskiest, and most expensive option.</strong>{" "}
                70%+ of self-created accounts get restricted within 90 days. LinkedVelocity rents real,
                established profiles for $45-110/month with same-day access and a 0% restriction
                rate to date.
              </>
            )}
          </p>
        </div>

        <section className="vs-table-section">
          <h2>Side by side</h2>
          <div className="vs-table-wrap">
            <table className="vs-table">
              <thead>
                <tr><th></th><th>{B} ({brand.term.verbLower})</th><th>Creating your own</th></tr>
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
          <h2>Why DIY multi-account setups fail</h2>
          <p>
            LinkedIn&apos;s anti-fraud system isn&apos;t built to catch fake profile text — it
            catches creation patterns. New accounts that sign up from a clean IP, complete
            their profile in one session, send 50 connection requests in their first week,
            and use a VoIP phone number get flagged automatically. By the time you notice,
            the account is already on a watchlist.
          </p>
          <h2>{isArmy ? "Established beats warmed" : "Pre-warmed beats warmed"}</h2>
          <p>
            &quot;Warming&quot; an account by simulating activity (profile views, post engagement,
            slow connection requests) is what most multi-account guides recommend. But
            simulated warming is still simulated — LinkedIn&apos;s ML models are tuned to spot
            the regularity. {isArmy ? "An established operator" : "A pre-warmed account"} is a real professional account with real
            industry context, real connection history, and real engagement signals. There&apos;s
            nothing to simulate because it&apos;s genuine.
          </p>
          <h2>The hidden DIY costs</h2>
          <p>
            {isArmy ? (
              <>
                Phone numbers ($5-15 per account, $15+/month for SMS verification services),
                residential proxies ($50+/month per account), GoLogin or Multilogin browser
                subscriptions ($30+/month), and the operator time to manage each profile add up
                to $200+ per month per account before any outreach happens. {B} includes the
                proxy, secure session, and management.
              </>
            ) : (
              <>
                Phone numbers ($5-15 per account, $15+/month for SMS verification services),
                residential proxies ($50+/month per account), GoLogin or Multilogin browser
                subscriptions ($30+/month), and the operator time to manage each profile add up
                to $200+ per month per account before any outreach happens. LinkedVelocity rentals
                include the proxy, browser session, and management.
              </>
            )}
          </p>
        </section>

        <section className="vs-faq">
          <h2>FAQs</h2>
          {faqs.map((f) => (
            <details key={f.q} className="vs-faq-item">
              <summary>{f.q}</summary>
              <p dangerouslySetInnerHTML={{ __html: f.a }} />
            </details>
          ))}
        </section>

        <section className="vs-cta">
          <h2>{isArmy ? "Skip the warming. Hire real operators." : "Skip the warming. Rent real accounts."}</h2>
          <p>{isArmy ? "Verified operators available across industries. Filter by industry and Sales Navigator. Cancel anytime." : "Verified accounts available across industries. Filter by industry and Sales Navigator. Cancel anytime."}</p>
          <div className="vs-cta-row">
            <Link href="/catalogue" className="vs-btn-primary">{isArmy ? "Browse Operators →" : "Browse Catalogue →"}</Link>
            <Link href="/how-it-works" className="vs-btn-secondary">How {B} Works</Link>
          </div>
        </section>
      </div>
    </>
  );
}
