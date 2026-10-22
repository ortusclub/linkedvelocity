const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const out = {};
new Function('exports', ts.transpileModule(fs.readFileSync('src/lib/sweep-all.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(out);
const row = (id, extra={}) => ({id,address:id,usdc:'55',usdt:'0',eth:'0',awaitingCredit:false,error:null,...extra});
const snap = (page, rows, hasMore=false) => ({page,rows,hasMore,treasury:'treasury',signingConfigured:true,gasSponsor:{enabled:true,error:null}});
test('reviews every page, deduplicates and skips empty, uncredited and gas-blocked wallets',async()=>{
 const pages=[snap(0,[row('empty',{usdc:'0'}),row('a')],true),snap(1,[row('a'),row('b',{awaitingCredit:true}),row('c',{usdc:'0',usdt:'4'}),row('d',{error:'RPC unavailable'})])];
 const plan=await out.reviewAllDeposits(async p=>pages[p]);assert.deepEqual(plan.rows.map(r=>r.id),['a']);assert.equal(plan.skipped.length,3);
});
test('gas configuration failure prevents sponsored rows entering plan',async()=>{
 const data=snap(0,[row('a')]);data.gasSponsor.error='Invalid key';const plan=await out.reviewAllDeposits(async()=>data);assert.equal(plan.rows.length,0);assert.equal(plan.skipped[0].reason,'Invalid key');
});
test('incomplete review or changed destination cannot return a plan',async()=>{
 await assert.rejects(out.reviewAllDeposits(async p=>{if(p)throw Error('offline');return snap(0,[row('a')],true)}));
 await assert.rejects(out.reviewAllDeposits(async p=>({...snap(p,[row('a')],p===0),treasury:p?'changed':'original'})),/changed/);
});
test('sequential sends use reviewed destination and preserve confirmations on uncertain response without retry',async()=>{
 const calls=[];const plan={treasury:'reviewed',rows:[row('a'),row('b'),row('c')],skipped:[]};
 const result=await out.executeSweepPlan(plan,async(id,destination)=>{calls.push([id,destination]);if(id==='b')throw Error('timeout');return {sweeps:[{txHash:'confirmed'}],failures:[]}},()=>{});
 assert.deepEqual(calls,[['a','reviewed'],['b','reviewed']]);assert.equal(result.sweeps.length,1);assert.match(result.message,/could not be confirmed/);
});
test('partial token failure stops batch and preserves confirmed tokens',async()=>{
 let calls=0;const result=await out.executeSweepPlan({treasury:'t',rows:[row('a'),row('b')],skipped:[]},async()=>{calls++;return {sweeps:[{txHash:'ok'}],failures:['USDT'],message:'USDT failed'}},()=>{});
 assert.equal(calls,1);assert.equal(result.sweeps.length,1);assert.match(result.message,/USDT failed/);
});
