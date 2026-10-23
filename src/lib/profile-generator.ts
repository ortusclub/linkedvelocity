// Level-4 profile generator — curated pools, no AI, no cost. Produces a believable
// profile for a PH person positioned in the US: US location + industry, but PH work
// history (2 PAST roles only, real PH companies) and a PH university. Personas stay in
// the outreach-credible lanes (BD / Sales / Marketing / GTM) and cap at manager.

export type ProfileLane = "Business Development" | "Sales" | "Marketing" | "GTM";

export interface ProfileExperience {
  title: string; company: string; start: string; end: string; duration: string; blurb: string;
}
export interface ProfileBuild {
  generatedAt: string;
  appliedAt?: string | null; // set when "Mark saved" writes the short headline + location to inventory
  lane: ProfileLane;
  headline: string;
  location: string; // "City, USA"
  zip: string;
  industry: string;
  about: string;
  experiences: ProfileExperience[]; // most-recent first, both PAST
  education: { school: string; degree: string; start: string; end: string };
}

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const rint = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pickN = <T,>(a: readonly T[], n: number): T[] => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b.slice(0, n);
};

// Real PH companies safe for PAST employment — big, BPO, startups, and defunct/acquired.
const PH_COMPANIES = [
  "PLDT", "Globe Telecom", "Smart Communications", "Ayala Land", "Jollibee Foods Corporation",
  "San Miguel Corporation", "BDO Unibank", "Metrobank", "Converge ICT", "Aboitiz Equity Ventures",
  "Concentrix", "Teleperformance Philippines", "Sutherland Global Services", "TaskUs", "Alorica",
  "VXI Global Solutions", "TTEC Philippines", "Telus International Philippines", "Accenture Philippines", "IBM Philippines",
  "Sprout Solutions", "First Circle", "Kalibrr", "PayMongo", "Kumu", "Great Deals E-commerce", "PDAX", "NextPay",
  "Zalora Philippines", "Lazada Philippines", "Shopee Philippines", "Grab Philippines", "foodpanda Philippines", "Maya",
  // defunct / acquired — ideal "past" employers
  "Sykes Asia", "Chikka Asia", "Multiply.com", "Ensogo Philippines", "MetroDeal", "Lamudi Philippines", "OLX Philippines",
] as const;

const PH_SCHOOLS = [
  "University of the Philippines Diliman", "University of the Philippines Los Baños", "Ateneo de Manila University",
  "De La Salle University", "University of Santo Tomas", "Far Eastern University", "Mapúa University",
  "Polytechnic University of the Philippines", "University of San Carlos", "Silliman University",
  "Adamson University", "San Beda University", "Centro Escolar University", "University of the East",
  "Lyceum of the Philippines University", "National University", "Saint Louis University",
  "Xavier University – Ateneo de Cagayan", "Technological Institute of the Philippines", "De La Salle-College of Saint Benilde",
  "University of Asia and the Pacific", "University of San Jose–Recoletos", "Holy Angel University", "Bicol University",
] as const;
const PH_DEGREES: readonly [string, string][] = [
  ["Bachelor of Science", "Business Administration"], ["Bachelor of Science", "Marketing Management"],
  ["Bachelor of Science", "Management"], ["Bachelor of Arts", "Communication"], ["Bachelor of Science", "Commerce"],
  ["Bachelor of Science", "Entrepreneurship"], ["Bachelor of Arts", "Economics"], ["Bachelor of Science", "Business Economics"],
  ["Bachelor of Science", "Information Technology"], ["Bachelor of Science", "Psychology"],
];

const US_LOCATIONS: readonly [string, string, string][] = [
  ["Austin", "Texas", "78701"], ["Dallas", "Texas", "75201"], ["Houston", "Texas", "77002"],
  ["Denver", "Colorado", "80202"], ["Seattle", "Washington", "98101"], ["Chicago", "Illinois", "60601"],
  ["Atlanta", "Georgia", "30303"], ["Charlotte", "North Carolina", "28202"], ["Raleigh", "North Carolina", "27601"],
  ["Nashville", "Tennessee", "37203"], ["Tampa", "Florida", "33602"], ["Orlando", "Florida", "32801"],
  ["Phoenix", "Arizona", "85004"], ["Scottsdale", "Arizona", "85251"], ["Columbus", "Ohio", "43215"],
  ["Minneapolis", "Minnesota", "55401"], ["Salt Lake City", "Utah", "84101"], ["Portland", "Oregon", "97204"],
  ["San Diego", "California", "92101"], ["Sacramento", "California", "95814"], ["Boston", "Massachusetts", "02108"],
  ["Pittsburgh", "Pennsylvania", "15222"], ["Kansas City", "Missouri", "64106"], ["Indianapolis", "Indiana", "46204"],
  ["Richmond", "Virginia", "23219"], ["Boise", "Idaho", "83702"],
];

// Titles per lane, roughly junior → mid; capped at manager.
const LANES: Record<ProfileLane, readonly string[]> = {
  "Business Development": ["Business Development Representative", "Business Development Associate", "Partnerships Associate", "Business Development Specialist", "Partnerships Manager", "Business Development Manager"],
  "Sales": ["Sales Development Representative", "Inside Sales Representative", "Account Executive", "Sales Associate", "Account Manager", "Sales Manager"],
  "Marketing": ["Marketing Associate", "Marketing Specialist", "Digital Marketing Specialist", "Demand Generation Specialist", "Content Marketing Specialist", "Growth Marketing Manager", "Marketing Manager"],
  "GTM": ["Go-to-Market Associate", "Sales Operations Specialist", "Revenue Operations Analyst", "Marketing Operations Specialist", "Sales Engineer", "Revenue Operations Manager"],
};
export const PROFILE_LANES = Object.keys(LANES) as ProfileLane[];

// Several credible LinkedIn industries per lane so the field varies across accounts.
// Every option here must fold to the SAME catalogue bucket as the others in its lane
// via toIndustryBucket (src/lib/industry.ts) so the public catalogue stays uniform —
// keep that alias map in sync when adding an industry here.
const INDUSTRY_OPTIONS: Record<ProfileLane, readonly string[]> = {
  "Business Development": ["Information Technology & Services", "Software Development", "IT Services and IT Consulting"], // → Technology
  "Sales": ["Computer Software", "Software Development", "Technology, Information and Internet"], // → Technology
  "Marketing": ["Marketing & Advertising", "Advertising Services", "Marketing Services"], // → Marketing
  "GTM": ["Business Consulting & Services", "Management Consulting"], // → Sales
};
// ~8 headlines per lane. The lead segment (before the first "|") is also what the
// catalogue shows as the short headline, so keep that opening phrase self-contained.
const HEADLINES: Record<ProfileLane, readonly string[]> = {
  "Business Development": [
    "Business Development & Partnerships | B2B SaaS | Pipeline & revenue growth",
    "Business Development | Helping B2B teams open doors and close deals",
    "Partnerships & Growth | SaaS & Tech | Building revenue-driving relationships",
    "BD & Partnerships | B2B | Turning first conversations into pipeline",
    "New Business & Partnerships | SaaS & Tech",
    "Business Development | Outbound, partnerships & revenue growth",
    "Partnerships & New Business | Helping B2B teams grow",
    "B2B Business Development | Pipeline, partnerships, results",
  ],
  "Sales": [
    "B2B Sales | SaaS & Tech | Helping teams hit revenue targets",
    "Account Management & New Business | B2B | Quota-carrying closer",
    "Sales | Pipeline generation to closed-won in B2B SaaS",
    "B2B Sales & Account Management | SaaS",
    "Full-Cycle Sales | B2B SaaS & Tech",
    "Sales | Discovery to closed-won, done right",
    "Account Executive | B2B software & services",
    "B2B Sales | Pipeline, demos & deals that stick",
  ],
  "Marketing": [
    "B2B Marketing | Demand Gen & Content | Driving qualified pipeline",
    "Growth & Demand Generation | SaaS | Turning campaigns into revenue",
    "Marketing | B2B demand generation and brand that converts",
    "B2B Marketing | Demand gen, content & pipeline",
    "Demand Generation | SaaS | Campaigns that convert",
    "Growth Marketing | B2B | Pipeline over impressions",
    "Marketing | Connecting campaigns to revenue",
    "B2B Marketing | Content, email & demand gen",
  ],
  "GTM": [
    "Go-to-Market & RevOps | SaaS | Aligning sales, marketing & data",
    "Revenue Operations | B2B SaaS | Process, data & pipeline efficiency",
    "GTM Engineering | Building the systems behind revenue teams",
    "RevOps & GTM | B2B SaaS | Clean data, clear forecasts",
    "Revenue Operations | Process, tooling & pipeline",
    "GTM Operations | Aligning sales & marketing",
    "RevOps | B2B | The systems behind the number",
    "Go-to-Market Ops | SaaS | Making revenue teams run",
  ],
};
// The "About" is assembled from an opening (carries {yrs}), a focus line, and a closing
// line — each picked independently — so no two reads the same even within a lane. Any
// opening + focus + close combination must read naturally on its own.
const ABOUT_OPEN: Record<ProfileLane, readonly string[]> = {
  "Business Development": [
    "Business development professional with {yrs} years in B2B tech and services.",
    "Partnerships and new-business specialist with {yrs} years across SaaS and tech.",
    "{yrs} years in B2B business development, mostly with software and services companies.",
    "Revenue-focused business development pro with {yrs} years opening new markets.",
  ],
  "Sales": [
    "B2B sales professional with {yrs} years selling software and services to growing companies.",
    "Full-cycle B2B seller with {yrs} years carrying a quota in SaaS and tech.",
    "{yrs} years in B2B sales, from first touch to closed-won.",
    "Quota-carrying account executive with {yrs} years across mid-market software.",
  ],
  "Marketing": [
    "Marketing professional with {yrs} years in B2B demand generation and content.",
    "Demand-gen and content marketer with {yrs} years in SaaS and tech.",
    "{yrs} years in B2B marketing, focused on pipeline over vanity metrics.",
    "Growth-minded marketer with {yrs} years connecting campaigns to revenue.",
  ],
  "GTM": [
    "Go-to-market and revenue operations professional with {yrs} years keeping sales and marketing aligned.",
    "RevOps specialist with {yrs} years building the systems behind revenue teams.",
    "{yrs} years in GTM operations, from CRM hygiene to forecasting.",
    "Operations-minded GTM pro with {yrs} years making revenue teams run smoothly.",
  ],
};
const ABOUT_FOCUS: Record<ProfileLane, readonly string[]> = {
  "Business Development": [
    "I focus on opening new markets, building partnerships, and turning first conversations into qualified pipeline.",
    "My sweet spot is top-of-funnel: researching the right accounts, starting the right conversations, and handing sales clean opportunities.",
    "I build outbound from scratch and nurture partner channels that create new revenue lines.",
    "I like the early, messy part of a deal — finding the opening and earning the first meeting.",
  ],
  "Sales": [
    "I'm at my best running a full cycle — building pipeline, leading discovery, and closing deals that stick.",
    "I sell by understanding the problem first and letting the fit do the convincing.",
    "I own the number end to end: prospecting, demos, negotiation, and the signature.",
    "I balance chasing new business with growing the accounts I already have.",
  ],
  "Marketing": [
    "I build campaigns that create real pipeline, not just impressions.",
    "I work close to sales so marketing is measured on revenue, not reach.",
    "I run demand gen, content, and email as one system feeding the funnel.",
    "I test fast, keep what converts, and cut what doesn't.",
  ],
  "GTM": [
    "I build the processes, reporting, and tooling that let revenue teams scale without the chaos.",
    "I turn messy pipelines and scattered data into clean forecasts and clear routing.",
    "I sit between sales and marketing and make the handoffs actually work.",
    "I own the GTM stack and keep the numbers trustworthy.",
  ],
};
const ABOUT_CLOSE: Record<ProfileLane, readonly string[]> = {
  "Business Development": [
    "Comfortable owning the top of the funnel end to end.",
    "Happiest when a cold account turns into a real relationship.",
    "I care about pipeline that actually closes, not just meetings booked.",
    "Always chasing the next door worth knocking on.",
  ],
  "Sales": [
    "A consistent performer who cares about the customer outcome, not just the signature.",
    "I'd rather lose fast than oversell a bad fit.",
    "Repeat business is the metric I'm proudest of.",
    "Relationships outlast any single quarter.",
  ],
  "Marketing": [
    "Equal parts creative and data-driven.",
    "I like marketing you can tie back to a closed deal.",
    "Curious by default, measured by habit.",
    "The best campaign is the one sales actually thanks you for.",
  ],
  "GTM": [
    "I like fixing the plumbing so the team can just sell.",
    "Clean data is how I keep everyone honest.",
    "If a dashboard is lying, I can't rest until it's fixed.",
    "Process should serve the deal, never the other way around.",
  ],
};
const BLURBS: Record<ProfileLane, readonly string[]> = {
  "Business Development": ["Built and qualified outbound pipeline across new verticals and regions.", "Developed partner relationships that opened new revenue channels.", "Owned early-stage prospecting and handed sales-ready opportunities to the team.", "Researched target markets and ran outreach to decision-makers.", "Booked qualified meetings with decision-makers across target accounts.", "Launched outreach into a new region and built the first pipeline there.", "Qualified inbound interest and routed sales-ready deals to closers.", "Mapped target markets and built account lists for outbound."],
  "Sales": ["Managed a portfolio of B2B accounts and consistently hit quarterly quota.", "Ran full-cycle sales from discovery to close for mid-market clients.", "Generated and converted inbound and outbound pipeline into closed revenue.", "Handled renewals and upsells across an existing book of business.", "Closed new-business deals across a mid-market territory.", "Ran discovery and demos and carried deals through to signature.", "Grew an existing book through renewals and upsells.", "Consistently landed in the top tier of the sales team."],
  "Marketing": ["Planned and ran demand-gen campaigns that drove qualified pipeline.", "Owned content and email programs supporting the sales funnel.", "Partnered with sales to improve lead quality and conversion.", "Managed paid and organic channels and reported on pipeline contribution.", "Ran email and nurture programs that moved leads down the funnel.", "Built landing pages and campaigns measured on pipeline, not clicks.", "Launched content that sales actually used in deals.", "Reported campaign contribution to pipeline and revenue."],
  "GTM": ["Built reporting and dashboards for the revenue team.", "Streamlined lead routing and CRM processes across sales and marketing.", "Supported forecasting, territory planning, and pipeline hygiene.", "Owned the GTM tech stack and kept data clean across tools.", "Cleaned up CRM data and standardized pipeline stages.", "Built forecasting and territory models for the sales team.", "Automated lead routing between marketing and sales.", "Maintained the GTM tool stack and kept integrations healthy."],
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMY = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const minus = (d: Date, months: number) => new Date(d.getFullYear(), d.getMonth() - months, 1);
const durLabel = (a: Date, b: Date) => {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const y = Math.floor(m / 12); m = m % 12;
  return [y ? `${y} yr${y > 1 ? "s" : ""}` : "", m ? `${m} mo${m > 1 ? "s" : ""}` : ""].filter(Boolean).join(" ") || "1 mo";
};

export function generateProfile(name: string, laneChoice?: ProfileLane | "auto"): ProfileBuild {
  const lane: ProfileLane = laneChoice && laneChoice !== "auto" ? laneChoice : pick(PROFILE_LANES);
  const titles = LANES[lane];
  const now = new Date();
  // Most recent role ended 12–42 months ago (so NOT a present role).
  const r2End = minus(now, rint(12, 42));
  const r2Dur = rint(18, 42); const r2Start = minus(r2End, r2Dur);
  const r1End = minus(r2Start, rint(0, 6)); // small gap
  const r1Dur = rint(18, 42); const r1Start = minus(r1End, r1Dur);
  // Role 1 (earlier) more junior than role 2 (recent); both ≤ manager.
  const i2 = rint(1, titles.length - 1); const i1 = rint(0, Math.max(0, i2 - 1));
  const [co2, co1] = pickN(PH_COMPANIES, 2);
  const [b2, b1] = pickN(BLURBS[lane], 2);
  const totalYrs = Math.max(2, Math.round((r1Dur + r2Dur) / 12));
  const [deg, field] = pick(PH_DEGREES);
  const eduEnd = r1Start.getFullYear() - rint(0, 1);
  const [city, , zip] = pick(US_LOCATIONS);
  return {
    generatedAt: new Date().toISOString(),
    appliedAt: null,
    lane,
    headline: pick(HEADLINES[lane]),
    location: `${city}, USA`,
    zip,
    industry: pick(INDUSTRY_OPTIONS[lane]),
    about: [pick(ABOUT_OPEN[lane]).replace("{yrs}", String(totalYrs)), pick(ABOUT_FOCUS[lane]), pick(ABOUT_CLOSE[lane])].join(" "),
    experiences: [
      { title: titles[i2], company: co2, start: fmtMY(r2Start), end: fmtMY(r2End), duration: durLabel(r2Start, r2End), blurb: b2 },
      { title: titles[i1], company: co1, start: fmtMY(r1Start), end: fmtMY(r1End), duration: durLabel(r1Start, r1End), blurb: b1 },
    ],
    education: { school: pick(PH_SCHOOLS), degree: `${deg} in ${field}`, start: String(eduEnd - 4), end: String(eduEnd) },
  };
}

// The short headline for our inventory catalogue = the lead segment before the first "|"
// (e.g. "Business Development & Partnerships"), not the full pipe-delimited tagline. The
// full headline is what gets pasted onto LinkedIn; inventory just shows the role.
export function shortHeadline(full: string): string {
  return (full || "").split("|")[0].trim();
}

// One plain-text block for "copy all".
export function renderProfileText(name: string, p: ProfileBuild): string {
  return [
    `${name} — profile build (${p.lane})`,
    ``,
    `HEADLINE`,
    p.headline,
    ``,
    `LOCATION`,
    `${p.location}  (ZIP ${p.zip})`,
    ``,
    `INDUSTRY`,
    p.industry,
    ``,
    `ABOUT`,
    p.about,
    ``,
    `EXPERIENCE 1 (most recent — past)`,
    `${p.experiences[0].title} · ${p.experiences[0].company}`,
    `${p.experiences[0].start} – ${p.experiences[0].end}  (${p.experiences[0].duration})`,
    p.experiences[0].blurb,
    ``,
    `EXPERIENCE 2 (earlier — past)`,
    `${p.experiences[1].title} · ${p.experiences[1].company}`,
    `${p.experiences[1].start} – ${p.experiences[1].end}  (${p.experiences[1].duration})`,
    p.experiences[1].blurb,
    ``,
    `EDUCATION`,
    p.education.school,
    `${p.education.degree} · ${p.education.start} – ${p.education.end}`,
  ].join("\n");
}
