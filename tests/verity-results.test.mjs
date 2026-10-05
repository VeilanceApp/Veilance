import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeResult,resultSummary,analyzedPolicy,renderResult} from '../verity/results.js';
import {discoverPolicyLinks} from '../verity/policy-links.js';
test('Analyst metadata does not hide sibling findings and corrected policy',()=>{
 const output={analysis:{summary:'No meaningful browser sample.',counts:{policy_only:2}},findings:[{comparison:'policy_only',policy:{evidence:'Cookies disclosed'},telemetry:{status:'insufficient_sample'}}],important_limitations:['Zero duration'],privacy_policy:{url:'https://example.com/privacy.pdf'}};
 assert.deepEqual(normalizeResult({error:{},output}),output);assert.equal(resultSummary({output}),output.analysis.summary);assert.equal(analyzedPolicy({policy:'https://x.com/user/status/123',result:{output}}),output.privacy_policy.url);
 assert.equal(analyzedPolicy({policy:'javascript:alert(1)',result:{}}),null);
});
test('Policy detection excludes social posts, broad text links, malformed paths and duplicates',()=>{
 const make=(href,text)=>({textContent:text,getAttribute:key=>key==='href'?href:null});
 globalThis.location=new URL('https://example.com/app');
 globalThis.document={querySelectorAll:()=>[make('/privacy','Privacy policy'),make('/privacy#cookies','Privacy policy'),make('https://x.com/user/status/123','Privacy policy'),make('/news','Read about our privacy work and announcements'),make('/legal/privacy_policy.pdf','Legal document'),make('/%E0%A4%A','Privacy'),make('javascript:alert(1)','Privacy'),make('https://policies.vendor.com/document','Privacy policy')]};
 assert.deepEqual(discoverPolicyLinks(),['https://example.com/privacy','https://example.com/legal/privacy_policy.pdf','https://policies.vendor.com/document']);
 delete globalThis.location;delete globalThis.document;
});

test('insufficient evidence for one finding does not invalidate the entire visit',()=>{
 const make=tag=>({tag,children:[],textContent:'',append(child){this.children.push(child);}});
 globalThis.document={createElement:make};
 try {
  const root=make('div');renderResult(root,{analysis:{summary:'Some behavior matched'},visit:{duration_seconds:16},findings:[{title:'Cookies',telemetry:{status:'insufficient_sample',evidence:'No cookie access recorded'}}]});
  assert(!root.children.some(c=>c.className==='sample-warning'));
  const card=root.children.find(c=>c.className==='finding');
  assert(card.children.some(c=>c.className==='sample-warning'));
  assert(card.children.some(c=>c.textContent==='No cookie access recorded'));
 } finally {delete globalThis.document;}
});
