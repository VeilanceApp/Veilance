import { veilanceApiEndpoint, VEILANCE_API_ORIGIN } from '../config.js';
const LEGACY_KEY = 'veilanceVerityAccountV1';
const KEY = `veilanceVerityAccountV2:${VEILANCE_API_ORIGIN}`;
const EARLY_REFRESH_MS = 120000;
let revision = 0, refreshing = null, writes = Promise.resolve(), initialized = null;
export function authRevision() { return revision; }
export function jwtExpiry(token) {
  try { const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'); const exp=JSON.parse(atob(part.padEnd(Math.ceil(part.length/4)*4,'='))).exp; return typeof exp==='number'&&Number.isFinite(exp)?exp*1000:null; } catch { return null; }
}
export function unwrap(payload) {
  const err=payload?.error, message=typeof err==='string'?err:err?.error_string||err?.message;
  if(message||payload?.is_error===true)throw new Error(message||'The API could not complete this request.');
  return payload?.output ?? payload;
}
export async function raw(path,body={},token) {
  let response;
  try { response=await fetch(veilanceApiEndpoint('/api/users/v1'+path),{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(25000)}); }
  catch {throw Object.assign(new Error('Cannot reach Veilance. Your session is saved; please try again.'),{transient:true});}
  const payload=await response.json().catch(()=>null);
  if(!response.ok){
    const message=payload?.error?.error_string||payload?.msg||`Veilance returned HTTP ${response.status}.`;
    throw Object.assign(new Error(message),{unauthorized:response.status===401||(response.status===422&&/token|jwt|signature|segments/i.test(message)),transient:response.status===429||response.status>=500,status:response.status});
  }
  if(!payload)throw new Error('Veilance returned an unreadable response.');
  return unwrap(payload);
}
async function initialize() {
  if(!initialized)initialized=(async()=>{
    // Persistent credentials must not be readable by content scripts.
    if(chrome.storage.local.setAccessLevel)await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    const saved=(await chrome.storage.local.get(KEY))[KEY];
    const legacy=(await chrome.storage.session.get(LEGACY_KEY))[LEGACY_KEY];
    if(!saved&&legacy?.access)await chrome.storage.local.set({[KEY]:{...legacy,origin:VEILANCE_API_ORIGIN}});
    if(legacy)await chrome.storage.session.remove(LEGACY_KEY);
  })().catch(e=>{initialized=null;throw e;});
  return initialized;
}
export async function session() {await initialize();await writes;return (await chrome.storage.local.get(KEY))[KEY]||null;}
function write(value, expected) {
  const task=writes.then(async()=>{
    if(expected!==revision)throw new Error('Your account changed. Please retry.');
    if(value)await chrome.storage.local.set({[KEY]:value});else await chrome.storage.local.remove(KEY);
  });writes=task.catch(()=>{});return task;
}
export async function signOut() {await initialize();const rev=++revision;await write(null,rev);}
function authRequired(message='Your sign-in has expired. Please sign in again.') {return Object.assign(new Error(message),{code:'AUTH_REQUIRED',unauthorized:true});}
async function renew(auth,rev) {
  const latest=await session();
  if(rev!==revision)throw new Error('Your account changed. Please retry.');
  if(latest?.access&&latest.access!==auth.access)return latest;
  if(!auth?.refresh)throw authRequired();
  if(refreshing?.revision===rev)return refreshing.promise;
  const promise=(async()=>{
    let result;
    try { result=await raw('/refresh',{},auth.refresh); }
    catch(e){if(e.unauthorized)throw authRequired();throw e;}
    if(typeof result?.access_token!=='string'||!result.access_token)throw new Error('The session refresh returned no access token. Please retry.');
    const next={...auth,access:result.access_token,refresh:result.refresh_token||auth.refresh,origin:VEILANCE_API_ORIGIN};
    await write(next,rev);return next;
  })();
  refreshing={revision:rev,promise};
  try{return await promise;}finally{if(refreshing?.promise===promise)refreshing=null;}
}
export async function request(path,body={},options={}) {
  let auth=await session();const rev=revision;
  if(options.expectedRevision!==undefined&&options.expectedRevision!==rev)throw new Error('Your account changed.');
  if(!auth?.access)throw authRequired('Sign in to your Veilance account.');
  const expiry=jwtExpiry(auth.access);
  if(auth.refresh&&expiry!==null&&expiry-Date.now()<=EARLY_REFRESH_MS){
    try{auth=await renew(auth,rev);}catch(e){if(!e.transient||expiry<=Date.now())throw e;}
  }
  try {const value=await raw(path,body,auth.access);if(rev!==revision&&!options.retainResponse)throw new Error('Your account changed.');return value;}
  catch(e){
    if(!e.unauthorized)throw e;
    auth=await renew(auth,rev);
    const value=await raw(path,body,auth.access);if(rev!==revision&&!options.retainResponse)throw new Error('Your account changed.');return value;
  }
}
export function cleanUser(user) {
  if(typeof user?.user_id!=='string'||typeof user.plan!=='string')throw new Error('The account API returned incomplete details.');
  return {user_id:user.user_id,email:user.email_address||'',plan:user.plan.trim(),enabled_account:user.enabled_account===true,verified:(user.verified??user.verified_account)===true};
}
export async function who() {return cleanUser(await request('/whoami'));}
export async function accept(access,refresh,expected=revision) {
  if(typeof access!=='string'||!access||access.length>20000)throw new Error('No website sign-in was found.');
  await initialize();
  let user;
  try{user=await raw('/whoami',{},access);}catch(e){
    if(!e.unauthorized||typeof refresh!=='string'||!refresh||refresh.length>20000)throw e;
    const result=await raw('/refresh',{},refresh);
    if(typeof result?.access_token!=='string'||!result.access_token)throw new Error('Please sign in again.');
    access=result.access_token;refresh=result.refresh_token||refresh;user=await raw('/whoami',{},access);
  }
  user=cleanUser(user);if(!user.enabled_account)throw new Error('This account is disabled.');
  if(expected!==revision)throw new Error('Your account changed. Please retry.');
  const rev=++revision;
  await write({access,refresh:typeof refresh==='string'&&refresh.length<=20000?refresh:null,userId:user.user_id,origin:VEILANCE_API_ORIGIN},rev);
  return user;
}
export async function maintainSession() {
  const auth=await session();const expiry=jwtExpiry(auth?.access||'');
  if(auth?.refresh&&expiry!==null&&expiry-Date.now()<=EARLY_REFRESH_MS)await renew(auth,revision);
}
