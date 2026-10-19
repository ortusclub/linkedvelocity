const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { ethers } = require('ethers');
function load(file, deps) {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(name => {
    if (!(name in deps)) throw new Error(name); return deps[name];
  }, exports);
  return exports;
}
const treasury = '0x1111111111111111111111111111111111111111';
const id = '11111111-1111-4111-8111-111111111111';
process.env.TREASURY_WALLET_ADDRESS = treasury;
process.env.HD_WALLET_SEED_PHRASE = 'fixture';
delete process.env.TREASURY_PRIVATE_KEY;
function fixture(options = {}) {
  const calls = [];
  class DepositJobBusy extends Error {}
  const route = load('src/app/api/admin/treasury/deposits/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init.status, headers: init.headers }) } },
    ethers: { ethers },
    '@/lib/auth': { requireAdmin: async () => { if (options.auth) throw new Error(options.auth); } },
    '@/lib/prisma': { prisma: { depositAddress: {
      findUnique: async ({ where }) => { calls.push(['find', where.id]); return options.missing ? null : { id: where.id }; },
      findMany: async () => [{ id, address: treasury, user: { email: 'test@example.com' }, lastSeenBalance: '0' }],
    } } },
    '@/lib/wallet': {
      getBaseProvider: () => ({ getNetwork: async () => ({ chainId: 8453n }), getBalance: async () => 0n }),
      getUsdcContract: () => ({ balanceOf: async () => 5_000_000n }),
      getUsdtContract: () => ({ balanceOf: async () => { if (options.rpcError) throw new Error('rpc'); return 1_000_000n; } }),
      formatUsdc: x => ethers.formatUnits(x, 6), parseUsdc: x => ethers.parseUnits(x, 6),
    },
    '@/lib/deposit-detector': { sweepDeposits: async (selected, onFailure) => { calls.push(['sweep', selected]); if (options.failed) onFailure('USDT'); return options.failed ? [] : [{ txHash: 'test-hash', token: 'USDT', amount: '1' }]; } },
    '@/lib/deposit-job': { DepositJobBusy, withDepositJob: async fn => { if (options.busy) throw new DepositJobBusy('Already running'); return fn(async () => {}); } },
  });
  return { ...route, calls };
}
function request(overrides = {}, origin = 'https://example.com') {
  return { nextUrl: new URL('https://example.com/api/admin/treasury/deposits'), headers: new Headers({ origin, 'content-type': 'application/json' }), json: async () => ({ depositId: id, treasury, confirmed: true, ...overrides }) };
}
test('admin authorization precedes deposit reads or signing', async () => {
  for (const [auth, status] of [['Unauthorized', 401], ['Forbidden', 403]]) {
    const f = fixture({ auth });
    assert.equal((await f.GET(request())).status, status);
    assert.equal((await f.POST(request())).status, status);
    assert.deepEqual(f.calls, []);
  }
});
test('cross-origin, unconfirmed and destination-changed requests cannot sweep', async () => {
  const f = fixture();
  assert.equal((await f.POST(request({}, 'https://evil.example'))).status, 403);
  assert.equal((await f.POST(request({ confirmed: false }))).status, 400);
  assert.equal((await f.POST(request({ treasury: ethers.ZeroAddress }))).status, 409);
  assert.deepEqual(f.calls, []);
});
test('one selected wallet is swept, and contention or missing wallet cannot sweep', async () => {
  const f = fixture();
  const r = await f.POST(request());
  assert.equal(r.status, 200);
  assert.deepEqual(f.calls, [['find', id], ['sweep', id]]);
  assert.equal(r.body.sweeps.length, 1);
  const busy = fixture({ busy: true });
  assert.equal((await busy.POST(request())).status, 409);
  assert.deepEqual(busy.calls, []);
  const missing = fixture({ missing: true });
  assert.equal((await missing.POST(request())).status, 404);
  assert.equal(missing.calls.length, 1);
});
test('read-only listing distinguishes pending credit and unavailable balances', async () => {
  const f = fixture(); const r = await f.GET(request());
  assert.equal(r.body.signingConfigured, true);
  assert.equal(r.body.rows[0].usdc, '5.0');
  assert.equal(r.body.rows[0].awaitingCredit, true);
  assert.equal(r.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(f.calls, []);
  const bad = await fixture({ rpcError: true }).GET(request());
  assert.equal(bad.body.rows[0].usdc, null);
  assert.match(bad.body.rows[0].error, /unavailable/);
});
test('partial sweep failures are reported rather than presented as success', async () => {
  const r = await fixture({ failed: true }).POST(request());
  assert.deepEqual(r.body.failures, ['USDT']);
  assert.match(r.body.message, /could not be swept/);
});
test('shared database lock rejects concurrent jobs and checks lock before signing', async () => {
  let acquired = false, ran = false, queries = 0;
  const job = load('src/lib/deposit-job.ts', { '@/lib/prisma': { prisma: {
    $transaction: async fn => fn({ $queryRaw: async () => { queries++; return [{ acquired }]; } }),
  } } });
  await assert.rejects(job.withDepositJob(async () => { ran = true; }), job.DepositJobBusy);
  assert.equal(ran, false);
  acquired = true; queries = 0;
  assert.equal(await job.withDepositJob(async active => { await active(); return 42; }), 42);
  assert.equal(queries, 2);
});
