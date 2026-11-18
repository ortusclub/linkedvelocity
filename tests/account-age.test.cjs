const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const exports_ = {};
new Function('exports', ts.transpileModule(fs.readFileSync('src/lib/account-age.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(exports_);
const { linkedinCreatedAt, linkedinAgeDays, linkedinOlderThanMonths } = exports_;
const now = Date.parse('2026-11-18T00:00:00Z');

test('age counts from the Joined LinkedIn month, not from when we added the account', () => {
  const a = { linkedinJoinedAt: '2023-11-01T00:00:00Z', accountAgeMonths: 1, createdAt: '2026-11-09T00:00:00Z' };
  assert.equal(linkedinCreatedAt(a).source, 'joined');
  assert.ok(linkedinAgeDays(a, now) > 1000);
});

test('a brand-new LinkedIn profile we have held for weeks is still young', () => {
  assert.equal(linkedinAgeDays({ linkedinJoinedAt: '2026-11-01T00:00:00Z', createdAt: '2026-08-01T00:00:00Z' }, now), 17);
});

test('falls back to the age-in-months estimate, then to the date we added it', () => {
  const est = { linkedinJoinedAt: null, accountAgeMonths: 139, createdAt: '2026-09-01T00:00:00Z' };
  assert.equal(linkedinCreatedAt(est).source, 'age_months');
  assert.equal(linkedinCreatedAt(est).at.toISOString().slice(0, 7), '2015-02');
  const bare = { linkedinJoinedAt: null, accountAgeMonths: 0, createdAt: '2026-11-08T00:00:00Z' };
  assert.equal(linkedinCreatedAt(bare).source, 'added');
  assert.equal(linkedinAgeDays(bare, now), 10);
});

test('promotion needs at least 2 calendar months since joining LinkedIn', () => {
  assert.equal(linkedinOlderThanMonths({ linkedinJoinedAt: '2026-09-01T00:00:00Z', createdAt: '2026-11-03T00:00:00Z' }, 2, now), true);
  assert.equal(linkedinOlderThanMonths({ linkedinJoinedAt: '2026-10-01T00:00:00Z', createdAt: '2026-11-03T00:00:00Z' }, 2, now), false);
});
