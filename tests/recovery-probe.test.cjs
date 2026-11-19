const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const lib = {};
new Function('exports', ts.transpileModule(fs.readFileSync('src/lib/recovery-probe.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(lib);
const now = Date.parse('2026-11-19T12:00:00Z');
const restricted = { restrictedAt: new Date('2026-11-01T00:00:00Z'), permanentlyRestricted: false, status: 'unavailable' };

test('records a probe for a live restricted account, loaded true or false', () => {
  const ok = lib.decideRecoveryProbe(restricted, true, undefined, now);
  assert.equal(ok.action, 'record');
  assert.deepEqual(ok.probe, { loaded: true, at: new Date(now).toISOString() });
  const no = lib.decideRecoveryProbe(restricted, false, undefined, now);
  assert.equal(no.action, 'record');
  assert.equal(no.probe.loaded, false);
});

test('captures and trims the healthy-account source when given', () => {
  const d = lib.decideRecoveryProbe(restricted, true, '  ' + 'x'.repeat(200) + '  ', now);
  assert.equal(d.probe.from.length, 120);
});

test('skips anything that is not a recoverable restriction', () => {
  assert.equal(lib.decideRecoveryProbe({ ...restricted, restrictedAt: null }, true, undefined, now).action, 'skip');
  assert.equal(lib.decideRecoveryProbe({ ...restricted, permanentlyRestricted: true }, true, undefined, now).action, 'skip');
  assert.equal(lib.decideRecoveryProbe({ ...restricted, status: 'retired' }, true, undefined, now).action, 'skip');
  assert.equal(lib.decideRecoveryProbe(restricted, 'yes', undefined, now).action, 'skip');
});

test('probeSuggestsRecovery only flags a loaded profile while still restricted and not permanent', () => {
  const loaded = { loaded: true, at: new Date(now).toISOString() };
  assert.ok(lib.probeSuggestsRecovery(loaded, true, false));
  assert.equal(lib.probeSuggestsRecovery(loaded, false, false), null); // recovered: stale probe ignored
  assert.equal(lib.probeSuggestsRecovery(loaded, true, true), null); // permanently restricted
  assert.equal(lib.probeSuggestsRecovery({ loaded: false, at: new Date(now).toISOString() }, true, false), null);
  assert.equal(lib.probeSuggestsRecovery(null, true, false), null);
  assert.equal(lib.probeSuggestsRecovery({ loaded: true, at: 'nonsense' }, true, false), null);
});
