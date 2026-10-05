import {buildTelemetryEnvelope,buildTelemetryMultipartUpload} from '../lib/telemetry-upload.js';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerityService,observationWait,paid,policyURL,unwrap} from '../verity/service.js';
import {SNAPSHOT_INTEREST_MINIMUM,buildTelemetrySnapshot,validateTelemetrySnapshot,createEmptyState} from '../lib/core.js';
import {readFile} from 'node:fs/promises';
test('Verity access and policy URL checks fail closed',()=>{
 for(const user of [null,{}, {plan:'',enabled_account:true},{plan:'free',enabled_account:true},{plan:'premium',enabled_account:false},{plan:'premium',enabled_account:true},{plan:'premium',enabled_account:true,verified:false}])assert.equal(paid(user),false);
 assert.equal(paid({plan:'holder',enabled_account:true,verified:true}),true);
 for(const u of ['javascript:alert(1)','http://127.0.0.1/a','http://10.0.0.1/privacy','https://user:pass@example.com','https://example.com:123/privacy'])assert.throws(()=>policyURL(u));
 assert.equal(policyURL('https://example.com/privacy#x'),'https://example.com/privacy');
 assert.throws(()=>unwrap({error:{error_string:'Plan required'}}),/Plan required/);
 assert.equal(SNAPSHOT_INTEREST_MINIMUM,5);
});
test('Verity authenticates, checks plans before capture, and caches one-time job results',async()=>{
 const store={},local={},requests=[];let verified=true,plan='free',captureCount=0,polls=0,expired=false,refreshes=0;
 globalThis.chrome={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p},storage:{local:{get:async key=>({[key]:local[key]}),set:async data=>Object.assign(local,data),remove:async key=>{delete local[key];}},session:{get:async key=>({[key]:store[key]}),set:async data=>Object.assign(store,data),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete store[key];}}},tabs:{query:async()=>[{id:2,url:'https://veilance.org/dashboard/'}]},scripting:{executeScript:async()=>[{result:{access:'website-token',refresh:'refresh-token'}}]}};
 globalThis.fetch=async(url,opts)=>{
  const route=new URL(url).pathname;requests.push({route,body:JSON.parse(opts.body),auth:opts.headers.Authorization});
  let output;
  if(route.endsWith('/login') || route.endsWith('/register'))output={access_token:'access-token',refresh_token:'refresh-token'};
  else if(route.endsWith('/refresh')){refreshes++;expired=false;output={ok:true,access_token:'renewed'};}
  else if(expired)return new Response(JSON.stringify({msg:'Expired'}),{status:401});
  else if(route.endsWith('/whoami'))output={user_id:'u1',email_address:'user@example.com',plan,enabled_account:true,verified};
  else if(route.endsWith('/compare'))output={uuid:'job-uuid',status:'PENDING'};
  else if(route.endsWith('/status')){polls++;output=polls===1?{uuid:'job-uuid',status:'STARTED'}:{summary:'Policy and observed behavior differ.',findings:[{status:'observed_only',title:'Analytics'}]};}
  else throw Error('Unexpected API path');
  return new Response(JSON.stringify({output,error:{}}),{headers:{'content-type':'application/json'}});
 };
 const state=createEmptyState(1,'https://example.com',1000);
 const doc={format:'veilance.redacted-html.v1',hostname:'example.com',https:true,html:'<!doctype html>\n<html><body>[REDACTED TEXT]</body></html>',truncated:false,originalElementCount:2,redaction:{textNodesRedacted:1},resourceHosts:[],inlineScriptHints:{},domMarkers:{}};
 const records=[{payload:buildTelemetrySnapshot(state,doc,'1.0.0',17000,{eventId:'test-event',allowRoutine:true})}];
 const identity={records,clientId:'ab'.repeat(32),batchId:'comparison-batch'};
 const telemetry=buildTelemetryEnvelope(identity);
 const upload=await buildTelemetryMultipartUpload({...identity,walletAddress:'11111111111111111111111111111111',ipAddress:'203.0.113.42'});
 const uploadedTelemetry=JSON.parse(gunzipSync(new Uint8Array(await upload.body.get('telemetry').arrayBuffer())).toString('utf8'));
 const service=createVerityService({capture:async()=>{captureCount++;return {current_url:'https://example.com',payload:telemetry};},pageInfo:async()=>({})});
 const sender={id:'test',url:'chrome-extension://test/verity/index.html?tabId=1'};
 const send=(type,extra={})=>service({type,...extra},sender);
 await assert.rejects(()=>service({type:'VERITY_LOGIN'},{id:'test',url:'https://evil.example'}),/extension/);
 assert.equal((await send('VERITY_ACCOUNT')).user,null);
 await send('VERITY_LOGIN',{email:'user@example.com',password:'secret'});
 await assert.rejects(()=>send('VERITY_START',{consent:true,policies:['https://example.com/privacy']}),/paid plan/);assert.equal(captureCount,0);
 plan='holder';verified=false;
 assert.equal((await send('VERITY_ACCOUNT')).user.verified,false);
 for(const type of ['VERITY_START','VERITY_JOBS','VERITY_POLL'])await assert.rejects(()=>send(type,{consent:true,policies:['https://example.com/privacy']}),e=>e.code==='VERIFICATION_REQUIRED');
 assert.equal(captureCount,0);verified=true;expired=true;assert.equal((await send('VERITY_ACCOUNT')).user.plan,'holder');assert.equal(refreshes,1);
 await assert.rejects(()=>send('VERITY_START',{consent:false,policies:['https://example.com/privacy']}),/Confirm/);
 const started=await send('VERITY_START',{tabId:1,expectedOrigin:'https://example.com',consent:true,policies:['https://example.com/privacy']});const id=started.jobs[0].id;assert.equal(captureCount,1);
 assert.equal((await send('VERITY_POLL',{id})).job.state,'running');assert.equal((await send('VERITY_POLL',{id})).job.state,'complete');await send('VERITY_POLL',{id});assert.equal(polls,2);
 assert.deepEqual(requests.find(r=>r.route.endsWith('/compare')).body,{telemetry_data:uploadedTelemetry,privacy_policy_url:'https://example.com/privacy',current_url:'https://example.com'});
 assert(requests.every(r=>!r.route.includes('/chat')));
 await service({type:'VERITY_REGISTER',email:'new@example.com',password:'new-password'},{id:'test',url:'chrome-extension://test/onboarding.html'});assert(requests.some(r=>r.route.endsWith('/register')));
 await send('VERITY_SIGNOUT');assert.equal((await send('VERITY_ACCOUNT')).user,null);await send('VERITY_WEBSITE_LOGIN');assert.equal((await send('VERITY_ACCOUNT')).user.plan,'holder');assert.equal((await send('VERITY_JOBS')).jobs[0].id,id);
});
test('Observation wait enforces a full 15 seconds after load completion',()=>{
 assert.equal(observationWait(null,20000),15000);
 assert.equal(observationWait({loadCompletedAt:10000},10000),15000);
 assert.equal(observationWait({loadCompletedAt:10000},24999),1);
 assert.equal(observationWait({loadCompletedAt:10000},25000),0);
 assert.equal(observationWait({loadCompletedAt:26000},26000),15000);
});
test('Explicit comparison can validate routine activity without making it upload eligible',()=>{
 const state=createEmptyState(1,'https://example.com',1000);
 const doc={format:'veilance.redacted-html.v1',hostname:'example.com',https:true,html:'<!doctype html>\n<html><body>[REDACTED TEXT]</body></html>',truncated:false,originalElementCount:2,redaction:{textNodesRedacted:1},resourceHosts:[],inlineScriptHints:{},domMarkers:{}};
 const payload=buildTelemetrySnapshot(state,doc,'1.0.0',2000,{eventId:'routine-event-1',allowRoutine:true});
 assert.equal(validateTelemetrySnapshot(payload,{allowRoutine:true}),true);
 assert.equal(validateTelemetrySnapshot(payload),false);
 payload.redactedDocument.html='<script>alert(1)</script>';
 assert.equal(validateTelemetrySnapshot(payload,{allowRoutine:true}),false);
});
