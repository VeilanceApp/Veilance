import test from 'node:test';
import assert from 'node:assert/strict';
const token=(ms,id='access')=>`e30.${Buffer.from(JSON.stringify({exp:Math.floor(ms/1000),jti:id})).toString('base64url')}.signature`;
function setup(){const local={},session={};const area=store=>({get:async key=>({[key]:structuredClone(store[key])}),set:async data=>Object.assign(store,structuredClone(data)),remove:async key=>{delete store[key];},setAccessLevel:async()=>{}});globalThis.chrome={storage:{local:area(local),session:area(session)}};return {local,session};}
const reply=output=>new Response(JSON.stringify({output,error:{}}));
const user={user_id:'u1',plan:'premium',enabled_account:true,verified:true};
test('proactive refresh is single-flight, persists rotation, and survives session clearing',async()=>{
 const stores=setup(),auth=await import('../verity/auth.js?early');let refreshes=0;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,auth:options.headers.Authorization});if(url.endsWith('/refresh')){refreshes++;await new Promise(r=>setTimeout(r,10));return reply({access_token:token(Date.now()+3600000,'next'),refresh_token:'rotated'});}return reply(user);};
 await auth.accept(token(Date.now()+90000),'refresh');calls.length=0;
 await Promise.all([auth.who(),auth.who(),auth.who()]);
 assert.equal(refreshes,1);assert(calls[0].url.endsWith('/refresh'));assert.equal((await auth.session()).refresh,'rotated');
 for(const k of Object.keys(stores.session))delete stores.session[k];
 const restarted=await import('../verity/auth.js?restarted');assert.equal((await restarted.who()).user_id,'u1');assert.equal(refreshes,1);
 await restarted.signOut();assert.equal(await restarted.session(),null);
});
test('offline early refresh retains sign-in; ordinary validation errors do not refresh',async()=>{
 setup();const auth=await import('../verity/auth.js?offline');globalThis.fetch=async()=>reply(user);
 await auth.accept(token(Date.now()+90000),'refresh');
 globalThis.fetch=async url=>{if(url.endsWith('/refresh'))throw Error('offline');return reply(user);};
 assert.equal((await auth.who()).user_id,'u1');assert((await auth.session()).refresh);
 await auth.accept(token(Date.now()+3600000),'refresh');let refreshes=0;
 globalThis.fetch=async url=>{if(url.endsWith('/refresh'))refreshes++;return new Response(JSON.stringify({msg:'Telemetry field invalid'}),{status:422});};
 await assert.rejects(()=>auth.request('/intel/policy/compare'),/Telemetry field invalid/);assert.equal(refreshes,0);assert(await auth.session());
});
test('sign-out wins over a refresh already in flight',async()=>{
 setup();const auth=await import('../verity/auth.js?signout');globalThis.fetch=async()=>reply(user);await auth.accept(token(Date.now()+10000),'refresh');
 let release,started;const start=new Promise(r=>started=r);globalThis.fetch=async url=>{if(url.endsWith('/refresh')){started();await new Promise(r=>release=r);return reply({access_token:token(Date.now()+3600000)});}return reply(user);};
 const work=auth.who();await start;await auth.signOut();release();await assert.rejects(()=>work,/account changed/);assert.equal(await auth.session(),null);
});
