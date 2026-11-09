const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync('scripts/soapex/LinkedVelocitySync.js', 'utf8'), context);
const plan = (rows, rentals) => context.soapexLvPlan_(rows, {schemaVersion:1,renter:'info@apexstrategy.io',fetchedAt:new Date().toISOString(),rentals});
const source = (extra={}) => ({accountId:'account-1',rentalId:'rental-1',email:'rented@example.com',name:'Rental Name',url:'https://linkedin.com/in/rented',status:'active',...extra});
const rows = () => [ ['Email','Status'], ['Linkedin Accounts'], ['primary@example.com','Active'], ['Linked Velocity Rented Accounts'], ['rented@example.com','Rented','Manual company','','Manual first','Manual last','Manual full name','https://www.linkedin.com/in/rented/','password','operator','manual sales nav','','','','','','In Use','cc-user',55], ['historic@example.com','Past Rental'] ];

test('writes only rental status and missing identity; never other sections or campaign data',()=>{
 const original=rows(), copy=JSON.stringify(original), p=plan(original,[source()]);
 assert.equal(JSON.stringify(original),copy);
 assert.equal(p.additions.length,0); assert.equal(p.warnings.length,0);
 assert.ok(p.edits.every(e=>e.row===4 && e.col===1));
});
test('verified ended rentals become past rental; absent identities are preserved',()=>{
 const p=plan(rows(),[source({status:'expired'})]);
 assert.equal(p.edits[0].value,'Past Rental'); assert.equal(p.edits.length,1);
});
test('pending access is included; missing current rentals append; historic source-only rows do not',()=>{
 const p=plan(rows(),[source({accountId:'new',email:'new@example.com',url:'https://linkedin.com/in/new',status:'pending_access'}),source({accountId:'old',email:'old@example.com',url:'https://linkedin.com/in/old',status:'expired'})]);
 assert.equal(p.current,1); assert.equal(p.additions.length,1); assert.equal(p.additions[0].email,'new@example.com');
});
test('an open rental wins over newer historic replacement for same identity',()=>{
 const p=plan(rows(),[source({status:'replaced'}),source({rentalId:'older',status:'active'})]);
 assert.equal(p.current,1); assert.equal(p.edits[0].value,'Rented');
});
test('preserves restriction labels and refuses ambiguous/cross-section identities',()=>{
 const r=rows();r[4][1]='Inaccessible';assert.equal(plan(r,[source()]).edits[0].value,'Inaccessible');
 r.push([...r[4]]);assert.equal(plan(r,[source()]).warnings.length,1);
 assert.equal(plan(rows(),[source({email:'primary@example.com',url:'https://linkedin.com/in/other'})]).warnings.length,1);
});
test('does not duplicate a renamed email with a matching LinkedIn identity',()=>{
 const p=plan(rows(),[source({email:'new-email@example.com'})]);
 assert.equal(p.additions.length,0); assert.equal(p.warnings.length,0);
});
test('rejects wrong brand and changed layout',()=>{
 assert.throws(()=>context.soapexLvPlan_(rows(),{schemaVersion:1,renter:'info@ortus.solutions',rentals:[]}));
 assert.throws(()=>plan([['Email','Status'],['other']],[]));
});
test('new source identities with duplicate emails are held before any write',()=>{
 const p=plan(rows(),[source({accountId:'new1',email:'new@example.com',url:'https://linkedin.com/in/new1'}),source({accountId:'new2',email:'new@example.com',url:'https://linkedin.com/in/new2'})]);
 assert.ok(p.warnings.some(w=>w.includes('Duplicate current source email')));
});
test('manual refresh due-time lookup preserves the scheduled timestamp',()=>{
 const saved='2026-11-10T00:00:00.000Z';
 context.PropertiesService={getScriptProperties:()=>({getProperty:()=>saved,setProperty:()=>{throw Error('manual path must not reschedule');}})};
 assert.equal(context.soapexLvNext_(new Date('2026-11-09T23:00:00Z')).toISOString(),saved);
});
test('new rentals insert before the lower unavailable block, not isolated restricted current rows',()=>{
 const r=[['Email','Status'],['Linked Velocity Rented Accounts'],['a@example.com','Identity Restricted'],['b@example.com','Rented'],[],['c@example.com','Past Rental'],['d@example.com','Inaccessible'],['e@example.com','Identity Restricted']];
 assert.equal(context.soapexLvInsertionRow_(r,1,r.length),4);
});
test('known rentals in the explicit unavailable section are retained without duplicate or edits',()=>{
 const r=[['Email','Status'],['Linked Velocity Rented Accounts'],['other@example.com','Rented'],[],['Innaccessible/Restricted'],['rented@example.com','Identity Restricted']];
 const p=plan(r,[source()]);assert.equal(p.warnings.length,0);assert.equal(p.additions.length,0);assert.equal(p.edits.length,0);assert.equal(context.soapexLvInsertionRow_(r,p.marker,p.end),3);
});
