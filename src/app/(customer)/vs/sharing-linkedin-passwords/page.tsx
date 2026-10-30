import type { Metadata } from "next";
import Link from "next/link";
import { getBrand } from "@/lib/brand";
import { CompareStyle } from "../compare-style";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return {
    title: isArmy
      ? "Sharing LinkedIn Passwords with VAs vs Hiring an Operator via LinkedArmy"
      : "Sharing LinkedIn Passwords with VAs vs Renting via LinkedVelocity",
    description: isArmy
      ? "Sharing your LinkedIn password with a VA or agency feels cheap but exposes your account to bans, identity-theft risk, and total loss of control. LinkedArmy operators work in isolated sessions so credentials never leave the owner."
      : "Sharing your LinkedIn password with a VA or agency feels cheap but exposes your account to bans, identity-theft risk, and total loss of control. LinkedVelocity rentals use isolated GoLogin sessions so credentials never leave the owner.",
    alternates: { canonical: "/vs/sharing-linkedin-passwords" },
    openGraph: {
      title: isArmy
        ? "Sharing LinkedIn Passwords vs Hiring Operators on LinkedArmy"
        : "Sharing LinkedIn Passwords vs Renting Accounts on LinkedVelocity",
      description: "Why password-sharing is the riskiest way to outsource LinkedIn outreach — and what to do instead.",
      url: `${brand.url}/vs/sharing-linkedin-passwords`,
    },
  };
}

export default async function SharingPasswordsVsRentPage() {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  const B = brand.name;
  const U = brand.url;

  const comparison = [
    { feature: "Who holds the password", good: isArmy ? "The operator only — you never receive it" : "Owner only — never shared with renters", alt: "VA, agency, and anyone they tell" },
    { feature: "Login security", good: isArmy ? "Isolated secure session, dedicated residential proxy" : "Isolated GoLogin session, dedicated residential proxy", alt: "VA logs in from any browser, often a different country" },
    { feature: "LinkedIn flag risk", good: "0% restriction rate to date", alt: "Sudden location/device changes trigger security lock" },
    { feature: "Profile edits by third parties", good: "Not possible — profile is locked", alt: "VA can change name, photo, headline, connections" },
    { feature: "Data exposure", good: "No access to the inbox, account settings, or recovery options", alt: "VA sees all messages, connections, and account settings" },
    { feature: "Revoking access", good: isArmy ? "Cancel anytime — instant offboarding" : "Cancel rental — instant offboarding", alt: "Change password — but VA may already have changed recovery info" },
    { feature: "Cost", good: isArmy ? "$45-110/month per operator, transparent" : "$45-110/month per account, transparent", alt: "$400-2,000/month for VA + risk of account loss" },
    { feature: "Simultaneous access by owner", good: isArmy ? "Yes — the operator can use the account at the same time" : "Yes — owner can use the account at the same time", alt: "Only one device at a time without conflict" },
  ];

  const faqs = [
    {
      q: "Isn't sharing my password with a trusted VA fine?",
      a: "Even with full trust, LinkedIn's security model doesn't care about intent — it cares about login signals. A VA logging in from Manila when your usual location is London looks identical to an account takeover, and LinkedIn frequently triggers a security lock or 2FA challenge that can leave the account inaccessible for days.",
    },
    {
      q: "Can't I just use 2FA to keep things safe?",
      a: isArmy
        ? "2FA helps with unauthorised takeovers but creates a workflow nightmare when you share legitimately — every login attempt by the VA pings your phone. Many teams end up disabling 2FA to make outreach work, which removes the only real safeguard. LinkedArmy routes through a secure session that handles 2FA without exposing it."
        : "2FA helps with unauthorised takeovers but creates a workflow nightmare when you share legitimately — every login attempt by the VA pings your phone. Many teams end up disabling 2FA to make outreach work, which removes the only real safeguard. LinkedVelocity rentals route through a GoLogin session that handles 2FA without exposing it.",
    },
    {
      q: "What if I want to keep using my own account while running outreach?",
      a: isArmy
        ? "Password sharing limits you to one active session at a time. LinkedArmy's secure sessions support simultaneous access, so the operator and you can be logged in at the same time on different devices without conflicts. (Most teams use this to keep their own account safe while outsourcing growth.)"
        : "Password sharing limits you to one active session at a time. LinkedVelocity's GoLogin sessions support simultaneous access, so you and the renter can be logged in at the same time on different devices without conflicts. (Most teams use this to keep their own account safe while outsourcing growth.)",
    },
    {
      q: isArmy ? "How is hiring an operator different from giving a VA my login?" : "How is renting different from giving a VA my login?",
      a: isArmy
        ? "When you give a VA your login, the VA <em>has</em> your account. When you hire a LinkedArmy operator, you get a managed browser session that only works on LinkedArmy's infrastructure — you can't extract credentials, can't log in elsewhere, and can't change profile content. The operator stays in control."
        : "When you give a VA your login, the VA <em>has</em> your account. When you rent a LinkedVelocity account, the renter gets a managed browser session that only works on LinkedVelocity's infrastructure — they can't extract credentials, can't log in elsewhere, and can't change profile content. The owner stays in control.",
    },
  ];

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: U },
      { "@type": "ListItem", position: 2, name: "Comparisons", item: `${U}/vs` },
      { "@type": "ListItem", position: 3, name: "vs Sharing Passwords", item: `${U}/vs/sharing-linkedin-passwords` },
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
          <Link href="/">Home</Link> · <Link href="/how-it-works">How It Works</Link> · vs Sharing Passwords
        </div>

        <header className="vs-header">
          <div className="vs-label">Comparison</div>
          <h1 className="vs-title">{isArmy ? "Sharing LinkedIn passwords vs hiring an operator" : "Sharing LinkedIn passwords vs renting accounts"}</h1>
          <p className="vs-subtitle">
            {isArmy ? (
              <>
                Handing a VA or agency your LinkedIn password is the most common way teams scale
                outreach — and the riskiest. One unusual login from a new country and LinkedIn
                locks the account. {B} operators work in isolated browser sessions, so
                credentials never leave the owner and access can be revoked instantly.
              </>
            ) : (
              <>
                Handing a VA or agency your LinkedIn password is the most common way teams scale
                outreach — and the riskiest. One unusual login from a new country and LinkedIn
                locks the account. LinkedVelocity rentals run in isolated browser sessions, so
                credentials never leave the owner and access can be revoked instantly.
              </>
            )}
          </p>
        </header>

        <div className="vs-verdict">
          <span className="vs-verdict-label">TL;DR</span>
          <p>
            {isArmy ? (
              <>
                <strong>Never share your password.</strong> The savings disappear the first time
                LinkedIn locks your account. {B} routes your access through a secure browser
                session — you see the inbox you need, but never the password, recovery
                email, or account settings.
              </>
            ) : (
              <>
                <strong>Never share your password.</strong> The savings disappear the first time
                LinkedIn locks your account. LinkedVelocity routes renter access through GoLogin browser
                sessions — the renter sees the inbox they need, but never the password, recovery
                email, or account settings.
              </>
            )}
          </p>
        </div>

        <section className="vs-table-section">
          <h2>Side by side</h2>
          <div className="vs-table-wrap">
            <table className="vs-table">
              <thead>
                <tr><th></th><th>{B} ({brand.term.verbLower})</th><th>Sharing passwords</th></tr>
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
          <h2>The hidden cost of password sharing</h2>
          <p>
            LinkedIn account takeovers are common enough that LinkedIn&apos;s security team
            assumes the worst when login behaviour shifts. A VA in a different timezone, on a
            different ISP, on a different browser fingerprint hits the same alarms a real
            attacker would. The account gets restricted, you spend a week proving it&apos;s
            you, and outreach stops cold.
          </p>
          <h2>Why isolated sessions are safer</h2>
          <p>
            {isArmy ? (
              <>
                {B} operators work from an anti-detect browser profile with a residential proxy
                in the same region as the account owner. To LinkedIn, every session looks
                indistinguishable from the owner logging in on their usual device. Across
                thousands of engagements, this approach has produced a 0% restriction rate.
              </>
            ) : (
              <>
                LinkedVelocity rentals use GoLogin anti-detect browser profiles with a residential proxy
                in the same region as the account owner. To LinkedIn, every session looks
                indistinguishable from the owner logging in on their usual device. Across
                thousands of rentals, this approach has produced a 0% restriction rate.
              </>
            )}
          </p>
          <h2>Control stays with the owner</h2>
          <p>
            {isArmy ? (
              <>
                With an operator, the owner can revoke access in seconds — you&apos;re locked out
                instantly, with no need to change a password or update recovery info. With a
                shared password, the VA may have already added their own recovery email or 2FA
                device, making real revocation a multi-step ordeal.
              </>
            ) : (
              <>
                With a rental, the owner can revoke access in seconds — the renter is locked out
                instantly, with no need to change a password or update recovery info. With a
                shared password, the VA may have already added their own recovery email or 2FA
                device, making real revocation a multi-step ordeal.
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
          <h2>{isArmy ? "Stop sharing passwords. Start hiring." : "Stop sharing passwords. Start renting."}</h2>
          <p>{isArmy ? "Browse operators by industry, connections, and Sales Navigator. Cancel anytime." : "Browse accounts by industry, connections, and Sales Navigator. Cancel anytime."}</p>
          <div className="vs-cta-row">
            <Link href="/catalogue" className="vs-btn-primary">{isArmy ? "Browse Operators →" : "Browse Catalogue →"}</Link>
            <Link href="/how-it-works" className="vs-btn-secondary">How {B} Works</Link>
          </div>
        </section>
      </div>
    </>
  );
}
