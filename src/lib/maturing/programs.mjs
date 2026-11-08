// One classification for the board and automatic enrolment. Inventory status wins:
// an account under construction is Construction and an available one is Available
// whatever its application says; Pipeline is for everything else with a live
// Level-4 application (Sam, 2026-11-08 — "if they are in construction they go in
// the Construction section").
export const PROGRAMS = {
 pipeline: {label:'Pipeline Maturing', description:'Gentle warm ramp, followed by cold connections.'},
 construction: {label:'Construction', description:'Build connections with a stronger warm ramp, then introduce cold connections.'},
 available: {label:'Available', description:'Maintain activity with warm and cold connections while available.'},
 other: {label:'Other / Previous programmes', description:'Existing campaigns outside the three current inventory categories.'},
};
const norm = v => String(v || '').split('?')[0].replace(/\/+$/, '').trim().toLowerCase();
// Internal mailbox domains (mirror of src/lib/company.ts INTERNAL_DOMAINS; this file is
// plain JS shared with the Outreach feed, so it cannot import the TS helper).
const INTERNAL_DOMAINS=['ortus.solutions','linkedvelocity.com','ortusclub.com','klabber.co','lotuspost.fyi','lotuspost.co.uk','harbourpost.co.uk','northgatemail.co.uk','oakfieldmail.co.uk','industrial-renaissance-summit.com','islandcorrespondence.lol'];
const companyEmail = e => { const v=String(e||'').toLowerCase(); return INTERNAL_DOMAINS.some(d=>v.endsWith('@'+d)); };
// The inventory page's grouping (admin/inventory-v2 canonicalStatus), so the
// maturing categories agree with the Construction / Available groups the operator
// sees there. An account with status 'unavailable' whose owner has not onboarded
// is Construction in the inventory, and must be Construction here too (Sam,
// 2026-11-08: "all of these accounts are in construction of inventory").
export function inventoryGroup(a, app) {
 const onboarded = !!app && (app.status === 'onboarded' || !!app.onboardedAt);
 if (a.status === 'retired' || a.status === 'removed') return 'Inaccessible';
 if (a.status !== 'rented' && app && !app.paidAt) return 'Initial';
 if (a.restrictedAt || a.status === 'maintenance') return 'Maintenance';
 if (a.status === 'rented') return 'Rented';
 if (app && !onboarded) return 'Construction';
 if (a.status === 'construction_immature' || a.status === 'under_construction') return onboarded ? 'Construction' : 'Initial';
 if (a.status === 'available') return a.twoFactorResetNeeded ? 'Maintenance' : 'Available';
 if (a.status === 'trial') return 'Trial';
 if (!a.loginEmail || !companyEmail(a.loginEmail) || (a.hasPassword === false)) return 'Initial';
 return onboarded ? 'Construction' : 'Initial';
}
// Level 4 · Maturing in the pipeline (pipeline-model levelOf === 4): QC passed
// (verifiedAt), application received, not onboarded/rejected/unreachable, no setup
// session in progress, and not already earning inventory with its setup fee paid.
export function pipelineMatcher(apps, sessions) {
 const byId = new Map(apps.map(a=>[a.id,a]));
 const unique = (key,value) => { const found=apps.filter(a=>key(a)===value); return value && found.length===1?found[0]:null; };
 return a => {
  const links=sessions.filter(s=>s.accountId===a.id);
  const ids=[...new Set(links.map(s=>s.applicationId))];
  const owner=(a.notes||'').match(/Owner:\s*(\S+@\S+)/i)?.[1]?.replace(/[.,;]+$/, '').toLowerCase();
  const app=ids.length===1?byId.get(ids[0]):ids.length>1?null:unique(x=>norm(x.linkedinUrl),norm(a.linkedinUrl))||unique(x=>String(x.email||'').toLowerCase(),owner);
  const pipeline=!!app?.verifiedAt && app.applicationReceived!==false
   && !['onboarded','rejected','unreachable'].includes(app.status)
   && !sessions.some(s=>s.applicationId===app.id&&['reserved','needs_help','ready'].includes(s.state))
   && !(app.paidAt&&['available','rented','trial'].includes(a.status));
  return {app:app||null,pipeline};
 };
}
// Primary category (one value): the inventory group first, then the pipeline.
export function categoryResolver(apps, sessions) {
 const match=pipelineMatcher(apps,sessions);
 return a => {
  const {app,pipeline}=match(a);
  const group=inventoryGroup(a,app);
  if(group==='Construction')return 'construction';
  if(group==='Available')return 'available';
  return pipeline?'pipeline':'other';
 };
}
// Every category an account belongs to. The Outreach board lists an account under
// each: a construction account whose application is in the pipeline hold shows in
// Pipeline Maturing AND Construction, so the Pipeline section matches the Admin
// "Level 4 · Maturing" list and Construction matches the inventory (Sam, 2026-11-08).
export function categoriesResolver(apps, sessions) {
 const match=pipelineMatcher(apps,sessions);
 return a => {
  const {app,pipeline}=match(a);
  const out=new Set();
  const group=inventoryGroup(a,app);
  if(group==='Construction')out.add('construction');
  if(group==='Available')out.add('available');
  if(pipeline)out.add('pipeline');
  return out.size?[...out]:['other'];
 };
}
const stage=(id,fromDay,toDay,warmDaily,coldDaily)=>({id,name:id,fromDay,toDay,warmDaily,coldDaily,likesDaily:0});
export function programStages(category, recentlyRestricted=false) {
 if(recentlyRestricted||category==='pipeline')return [stage('Warm',1,4,2,0),stage('Warm ramp',5,9,5,0),stage('Warm build',10,14,8,0),stage('Introduce cold',15,21,5,4),stage('Cold ramp',22,35,3,8)];
 if(category==='construction')return [stage('Warm',1,3,5,0),stage('Warm ramp',4,7,8,0),stage('Warm build',8,10,12,0),stage('Introduce cold',11,17,8,4),stage('Cold ramp',18,35,5,8)];
 return [stage('Warm',1,2,10,0),stage('Warm ramp',3,5,18,0),stage('Warm build',6,7,25,0),stage('Introduce cold',8,14,10,8),stage('Cold ramp',15,28,5,15)];
}
