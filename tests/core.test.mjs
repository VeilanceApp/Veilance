import test from "node:test";
import assert from "node:assert/strict";

import {
  addNetworkRequest,
  addPageSignal,
  buildFindings,
  buildSanitizedPayload,
  classifyTrackerHost,
  containsForbiddenPayloadKey,
  createEmptyState,
  isThirdParty,
  registrableDomain,
  safePageIdentity,
  sanitizeEventDetail,
  summarizeState
} from "../lib/core.js";

test("page identity retains only origin-level data", () => {
  assert.deepEqual(safePageIdentity("https://example.com/private/path?q=secret#fragment"), {
    origin: "https://example.com",
    hostname: "example.com",
    protocol: "https:",
    port: null
  });
});

test("registrable-domain comparison handles common multipart suffixes", () => {
  assert.equal(registrableDomain("cdn.shop.example.co.uk"), "example.co.uk");
  assert.equal(isThirdParty("metrics.example.co.uk", "www.example.co.uk"), false);
  assert.equal(isThirdParty("metrics.other.co.uk", "www.example.co.uk"), true);
});

test("known service matching is explicit and non-malicious", () => {
  assert.deepEqual(classifyTrackerHost("www.google-analytics.com"), {
    domain: "google-analytics.com",
    label: "Google Analytics",
    category: "analytics"
  });
  assert.equal(classifyTrackerHost("unknown.example"), null);
});

test("network aggregation counts third-party requests and known services", () => {
  const state = createEmptyState(7, "https://shop.example.com/account?token=secret", 1000);
  addNetworkRequest(state, { url: "https://shop.example.com/app.js", type: "script" }, 1100);
  addNetworkRequest(state, { url: "https://www.google-analytics.com/g/collect?cid=secret", type: "xmlhttprequest" }, 1200);
  assert.equal(state.network.totalRequests, 2);
  assert.equal(state.network.firstPartyRequests, 1);
  assert.equal(state.network.thirdPartyRequests, 1);
  assert.equal(state.network.trackers["google-analytics.com"].count, 1);
});

test("event detail removes sensitive values", () => {
  const clean = sanitizeEventDetail({
    permission: "camera",
    destinationHost: "telemetry.example",
    value: "secret",
    password: "secret",
    path: "/private",
    query: "token=secret"
  });
  assert.deepEqual(clean, {
    permission: "camera",
    destinationHost: "telemetry.example"
  });
});

test("audio fingerprinting requires a pattern, not a single generic call", () => {
  const state = createEmptyState(1, "https://example.com", 1000);
  addPageSignal(state, { kind: "fingerprinting", api: "AudioContext", action: "offline-render" }, 1100);
  assert.equal(buildFindings(state)[0].id, "offline-audio");
  addPageSignal(state, { kind: "fingerprinting", api: "AudioBuffer", action: "read-buffer" }, 1200);
  assert.equal(buildFindings(state)[0].id, "audio-fingerprint-pattern");
  assert.equal(summarizeState(state).status, "active");
});

test("sanitized payload excludes paths, query strings, values, and coordinates", () => {
  const state = createEmptyState(2, "https://example.com/private?q=secret", 1000);
  addPageSignal(state, {
    kind: "sensitive-api",
    api: "Geolocation",
    action: "get-position",
    detail: { latitude: 35.1, longitude: -97.4, value: "secret" }
  }, 1100);
  const payload = buildSanitizedPayload(state, "0.1.0", 1200);
  const text = JSON.stringify(payload);
  assert.equal(payload.site.origin, "https://example.com");
  assert.equal(text.includes("/private"), false);
  assert.equal(text.includes("q=secret"), false);
  assert.equal(text.includes("35.1"), false);
  assert.equal(text.includes("-97.4"), false);
  assert.equal(text.includes('"value":"secret"'), false);
  assert.equal(containsForbiddenPayloadKey(payload), false);
});
