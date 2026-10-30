import type { Metadata } from "next";
import Link from "next/link";
import { getBrand } from "@/lib/brand";
import { CompareStyle } from "../compare-style";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return {
    title: isArmy ? "LinkedArmy vs Instantly — LinkedIn Outreach Compared" : "LinkedVelocity vs Instantly — LinkedIn Outreach Compared",
    description: isArmy
      ? "Instantly is a cold email platform with a LinkedIn add-on. LinkedArmy is a dedicated LinkedIn operator marketplace. Here's when you need LinkedArmy alongside or instead of Instantly for LinkedIn outreach at scale."
      : "Instantly is a cold email platform with a LinkedIn add-on. LinkedVelocity is a dedicated LinkedIn account rental marketplace. Here's when you need LinkedVelocity alongside or instead of Instantly for LinkedIn outreach at scale.",
    alternates: { canonical: "/vs/instantly" },
    openGraph: {
      title: isArmy ? "LinkedArmy vs Instantly for LinkedIn Outreach" : "LinkedVelocity vs Instantly for LinkedIn Outreach",
      description: isArmy
        ? "How LinkedArmy's LinkedIn operators compare to Instantly's LinkedIn outreach features."
        : "How LinkedVelocity's LinkedIn account rentals compare to Instantly's LinkedIn outreach features.",
      url: `${brand.url}/vs/instantly`,
    },
  };
}

export default async function InstantlyVsLinkedVelocityPage() {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  const B = brand.name;
  const U = brand.url;

  const comparison = [
    { feature: "Core product", good: isArmy ? "LinkedIn operator marketplace" : "LinkedIn account rental marketplace", alt: "Cold email platform with LinkedIn add-on" },
    { feature: "LinkedIn accounts included", good: isArmy ? "Yes — hire 1 to 50+ real operators" : "Yes — rent 1 to 50+ real accounts", alt: "No — you must bring your own LinkedIn account" },
    { feature: "Multi-account LinkedIn outreach", good: isArmy ? "Hire as many operators as you need, each isolated" : "Rent as many accounts as you need, each isolated", alt: "Limited to accounts you already own or control" },
    { feature: "Account warming", good: isArmy ? "None — operators are established with real history" : "None — accounts are pre-warmed with real history", alt: "Email warming included; LinkedIn accounts need separate warming" },
    { feature: "Anti-detect browser", good: isArmy ? "Secure session included with every operator, dedicated residential proxy" : "GoLogin included with every rental, dedicated residential proxy", alt: "Not included — need separate browser tool for LinkedIn" },
    { feature: "Email outreach", good: "Not included — LinkedIn only", alt: "Core feature — email warmup, rotation, sequences" },
    { feature: "Best for", good: isArmy ? "Teams who need more LinkedIn operators for outreach" : "Teams who need more LinkedIn accounts for outreach", alt: "Teams who need a cold email engine with optional LinkedIn" },
    { feature: "Pricing", good: isArmy ? "$45-110/mo per operator" : "$45-110/mo per LinkedIn account", alt: "$30-97/mo for email platform; LinkedIn accounts extra" },
  ];

  const faqs = [
    {
      q: isArmy ? "Can I use LinkedArmy and Instantly together?" : "Can I use LinkedVelocity and Instantly together?",
      a: isArmy
        ? "Yes — many teams do. Use Instantly for cold email sequences and LinkedArmy for LinkedIn outreach from hired operators. They serve different channels and complement each other well. Run Instantly's LinkedIn extension inside the secure browser session that comes with every LinkedArmy operator."
        : "Yes — many teams do. Use Instantly for cold email sequences and LinkedVelocity for LinkedIn outreach on rented accounts. They serve different channels and complement each other well. Run Instantly's LinkedIn extension inside the GoLogin browser session that comes with every LinkedVelocity rental.",
    },
    {
      q: "Does Instantly provide LinkedIn accounts?",
      a: isArmy
        ? "No. Instantly is an email-first platform. Its LinkedIn features require you to connect your own LinkedIn account. If you need additional LinkedIn operators for outreach, that's exactly what LinkedArmy provides."
        : "No. Instantly is an email-first platform. Its LinkedIn features require you to connect your own LinkedIn account. If you need additional LinkedIn accounts for outreach, that's exactly what LinkedVelocity provides.",
    },
    {
      q: "Which is cheaper for LinkedIn outreach?",
      a: isArmy
        ? "For pure LinkedIn outreach, LinkedArmy is more cost-effective because you get the operator, browser, and proxy in one package. Instantly charges for the platform ($30-97/mo) but you still need to source and manage your own LinkedIn accounts separately."
        : "For pure LinkedIn outreach, LinkedVelocity is more cost-effective because you get the accounts, browser, and proxy in one package. Instantly charges for the platform ($30-97/mo) but you still need to source and manage your own LinkedIn accounts separately.",
    },
    {
      q: isArmy ? "Do I need LinkedArmy if I already use Instantly?" : "Do I need LinkedVelocity if I already use Instantly?",
      a: isArmy
        ? "If your LinkedIn outreach is limited to your personal account, you may not. But if you've hit LinkedIn's connection limits and need to scale across multiple profiles, LinkedArmy gives you additional operators to work from — either through Instantly's LinkedIn integration or standalone tools like Dripify or Expandi."
        : "If your LinkedIn outreach is limited to your personal account, you may not. But if you've hit LinkedIn's connection limits and need to scale across multiple accounts, LinkedVelocity gives you additional accounts to use — either through Instantly's LinkedIn integration or standalone tools like Dripify or Expandi.",
    },
  ];

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: U },
      { "@type": "ListItem", position: 2, name: "Comparisons", item: `${U}/vs` },
      { "@type": "ListItem", position: 3, name: "vs Instantly", item: `${U}/vs/instantly` },
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
          <Link href="/">Home</Link> · <Link href="/vs">Comparisons</Link> · vs Instantly
        </div>

        <header className="vs-header">
          <div className="vs-label">Comparison</div>
          <h1 className="vs-title">{B} vs Instantly for LinkedIn outreach</h1>
          <p className="vs-subtitle">
            {isArmy ? (
              <>
                Instantly is a cold email platform that added LinkedIn as a secondary channel.
                {" "}{B} is a marketplace dedicated to hiring LinkedIn operators for outreach.
                They solve different problems — and many teams use both.
              </>
            ) : (
              <>
                Instantly is a cold email platform that added LinkedIn as a secondary channel.
                LinkedVelocity is a marketplace dedicated to renting LinkedIn accounts for outreach.
                They solve different problems — and many teams use both.
              </>
            )}
          </p>
        </header>

        <div className="vs-verdict">
          <span className="vs-verdict-label">TL;DR</span>
          <p>
            {isArmy ? (
              <>
                <strong>Different tools, different jobs.</strong> Instantly is your cold email
                engine. {B} gives you the LinkedIn operators to run outreach from. If
                you&apos;ve hit LinkedIn&apos;s connection limits on your personal account,
                {" "}{B} is where you get more — then run campaigns via Instantly,
                Dripify, or any other tool.
              </>
            ) : (
              <>
                <strong>Different tools, different jobs.</strong> Instantly is your cold email
                engine. LinkedVelocity gives you the LinkedIn accounts to run outreach on. If
                you&apos;ve hit LinkedIn&apos;s connection limits on your personal account,
                LinkedVelocity is where you get more accounts — then run campaigns via Instantly,
                Dripify, or any other tool.
              </>
            )}
          </p>
        </div>

        <section className="vs-table-section">
          <h2>Side by side</h2>
          <div className="vs-table-wrap">
            <table className="vs-table">
              <thead>
                <tr><th></th><th>{B}</th><th>Instantly</th></tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.feature}>
                    <td className="vs-feature">{row.feature}</td>
                    <td className="vs-good">{row.good}</td>
                    <td style={{ color: "#536471" }}>{row.alt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="vs-detail">
          <h2>When to use {B}</h2>
          <p>
            {isArmy ? (
              <>
                Use {B} when you need more LinkedIn operators than you currently have.
                If your team has 3 SDRs but needs to run campaigns from 15 LinkedIn
                profiles, {B} gives you 12 additional established operators with
                secure browser access and dedicated proxies. You can run any automation
                tool on them — including Instantly&apos;s LinkedIn module.
              </>
            ) : (
              <>
                Use LinkedVelocity when you need more LinkedIn accounts than you currently have.
                If your team has 3 SDRs but needs to run campaigns from 15 LinkedIn
                profiles, LinkedVelocity gives you 12 additional pre-warmed accounts with
                GoLogin browser access and dedicated proxies. You can run any automation
                tool on them — including Instantly&apos;s LinkedIn module.
              </>
            )}
          </p>
          <h2>When to use Instantly</h2>
          <p>
            Use Instantly when cold email is your primary outreach channel and
            LinkedIn is supplementary. Instantly excels at email warmup, mailbox
            rotation, and multi-step email sequences. Its LinkedIn features work
            best as a complement to email campaigns, not as a standalone LinkedIn
            scaling tool.
          </p>
          <h2>When to use both</h2>
          <p>
            {isArmy ? (
              <>
                The most common setup is Instantly for email + {B} for LinkedIn.
                Run your email sequences through Instantly&apos;s infrastructure, then
                connect-and-message the same prospects on LinkedIn through hired
                {" "}{B} operators. Multi-channel outreach consistently outperforms
                single-channel.
              </>
            ) : (
              <>
                The most common setup is Instantly for email + LinkedVelocity for LinkedIn.
                Run your email sequences through Instantly&apos;s infrastructure, then
                connect-and-message the same prospects on LinkedIn through rented
                LinkedVelocity accounts. Multi-channel outreach consistently outperforms
                single-channel.
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
          <h2>{isArmy ? "Need more LinkedIn operators?" : "Need more LinkedIn accounts?"}</h2>
          <p>{isArmy ? "Hire established operators with secure browser access. Works with Instantly, Dripify, Expandi, and any Chrome tool." : "Rent pre-warmed accounts with GoLogin browser access. Works with Instantly, Dripify, Expandi, and any Chrome tool."}</p>
          <div className="vs-cta-row">
            <Link href="/catalogue" className="vs-btn-primary">{isArmy ? "Browse Operators →" : "Browse Accounts →"}</Link>
            <Link href="/how-it-works" className="vs-btn-secondary">How {B} Works</Link>
          </div>
        </section>
      </div>
    </>
  );
}
