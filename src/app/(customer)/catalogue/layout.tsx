import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { publicInventorySlice } from "@/lib/public-inventory";
import { tierPricing } from "@/lib/account-pricing";
import { maskName } from "@/lib/mask";
import { blogFontVars } from "@/lib/blog-fonts";

export const metadata: Metadata = {
  title: "Browse LinkedIn Accounts for Rent",
  description:
    "Browse our catalogue of pre-warmed, verified LinkedIn accounts available for rent. Filter by industry, connections, Sales Navigator status. From $45/month.",
  alternates: { canonical: "/catalogue" },
  openGraph: {
    title: "Browse LinkedIn Accounts for Rent | LinkedVelocity",
    description:
      "Browse pre-warmed LinkedIn accounts for outreach and lead gen. Filter by industry, connections, and more.",
    url: "https://linkedvelocity.com/catalogue",
  },
};

async function getCatalogueSchema() {
  try {
    // Structured data is public page source — only ever list the public slice (see
    // lib/public-inventory), never the whole roster.
    const { availableIds } = await publicInventorySlice();
    const accounts = await prisma.linkedInAccount.findMany({
      where: { id: { in: availableIds } },
      select: {
        id: true,
        linkedinName: true,
        linkedinHeadline: true,
        industry: true,
        location: true,
        connectionCount: true,
        accountAgeMonths: true,
        hasSalesNav: true,
        linkedinVerified: true,
        profilePhotoUrl: true,
      },
      orderBy: { connectionCount: "desc" },
    });

    if (accounts.length === 0) return null;

    const itemList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "LinkedIn Accounts for Rent on LinkedVelocity",
      description:
        "Pre-warmed, verified LinkedIn accounts available for monthly rental. Each account includes GoLogin browser access for safe, simultaneous use.",
      numberOfItems: accounts.length,
      itemListElement: accounts.map((a, index) => {
        const displayName = maskName(a.linkedinName);
        const price = tierPricing(a.connectionCount, a.accountAgeMonths, a.hasSalesNav, a.linkedinVerified).monthly;
        const descParts: string[] = [];
        if (a.connectionCount > 0) descParts.push(`${a.connectionCount.toLocaleString()}+ connections`);
        if (a.industry) descParts.push(a.industry);
        if (a.location) descParts.push(a.location);
        if (a.hasSalesNav) descParts.push("Sales Navigator enabled");
        // Generic description only — never publish the real headline (can name a company/person).
        const description =
          `Pre-warmed LinkedIn account for rent on LinkedVelocity${descParts.length ? ` — ${descParts.join(", ")}` : ""}.`;

        return {
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Product",
            "@id": `https://linkedvelocity.com/account/${a.id}`,
            name: `Rent LinkedIn Account: ${displayName}`,
            description,
            url: `https://linkedvelocity.com/account/${a.id}`,
            // image intentionally omitted — never expose the real profile photo
            category: a.industry || "LinkedIn Account Rental",
            brand: { "@type": "Brand", name: "LinkedVelocity" },
            offers: {
              "@type": "Offer",
              url: `https://linkedvelocity.com/account/${a.id}`,
              price: price.toFixed(2),
              priceCurrency: "USD",
              priceSpecification: {
                "@type": "UnitPriceSpecification",
                price: price.toFixed(2),
                priceCurrency: "USD",
                unitText: "MONTH",
                referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
              },
              availability: "https://schema.org/InStock",
              businessFunction: "https://purl.org/goodrelations/v1#LeaseOut",
              seller: { "@type": "Organization", name: "LinkedVelocity", url: "https://linkedvelocity.com" },
            },
            additionalProperty: [
              a.connectionCount > 0
                ? { "@type": "PropertyValue", name: "Connections", value: a.connectionCount }
                : null,
              a.industry ? { "@type": "PropertyValue", name: "Industry", value: a.industry } : null,
              a.location ? { "@type": "PropertyValue", name: "Location", value: a.location } : null,
              { "@type": "PropertyValue", name: "Sales Navigator", value: a.hasSalesNav ? "Yes" : "No" },
            ].filter(Boolean),
          },
        };
      }),
    };

    return itemList;
  } catch (error) {
    console.error("Catalogue schema build failed:", error);
    return null;
  }
}

export default async function CatalogueLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const schema = await getCatalogueSchema();
  return (
    <>
      {schema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      )}
      <div className={blogFontVars}>{children}</div>
      {/* SEO-only content for search engines — hidden visually but indexable */}
      <div
        style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", overflow: "hidden" }}
        aria-hidden="true"
      >
        <h2>Rent LinkedIn Accounts for Outreach</h2>
        <p>
          Browse LinkedVelocity&apos;s catalogue of verified, pre-warmed LinkedIn accounts available for
          monthly rental. Each account comes with an established connection network, account
          history, and instant access via GoLogin anti-detect browser.
        </p>
        <h3>Filter by Industry</h3>
        <p>
          Find LinkedIn accounts in Technology, SaaS, Marketing, Finance, Healthcare,
          Recruiting, FinTech, Consulting, and more. Match your outreach campaigns with
          industry-relevant profiles.
        </p>
        <h3>Account Features</h3>
        <ul>
          <li>Connection counts from 500 to 30,000+</li>
          <li>Account ages from 1 to 15+ years</li>
          <li>Sales Navigator enabled accounts available</li>
          <li>Verified and pre-warmed for immediate use</li>
          <li>Monthly pricing from $45 to $110</li>
        </ul>
        <h3>Why Rent LinkedIn Accounts?</h3>
        <p>
          Renting LinkedIn accounts allows sales teams to scale outreach without building
          profiles from scratch. Each account is aged, has established connections, and is
          ready for campaigns. Cancel anytime with no long-term commitment.
        </p>
      </div>
    </>
  );
}
