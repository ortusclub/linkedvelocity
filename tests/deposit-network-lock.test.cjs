const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function fixture() {
  const locks = new Set();
  const queries = [];
  const prisma = { $transaction: async work => {
    let held;
    try { return await work({ $queryRaw: async (parts, chain) => {
      queries.push({sql:parts.join('?'),chain});
      if (!parts.join('').includes('pg_try_advisory')) return [];
      if (locks.has(chain)) return [{acquired:false}];
      locks.add(chain); held=chain; return [{acquired:true}];
    }}); } finally { if (held) locks.delete(held); }
  }};
  const api = {};
  new Function('require','exports',ts.transpileModule(fs.readFileSync('src/lib/deposit-job.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(()=>({prisma}),api);
  return {api,queries,locks};
}
test('Base contention does not block Ethereum; concurrent Ethereum sweeps stay serialized', async()=>{
  const {api,queries}=fixture();
  await api.withDepositJob(async()=>{
    await assert.rejects(api.withDepositJob(async()=>assert.fail('Base duplicate')),/already running/);
    await api.withEthereumDepositJob(async assertActive=>{
      await assertActive();
      await assert.rejects(api.withEthereumDepositJob(async()=>assert.fail('Ethereum duplicate')),/Another Ethereum/);
    });
  });
  assert.deepEqual(queries.filter(q=>q.chain).map(q=>q.chain),[8453,8453,1,1]);
});
test('failed sweep releases only its network lock', async()=>{
  const {api,locks}=fixture();
  await assert.rejects(api.withEthereumDepositJob(async()=>{throw Error('failed')}),/failed/);
  assert.equal(locks.size,0);
  await api.withEthereumDepositJob(async assertActive=>assertActive());
});
