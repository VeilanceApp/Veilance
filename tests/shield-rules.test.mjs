import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  parseManagedShieldDocuments,
  parseManagedShieldRecords,
  runtimeShieldRules,
  SUPPORTED_SHIELD_STRATEGIES,
  validateShieldRule
} from "../lib/shield-rules.js";

const bundle = JSON.parse(await readFile(new URL("../data/veilance-shields.json", import.meta.url), "utf8"));

test("bundled Shield pack contains 30 unique, validated data-only rules", () => {
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.records.length, 30);
  assert.match(bundle.revision, /^[a-f0-9]{64}$/);
  const parsed = parseManagedShieldRecords(bundle.records);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rules.length, 30);
  assert.equal(new Set(parsed.rules.map((rule) => rule.id)).size, 30);
  assert.ok(parsed.rules.every((rule) => SUPPORTED_SHIELD_STRATEGIES.includes(rule.protection.strategy)));
});

test("Shield parser accepts one rule per remote database document", () => {
  const parsed = parseManagedShieldDocuments(bundle.records.slice(0, 3).map((record) => ({
    sourceName: `veilance-json-shields/${record.id}.json`,
    text: JSON.stringify(record)
  })));
  assert.equal(parsed.rules.length, 3);
  assert.equal(parsed.errorCount, 0);
  assert.equal(parsed.sourceCount, 3);
});

test("Shield rules reject remote code strategies and unsafe parameter ranges", () => {
  const base = structuredClone(bundle.records[0]);
  base.protection.strategy = "remote-javascript";
  assert.throws(() => validateShieldRule(base, "bad-strategy.json"), /unsupported protection strategy/i);

  const unsafe = structuredClone(bundle.records.find((rule) => rule.id === "canvas-get-image-data"));
  unsafe.protection.parameters.maximumEdits = 1000000;
  assert.throws(() => validateShieldRule(unsafe, "unsafe.json"), /maximumEdits/i);

  const unsafeMetric = structuredClone(bundle.records.find((rule) => rule.id === "canvas-measure-text"));
  unsafeMetric.protection.parameters.epsilon = 100;
  assert.throws(() => validateShieldRule(unsafeMetric, "unsafe-metric.json"), /epsilon/i);
});

test("cap-number rules can only lower oversized capability values", () => {
  const capRule = bundle.records.find((rule) => rule.id === "webgl-max-texture-size");
  const validated = validateShieldRule(capRule, "webgl-max-texture-size.json");
  assert.equal(validated.protection.strategy, "cap-number");
  assert.equal(validated.protection.parameters.maximum, 4096);
});

test("Shield database rejects duplicate ids and runtime payload omits repository metadata", () => {
  const first = structuredClone(bundle.records[0]);
  const parsed = parseManagedShieldRecords([first, structuredClone(first)]);
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.errorCount, 1);
  assert.match(parsed.errors[0], /duplicate Shield rule id/i);

  const payload = runtimeShieldRules(parsed.rules);
  assert.equal(payload.length, 1);
  assert.deepEqual(Object.keys(payload[0]).sort(), [
    "description", "id", "match", "name", "protection", "surface"
  ]);
  assert.equal("sourceName" in payload[0], false);
});
