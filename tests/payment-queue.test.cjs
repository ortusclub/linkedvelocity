const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
const api={};new Function('exports',ts.transpileModule(fs.readFileSync('src/lib/payment-queue.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(api);
const base={treasury:'dest',signingConfigured:true,gasSponsor:{enabled:true,error:null},rows:[]};
const row=(id,usdc,usdt,extra={})=>({id,address:id,customer:id,eth:'0.1',usdc,usdt,error:null,awaitingCredit:false,...extra});
test('empty wallets vanish but failed reads and blocked funded payments remain',()=>{
 const result=api.paymentsFromBase({...base,rows:[row('empty','0','0'),row('funded','2','0'),row('unknown',null,null),row('credit','3','0',{awaitingCredit:true})]});
 assert.deepEqual(result.map(r=>r.id),['funded','unknown','credit']);assert.equal(result[1].unknown,true);assert.match(result[2].blocked,/credit/);
});
test('Ethereum separates zero, dust and unknown without inventing dates',()=>{
 const r=api.paymentsFromEthereum({rows:[['empty','0',false],['funded','0.03',false],['dust','0.000000001',true],['unknown',null,false]].map(([id,eth,belowFee])=>({id,eth,belowFee,address:id,user:{email:id,fullName:id}}))});
 assert.deepEqual(r.map(x=>x.id),['funded','dust','unknown']);assert.equal(r[1].dust,true);assert.equal(r[2].unknown,true);assert.equal(r[0].receivedAt,null);
});
test('sweep all stops on uncertainty and preserves submitted hashes without retries',async()=>{
 let calls=0;const confirmed=[];const plans=[1,2,3].map(i=>({payment:{key:String(i)}}));
 await assert.rejects(api.executePayments(plans,async()=>({hashes:[`hash${++calls}`],uncertain:calls===2}),(key,hashes)=>confirmed.push({key,hashes})),/Stopped/);
 assert.equal(calls,2);assert.deepEqual(confirmed.map(r=>r.hashes[0]),['hash1','hash2']);
});
test('expired Ethereum review prevents send while retaining earlier Base outcome',async()=>{
 let calls=0;const done=[];
 await assert.rejects(api.executePayments([{payment:{key:'base'}},{payment:{key:'eth'},eth:{review:{expiresAt:0}}}],async()=>{calls++;return {hashes:['confirmed'],uncertain:false}},key=>done.push(key)),/expired/);
 assert.equal(calls,1);assert.deepEqual(done,['base']);
});
