const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const ts=require('typescript');const crypto=require('node:crypto');const {ethers}=require('ethers');
const wallet=new ethers.Wallet('0x'+'11'.repeat(32));
process.env.HD_WALLET_SEED_PHRASE='test-only-review-key';process.env.TREASURY_WALLET_ADDRESS='0x2222222222222222222222222222222222222222';
function fixture(o={}){
 const events=[];const journals=[];const deposit={id:'deposit',address:wallet.address,derivationIndex:1,userId:'user',user:{email:'test@example.com'}};
 const prisma={depositAddress:{findUnique:async()=>deposit},transaction:{findMany:async()=>journals.filter(x=>x.description.startsWith('Ethereum ETH sweep pending:')),create:async({data})=>{events.push('journal');if(o.journalError)throw Error('DB failed');journals.push({...data,id:'j'});},update:async({data})=>{Object.assign(journals[0],data)}}};
 const provider={getNetwork:async()=>({chainId:o.chain??1n}),getTransactionReceipt:async()=>o.receipt||null,getCode:async()=>o.code||'0x',getBalance:async()=>o.balance??ethers.parseEther('0.03'),getTransactionCount:async(_,tag)=>tag==='pending'&&o.pending?2:1,getFeeData:async()=>({maxFeePerGas:o.fee??1000000000n,maxPriorityFeePerGas:100000000n}),broadcastTransaction:async raw=>{events.push('broadcast');assert.equal(ethers.Transaction.from(raw).chainId,1n);if(o.broadcastError)throw Error('timeout');return {}}};
 const deps={'node:crypto':crypto,ethers:{ethers:o.ethers||ethers},'@/lib/prisma':{prisma},'@/lib/wallet':{getDepositAddress:()=>({address:o.wrongSigner?'0x3333333333333333333333333333333333333333':wallet.address,privateKey:wallet.privateKey})}};
 const exports={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/lib/ethereum-sweep.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(n=>{if(!deps[n])throw Error(n);return deps[n]},exports);
 return {api:exports,provider,events,journals,o};
}
test('preview deducts maximum gas, binds chain and does not broadcast',async()=>{const f=fixture();const q=await f.api.previewEthereumSweep(f.provider,'deposit');assert.equal(q.review.amount,'0.029979');assert.equal(q.review.maxFee,'0.000021');assert.deepEqual(f.events,[]);});
test('journals before broadcast and cannot repeat an uncertain sweep',async()=>{const f=fixture({broadcastError:true});const q=await f.api.previewEthereumSweep(f.provider,'deposit');const result=await f.api.executeEthereumSweep(f.provider,q.review,q.signature,async()=>{});assert.equal(result.status,'unconfirmed');assert.deepEqual(f.events,['journal','broadcast']);assert.equal(f.journals[0].amount,'0');assert.match(f.journals[0].description,/0.029979/);await assert.rejects(f.api.executeEthereumSweep(f.provider,q.review,q.signature,async()=>{}),/pending or unconfirmed/);});
test('journal failure prevents broadcast',async()=>{const f=fixture({journalError:true});const q=await f.api.previewEthereumSweep(f.provider,'deposit');await assert.rejects(f.api.executeEthereumSweep(f.provider,q.review,q.signature,async()=>{}));assert.deepEqual(f.events,['journal']);});
test('tampered destination or value cannot be submitted',async()=>{const f=fixture();const q=await f.api.previewEthereumSweep(f.provider,'deposit');await assert.rejects(f.api.executeEthereumSweep(f.provider,{...q.review,amount:'1'},q.signature,async()=>{}),/Invalid review/);assert.deepEqual(f.events,[]);});
test('expiry rejects submission',async()=>{const f=fixture();const q=await f.api.previewEthereumSweep(f.provider,'deposit');const now=Date.now;Date.now=()=>q.review.expiresAt+1;try{await assert.rejects(f.api.executeEthereumSweep(f.provider,q.review,q.signature,async()=>{}),/expired/)}finally{Date.now=now}});
for(const [name,o,pattern] of [['wrong chain',{chain:8453n},/Ethereum mainnet/],['contract destination',{code:'0x123'},/contract/],['pending transaction',{pending:true},/pending/],['insufficient gas',{balance:1n},/network fee/]])test(name+' blocks preview',async()=>{const f=fixture(o);await assert.rejects(f.api.previewEthereumSweep(f.provider,'deposit'),pattern);assert.deepEqual(f.events,[])});
for(const [name,change,pattern] of [['fees rise',{fee:2000000000n},/fees increased/],['balance changes',{balance:ethers.parseEther('0.04')},/state changed/],['wrong signing identity',{wrongSigner:true},/identity/]])test(name+' blocks submit',async()=>{const f=fixture();const q=await f.api.previewEthereumSweep(f.provider,'deposit');Object.assign(f.o,change);await assert.rejects(f.api.executeEthereumSweep(f.provider,q.review,q.signature,async()=>{}),pattern);assert.deepEqual(f.events,[])});
test('preview reads confirmed receipts without mutating the journal',async()=>{const f=fixture({receipt:{status:1}});f.journals.push({id:'j',description:'Ethereum ETH sweep pending:deposit:{}',txHash:'0x123'});await f.api.previewEthereumSweep(f.provider,'deposit');assert.match(f.journals[0].description,/pending/)});

test('read fallback recovers a failed RPC and disables broadcasting',async()=>{
 const destroyed=[];let attempted=0;
 class FakeProvider {constructor(request){this.url=request.url;this.index=attempted++}async getNetwork(){if(this.index===0)throw Error('RPC down');return {chainId:1n}}destroy(){destroyed.push(this.index)}}
 const f=fixture({ethers:{...ethers,JsonRpcProvider:FakeProvider}});
 const result=await f.api.withEthereumRead(async p=>{await assert.rejects(p.broadcastTransaction(),/Read-only/);return 'balance'});
 assert.equal(result,'balance');assert.equal(attempted,2);assert.deepEqual(destroyed,[0,1]);
});
test('read fallback preserves business holds without retrying another provider',async()=>{
 let attempted=0;
 class FakeProvider {constructor(){attempted++}async getNetwork(){return {chainId:1n}}destroy(){}}
 const f=fixture({ethers:{...ethers,JsonRpcProvider:FakeProvider}});
 await assert.rejects(f.api.withEthereumRead(async()=>{throw new f.api.SweepError('pending transaction')}),/pending/);assert.equal(attempted,1);
});
