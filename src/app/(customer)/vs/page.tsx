import type { Metadata } from "next";
import Link from "next/link";
import { getBrand } from "@/lib/brand";
import { CompareStyle } from "./compare-style";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return {
    title: isArmy
      ? "LinkedArmy Comparisons — Why Hiring an Operator Beats the Alternatives"
      : "LinkedVelocity Comparisons — Why Renting Beats the Alternatives",
    description: isArmy
      ? "How hiring a LinkedIn operator through LinkedArmy compares to buying accounts, sharing passwords, and creating multiple accounts yourself. Side-by-side breakdowns of cost, risk, and time-to-outreach."
      : "How LinkedVelocity LinkedIn account rentals compare to buying accounts, sharing passwords, and creating multiple accounts yourself. Side-by-side breakdowns of cost, risk, and time-to-outreach.",
    alternates: { canonical: "/vs" },
    openGraph: {
      title: isArmy ? "LinkedArmy Comparisons" : "LinkedVelocity Comparisons",
      description: isArmy
        ? "Side-by-side comparisons of LinkedArmy vs the most common alternatives for scaling LinkedIn outreach."
        : "Side-by-side comparisons of LinkedVelocity vs the most common alternatives for scaling LinkedIn outreach.",
      url: `${brand.url}/vs`,
    },
  };
}

export default async function ComparisonsPage() {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  const B = brand.name;
  const U = brand.url;

  const pages = [
    {
      title: "vs Buying LinkedIn Accounts",
      href: "/vs/buying-linkedin-accounts",
      summary: isArmy
        ? "Why buying accounts violates LinkedIn's terms and usually ends in a permanent ban — and what hiring an operator gets you instead."
        : "Why buying accounts violates LinkedIn's terms and usually ends in a permanent ban — and what renting gets you instead.",
      tag: "Most common alternative",
    },
    {
      title: "vs Buying Aged LinkedIn Accounts",
      href: "/vs/buying-aged-linkedin-accounts",
      summary: isArmy
        ? "Aged accounts from forums and Telegram cost $200-2,000+ and get banned within weeks. Hiring an operator is cheaper, safer, and reversible."
        : "Aged accounts from forums and Telegram cost $200-2,000+ and get banned within weeks. Renting is cheaper, safer, and reversible.",
      tag: "Highest risk",
    },
    {
      title: "vs Sharing Passwords with a VA",
      href: "/vs/sharing-linkedin-passwords",
      summary:
        "Handing your password to a VA or agency is the riskiest way to outsource outreach. How isolated browser sessions fix this.",
      tag: "Riskiest alternative",
    },
    {
      title: "vs Creating Multiple Accounts Yourself",
      href: "/vs/creating-multiple-linkedin-accounts",
      summary: isArmy
        ? "Why DIY multi-account setups take 3 months to warm and get restricted at a 70% rate. Same-day access with LinkedArmy instead."
        : "Why DIY multi-account setups take 3 months to warm and get restricted at a 70% rate. Same-day access with LinkedVelocity instead.",
      tag: "Most expensive alternative",
    },
    {
      title: "vs MirrorProfiles",
      href: "/vs/mirrorprofiles",
      summary: isArmy
        ? "MirrorProfiles rents synthetic accounts with fake identities. LinkedArmy gives you real operators — real professionals with genuine networks — for better trust and a lower price."
        : "MirrorProfiles rents synthetic accounts with fake identities. LinkedVelocity rents real accounts from real professionals — better trust, better rates, lower price.",
      tag: "Direct competitor",
    },
    {
      title: "vs SBL.so",
      href: "/vs/sbl",
      summary: isArmy
        ? "SBL.so manages outreach for you via fractional SDRs. LinkedArmy lets you work from the operator directly so you control the messaging and tools. Control vs convenience."
        : "SBL.so manages outreach for you via fractional SDRs. LinkedVelocity gives you the account directly so you control the messaging and tools. Control vs convenience.",
      tag: "Direct competitor",
    },
    {
      title: "vs Instantly",
      href: "/vs/instantly",
      summary: isArmy
        ? "Instantly is a cold email platform. LinkedArmy gives you LinkedIn operators. Different tools for different channels — many teams use both."
        : "Instantly is a cold email platform. LinkedVelocity rents LinkedIn accounts. Different tools for different channels — many teams use both.",
      tag: "Complementary tool",
    },
    {
      title: "vs Smartlead",
      href: "/vs/smartlead",
      summary: isArmy
        ? "Smartlead automates email with unlimited mailboxes. LinkedArmy provides the LinkedIn operators. Here's when to use which — or both."
        : "Smartlead automates email with unlimited mailboxes. LinkedVelocity provides the LinkedIn accounts. Here's when to use which — or both.",
      tag: "Complementary tool",
    },
  ];

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: U },
      { "@type": "ListItem", position: 2, name: "Comparisons", item: `${U}/vs` },
    ],
  };

  return (
    <>
      <CompareStyle />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      <div className="vs-page">
        <div className="vs-crumb">
          <Link href="/">Home</Link> · Comparisons
        </div>

        <header className="vs-header">
          <div className="vs-label">Comparisons</div>
          <h1 className="vs-title">{B} vs the alternatives</h1>
          <p className="vs-subtitle">
            {isArmy ? (
              <>
                Most teams scaling LinkedIn outreach end up choosing between three risky paths:
                buying accounts, sharing passwords, or creating accounts themselves. Here&apos;s how
                each compares to hiring an operator through {B}.
              </>
            ) : (
              <>
                Most teams scaling LinkedIn outreach end up choosing between three risky paths:
                buying accounts, sharing passwords, or creating accounts themselves. Here&apos;s how
                each compares to renting through LinkedVelocity.
              </>
            )}
          </p>
        </header>

        <div style={{ display: "grid", gap: 16 }}>
          {pages.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              style={{
                display: "block",
                background: "#fff",
                border: "1px solid #E8E6E1",
                borderRadius: 16,
                padding: "26px 28px",
                textDecoration: "none",
                color: "#0F1419",
                transition: "all .15s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.02em" }}>{p.title}</h2>
                <span style={{ fontSize: 12, color: "#8899A6", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{p.tag}</span>
              </div>
              <p style={{ fontSize: 14, color: "#536471", lineHeight: 1.65, margin: "8px 0 0" }}>{p.summary}</p>
              <span style={{ display: "inline-block", marginTop: 12, fontSize: 13, color: "#0A66C2", fontWeight: 600 }}>Read comparison →</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
