import {renderResult, analyzedPolicy, normalizeResult} from './privacy-results.js';
const $=id=>document.getElementById(id);
const tabId=Number(new URLSearchParams(location.search).get('tabId'));
const selectedJob=new URLSearchParams(location.search).get('jobId');
const historyOnly=new URLSearchParams(location.search).get('history')==='1';
const isPlans=location.pathname.endsWith('/plans.html');
let user=null,page=null,busy=false,polling=false,waitUntil=0,jobList=[];
const labels={matched:'Matches the policy',partially_matched:'Partly matches',observed_only:'Observed, not found in the policy',policy_only:'Disclosed, not observed',contradiction:'Possible contradiction',contradictions:'Possible contradiction',indeterminate:'Not enough evidence'};
async function send(type,extra={}){const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok){if(r?.code==='VERIFICATION_REQUIRED'){if(user)user.verified=false;jobList=[];renderAccess();}if(r?.code==='PLAN_REQUIRED')location.href=chrome.runtime.getURL('plans.html');throw new Error(r?.error || 'Veilance could not complete this request.');}return r;}
function status(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
function paid(){return user?.verified === true && user?.enabled_account && typeof user.plan==='string' && user.plan.toLowerCase()!=='free';}
function renderAccess(){ $('plans').querySelector('h2').textContent='Choose a plan to use Verity'; $('plans').querySelector('p').textContent='The Veilance extension stays free. Premium adds policy comparisons and other intelligence tools.'; $('account').hidden=!!user; $('signout').hidden=!user; $('verification').hidden=!user || user.verified === true; $('plans').hidden=paid() || !user || user.verified !== true; $('workspace').hidden=isPlans||historyOnly||!!selectedJob||!paid();$('reviewHistory').hidden=isPlans||!paid(); $('results').hidden=historyOnly||!paid()||(!jobList.length&&!selectedJob); if(paid()&&isPlans){$('plans').hidden=false;$('plans').querySelector('h2').textContent='Your '+user.plan+' access is active';$('plans').querySelector('p').textContent='Open any public website, then choose Verity → Analyze this website from the Veilance popup.';} }
async function account(auto=false){try{const r=await send('VERITY_ACCOUNT');user=r.user;if(!user&&auto){try{user=(await send('VERITY_WEBSITE_LOGIN')).user;}catch{}}renderAccess();status(user?`Signed in as ${user.email || 'your Veilance account'} · ${user.plan}`:'Sign in to compare privacy policies.');if(user?.verified===true&&!paid()&&!isPlans){location.href=chrome.runtime.getURL('plans.html');return;}if(paid()){await loadJobs();if(!isPlans&&!historyOnly&&!selectedJob)await loadPage();}}catch(e){status(e.message,true);}}
async function loadPage(){if(!Number.isInteger(tabId)||tabId<=0){$('noPage').hidden=false;return;}try{page=await send('VERITY_PAGE',{tabId});$('site').textContent=page.hostname;waitUntil=Date.now()+page.waitMs;const select=$('policyChoice'), previous=select.value;select.replaceChildren();
const prompt=document.createElement('option');prompt.value='';prompt.textContent=page.policies?.length?'Choose a policy found on this page':'No privacy policy link found';select.append(prompt);
for(const url of page.policies||[]){const o=document.createElement('option');o.value=url;o.textContent=url;select.append(o);}
const other=document.createElement('option');other.value='other';other.textContent='Other URL — enter a policy link';select.append(other);
select.value=[...select.options].some(o=>o.value===previous)?previous:'';
if(!page.policies?.length)select.value='other';choosePolicy();$('noPage').hidden=true;renderJobs();countdown();}catch(e){page=null;status(e.message,true);countdown();}}
function countdown(){const remaining=Math.max(0,Math.ceil((waitUntil-Date.now())/1000));$('wait').textContent=!page?'Open a website to begin.':page.loading?'Waiting for the website to finish loading…':remaining?`Observing the page — ready in ${remaining} seconds.`:'Ready to compare. Review the policy URL below.';$('start').disabled=!page||page.loading||remaining>0||busy||jobList.some(j=>['queued','running'].includes(j.state));}
function text(parent,tag,value,className){if(typeof value!=='string'&&typeof value!=='number')return;const e=document.createElement(tag);e.textContent=String(value).slice(0,50000);if(className)e.className=className;parent.append(e);return e;}
let renderedJobs = '';
function renderHistory(){
 const root=$('historyItems');root.replaceChildren();
 const reviews=jobList.filter(j=>j.state==='complete').sort((a,b)=>(b.reviewedAt||b.createdAt||0)-(a.reviewedAt||a.createdAt||0)).slice(0,5);
 if(!reviews.length){text(root,'p','No saved reviews yet. Complete a policy comparison from the Verity tab to save it here.','muted');return;}
 for(const job of reviews){
  const row=document.createElement('a');row.className='history-item';
  row.href=chrome.runtime.getURL('verity/index.html')+'?jobId='+encodeURIComponent(job.id);
  if(job.id===selectedJob)row.setAttribute('aria-current','page');
  let host=job.site;try{host=new URL(job.site).hostname;}catch{}
  const copy=document.createElement('div');text(copy,'strong',host||'Website review');
  text(copy,'span',analyzedPolicy(job)||job.policy||'Privacy policy');row.append(copy);
  const when=new Date(job.reviewedAt||job.createdAt);
  const time=text(row,'time',Number.isNaN(when.getTime())?'Saved review':when.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}));
  if(!Number.isNaN(when.getTime()))time.dateTime=when.toISOString();
  text(row,'span',job.id===selectedJob?'Viewing':'Open review →','history-action');root.append(row);
 }
}
function renderJobs(){const root=$('jobs');const signature=JSON.stringify([jobList,page?.origin,selectedJob,user?.user_id]);if(signature===renderedJobs){renderAccess();countdown();return;}renderedJobs=signature;renderHistory();root.replaceChildren();const selected=new URLSearchParams(location.search).get('jobId');
if(selected&&!jobList.some(j=>j.id===selected)){text(root,'p','This review is no longer in your five most recent saved reviews. Return to the website and start a new comparison from Verity.','empty-state');}
for(const j of jobList.filter(j=>selected?j.id===selected:!page?.origin||j.site===page.origin)){const card=document.createElement('article');card.className='job';card.id='job-'+j.id;
const url=analyzedPolicy(j);text(card,'h3',j.state==='complete'?'Your visit to '+new URL(j.site).hostname:j.state==='failed'?'Analysis could not finish':'Your analysis is in progress');
if(url){const link=text(card,'a','Read the analyzed privacy policy ↗');link.href=url;link.target='_blank';link.rel='noopener noreferrer';}
if(j.state==='complete' && url && url!==j.policy)text(card,'p','The analyst used a different policy from the link submitted. The policy analyzed is linked above.');
text(card,'span',j.state==='complete'?'Comparison ready':j.state==='failed'?'Could not complete':'Comparing policy…','badge');if(j.error)text(card,'p',j.error);if(j.state==='complete')renderResult(card,j.result);root.append(card);}renderAccess();countdown();}
function choosePolicy(){const custom=$('policyChoice').value==='other';$('customPolicy').hidden=!custom;$('policy').required=custom;if(!custom)$('policy').value=$('policyChoice').value;}
$('policyChoice').addEventListener('change',()=>{if($('policyChoice').value==='other')$('policy').value='';choosePolicy();});
async function loadJobs(){jobList=(await send('VERITY_JOBS')).jobs||[];renderJobs();}
async function poll(){if(polling||!paid()||document.hidden)return;polling=true;try{for(const job of jobList.filter(j=>['queued','running'].includes(j.state))){const r=await send('VERITY_POLL',{id:job.id});if(r.job)Object.assign(job,r.job);}renderJobs();}catch(e){status(e.message+' Rechecking shortly.',true);}finally{polling=false;}}
$('login').addEventListener('submit',async e=>{e.preventDefault();$('loginButton').disabled=true;try{user=(await send('VERITY_LOGIN',{email:$('email').value.trim(),password:$('password').value})).user;$('password').value='';await account();}catch(e){status(e.message,true);}finally{$('password').value='';$('loginButton').disabled=false;}});
$('website').addEventListener('click',async()=>{try{await send('VERITY_WEBSITE_LOGIN');await account();}catch(e){status(e.message,true);}});
$('checkVerification').addEventListener('click',()=>account());
$('refresh').addEventListener('click',()=>account(true));$('reloadPage').addEventListener('click',loadPage);
$('signout').addEventListener('click',async()=>{await send('VERITY_SIGNOUT');user=null;jobList=[];renderJobs();status('Signed out of the extension.');});
$('compare').addEventListener('submit',async e=>{e.preventDefault();if(busy||$('start').disabled)return;if(!$('policy').value.trim()){status('Choose a privacy policy or enter its URL.',true);return;}busy=true;countdown();status('Preparing a redacted snapshot…');try{await send('VERITY_START',{tabId,expectedOrigin:page.origin,policies:['policy','policy2','policy3'].map(id=>$(id).value.trim()).filter(Boolean),consent:$('consent').checked});await loadJobs();status('Comparison started. You can leave this extension tab open; results update automatically.');await poll();}catch(e){status(e.message,true);}finally{busy=false;countdown();}});
$('version').textContent=chrome.runtime.getManifest().version;
void account(true);setInterval(countdown,1000);setInterval(poll,4000);setInterval(()=>{if(paid()&&!isPlans&&page?.loading&&!document.hidden)void loadPage();},3000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void account();});

if(selectedJob){document.querySelector('h1').textContent='Your privacy analysis';}
if(historyOnly){document.querySelector('h1').textContent='Your recent privacy reviews';}
