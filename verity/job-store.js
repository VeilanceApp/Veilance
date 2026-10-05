import { VEILANCE_API_ORIGIN } from '../config.js';
const PREFIX=`veilanceVerityJobsV2:${VEILANCE_API_ORIGIN}:`;
let writes=Promise.resolve();
const keyFor=userId=>PREFIX+encodeURIComponent(userId);
const valid=(j,userId)=>j&&j.userId===userId&&typeof j.id==='string';
function ordered(jobs){return jobs.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,5);}
export function changeJobs(userId,change) {
  const task=writes.then(async()=>{
    const key=keyFor(userId), stored=(await chrome.storage.local.get(key))[key];
    const jobs=Array.isArray(stored)?stored.filter(j=>valid(j,userId)):[];
    const next=ordered(change(jobs));
    await chrome.storage.local.set({[key]:next});return next;
  });writes=task.catch(()=>{});return task;
}
export async function getJobs(userId) {
  await writes;
  const legacyKey='veilanceVerityJobsV1';
  const legacy=(await chrome.storage.session.get(legacyKey))[legacyKey];
  if(Array.isArray(legacy)&&legacy.some(j=>valid(j,userId))){
    await changeJobs(userId,jobs=>{const map=new Map(legacy.filter(j=>valid(j,userId)).map(j=>[j.id,j]));for(const j of jobs)map.set(j.id,j);return [...map.values()];});
    await chrome.storage.session.set({[legacyKey]:legacy.filter(j=>!valid(j,userId))});
  }
  const key=keyFor(userId), stored=(await chrome.storage.local.get(key))[key];
  return Array.isArray(stored)?ordered(stored.filter(j=>valid(j,userId))):[];
}
export async function updateJob(userId,id,patch) {const jobs=await changeJobs(userId,jobs=>jobs.map(j=>j.id===id?{...j,...patch}:j));return jobs.find(j=>j.id===id);}
