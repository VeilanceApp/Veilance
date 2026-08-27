import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { addNetworkRequest, addPageSignal, createEmptyState } from "../lib/core.js";
import {
  BUILT_IN_INDICATORS,
  evaluateCustomIndicators,
  managedDetectionId,
  managedTrackerId,
  mergeIndicatorSettings,
  parseManagedDetectionDocuments,
  parseManagedTrackerRecords,
  parseVeilanceNetworkFilter,
  parseIndicatorDocuments,
  validateCustomIndicator,
  validateVeilanceTrackerIndicator
} from "../lib/indicators.js";

test("built-in indicator settings default on and retain explicit user choices", () => {
  const settings = mergeIndicatorSettings({ canvas: false });
  assert.equal(settings.canvas, false);
  assert.equal(settings.audio, true);
  assert.equal(Object.keys(settings).length, BUILT_IN_INDICATORS.length);
});

test("expanded catalog exposes useful fingerprinting and sensitive API sources", () => {
  const ids = new Set(BUILT_IN_INDICATORS.map((indicator) => indicator.id));
  for (const id of [
    "cookie-access",
    "navigator-characteristics",
    "screen-characteristics",
    "locale-timezone",
    "font-probing",
    "css-media-queries",
    "performance-timing",
    "webgpu",
    "network-information",
    "media-capabilities",
    "connected-devices",
    "device-sensors",
    "credential-management",
    "file-system-access",
    "speech",
    "privacy-sandbox"
  ]) {
    assert.equal(ids.has(id), true, `${id} should be a built-in indicator`);
  }
});

test("the bundled starter pack is valid and importable", async () => {
  const text = await readFile(new URL("../indicator-examples/useful-starter-rules.json", import.meta.url), "utf8");
  const result = parseIndicatorDocuments([{ sourceName: "useful-starter-rules.json", text }]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.indicators.length, 5);
  assert.ok(result.indicators.every((indicator) => indicator.id.startsWith("custom.")));
});

test("folder documents accept one indicator, arrays, and indicators wrappers", () => {
  const result = parseIndicatorDocuments([
    {
      sourceName: "one.json",
      text: JSON.stringify({
        id: "canvas-three",
        name: "Canvas three",
        description: "Canvas readback happened three times.",
        severity: "medium",
        match: { api: "Canvas", action: "readback", minCount: 3 }
      })
    },
    {
      sourceName: "two.json",
      text: JSON.stringify({ indicators: [{
        id: "host",
        name: "Host",
        description: "A local host rule.",
        match: { hostSuffix: "metrics.example" }
      }] })
    }
  ]);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.indicators.map((item) => item.id), ["custom.canvas-three", "custom.host"]);
});

test("Veilance JSON imports domains, metadata, and host-anchored filters", async () => {
  const text = await readFile(new URL("../indicator-examples/veilance-platform161.json", import.meta.url), "utf8");
  const result = parseIndicatorDocuments([{ sourceName: "veilance-platform161.json", text }]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.indicators.length, 1);
  const indicator = result.indicators[0];
  assert.equal(indicator.id, "custom.platform161");
  assert.equal(indicator.sourceFormat, "veilance-json");
  assert.equal(indicator.organization, "platform161");
  assert.equal(indicator.dependsOn, "network-requests");
  assert.equal(indicator.websiteUrl, "https://platform161.com/");
  assert.deepEqual(indicator.match.hosts, ["creative-serving.com", "p161.net"]);
  assert.equal(indicator.match.networkFilters.length, 2);
  assert.ok(indicator.match.networkFilters.every((rule) => rule.thirdParty === true));
});

test("managed detection documents validate flat JSON rules and get stable database ids", () => {
  const documents = [
    {
      sourceName: "veilance-json-detections/repeated-font-probing.json",
      text: JSON.stringify({
        id: "repeated-font-probing",
        name: "Repeated font probing",
        category: "Fingerprinting",
        description: "Font probing happened repeatedly.",
        severity: "medium",
        match: { indicatorId: "font-probing", minCount: 10 }
      })
    },
    {
      sourceName: "veilance-json-detections/automation-flag-probing.json",
      text: JSON.stringify({
        id: "automation-flag-probing",
        name: "Automation flag probing",
        category: "Fingerprinting",
        description: "The page read navigator.webdriver.",
        severity: "medium",
        match: { indicatorId: "navigator-characteristics", api: "Navigator", action: "read-webdriver" }
      })
    }
  ];
  const result = parseManagedDetectionDocuments(documents);
  assert.equal(result.errorCount, 0);
  assert.equal(result.indicators.length, 2);
  assert.equal(result.indicators[0].id, managedDetectionId(documents[0].sourceName));
  assert.ok(result.indicators.every((indicator) => indicator.id.startsWith("detection.")));
  assert.ok(result.indicators.every((indicator) => indicator.managedSource === "detection-database"));
});

test("managed tracker ids remain unique when organizations are shared", () => {
  const records = ["advertising/first.json", "advertising/second.json"].map((path) => ({
    sourceName: `veilance-json-trackers/${path}`,
    tracker: {
      format: "veilance-json",
      name: path,
      organization: "shared-owner",
      domains: [path.replace("advertising/", "").replace(".json", ".example")]
    }
  }));
  const result = parseManagedTrackerRecords(records);
  assert.equal(result.indicators.length, 2);
  assert.equal(new Set(result.indicators.map((indicator) => indicator.id)).size, 2);
  assert.ok(result.indicators.every((indicator) => indicator.id.startsWith("tracker.")));
  assert.equal(managedTrackerId(records[0].sourceName), result.indicators[0].id);
  assert.ok(result.indicators.every((indicator) => indicator.defaultEnabled));
});

test("Veilance third-party filters honor party, resource type, and page-domain constraints", () => {
  const partyOnly = validateVeilanceTrackerIndicator({
    name: "Third-party tracker",
    organization: "third-party-tracker",
    filters: ["||p161.net^$3p"]
  });
  const thirdParty = createEmptyState(19, "https://publisher.example", 1000);
  addNetworkRequest(thirdParty, { url: "https://ads.p161.net/ad.js", type: "script" }, 1100);
  assert.equal(evaluateCustomIndicators(thirdParty, [partyOnly], { [partyOnly.id]: true }).length, 1);
  const sameParty = createEmptyState(18, "https://p161.net", 1000);
  addNetworkRequest(sameParty, { url: "https://ads.p161.net/ad.js", type: "script" }, 1100);
  assert.equal(evaluateCustomIndicators(sameParty, [partyOnly], { [partyOnly.id]: true }).length, 0);

  const indicator = validateVeilanceTrackerIndicator({
    name: "Constrained tracker",
    organization: "constrained-tracker",
    filters: ["||tracker.example^$3p,script,domain=publisher.example|~private.publisher.example"]
  });

  const matching = createEmptyState(20, "https://news.publisher.example", 1000);
  addNetworkRequest(matching, { url: "https://cdn.tracker.example/a.js", type: "script" }, 1100);
  assert.equal(evaluateCustomIndicators(matching, [indicator], { [indicator.id]: true }).length, 1);

  const wrongType = createEmptyState(21, "https://news.publisher.example", 1000);
  addNetworkRequest(wrongType, { url: "https://cdn.tracker.example/pixel.gif", type: "image" }, 1100);
  assert.equal(evaluateCustomIndicators(wrongType, [indicator], { [indicator.id]: true }).length, 0);

  const excludedPage = createEmptyState(22, "https://private.publisher.example", 1000);
  addNetworkRequest(excludedPage, { url: "https://cdn.tracker.example/a.js", type: "script" }, 1100);
  assert.equal(evaluateCustomIndicators(excludedPage, [indicator], { [indicator.id]: true }).length, 0);

  const firstParty = createEmptyState(23, "https://tracker.example", 1000);
  addNetworkRequest(firstParty, { url: "https://cdn.tracker.example/a.js", type: "script" }, 1100);
  assert.equal(evaluateCustomIndicators(firstParty, [indicator], { [indicator.id]: true }).length, 0);
});

test("unsupported Veilance filters are skipped with transparent warnings", () => {
  const parsedFilter = parseVeilanceNetworkFilter("||tracker.example/collect.js$3p");
  assert.equal(parsedFilter.supported, false);
  assert.match(parsedFilter.reason, /host-anchored filters/);

  const result = parseIndicatorDocuments([{
    sourceName: "mixed.json",
    text: JSON.stringify({
      name: "Mixed tracker",
      organization: "mixed-tracker",
      domains: ["tracker.example"],
      filters: ["||tracker.example/collect.js$3p", "@@||tracker.example^"]
    })
  }]);
  assert.equal(result.indicators.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.indicators[0].veilance.skippedFilterCount, 2);

  const unusable = parseIndicatorDocuments([{
    sourceName: "unusable.json",
    text: JSON.stringify({
      name: "Unusable tracker",
      organization: "unusable-tracker",
      filters: ["||tracker.example/path.js$3p"]
    })
  }]);
  assert.equal(unusable.indicators.length, 0);
  assert.match(unusable.errors[0], /host-anchored filters/);
});

test("custom signal indicators evaluate only after their threshold", () => {
  const indicator = validateCustomIndicator({
    id: "canvas-three",
    name: "Canvas three",
    description: "Canvas readback happened three times.",
    severity: "medium",
    match: { api: "Canvas", action: "readback", minCount: 3 }
  });
  const state = createEmptyState(1, "https://example.com", 1000);
  for (let index = 0; index < 2; index += 1) {
    addPageSignal(state, {
      indicatorId: "canvas",
      kind: "fingerprinting",
      api: "Canvas",
      action: "readback"
    }, 1100 + index);
  }
  assert.deepEqual(evaluateCustomIndicators(state, [indicator], { [indicator.id]: true }), []);
  addPageSignal(state, {
    indicatorId: "canvas",
    kind: "fingerprinting",
    api: "Canvas",
    action: "readback"
  }, 1200);
  assert.equal(evaluateCustomIndicators(state, [indicator], { [indicator.id]: true })[0].id, indicator.id);
  assert.deepEqual(evaluateCustomIndicators(state, [indicator], { [indicator.id]: false }), []);
});

test("custom host indicators use hostname suffix boundaries", () => {
  const indicator = validateCustomIndicator({
    id: "metrics-host",
    name: "Metrics host",
    description: "A matching metrics host was contacted.",
    match: { hosts: ["metrics.example"] }
  });
  const state = createEmptyState(2, "https://example.com", 1000);
  addNetworkRequest(state, { url: "https://api.metrics.example/collect", type: "fetch" }, 1100);
  assert.equal(evaluateCustomIndicators(state, [indicator], { [indicator.id]: true }).length, 1);

  const other = createEmptyState(3, "https://example.com", 1000);
  addNetworkRequest(other, { url: "https://notmetrics.example/collect", type: "fetch" }, 1100);
  assert.equal(evaluateCustomIndicators(other, [indicator], { [indicator.id]: true }).length, 0);
});

test("invalid folder files return readable errors without executing content", () => {
  const result = parseIndicatorDocuments([{ sourceName: "broken.json", text: "not json" }]);
  assert.equal(result.indicators.length, 0);
  assert.match(result.errors[0], /broken\.json/);
});

test("every injected signal references a visible built-in indicator", async () => {
  const source = await readFile(new URL("../injected.js", import.meta.url), "utf8");
  const emittedIds = [...source.matchAll(/\bemit\("([a-z0-9.-]+)"/g)].map((match) => match[1]);
  const builtInIds = new Set(BUILT_IN_INDICATORS.map((indicator) => indicator.id));
  assert.ok(emittedIds.length > 20);
  assert.deepEqual([...new Set(emittedIds.filter((id) => !builtInIds.has(id)))], []);
});
