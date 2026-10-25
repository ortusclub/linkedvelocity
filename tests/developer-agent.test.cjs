const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, deps) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'exports', js)(name => { if (!(name in deps)) throw Error(name); return deps[name]; }, exports);
  return exports;
}
const tokens = load('src/lib/agent-token.ts', { 'node:crypto': require('node:crypto') });
function fixture() {
  const state = { authorization: null, cookie: null, sessions: new Map() };
  const auth = load('src/lib/auth.ts', {
    '@/lib/agent-token': tokens,
    '@/lib/prisma': { prisma: { session: { findUnique: async ({ where }) => state.sessions.get(where.token) } } },
    bcryptjs: {}, uuid: {},
    'next/headers': { headers: async () => new Headers(state.authorization ? { authorization: state.authorization } : {}), cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) },
  });
  return { state, auth };
}
const session = (overrides = {}) => ({ id: 'session', expiresAt: new Date(Date.now() + 10000), user: { id: 'owner', status: 'active' }, ...overrides });
test('agent keys are random, hashed at rest and never accepted as stored hashes', async () => {
  const { state, auth } = fixture();
  const token = tokens.createAgentToken();
  assert(tokens.isAgentToken(token));
  assert.notEqual(token, tokens.createAgentToken());
  const hashed = tokens.agentTokenHash(token);
  assert(!hashed.includes(token));
  state.sessions.set(hashed, session());
  state.authorization = `Bearer ${token}`;
  assert.equal((await auth.getSession()).id, 'owner');
  assert.equal(await auth.getBrowserSession(), null);
  state.authorization = `Bearer ${hashed}`;
  assert.equal(await auth.getSession(), null);
  state.authorization = null; state.cookie = hashed;
  assert.equal(await auth.getSession(), null);
});
test('expired, revoked and suspended keys fail; invalid explicit keys never use a browser cookie', async () => {
  const { state, auth } = fixture();
  state.cookie = 'browser'; state.sessions.set('browser', session());
  const token = tokens.createAgentToken(), hashed = tokens.agentTokenHash(token);
  state.authorization = `Bearer ${token}`;
  assert.equal(await auth.getSession(), null);
  state.sessions.set(hashed, session({ expiresAt: new Date(0) }));
  assert.equal(await auth.getSession(), null);
  state.sessions.set(hashed, session({ user: { id: 'owner', status: 'suspended' } }));
  assert.equal(await auth.getSession(), null);
  state.sessions.set(hashed, session());
  assert.equal((await auth.getSession()).id, 'owner');
  state.sessions.delete(hashed);
  await assert.rejects(auth.requireAuth(), /Unauthorized/);
  state.authorization = null;
  assert.equal((await auth.getSession()).id, 'owner');
});
test('existing desktop Bearer sessions remain supported', async () => {
  const { state, auth } = fixture();
  state.authorization = 'Bearer desktop'; state.sessions.set('desktop', session());
  assert.equal((await auth.requireAuth()).id, 'owner');
});
const NextResponse = { json: (body, init) => new Response(JSON.stringify(body), init) };
test('MCP authenticates before dispatch, discovers actions and preserves handler status', async () => {
  const operations = load('src/lib/agent-operations.ts', {}).agentOperations;
  let signedIn = false, invoked = 0;
  const deps = { 'next/server': { NextResponse, NextRequest: Request }, '@/lib/auth': { getSession: async () => signedIn ? { id: 'owner' } : null }, '@/lib/agent-operations': { agentOperations: operations } };
  for (const match of fs.readFileSync('src/app/api/mcp/route.ts', 'utf8').matchAll(/import \* as route\d+ from "([^"]+)"/g)) {
    deps[match[1]] = { GET: async () => new Response('{}'), POST: async (req, ctx) => { invoked++; assert.equal((await ctx.params).id, 'rental-123'); assert.equal(req.headers.get('authorization'), 'Bearer key'); return NextResponse.json({ error: 'Rental not found' }, { status: 404 }); } };
  }
  const mcp = load('src/app/api/mcp/route.ts', deps);
  const req = (method, params) => new Request('https://linkedvelocity.com/api/mcp', { method: 'POST', headers: { authorization: 'Bearer key', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  assert.equal((await mcp.POST(req('tools/list'))).status, 401);
  signedIn = true;
  const list = await (await mcp.POST(req('tools/list'))).json();
  assert(list.result.tools.some(t => t.name === 'post_rentals_id_access'));
  assert(!list.result.tools.some(t => t.name.includes('admin')));
  const result = await (await mcp.POST(req('tools/call', { name: 'post_rentals_id_access', arguments: { id: 'rental-123' } }))).json();
  assert(result.result.isError);
  assert.equal(JSON.parse(result.result.content[0].text).status, 404);
  assert.equal(invoked, 1);
  await mcp.POST(req('tools/call', { name: 'post_rentals_id_access', arguments: { id: '../admin' } }));
  assert.equal(invoked, 1);
  assert.equal((await (await mcp.POST(req('tools/call', { name: 'admin' }))).json()).error.code, -32602);
});
