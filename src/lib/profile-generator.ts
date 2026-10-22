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

const INDUSTRIES: Record<ProfileLane, string> = {
  "Business Development": "Information Technology & Services", "Sales": "Computer Software",
  "Marketing": "Marketing & Advertising", "GTM": "Business Consulting & Services",
};
const HEADLINES: Record<ProfileLane, readonly string[]> = {
  "Business Development": ["Business Development & Partnerships | B2B SaaS | Pipeline & revenue growth", "Business Development | Helping B2B teams open doors and close deals", "Partnerships & Growth | SaaS & Tech | Building revenue-driving relationships"],
  "Sales": ["B2B Sales | SaaS & Tech | Helping teams hit revenue targets", "Account Management & New Business | B2B | Quota-carrying closer", "Sales | Pipeline generation to closed-won in B2B SaaS"],
  "Marketing": ["B2B Marketing | Demand Gen & Content | Driving qualified pipeline", "Growth & Demand Generation | SaaS | Turning campaigns into revenue", "Marketing | B2B demand generation and brand that converts"],
  "GTM": ["Go-to-Market & RevOps | SaaS | Aligning sales, marketing & data", "Revenue Operations | B2B SaaS | Process, data & pipeline efficiency", "GTM Engineering | Building the systems behind revenue teams"],
};
const ABOUTS: Record<ProfileLane, string> = {
  "Business Development": "Business development professional with {yrs} years in B2B tech and services. I focus on opening new markets, building partnerships, and turning first conversations into long-term revenue. Comfortable owning the top of the funnel end to end — from prospecting to qualified pipeline.",
  "Sales": "B2B sales professional with {yrs} years selling software and services to growing companies. I'm at my best managing a full cycle — building pipeline, running discovery, and closing deals that stick. A consistent quota performer who cares about the customer outcome, not just the signature.",
  "Marketing": "Marketing professional with {yrs} years in B2B demand generation and content. I build campaigns that create real pipeline, not just impressions, and I like working close to sales so marketing is measured on revenue. Equal parts creative and data-driven.",
  "GTM": "Go-to-market and revenue operations professional with {yrs} years keeping sales and marketing teams aligned, efficient, and data-driven. I build the processes, reporting, and tooling that let revenue teams scale without the chaos.",
};
const BLURBS: Record<ProfileLane, readonly string[]> = {
  "Business Development": ["Built and qualified outbound pipeline across new verticals and regions.", "Developed partner relationships that opened new revenue channels.", "Owned early-stage prospecting and handed sales-ready opportunities to the team.", "Researched target markets and ran outreach to decision-makers."],
  "Sales": ["Managed a portfolio of B2B accounts and consistently hit quarterly quota.", "Ran full-cycle sales from discovery to close for mid-market clients.", "Generated and converted inbound and outbound pipeline into closed revenue.", "Handled renewals and upsells across an existing book of business."],
  "Marketing": ["Planned and ran demand-gen campaigns that drove qualified pipeline.", "Owned content and email programs supporting the sales funnel.", "Partnered with sales to improve lead quality and conversion.", "Managed paid and organic channels and reported on pipeline contribution."],
  "GTM": ["Built reporting and dashboards for the revenue team.", "Streamlined lead routing and CRM processes across sales and marketing.", "Supported forecasting, territory planning, and pipeline hygiene.", "Owned the GTM tech stack and kept data clean across tools."],
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
    industry: INDUSTRIES[lane],
    about: ABOUTS[lane].replace("{yrs}", String(totalYrs)),
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
