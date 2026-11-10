const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
test('each signup tier is persisted before success without waiting for notification delivery',async()=>{
 for(const diyTier of ['standard','partial','full']){
  let saved,sent=false;const tasks=[];const m={exports:{}};
  const mocks={
   'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status||200})},after:fn=>tasks.push(fn)},
   '@/lib/meeting-token':{meetingToken:id=>'signed-'+id},
   '@/lib/auth':{getSession:async()=>({id:'logged-in-user'})},
   '@/lib/prisma':{prisma:{ambassadorApplication:{findFirst:async()=>null,create:async({data})=>(saved={id:'application',...data})}}},
   '@/services/profile-assessor':{assessFromApplication:()=>null},
   '@/services/email':{sendAmbassadorApplicationLead:async()=>{sent=true}},
   '@/lib/format-name':(()=>{const fm={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync('src/lib/format-name.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(fm,fm.exports);return fm.exports})(),
  };
  new Function('require','exports','module',ts.transpileModule(fs.readFileSync('src/app/api/ambassador/apply/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(n=>mocks[n]||require(n),m.exports,m);
  const response=await m.exports.POST({json:async()=>({fullName:'Test Owner',email:'owner@example.test',diyTier,submittedByUserId:'spoofed-user'})});
  assert.equal(response.status,201);assert.equal(saved.diyTier,diyTier);assert.equal(saved.submittedByUserId,'logged-in-user');assert.equal(saved.status,'pending');assert.equal(sent,false);assert.equal(tasks.length,1);
  await tasks[0]();assert.equal(sent,true);
 }
});
