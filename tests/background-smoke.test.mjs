import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  LEGACY_TELEMETRY_CONTRIBUTOR_ID_STORAGE_KEY,
  TELEMETRY_CLIENT_ID_STORAGE_KEY
} from "../lib/telemetry-client-id.js";

function storageArea(backing) {
  return {
    async get(keys) {
      if (keys === undefined || keys === null) return { ...backing };
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter((name) => name in backing).map((name) => [name, backing[name]]));
    },
    async set(values) {
      Object.assign(backing, values);
    }
  };
}

function eventSlot() {
  return {
    listeners: [],
    addListener(listener) { this.listeners.push(listener); }
  };
}

test("background starts SQLite, creates a wallet, and restricts private export to Settings", async () => {
  const originalFetch = globalThis.fetch;
  let telemetryUploadRequest = null;
  let telemetryIpLookupRequest = null;
  globalThis.fetch = async (value, options) => {
    const url = typeof value === "string" ? value : value.url;
    if (url === "http://10.0.10.211:5132/api/v1/telemetry/ip") {
      telemetryIpLookupRequest = { url, options };
      return new Response(JSON.stringify({
        error: {},
        metadata: { request_id: "req-ip-test" },
        output: { ip_address: "203.0.113.42" }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url === "http://10.0.10.211:5132/api/v1/telemetry/upload") {
      telemetryUploadRequest = { url, options };
      return new Response(JSON.stringify({
        error: {},
        metadata: { request_id: "req-test" },
        output: { ok: true }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.startsWith("file:")) {
      return new Response(await readFile(new URL(url)), {
        headers: { "content-type": url.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" }
      });
    }
    if (url.startsWith("chrome-extension://veilance-test/")) {
      const path = url.slice("chrome-extension://veilance-test/".length);
      return new Response(await readFile(new URL(`../${path}`, import.meta.url)), {
        headers: { "content-type": path.endsWith(".json") ? "application/json" : "application/octet-stream" }
      });
    }
    return originalFetch(value, options);
  };

  const localBacking = {};
  const sessionBacking = {};
  const onMessage = eventSlot();
  const alarms = new Map();
  globalThis.chrome = {
    storage: {
      local: storageArea(localBacking),
      session: storageArea(sessionBacking)
    },
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {},
      setTitle: async () => {}
    },
    webNavigation: {
      onBeforeNavigate: eventSlot(),
      onCommitted: eventSlot(),
      onCompleted: eventSlot()
    },
    webRequest: {
      onBeforeRequest: eventSlot(),
      onHeadersReceived: eventSlot()
    },
    tabs: {
      onUpdated: eventSlot(),
      onRemoved: eventSlot(),
      onActivated: eventSlot(),
      query: async () => [],
      sendMessage: async (_tabId, message) => message?.type === "VEILANCE_CAPTURE_REDACTED_DOCUMENT"
        ? {
            ok: true,
            document: {
              format: "veilance.redacted-html.v1",
              hostname: "example.com",
              https: true,
              html: "<!doctype html>\n<html><body>[REDACTED TEXT]</body></html>",
              truncated: false,
              originalElementCount: 2,
              redaction: { textNodesRedacted: 1 },
              resourceHosts: [],
              inlineScriptHints: {},
              domMarkers: {}
            }
          }
        : undefined,
      get: async () => ({ id: 7, url: "https://example.com/private?q=secret", incognito: false })
    },
    alarms: {
      onAlarm: eventSlot(),
      async get(name) { return alarms.get(name); },
      create(name, details) { alarms.set(name, { name, ...details }); },
      async clear(name) { return alarms.delete(name); }
    },
    runtime: {
      onMessage,
      onInstalled: eventSlot(),
      getManifest: () => ({ version: "0.6.0" }),
      getPlatformInfo: async () => ({ os: "linux", arch: "x86-64", nacl_arch: "x86-64" }),
      getURL: (path) => `chrome-extension://veilance-test/${path}`
    }
  };

  await import(`../background.js?smoke=${Date.now()}`);
  assert.equal(onMessage.listeners.length, 1);
  const dispatch = (message, sender = {}) => new Promise((resolve) => {
    assert.equal(onMessage.listeners[0](message, sender, resolve), true);
  });

  const settings = await dispatch(
    { type: "VEILANCE_GET_SETTINGS" },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(settings.ok, true);
  assert.equal(settings.database.engine, "SQLite WASM");
  assert.equal(settings.database.sqliteVersion, "3.53.0");
  assert.equal(settings.trackerDatabase.trackerCount, 3329);
  assert.equal(settings.trackerDatabase.databaseEnabled, true);
  assert.equal(settings.trackerDatabase.autoUpdateEnabled, true);
  assert.equal(settings.trackerDatabase.updateLog[0].status, "installed");
  assert.equal(settings.detectionDatabase.detectionCount, 0);
  assert.equal(settings.detectionDatabase.databaseEnabled, true);
  assert.equal(settings.detectionDatabase.autoUpdateEnabled, true);
  assert.equal(settings.snapshotUpload.available, true);
  assert.equal(settings.snapshotUpload.automatic, false);
  assert.equal(settings.snapshotCapture.automatic, false);
  assert.equal(settings.snapshotCapture.minimumScore, 25);
  assert.equal(settings.snapshotUpload.endpointHost, "10.0.10.211");
  assert.equal(settings.snapshotUpload.clientIdPresent, true);
  assert.match(localBacking[TELEMETRY_CLIENT_ID_STORAGE_KEY].clientId, /^[a-f0-9]{64}$/);
  assert.equal(
    localBacking[LEGACY_TELEMETRY_CONTRIBUTOR_ID_STORAGE_KEY],
    localBacking[TELEMETRY_CLIENT_ID_STORAGE_KEY].clientId
  );
  assert.equal(settings.database.snapshotCount, 0);
  assert.equal(alarms.get("veilanceTrackerDatabaseUpdateV1").periodInMinutes, 480);
  assert.equal(alarms.get("veilanceDetectionDatabaseUpdateV1").periodInMinutes, 480);
  assert.ok(settings.wallet.publicKey.length >= 32);
  assert.equal("secretKeyBase64" in settings.wallet, false);

  const originalConsoleError = console.error;
  console.error = () => {};
  const blocked = await dispatch(
    { type: "VEILANCE_EXPORT_WALLET" },
    { url: "https://example.com" }
  ).finally(() => { console.error = originalConsoleError; });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /only from Veilance Settings/);

  const exported = await dispatch(
    { type: "VEILANCE_EXPORT_WALLET" },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(exported.ok, true);
  assert.equal(exported.wallet.keypair.length, 64);

  const updatesDisabled = await dispatch(
    { type: "VEILANCE_SET_TRACKER_AUTO_UPDATE", enabled: false },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(updatesDisabled.ok, true);
  assert.equal(updatesDisabled.trackerDatabase.autoUpdateEnabled, false);
  assert.equal(alarms.has("veilanceTrackerDatabaseUpdateV1"), false);

  const detectionUpdatesDisabled = await dispatch(
    { type: "VEILANCE_SET_DETECTION_AUTO_UPDATE", enabled: false },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(detectionUpdatesDisabled.ok, true);
  assert.equal(detectionUpdatesDisabled.detectionDatabase.autoUpdateEnabled, false);
  assert.equal(alarms.has("veilanceDetectionDatabaseUpdateV1"), false);

  chrome.webNavigation.onBeforeNavigate.listeners[0]({
    tabId: 7,
    frameId: 0,
    url: "https://example.com/private?q=secret",
    timeStamp: Date.now()
  });
  await dispatch(
    { type: "VEILANCE_GET_STATE", tabId: 7 },
    { url: "chrome-extension://veilance-test/popup.html" }
  );
  const canvasEvent = await dispatch(
    {
      type: "VEILANCE_PAGE_EVENT",
      pageSessionId: "page-session-1",
      event: {
        indicatorId: "canvas",
        kind: "fingerprinting",
        api: "Canvas",
        action: "export"
      }
    },
    {
      tab: { id: 7, url: "https://example.com/private?q=secret" },
      url: "https://example.com/private?q=secret",
      documentId: "document-1"
    }
  );
  assert.equal(canvasEvent.ok, true);

  const geolocationEvent = await dispatch(
    {
      type: "VEILANCE_PAGE_EVENT",
      pageSessionId: "page-session-1",
      event: {
        indicatorId: "geolocation",
        kind: "permission",
        api: "Geolocation",
        action: "get-position"
      }
    },
    {
      tab: { id: 7, url: "https://example.com/private?q=secret" },
      url: "https://example.com/private?q=secret",
      documentId: "document-1"
    }
  );
  assert.equal(geolocationEvent.ok, true);

  const captured = await dispatch(
    { type: "VEILANCE_CREATE_TELEMETRY_SNAPSHOT", tabId: 7 },
    { url: "chrome-extension://veilance-test/popup.html" }
  );
  assert.equal(captured.ok, true);
  assert.equal(captured.snapshot.hostname, "example.com");
  assert.equal(captured.snapshot.interest.score, 35);

  const snapshotList = await dispatch(
    { type: "VEILANCE_LIST_TELEMETRY_SNAPSHOTS" },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(snapshotList.snapshots.length, 1);
  const snapshot = await dispatch(
    { type: "VEILANCE_GET_TELEMETRY_SNAPSHOT", snapshotId: snapshotList.snapshots[0].snapshotId },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  const snapshotText = JSON.stringify(snapshot.snapshot.payload);
  assert.equal(snapshot.snapshot.payload.schemaVersion, "veilance.telemetry-snapshot.v2");
  assert.equal(snapshot.snapshot.payload.interest.score, 35);
  assert.equal(snapshot.snapshot.payload.interest.eligible, true);
  assert.equal(snapshotText.includes("/private"), false);
  assert.equal(snapshotText.includes("q=secret"), false);
  assert.equal(snapshotText.includes("wallet"), false);

  const consent = await dispatch(
    { type: "VEILANCE_SET_SNAPSHOT_UPLOAD_CONSENT", enabled: true },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(consent.snapshotUpload.consent, true);

  const automatic = await dispatch(
    { type: "VEILANCE_SET_AUTOMATIC_SNAPSHOT_UPLOAD", enabled: true },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(automatic.snapshotUpload.automatic, true);
  assert.equal(automatic.queued, 1);
  assert.equal(localBacking.veilanceTelemetryAutomaticUploadV1, true);

  await new Promise((resolve) => setTimeout(resolve, 2));
  const automaticCapture = await dispatch(
    { type: "VEILANCE_CREATE_TELEMETRY_SNAPSHOT", tabId: 7 },
    { url: "chrome-extension://veilance-test/popup.html" }
  );
  assert.equal(automaticCapture.snapshot.upload.status, "queued");

  const uploadNow = await dispatch(
    { type: "VEILANCE_UPLOAD_TELEMETRY_NOW" },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(uploadNow.uploaded, 2);
  assert.equal(telemetryIpLookupRequest.url, "http://10.0.10.211:5132/api/v1/telemetry/ip");
  assert.equal(telemetryIpLookupRequest.options.method, "GET");
  assert.equal(telemetryIpLookupRequest.options.credentials, "omit");
  assert.equal(telemetryIpLookupRequest.options.redirect, "error");
  assert.equal(telemetryUploadRequest.url, "http://10.0.10.211:5132/api/v1/telemetry/upload");
  assert.equal(telemetryUploadRequest.options.method, "POST");
  assert.ok(telemetryUploadRequest.options.body instanceof FormData);
  assert.equal(
    telemetryUploadRequest.options.body.get("client_id"),
    localBacking[TELEMETRY_CLIENT_ID_STORAGE_KEY].clientId
  );
  assert.equal(telemetryUploadRequest.options.body.get("wallet_address"), settings.wallet.publicKey);
  assert.equal(telemetryUploadRequest.options.body.get("domain_name"), "example.com");
  assert.equal(telemetryUploadRequest.options.body.get("ip_address"), "203.0.113.42");
  assert.equal(telemetryUploadRequest.options.body.get("telemetry").type, "application/gzip");

  const uploadedList = await dispatch(
    { type: "VEILANCE_LIST_TELEMETRY_SNAPSHOTS" },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(uploadedList.snapshots.length, 2);
  assert.ok(uploadedList.snapshots.every((item) => item.upload.status === "uploaded"));

  const automaticCaptureSetting = await dispatch(
    { type: "VEILANCE_SET_AUTOMATIC_SNAPSHOT_CAPTURE", enabled: true },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(automaticCaptureSetting.snapshotCapture.automatic, true);
  assert.equal(automaticCaptureSetting.scheduled, 0);
  assert.equal(localBacking.veilanceTelemetryAutomaticCaptureV1, true);

  const stateWithAutomaticCapture = await dispatch(
    { type: "VEILANCE_GET_STATE", tabId: 7 },
    { url: "chrome-extension://veilance-test/popup.html" }
  );
  assert.equal(stateWithAutomaticCapture.snapshotCapture.automatic, true);

  const consoleErrorBeforeManualCaptureCheck = console.error;
  console.error = () => {};
  const manualCaptureBlocked = await dispatch(
    { type: "VEILANCE_CREATE_TELEMETRY_SNAPSHOT", tabId: 7 },
    { url: "chrome-extension://veilance-test/popup.html" }
  ).finally(() => { console.error = consoleErrorBeforeManualCaptureCheck; });
  assert.equal(manualCaptureBlocked.ok, false);
  assert.match(manualCaptureBlocked.error, /Automatic snapshots are enabled/);

  chrome.webNavigation.onBeforeNavigate.listeners[0]({
    tabId: 7,
    frameId: 0,
    url: "https://example.com/automatic-capture",
    timeStamp: Date.now()
  });
  await dispatch(
    { type: "VEILANCE_GET_STATE", tabId: 7 },
    { url: "chrome-extension://veilance-test/popup.html" }
  );
  const automaticInterestEvent = await dispatch(
    {
      type: "VEILANCE_PAGE_EVENT",
      pageSessionId: "page-session-2",
      event: {
        indicatorId: "geolocation",
        kind: "permission",
        api: "Geolocation",
        action: "get-position"
      }
    },
    {
      tab: { id: 7, url: "https://example.com/automatic-capture" },
      url: "https://example.com/automatic-capture",
      documentId: "document-2"
    }
  );
  assert.equal(automaticInterestEvent.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 450));

  const automaticallyCapturedList = await dispatch(
    { type: "VEILANCE_LIST_TELEMETRY_SNAPSHOTS" },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(automaticallyCapturedList.snapshots.length, 3);
  assert.equal(automaticallyCapturedList.snapshots[0].interest.score, 25);
  assert.equal(automaticallyCapturedList.snapshots[0].upload.status, "queued");

  await dispatch(
    {
      type: "VEILANCE_PAGE_EVENT",
      pageSessionId: "page-session-2",
      event: {
        indicatorId: "geolocation",
        kind: "permission",
        api: "Geolocation",
        action: "watch-position"
      }
    },
    {
      tab: { id: 7, url: "https://example.com/automatic-capture" },
      url: "https://example.com/automatic-capture",
      documentId: "document-2"
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal((await dispatch(
    { type: "VEILANCE_LIST_TELEMETRY_SNAPSHOTS" },
    { url: "chrome-extension://veilance-test/settings.html" }
  )).snapshots.length, 3);

  const automaticCaptureDisabled = await dispatch(
    { type: "VEILANCE_SET_AUTOMATIC_SNAPSHOT_CAPTURE", enabled: false },
    { url: "chrome-extension://veilance-test/settings.html" }
  );
  assert.equal(automaticCaptureDisabled.snapshotCapture.automatic, false);
  assert.equal(localBacking.veilanceTelemetryAutomaticCaptureV1, false);

  await new Promise((resolve) => setTimeout(resolve, 250));
  globalThis.fetch = originalFetch;
  delete globalThis.chrome;
});
