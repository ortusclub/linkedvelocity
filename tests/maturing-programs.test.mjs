import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoryResolver,categoriesResolver,programStages} from '../src/lib/maturing/programs.mjs';
test('inventory status wins: construction stays construction even with a live application (Sam, 2026-11-08)',()=>{
 const app={id:'a',verifiedAt:'2026-10-01',applicationReceived:true,status:'verified',email:'owner@example.com'};
 const classify=categoryResolver([app],[{accountId:'one',applicationId:'a',state:'complete'}]);
 assert.equal(classify({id:'one',status:'under_construction'}),'construction');
 assert.equal(classify({id:'one',status:'unavailable'}),'pipeline');
 assert.equal(classify({id:'four',status:'unavailable'}),'other');
 assert.equal(classify({id:'two',status:'under_construction'}),'construction');
 assert.equal(classify({id:'three',status:'available'}),'available');
 assert.equal(categoryResolver([{...app,paidAt:'2026-10-05'}],[{accountId:'one',applicationId:'a'}])({id:'one',status:'available'}),'available');
});
test('ambiguous identity does not infer a pipeline application',()=>{
 const apps=['a','b'].map(id=>({id,linkedinUrl:'https://linkedin.com/in/one',verifiedAt:'2026-10-01'}));
 assert.equal(categoryResolver(apps,[])({status:'available',linkedinUrl:apps[0].linkedinUrl}),'available');
});
test('three programmes have consecutive stages and recent restrictions override intensity',()=>{
 for(const key of ['pipeline','construction','available']){
  const stages=programStages(key);assert.equal(stages[0].fromDay,1);
  stages.slice(1).forEach((s,i)=>assert.equal(s.fromDay,stages[i].toDay+1));
  assert.ok(stages.some(s=>s.coldDaily>0));
 }
 assert.ok(programStages('construction')[0].warmDaily>programStages('pipeline')[0].warmDaily);
 assert.ok(programStages('available')[0].warmDaily>programStages('construction')[0].warmDaily);
 assert.deepEqual(programStages('available',true),programStages('pipeline'));
});

test('an account can belong to Pipeline and Construction at once; status alone never implies pipeline',()=>{
 const app={id:'a',verifiedAt:'2026-10-01',applicationReceived:true,status:'verified',email:'owner@example.com'};
 const both=categoriesResolver([app],[{accountId:'one',applicationId:'a',state:'complete'}]);
 assert.deepEqual(both({id:'one',status:'under_construction'}).sort(),['construction','pipeline']);
 assert.deepEqual(both({id:'two',status:'under_construction'}),['construction']);
 assert.deepEqual(both({id:'one',status:'unavailable'}),['pipeline']);
 assert.deepEqual(both({id:'three',status:'unavailable'}),['other']);
});
