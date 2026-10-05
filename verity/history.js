const PREFIX = 'veilanceVerityReviewHistoryV1:';
const LIMIT = 5;
let writes = Promise.resolve();
const keyFor = userId => PREFIX + encodeURIComponent(userId);
export async function reviewHistory(userId) {
  await writes;
  const key = keyFor(userId);
  const value = (await chrome.storage.local.get(key))[key];
  return Array.isArray(value) ? value.filter(j => j?.userId === userId && j.state === 'complete').slice(0, LIMIT) : [];
}
export function rememberReviews(reviews) {
  const completed = reviews.filter(j => j?.state === 'complete' && typeof j.userId === 'string' && j.id && j.result != null);
  const task = writes.then(async () => {
    for (const userId of new Set(completed.map(j => j.userId))) {
      const key = keyFor(userId);
      const old = (await chrome.storage.local.get(key))[key];
      const byId = new Map((Array.isArray(old) ? old : []).filter(j=>j?.userId===userId && j.state==='complete').map(j=>[j.id,j]));
      for (const job of completed.filter(j=>j.userId===userId)) {
        const record = {};
        for (const name of ['id','userId','policy','site','currentUrl','createdAt','reviewedAt','state','result']) {
          if (job[name] !== undefined) record[name] = job[name];
        }
        record.reviewedAt = job.reviewedAt || job.createdAt;
        byId.set(record.id, record);
      }
      const history = [...byId.values()].sort((a,b)=>(b.reviewedAt||0)-(a.reviewedAt||0) || (b.createdAt||0)-(a.createdAt||0)).slice(0,LIMIT);
      await chrome.storage.local.set({[key]:history});
    }
  });
  writes = task.catch(()=>{});
  return task;
}
