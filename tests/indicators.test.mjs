import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { addNetworkRequest, addPageSignal, createEmptyState } from "../lib/core.js";
import {
  BUILT_IN_INDICATORS,
  evaluateCustomIndicators,
  mergeIndicatorSettings,
  parseIndicatorDocuments,
  validateCustomIndicator
} from "../lib/indicators.js";

test("built-in indicator settings default on and retain explicit user choices", () => {
  const settings = mergeIndicatorSettings({ canvas: false });
  assert.equal(settings.canvas, false);
  assert.equal(settings.audio, true);
  assert.equal(Object.keys(settings).length, BUILT_IN_INDICATORS.length);
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
