// One classification for the board and automatic enrolment. Inventory status wins:
// an account under construction is Construction and an available one is Available
// whatever its application says; Pipeline is for everything else with a live
// Level-4 application (Sam, 2026-11-08 — "if they are in construction they go in
// the Construction section").
export const PROGRAMS = {
 pipeline: {label:'Pipeline Maturing', description:'Pre-payout weed-out — 10/day from day 1 (50:50), the stress test before we pay.'},
 construction: {label:'Construction', description:'Paid, building to rentable — gentler warm-lean ramp (60:40, 6–8/day).'},
 available: {label:'Available', description:'Rentable upkeep — low-volume ~5/day to keep it active.'},
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
// Per-stage maturing ramps (Ardi/Sam design, 2026-11-12). The guiding rule is the
// OPPOSITE of babying everything: push HARD before we pay (the weed-out — a weak
// account should restrict HERE, before we invest), then go GENTLE once paid (a
// restriction on a paid account is our loss). `recovered` (a restriction in the last
// 30 days) overrides the stage with a fragile re-warm. Daily = warm + cold; "warm" =
// our own LV network (high accept), "cold" = external leads.
/**
 * @param {string} category
 * @param {boolean} [recovered]
 * @param {number|null} [connections]
 */
export function programStages(category, recovered=false, connections=null) {
 // Recovered: fragile. Re-warm gently and warm-heavy (~80:20) to rebuild trust
 // signals before any real cold, ramping back toward a normal mix over ~2 weeks.
 // A re-restriction here is the expensive loss.
 if(recovered)return [stage('Re-warm',1,7,2,0),stage('Re-warm ramp',8,21,3,1)];
 // Pre-payout (Level 4, pre-onboarding): go hard from day 1 — 10/day flat, 50:50 —
 // the weed-out, ~1-2 weeks until the setup fee is paid. A 0-connection account has
 // no real network to warm into yet, so it starts cold-only.
 if(category==='pipeline')return connections===0
  ? [stage('Weed-out · cold-only',1,14,0,10)]
  : [stage('Weed-out',1,14,5,5)];
 // Construction (paid, building to rentable): warm-lean 60:40, 6→8/day. Gentler — a
 // restriction here is our loss. Runs to the rentable bar, then upkeep.
 if(category==='construction')return [stage('Build',1,7,4,2),stage('Build ramp',8,45,5,3)];
 // Rentable (ready inventory): low-volume ~5/day upkeep, roughly 50:50 — already
 // passed, cold keeps it looking active.
 return [stage('Upkeep',1,60,3,2)];
}

// Plain-words name for the ramp an account is on, for the Activity timeline — so a human
// reading the log can see WHICH maturing programme it is, not just the bucket name.
/**
 * @param {string} category
 * @param {boolean} [recovered]
 * @param {number|null} [connections]
 */
export function programLabel(category, recovered=false, connections=null) {
 if(recovered) return 'gentle re-warm — recovering account, rebuilding trust slowly (2→3/day, warm-heavy)';
 if(category==='pipeline') return connections===0
  ? 'pre-payout weed-out — cold-only start (0-connection account, ~10/day)'
  : 'pre-payout weed-out — the pre-pay stress test (10/day, 50:50 warm+cold)';
 if(category==='construction') return 'construction — building the network to rentable (6→8/day, warm-lean 60:40)';
 return 'rentable upkeep — light activity to stay warm while available (~5/day, 50:50)';
}
