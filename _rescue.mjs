import pg from "pg"; const { Client } = pg;
const KEY = process.env.RESEND_API_KEY;
const g = async (p) => { const r = await fetch(`https://api.resend.com${p}`, { headers: { Authorization: `Bearer ${KEY}` } }); if (!r.ok) throw new Error(`resend ${p} -> ${r.status}`); return r.json(); };
const isLinkedin = (from) => { const a = (String(from).match(/<([^<>]+)>\s*$/)?.[1] || from).trim().toLowerCase(); return /@(?:[a-z0-9-]+\.)*linkedin\.com$/.test(a); };

const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const list = await g("/emails/receiving");
const items = list.data || [];
let stored = 0, skipped = 0;
for (const it of items) {
  const to = (it.to || [])[0]?.trim().toLowerCase() || "";
  if (!/@myvahub\.fyi$/.test(to) || !isLinkedin(it.from)) { skipped++; continue; }
  const dup = await c.query(`SELECT 1 FROM account_mail_events WHERE email_id=$1`, [it.id]);
  if (dup.rowCount) { console.log(`= already stored: ${it.subject}`); skipped++; continue; }
  const acc = await c.query(`SELECT linkedin_account_id FROM appeal_mailboxes WHERE lower(address)=$1`, [to]);
  if (!acc.rowCount) { console.log(`! no appeal mailbox: ${to}`); skipped++; continue; }
  const full = await g(`/emails/receiving/${it.id}`);
  const body = (full.text || full.html || "").slice(0, 50000);
  await c.query(
    `INSERT INTO account_mail_events (id, email_id, linkedin_account_id, received_at, from_addr, to_addr, subject, body_text, type, severity, status)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'appeal_update', 'review', 'needs_review')`,
    [it.id, acc.rows[0].linkedin_account_id, new Date(it.created_at), String(it.from).slice(0, 320), to, String(it.subject || '').slice(0, 500), body]
  );
  console.log(`+ filed onto case: "${it.subject}" -> ${to}`);
  stored++;
}
console.log(`\ndone. stored=${stored} skipped=${skipped} of ${items.length} received`);
await c.end();
