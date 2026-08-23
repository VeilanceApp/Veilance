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
    return originalFetch(value, options);
  };

  const localBacking = {};
  const sessionBacking = {};
  const onMessage = eventSlot();
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
      sendMessage: async () => {},
      get: async () => ({ url: "https://example.com" })
    },
    runtime: {
      onMessage,
      onInstalled: eventSlot(),
      getManifest: () => ({ version: "0.4.1" }),
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

  globalThis.fetch = originalFetch;
  delete globalThis.chrome;
});
