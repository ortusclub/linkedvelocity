const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function render({ sponsor, sourceEth = '0', usdc = '55', usdt = '0', awaitingCredit = false }) {
 const data = { rows: [{id:'deposit',customer:'fixture@example.com',address:'0x3333333333333333333333333333333333333333',eth:sourceEth,usdc,usdt,awaitingCredit,error:null}],
  gasSponsor:sponsor,treasury:'0x1111111111111111111111111111111111111111',signingConfigured:true,page:0,hasMore:false,checkedAt:'2026-01-01T00:00:00Z' };
 const states=[data,0,false,'',null,false,null];let index=0;
 const react={...React,useState:()=>[states[index++],()=>{}],useRef:()=>({current:null}),useEffect:()=>{},useCallback:fn=>fn};
 const exports_={};
 const code=ts.transpileModule(fs.readFileSync('src/components/admin/TreasuryDeposits.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 new Function('require','exports',code)(name=>{if(name==='react')return react;if(name==='react/jsx-runtime')return require(name);throw new Error(name)},exports_);
 const html=renderToStaticMarkup(React.createElement(exports_.default,{onSwept:async()=>{}}));
 const button=html.match(/<button[^>]*>Sweep to main wallet<\/button>/)[0];
 return {html,disabled:button.includes('disabled=')};
}
const ready={enabled:true,address:'0x2222222222222222222222222222222222222222',eth:'0.001',error:null};
test('ETH-empty customer can review USDC when the central gas wallet is ready',()=>{
 const r=render({sponsor:ready});assert.equal(r.disabled,false);assert.match(r.html,/Central gas wallet/);assert.match(r.html,/No ETH top-ups/);
});
test('missing central funding or uncredited USDC disables sweep review',()=>{
 assert.equal(render({sponsor:{...ready,eth:'0',error:'Fund this central wallet'}}).disabled,true);
 assert.equal(render({sponsor:ready,awaitingCredit:true}).disabled,true);
});
test('USDT and legacy USDC continue to require deposit-wallet gas',()=>{
 assert.equal(render({sponsor:ready,usdc:'0',usdt:'5'}).disabled,true);
 assert.equal(render({sponsor:{enabled:false}}).disabled,true);
 assert.equal(render({sponsor:{enabled:false},sourceEth:'0.001'}).disabled,false);
});
