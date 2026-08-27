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
    unit: "API signals"
  },
  storageEvents: {
    aLotAt: 170,
    unit: "storage events"
  }
};

for (const value of Object.values(metrics)) Object.freeze(value);

export const OVERVIEW_ACTIVITY_BASELINE = Object.freeze({
  sampleSize: 8,
  metrics: Object.freeze(metrics)
});

export function classifyOverviewActivity(metricName, value) {
  const baseline = OVERVIEW_ACTIVITY_BASELINE.metrics[metricName];
  if (!baseline) throw new TypeError(`Unknown overview metric: ${metricName}`);

  const numericValue = Number(value);
  const count = Number.isFinite(numericValue) && numericValue > 0
    ? Math.floor(numericValue)
    : 0;
  const isALot = count >= baseline.aLotAt;

  return {
    count,
    isALot,
    level: isALot ? "a-lot" : "baseline",
    label: isALot ? "A lot" : "Baseline",
    thresholdText: `A lot starts at ${baseline.aLotAt}`,
    description: `${count} ${baseline.unit}. “A lot” starts at ${baseline.aLotAt} in the ${OVERVIEW_ACTIVITY_BASELINE.sampleSize}-site short-load baseline.`
  };
}
