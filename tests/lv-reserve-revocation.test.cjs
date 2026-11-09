const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function fixture({ids=['profile'],ok=true}={}) {
 const calls=[],queries=[];
 const source=ts.transpileModule(fs.readFileSync('src/lib/lv-reserve-revocation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};
 vm.runInNewContext(source,{exports,require:()=>({prisma:{linkedInAccount:{findMany:async query=>{queries.push(query);return ids.map(gologinProfileId=>({gologinProfileId}));}}}}),process:{env:{MATURING_ENGINE_URL:'https://engine.test',MATURING_ENGINE_TOKEN:'test'}},AbortSignal,console:{error:()=>{}},fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok,status:ok?200:503,json:async()=>({ok})};}});
 return {api:exports,calls,queries};
}
test('rental notification contains only profile IDs and replays safely',async()=>{
 const f=fixture();await f.api.revokeRentedReserves('account');await f.api.revokeRentedReserves('account');
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0].body,{profileIds:['profile']});
 assert.equal(f.queries[0].where.id,'account');
 assert.equal(f.queries[0].where.OR[1].rentals.some.isShadow,false);
});
test('unconfirmed stop blocks access grant but checkout notifier preserves committed payment',async()=>{
 const f=fixture({ok:false});await assert.rejects(f.api.revokeRentedReserves('account'),/not confirmed/);
 await f.api.notifyReserveRental('account');assert.equal(f.calls.length,2);
});
test('empty rental query makes no engine call; reconciliation batches large inventories',async()=>{
 const empty=fixture({ids:[]});await empty.api.revokeRentedReserves();assert.equal(empty.calls.length,0);
 const many=fixture({ids:Array.from({length:1001},(_,i)=>String(i))});await many.api.revokeRentedReserves();
 assert.deepEqual(many.calls.map(c=>c.body.profileIds.length),[500,500,1]);
});
