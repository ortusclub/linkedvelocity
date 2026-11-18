const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const lib = {};
new Function('exports', ts.transpileModule(fs.readFileSync('src/lib/connection-count-report.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(lib);
const now = Date.parse('2026-11-18T12:00:00Z');
const day = 86400000;

test('a fresh weekly reading updates the count and is marked auto in history', () => {
  const d = lib.decideConnectionUpdate({ connectionCount: 118, connectionHistory: [{ at: '2026-11-13T07:49:14Z', count: 118 }] }, 131, now);
  assert.equal(d.action, 'update');
  assert.deepEqual(d.history.at(-1), { at: new Date(now).toISOString(), count: 131, note: 'auto (maturing)' });
});

test('only one automatic update per week; manual edits do not count towards that', () => {
  const recent = { connectionCount: 120, connectionHistory: [{ at: new Date(now - 2 * day).toISOString(), count: 120, note: 'auto (maturing)' }] };
  assert.equal(lib.decideConnectionUpdate(recent, 125, now).action, 'skip');
  const old = { connectionCount: 120, connectionHistory: [{ at: new Date(now - 7 * day).toISOString(), count: 120, note: 'auto (maturing)' }, { at: new Date(now - day).toISOString(), count: 121 }] };
  assert.equal(lib.decideConnectionUpdate(old, 125, now).action, 'update');
});

test('bad readings never overwrite a real count', () => {
  const cur = { connectionCount: 300, connectionHistory: [] };
  assert.equal(lib.decideConnectionUpdate(cur, 0, now).action, 'skip');
  assert.equal(lib.decideConnectionUpdate(cur, 120, now).action, 'skip');
  assert.equal(lib.decideConnectionUpdate(cur, 5000, now).action, 'skip');
  assert.equal(lib.decideConnectionUpdate(cur, 296, now).action, 'update');
  assert.equal(lib.decideConnectionUpdate({ connectionCount: 0, connectionHistory: null }, 42, now).action, 'update');
});

test('board summary uses only engine readings and measures 30 days between real readings', () => {
  const at = d => new Date(now - d * day).toISOString();
  assert.equal(lib.connectionSummary([{ at: at(3), count: 150 }], now), null);
  const h = [{ at: at(40), count: 90, note: 'auto (maturing)' }, { at: at(31), count: 100, note: 'auto (maturing)' }, { at: at(10), count: 500 }, { at: at(3), count: 140, note: 'auto (maturing)' }];
  const s = lib.connectionSummary(h, now);
  assert.equal(s.count, 140); assert.equal(s.change30d, 40); assert.equal(s.full30d, true); assert.equal(s.since, at(31));
  const young = lib.connectionSummary([{ at: at(14), count: 100, note: 'auto (maturing)' }, { at: at(7), count: 112, note: 'auto (maturing)' }], now);
  assert.equal(young.change30d, 12); assert.equal(young.full30d, false);
});

test('joined month must be a real past month', () => {
  assert.equal(lib.parseJoinedMonth('2023-11', now).toISOString(), '2023-11-01T00:00:00.000Z');
  assert.equal(lib.parseJoinedMonth('2027-01', now), null);
  assert.equal(lib.parseJoinedMonth('1999-05', now), null);
  assert.equal(lib.parseJoinedMonth('Nov 2023', now), null);
});
