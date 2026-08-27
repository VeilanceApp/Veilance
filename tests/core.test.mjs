import test from "node:test";
import assert from "node:assert/strict";

import {
  addNetworkRequest,
  addPageSignal,
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
