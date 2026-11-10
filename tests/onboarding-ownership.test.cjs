const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function load(file,mocks={}){const m={exports:{}};new Function('require','exports','module',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(n=>mocks[n]||require(require.resolve(n,{paths:[process.cwd()]})),m.exports,m);return m.exports}
const body={fullName:'Test Owner',email:'owner@example.com',linkedinUrl:'https://linkedin.com/in/person',country:'PH',contactNumber:'WhatsApp:+639123456789',accountFreshness:'established',paymentMethod:'GCash',paymentDetails:'09123456789',payoutName:'Test Owner',consent:true,tier:'full',permit:'mock'};
for(const scenario of ['new','existing','signed-in','inactive','unverified'])test(`onboarding ownership: ${scenario}`,async()=>{
 let createCount=0,linked,signedInAs; const existing={id:'existing',status:'active',role:'customer',emailVerified:new Date()};
 const route=load('src/app/api/self-onboarding/start/route.ts',{'@/lib/format-name':load('src/lib/format-name.ts'),
 '@/lib/prisma':{prisma:{user:{upsert:async q=>{assert.equal(q.where.email,body.email);createCount++;return scenario==='inactive'?{...existing,status:'suspended'}:scenario==='new'?{...existing,id:'new'}:existing}},referrer:{findUnique:async()=>({id:'diy'})},selfServiceOnboarding:{findUnique:async()=>({applicationId:'app',state:'reserved'})},ambassadorApplication:{update:async()=>{}}}},
 '@/lib/self-service-input':load('src/lib/self-service-input.ts'),'@/lib/test-mode':{isLikelyTestEmail:()=>false},
 '@/lib/self-onboarding-gate':{verifyPermit:()=>scenario!=='unverified'},'@/lib/auth':{getSession:async()=>scenario==='signed-in'?{...existing,id:'submitter',email:'different@example.com'}:null,createSession:async id=>{signedInAs=id}},
 '@/lib/self-service-onboarding':{OnboardingError:class extends Error{},DIY_REFERRER_SLUG:'diy',reserveOnboarding:async(_r,_i,userId)=>{linked=userId;return 'session'},mintSelfToken:async()=> 'test-token',onboardingSummary:async()=>({})}
 });
 process.env.GOLOGIN_API_TOKEN_KLABBER='mock';
 const r=await route.POST(new Request('https://example.test/api/self-onboarding/start',{method:'POST',body:JSON.stringify(body)}));
 if(['inactive','unverified'].includes(scenario)){assert.equal(r.status,403);assert.equal(linked,undefined);assert.equal(signedInAs,undefined);if(scenario==='unverified')assert.equal(createCount,0)}else{assert.equal(r.status,200);assert.equal(linked,scenario==='signed-in'?'submitter':scenario==='new'?'new':'existing');assert.equal(signedInAs,scenario==='signed-in'?undefined:linked);if(scenario==='signed-in')assert.equal(createCount,0)}
});
for(const foreign of [false,true])test(`resume restricts ownership: foreign=${foreign}`,async()=>{
 const user={id:'owner',email:'owner@example.com',status:'active'};let query;
 const page=load('src/app/onboarding/resume/[id]/page.tsx',{'@/lib/auth':{getSession:async()=>user},'@/lib/application-ownership':load('src/lib/application-ownership.ts'),'@/lib/prisma':{prisma:{ambassadorApplication:{findFirst:async q=>{query=q;return foreign?null:{selfServiceOnboarding:{publicToken:'test-token'}}}}}},'next/navigation':{redirect:url=>{throw new Error(url)},notFound:()=>{throw new Error('404')}}});
 await assert.rejects(()=>page.default({params:Promise.resolve({id:'app'})}),foreign?/404/:/\/onboarding\/setup\/test-token/);
 assert.equal(query.where.id,'app');assert.deepEqual(query.where.OR,[{submittedByUserId:'owner'},{submittedByUserId:null,email:{equals:user.email,mode:'insensitive'}}]);
});
