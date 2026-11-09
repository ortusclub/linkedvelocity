const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
function fixture(key='expected') {
 let query;
 const prisma={rental:{findMany:async q=>{query=q;return [{id:'r',status:'active',paused:false,handoverAt:null,linkedinAccount:{id:'a',loginEmail:'Name@example.com',linkedinName:'Name',linkedinUrl:'https://linkedin.com/in/name',hasSalesNav:true,linkedinVerified:true,restrictedAt:null,permanentlyRestricted:false}}];}}};
 const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync('src/app/api/integrations/soapex-rentals/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const env={SOAPEX_RENTALS_SYNC_KEY:key};
 new Function('require','module','exports','process',source)(n=>n==='@/lib/prisma'?{prisma}:n==='next/server'?{NextResponse:{json:(data,init)=>Response.json(data,init)}}:require(n),module,module.exports,{env});
 return {get:token=>module.exports.GET(new Request('https://example.test',{headers:token?{authorization:'Bearer '+token}:{}})),query:()=>query};
}
test('denies missing, wrong and unconfigured credentials before querying rentals',async()=>{
 for(const [expected,given] of [['expected',''],['expected','wrong'],['','']]) {const f=fixture(expected);assert.equal((await f.get(given)).status,401);assert.equal(f.query(),undefined);}
});
test('queries Apex only and exports only allowlisted rental identity fields',async()=>{
 const f=fixture();const response=await f.get('expected'),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(f.query().where.user.email.equals,'info@apexstrategy.io');
 assert.equal(body.renter,'info@apexstrategy.io');assert.equal(body.rentals[0].email,'name@example.com');
 const q=JSON.stringify(f.query()),s=JSON.stringify(body);
 for(const name of ['accountPassword','twoFactor','proxyPassword','gologinShareLink','paymentDetails','passwordHash']) {assert.ok(!q.includes(name));assert.ok(!s.includes(name));}
});
