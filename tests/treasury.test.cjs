const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { ethers } = require('ethers');

function load(file, dependencies, fetchImpl = global.fetch) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'exports', 'fetch', js)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports, fetchImpl);
  return exports;
}
const lib = load('src/lib/treasury.ts', { ethers: { ethers } });
const source = '0x1111111111111111111111111111111111111111';
const destination = '0x2222222222222222222222222222222222222222';

test('Stripe available and pending amounts remain separate by currency', () => {
  assert.deepEqual(lib.stripeBalances({ available: [{ currency: 'usd', amount: 12345 }, { currency: 'jpy', amount: 900 }], pending: [{ currency: 'usd', amount: 300 }, { currency: 'eur', amount: -100 }] }), [
    { currency: 'EUR', available: '0.0', pending: '-1.0' },
    { currency: 'JPY', available: '900', pending: '0' },
    { currency: 'USD', available: '123.45', pending: '3.0' },
  ]);
  assert.equal(lib.stripeMajorAmount(500, 'ISK'), '5.0');
  assert.equal(lib.stripeMajorAmount(500, 'UGX'), '5.0');
});

test('transfer amount uses exact token units and restricts recipients and tokens', () => {
  assert.equal(lib.validateTransfer({ token: 'USDC', amount: '50.000001', destination }, source).units, 50000001n);
  for (const amount of ['0', '-1', '1e6', '1,000', '0.0000001', 'NaN']) {
    assert.throws(() => lib.validateTransfer({ token: 'USDC', amount, destination }, source));
  }
  for (const address of [source, ethers.ZeroAddress, lib.BASE_TOKENS.USDC.contract, 'not-an-address']) {
    assert.throws(() => lib.validateTransfer({ token: 'USDC', amount: '1', destination: address }, source));
  }
  assert.throws(() => lib.validateTransfer({ token: 'USDT', amount: '50', destination }, source), /Only USDC and ETH/);
});

test('funds validation protects gas reserve and rejects overspending', () => {
  assert.throws(() => lib.assertTransferFunds('USDC', 51n, 50n, ethers.parseEther('1')), /exceeds/);
  assert.throws(() => lib.assertTransferFunds('USDC', 10n, 50n, 0n), /Keep at least/);
  assert.throws(() => lib.assertTransferFunds('ETH', ethers.parseEther('0.01'), ethers.parseEther('0.01'), ethers.parseEther('0.01')), /Keep at least/);
  lib.assertTransferFunds('ETH', ethers.parseEther('0.009'), ethers.parseEther('0.01'), ethers.parseEther('0.01'));
});

function transferFixture() {
  const state = { account: source, chain: 8453n, usdc: 100_000_000n, eth: ethers.parseEther('0.01'), sends: [], requests: [], estimates: [] };
  const signer = { getAddress: async () => state.account, sendTransaction: async tx => { state.sends.push(tx); return { hash: '0x' + 'a'.repeat(64) }; } };
  class Provider {
    async getNetwork() { return { chainId: state.chain }; }
    async getSigner() { return signer; }
    async getBalance() { return state.eth; }
    async estimateGas(tx) { state.estimates.push(tx); return 50000n; }
    destroy() {}
  }
  class Contract { async balanceOf() { return state.usdc; } }
  const mocked = { ...ethers, BrowserProvider: Provider, Contract };
  const ethereum = { request: async req => { state.requests.push(req); if (req.method === 'eth_chainId') return '0x2105'; return [state.account]; } };
  const transfer = load('src/lib/treasury-transfer.ts', { ethers: { ethers: mocked }, '@/lib/treasury': lib });
  return { state, ethereum, ...transfer };
}

test('review only simulates, final confirmation sends exact USDC transfer without approval', async () => {
  const f = transferFixture();
  const review = await f.prepareTreasuryTransfer(f.ethereum, source, { token: 'USDC', amount: '50', destination });
  assert.equal(f.state.sends.length, 0);
  await f.requestTreasuryTransfer(f.ethereum, review);
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.sends[0].to, lib.BASE_TOKENS.USDC.contract);
  assert.equal(f.state.sends[0].chainId, 8453);
  const decoded = new ethers.Interface(lib.TOKEN_ABI).decodeFunctionData('transfer', f.state.sends[0].data);
  assert.equal(decoded[0], destination);
  assert.equal(decoded[1], 50_000_000n);
});

test('changed wallet, network, balance or expired review prevents sending', async () => {
  for (const change of [f => { f.state.account = destination; }, f => { f.state.chain = 1n; }, f => { f.state.usdc = 1n; }, (_f, review) => { review.preparedAt = 0; }]) {
    const f = transferFixture();
    const review = await f.prepareTreasuryTransfer(f.ethereum, source, { token: 'USDC', amount: '50', destination });
    change(f, review);
    await assert.rejects(f.requestTreasuryTransfer(f.ethereum, review));
    assert.equal(f.state.sends.length, 0);
  }
});

function routeFixture({ authError, stripeError = false, tokenError = false, priceError = false } = {}) {
  let stripeReads = 0;
  class Provider { async getNetwork() { return { chainId: 8453n }; } async getBalance() { return ethers.parseEther('0.01'); } destroy() {} }
  class Contract { async balanceOf() { if (tokenError) throw Error('Unavailable'); return 50_000_000n; } }
  const route = load('src/app/api/admin/treasury/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200, headers: init?.headers }) } },
    ethers: { ethers: { ...ethers, JsonRpcProvider: Provider, Contract } },
    '@/lib/auth': { requireAdmin: async () => { if (authError) throw Error(authError); return { role: 'admin' }; } },
    '@/lib/base-balance-provider': { getBaseBalanceProvider: async () => new Provider() },
    '@/lib/stripe': { getStripe: () => ({ balance: { retrieve: async () => {
      stripeReads++; if (stripeError) throw Error('Provider failure with secret information');
      return { available: [{ currency: 'usd', amount: 12345 }], pending: [], livemode: true };
    } } }) },
    '@/lib/treasury': lib,
  }, async () => { if (priceError) throw Error('No quotes'); return { ok: true, json: async () => ({ data: { rates: { ETH: '0.0004', USDC: '1', USDT: '1' } } }) }; });
  return { ...route, stripeReads: () => stripeReads };
}

test('API rejects unauthenticated and non-admin callers before any provider reads', async () => {
  for (const [authError, status] of [['Unauthorized', 401], ['Forbidden', 403]]) {
    const f = routeFixture({ authError });
    assert.equal((await f.GET()).status, status);
    assert.equal(f.stripeReads(), 0);
  }
});

test('API isolates failures, never reports unavailable balances as zero, and disables caching', async () => {
  const oldKey = process.env.STRIPE_SECRET_KEY, oldAddress = process.env.TREASURY_WALLET_ADDRESS;
  process.env.STRIPE_SECRET_KEY = 'test-only'; process.env.TREASURY_WALLET_ADDRESS = source;
  try {
    let r = await routeFixture({ stripeError: true }).GET();
    assert.equal(r.body.stripe.status, 'unavailable');
    assert.equal(r.body.crypto.assets[1].amount, '50.0');
    assert.equal(r.headers['Cache-Control'], 'private, no-store');
    assert.doesNotMatch(JSON.stringify(r), /secret information/);
    r = await routeFixture({ tokenError: true, priceError: true }).GET();
    assert.equal(r.body.stripe.status, 'ready');
    assert.equal(r.body.crypto.assets.find(a => a.token === 'USDC').amount, null);
    assert.equal(r.body.crypto.assets.find(a => a.token === 'ETH').usdValue, null);
    delete process.env.TREASURY_WALLET_ADDRESS;
    r = await routeFixture().GET();
    assert.equal(r.body.crypto.address, null);
    assert.match(r.body.crypto.error, /not configured/);
  } finally {
    if (oldKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = oldKey;
    if (oldAddress === undefined) delete process.env.TREASURY_WALLET_ADDRESS; else process.env.TREASURY_WALLET_ADDRESS = oldAddress;
  }
});
