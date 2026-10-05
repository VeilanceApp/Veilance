import { normalizeResult, resultSummary, analyzedPolicy, safeLink } from './results.js';
export { normalizeResult, analyzedPolicy };
const categories = {
  observed_only: ['Not found in the policy', 'Veilance recorded this activity, but Verity did not find a matching disclosure in the policy it reviewed.', 'attention'],
  contradiction: ['Possible conflict', 'The recorded activity may conflict with the policy. Review the evidence before drawing a conclusion.', 'attention'],
  partially_matched: ['Only partly explained', 'The policy describes part of this activity, but some details remain unclear.', 'partial'],
  matched: ['Explained by the policy', 'Verity found policy wording that describes the recorded activity. This does not mean the activity is harmless.', 'match'],
  policy_only: ['Mentioned, but not seen', 'The policy describes this activity, but it was not recorded during this visit. It could occur at another time.', 'neutral'],
  indeterminate: ['Not enough evidence', 'There is not enough evidence to make a reliable comparison for this finding.', 'neutral']
};
function category(f) {
  let key = f?.comparison || f?.status || f?.classification || f?.verdict;
  if (['possible_contradictions','possible_contradiction','contradictions'].includes(key)) key = 'contradiction';
  return categories[key] ? key : 'indeterminate';
}
function node(parent, tag, value, cls) {
  const el = document.createElement(tag);
  if (value !== undefined && value !== null) el.textContent = String(value);
  if (cls) el.className = cls;
  parent.append(el); return el;
}
function sentence(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return '';
  return [value.text, value.quote, value.description, value.explanation].find(v => typeof v === 'string') || '';
}
function evidence(parent, value, empty) {
  const items = (Array.isArray(value) ? value : [value]).filter(v => v != null);
  if (!items.length) { node(parent, 'p', empty, 'muted'); return; }
  for (const item of items) {
    const readable = sentence(item);
    if (readable) node(parent, 'p', readable);
    else { const d=node(parent,'details');node(d,'summary','Technical evidence');node(d,'pre',JSON.stringify(item,null,2)); }
  }
}
function title(f) {
  const raw = sentence(f.title) || sentence(f.behavior) || sentence(f.category) || 'Recorded activity';
  return raw.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
}
export function renderResult(container, source) {
  const r = normalizeResult(source);
  const findings = (Array.isArray(r.findings) ? r.findings : Array.isArray(r.results) ? r.results : []).filter(f => f && (typeof f === 'string' || typeof f === 'object'));
  const overview = node(container, 'div', null, 'analysis-overview');
  node(overview, 'span', 'AT A GLANCE', 'eyebrow');
  node(overview, 'h3', 'What this visit tells you');
  node(overview, 'p', resultSummary(r), 'report-summary');
  if (r.visit?.duration_seconds === 0) node(overview, 'p', 'No observation time was recorded. Start a new comparison after the page has finished loading and the 15-second observation period is complete.', 'sample-warning');
  else if (findings.some(f => f?.telemetry?.status === 'insufficient_sample')) node(overview, 'p', 'Some findings have limited evidence. Open their details to see what could and could not be compared.', 'sample-warning');
  const facts=node(overview,'div',null,'visit-facts');
  if (Number.isFinite(r.visit?.duration_seconds) && r.visit.duration_seconds >= 0) node(facts,'span',`${r.visit.duration_seconds} seconds observed`);
  const confidence=r.analysis?.overall_confidence;
  if (typeof confidence==='number' && confidence>=0 && confidence<=1) {
    const c=node(facts,'span',`${Math.round(confidence*100)}% model confidence`);
    c.title='How confident the model is in its comparison. This is not a privacy or safety score.';
    node(overview,'p','Model confidence describes certainty in the comparison. It is not a privacy or safety score.','muted confidence-note');
  }
  const counts = Object.fromEntries(Object.keys(categories).map(k => [k, findings.filter(f=>category(f)===k).length]));
  const toolbar=node(container,'div',null,'findings-toolbar');
  node(toolbar,'h3',`Findings (${findings.length})`);
  node(toolbar,'p','Choose a category to focus on, then open a finding to compare the policy with the recorded activity.','muted');
  const filters=node(toolbar,'div',null,'finding-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filter findings');
  const list=node(container,'div',null,'finding-list');
  const countLabel=node(toolbar,'p','', 'filter-count');countLabel.setAttribute('role','status');
  const entries=[]; const buttons=[];
  function select(key) {
    for(const item of entries) item.el.hidden=key!=='all' && item.key!==key;
    for(const item of buttons) item.el.setAttribute('aria-pressed',String(item.key===key));
    const visible=entries.filter(item=>!item.el.hidden).length;
    countLabel.textContent=`Showing ${visible} of ${findings.length} findings`;
  }
  for(const key of ['all',...Object.keys(categories)]) {
    if(key!=='all'&&!counts[key])continue;
    const b=node(filters,'button',key==='all'?`All (${findings.length})`:`${categories[key][0]} (${counts[key]})`);
    b.type='button';b.addEventListener('click',()=>select(key));buttons.push({key,el:b});
  }
  for(const [index, finding] of findings.entries()) {
    const f=typeof finding==='string'?{description:finding,title:'Finding'}:finding;
    const key=category(f), [label,meaning,tone]=categories[key];
    const card=node(list,'details',null,`finding-card ${tone}`);
    const summary=node(card,'summary');
    const head=node(summary,'span',null,'finding-heading');node(head,'span',String(index+1).padStart(2,'0'),'finding-number');node(head,'span',title(f),'finding-title');
    node(summary,'span',label,`badge ${tone}`);
    const body=node(card,'div',null,'finding-body');
    node(body,'p',meaning,'meaning');
    const texts=[f.description,f.explanation,f.reasoning].map(sentence).filter(Boolean);
    for(const line of [...new Set(texts)])node(body,'p',line);
    const columns=node(body,'div',null,'evidence-grid');
    const policy=node(columns,'div',null,'evidence-box');node(policy,'h4','What the policy says');
    evidence(policy,f.policy?.evidence ?? (typeof f.policy==='string'?f.policy:null),'No supporting policy excerpt was included in this report.');
    if(sentence(f.policy?.section))node(policy,'small',`Policy section: ${sentence(f.policy.section)}`);
    const policyLink=safeLink(f.policy?.url);
    if(policyLink){const a=node(policy,'a','Read policy source ↗');a.href=policyLink;a.target='_blank';a.rel='noopener noreferrer';}
    const observed=node(columns,'div',null,'evidence-box');node(observed,'h4','What Veilance recorded');
    evidence(observed,f.telemetry?.evidence,'No supporting browser evidence was included in this report.');
    if(Number.isInteger(f.telemetry?.observation_count))node(observed,'small',`${f.telemetry.observation_count} recorded observations`);
    if(f.telemetry?.status==='insufficient_sample')node(observed,'p','This finding has too little recorded activity for a reliable conclusion.','sample-warning');
    if(sentence(f.recommendation)){const next=node(body,'div',null,'next-step');node(next,'h4','Suggested next step');node(next,'p',sentence(f.recommendation));}
    entries.push({key,el:card});
  }
  select('all');
  if(!findings.length)node(list,'p','No individual findings were included in this report. Read the summary and limitations; an empty list does not establish that the website is private.','empty-state');
  const limits=node(container,'details',null,'report-limits');node(limits,'summary','What this report can and cannot tell you');
  node(limits,'p','This comparison covers one recorded visit. Activity can vary by page, account, location, consent choices, and time. A behavior not seen here may still happen elsewhere.');
  node(limits,'p','A policy match is not a safety rating, and a possible mismatch is not proof of a legal violation.');
  if(Array.isArray(r.important_limitations)){const ul=node(limits,'ul');for(const value of r.important_limitations)if(sentence(value))node(ul,'li',sentence(value));}
  const raw=node(container,'details',null,'technical-report');node(raw,'summary','Technical report');node(raw,'pre',JSON.stringify(r,null,2));
}
