// Backtrack recovery-case steps for the Restrictions v2 tab, WITH their real dates — for
// recording history we already know (LinkedIn appeal emails, Telegram outreach, etc.) that the
// live "Log a step" would otherwise stamp as today.
//
// Usage (run from the repo root, with DATABASE_URL in your env):
//   node --env-file=.env scripts/backtrack-recovery.mjs entries.json           # DRY RUN (prints plan)
//   node --env-file=.env scripts/backtrack-recovery.mjs entries.json --apply   # writes to the DB
//
// entries.json is a JSON array; each entry matches ONE account and appends backdated steps:
//   [
//     { "email": "jemjem.ramirez@lotuspost.fyi",
//       "reason": "Restriction",
//       "steps": [ { "k":"li", "o":"fail", "at":"2026-09-23",
//                    "err":"Appeal rejected — LinkedIn: doesn't comply, access remains restricted" } ],
//       "perma": true, "closedAt": "2026-09-23" },
//     { "name": "Lorraine Degui", "reason": "Phone verification",
//       "steps": [ { "k":"email", "o":"ok", "at":"2026-10-20", "note":"Telegram — sent guide; owner at phone-verify checkpoint" } ] }
//   ]
// Match by "email" (login email, exact) OR "name" (linkedin_name, ILIKE). Non-removed accounts only.
// Step "k": email|qr|id|form|li|note|gl|pw|relist|handback   "o": ok|fail|pending
// Optional per entry: reason, recoveredAt, perma (+closedAt), nocontact (+closedAt).
import pg from "pg";
import { readFile } from "node:fs/promises";

const STORED_KINDS = ["email", "qr", "id", "form", "li", "note", "gl", "pw", "relist", "handback"];
const OUTCOMES = ["ok", "fail", "pending"];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--")) || "backtrack-entries.json";
const isoAt = (d) => { const t = Date.parse(d); if (!Number.isFinite(t)) throw new Error(`bad date: ${d}`); return new Date(Math.min(t, Date.now())).toISOString(); };

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set — run with: node --env-file=.env scripts/backtrack-recovery.mjs <entries.json>"); process.exit(1); }
const entries = JSON.parse(await readFile(file, "utf8"));
if (!Array.isArray(entries)) throw new Error("entries file must be a JSON array");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let applied = 0, skipped = 0;
for (const e of entries) {
  let rows;
  if (e.email) rows = (await client.query("SELECT id, linkedin_name, login_email, status, recovery_case FROM linkedin_accounts WHERE lower(login_email) = lower($1) AND status <> 'removed'", [e.email])).rows;
  else if (e.name) rows = (await client.query("SELECT id, linkedin_name, login_email, status, recovery_case FROM linkedin_accounts WHERE linkedin_name ILIKE $1 AND status <> 'removed'", [`%${e.name}%`])).rows;
  else { console.log("SKIP: entry has no email/name →", JSON.stringify(e)); skipped++; continue; }

  if (rows.length === 0) { console.log(`SKIP: no account matches ${e.email || e.name}`); skipped++; continue; }
  if (rows.length > 1) { console.log(`SKIP: ${rows.length} accounts match "${e.email || e.name}" — be more specific:`); rows.forEach((r) => console.log(`        ${r.linkedin_name} <${r.login_email}> [${r.status}]`)); skipped++; continue; }
  const acct = rows[0];

  const stored = acct.recovery_case && typeof acct.recovery_case === "object" ? acct.recovery_case : {};
  stored.steps = Array.isArray(stored.steps) ? stored.steps : [];
  const newSteps = [];
  for (const s of e.steps || []) {
    if (!STORED_KINDS.includes(s.k)) throw new Error(`bad step kind "${s.k}" (allowed: ${STORED_KINDS.join(", ")})`);
    if (!OUTCOMES.includes(s.o)) throw new Error(`bad step outcome "${s.o}" (allowed: ${OUTCOMES.join(", ")})`);
    const step = { k: s.k, o: s.o, at: isoAt(s.at) };
    if (s.err) step.err = String(s.err); else if (s.note) step.note = String(s.note);
    newSteps.push(step);
  }
  stored.steps.push(...newSteps);
  stored.steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (e.reason) stored.reason = String(e.reason);
  if (e.recoveredAt) stored.resolvedAt = isoAt(e.recoveredAt);
  if (e.perma) { stored.outcome = "perma"; stored.closedAt = isoAt(e.closedAt || newSteps.at(-1)?.at || new Date().toISOString()); }
  else if (e.nocontact) { stored.outcome = "nocontact"; stored.closedAt = isoAt(e.closedAt || new Date().toISOString()); }

  console.log(`\n${acct.linkedin_name} <${acct.login_email}> [${acct.status}]  id=${acct.id}`);
  console.log(`  + ${newSteps.length} step(s): ${newSteps.map((s) => `${s.k}/${s.o}@${s.at.slice(0, 10)}${s.err ? ` (${s.err})` : s.note ? ` (${s.note})` : ""}`).join("  |  ") || "(none)"}`);
  if (e.reason) console.log(`  reason  = ${stored.reason}`);
  if (stored.resolvedAt) console.log(`  resolved= ${stored.resolvedAt.slice(0, 10)}`);
  if (stored.outcome) console.log(`  outcome = ${stored.outcome} @ ${stored.closedAt.slice(0, 10)}`);

  if (apply) { await client.query("UPDATE linkedin_accounts SET recovery_case = $1::jsonb, updated_at = NOW() WHERE id = $2::uuid", [JSON.stringify(stored), acct.id]); applied++; }
}

await client.end();
console.log(`\n${apply ? `✔ APPLIED ${applied}` : "DRY RUN (nothing written)"} · skipped ${skipped}.${apply ? "" : "  Re-run with --apply to write."}`);
