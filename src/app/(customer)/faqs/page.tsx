import type { Metadata } from "next";
import { blogFontVars } from "@/lib/blog-fonts";
import FaqView, { type FaqGroup } from "./faq-view";
import { getBrand } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return {
    title: isArmy ? "FAQs — Hiring a LinkedIn Operator" : "FAQs — LinkedIn Account Rental Questions Answered",
    description: isArmy
      ? "Common questions about hiring LinkedIn Operators on LinkedArmy, and about becoming an operator — safety, pricing, payouts, and more."
      : "Common questions about renting LinkedIn accounts on LinkedVelocity, and about earning as an ambassador — safety, pricing, payouts, and more.",
    alternates: { canonical: "/faqs" },
    openGraph: {
      title: isArmy ? "Frequently Asked Questions | LinkedArmy" : "Frequently Asked Questions | LinkedVelocity",
      description: isArmy
        ? "Everything you need to know about hiring LinkedIn Operators and becoming an operator."
        : "Everything you need to know about renting LinkedIn accounts safely and earning as an ambassador.",
      url: `${brand.url}/faqs`,
    },
  };
}

const FAQ_GROUPS: FaqGroup[] = [
  {
    label: "Getting started",
    color: "#0A66C2",
    items: [
      { q: "What is LinkedVelocity?", a: "A marketplace where growth teams rent verified, pre-warmed LinkedIn accounts for outreach — and professionals earn by sharing accounts they no longer actively use. Every account belongs to a consenting real person; we handle secure access, warm-up, and support." },
      { q: "How does renting work?", a: "Browse the catalogue, rent a profile monthly, and open it in a secure anti-detect browser. You're running outreach from an established account in minutes — no warm-up period — while we manage the login layer and ongoing support." },
      { q: "What tools can I use with a rented account?", a: "Any Chrome extension or LinkedIn automation tool — Dripify, Expandi, Linked Helper and others all work inside the browser session. Sales Navigator is available on accounts that include it. We recommend keeping activity within safe limits (roughly 100–200 actions a week), and we'll share recommended ranges to guide you." },
      { q: "How fast do I get access after renting?", a: "Typically within minutes. Once you've completed the quick one-time browser setup, we grant access to your rented account and you can start outreach straight away." },
      { q: "Which regions are the accounts based in?", a: "We have accounts based across the US, UK, Canada, Australia and other regions. Browse the catalogue to filter by location, or tell us your target market and we'll match you to the best fit." },
      { q: "Can I rent more than one account?", a: "Yes — rent as many as you need. Each is billed separately, and teams running higher volume often run several accounts at once." },
    ],
  },
  {
    label: "Safety & compliance",
    color: "#0E7C74",
    items: [
      { q: "Will a rented account get restricted?", a: "Every session runs through an anti-detect browser with a dedicated proxy and isolated fingerprint, so LinkedIn sees one consistent user, and we enforce safe sending limits to protect the account. Accounts are actively monitored — and in the rare case one is restricted, we pause billing for it and move you to a replacement quickly, so your campaigns keep running." },
      { q: "Is this compliant and safe for the account owner?", a: "Every account is shared with the owner's explicit, ongoing consent. Owners commit to a light 6-month minimum and can withdraw after that (or sooner if they're ever concerned about their account). We secure access, mask credentials, and never expose the owner's password to renters." },
      { q: "What sending limits should I stay within?", a: "We recommend keeping activity within safe limits — roughly 100–200 actions per week — to keep the account healthy, and we'll share recommended ranges so you can set your outreach tool accordingly." },
      { q: "What happens if an account is restricted mid-campaign?", a: "We pause billing for that account immediately, credit you for the downtime, and move you to a replacement so your outreach keeps running with minimal disruption." },
    ],
  },
  {
    label: "Billing",
    color: "#946011",
    items: [
      { q: "How am I charged, and can I cancel?", a: "A flat monthly fee per account, paid by card (Stripe) or USDC. No contracts — cancel anytime and keep access through the end of your current billing period." },
      { q: "What does an account cost?", a: "Pricing depends on the account's seniority, connections, and whether Sales Navigator is included. Most accounts fall between $45 and $110 per month, with Sales Navigator available as a +$70/mo add-on, and you'll see the exact price before you commit." },
      { q: "Can I set up auto-renew?", a: "Yes. You can switch on monthly auto-renew so your account continues without interruption, and turn it off anytime." },
      { q: "What payment methods do you accept?", a: "Card via Stripe, or USDC (on Base). You'll choose at checkout." },
      { q: "Is there a setup fee or minimum term?", a: "No setup fee and no minimum term — you pay a flat monthly fee per account and can cancel anytime." },
    ],
  },
];

const FAQ_GROUPS_LA: FaqGroup[] = [
  {
    label: "Getting started",
    color: "#0A66C2",
    items: [
      { q: "What is LinkedArmy?", a: "A marketplace where growth teams hire verified LinkedIn Operators for outreach — and professionals earn by becoming an operator with an account they no longer actively use. Every operator is a consenting real person; we handle secure access, warm-up, and support." },
      { q: "How does hiring work?", a: "Browse the catalogue, hire an operator monthly, and you're running outreach from an established profile in minutes, with no warm-up period. We handle secure access and ongoing support behind the scenes." },
      { q: "What can I run from an operator's profile?", a: "You can run your usual LinkedIn outreach from the operator's profile, including the browser-based tools most growth teams already use. We recommend keeping activity within safe limits (roughly 100–200 actions a week), and we'll share recommended ranges to guide you." },
      { q: "How soon can I start after hiring?", a: "Typically within minutes. After a quick one-time setup, you're connected to your operator and can start outreach straight away." },
      { q: "Which regions are the operators based in?", a: "We have operators across the US, UK, Canada, Australia and other regions. Browse the catalogue to filter by location, or tell us your target market and we'll match you to the best fit." },
      { q: "Can I hire more than one operator?", a: "Yes — hire as many as you need. Each is billed separately, and teams running higher volume often work with several operators at once." },
    ],
  },
  {
    label: "Safety & compliance",
    color: "#0E7C74",
    items: [
      { q: "Will an operator get restricted?", a: "Every session runs in a secure, dedicated environment and we enforce safe sending limits to protect the profile. Profiles are actively monitored, and in the rare case one is restricted, we pause billing for it and move you to a replacement quickly, so your campaigns keep running." },
      { q: "Is this compliant and safe for the operator?", a: "Every operator takes part with their explicit, ongoing consent. They commit to a light 6-month minimum and can withdraw after that (or sooner if they're ever concerned). We keep access secure and the operator's credentials private at all times." },
      { q: "What sending limits should I stay within?", a: "We recommend keeping activity within safe limits, roughly 100–200 actions per week, to keep the profile healthy, and we'll share recommended ranges so you can pace your outreach accordingly." },
      { q: "What happens if an operator is restricted mid-campaign?", a: "We pause billing for that operator immediately, credit you for the downtime, and move you to a replacement so your outreach keeps running with minimal disruption." },
    ],
  },
  {
    label: "Billing",
    color: "#946011",
    items: [
      { q: "How am I charged, and can I cancel?", a: "A flat monthly fee per operator, paid by card (Stripe) or USDC. No contracts — cancel anytime and keep access through the end of your current billing period." },
      { q: "What does an operator cost?", a: "Pricing depends on the operator's seniority, connections, and account age. Most fall between $45 and $110 per month, and you'll see the exact price before you commit." },
      { q: "Can I set up auto-renew?", a: "Yes. You can switch on monthly auto-renew so your engagement continues without interruption, and turn it off anytime." },
      { q: "What payment methods do you accept?", a: "Card via Stripe, or USDC (on Base). You'll choose at checkout." },
      { q: "Is there a setup fee or minimum term?", a: "No setup fee and no minimum term — you pay a flat monthly fee per operator and can cancel anytime." },
    ],
  },
];

export default async function FAQsPage() {
  const brand = await getBrand();
  const groups = brand.id === "linkedarmy" ? FAQ_GROUPS_LA : FAQ_GROUPS;
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: groups.flatMap((g) =>
      g.items.map((it) => ({
        "@type": "Question",
        name: it.q,
        acceptedAnswer: { "@type": "Answer", text: it.a },
      }))
    ),
  };

  return (
    <div className={blogFontVars}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <FaqView groups={groups} isArmy={brand.id === "linkedarmy"} />
    </div>
  );
}
