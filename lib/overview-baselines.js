const metrics = {
  thirdPartyHosts: {
    aLotAt: 10,
    unit: "third-party hosts"
  },
  requests: {
    aLotAt: 250,
    unit: "requests"
  },
  apiSignals: {
    aLotAt: 550,
    unit: "browser API calls"
  },
  storageEvents: {
    aLotAt: 170,
    unit: "storage events"
  }
};

for (const value of Object.values(metrics)) Object.freeze(value);

export const OVERVIEW_ACTIVITY_BASELINE = Object.freeze({
  sampleSize: 8,
  durationSeconds: 60,
  metrics: Object.freeze(metrics)
});

export function classifyOverviewActivity(metricName, value) {
  const baseline = OVERVIEW_ACTIVITY_BASELINE.metrics[metricName];
  if (!baseline) throw new TypeError(`Unknown overview metric: ${metricName}`);

  const numericValue = Number(value);
  const count = Number.isFinite(numericValue) && numericValue > 0
    ? Math.floor(numericValue)
    : 0;
  const isHigh = count >= baseline.aLotAt;

  return {
    count,
    isHigh,
    // Retained for compatibility with callers created before the clearer High label.
    isALot: isHigh,
    level: isHigh ? "high" : "typical",
    label: isHigh ? "High" : "Typical",
    description: `${count} ${baseline.unit}. ${isHigh ? "High" : "Typical"} activity volume.`
  };
}
