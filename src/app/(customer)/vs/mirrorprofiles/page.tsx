import type { Metadata } from "next";
import Link from "next/link";
import { getBrand } from "@/lib/brand";
import { CompareStyle } from "../compare-style";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return {
    title: isArmy
      ? "LinkedArmy vs MirrorProfiles — Real Operators vs Fake Profiles"
      : "LinkedVelocity vs MirrorProfiles — Real Accounts vs Fake Profiles",
    description: isArmy
      ? "MirrorProfiles rents synthetic LinkedIn accounts with fabricated identities. LinkedArmy gives you real operators — real professionals with genuine profiles. Here's why real profiles outperform fake ones for outreach."
      : "MirrorProfiles rents synthetic LinkedIn accounts with fabricated identities. LinkedVelocity rents access to real accounts owned by real professionals. Here's why real profiles outperform fake ones for outreach.",
    alternates: { canonical: "/vs/mirrorprofiles" },
    openGraph: {
      title: isArmy
        ? "LinkedArmy vs MirrorProfiles for LinkedIn Outreach"
        : "LinkedVelocity vs MirrorProfiles for LinkedIn Outreach",
      description: isArmy
        ? "Real LinkedIn operators (LinkedArmy) vs synthetic fake profiles (MirrorProfiles). Side-by-side comparison for outreach teams."
        : "Real LinkedIn accounts (LinkedVelocity) vs synthetic fake profiles (MirrorProfiles). Side-by-side comparison for outreach teams.",
      url: `${brand.url}/vs/mirrorprofiles`,
    },
  };
}

export default async function MirrorProfilesVsLinkedVelocityPage() {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  const B = brand.name;
  const U = brand.url;

  const comparison = [
    { feature: "Account type", good: isArmy ? "Real operators — real professionals with their own profiles" : "Real accounts owned by real professionals", alt: "Synthetic accounts with fabricated identities" },
    { feature: "Profile authenticity", good: "Real name, real photo, real work history, real connections", alt: "AI-selected photo, invented work history, manufactured connections" },
    { feature: "Connection quality", good: "Organic networks built over years (500-10,000+)", alt: "500+ connections built during 3-4 month warming period" },
    { feature: "LinkedIn TOS", good: isArmy ? "No ownership transfer — the operator keeps their account" : "No ownership transfer — original owner keeps the account", alt: "Fake identity accounts violate LinkedIn's real-name policy" },
    { feature: "Sales Navigator", good: isArmy ? "Available on selected operators" : "Available on selected accounts", alt: "Not included" },
    { feature: "Pricing", good: isArmy ? "$45-110/mo depending on operator quality" : "$45-110/mo depending on account quality", alt: "~€100/mo (EU) or ~$150/mo (US) per account" },
    { feature: "Anti-detect browser", good: isArmy ? "Secure session with dedicated residential proxy" : "GoLogin included with dedicated residential proxy", alt: "Dedicated IP and digital fingerprint (details not disclosed)" },
    { feature: "Prospect perception", good: "Prospects see a real professional with a genuine background", alt: "Prospects may notice a thin or inconsistent profile" },
    { feature: "Profile editing", good: isArmy ? "Profile locked — the operator maintains it" : "Profile locked — original owner maintains it", alt: "Max one edit per day; cannot delete prior work history" },
    { feature: "Automation tools", good: "Any Chrome extension — Dripify, Expandi, Linked Helper, etc.", alt: "Limited to one tool per account (Waalaxy, La Growth Machine, HeyReach, etc.)" },
  ];

  const faqs = [
    {
      q: "What's the difference between real and synthetic LinkedIn accounts?",
      a: isArmy
        ? "Real operators (LinkedArmy) are actual professionals who built their profile, connections, and activity history over years. Synthetic accounts (MirrorProfiles) are created from scratch with fabricated identities, AI-generated photos, and invented work histories — then warmed for 3-4 months with manufactured engagement."
        : "Real accounts (LinkedVelocity) belong to actual professionals who built their profile, connections, and activity history over years. Synthetic accounts (MirrorProfiles) are created from scratch with fabricated identities, AI-generated photos, and invented work histories — then warmed for 3-4 months with manufactured engagement.",
    },
    {
      q: "Why does account authenticity matter for outreach?",
      a: "Prospects research who's contacting them. A real account with a genuine professional background, real mutual connections, and years of LinkedIn activity builds trust instantly. A synthetic profile with a thin history, no real industry presence, and connections that don't match the claimed background raises red flags — lowering acceptance and reply rates.",
    },
    {
      q: "Are MirrorProfiles accounts safe from LinkedIn bans?",
      a: isArmy
        ? "MirrorProfiles offers a 24-hour replacement guarantee if an account gets suspended, which implies suspensions do occur. Their accounts use fabricated identities, which violates LinkedIn's User Agreement requirement that profiles use real names and accurate information. LinkedArmy's real-operator model avoids this risk entirely — the profiles are genuine and maintained by the professionals who own them."
        : "MirrorProfiles offers a 24-hour replacement guarantee if an account gets suspended, which implies suspensions do occur. Their accounts use fabricated identities, which violates LinkedIn's User Agreement requirement that profiles use real names and accurate information. LinkedVelocity's real-account model avoids this risk entirely — the profiles are genuine and maintained by their original owners.",
    },
    {
      q: isArmy ? "Is LinkedArmy cheaper than MirrorProfiles?" : "Is LinkedVelocity cheaper than MirrorProfiles?",
      a: isArmy
        ? "It depends on the operator. LinkedArmy's range is $45-110/month based on connection count, industry, and Sales Navigator. Basic operators start at $45/month — significantly cheaper than MirrorProfiles' ~€100/month (EU) or ~$150/month (US). Premium operators with larger networks and Sales Navigator can cost more, but they come with a genuine profile that outperforms a synthetic one."
        : "It depends on the account. LinkedVelocity's range is $45-110/month based on connection count, industry, and Sales Navigator. Basic accounts start at $45/month — significantly cheaper than MirrorProfiles' ~€100/month (EU) or ~$150/month (US). Premium LinkedVelocity accounts with larger networks and Sales Navigator can cost more, but they come with a genuine profile that outperforms a synthetic one.",
    },
    {
      q: isArmy ? "Can I use MirrorProfiles and LinkedArmy together?" : "Can I use MirrorProfiles and LinkedVelocity together?",
      a: isArmy
        ? "You could, but most teams choose one approach. If authenticity and prospect trust matter to your outreach (they should), LinkedArmy's real operators will outperform synthetic profiles. If you're doing high-volume, low-touch outreach where profile quality matters less, MirrorProfiles might work — but the LinkedIn TOS risk remains."
        : "You could, but most teams choose one approach. If authenticity and prospect trust matter to your outreach (they should), LinkedVelocity's real accounts will outperform synthetic profiles. If you're doing high-volume, low-touch outreach where profile quality matters less, MirrorProfiles might work — but the LinkedIn TOS risk remains.",
    },
  ];

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: U },
      { "@type": "ListItem", position: 2, name: "Comparisons", item: `${U}/vs` },
      { "@type": "ListItem", position: 3, name: "vs MirrorProfiles", item: `${U}/vs/mirrorprofiles` },
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
          <Link href="/">Home</Link> · <Link href="/vs">Comparisons</Link> · vs MirrorProfiles
        </div>

        <header className="vs-header">
          <div className="vs-label">Comparison</div>
          <h1 className="vs-title">{B} vs MirrorProfiles</h1>
          <p className="vs-subtitle">
            {isArmy ? (
              <>
                MirrorProfiles creates synthetic LinkedIn accounts with fabricated identities
                and warms them for 3-4 months before renting them out. {B} gives you real
                operators — real professionals with genuine connections, real activity history,
                and years of organic presence on LinkedIn.
              </>
            ) : (
              <>
                MirrorProfiles creates synthetic LinkedIn accounts with fabricated identities
                and warms them for 3-4 months before renting them out. LinkedVelocity rents access
                to real accounts owned by real professionals — with genuine connections,
                real activity history, and years of organic presence on LinkedIn.
              </>
            )}
          </p>
        </header>

        <div className="vs-verdict">
          <span className="vs-verdict-label">TL;DR</span>
          <p>
            {isArmy ? (
              <>
                <strong>Real operators outperform fake profiles.</strong> MirrorProfiles rents
                synthetic profiles with invented identities. {B} gives you real professionals —
                better acceptance rates, better prospect trust, and no LinkedIn TOS risk from
                fake identities. {B} starts at $45/mo vs MirrorProfiles&apos; ~$100-150/mo.
              </>
            ) : (
              <>
                <strong>Real accounts outperform fake ones.</strong> MirrorProfiles rents
                synthetic profiles with invented identities. LinkedVelocity rents access to real
                accounts from real professionals — better acceptance rates, better prospect
                trust, and no LinkedIn TOS risk from fake identities. LinkedVelocity starts at
                $45/mo vs MirrorProfiles&apos; ~$100-150/mo.
              </>
            )}
          </p>
        </div>

        <section className="vs-table-section">
          <h2>Side by side</h2>
          <div className="vs-table-wrap">
            <table className="vs-table">
              <thead>
                <tr><th></th><th>{B}</th><th>MirrorProfiles</th></tr>
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
          <h2>The problem with synthetic accounts</h2>
          <p>
            MirrorProfiles describes their accounts as &quot;fictitious but realistic.&quot;
            Each profile is built from scratch: AI-selected photo, invented work history,
            fabricated education, and connections accumulated during a 3-4 month warming
            period. While the accounts may pass a casual glance, they fail under scrutiny
            — and LinkedIn prospects increasingly check who&apos;s contacting them before
            accepting.
          </p>
          <h2>Why real profiles convert better</h2>
          <p>
            {isArmy ? (
              <>
                A real {B} operator has a genuine professional background that matches the
                industry you&apos;re targeting. The connections are organic, the activity history
                is authentic, and mutual connections often exist. When a prospect sees a
                connection request from a real marketing director with 3,000+ connections in
                their industry, they accept. When they see a thin profile with generic job
                titles and no mutual connections, they don&apos;t.
              </>
            ) : (
              <>
                A real LinkedVelocity account has a genuine professional background that matches the
                industry you&apos;re targeting. The connections are organic, the activity history
                is authentic, and mutual connections often exist. When a prospect sees a
                connection request from a real marketing director with 3,000+ connections in
                their industry, they accept. When they see a thin profile with generic job
                titles and no mutual connections, they don&apos;t.
              </>
            )}
          </p>
          <h2>The TOS risk difference</h2>
          <p>
            {isArmy ? (
              <>
                LinkedIn requires profiles to use real names and accurate information.
                MirrorProfiles&apos; synthetic accounts violate this requirement by design —
                every account uses a fabricated identity. If LinkedIn cracks down on fake
                accounts (and they regularly do), entire batches can get swept. {B}
                operators are real professionals who voluntarily take part — no fake
                identity, no TOS violation.
              </>
            ) : (
              <>
                LinkedIn requires profiles to use real names and accurate information.
                MirrorProfiles&apos; synthetic accounts violate this requirement by design —
                every account uses a fabricated identity. If LinkedIn cracks down on fake
                accounts (and they regularly do), entire batches can get swept. LinkedVelocity
                accounts are real professionals who voluntarily share access — no fake
                identity, no TOS violation.
              </>
            )}
          </p>
          <h2>Price comparison</h2>
          <p>
            {isArmy ? (
              <>
                MirrorProfiles charges ~{"€"}100/month for European accounts and ~$150/month
                for North American accounts, with no Sales Navigator option. {B}&apos;s
                range starts at $45/month for basic operators and goes up to $110/month for
                premium operators, with Sales Navigator available as a +$70/month add-on. For most use
                cases, {B} is both cheaper and higher quality.
              </>
            ) : (
              <>
                MirrorProfiles charges ~{"€"}100/month for European accounts and ~$150/month
                for North American accounts, with no Sales Navigator option. LinkedVelocity&apos;s
                range starts at $45/month for basic accounts and goes up to $110/month for
                premium accounts, with Sales Navigator available as a +$70/month add-on. For most use
                cases, LinkedVelocity is both cheaper and higher quality.
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
          <h2>{isArmy ? "Hire real operators, not fake profiles" : "Rent real accounts, not fake ones"}</h2>
          <p>{isArmy ? "Verified operators from real professionals. Genuine connections, real history, Sales Navigator available." : "847+ verified accounts from real professionals. Genuine connections, real history, Sales Navigator available."}</p>
          <div className="vs-cta-row">
            <Link href="/catalogue" className="vs-btn-primary">{isArmy ? "Browse Operators →" : "Browse Real Accounts →"}</Link>
            <Link href="/how-it-works" className="vs-btn-secondary">How {B} Works</Link>
          </div>
        </section>
      </div>
    </>
  );
}
