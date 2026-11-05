import {selectMatureColdLeads,DEFAULT_MATURE_COLD_SHEET_URL} from './shared/mature-cold-pool.mjs';
import { finishedMaturingMetrics, groupMaturingAccounts, maturingNextAction, maturingBatchDone, maturingRowState } from './shared/mature-profile-board.mjs';
import { buildWarmPool, matureWarmSchedule, matureColdSchedule, buildMatureTabRows, MATURE_TAB_HEADER } from './shared/mature-warm-pool.mjs';
import { maturePlanErrors, restoreMaturePlan } from './shared/mature-profile-plan.mjs';
export const OWNER = 'info@linkedvelocity.com';
export function visible(c) {
  return !!(c?.maturing || c?.config?.matureWarm) && /^[^@\s]+@linkedvelocity\.com$/i.test(String(c.owner || '').trim());
}
export function eligible(a) { return !!a?.gologinProfileId && !a.rented && !a.restricted && !a.removed && !a.showcase && !a.unavailable; }
export function urlKey(url) { return String(url || '').toLowerCase().replace(/^https?:\/\/(?:[a-z]+\.)?linkedin\.com\/in\//, '').replace(/[/?#].*$/, ''); }
export function profileUrl(url) { return /^https:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/[^\s/?#]+\/?(?:\?.*)?$/i.test(String(url || '')); }
export function linkedVelocityWarmPool(sources,excludeProfileIds=[]){
  const lvAccounts=(sources.lvAccounts||[]).filter(eligible);
  const ids=new Set(lvAccounts.map(a=>a.gologinProfileId));
  const profiles=(sources.profiles||[]).filter(p=>p.account==='linkedvelocity'&&ids.has(p.id));
  return buildWarmPool({pool:'linkedvelocity_owned',profiles,lvAccounts,excludeProfileIds});
}
export function preparePlan(input, account, accounts, excluded = [], now = new Date(), sources = null, coldRows = null) {
  if(!input.plan || input.plan.version!==1 || !Array.isArray(input.plan.stages))throw Error('Invalid maturing plan.');
  if(input.plan.warmEnabled!==false && input.plan.warmPool!=='linkedvelocity_owned')throw Error('Warm campaigns can only use eligible LinkedVelocity profiles.');
  const plan = restoreMaturePlan(input.plan);
  plan.targetProfileIds = [account.gologinProfileId];

  const identity=plan.accounts?.[account.gologinProfileId];
  account={...account,name:String(identity?.name ?? account.name ?? '').trim(),linkedinUrl:String(identity?.linkedinUrl ?? account.linkedinUrl ?? '').trim()};

  // Cold input is validated independently below; the shared validator expects a sheet URL.
  const errors = maturePlanErrors(plan,{defaultColdPoolUrl:DEFAULT_MATURE_COLD_SHEET_URL});
  if (errors.length) throw Error(errors[0]);
  if (!eligible(account)) throw Error('This account is rented, restricted, removed, or has no browser profile.');
  if (!profileUrl(account.linkedinUrl)) throw Error('Enter a valid LinkedIn profile URL for this account.');
  if (!account.loginEmail) throw Error('Set the account login email in Inventory first.');
  if (plan.stages.length > 20 || plan.stages.some(s => s.toDay > 365 || s.warmDaily > 100 || s.coldDaily > 100 || s.likesDaily > 0)) throw Error('Use up to 20 stages, within 365 days and 100 connections per activity per day. Post engagement is not supported.');
  const timezone = input.timezone || 'Europe/Rome';
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const field=k=>parts.find(p=>p.type===k).value;
  const startDate=`${field('year')}-${field('month')}-${field('day')}`;
  const warmAmounts=matureWarmSchedule(plan,startDate), cold=matureColdSchedule(plan);
  const seen=new Set([...excluded,account.linkedinUrl].map(urlKey));
  let warmTargets=accounts.filter(a=>eligible(a)&&a.workspace==='linkedvelocity'&&a.gologinProfileId!==account.gologinProfileId&&profileUrl(a.linkedinUrl)).filter(a=>{const k=urlKey(a.linkedinUrl);if(seen.has(k))return false;seen.add(k);return true;}).map(a=>({name:a.name,linkedinUrl:a.linkedinUrl,profile:a.loginEmail,profileId:a.gologinProfileId}));
  if(sources)warmTargets=linkedVelocityWarmPool(sources,[account.gologinProfileId]).targets.filter(t=>!excluded.map(urlKey).includes(urlKey(t.linkedinUrl)));
  for(let i=warmTargets.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[warmTargets[i],warmTargets[j]]=[warmTargets[j],warmTargets[i]];}
  const managed=new Set(accounts.map(a=>urlKey(a.linkedinUrl)));
  let coldLeads=[];
  for(const line of String(input.coldUrls||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)){
    if(!profileUrl(line)) throw Error('Cold recipients must be one LinkedIn profile URL per line.');
    const k=urlKey(line);if(seen.has(k)||managed.has(k))continue;seen.add(k);coldLeads.push({name:'',linkedinUrl:line});
  }
  if(coldRows&&cold) coldLeads=selectMatureColdLeads({plan,rows:coldRows,excludedUrls:[...excluded,account.linkedinUrl,...(sources?buildWarmPool({pool:'all_available',...sources}).targets.map(t=>t.linkedinUrl):accounts.map(a=>a.linkedinUrl))],urlOf:row=>Object.values(row).find(v=>profileUrl(v))||''}).leads;
  if(plan.warmEnabled && (!warmAmounts[0] || !warmTargets.length)) throw Error('No eligible warm recipients, or no warm connections scheduled on day one.');
  if(plan.coldEnabled && (!cold || !coldLeads.length)) throw Error('Add cold recipients and a positive cold daily amount.');
  const rows=buildMatureTabRows({startDate,warmTargets:plan.warmEnabled?warmTargets:[],warmAmounts,coldLeads,cold});
  const stages=[];
  for(const kind of ['warm','cold']) {
    if(!(kind==='warm'?plan.warmEnabled:plan.coldEnabled))continue;
    const amounts=kind==='warm'?warmAmounts:cold.amounts;
    const startAt=new Date(now.getTime()+(kind==='cold'?cold.delayDays:0)*86400000).toISOString();
    const stageDate=kind==='warm'?startDate:new Date(Date.parse(startDate+'T12:00:00Z')+cold.delayDays*86400000).toISOString().slice(0,10);
    stages.push({kind, name:account.loginEmail+(kind==='cold'?' · Cold':''),mode:'connect_only',owner:OWNER,profileIds:[account.gologinProfileId],dailyLimit:amounts[0],startAt,
      config:{matureWarm:true,matureKind:kind,maturePlan:plan,warmPool:plan.warmPool,glAccount:account.workspace,dailyCounterScope:kind,dailySchedule:{startDate:stageDate,startAt,amounts},tz:timezone,
        maturedAccount:{name:account.name,profileUrl:account.linkedinUrl},accountEmails:{[account.gologinProfileId]:account.loginEmail},linkedinColumn:'LinkedIn URL',sheetsWebappUrl:'',identityGateEnabled:true,autoChecksEnabled:true},
      leads:rows.filter(r=>r[0].toLowerCase()===kind).map(r=>({leadUrl:r[2],fullName:r[1],row:Object.fromEntries(MATURE_TAB_HEADER.map((h,i)=>[h,r[i]]))}))});
  }
  return stages;
}
export function boardItem(c){
 const st=c.status;
 return {id:c.id,name:c.name,startedAt:Date.parse(c.createdAt)||0,finishedAt:c.status==='done'?Date.parse(c.updatedAt)||0:0,durationEstimated:true,connectionLeads:c.connectionLeads||null,matureKind:c.kind,warmSchedule:c.schedule,matureTz:c.timezone||'',
 bucket:['running','monitoring','paused','stopping','pausing','waiting_daily_reset','needs_review'].includes(st)?'running':['pending','queued','scheduled'].includes(st)?'queued':'done',
 bad:['cancelled','error'].includes(st),dailyWait:st==='waiting_daily_reset',paused:['paused','pausing'].includes(st),stopping:['stopping','pausing'].includes(st),needsReview:st==='needs_review',
 engineStatus:st,liveProgress:c.liveProgress,liveStamp:c.liveStamp,live:c.live,scheduledAt:c.scheduledAt,resumeAt:c.resumeAt,
 accountBlocks:c.blocks||[],acceptPending:c.acceptPending||0,acceptDueAt:c.acceptDueAt,batchDoneToday:maturingBatchDone(c.logs),log:c.logs||[],
 sent:Math.max(0,Number(c.counts?.sent||0)-Number(c.counts?._preActioned||0))};
}
export function boardState(c){
 if(!c)return {label:'Not started',group:'Not started'};
 const state=maturingRowState(boardItem(c));
 return {...state,group:state.label==='Finished'?'Finished':state.label==='Restricted'?'Restricted':/Suspected login needed/i.test(state.label)?'Suspected login needed':state.label==='Possible weekly limit'?'Possible weekly limit':'Active'};
}
export function accountState(campaigns){
 const g=groupMaturingAccounts(campaigns.map(boardItem))[0];
 if(!g)return {label:'Not started',group:'Not started'};
 const state=g.state.label==='Starting'?{...g.state,label:'Waiting in queue'}:g.state;
 return {...state,group:state.label==='Finished'?'Finished':state.label==='Restricted'?'Restricted':/Suspected login needed/i.test(state.label)?'Suspected login needed':state.label==='Possible weekly limit'?'Possible weekly limit':'Active'};
}
export const nextAction=c=>['queued','pending'].includes(c.status)&&!c.scheduledAt?'Waiting in queue · no worker assigned yet':maturingNextAction(boardItem(c));

export function finishedMetrics(campaigns){const group=groupMaturingAccounts(campaigns.map(boardItem))[0];return group?finishedMaturingMetrics(group):{connections:null,duration:'—'};}
