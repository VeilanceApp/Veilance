import test from "node:test";
import assert from "node:assert/strict";

import {
  OVERVIEW_ACTIVITY_BASELINE,
  classifyOverviewActivity
} from "../lib/overview-baselines.js";

test("overview activity cutoffs represent the supplied eight-site baseline", () => {
  assert.equal(OVERVIEW_ACTIVITY_BASELINE.sampleSize, 8);
  assert.deepEqual(
    Object.fromEntries(Object.entries(OVERVIEW_ACTIVITY_BASELINE.metrics).map(([name, value]) => [name, value.aLotAt])),
    {
      thirdPartyHosts: 8,
      requests: 250,
      apiSignals: 600,
      storageEvents: 125
    }
  );
});

test("each cutoff identifies the busiest quarter of the supplied reference sites", () => {
  const suppliedSamples = [
    { thirdPartyHosts: 2, requests: 294, apiSignals: 249, storageEvents: 29 },
    { thirdPartyHosts: 3, requests: 45, apiSignals: 257, storageEvents: 62 },
    { thirdPartyHosts: 3, requests: 228, apiSignals: 502, storageEvents: 237 },
    { thirdPartyHosts: 5, requests: 102, apiSignals: 457, storageEvents: 79 },
    { thirdPartyHosts: 20, requests: 403, apiSignals: 413, storageEvents: 119 },
    { thirdPartyHosts: 6, requests: 177, apiSignals: 847, storageEvents: 81 },
    { thirdPartyHosts: 4, requests: 128, apiSignals: 1140, storageEvents: 140 },
    { thirdPartyHosts: 10, requests: 127, apiSignals: 168, storageEvents: 107 }
  ];

  for (const metricName of Object.keys(OVERVIEW_ACTIVITY_BASELINE.metrics)) {
    const highVolumeCount = suppliedSamples.filter((sample) => (
      classifyOverviewActivity(metricName, sample[metricName]).isALot
    )).length;
    assert.equal(highVolumeCount, 2, `${metricName} should classify two of eight reference sites as a lot`);
  }
});

test("overview activity changes to a lot exactly at each cutoff", () => {
  for (const [metricName, baseline] of Object.entries(OVERVIEW_ACTIVITY_BASELINE.metrics)) {
    const below = classifyOverviewActivity(metricName, baseline.aLotAt - 1);
    const atCutoff = classifyOverviewActivity(metricName, baseline.aLotAt);
    assert.equal(below.isALot, false, `${metricName} should remain in the baseline range below its cutoff`);
    assert.equal(below.label, "Baseline");
    assert.equal(atCutoff.isALot, true, `${metricName} should be a lot at its cutoff`);
    assert.equal(atCutoff.label, "A lot");
  }
});

test("overview activity safely normalizes invalid and fractional counts", () => {
  assert.equal(classifyOverviewActivity("requests", -10).count, 0);
  assert.equal(classifyOverviewActivity("requests", "not-a-number").count, 0);
  assert.equal(classifyOverviewActivity("requests", 249.9).count, 249);
  assert.throws(() => classifyOverviewActivity("unknown", 1), /Unknown overview metric/);
});
