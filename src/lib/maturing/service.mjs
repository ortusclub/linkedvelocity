import {sheetRows,workspaceProfiles} from './sources.mjs';
import {DEFAULT_MATURE_COLD_SHEET_URL} from './shared/mature-cold-pool.mjs';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { visible, eligible, preparePlan, linkedVelocityWarmPool, OWNER } from './model.mjs';
export class MaturingError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export async function engine(path, body) {
  const token=process.env.MATURING_ENGINE_TOKEN;
  const base=process.env.MATURING_ENGINE_URL || 'https://scraper.ortusclub.com';
  if(!token)throw new MaturingError('Profile maturing is not connected to the cloud engine yet.',503);
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(25000)});
  const data=await r.json().catch(()=>null);
  if(!r.ok || data?.error)throw new MaturingError(data?.error || 'The cloud engine is unavailable. Please retry.',r.status===404?404:502);
  return data;
}
export async function accounts(db=prisma) {
  // `unavailable` here means "not maturable" and covers ONLY the maintenance
  // status. Accounts with status 'unavailable' (not listed for rent, but fine to
  // warm up) CAN be matured — maturing is exactly what you do to an account that
  // isn't rental-ready yet, so they must appear in the picker and be startable.
  const rows=await db.linkedInAccount.findMany({where:{status:{not:'removed'}},select:{id:true,gologinProfileId:true,gologinAccount:true,loginEmail:true,linkedinName:true,linkedinUrl:true,connectionCount:true,status:true,restrictedAt:true,permanentlyRestricted:true,notes:true,rentals:{where:{status:{in:['active','pending_access','payment_failed']}},select:{id:true},take:1}}});
  return rows.filter(a=>!(a.notes||'').includes('[SHOWCASE]')).map(a=>({id:a.id,gologinProfileId:a.gologinProfileId,name:a.linkedinName,loginEmail:a.loginEmail,linkedinUrl:a.linkedinUrl,connections:a.connectionCount,workspace:a.gologinAccount==='klabber'?'linkedvelocity':'ortus',rented:a.status==='rented'||a.rentals.length>0,restricted:!!a.restrictedAt||a.permanentlyRestricted||a.status==='retired',removed:a.status==='removed',unavailable:a.status==='maintenance'}));
}
export async function owned(id){
  if(!/^[\w-]{1,100}$/.test(id))throw new MaturingError('Invalid campaign ID.');
  const d=await engine('/api/campaign/'+id);
  if(!visible(d.campaign))throw new MaturingError('Maturing plan not found.',404);
  return d;
}
export function summary(c){return {id:c.id,name:c.name,status:c.status,profileIds:c.profile_ids||[],createdAt:c.created_at,updatedAt:c.updated_at,live:!!c.live,kind:c.config?.matureKind||(c.name?.endsWith(' · Cold')?'cold':'warm')};}
export async function list(){
  // Load our own inventory and the engine's campaigns independently: a cloud-engine
  // outage must not blank the whole page. If the engine fails we still return the
  // account list plus an engineError flag so the UI can show a soft banner and stay
  // usable, instead of surfacing a raw "timeout exceeded when trying to connect".
  const [inventory,data]=await Promise.all([
    accounts(),
    engine('/api/campaign/list').catch(e=>({__error:e instanceof Error?e.message:String(e)})),
  ]);
  if(data&&data.__error)return {accounts:inventory,campaigns:[],engineError:data.__error,updatedAt:new Date().toISOString()};
  return {accounts:inventory,campaigns:(data.campaigns||[]).filter(visible).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).map(summary),updatedAt:new Date().toISOString()};
}
export async function detail(id){
  const d=await owned(id),c=d.campaign;
  const completed=c.status==='done'?await engine(`/api/campaign/${id}/leads?limit=2000`):null;
  return {...summary(c),connectionLeads:completed?.leads||null,plan:c.config?.maturePlan||null,schedule:c.config?.dailySchedule||null,timezone:c.config?.tz||'',scheduledAt:c.scheduled_start_at||null,acceptDueAt:c.matureAcceptDueAt||null,liveStamp:d.liveStamp||null,counts:d.leadCounts||{},logs:d.monitorLog||[],live:!!d.live,acceptPending:c.matureAcceptPending||0,blocks:c.matureAccountBlocks||[],resumeAt:c.resumeTaskDueAt||c.scheduled_start_at||null,monitorError:c.monitor_check_error||'',liveProgress:d.liveProgress||null};
}
export async function control(id, action){
  if(!['pause','resume','stop','check'].includes(action))throw new MaturingError('Unknown action.');
  const d=await owned(id),c=d.campaign;
  if(['resume','check'].includes(action)){
    const inventory=await accounts();
    if(!(c.profile_ids||[]).length || !c.profile_ids.every(id=>eligible(inventory.find(a=>a.gologinProfileId===id))))throw new MaturingError('This account is rented, restricted, removed, or unavailable.');
  }
  if(action==='resume'){
    const startAt=c.config?.dailySchedule?.startAt;
    return engine(`/api/campaign/${id}/${c.status==='paused'?'resume':'restart'}`,{fromStart:false,...(Date.parse(startAt)>Date.now()?{startAt}:{})});
  }
  return engine(`/api/campaign/${id}/${action==='check'?'check-now':action==='pause'?'stop?pause=1':'stop?immediate=1'}`,{});
}
export async function workbook(id, params){
  await owned(id);
  const query=new URLSearchParams({offset:String(Math.max(0,Math.floor(Number(params.get('offset'))||0))),q:(params.get('q')||'').slice(0,200),status:params.get('status')||''});
  return engine(`/api/maturing/workbook/${id}?${query}`);
}
export async function start(input, actor){
  if(input.plan?.warmEnabled!==false&&input.plan?.warmPool!=='linkedvelocity_owned')throw new MaturingError('Warm campaigns can only use eligible LinkedVelocity profiles.');
  if(!/^[\w-]{16,80}$/.test(input.launchId||'') || typeof input.accountId!=='string')throw new MaturingError('Invalid launch request.');
  // Cross-instance lock: a double click or two admins cannot launch overlapping plans.
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`maturing:${input.accountId}`}))`;
    const inventory=await accounts(tx),account=inventory.find(a=>a.id===input.accountId);
    if(!eligible(account))throw new MaturingError('Account is not eligible for maturing.');
    const live=await engine('/api/campaign/list');
    const prior=(live.campaigns||[]).filter(c=>(c.profile_ids||[]).includes(account.gologinProfileId));
    const prefix='lv_'+createHash('sha256').update(input.accountId+':'+input.launchId).digest('hex').slice(0,24);
    const replay=prior.filter(c=>c.id===prefix+'_warm'||c.id===prefix+'_cold');
    if(replay.length){
      const expected=Number(input.plan?.warmEnabled!==false)+Number(input.plan?.coldEnabled===true);
      if(replay.length!==expected || replay.some(c=>['cancelled','error'].includes(c.status)))throw new MaturingError('This launch was incomplete or stopped. Inspect its results, then create a new replacement plan.',409);
      return {ok:true,campaigns:replay.map(summary),replayed:true};
    }
    if(prior.some(c=>!['done','cancelled','error'].includes(c.status)))throw new MaturingError('This profile already has a campaign. Stop its current plan before starting a replacement.',409);
    const excluded=[];
    for(const c of prior){
      if(!visible(c))throw new MaturingError('This account has campaign history in another workspace. Review it in Outreach before replacing its plan.',409);
      let offset=0;
      while(true){
        const page=await engine(`/api/maturing/workbook/${c.id}?offset=${offset}`);
        for(const row of page.rows||[])if(row.sentAt||row.requestStatus||row.status!=='pending')excluded.push(row.url);
        offset+=(page.rows||[]).length;
        if(offset>=page.total)break;
        if(!page.rows?.length)throw new MaturingError('Could not verify previous recipients; retry before starting.',502);
      }
    }
    if(input.plan?.targetProfileIds?.[0]!==account.gologinProfileId)throw new MaturingError('The selected profile no longer matches this account. Reopen the editor.');
    const sources=await poolSources(inventory,true);
    const coldRows=input.plan?.coldEnabled?await sheetRows(input.plan.coldPoolSource==='default'?DEFAULT_MATURE_COLD_SHEET_URL:input.plan.coldPool):null;
    const stages=preparePlan(input,account,inventory,excluded,new Date(),sources,coldRows);
    const created=[];
    try{
      for(const stage of stages){
        const id=prefix+'_'+stage.kind;
        await engine('/api/campaign/start',{...stage,id,config:{...stage.config,createdBy:actor,source:'linkedvelocity-admin'}});
        created.push(id);
      }
      return {ok:true,ids:created,owner:OWNER};
    }catch(error){
      const stopped=await Promise.allSettled(created.map(id=>engine(`/api/campaign/${id}/stop?immediate=1`,{})));
      if(stopped.some(r=>r.status==='rejected'))throw new MaturingError('Plan setup was incomplete and stopping it could not be confirmed. Refresh and inspect the account before retrying.',502);
      throw error;
    }
  },{maxWait:10000,timeout:120000});
}
let sourceCache=null;
export async function poolSources(inventory,force=false){
 if(!force&&sourceCache&&Date.now()-sourceCache.at<60000)return {...sourceCache.value,lvAccounts:inventory};
 const [ortus,lv,soo]=await Promise.all([workspaceProfiles('ortus'),workspaceProfiles('linkedvelocity'),engine('/api/soo-status')]);
 const value={profiles:[...ortus,...lv],sooAccounts:soo.accounts||[],lvAccounts:inventory};
 sourceCache={at:Date.now(),value};return value;
}
export async function desktop(path,params){
 const inventory=await accounts();
 if(path==='mature/cold-source')return {url:DEFAULT_MATURE_COLD_SHEET_URL};
 if(path==='mature/lv-identities')return {accounts:inventory};
 if(path==='profiles')return inventory.filter(a=>a.gologinProfileId===params.get('profileId')).map(a=>({id:a.gologinProfileId,name:a.loginEmail,account:'linkedvelocity',available:eligible(a)}));
 if(path==='soo-status')return {accounts:(await engine('/api/soo-status')).accounts||[]};
 if(path==='mature/warm-pool'){
   if(params.get('pool')!=='linkedvelocity_owned')throw new MaturingError('Only eligible LinkedVelocity profiles are available for warm campaigns.');
   const sources=await poolSources(inventory);
   const {targets,...counts}=linkedVelocityWarmPool(sources,(params.get('exclude')||'').split(','));
   return {...counts,ready:targets.length};
 }
 throw new MaturingError('Not found.',404);
}
