import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SHADOW_RENTER_EMAILS } from "@/lib/shadow-rental";
import { tierPricing } from "@/lib/account-pricing";
import Agent360Catalogue, { type A360Row, type CatalogueConfig } from "./Agent360Catalogue";

// Fields each catalogue's price function reads off an account row.
type PriceInput = { connectionCount: number; accountAgeMonths: number | null; linkedinVerified: boolean };

// Unlisted partner inventory catalogue. Not linked anywhere and gated behind an
// unguessable slug, so the link can be shared with a renter (e.g. Profile Partner)
// without exposing real profile URLs to the public catalogue (which masks them).
// Live off the DB so it stays current as inventory changes.
export const dynamic = "force-dynamic";

// The unlisted key. Change this to rotate the link.
const SLUG = "iv-7h2k9x3mqp";

// Agent360 gets its own slug + password gate + the full pipeline (available, shadow-held
// and everything in warm-up) so they can earmark future accounts, not just available ones.
const A360_SLUG = "iv-a360-9mq2k7xz4p";
const A360_PASSWORD = "Agent360-LV2026";
// Agent360 pricing: unverified $45, verified $60 (volume rate handled in copy, not per-card).
const a360Price = (a: PriceInput) => (a.linkedinVerified ? 60 : 45);

// Will Cura — same full-pipeline catalogue on the Agent360 pattern, but BROWSE-ONLY (no Rent link):
// his direct checkout would price off the account tier (SN withdrawn → undercharged, no SN), so he
// replies with picks and we provision manually with lockedPrice + SN. Price shown = the SAME
// per-account public/website tier price (by connections + age, +$10 verified), with Sales Navigator
// presented as a separate +$70/account add-on we set up. No flat rate.
const WILL_SLUG = "iv-will-cura-6k2p9mx4qz";
const WILL_PASSWORD = "CuraLV2026";
const willPrice = (a: PriceInput) => tierPricing(a.connectionCount, a.accountAgeMonths, false, a.linkedinVerified).monthly;
const WILL_CFG: CatalogueConfig = {
  forLabel: "Cura",
  storageKey: "willcura",
  heroBlurb: "Aged, warmed LinkedIn profiles, plus everything currently in warm-up. Each account is priced by tier (connections and age), starting at $45/mo, with +$10 if verified. Sales Navigator is an optional +$70 per account, which we set up for you. Open any profile to review it.",
  legend: [
    { cls: "u", label: "By tier", value: "from $45/mo" },
    { cls: "v", label: "✓ Verified", value: "+$10/mo" },
    { cls: "v", label: "Sales Navigator", value: "+$70/mo" },
  ],
  showRent: false,
  showAge: true,
  snAddon: 70,
};

// Martin Perak — NY real-estate renter testing with Alta. Full-pipeline catalogue on the Agent360
// pattern, standard per-account website tier price (by connections + age, +$10 verified), no Sales
// Navigator (not offered to new renters). First-come Rent link ON: his self-serve checkout prices
// off the tier with no SN, so it can't undercharge, and it maps to the "pick one from the website"
// flow we agreed with him.
const MARTIN_SLUG = "iv-martin-perak-3n8k2w5xqp";
const MARTIN_PASSWORD = "PerakLV2026";
const martinPrice = (a: PriceInput) => tierPricing(a.connectionCount, a.accountAgeMonths, false, a.linkedinVerified).monthly;
const MARTIN_CFG: CatalogueConfig = {
  forLabel: "Martin Perak",
  storageKey: "martinperak",
  heroBlurb: "Aged, warmed LinkedIn profiles, plus everything currently in warm-up. Each account is priced by tier (connections and age), starting at $45/mo, with +$10 if verified. Open any profile to review it, then hit Rent to take one.",
  legend: [
    { cls: "u", label: "By tier", value: "from $45/mo" },
    { cls: "v", label: "✓ Verified", value: "+$10/mo" },
  ],
  showRent: true,
  showAge: true,
  snAddon: null,
};

// Build the full-pipeline rows (available now + shadow-held "soon" + built/maturing "coming soon")
// for a password-gated catalogue (Agent360, Will Cura). `priceFn` sets the per-card price (pricing
// differs per catalogue). Admin-held accounts (heldUntil set) are excluded from "available now".
async function pipelineRows(priceFn: (a: PriceInput) => number): Promise<A360Row[]> {
  const sel = { id: true, linkedinName: true, linkedinUrl: true, connectionCount: true, linkedinVerified: true, accountAgeMonths: true, industry: true, linkedinHeadline: true } as const;
  const normUrl = (u: string | null) => (u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").split("?")[0].replace(/\/+$/, "");
  // Some names are stored ALL CAPS or all lowercase; title-case only those words, leaving
  // genuinely mixed-case names (e.g. "MagbooRoldan", "McLeod") untouched.
  const titleCaseName = (n: string) => n.split(/\s+/).map((w) => {
    const upper = w === w.toUpperCase() && w !== w.toLowerCase();
    const lower = w === w.toLowerCase() && w !== w.toUpperCase();
    return (upper || lower) ? w.toLowerCase().replace(/(^|[-'’.])(\p{L})/gu, (_, s, c) => s + c.toUpperCase()) : w;
  }).join(" ");
  const [shadowRentals, availableA, warmRaw, unavailRaw, verifiedApps] = await Promise.all([
    prisma.rental.findMany({ where: { user: { email: { in: SHADOW_RENTER_EMAILS } } }, select: { linkedinAccountId: true } }),
    prisma.linkedInAccount.findMany({
      where: { status: "available", restrictedAt: null, twoFactorResetNeeded: false, heldUntil: null, linkedinUrl: { not: null } },
      select: sel,
    }),
    prisma.linkedInAccount.findMany({
      where: { status: { in: ["under_construction", "construction_immature"] }, restrictedAt: null, twoFactorResetNeeded: false, exitReason: null, linkedinUrl: { not: null } },
      select: { ...sel, personalEmail: true },
    }),
    prisma.linkedInAccount.findMany({
      // exitReason set = account left inventory (returned to owner / access lost), so exclude it
      // even if its pipeline application is still verified — otherwise exited accounts leak into "Coming soon".
      where: { status: "unavailable", restrictedAt: null, twoFactorResetNeeded: false, exitReason: null, linkedinUrl: { not: null } },
      select: { ...sel, personalEmail: true },
    }),
    prisma.ambassadorApplication.findMany({
      where: { verifiedAt: { not: null }, status: { in: ["approved", "onboarded"] } },
      select: { linkedinUrl: true, email: true, status: true, selfServiceOnboarding: { select: { accountId: true } } },
    }),
  ]);
  const shadowSet = new Set(shadowRentals.map((r) => r.linkedinAccountId));
  type App = typeof verifiedApps[number];
  const matcherFor = (apps: App[]) => {
    const urls = new Set(apps.map((a) => normUrl(a.linkedinUrl)).filter(Boolean));
    const emails = new Set(apps.map((a) => a.email.toLowerCase()).filter(Boolean));
    const ids = new Set(apps.map((a) => a.selfServiceOnboarding?.accountId).filter((x): x is string => !!x));
    return (a: { id: string; linkedinUrl: string | null; personalEmail: string | null }) =>
      ids.has(a.id) || urls.has(normUrl(a.linkedinUrl)) || (!!a.personalEmail && emails.has(a.personalEmail.toLowerCase()));
  };
  const isMaturing = matcherFor(verifiedApps.filter((a) => a.status === "approved")); // Level 4
  const isBuilt = matcherFor(verifiedApps); // approved + onboarded
  const hasUrl = (a: { linkedinUrl: string | null }) => !!a.linkedinUrl && !a.linkedinUrl.includes("charlotte-bax");
  const mk = (a: typeof availableA[number], status: string): A360Row => ({
    id: a.id,
    name: titleCaseName((a.linkedinName || "").trim()),
    url: cleanUrl(a.linkedinUrl),
    cc: a.connectionCount || 0,
    v: a.linkedinVerified,
    price: priceFn({ connectionCount: a.connectionCount || 0, accountAgeMonths: a.accountAgeMonths ?? null, linkedinVerified: a.linkedinVerified }),
    ageMonths: a.accountAgeMonths ?? null,
    status,
    shadow: shadowSet.has(a.id),
    industry: a.industry || null,
    headline: (a.linkedinHeadline || "").trim() || null,
  });
  return [
    ...availableA.map((a) => mk(a, "available")),
    ...unavailRaw.filter((a) => isBuilt(a) && hasUrl(a)).map((a) => mk(a, "soon")),
    ...warmRaw.filter((a) => isMaturing(a) && hasUrl(a)).map((a) => mk(a, "soon")),
  ];
}

// Partner wholesale pricing, floor held at $40: verified $50; unverified $45 at
// 200+ connections, else $40.
const priceOf = (v: boolean, cc: number) => (v ? 50 : cc >= 200 ? 40 : 30);

type Row = { id: string; name: string; url: string; cc: number; v: boolean; price: number };

const cleanUrl = (u: string | null) => (u || "").split("?")[0].replace(/\/$/, "");
const toRow = (a: { id: string; linkedinName: string; linkedinUrl: string | null; connectionCount: number; linkedinVerified: boolean }): Row =>
  ({ id: a.id, name: (a.linkedinName || "").trim(), url: cleanUrl(a.linkedinUrl), cc: a.connectionCount || 0, v: a.linkedinVerified, price: priceOf(a.linkedinVerified, a.connectionCount || 0) });
const sortVC = (a: Row, b: Row) => (Number(b.v) - Number(a.v)) || (b.cc - a.cc);

const CSS = `
.pp-wrap{--ink:#101828;--muted:#5a6475;--faint:#98a1b0;--line:#e5e9ef;--card:#ffffff;--surface:#f3f5f8;--bg:#f6f7f9;--accent:#0a66c2;--accent-soft:#e8f1fb;--verified:#067a45;--verified-soft:#e3f3ea;min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--font-inter),system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
.pp-wrap *{box-sizing:border-box}
.pp-top{position:sticky;top:0;z-index:5;background:rgba(246,247,249,.9);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.pp-top-in,.pp-main{max-width:1060px;margin:0 auto;padding-left:20px;padding-right:20px}
.pp-top-in{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding-top:14px;padding-bottom:14px}
.pp-brand{display:flex;flex-direction:column;gap:1px}
.pp-brand b{font-family:var(--font-poppins),var(--font-inter),sans-serif;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--accent)}
.pp-brand span{font-size:12px;color:var(--muted)}
.pp-legend{display:flex;gap:8px;flex-wrap:wrap}
.pp-lg{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding:6px 11px;border-radius:999px;border:1px solid var(--line);background:var(--card)}
.pp-lg i{font-style:normal;font-weight:700;font-variant-numeric:tabular-nums}
.pp-lg.v{color:var(--verified)}.pp-lg.u{color:var(--muted)}
.pp-main{padding-top:34px;padding-bottom:64px}
.pp-hero{margin-bottom:34px}
.pp-for{display:block;margin:0 0 10px;color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.pp-hero h1{font-family:var(--font-poppins),var(--font-inter),sans-serif;font-weight:700;font-size:clamp(28px,5vw,40px);letter-spacing:-.02em;margin:0 0 8px;text-wrap:balance}
.pp-hero p{margin:0;color:var(--muted);max-width:62ch;font-size:15px}
.pp-group{margin-bottom:40px}
.pp-ghead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:4px}
.pp-eyebrow{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent)}
.pp-gtitle{font-family:var(--font-poppins),var(--font-inter),sans-serif;font-weight:600;font-size:22px;letter-spacing:-.01em;margin:0}
.pp-count{font-size:12.5px;font-weight:700;color:var(--muted);background:var(--surface);border:1px solid var(--line);padding:2px 10px;border-radius:999px;font-variant-numeric:tabular-nums}
.pp-ghint{margin:0 0 16px;color:var(--muted);font-size:13.5px}
.pp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:13px}
.pp-card{display:flex;flex-direction:column;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:15px 16px;box-shadow:0 1px 2px rgba(16,24,40,.05)}
.pp-name{font-size:15.5px;font-weight:600;margin:0;letter-spacing:-.01em;line-height:1.25}
.pp-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:-2px}
.pp-chip{font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap}
.pp-chip.conn{background:var(--surface);color:var(--muted);font-variant-numeric:tabular-nums}
.pp-chip.verified{background:var(--verified-soft);color:var(--verified)}
.pp-chip.unverified{background:var(--surface);color:var(--faint)}
.pp-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:4px}
.pp-price{font-family:var(--font-poppins),var(--font-inter),sans-serif;font-weight:700;font-size:19px;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.pp-price .per{font-size:12px;font-weight:600;color:var(--muted)}
.pp-view{font-size:12.5px;font-weight:600;color:var(--accent);text-decoration:none;white-space:nowrap}
.pp-view:hover{text-decoration:underline}
.pp-note{margin-top:8px;padding-top:22px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px;line-height:1.6}
.pp-view:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
@media (max-width:440px){.pp-grid{grid-template-columns:1fr}}
`;

function Card({ a }: { a: Row }) {
  return (
    <article className="pp-card">
      <h3 className="pp-name">{a.name}</h3>
      <div className="pp-chips">
        <span className="pp-chip conn">{a.cc} connections</span>
        {a.v ? <span className="pp-chip verified">✓ Verified</span> : <span className="pp-chip unverified">Unverified</span>}
      </div>
      <div className="pp-foot">
        <span className="pp-price">${a.price}<span className="per">/mo</span></span>
        <a className="pp-view" href={a.url} target="_blank" rel="noopener noreferrer">View profile →</a>
      </div>
    </article>
  );
}

function Group({ eyebrow, title, hint, items }: { eyebrow: string; title: string; hint: string; items: Row[] }) {
  return (
    <section className="pp-group">
      <div className="pp-ghead">
        <span className="pp-eyebrow">{eyebrow}</span>
        <h2 className="pp-gtitle">{title}</h2>
        <span className="pp-count">{items.length}</span>
      </div>
      <p className="pp-ghint">{hint}</p>
      <div className="pp-grid">
        {items.map((a) => <Card key={a.id} a={a} />)}
      </div>
    </section>
  );
}

export default async function PartnerInventoryPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  // Agent360: full pipeline (available + shadow-held + all warm-up), password-gated, first-come rent.
  if (key === A360_SLUG) {
    const rows = await pipelineRows(a360Price);
    return <Agent360Catalogue rows={rows} password={A360_PASSWORD} />;
  }

  // Will Cura: same full-pipeline catalogue, browse-only (no Rent), real per-account tier price + SN add-on.
  if (key === WILL_SLUG) {
    const rows = await pipelineRows(willPrice);
    return <Agent360Catalogue rows={rows} password={WILL_PASSWORD} cfg={WILL_CFG} />;
  }

  // Martin Perak: full-pipeline catalogue, first-come Rent, standard tier price, no SN.
  if (key === MARTIN_SLUG) {
    const rows = await pipelineRows(martinPrice);
    return <Agent360Catalogue rows={rows} password={MARTIN_PASSWORD} cfg={MARTIN_CFG} />;
  }

  if (key !== SLUG) notFound();

  const select = { id: true, linkedinName: true, linkedinUrl: true, connectionCount: true, linkedinVerified: true } as const;

  const [shadowRentals, available, maturing] = await Promise.all([
    prisma.rental.findMany({ where: { user: { email: { in: SHADOW_RENTER_EMAILS } } }, select: { linkedinAccountId: true } }),
    prisma.linkedInAccount.findMany({
      where: { status: "available", restrictedAt: null, twoFactorResetNeeded: false, heldUntil: null, linkedinUrl: { not: null } },
      select,
    }),
    prisma.linkedInAccount.findMany({
      where: { status: { in: ["under_construction", "construction_immature"] }, restrictedAt: null, twoFactorResetNeeded: false, connectionCount: { gte: 40 }, linkedinUrl: { not: null } },
      select,
    }),
  ]);

  const shadowIds = new Set(shadowRentals.map((r) => r.linkedinAccountId));
  const now = available.filter((a) => !shadowIds.has(a.id)).map(toRow).sort(sortVC);
  const soon = [
    ...available.filter((a) => shadowIds.has(a.id)).map(toRow),
    ...maturing.filter((a) => a.linkedinUrl && !a.linkedinUrl.includes("charlotte-bax")).map(toRow),
  ].sort(sortVC);
  const total = now.length + soon.length;

  return (
    <div className="pp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="pp-top">
        <div className="pp-top-in">
          <div className="pp-brand"><b>LinkedVelocity</b><span>Account inventory</span></div>
          <div className="pp-legend">
            <span className="pp-lg u">Unverified &lt;200 <i>$30/mo</i></span>
            <span className="pp-lg u">Unverified 200+ <i>$40/mo</i></span>
            <span className="pp-lg v">✓ Verified <i>$50/mo</i></span>
          </div>
        </div>
      </div>
      <main className="pp-main">
        <div className="pp-hero">
          <span className="pp-for">Prepared for Profile Partner</span>
          <h1>Available accounts</h1>
          <p>Aged, warmed LinkedIn profiles ready for outreach. Pricing is per account, per month: unverified $30 (or $40 at 200+ connections), verified $50. Open any profile to review it.</p>
        </div>
        {now.length > 0 && (
          <Group eyebrow="Ready today" title="Available now" hint="Live and rentable right now. We can release these the moment you order." items={now} />
        )}
        {soon.length > 0 && (
          <Group eyebrow="Within 1 week" title="Available within 1 week" hint="Freeing up or finishing warm-up now. These can be acquired within a week of ordering." items={soon} />
        )}
        <p className="pp-note">
          {total} accounts total · {now.length} available now, {soon.length} within a week.<br />
          Prices per account / month. Let us know which you&apos;d like and we&apos;ll start releasing.
        </p>
      </main>
    </div>
  );
}
