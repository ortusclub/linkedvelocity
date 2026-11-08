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
export function categoryResolver(apps, sessions) {
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
  if(['under_construction','construction_immature'].includes(a.status))return 'construction';
  if(a.status==='available')return 'available';
  return pipeline?'pipeline':'other';
 };
}
// Every category an account belongs to. The Outreach board lists an account under
// each: a construction account whose application is in the pipeline hold shows in
// Pipeline Maturing AND Construction, so the Pipeline section matches the Admin
// "Maturing" card and Construction matches the inventory (Sam, 2026-11-08).
export function categoriesResolver(apps, sessions) {
 const primary=categoryResolver(apps,sessions);
 const resolvedPipeline=categoryResolver(apps,sessions);
 return a => {
  const out=new Set();
  const p=primary(a); if(p!=='other')out.add(p);
  // Pipeline membership regardless of status: re-run the resolver as if the
  // account had no inventory status, so only the application rule decides.
  if(resolvedPipeline({...a,status:'__none__'})==='pipeline')out.add('pipeline');
  return out.size?[...out]:['other'];
 };
}
const stage=(id,fromDay,toDay,warmDaily,coldDaily)=>({id,name:id,fromDay,toDay,warmDaily,coldDaily,likesDaily:0});
export function programStages(category, recentlyRestricted=false) {
 if(recentlyRestricted||category==='pipeline')return [stage('Warm',1,4,2,0),stage('Warm ramp',5,9,5,0),stage('Warm build',10,14,8,0),stage('Introduce cold',15,21,5,4),stage('Cold ramp',22,35,3,8)];
 if(category==='construction')return [stage('Warm',1,3,5,0),stage('Warm ramp',4,7,8,0),stage('Warm build',8,10,12,0),stage('Introduce cold',11,17,8,4),stage('Cold ramp',18,35,5,8)];
 return [stage('Warm',1,2,10,0),stage('Warm ramp',3,5,18,0),stage('Warm build',6,7,25,0),stage('Introduce cold',8,14,10,8),stage('Cold ramp',15,28,5,15)];
}
