import { isPublicTelemetryHostname } from '../lib/core.js';
import { raw, session, request, who, accept, signOut, authRevision, maintainSession, unwrap } from './auth.js';
import { getJobs, changeJobs, updateJob } from './job-store.js';
import { policyTelemetry } from './telemetry.js';
import { normalizeResult } from './results.js';
export { unwrap };
export const VERITY_MAINTENANCE_ALARM='veilanceVerityMaintenanceV2';
const TRUSTED=['https://veilance.org','https://www.veilance.org'];
const ACTIVE=['preparing','queued','running'];
const pending=new Map(), starting=new Set();
export function observationWait(state,now=Date.now()) {const loaded=state?.loadCompletedAt;return Number.isFinite(loaded)&&loaded>0?Math.max(0,15000-(now-loaded)):15000;}
export function verified(user){return user?.verified===true;}
export function paid(user){return typeof user?.plan==='string'&&!!user.plan.trim()&&user.plan.trim().toLowerCase()!=='free'&&user.enabled_account===true&&verified(user);}
export function policyURL(value){const u=new URL(String(value));if(!['https:','http:'].includes(u.protocol)||u.username||u.password||(u.port&&!['80','443'].includes(u.port))||!isPublicTelemetryHostname(u.hostname))throw new Error('Use a public HTTP or HTTPS privacy-policy URL.');u.hash='';return u.href;}
async function websiteSignIn() {
  const expected=authRevision();
  const tabs=await chrome.tabs.query({url:TRUSTED.map(x=>x+'/*')});
  for(const tab of tabs.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))) {
    if(tab.incognito)continue;
    const results=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:()=>{
      if(!['https://veilance.org','https://www.veilance.org'].includes(location.origin))return null;
      return {access:sessionStorage.getItem('veilance_user_access_token'),refresh:sessionStorage.getItem('veilance_user_refresh_token')};
    }}).catch(()=>[]);
    const value=results[0]?.result;
    if(value?.access) { try{return await accept(value.access,value.refresh,expected);}catch{} }
  }
  throw new Error('No active website sign-in found. Sign in below or sign in on veilance.org, then try again.');
}
function checkRevision(rev){if(rev!==authRevision())throw new Error('Your account changed. Please retry.');}
async function recoverJobs(userId) {
  const list=await getJobs(userId), now=Date.now();
  for(const job of list){
    if(job.state==='preparing'&&!starting.has(userId)&&now-job.createdAt>60000)await updateJob(userId,job.id,{state:'failed',error:'This submission was interrupted before confirmation. Start a new comparison.'});
    else if(ACTIVE.includes(job.state)&&now-job.createdAt>15*60000)await updateJob(userId,job.id,{state:'failed',error:'This comparison timed out. Start a new comparison.'});
  }
  return getJobs(userId);
}
async function pollJob(user,id,rev) {
  const key=user.user_id+':'+id;
  if(pending.has(key))return pending.get(key);
  const task=(async()=>{
    const job=(await recoverJobs(user.user_id)).find(j=>j.id===id);
    if(!job)throw new Error('Comparison no longer appears in your five most recent reviews.');
    if(!['queued','running'].includes(job.state)||!job.uuid||job.retryAt>Date.now())return {job};
    try {
      const result=await request('/status',{uuid:job.uuid},{expectedRevision:rev,retainResponse:true});
      const state=String(result?.status||'').toUpperCase();
      if(['PENDING','STARTED','RETRY','RECEIVED','PROGRESS'].includes(state))return {job:await updateJob(user.user_id,id,{state:'running',error:null,retryAt:0})};
      if(['FAILURE','REVOKED'].includes(state))return {job:await updateJob(user.user_id,id,{state:'failed',error:'Verity could not complete this comparison. Please try again.'})};
      const report=normalizeResult(result);
      const meaningful=typeof report?.summary==='string'||typeof report?.analysis?.summary==='string'||Array.isArray(report?.findings)||Array.isArray(report?.results);
      if(!meaningful)return {job:await updateJob(user.user_id,id,{state:'failed',error:'The server returned no usable analysis. Please start a new comparison.'})};
      if(JSON.stringify(result).length>400000)return {job:await updateJob(user.user_id,id,{state:'failed',error:'The comparison is too large to display.'})};
      return {job:await updateJob(user.user_id,id,{state:'complete',result,error:null,completedAt:Date.now(),retryAt:0})};
    } catch(e) {
      checkRevision(rev);
      if(e.code==='AUTH_REQUIRED')throw e;
      // A transient status error must not discard the UUID or a saved sign-in.
      return {job:await updateJob(user.user_id,id,{error:e.message,retryAt:Date.now()+(e.status===429?60000:10000)})};
    }
  })();pending.set(key,task);
  try{return await task;}finally{if(pending.get(key)===task)pending.delete(key);}
}
export function createVerityService({capture,pageInfo}) {
 const handle=async(message,sender)=>{
  const allowed=['verity/index.html','plans.html','onboarding.html','popup.html','settings.html'].some(p=>{const u=chrome.runtime.getURL(p);return sender?.id===chrome.runtime.id&&(sender.url===u||sender.url?.startsWith(u+'?')||sender.url?.startsWith(u+'#'));});
  if(!allowed)throw new Error('Open Verity from the extension to continue.');
  const action=message.type;
  if(action==='VERITY_SIGNOUT'){await signOut();return {};}
  if(action==='VERITY_LOGIN'||action==='VERITY_REGISTER'){
    if(typeof message.email!=='string'||typeof message.password!=='string')throw new Error('Enter your email and password.');
    const rev=authRevision(), result=await raw(action==='VERITY_LOGIN'?'/login':'/register',{email_address:message.email,password:message.password});
    return {user:await accept(result?.access_token,result?.refresh_token,rev)};
  }
  if(action==='VERITY_WEBSITE_LOGIN')return {user:await websiteSignIn()};
  if(action==='VERITY_ACCOUNT'){
    if(!await session())return {user:null};
    try{return {user:await who()};}catch(e){if(e.code==='AUTH_REQUIRED')return {user:null};throw e;}
  }
  if(action==='VERITY_PAGE')return pageInfo(Number(message.tabId));
  const user=await who(),rev=authRevision();
  if(!verified(user))throw Object.assign(new Error('Verify your email on veilance.org before using Verity.'),{code:'VERIFICATION_REQUIRED'});
  if(!paid(user))throw Object.assign(new Error('Choose a paid plan to use Verity.'),{code:'PLAN_REQUIRED'});
  if(action==='VERITY_JOBS'){const jobs=await recoverJobs(user.user_id);checkRevision(rev);return {jobs};}
  if(action==='VERITY_POLL'){const result=await pollJob(user,message.id,rev);checkRevision(rev);return result;}
  if(action==='VERITY_START'){
    if(message.consent!==true)throw new Error('Confirm sending a redacted snapshot for this comparison.');
    const policies=[...new Set((Array.isArray(message.policies)?message.policies:[]).map(policyURL))];
    if(!policies.length||policies.length>3)throw new Error('Add between one and three privacy policies.');
    if(starting.has(user.user_id))throw new Error('A comparison is already starting.');
    starting.add(user.user_id);
    const created=[];
    try {
      const current=await recoverJobs(user.user_id);checkRevision(rev);
      if(current.some(j=>ACTIVE.includes(j.state)))throw new Error('Wait for your current comparison to finish.');
      const site=policyURL(message.expectedOrigin);
      // Save immediately, before capture or the comparison POST can fail.
      for(const policy of policies)created.push({id:crypto.randomUUID(),userId:user.user_id,policy,site:new URL(site).origin,createdAt:Date.now(),state:'preparing'});
      await changeJobs(user.user_id,jobs=>[...created,...jobs]);
      let snapshot,telemetry;
      try {snapshot=await capture(Number(message.tabId),message.expectedOrigin,message.expectedVisitId);checkRevision(rev);telemetry=policyTelemetry(snapshot.payload,snapshot.current_url);}
      catch(e){for(const job of created)await updateJob(user.user_id,job.id,{state:'failed',error:e.message});throw e;}
      for(const job of created){
        checkRevision(rev);
        try {
          const response=await request('/intel/policy/compare',{telemetry_data:telemetry,privacy_policy_url:job.policy,current_url:snapshot.current_url},{expectedRevision:rev,retainResponse:true});
          if(typeof response?.uuid!=='string'||!response.uuid||response.uuid.length>200)throw new Error('The server did not confirm a comparison job.');
          Object.assign(job,await updateJob(user.user_id,job.id,{uuid:response.uuid,state:'queued',currentUrl:snapshot.current_url,error:null}));
        }catch(e){await updateJob(user.user_id,job.id,{state:'failed',error:e.message});Object.assign(job,{state:'failed',error:e.message});}
        checkRevision(rev);
      }
      return {jobs:created};
    }finally{starting.delete(user.user_id);}
  }
  throw new Error('Unknown Verity action.');
 };
 handle.initialize=async()=>{
   await session();
   if(chrome.alarms)await chrome.alarms.create(VERITY_MAINTENANCE_ALARM,{delayInMinutes:1,periodInMinutes:1});
 };
 handle.maintenance=async()=>{
   await maintainSession();if(!await session())return;
   const user=await who(),rev=authRevision();if(!paid(user))return;
   for(const job of await recoverJobs(user.user_id))if(['queued','running'].includes(job.state))await pollJob(user,job.id,rev);
 };
 return handle;
}
