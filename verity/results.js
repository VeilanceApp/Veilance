export const labels = {matched:'Matches the policy',partially_matched:'Partly matches',observed_only:'Observed, not disclosed',policy_only:'Disclosed, not observed',possible_contradictions:'Possible contradiction',possible_contradiction:'Possible contradiction',contradiction:'Possible contradiction',contradictions:'Possible contradiction',indeterminate:'Not enough evidence'};
export function normalizeResult(source) {
  let value=source;
  for(let i=0;i<6;i++) {
    if(typeof value==='string'){try{value=JSON.parse(value);}catch{return {summary:value};}}
    if(!value || typeof value!=='object')return {};
    if(value.output!==undefined){value=value.output;continue;}
    if(value.report){value=value.report;continue;}
    // `analysis` contains metadata, while findings and limitations are siblings.
    if(value.analysis && !value.findings && !value.privacy_policy && value.analysis.findings){value=value.analysis;continue;}
    break;
  }
  return value || {};
}
export function resultSummary(source) {
  const r=normalizeResult(source), s=r.analysis?.summary ?? r.summary;
  return typeof s==='string'?s:typeof s?.text==='string'?s.text:'No summary was returned.';
}
export function safeLink(value) {try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function analyzedPolicy(job) {const r=normalizeResult(job.result);return safeLink(r.privacy_policy?.url)||safeLink(job.policy);}
export function addText(parent,tag,value,cls) {if(typeof value!=='string'&&typeof value!=='number')return;const el=document.createElement(tag);el.textContent=String(value).slice(0,50000);if(cls)el.className=cls;parent.append(el);return el;}
export function renderResult(container,source) {
  const r=normalizeResult(source);
  addText(container,'p',resultSummary(r),'report-summary');
  const findings=Array.isArray(r.findings)?r.findings:Array.isArray(r.results)?r.results:[];
  if(r.visit?.duration_seconds===0)addText(container,'p','Insufficient browser observations. This report cannot establish what happened during the visit.','sample-warning');
  const confidence=r.analysis?.overall_confidence;
  if(typeof confidence==='number' && confidence>=0 && confidence<=1)addText(container,'small',`Model confidence: ${Math.round(confidence*100)}%. This is not a guarantee of accuracy.`);
  const counts=r.analysis?.counts;
  if(counts){const row=document.createElement('div');row.className='count-row';for(const [key,count] of Object.entries(counts)){if(labels[key] && Number.isInteger(count)&&count>0)addText(row,'span',`${labels[key]}: ${count}`,'badge');}container.append(row);}
  for(const f of findings.slice(0,100)) {
    if(typeof f==='string'){addText(container,'p',f);continue;}
    if(!f || typeof f!=='object')continue;
    const card=document.createElement('article');card.className='finding';
    addText(card,'span',labels[f.comparison||f.status||f.classification||f.verdict]||'Finding','badge');
    addText(card,'h3',f.title || String(f.behavior||f.category||'Recorded behavior').replaceAll('_',' '));
    for(const k of ['description','explanation','reasoning','recommendation'])addText(card,'p',f[k]);
    if(f.policy){addText(card,'h4','What the policy says');addText(card,'p',f.policy.evidence);addText(card,'small',f.policy.section);}
    if(f.telemetry){addText(card,'h4','What Veilance observed');if(f.telemetry.status==='insufficient_sample')addText(card,'p','There were not enough observations to assess this behavior.','sample-warning');for(const e of Array.isArray(f.telemetry.evidence)?f.telemetry.evidence:[f.telemetry.evidence])addText(card,'p',e);if(Number.isInteger(f.telemetry.observation_count))addText(card,'small',`${f.telemetry.observation_count} observations`);}
    container.append(card);
  }
  if(Array.isArray(r.important_limitations)&&r.important_limitations.length){addText(container,'h3','Limits of this comparison');const ul=document.createElement('ul');for(const note of r.important_limitations)addText(ul,'li',note);container.append(ul);}
}
