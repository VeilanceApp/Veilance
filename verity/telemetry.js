import { validateTelemetrySnapshot } from '../lib/core.js';
// The policy API receives exactly the same JSON batch as the upload before gzip.
export function policyTelemetry(envelope,currentUrl) {
  if(envelope?.schemaVersion!=='veilance.telemetry-snapshot-batch.v1'||!Array.isArray(envelope.observations)||envelope.observations.length!==1)throw new Error('The telemetry batch is incomplete. Reload the website and try again.');
  const snapshot=envelope.observations[0];
  if(!validateTelemetrySnapshot(snapshot,{allowRoutine:true})||snapshot.observation.durationSeconds<15)throw new Error('The observation is not ready. Wait for a full 15-second sample and try again.');
  if(snapshot.site.hostname!==new URL(currentUrl).hostname)throw new Error('The page changed. Refresh the comparison and try again.');
  if(!/^[a-f0-9]{64}$/.test(envelope.contributorId)||!envelope.batchId)throw new Error('The telemetry identity is not ready. Please retry.');
  return structuredClone(envelope);
}
