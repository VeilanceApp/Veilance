import { analyzedPolicy } from './results.js';
export const activeJob = job => ['preparing','queued','running'].includes(job.state);
export const jobLabel = job => ({preparing:'Preparing observations',queued:'Queued',running:'Processing',complete:'Done',failed:'Failed'})[job.state] || 'Pending';
const signatures=new WeakMap();
export function renderHistory(root,jobs,selectedId) {
  const signature=JSON.stringify([jobs,selectedId]);if(signatures.get(root)===signature)return;signatures.set(root,signature);root.replaceChildren();
  const recent=[...jobs].sort((a,b)=>b.createdAt-a.createdAt).slice(0,5);
  if(!recent.length){const p=document.createElement('p');p.textContent='No reviews yet. Your next analysis will appear here as soon as it starts.';root.append(p);return;}
  for(const job of recent){
    const link=document.createElement('a');link.className='review-history-item';link.href=chrome.runtime.getURL('verity/index.html')+'?jobId='+encodeURIComponent(job.id);link.target='_blank';link.rel='noopener';
    if(job.id===selectedId)link.setAttribute('aria-current','page');
    let host='Website review';try{host=new URL(job.site).hostname;}catch{}
    const title=document.createElement('strong');title.textContent=host;link.append(title);
    const badge=document.createElement('span');badge.className='review-state '+job.state;badge.textContent=jobLabel(job);link.append(badge);
    const policy=document.createElement('small');policy.textContent=analyzedPolicy(job)||job.policy||'Privacy policy';link.append(policy);
    const time=document.createElement('time');const date=new Date(job.createdAt);time.textContent=Number.isNaN(date.getTime())?'':date.toLocaleString();if(time.textContent)time.dateTime=date.toISOString();link.append(time);
    if(job.error){const p=document.createElement('small');p.className='review-error';p.textContent=job.error;link.append(p);}
    root.append(link);
  }
}
