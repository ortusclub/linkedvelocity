#!/usr/bin/env node
// Stop LV profile-maturing campaigns for one or more accounts — WITHOUT the browser
// or a logged-in admin session. Talks straight to the maturing engine with its bearer
// token, so it never hits linkedvelocity.com's login wall.
//
// Why this exists: Claude-in-Chrome can only act in a Chrome that is already logged into
// linkedvelocity.com, and it will never type a password/login code for you. So any admin
// action through the UI stalls at the login page and gets handed back to a human. This
// script is the no-browser path for the one op we do most: stopping maturing on accounts
// that should not be maturing.
//
// Usage:
//   MATURING_ENGINE_TOKEN=<token> node scripts/stop-maturing.mjs <name-or-email> [more…]
//     -> DRY RUN: prints the LV maturing campaigns that match, stops nothing.
//   …same… --yes
//     -> actually stops each matched campaign (warm + cold), immediately.
//
// Env:
//   MATURING_ENGINE_TOKEN  (required) the engine bearer token.
//   MATURING_ENGINE_URL    (optional) defaults to the LV maturing engine below.
//
// Safety: only ever touches campaigns whose id starts with "lv_" (LV maturing) and that
// are still live — never another client's campaigns, and never one already done/stopped.

const BASE = process.env.MATURING_ENGINE_URL || "https://dev-scraper.ortusclub.com";
const TOKEN = process.env.MATURING_ENGINE_TOKEN;

const LIVE = new Set(["running", "waiting_daily_reset", "needs_review", "monitoring", "scheduled"]);

function die(msg) { console.error(msg); process.exit(1); }

async function engine(path, body) {
  const r = await fetch(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

// An engine campaign name is the account login email for the warm campaign, or
// "<email> · Cold" for the cold one. Normalise both sides and the search term so a bare
// name fragment, a full email, or the exact campaign name all match.
const norm = (s) => String(s || "").replace(/\s*·\s*cold$/i, "").trim().toLowerCase();

async function main() {
  if (!TOKEN) die("Set MATURING_ENGINE_TOKEN (the engine bearer token) in the environment.");
  const args = process.argv.slice(2);
  const apply = args.includes("--yes");
  const terms = args.filter((a) => !a.startsWith("--")).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!terms.length) die("Give one or more account names or emails to stop. Add --yes to actually stop them.");

  const data = await engine("/api/campaign/list");
  const all = Array.isArray(data) ? data : data.campaigns || [];
  const lvAll = all.filter((c) => String(c.id || "").startsWith("lv_")); // LV maturing only

  // Match a term to campaigns. An "@" term is treated as an exact login email (safe —
  // surnames collide: a bare "espinosa" hits several different accounts). A bare term is
  // a substring match, but if it spans more than one distinct account we refuse and list
  // them, so we never stop the wrong person.
  const profileOf = (c) => String(c.id || "").replace(/^lv_/, "").replace(/_(warm|cold)$/i, "");
  const matched = [];
  for (const raw of terms) {
    const term = raw.toLowerCase();
    const hits = term.includes("@")
      ? lvAll.filter((c) => norm(c.name) === norm(term))
      : lvAll.filter((c) => norm(c.name).includes(term));
    if (!hits.length) { console.log(`• "${raw}" — no LV maturing campaign found.`); continue; }
    const profiles = [...new Set(hits.map(profileOf))];
    if (profiles.length > 1) {
      console.log(`• "${raw}" — matches ${profiles.length} different accounts; pass the full login email instead:`);
      for (const p of profiles) console.log(`    ${norm(hits.find((h) => profileOf(h) === p).name)}`);
      continue;
    }
    const live = hits.filter((c) => LIVE.has(c.status));
    if (!live.length) { console.log(`• "${raw}" (${norm(hits[0].name)}) — already stopped (${[...new Set(hits.map((h) => h.status))].join("/")}). Nothing to do.`); continue; }
    for (const h of live) if (!matched.find((m) => m.id === h.id)) matched.push(h);
  }

  if (!matched.length) { console.log("\nNothing live to stop."); return; }

  console.log(`\n${matched.length} live LV maturing campaign(s) matched:`);
  for (const c of matched) console.log(`  ${c.status.padEnd(20)} ${c.id}  (${c.name})`);

  if (!apply) { console.log('\nDRY RUN — nothing stopped. Re-run with --yes to stop these.'); return; }

  console.log("\nStopping…");
  let ok = 0;
  for (const c of matched) {
    try {
      await engine(`/api/campaign/${c.id}/stop?immediate=1`, {});
      console.log(`  ✓ stopped ${c.name} (${c.id})`);
      ok++;
    } catch (e) {
      console.log(`  ✗ failed ${c.name} (${c.id}): ${e.message}`);
    }
  }
  console.log(`\nDone — ${ok}/${matched.length} stopped.`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
