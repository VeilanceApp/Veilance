import test from "node:test";
import assert from "node:assert/strict";

import {
  OVERVIEW_ACTIVITY_BASELINE,
  classifyOverviewActivity
} from "../lib/overview-baselines.js";

test("overview activity cutoffs represent the supplied eight-site baseline", () => {
  assert.equal(OVERVIEW_ACTIVITY_BASELINE.sampleSize, 8);
  assert.equal(OVERVIEW_ACTIVITY_BASELINE.durationSeconds, 60);
  assert.deepEqual(
    Object.fromEntries(Object.entries(OVERVIEW_ACTIVITY_BASELINE.metrics).map(([name, value]) => [name, value.aLotAt])),
    {
      thirdPartyHosts: 10,
      requests: 250,
      apiSignals: 550,
      storageEvents: 170
    }
  );
});

test("current cutoffs classify the intended high-volume reference examples", () => {
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

  const expectedHighCounts = {
    thirdPartyHosts: 2,
    requests: 2,
    apiSignals: 2,
    storageEvents: 1
  };
  for (const metricName of Object.keys(OVERVIEW_ACTIVITY_BASELINE.metrics)) {
    const highVolumeCount = suppliedSamples.filter((sample) => (
      classifyOverviewActivity(metricName, sample[metricName]).isHigh
    )).length;
    assert.equal(highVolumeCount, expectedHighCounts[metricName], `${metricName} should retain its expected reference classification`);
  }
});

test("overview activity changes to high exactly at each cutoff", () => {
  for (const [metricName, baseline] of Object.entries(OVERVIEW_ACTIVITY_BASELINE.metrics)) {
    const below = classifyOverviewActivity(metricName, baseline.aLotAt - 1);
    const atCutoff = classifyOverviewActivity(metricName, baseline.aLotAt);
    assert.equal(below.isHigh, false, `${metricName} should remain typical below its cutoff`);
    assert.equal(below.label, "Typical");
    assert.equal(atCutoff.isHigh, true, `${metricName} should be high at its cutoff`);
    assert.equal(atCutoff.label, "High");
  }
});

test("overview activity safely normalizes invalid and fractional counts", () => {
  assert.equal(classifyOverviewActivity("requests", -10).count, 0);
  assert.equal(classifyOverviewActivity("requests", "not-a-number").count, 0);
  assert.equal(classifyOverviewActivity("requests", 249.9).count, 249);
  assert.throws(() => classifyOverviewActivity("unknown", 1), /Unknown overview metric/);
});
