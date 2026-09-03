import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVITY_TIMELINE_MAX_EVENTS,
  addNetworkRequest,
  addPageSignal,
  addProtectionEvent,
  applyPageIdentity,
  buildFindings,
  buildSanitizedPayload,
  buildTelemetrySnapshot,
  classifyTrackerHost,
  completeVisit,
  containsForbiddenPayloadKey,
  createEmptyState,
  isThirdParty,
  isPublicTelemetryHostname,
  isRedactedHtmlSafe,
  registrableDomain,
  REQUEST_TIMELINE_BUCKET_MS,
  safePageIdentity,
  sanitizeEventDetail,
  scoreTelemetryInterest,
  SNAPSHOT_INTEREST_MINIMUM,
  summarizeState,
  validateTelemetrySnapshot
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
  assert.deepEqual(state.network.requestTimeline.buckets["0"], {
    offsetMs: 0,
    total: 2,
    firstParty: 1,
    thirdParty: 1
  });
});

test("request timeline keeps bounded five-second first and third-party buckets", () => {
  const state = createEmptyState(13, "https://example.com", 1_000);
  addNetworkRequest(state, { url: "https://example.com/app.js", type: "script" }, 2_000);
  addNetworkRequest(state, { url: "https://analytics.example.net/a", type: "fetch" }, 7_200);
  assert.equal(state.network.requestTimeline.bucketMs, REQUEST_TIMELINE_BUCKET_MS);
  assert.equal(state.network.requestTimeline.buckets["0"].firstParty, 1);
  assert.deepEqual(state.network.requestTimeline.buckets["1"], {
    offsetMs: 5_000,
    total: 1,
    firstParty: 0,
    thirdParty: 1
  });
  assert.equal("requestTimeline" in buildSanitizedPayload(state, "0.7", 8_000), false);
  assert.equal("requestTimeline" in buildSanitizedPayload(state, "0.7", 8_000).observation, false);
  assert.equal("activityTimeline" in buildSanitizedPayload(state, "0.7", 8_000), false);
  assert.equal("activityTimeline" in buildSanitizedPayload(state, "0.7", 8_000).observation, false);
});

test("local activity timeline keeps event timing and categories without URL paths or private values", () => {
  const state = createEmptyState(14, "https://example.com/private?account=secret", 1_000);
  addNetworkRequest(state, {
    url: "https://www.google-analytics.com/collect?account=secret",
    type: "xmlhttprequest",
    method: "POST"
  }, 1_150);
  addPageSignal(state, {
    indicatorId: "geolocation",
    kind: "sensitive-api",
    api: "Geolocation",
    action: "get-position",
    detail: { latitude: 35.4, longitude: -97.5, permission: "geolocation" }
  }, 1_300);
  addProtectionEvent(state, {
    ruleId: "canvas-test",
    indicatorId: "canvas",
    api: "Canvas",
    surface: "Canvas export",
    action: "export",
    technique: "Canvas farbling",
    changedUnits: 4,
    timestamp: 1_450
  }, 1_450);

  assert.deepEqual(state.activityTimeline.events.map((event) => event.category), ["tracker", "permission", "shield"]);
  assert.equal(state.activityTimeline.events[0].host, "www.google-analytics.com");
  assert.equal(state.activityTimeline.events[0].resourceType, "xmlhttprequest");
  assert.equal(state.activityTimeline.events[0].method, "POST");
  assert.equal(state.activityTimeline.events[1].detail.permission, "geolocation");
  assert.equal("latitude" in state.activityTimeline.events[1].detail, false);
  assert.equal("longitude" in state.activityTimeline.events[1].detail, false);
  const serialized = JSON.stringify(state.activityTimeline);
  assert.equal(serialized.includes("/collect"), false);
  assert.equal(serialized.includes("secret"), false);
});

test("local activity timeline is bounded", () => {
  const state = createEmptyState(15, "https://example.com", 1_000);
  for (let index = 0; index < ACTIVITY_TIMELINE_MAX_EVENTS + 5; index += 1) {
    addNetworkRequest(state, { url: `https://host-${index}.outside.test/file`, type: "script" }, 1_100);
  }
  assert.equal(state.activityTimeline.events.length, ACTIVITY_TIMELINE_MAX_EVENTS);
  assert.equal(state.activityTimeline.droppedEvents, 5);
});

test("a visit keeps one identity across redirects and records a definite end", () => {
  const state = createEmptyState(4, "http://example.com", 1000, {
    visitId: "visit-1",
    navigationId: "navigation-1"
  });
  addNetworkRequest(state, { url: "http://example.com", type: "main_frame" }, 1050);
  applyPageIdentity(state, "https://www.example.com/final?secret=yes", 1100);
  addNetworkRequest(state, { url: "https://www.example.com/app.js", type: "script" }, 1200);
  completeVisit(state, 1600);
  assert.equal(state.visitId, "visit-1");
  assert.equal(state.hostname, "www.example.com");
  assert.equal(state.network.totalRequests, 2);
  assert.equal(state.startedAt, 1000);
  assert.equal(state.endedAt, 1600);
  assert.equal(state.active, false);
});

test("known tracker matching can be disabled without disabling request counts", () => {
  const state = createEmptyState(8, "https://example.com", 1000);
  addNetworkRequest(
    state,
    { url: "https://www.google-analytics.com/g/collect", type: "xmlhttprequest" },
    1100,
    { trackersEnabled: false }
  );
  assert.equal(state.network.totalRequests, 1);
  assert.deepEqual(state.network.trackers, {});
});

test("duplicate protection events are stacked by fingerprint surface", () => {
  const state = createEmptyState(11, "https://example.com", 1000);
  addProtectionEvent(state, {
    indicatorId: "canvas",
    api: "CanvasRenderingContext2D",
    matchedActions: ["readback"],
    surface: "Canvas 2D",
    action: "Canvas export",
    changedUnits: 4,
    returnedValue: { kind: "array", type: "Uint8ClampedArray", length: 8, sample: [1, 2, 3, 4], truncated: true },
    timestamp: 1100
  }, 1100);
  addProtectionEvent(state, {
    indicatorId: "canvas",
    api: "CanvasRenderingContext2D",
    matchedActions: ["readback"],
    surface: "Canvas 2D",
    action: "Pixel readback",
    changedUnits: 1,
    returnedValue: { kind: "scalar", type: "number", value: 24 },
    timestamp: 1200
  }, 1200);
  addProtectionEvent(state, {
    surface: "WebGL",
    action: "Pixel readback",
    timestamp: 1300
  }, 1300);

  assert.equal(state.protections.total, 3);
  assert.equal(state.protections.events.length, 2);
  const canvas = state.protections.events.find((entry) => entry.surface === "Canvas 2D");
  assert.equal(canvas.count, 2);
  assert.equal(canvas.firstProtectedAt, 1100);
  assert.equal(canvas.lastProtectedAt, 1200);
  assert.equal(canvas.indicatorId, "canvas");
  assert.equal(canvas.api, "CanvasRenderingContext2D");
  assert.deepEqual(canvas.matchedActions, ["readback"]);
  assert.equal(canvas.changedUnits, 1);
  assert.equal(canvas.totalChangedUnits, 5);
  assert.deepEqual(canvas.returnedValue, { kind: "scalar", type: "number", value: 24 });
});

test("different Shield rules on one surface keep separate activity entries", () => {
  const state = createEmptyState(12, "https://example.com", 1000);
  addProtectionEvent(state, {
    ruleId: "canvas-to-data-url",
    surface: "Canvas export",
    technique: "Canvas data URL export farbling",
    explanation: "Protected a data URL export.",
    timestamp: 1100
  }, 1100);
  addProtectionEvent(state, {
    ruleId: "canvas-to-blob",
    surface: "Canvas export",
    technique: "Canvas blob export farbling",
    explanation: "Protected a blob export.",
    timestamp: 1200
  }, 1200);
  assert.equal(state.protections.events.length, 2);
  assert.deepEqual(new Set(state.protections.events.map((event) => event.ruleId)), new Set([
    "canvas-to-data-url",
    "canvas-to-blob"
  ]));
  assert.ok(state.protections.events.every((event) => event.explanation));
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

test("multiple characteristic groups produce a broad fingerprint finding", () => {
  const state = createEmptyState(5, "https://example.com", 1000);
  addPageSignal(state, {
    indicatorId: "navigator-characteristics",
    kind: "fingerprinting",
    api: "Navigator",
    action: "read-hardware-concurrency"
  }, 1100);
  addPageSignal(state, {
    indicatorId: "screen-characteristics",
    kind: "fingerprinting",
    api: "Screen",
    action: "read-width"
  }, 1200);
  addPageSignal(state, {
    indicatorId: "font-probing",
    kind: "fingerprinting",
    api: "Canvas2D",
    action: "measure-text"
  }, 1300);
  assert.ok(buildFindings(state).some((finding) => finding.id === "broad-fingerprint-surface"));
});

test("sensitive local API signals produce transparent high-severity findings", () => {
  const state = createEmptyState(6, "https://example.com", 1000);
  addPageSignal(state, {
    indicatorId: "file-system-access",
    kind: "sensitive-api",
    api: "FileSystem",
    action: "directory-picker"
  }, 1100);
  const finding = buildFindings(state).find((item) => item.id === "file-system-access");
  assert.equal(finding.severity, "high");
  assert.match(finding.description, /never retains file names or contents/i);
});

test("sanitized payload excludes paths, query strings, values, and coordinates", () => {
  const state = createEmptyState(2, "https://example.com/private?q=secret", 1000);
  addPageSignal(state, {
    indicatorId: "geolocation",
    kind: "sensitive-api",
    api: "Geolocation",
    action: "get-position",
    detail: { latitude: 35.1, longitude: -97.4, value: "secret" }
  }, 1100);
  const payload = buildSanitizedPayload(state, "0.1.0", 1200);
  const text = JSON.stringify(payload);
  assert.deepEqual(payload.site, { hostname: "example.com", https: true });
  assert.equal(payload.schemaVersion, "veilance.telemetry.v1");
  assert.equal("origin" in payload.site, false);
  assert.equal("findings" in payload, false);
  assert.equal("detail" in payload.signals[0], false);
  assert.equal(text.includes("/private"), false);
  assert.equal(text.includes("q=secret"), false);
  assert.equal(text.includes("35.1"), false);
  assert.equal(text.includes("-97.4"), false);
  assert.equal(text.includes('"value":"secret"'), false);
  assert.equal(containsForbiddenPayloadKey(payload), false);
});

test("remote signal reducer drops page-injected API and action strings outside the explicit allowlist", () => {
  const state = createEmptyState(9, "https://example.com", 1000);
  addPageSignal(state, {
    indicatorId: "canvas",
    kind: "fingerprinting",
    api: "Canvas",
    action: "export"
  }, 1100);
  addPageSignal(state, {
    indicatorId: "canvas",
    kind: "fingerprinting",
    api: "account@example.com",
    action: "session-secret-value"
  }, 1200);
  const payload = buildSanitizedPayload(state, "0.6.0", 1300, { eventId: "allowed-event-1" });
  assert.deepEqual(payload.signals, [{
    indicatorId: "canvas",
    api: "Canvas",
    action: "export",
    count: 1
  }]);
  assert.equal(JSON.stringify(payload).includes("session-secret-value"), false);
  assert.equal(JSON.stringify(payload).includes("account@example.com"), false);
});

test("telemetry eligibility blocks browser-local and private network hosts", () => {
  assert.equal(isPublicTelemetryHostname("example.com"), true);
  assert.equal(isPublicTelemetryHostname("localhost"), false);
  assert.equal(isPublicTelemetryHostname("router.local"), false);
  assert.equal(isPublicTelemetryHostname("127.0.0.1"), false);
  assert.equal(isPublicTelemetryHostname("10.1.2.3"), false);
  assert.equal(isPublicTelemetryHostname("172.16.20.4"), false);
  assert.equal(isPublicTelemetryHostname("192.168.1.50"), false);
  assert.equal(isPublicTelemetryHostname("::1"), false);
  assert.equal(isPublicTelemetryHostname("::ffff:192.168.1.50"), false);
});

test("snapshot interest keeps routine visits below the capture threshold", () => {
  const state = createEmptyState(10, "https://quiet.example", 1000);
  const interest = scoreTelemetryInterest(state);
  assert.equal(interest.score, 0);
  assert.equal(interest.level, "routine");
  assert.equal(interest.minimumScore, SNAPSHOT_INTEREST_MINIMUM);
  assert.equal(interest.eligible, false);
  assert.throws(() => buildTelemetrySnapshot(state, {
    format: "veilance.redacted-html.v1",
    hostname: "quiet.example",
    https: true,
    html: "<!doctype html>\n<html><body>[REDACTED TEXT]</body></html>",
    truncated: false,
    originalElementCount: 2,
    redaction: { textNodesRedacted: 1 },
    resourceHosts: [],
    inlineScriptHints: {},
    domMarkers: {}
  }, "0.6.0", 1200, { eventId: "quiet-event-1" }), /routine activity \(0\/100 interest\)/i);
});

test("local snapshot adds only safety-validated redacted HTML and evidence counters", () => {
  const state = createEmptyState(3, "https://example.com/private?q=secret", 1000);
  addNetworkRequest(state, { url: "https://tracker.example/pixel?id=secret", type: "image" }, 1050);
  addPageSignal(state, {
    indicatorId: "canvas",
    kind: "fingerprinting",
    api: "Canvas",
    action: "export",
    detail: { value: "secret" }
  }, 1100);
  addPageSignal(state, {
    indicatorId: "geolocation",
    kind: "permission",
    api: "Geolocation",
    action: "get-position",
    detail: { latitude: 12.34, longitude: 56.78 }
  }, 1110);
  const documentCapture = {
    format: "veilance.redacted-html.v1",
    hostname: "example.com",
    https: true,
    html: '<!doctype html>\n<html><body data-veilance-markers="advertising">[REDACTED TEXT]<script type="application/veilance-redacted" data-veilance-inline="redacted" data-veilance-api-hints="canvas">[REDACTED INLINE SCRIPT]</script></body></html>',
    truncated: false,
    originalElementCount: 4,
    redaction: { textNodesRedacted: 1, inlineScriptsRedacted: 1 },
    resourceHosts: [{ host: "tracker.example", thirdParty: true, count: 1, tags: { img: 1 } }],
    inlineScriptHints: { canvas: 1 },
    domMarkers: { advertising: 1 }
  };
  assert.equal(isRedactedHtmlSafe(documentCapture.html), true);
  const snapshot = buildTelemetrySnapshot(state, documentCapture, "0.6.0", 1200, {
    eventId: "snapshot-event-1",
    trackers: [{ id: "example-tracker", category: "advertising", requests: 1 }]
  });
  assert.equal(snapshot.schemaVersion, "veilance.telemetry-snapshot.v2");
  assert.equal(snapshot.eventId, "snapshot-event-1");
  assert.equal(snapshot.interest.score, 35);
  assert.equal(snapshot.interest.level, "interesting");
  assert.equal(snapshot.interest.eligible, true);
  assert.equal(snapshot.interest.reasons[0].id, "geolocation");
  assert.ok(snapshot.interest.reasons.some((reason) => reason.id === "canvas-readback"));
  assert.equal(snapshot.trackers[0].id, "example-tracker");
  assert.equal(snapshot.redactedDocument.evidence.inlineScriptHints.canvas, 1);
  assert.equal(validateTelemetrySnapshot(snapshot), true);
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  assert.equal(validateTelemetrySnapshot({ ...snapshot, analystNote: "account-secret" }), false);
  assert.equal(validateTelemetrySnapshot({
    ...snapshot,
    signals: [...snapshot.signals, {
      indicatorId: "canvas",
      api: "account@example.com",
      action: "secret-value",
      count: 1
    }]
  }), false);
  assert.equal(validateTelemetrySnapshot({
    ...snapshot,
    interest: { ...snapshot.interest, score: 21 }
  }), false);
});

test("redacted HTML safety validator refuses text or executable attributes", () => {
  assert.equal(isRedactedHtmlSafe('<!doctype html>\n<html><body>account name</body></html>'), false);
  assert.equal(isRedactedHtmlSafe('<!doctype html>\n<html><body><img src="https://tracker.example/pixel"></body></html>'), false);
  assert.equal(isRedactedHtmlSafe('<!doctype html>\n<html><body onload="steal()"></body></html>'), false);
  assert.equal(isRedactedHtmlSafe('<!doctype html>\n<html><body title="account-name"></body></html>'), false);
  assert.equal(isRedactedHtmlSafe('<!doctype html>\n<html><body data-veilance-note="account-name"></body></html>'), false);
  assert.equal(isRedactedHtmlSafe('<!doctype html>\n<html><body><script>[REDACTED INLINE SCRIPT]</script></body></html>'), false);
});
