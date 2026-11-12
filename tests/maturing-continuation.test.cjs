const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
function load(file,deps){const exports={};const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,allowJs:true}}).outputText;new Function('require','exports',js)(n=>{if(!(n in deps))throw Error('Unexpected '+n);return deps[n];},exports);return exports;}
for(const [label,fields,expected] of [
 ['unavailable listing',{status:'unavailable'},0],['construction',{status:'under_construction'},0],['returned to owner',{status:'unavailable',exitReason:'returned'},1],['access removed',{status:'unavailable',exitReason:'access_lost'},1],
 ['rented',{status:'rented'},1],['active shadow rental',{rentals:[{id:'shadow'}]},1],
 ['restricted',{restrictedAt:new Date()},1],
])test(`${label}: reconciliation ${expected?'stops':'preserves'} the live maturing plan`,async()=>{
 const created='2026-11-01T00:00:00Z';const stops=[];const a={id:'a',gologinProfileId:'p',status:'available',rentals:[],inventoryPool:'main',maturingStartedAt:new Date(created),...fields};
 const route=load('src/app/api/cron/reconcile-maturing/route.ts',{
 'next/server':{NextResponse:{json:data=>data}},'@/lib/prisma':{prisma:{$executeRawUnsafe:async()=>0,linkedInAccount:{findMany:async()=>[a],update:async()=>{}}}},
 '@/lib/warmup-activity':{logWarmupActivity:async()=>{}},'@/lib/maturing/service.mjs':{list:async()=>({campaigns:[{id:'lv_current_warm',profileIds:['p'],status:'running',createdAt:created}]}),control:async(id,action)=>stops.push({id,action})},
 });process.env.CRON_SECRET='test';await route.POST({headers:new Headers({authorization:'Bearer test'})});assert.equal(stops.length,expected);if(expected)assert.deepEqual(stops,[{id:'lv_current_warm',action:'stop'}]);
});
