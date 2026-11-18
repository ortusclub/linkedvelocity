const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { ethers } = require('ethers');

const TREASURY = '0x7DDE778c985829D1100b0C5f1d94c8dA7C38bdf1';
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const child = ethers.Wallet.createRandom();
const sponsor = ethers.Wallet.createRandom();
const units = n => ethers.parseUnits(String(n), 18);

function load(deps) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/lib/bsc-deposits.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'exports', 'console', code)(name => { if (!(name in deps)) throw new Error('Unexpected dependency: ' + name); return deps[name]; }, exports, { error() {} });
  return exports;
}

function fixture(o = {}) {
  process.env.TREASURY_WALLET_ADDRESS = TREASURY;
  process.env.GAS_SPONSOR_PRIVATE_KEY = sponsor.privateKey;
  delete process.env.GAS_SPONSOR_ADDRESS;
  const calls = { events: [], credits: [], deposits: [], updates: [], journals: [], journalUpdates: [], emails: [], broadcasts: [] };
  const deposit = { id: 'dep-1', address: child.address, userId: 'user-1', derivationIndex: 145, bscUsdtLastSeen: o.seenUsdt ?? '0', bscUsdcLastSeen: '0', user: { email: 'alberto@example.com', fullName: 'Alberto' } };
  const mc = new ethers.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[]) view returns ((bool success,bytes returnData)[])']);
  const erc = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
  const provider = {
    provider: null,
    async call(tx) {
      const [reqs] = mc.decodeFunctionData('aggregate3', tx.data);
      return mc.encodeFunctionResult('aggregate3', [reqs.map(r => [true, ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [r.target.toLowerCase() === USDT ? (o.usdt ?? 0n) : 0n])])]);
    },
    async getNetwork() { return new ethers.Network('bnb', 56n); },
    async getTransactionCount() { return 0; },
    async getFeeData() { return { gasPrice: ethers.parseUnits('0.05', 'gwei') }; },
    async estimateGas() { return 34_802n; },
    async getBalance(a) { return a === sponsor.address ? (o.sponsorBnb ?? units('0.0005')) : (o.childBnb ?? 0n); },
    async broadcastTransaction(raw) {
      const tx = ethers.Transaction.from(raw);
      calls.events.push(tx.to.toLowerCase() === USDT ? 'broadcast-sweep' : 'broadcast-gas');
      calls.broadcasts.push(tx);
      return { hash: tx.hash, wait: async () => ({ status: 1, hash: tx.hash }) };
    },
    async waitForTransaction() { return o.noReceipt ? null : { status: o.status ?? 1 }; },
    async getTransactionReceipt() { return o.receipt ?? null; },
  };
  provider.provider = provider;
  const state = { deposit };
  const tx = {
    user: { update: async a => calls.credits.push(a) },
    transaction: { create: async a => calls.deposits.push(a.data), update: async a => calls.journalUpdates.push(a) },
    depositAddress: { update: async a => { calls.updates.push(a.data); Object.assign(state.deposit, a.data); }, findUnique: async () => state.deposit },
  };
  const prisma = {
    depositAddress: { findMany: async () => [state.deposit], update: tx.depositAddress.update },
    transaction: { findMany: async () => o.journals ?? [], create: async a => { calls.events.push('journal'); calls.journals.push(a.data); return { id: 'journal-1' }; } },
    $transaction: async fn => fn(tx),
  };
  const lib = load({
    ethers: { ethers },
    '@/lib/prisma': { prisma },
    '@/lib/wallet': { getDepositAddress: () => ({ address: child.address, privateKey: child.privateKey }) },
    '@/services/email': { sendTopUpConfirmation: async a => calls.emails.push(['customer', a]), sendTopUpNotification: async a => calls.emails.push(['admin', a]) },
  });
  return { lib, provider, calls, state };
}

const active = async () => {};

test('a USDT payment on BSC is credited 1:1 and the admin email names the network', async () => {
  const f = fixture({ usdt: units(110) });
  const found = await f.lib.detectBscDeposits(f.provider, new Set(), active);
  assert.equal(found.length, 1);
  assert.equal(f.calls.credits[0].data.usdcBalance.increment, '110.0');
  assert.match(f.calls.deposits[0].description, /USDT on BNB Smart Chain \(BEP-20\) deposit detected/);
  assert.equal(f.state.deposit.bscUsdtLastSeen, '110.0');
  assert.equal(f.calls.emails.find(e => e[0] === 'admin')[1].cryptoLabel, 'USDT on BNB Smart Chain (BEP-20)');
  // A second run sees nothing new.
  assert.equal((await f.lib.detectBscDeposits(f.provider, new Set(), active)).length, 0);
});

test('dust transfers are not credited and a balance that left the wallet lowers the mark', async () => {
  const dust = fixture({ usdt: units('0.001') });
  assert.equal((await dust.lib.detectBscDeposits(dust.provider, new Set(), active)).length, 0);
  const drained = fixture({ usdt: 0n, seenUsdt: '90' });
  await drained.lib.detectBscDeposits(drained.provider, new Set(), active);
  assert.equal(drained.state.deposit.bscUsdtLastSeen, '0.0');
  assert.equal(drained.calls.credits.length, 0);
});

test('credited USDT is swept to treasury after a gas top-up, journalled before broadcast', async () => {
  const f = fixture({ usdt: units(110), seenUsdt: '110' });
  const out = await f.lib.sweepBscDeposits(f.provider, new Set(), active);
  assert.equal(out[0].status, 'swept');
  assert.deepEqual(f.calls.events, ['broadcast-gas', 'journal', 'broadcast-sweep']);
  const sweep = f.calls.broadcasts[1];
  assert.equal(sweep.chainId, 56n);
  const [to, amount] = new ethers.Interface(['function transfer(address,uint256)']).decodeFunctionData('transfer', sweep.data);
  assert.equal(to, TREASURY);
  assert.equal(amount, units(110));
  assert.equal(f.state.deposit.bscUsdtLastSeen, '0.0');
  assert.match(f.calls.journalUpdates[0].data.description, /^Swept 110\.0 USDT \(BSC\) to treasury$/);
});

test('uncredited funds are never swept and an empty gas wallet stops before any transfer', async () => {
  const uncredited = fixture({ usdt: units(110), seenUsdt: '0' });
  assert.equal((await uncredited.lib.sweepBscDeposits(uncredited.provider, new Set(), active)).length, 0);
  const noGas = fixture({ usdt: units(90), seenUsdt: '90', sponsorBnb: 0n });
  const out = await noGas.lib.sweepBscDeposits(noGas.provider, new Set(), active);
  assert.equal(out[0].status, 'error');
  assert.match(out[0].error, /needs BNB on BNB Smart Chain/);
  assert.equal(noGas.calls.broadcasts.length, 0);
});

test('an unconfirmed sweep stays pending and blocks that deposit until its hash resolves', async () => {
  const f = fixture({ usdt: units(90), seenUsdt: '90', childBnb: units('0.01'), noReceipt: true });
  const out = await f.lib.sweepBscDeposits(f.provider, new Set(), active);
  assert.equal(out[0].status, 'pending');
  assert.equal(f.state.deposit.bscUsdtLastSeen, '90');
  const later = fixture({ journals: [{ id: 'j', txHash: '0xabc', description: `Pending BSC sweep:USDT:dep-1:${units(90)}` }] });
  const blocked = await later.lib.reconcileBscSweeps(later.provider, active);
  assert.ok(blocked.has('dep-1'));
});

test('ledger amounts truncate to 6 decimals', () => {
  const { lib } = fixture();
  assert.equal(lib.toLedgerAmount(units('1.2345678999')), '1.234567');
  assert.equal(lib.toLedgerAmount(units(5)), '5.0');
});
