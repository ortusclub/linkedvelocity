const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function load(file,mocks={}){const m={exports:{}};new Function('require','exports','module',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(n=>mocks[n]||require(n),m.exports,m);return m.exports}
test('duplicate checks include normalized account email and precise profile identity',async()=>{
 let appQuery,accountQuery;
 const helper=load('src/lib/application-duplicates.ts',{'@/lib/prisma':{prisma:{ambassadorApplication:{findFirst:async q=>{appQuery=q;return null}},linkedInAccount:{findFirst:async q=>{accountQuery=q;return {id:'inventory-id'}}}}}});
 const note=await helper.existingApplicationAccount(' OWNER@Example.com ','https://linkedin.com/in/person?tracking=yes');
 assert.match(note,/Existing account submission/);assert.match(note,/inventory-id/);
 assert.equal(appQuery.where.OR[0].email.equals,'owner@example.com');
 assert.ok(accountQuery.where.OR.some(q=>q.linkedinUrl?.endsWith==='/in/person'));
 assert.ok(!accountQuery.where.OR.some(q=>q.linkedinUrl?.contains==='/in/person'));
});
test('public onboarding starts a scoped wizard after email verification',async()=>{
 let reserved;
 const route=load('src/app/api/self-onboarding/start/route.ts',{'@/lib/format-name':load('src/lib/format-name.ts'),
  '@/lib/application-duplicates':{existingApplicationAccount:async()=>null},
 '@/lib/prisma':{prisma:{referrer:{findUnique:async()=>({id:'diy-id',slug:'diy'})},selfServiceOnboarding:{findUnique:async()=>({applicationId:'new-app'})},ambassadorApplication:{update:async()=>{}}}},
  '@/lib/self-service-input':load('src/lib/self-service-input.ts'),
  '@/lib/self-service-onboarding':{OnboardingError:class extends Error{},DIY_REFERRER_SLUG:'diy',reserveOnboarding:async(...args)=>{reserved=args;return 'new-session'},mintSelfToken:async id=>{assert.equal(id,'new-session');return 'new-token'},onboardingSummary:async()=>({id:'new-session'})},
  '@/lib/test-mode':{isLikelyTestEmail:()=>false},'@/lib/auth':{getSession:async()=>({id:'submitter-id',status:'active'})},'@/lib/self-onboarding-gate':{verifyPermit:()=>true}
 });
 const previous=process.env.GOLOGIN_API_TOKEN_KLABBER;process.env.GOLOGIN_API_TOKEN_KLABBER='mock';
 const body={fullName:'Test Owner',email:'owner@example.com',linkedinUrl:'https://linkedin.com/in/person',country:'PH',contactNumber:'WhatsApp:+639123456789',accountFreshness:'established',paymentMethod:'GCash',paymentDetails:'09123456789',payoutName:'Test Owner',consent:true,tier:'partial',permit:'mock'};
 try {const r=await route.POST(new Request('https://example.test/api/self-onboarding/start',{method:'POST',body:JSON.stringify(body)}));assert.equal(r.status,200);assert.equal((await r.json()).token,'new-token');assert.equal(reserved[2],'submitter-id');assert.deepEqual(reserved[3],{publicOwner:true});}finally{if(previous)process.env.GOLOGIN_API_TOKEN_KLABBER=previous;else delete process.env.GOLOGIN_API_TOKEN_KLABBER}
});
test('repeat public signup gets isolated records and warning, never the existing account session',async()=>{
 const created={};const old={application:{submittedByUserId:'other-user'},id:'old-session',referrerId:'other-referrer',email:'owner@example.com',linkedinUrl:'https://linkedin.com/in/person'};
 let existingSession=null;
 const tx={$executeRaw:async()=>{},selfServiceOnboarding:{findFirst:async q=>q.where.application ? (existingSession?.application?.submittedByUserId===q.where.application.submittedByUserId && existingSession.referrerId===q.where.referrerId ? existingSession : null) : existingSession,findMany:async()=>[],create:async q=>{created.session=q.data;return {id:'new-session'}}},ambassadorApplication:{findFirst:async()=>({id:'old-app'}),create:async q=>{created.app=q.data;return {id:'new-app'}}},linkedInAccount:{findFirst:async()=>({id:'old-account'}),findMany:async()=>[],create:async q=>{created.account=q.data;return {id:'new-account'}}},proxy:{findMany:async()=>[]}};
 const lib=load('src/lib/self-service-onboarding.ts',{
  '@/lib/prisma':{prisma:{$transaction:async fn=>fn(tx)}},'@/lib/referral-currency':{currencyConfig:()=>({payoutMethods:['GCash'],currency:'PHP',monthlyAmount:500})},'@/lib/referrals':{},'@/lib/payment-schedule':{},'@/services/gologin':{},'@/lib/self-service-input':{},'@/lib/countries':{countryCode:()=> 'PH'},'@/services/proxy-cheap':{proxyPurchaseLimits:()=>({enabled:true})},'@/lib/onboarding-proxy-pool':{availableProxySlots:()=>[]},'@/lib/onboarding-email':{},'@/lib/phone-verification':{phoneVerificationConfigured:()=>false}
 });
 const result=await lib.reserveOnboarding({id:'diy-id',slug:'diy'},{email:'owner@example.com',linkedinUrl:'https://linkedin.com/in/person',country:'PH',paymentMethod:'GCash',fullName:'Test Owner'},'submitter-id',{publicOwner:true});
 assert.equal(result,'new-session');assert.equal(created.session.accountId,'new-account');assert.equal(created.session.applicationId,'new-app');assert.equal(created.app.submittedByUserId,'submitter-id');assert.match(created.app.adminNotes,/Existing account submission/);assert.match(created.app.adminNotes,/old-account/);assert.equal(created.account.listed,false);
 existingSession=old;
 assert.equal(await lib.reserveOnboarding({id:'diy-id',slug:'diy'},{email:'owner@example.com',linkedinUrl:'https://linkedin.com/in/person',country:'PH',paymentMethod:'GCash'},'submitter-id',{publicOwner:true}),'new-session');assert.match(created.app.adminNotes,/will likely be rejected/);assert.equal(created.session.accountId,'new-account');
 await assert.rejects(()=>lib.reserveOnboarding({id:'diy-id',slug:'diy'},{email:'owner@example.com',linkedinUrl:'https://linkedin.com/in/person',country:'PH',paymentMethod:'GCash'}),/already has onboarding/);
 existingSession={...old,referrerId:'diy-id',state:'reserved',application:{submittedByUserId:'submitter-id'}};assert.equal(await lib.reserveOnboarding({id:'diy-id',slug:'diy'},{email:'owner@example.com',linkedinUrl:'https://linkedin.com/in/person',country:'PH',paymentMethod:'GCash'},'submitter-id',{publicOwner:true}),'old-session');
});
test('public phone handoff is scoped to its token and records the partial tier',async()=>{
 const id='11111111-1111-4111-8111-111111111111';let handoffs=0,update;
 const route=load('src/app/api/self-onboarding/[token]/route.ts',{
 '@/lib/prisma':{prisma:{selfServiceOnboarding:{findUniqueOrThrow:async()=>({applicationId:'new-app'})},ambassadorApplication:{update:async q=>{update=q}}}},
 '@/lib/referral-currency':{},'@/lib/self-service-input':load('src/lib/self-service-input.ts'),'@/services/proxy-cheap':{},'@/lib/onboarding-email-policy':{},'@/lib/onboarding-email':{requireEmailSetup:async()=>{}},
 '@/lib/self-service-onboarding':{OnboardingError:class extends Error{constructor(m,status){super(m);this.status=status}},resolveSelfSession:async()=>({sessionId:id,referrerId:'diy'}),handoffOnboarding:async(sid)=>{assert.equal(sid,id);handoffs++},onboardingSummary:async()=>({id,state:'handed_off'})}
 });
 const req=body=>new Request('https://example.test/api/self-onboarding/token',{method:'PATCH',body:JSON.stringify(body)}),ctx={params:Promise.resolve({token:'own-token'})};
 assert.equal((await route.PATCH(req({id:'other-session',action:'handoff',password:'test-only-password'}),ctx)).status,404);
 assert.equal(handoffs,0);
 assert.equal((await route.PATCH(req({id,action:'handoff',password:'test-only-password',twoFactorKey:'JBSWY3DPEHPK3PXP'}),ctx)).status,200);
 assert.equal(handoffs,1);assert.deepEqual(update,{where:{id:'new-app'},data:{diyTier:'partial'}});
});
