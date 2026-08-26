import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  ensureTelemetryClientIdentity,
  LEGACY_TELEMETRY_CONTRIBUTOR_ID_STORAGE_KEY,
  TELEMETRY_CLIENT_ID_STORAGE_KEY
} from "../lib/telemetry-client-id.js";

function storageArea(backing) {
  return {
    async get(keys) {
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter((name) => name in backing).map((name) => [name, backing[name]]));
    },
    async set(values) {
      Object.assign(backing, values);
    }
  };
}

function deterministicCrypto(byte) {
  return {
    subtle: webcrypto.subtle,
    getRandomValues(target) {
      target.fill(byte);
      return target;
    }
  };
}

function chromeNavigator(version = "154.0.0.0") {
  return {
    platform: "Win32",
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/${version} Safari/537.36`,
    userAgentData: {
      platform: "Windows",
      brands: [
        { brand: "Not_A Brand", version: "99" },
        { brand: "Chromium", version: version.split(".")[0] },
        { brand: "Google Chrome", version: version.split(".")[0] }
      ]
    }
  };
}

function platformRuntime(os = "win") {
  return {
    async getPlatformInfo() {
      return { os, arch: "x86-64", nacl_arch: "x86-64" };
    }
  };
}

test("telemetry client id is created once and ignores routine browser version updates", async () => {
  const backing = {};
  const first = await ensureTelemetryClientIdentity({
    storageArea: storageArea(backing),
    runtime: platformRuntime(),
    navigatorObject: chromeNavigator("154.0.0.0"),
    cryptoObject: deterministicCrypto(0x11)
  });
  assert.equal(first.status, "created");
  assert.equal(first.clientId, "11".repeat(32));
  assert.equal(backing[LEGACY_TELEMETRY_CONTRIBUTOR_ID_STORAGE_KEY], first.clientId);
  assert.deepEqual(Object.keys(backing[TELEMETRY_CLIENT_ID_STORAGE_KEY]).sort(), [
    "clientId", "environmentHash", "schemaVersion"
  ]);

  const afterBrowserUpdate = await ensureTelemetryClientIdentity({
    storageArea: storageArea(backing),
    runtime: platformRuntime(),
    navigatorObject: chromeNavigator("155.0.0.0"),
    cryptoObject: deterministicCrypto(0x22)
  });
  assert.equal(afterBrowserUpdate.status, "existing");
  assert.equal(afterBrowserUpdate.clientId, first.clientId);
});

test("telemetry client id rotates when the browser family or platform changes", async () => {
  const backing = {};
  const first = await ensureTelemetryClientIdentity({
    storageArea: storageArea(backing),
    runtime: platformRuntime("win"),
    navigatorObject: chromeNavigator(),
    cryptoObject: deterministicCrypto(0x11)
  });

  const edgeNavigator = {
    ...chromeNavigator(),
    userAgent: `${chromeNavigator().userAgent} Edg/154.0.0.0`,
    userAgentData: {
      platform: "Windows",
      brands: [{ brand: "Microsoft Edge", version: "154" }]
    }
  };
  const afterBrowserChange = await ensureTelemetryClientIdentity({
    storageArea: storageArea(backing),
    runtime: platformRuntime("win"),
    navigatorObject: edgeNavigator,
    cryptoObject: deterministicCrypto(0x22)
  });
  assert.equal(afterBrowserChange.status, "rotated");
  assert.equal(afterBrowserChange.clientId, "22".repeat(32));
  assert.notEqual(afterBrowserChange.clientId, first.clientId);

  const afterPlatformChange = await ensureTelemetryClientIdentity({
    storageArea: storageArea(backing),
    runtime: platformRuntime("linux"),
    navigatorObject: edgeNavigator,
    cryptoObject: deterministicCrypto(0x33)
  });
  assert.equal(afterPlatformChange.status, "rotated");
  assert.equal(afterPlatformChange.clientId, "33".repeat(32));
  assert.notEqual(afterPlatformChange.clientId, afterBrowserChange.clientId);
});

test("an existing contributor id migrates without changing the user's identity", async () => {
  const legacyId = "ab".repeat(32);
  const backing = { [LEGACY_TELEMETRY_CONTRIBUTOR_ID_STORAGE_KEY]: legacyId };
  const identity = await ensureTelemetryClientIdentity({
    storageArea: storageArea(backing),
    runtime: platformRuntime(),
    navigatorObject: chromeNavigator(),
    cryptoObject: deterministicCrypto(0x44)
  });

  assert.equal(identity.status, "migrated");
  assert.equal(identity.clientId, legacyId);
  assert.equal(backing[TELEMETRY_CLIENT_ID_STORAGE_KEY].clientId, legacyId);
});
