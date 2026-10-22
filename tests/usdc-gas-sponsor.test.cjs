const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { ethers } = require('ethers');
const exports_ = {};
new Function('require', 'exports', ts.transpileModule(fs.readFileSync('src/lib/usdc-gas-sponsor.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(name => { assert.equal(name, 'ethers'); return { ethers }; }, exports_);
const { prepareSponsoredUsdcSweep, gasSponsorStatus, SPONSORED_USDC } = exports_;
// Ephemeral test-only keys. Never read production configuration or use a network.
const owner = ethers.Wallet.createRandom(), sponsor = ethers.Wallet.createRandom();
const destination = ethers.Wallet.createRandom().address;
const domain = { name:'USD Coin',version:'2',chainId:8453,verifyingContract:SPONSORED_USDC };
const iface = new ethers.Interface([
 'function DOMAIN_SEPARATOR() view returns(bytes32)',
 'function getL1FeeUpperBound(uint256) view returns(uint256)',
 'function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
]);
function fixture(options = {}) {
 process.env.USDC_GAS_SPONSOR_ENABLED = 'true';
 process.env.GAS_SPONSOR_PRIVATE_KEY = sponsor.privateKey;
 process.env.GAS_SPONSOR_ADDRESS = sponsor.address;
 process.env.GAS_SPONSOR_MAX_FEE_ETH = '0.00001';
 process.env.TREASURY_WALLET_ADDRESS = destination;
 delete process.env.USDC_CONTRACT_ADDRESS;
 let signed = 0;
 const signer = { address: owner.address, signTypedData: async (...args) => { signed++; return owner.signTypedData(...args); } };
 const provider = {
  getNetwork: async () => ({chainId: options.chain ?? 8453n}),
  getTransactionCount: async (_a,tag) => tag==='pending' && options.pending ? 4 : 3,
  getBalance: async () => options.balance ?? ethers.parseEther('0.01'),
  getFeeData: async () => ({maxFeePerGas: options.fee ?? 11000000n,maxPriorityFeePerGas:1000000n}),
  getBlock: async () => ({timestamp:1800000000}),
  call: async tx => {
   const parsed=iface.parseTransaction(tx);
   if (parsed.name==='DOMAIN_SEPARATOR') return iface.encodeFunctionResult(parsed.name,[options.badDomain ? ethers.ZeroHash : ethers.TypedDataEncoder.hashDomain(domain)]);
   assert.equal(parsed.name,'getL1FeeUpperBound');
   return iface.encodeFunctionResult(parsed.name,[options.l1 ?? 100000000n]);
  },
  estimateGas: async tx => {
   assert.equal(tx.from,sponsor.address);
   assert.equal(tx.to,SPONSORED_USDC);
   assert.equal(tx.value,0n);
   if (options.simulationError) throw new Error('simulation failed');
   return 65000n;
  },
 };
 const input={provider,owner:signer,source:owner.address,destination,amount:55000000n,assertActive:async()=>{if(options.lockLost)throw new Error('lost lock');}};
 return {input,provider,signed:()=>signed};
}
test('central signer pays for a destination-bound, expiring USDC authorization',async()=>{
 const f=fixture(); const prepared=await prepareSponsoredUsdcSweep(f.input);
 const tx=ethers.Transaction.from(prepared.rawTransaction);
 assert.equal(tx.from,sponsor.address);assert.equal(tx.to,SPONSORED_USDC);
 assert.equal(tx.chainId,8453n);assert.equal(tx.value,0n);assert.equal(tx.nonce,3);
 assert.equal(tx.hash,prepared.hash);assert.equal(tx.gasLimit,78000n);
 const args=iface.parseTransaction(tx).args;
 assert.equal(args[0],owner.address);assert.equal(args[1],destination);assert.equal(args[2],55000000n);
 assert.equal(args[4],1800000600n);
 const types={TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]};
 assert.equal(ethers.verifyTypedData(domain,types,{from:args[0],to:args[1],value:args[2],validAfter:args[3],validBefore:args[4],nonce:args[5]},ethers.Signature.from({v:Number(args[6]),r:args[7],s:args[8]})),owner.address);
 const another=await prepareSponsoredUsdcSweep(f.input);
 assert.notEqual(iface.parseTransaction(ethers.Transaction.from(another.rawTransaction)).args[5],args[5]);
});
test('wrong chain, domain, pending sponsor transaction and lost lock fail closed',async()=>{
 for(const options of [{chain:1n},{badDomain:true},{pending:true},{lockLost:true}]){
  const f=fixture(options);await assert.rejects(prepareSponsoredUsdcSweep(f.input));assert.equal(f.signed(),0);
 }
});
test('no funds, excessive execution/data fee or failed simulation cannot prepare a relay',async()=>{
 for(const options of [{balance:0n},{fee:1000000000n},{l1:ethers.parseEther('0.01')},{simulationError:true}]){
  const f=fixture(options);await assert.rejects(prepareSponsoredUsdcSweep(f.input));
 }
});
test('misconfiguration, changed treasury and token overrides cannot authorize transfers',async()=>{
 const mutations=[()=>{delete process.env.GAS_SPONSOR_PRIVATE_KEY},()=>{process.env.GAS_SPONSOR_ADDRESS=owner.address},()=>{process.env.USDC_GAS_SPONSOR_ENABLED='false'},()=>{process.env.TREASURY_WALLET_ADDRESS=owner.address},()=>{process.env.USDC_CONTRACT_ADDRESS=owner.address},()=>{process.env.GAS_SPONSOR_MAX_FEE_ETH='1'}];
 for(const mutate of mutations){const f=fixture();mutate();await assert.rejects(prepareSponsoredUsdcSweep(f.input));assert.equal(f.signed(),0);}
});
test('wrong deposit signer, self-send and zero amount cannot prepare transfers',async()=>{
 for(const overrides of [{source:sponsor.address},{destination:owner.address},{amount:0n}]){
  const f=fixture();await assert.rejects(prepareSponsoredUsdcSweep({...f.input,...overrides}));assert.equal(f.signed(),0);
 }
});
test('read-only status exposes only public gas wallet details, including missing funding',async()=>{
 const f=fixture({balance:0n});const status=await gasSponsorStatus(f.provider);
 assert.equal(status.address,sponsor.address);assert.equal(status.eth,'0.0');assert.match(status.error,/Fund/);
 assert.equal(JSON.stringify(status).includes(sponsor.privateKey),false);assert.equal(f.signed(),0);
 process.env.GAS_SPONSOR_PRIVATE_KEY='invalid';assert.match((await gasSponsorStatus(f.provider)).error,/not a valid Ethereum private key/);
});
test('pasted surrounding whitespace and an unprefixed MetaMask key are accepted',async()=>{
 const f=fixture();
 process.env.GAS_SPONSOR_PRIVATE_KEY=' '+sponsor.privateKey.slice(2)+'\n';
 process.env.GAS_SPONSOR_ADDRESS=' '+sponsor.address+'\n';
 assert.equal((await gasSponsorStatus(f.provider)).error,null);
 const prepared=await prepareSponsoredUsdcSweep(f.input);
 assert.equal(ethers.Transaction.from(prepared.rawTransaction).from,sponsor.address);
});

 test('status distinguishes wrong signer from RPC failure without exposing secret errors',async()=>{
  const f=fixture();
  process.env.GAS_SPONSOR_PRIVATE_KEY=ethers.Wallet.createRandom().privateKey;
  assert.match((await gasSponsorStatus(f.provider)).error,/different wallet/);
  process.env.GAS_SPONSOR_PRIVATE_KEY=sponsor.privateKey;
  f.provider.getBalance=async()=>{throw Error('private RPC credential must not escape')};
  const status=await gasSponsorStatus(f.provider);
  assert.match(status.error,/key matches/);
  assert.equal(JSON.stringify(status).includes('credential must not escape'),false);
  assert.equal(JSON.stringify(status).includes(sponsor.privateKey),false);
 });
