const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => mocks[name] || require(name), module, module.exports);
  return module.exports;
}
const { formatName } = load('src/lib/format-name.ts');

test('capitalises all-lowercase words and trims spaces', () => {
  assert.equal(formatName('janna dela cruz'), 'Janna Dela Cruz');
  assert.equal(formatName('Gerly saladar '), 'Gerly Saladar');
  assert.equal(formatName('  Jennylyn  San Juan'), 'Jennylyn San Juan');
  assert.equal(formatName('lelian parreño'), 'Lelian Parreño');
  assert.equal(formatName('Jefferson angelo t mendoza'), 'Jefferson Angelo T Mendoza');
});
test('title-cases ALL CAPS names', () => {
  assert.equal(formatName('AIZA MAE PULAO BARIATA'), 'Aiza Mae Pulao Bariata');
  assert.equal(formatName('MA. AVRIL YEBAN'), 'Ma. Avril Yeban');
  assert.equal(formatName('Don Jesus KAYIRANGA'), 'Don Jesus Kayiranga');
});
test('leaves mixed case, initials, hyphens and usernames alone', () => {
  assert.equal(formatName('McKay De Leon'), 'McKay De Leon');
  assert.equal(formatName('AJ Mae Gamarcha'), 'AJ Mae Gamarcha');
  assert.equal(formatName('Vianelle Ca-agoy'), 'Vianelle Ca-agoy');
  assert.equal(formatName('Cornel soy-afon'), 'Cornel Soy-afon');
  assert.equal(formatName('abereabebayehu060'), 'abereabebayehu060');
  assert.equal(formatName('Erika S. Danila'), 'Erika S. Danila');
});
test('is idempotent and handles empty input', () => {
  for (const n of ['janna dela cruz', 'AIZA MAE', 'AJ Mae', 'Ca-agoy']) assert.equal(formatName(formatName(n)), formatName(n));
  assert.equal(formatName(null), '');
  assert.equal(formatName(''), '');
});
