const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,deps){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name];},process:{env:{RENTALS_EXPORT_KEY:'test'}},Date});return exports;}
const company=load('src/lib/company.ts',{});
const stage=load('src/lib/inventory-stage.ts',{'@/lib/company':company});
const construction=load('src/lib/owner-construction.ts',{'@/lib/inventory-stage':stage});
const account=(id,status,extra={})=>({id,linkedinName:id,status,loginEmail:null,accountPassword:null,...extra});
const owner=(email,accounts,extra={})=>({email,fullName:email,accounts,accountCount:accounts.length,applicationId:'app',applicationStatus:'onboarded',setupFeePaidAt:'2026-10-01',monthlyPayouts:[],...extra});
test('construction matches inventory and excludes rented, restricted and pre-inventory profiles',()=>{
 const o=owner('mixed',[account('building','under_construction'),account('immature','construction_immature'),account('ready','available'),account('rented','rented'),account('restricted','under_construction',{restrictedAt:'2026-11-10'})]);
 assert.deepEqual(Array.from(construction.constructionAccounts(o),a=>a.id),['building','immature']);
 assert.equal(construction.constructionAccounts({...o,setupFeePaidAt:null}).length,0);
});
test('CSV groups construction owners once, retains mixed profiles and existing column positions',async()=>{
 const owners=[owner('mixed',[account('building','under_construction'),account('ready','available')]),owner('active',[account('ready2','available')]),owner('paused',[account('building2','under_construction')],{applicationStatus:'on_hold'})];
 class Response{constructor(body){this.body=body;}}
 const route=load('src/app/api/admin/owners/export/route.ts',{'next/server':{NextResponse:Response},'@/lib/owners':{getOwners:async()=>owners},'@/lib/crypto-creds':{decryptSecret:v=>v},'@/lib/referral-currency':{currencyConfigFor:()=>({currency:'USD'}),formatMoney:String},'@/lib/referrals':{setupFeeReadyDate:()=>null},'@/lib/owner-construction':construction});
 const result=await route.GET({nextUrl:new URL('https://test/?key=test')});
 const lines=result.body.split('\n');const headers=lines[0].split(',');
 assert.equal(headers[6],'Profiles');assert.equal(headers[19],'Missing fields');assert.equal(headers[20],'Has construction accounts');
 assert.match(lines[1],/CONSTRUCTION \(2 accounts · 2 owners\)/);
 for(const id of ['mixed','active','paused'])assert.equal(lines.filter(l=>l.startsWith(id+',')).length,1);
 const mixed=lines.find(l=>l.startsWith('mixed,'));assert.match(mixed,/building \(under_construction\); ready \(available\)/);assert.match(mixed,/,Yes,1,building$/);
 assert.match(lines.find(l=>l.startsWith('paused,')),/,Paused,/);
 assert.ok(lines.findIndex(l=>l.startsWith('active,'))>lines.findIndex(l=>l.startsWith('paused,')));
});
