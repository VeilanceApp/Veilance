import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
  globalThis.fetch = async (value, options) => {
    const url = typeof value === "string" ? value : value.url;
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
  assert.equal(settings.snapshotUpload.available, false);
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

  const captured = await dispatch(
    { type: "VEILANCE_CREATE_TELEMETRY_SNAPSHOT", tabId: 7 },
    { url: "chrome-extension://veilance-test/popup.html" }
  );
  assert.equal(captured.ok, true);
  assert.equal(captured.snapshot.hostname, "example.com");
  assert.equal(captured.snapshot.interest.score, 20);

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
  assert.equal(snapshot.snapshot.payload.interest.score, 20);
  assert.equal(snapshot.snapshot.payload.interest.eligible, true);
  assert.equal(snapshotText.includes("/private"), false);
  assert.equal(snapshotText.includes("q=secret"), false);
  assert.equal(snapshotText.includes("wallet"), false);

  await new Promise((resolve) => setTimeout(resolve, 250));
  globalThis.fetch = originalFetch;
  delete globalThis.chrome;
});
