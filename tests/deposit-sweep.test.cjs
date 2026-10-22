const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { ethers } = require('ethers');
process.env.TREASURY_WALLET_ADDRESS = '0x1111111111111111111111111111111111111111';

function load(file, dependencies) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('require', 'exports', 'console', code)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports, { error() {} });
  return exports;
}

function fixture(options = {}) {
  const calls = { sends: [], funding: [], ledger: [], journals: [], resets: [], errors: [], events: [] };
  const provider = {
    broadcastTransaction: async raw => {
      calls.events.push('broadcast');
      calls.sends.push({ symbol: 'USDC', raw });
      if (options.broadcastError) throw new Error('Connection lost');
      return { hash: 'relay-hash', wait: async () => { if (options.timeout) throw new Error('timeout'); return { status: options.status ?? 1, hash: 'relay-hash' }; } };
    },
    getTransactionReceipt: async () => options.receipt ?? null,
    getNetwork: async () => ({ chainId: options.chainId ?? 8453n }),
    getTransactionCount: async (_address, tag) => tag === 'pending' && options.pending ? 1 : 0,
    getBalance: async () => options.eth ?? ethers.parseEther('0.001'),
  };
  const contract = symbol => () => ({
    balanceOf: async () => {
      if (options.failRead === symbol) throw new Error('RPC failure');
      return options[symbol] ?? 0n;
    },
    transfer: async (to, amount) => {
      calls.sends.push({ symbol, to, amount });
      return { hash: `hash-${symbol}`, wait: async () => ({ status: options.status ?? 1, hash: `hash-${symbol}` }) };
    },
  });
  const prisma = {
    transaction: { findMany: async () => options.journals ?? [], create: async entry => { calls.events.push('journal'); if (options.journalError) throw new Error('database failure'); calls.journals.push(entry.data); return { id: "journal" }; } },
    depositAddress: { findMany: async () => options.deposits ?? [{ id: 'deposit', address: '0xabc', userId: 'customer', derivationIndex: 7, lastSeenBalance: options.lastSeen ?? '100' }] },
    $transaction: async fn => fn({
      transaction: { update: async entry => calls.ledger.push(entry.data) },
      depositAddress: { update: async entry => calls.resets.push(entry) },
      user: { update: async () => { throw new Error('Sweeps must not credit customers'); } },
    }),
  };
  const wallet = {
    getBaseProvider: () => provider,
    getTreasuryAddress: () => process.env.TREASURY_WALLET_ADDRESS,
    getTreasuryWallet: () => { throw new Error('Sweeps must never access the receiving wallet private key'); },
    getChildWallet: index => {
      assert.equal(index, 7);
      return { address: options.signerAddress ?? '0xABC' };
    },
    getUsdcContract: contract('USDC'),
    getUsdtContract: contract('USDT'),
    parseUsdc: value => ethers.parseUnits(String(value), 6),
    formatUsdc: value => ethers.formatUnits(value, 6),
  };
  return { calls, ...load('src/lib/deposit-detector.ts', {
    '@/lib/usdc-gas-sponsor': {
      sponsorshipEnabled: () => !!options.sponsored,
      prepareSponsoredUsdcSweep: async input => {
        calls.events.push('prepare');
        assert.equal(input.destination, process.env.TREASURY_WALLET_ADDRESS);
        await input.assertActive();
        return { rawTransaction: 'test-raw', hash: 'relay-hash' };
      },
    },
    '@/lib/prisma': { prisma }, ethers: { ethers }, '@/lib/wallet': wallet, '@/services/email': {},
  }) };
}

test('USDT-only sweep needs no treasury key and preserves USDC tracker', async () => {
  const f = fixture({ USDT: 50_000_000n });
  const result = await f.sweepDeposits();
  assert.deepEqual(result, [{ address: '0xabc', amount: '50.0', txHash: 'hash-USDT', token: 'USDT' }]);
  assert.deepEqual(f.calls.sends, [{ symbol: 'USDT', to: process.env.TREASURY_WALLET_ADDRESS, amount: 50_000_000n }]);
  assert.equal(f.calls.funding.length, 0);
  assert.equal(f.calls.ledger[0].description, 'Swept 50.0 USDT to treasury');
  assert.equal(f.calls.resets.length, 0);
});

test('both tokens sweep and only USDC resets its tracker', async () => {
  const f = fixture({ USDC: 2_000_000n, USDT: 50_000_000n });
  assert.equal((await f.sweepDeposits()).length, 2);
  assert.equal(f.calls.resets.length, 1);
  assert.equal(f.calls.funding.length, 0);
});

test('zero balances produce no transfers or ledger entries', async () => {
  const f = fixture();
  assert.deepEqual(await f.sweepDeposits(), []);
  assert.equal(f.calls.sends.length + f.calls.funding.length + f.calls.ledger.length, 0);
});

test('wrong derived signer cannot receive gas or send tokens', async () => {
  const f = fixture({ USDT: 50_000_000n, eth: 0n, signerAddress: '0xwrong' });
  assert.deepEqual(await f.sweepDeposits(), []);
  assert.equal(f.calls.sends.length + f.calls.funding.length, 0);
});

test('wrong network aborts before transfers', async () => {
  const f = fixture({ chainId: 1n, USDT: 50_000_000n });
  await assert.rejects(f.sweepDeposits(), /Base mainnet/);
  assert.equal(f.calls.sends.length, 0);
});

test('unfunded source is skipped without accessing a treasury signer', async () => {
  const f = fixture({ USDT: 50_000_000n, eth: 0n });
  assert.deepEqual(await f.sweepDeposits(), []);
  assert.equal(f.calls.sends.length + f.calls.ledger.length, 0);
});

test('failed receipt does not record a successful sweep or reset tracker', async () => {
  const f = fixture({ USDC: 2_000_000n, status: 0 });
  assert.deepEqual(await f.sweepDeposits(), []);
  assert.equal(f.calls.ledger.length + f.calls.resets.length, 0);
});

test('a failed USDC check does not prevent USDT sweeping', async () => {
  const f = fixture({ failRead: 'USDC', USDT: 50_000_000n });
  assert.equal((await f.sweepDeposits())[0].token, 'USDT');
});

test('sweep endpoint rejects forged cron headers and missing secret', async () => {
  const previous = process.env.CRON_SECRET;
  let runs = 0;
  const route = load('src/app/api/cron/detect-deposits/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => ({ data, status: init?.status ?? 200 }) } },
    '@/lib/deposit-job': { withDepositJob: fn => fn(async () => {}), DepositJobBusy: class extends Error {} },
    '@/lib/deposit-detector': {
      detectDeposits: async () => { runs++; return []; }, sweepDeposits: async () => [],
    },
  });
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await route.GET({ headers: new Headers({ authorization: 'Bearer undefined', 'x-vercel-cron': '1' }) })).status, 401);
    process.env.CRON_SECRET = 'test-secret';
    assert.equal((await route.POST({ headers: new Headers({ 'x-vercel-cron': '1' }) })).status, 401);
    assert.equal(runs, 0);
    assert.equal((await route.GET({ headers: new Headers({ authorization: 'Bearer test-secret' }) })).status, 200);
    assert.equal(runs, 1);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

 test('uncredited USDC is not moved and reports a failed token', async () => {
 const f = fixture({ USDC: 20_000_000n, lastSeen: '0' });
 const failures = [];
 await f.sweepDeposits('deposit', token => failures.push(token));
 assert.deepEqual(failures, ['USDC']);
 assert.equal(f.calls.sends.length, 0);
 });
 test('pending transactions prevent duplicate sends', async () => {
 const f = fixture({ USDT: 20_000_000n, pending: true });
 await f.sweepDeposits();
 assert.equal(f.calls.sends.length, 0);
 });
 test('lost job lock prevents signing', async () => {
 const f = fixture({ USDT: 20_000_000n });
 await f.sweepDeposits('deposit', undefined, async () => { throw new Error('Lock lost'); });
 assert.equal(f.calls.sends.length, 0);
 });

test('unconfirmed journal prevents repeat sweeping even if RPC nonce looks clear', async () => {
 const f = fixture({ USDT: 50_000_000n, journals: [{ id: 'j', txHash: 'hash', description: 'Pending treasury sweep:USDT:deposit' }] });
 await f.sweepDeposits();
 assert.equal(f.calls.sends.length, 0);
});
test('confirmed USDC journal repairs tracker before the next sweep', async () => {
 const f = fixture({ receipt: { status: 1 }, journals: [{ id: 'j', txHash: 'hash', amount: '50', description: 'Pending treasury sweep:USDC:deposit' }] });
 await f.sweepDeposits();
 assert.equal(f.calls.resets.length, 1);
 assert.equal(f.calls.ledger[0].description, 'Swept 50 USDC to treasury');
});
test('broadcast hash is journaled before waiting for confirmation', async () => {
 const f = fixture({ USDT: 50_000_000n, status: 0 });
 await f.sweepDeposits();
 assert.equal(f.calls.journals[0].txHash, 'hash-USDT');
 assert.equal(f.calls.journals[0].description, 'Pending treasury sweep:USDT:deposit');
 assert.equal(f.calls.ledger.length, 0);
});

test('missing treasury private key does not prevent a funded deposit sweep', async () => {
 const previous = process.env.TREASURY_PRIVATE_KEY;
 delete process.env.TREASURY_PRIVATE_KEY;
 try {
  const f = fixture({ USDC: 2_000_000n });
  assert.equal((await f.sweepDeposits()).length, 1);
  assert.equal(f.calls.sends[0].to, process.env.TREASURY_WALLET_ADDRESS);
 } finally { if (previous !== undefined) process.env.TREASURY_PRIVATE_KEY = previous; }
});


test('sponsored USDC sweeps an ETH-empty deposit and journals before broadcast', async () => {
 const f = fixture({ sponsored: true, USDC: 55_000_000n, eth: 0n });
 const result = await f.sweepDeposits('deposit', undefined, async () => {}, { allowSponsored: true });
 assert.equal(result[0].amount, '55.0');
 assert.deepEqual(f.calls.events, ['prepare', 'journal', 'broadcast']);
 assert.equal(f.calls.resets.length, 1);
 assert.equal(f.calls.journals[0].description, 'Pending treasury sweep:USDC:deposit:relayed');
});
test('cron cannot initiate sponsored transfers', async () => {
 const f = fixture({ sponsored: true, USDC: 55_000_000n });
 assert.deepEqual(await f.sweepDeposits(), []);
 assert.deepEqual(f.calls.events, []);
});
test('failed pre-broadcast journal cannot send a relay transaction', async () => {
 const f = fixture({ sponsored: true, USDC: 55_000_000n, journalError: true });
 await f.sweepDeposits('deposit', undefined, async () => {}, { allowSponsored: true });
 assert.equal(f.calls.sends.length, 0);
});
test('ambiguous relay broadcast blocks subsequent relay sends in the same job', async () => {
 const f = fixture({ sponsored: true, USDC: 1_000_000n, broadcastError: true,
  deposits: ['one','two'].map(id => ({id,address:'0xabc',userId:'customer',derivationIndex:7,lastSeenBalance:'1'})) });
 await f.sweepDeposits(undefined, undefined, async () => {}, { allowSponsored: true });
 assert.equal(f.calls.sends.length, 1);
 assert.equal(f.calls.journals.length, 1);
 assert.equal(f.calls.resets.length, 0);
});
test('unconfirmed relay journal blocks the central signer across deposits and jobs', async () => {
 const f = fixture({ sponsored: true, USDC: 1_000_000n,
  journals: [{id:'j',txHash:'relay-hash',description:'Pending treasury sweep:USDC:other-deposit:relayed'}] });
 await f.sweepDeposits('deposit', undefined, async () => {}, { allowSponsored: true });
 assert.equal(f.calls.events.length, 0);
});
test('timed-out relay remains pending and never resets customer credit tracking', async () => {
 const f = fixture({ sponsored: true, USDC: 1_000_000n, timeout: true });
 await f.sweepDeposits('deposit', undefined, async () => {}, { allowSponsored: true });
 assert.equal(f.calls.journals.length, 1);
 assert.equal(f.calls.resets.length, 0);
});
