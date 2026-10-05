import {resultSummary,normalizeResult} from './results.js';
import {activeJob,renderHistory} from './history-view.js';
const el=id=>document.getElementById(id);
let page=null,tabId=null,user=null,latest=null,jobs=[],busy=false,polling=false,readyAt=0;
const allowed=()=>user?.verified===true&&user.enabled_account===true&&!!user.plan&&user.plan.trim().toLowerCase()!=='free';
function access(){el('verityScan').hidden=!allowed();el('verityHistory').hidden=!allowed();if(!allowed()){jobs=[];latest=null;el('verityOverview').hidden=true;renderHistory(el('verityHistoryItems'),[]);}}
async function send(type,extra={}){const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok){if(r?.code==='AUTH_REQUIRED'){user=null;access();}throw new Error(r?.error||'Could not complete this request.');}return r;}
function message(value){el('verityProgress').textContent=value;}
function countdown(){const seconds=Math.max(0,Math.ceil((readyAt-Date.now())/1000));el('verityWait').textContent=!page?'Open or reload a public website to analyze its policy.':page.loading?'Waiting for the website to finish loading…':seconds?`Observing this visit — ready in ${seconds} seconds.`:'Ready to analyze this visit.';el('verityStart').disabled=!allowed()||!page||page.loading||seconds>0||busy||jobs.some(activeJob);}
function choose(){const other=el('verityPolicyChoice').value==='other';el('verityCustomPolicy').hidden=!other;el('verityPolicyUrl').required=other;}
function renderJobs(){
 renderHistory(el('verityHistoryItems'),jobs);
 const siteJobs=jobs.filter(j=>j.site===page?.origin).sort((a,b)=>b.createdAt-a.createdAt);latest=siteJobs.find(j=>j.state==='complete')||null;el('verityOverview').hidden=!latest;
 if(latest){el('verityOverviewSummary').textContent=resultSummary(latest.result);const confidence=normalizeResult(latest.result).analysis?.overall_confidence;el('verityScore').textContent=typeof confidence==='number'&&confidence>=0&&confidence<=1?`${Math.round(confidence*100)}% model confidence`:'Confidence score unavailable';el('verityScoreNote').textContent='Model confidence is not a privacy or safety rating.';}
 const current=siteJobs[0];if(current?.state==='failed')message(current.error||'Analysis failed. Try again.');else if(current&&activeJob(current))message(current.error|| (current.state==='preparing'?'Preparing the recorded observations…':'Analyzing the policy… You can close this popup and return to check progress.'));else if(latest)message('Analysis ready.');countdown();
}
async function loadPage(){
 const previous=el('verityPolicyChoice').value, previousVisit=page?.visitId;
 try{page=await send('VERITY_PAGE',{tabId});}catch(e){page=null;countdown();throw e;}
 readyAt=Date.now()+page.waitMs;el('veritySite').textContent=page.hostname;
 const select=el('verityPolicyChoice');select.replaceChildren();select.add(new Option(page.policies?.length?'Choose a privacy policy':'No policy link found',''));
 for(const url of page.policies||[])select.add(new Option(url,url));select.add(new Option('Other URL — enter a policy link','other'));
 select.value=(!previousVisit||previousVisit===page.visitId)&&[...select.options].some(o=>o.value===previous)?previous:'';
 if(!page.policies?.length)select.value='other';if(previousVisit&&previousVisit!==page.visitId){el('verityPolicyUrl').value='';el('verityConsent').checked=false;}choose();countdown();
}
export async function refreshVerityAccount(){if(busy)return;busy=true;try{
 user=(await send('VERITY_ACCOUNT')).user;
 el('verityAccountStatus').textContent=!user?'Sign in to use Verity.':!user.verified?'Verify your email to use Verity.':!user.enabled_account?'Your account is disabled.':`${user.plan} · Email verified`;
 el('verityVerify').hidden=!user||user.verified;el('verityManage').hidden=allowed();el('verityManage').textContent=!user?'Sign in / create account':!user.verified?'Manage account':user.plan.toLowerCase()==='free'?'View plans':'Manage account';access();
 if(!allowed())return;
 jobs=(await send('VERITY_JOBS')).jobs||[];renderJobs();
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});tabId=tab?.id;await loadPage();renderJobs();
 }catch(e){message(e.message);}finally{busy=false;countdown();}void poll();}
async function poll(){if(polling||!allowed()||el('verityView').hidden)return;polling=true;try{
 jobs=(await send('VERITY_JOBS')).jobs||[];
 for(const job of jobs.filter(j=>['queued','running'].includes(j.state))){const r=await send('VERITY_POLL',{id:job.id});if(r.job)Object.assign(job,r.job);}
 renderJobs();if(!busy)try{await loadPage();}catch(e){message(e.message);}
 }catch(e){message(e.message);}finally{polling=false;countdown();}}
el('verityPolicyChoice').addEventListener('change',choose);
el('verityScan').addEventListener('submit',async event=>{
 event.preventDefault();if(el('verityStart').disabled)return;busy=true;countdown();message('Preparing observations…');
 try{const value=el('verityPolicyChoice').value,policy=value==='other'?el('verityPolicyUrl').value.trim():value;if(!policy)throw new Error('Choose a privacy policy or enter its URL.');
 await send('VERITY_START',{tabId,expectedOrigin:page.origin,expectedVisitId:page.visitId,policies:[policy],consent:el('verityConsent').checked});
 }catch(e){message(e.message);}finally{try{jobs=(await send('VERITY_JOBS')).jobs||[];renderJobs();}catch{}busy=false;countdown();}void poll();
});
el('verityRecheck').addEventListener('click',refreshVerityAccount);
el('verityManage').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('settings.html#account')}));
el('verityDetails').addEventListener('click',()=>{if(latest)void chrome.tabs.create({url:chrome.runtime.getURL('verity/index.html')+'?tabId='+encodeURIComponent(tabId)+'&jobId='+encodeURIComponent(latest.id)});});
setInterval(countdown,1000);setInterval(poll,3000);
