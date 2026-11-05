const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
function load(file,deps,fetchImpl){const exports={};const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,allowJs:true}}).outputText;new Function('require','exports','fetch',js)(n=>{if(!(n in deps))throw Error('Unexpected '+n);return deps[n];},exports,fetchImpl);return exports;}
const model=require('../src/lib/maturing/model.mjs');const shared=require('../src/lib/maturing/shared/mature-warm-pool.mjs');const cold=require('../src/lib/maturing/shared/mature-cold-pool.mjs');
function service(fetchImpl,db={}){db={ambassadorApplication:{findMany:async()=>[]},selfServiceOnboarding:{findMany:async()=>[]},...db};process.env.MATURING_ENGINE_TOKEN='test-only';return load('src/lib/maturing/service.mjs',{'node:crypto':require('node:crypto'),'@/lib/prisma':{prisma:db},'./model.mjs':model,'./programs.mjs':require('../src/lib/maturing/programs.mjs'),'./sources.mjs':{},'./shared/mature-warm-pool.mjs':shared,'./shared/mature-cold-pool.mjs':cold},fetchImpl);}
test('direct campaign IDs cannot access another company or non-maturing records',async()=>{
 for(const c of [{owner:'sam@ortusclub.com',config:{matureWarm:true}},{owner:model.OWNER,config:{}}]){
 let calls=0;const lib=service(async()=>{calls++;return Response.json({campaign:c});});await assert.rejects(()=>lib.control('one','stop'),/not found/);assert.equal(calls,1);
 }
});
test('pause maps to the same engine action and never restarts the campaign',async()=>{
 const calls=[];const lib=service(async(url,opts)=>{calls.push({url,opts});return Response.json(calls.length===1?{campaign:{owner:model.OWNER,config:{matureWarm:true},profile_ids:['one']}}:{ok:true});});
 await lib.control('one','pause');assert.match(calls[1].url,/\/one\/stop\?pause=1$/);assert.equal(calls[1].opts.method,'POST');
});
test('resume blocks rented inventory before sending any mutation',async()=>{
 let count=0;const lib=service(async()=>{count++;return Response.json({campaign:{owner:model.OWNER,config:{matureWarm:true},profile_ids:['one']}});},{linkedInAccount:{findMany:async()=>[{id:'one',gologinProfileId:'one',status:'rented',rentals:[]}]}});
 await assert.rejects(()=>lib.control('one','resume'),/rented/);assert.equal(count,1);
});
test('admin authorization runs before API access and cross-origin mutations are rejected',async()=>{
 let invoked=false;const deps={'next/server':{NextResponse:{json:(data,opts)=>({data,status:opts?.status||200})}},'@/lib/auth':{requireAdmin:async()=>{throw Error('Forbidden');}},'@/lib/maturing/service.mjs':{list:()=>{invoked=true;}}};
 const route=load('src/app/api/admin/profile-maturing/[[...path]]/route.ts',deps);
 const req={method:'GET',headers:new Headers(),nextUrl:new URL('https://linkedvelocity.com/api/admin/profile-maturing')};
 assert.equal((await route.GET(req,{params:Promise.resolve({})})).status,403);assert.equal(invoked,false);
 deps['@/lib/auth'].requireAdmin=async()=>({email:'admin@linkedvelocity.com'});
 assert.equal((await route.POST({...req,method:'POST',headers:new Headers({origin:'https://evil.example'})},{params:Promise.resolve({path:['one','stop']})})).status,403);
});
test('incomplete dispatch does not masquerade as a successful retry',async()=>{
 const input={accountId:'one',launchId:'abcdefghijklmnop',plan:{warmEnabled:true,coldEnabled:true,warmPool:'linkedvelocity_owned'}};
 const id='lv_'+require('node:crypto').createHash('sha256').update('one:'+input.launchId).digest('hex').slice(0,24)+'_warm';
 const tx={ambassadorApplication:{findMany:async()=>[]},selfServiceOnboarding:{findMany:async()=>[]},$executeRaw:async()=>{},linkedInAccount:{findMany:async()=>[{id:'one',gologinProfileId:'one',status:'available',rentals:[]}]}};
 const lib=service(async()=>Response.json({campaigns:[{id,profile_ids:['one'],status:'cancelled'}]}),{$transaction:fn=>fn(tx)});
 await assert.rejects(()=>lib.start(input,'admin'),/incomplete or stopped/);
});
