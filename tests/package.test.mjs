import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

import {
  DETECTION_DATABASE_ARCHIVE,
  DETECTION_DATABASE_FOLDER,
  DETECTION_UPDATE_INTERVAL_MINUTES,
  PAYOUTS_ENABLED,
  TELEMETRY_UPLOAD_ENABLED,
  TELEMETRY_UPLOAD_ENDPOINT,
  TRACKER_DATABASE_ARCHIVE,
  TRACKER_UPDATE_INTERVAL_MINUTES
} from "../config.js";

test("telemetry uploading remains disabled until a server is configured", () => {
  assert.equal(TELEMETRY_UPLOAD_ENABLED, false);
  assert.equal(TELEMETRY_UPLOAD_ENDPOINT, "https://api.veilance.com/v1/telemetry/snapshots");
  assert.equal(PAYOUTS_ENABLED, false);
});

test("popup keeps snapshots local and links to compact payout settings", async () => {
  const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /Export JSON/i);
  assert.doesNotMatch(html, /id="exportButton"/);
  assert.doesNotMatch(html, /class="wallet-card"/);
  assert.match(html, /id="payoutSettingsButton"/);
  assert.match(html, /id="snapshotInterestScore"/);
  assert.match(html, /Last 20 visits/);
  assert.match(html, /id="snapshotButton"/);
  assert.match(html, /redacted HTML/i);
});

test("settings exposes indicator folders, wallet export, and disabled payouts", async () => {
  const html = await readFile(new URL("../settings.html", import.meta.url), "utf8");
  assert.match(html, /role="tablist"/);
  assert.match(html, /data-settings-tab="snapshots"/);
  assert.match(html, /data-settings-tab="wallet"/);
  assert.match(html, /Routine visits below 20 are never snapshotted/i);
  assert.match(html, /webkitdirectory/);
  assert.match(html, /id="downloadStarterButton"/);
  assert.match(html, /id="copySignalTemplateButton"/);
  assert.match(html, /id="copyVeilanceTemplateButton"/);
  assert.match(html, /Veilance JSON tracker format/);
  assert.match(html, /Indicator file format and matching guide/);
  assert.match(html, /id="trackerDatabaseEnabled"/);
  assert.match(html, /id="trackerAutoUpdateEnabled"/);
  assert.match(html, /id="checkTrackerUpdatesButton"/);
  assert.match(html, /id="trackerUpdateLog"/);
  assert.match(html, /Export private key/);
  assert.match(html, /id="settingsPayoutButton"[^>]*disabled/);
  assert.match(html, /id="snapshotUploadConsent"[^>]*disabled/);
  assert.match(html, /id="snapshotList"/);
  assert.match(html, /id="snapshotHtmlPreview"/);
  assert.match(html, /private\/internal hosts/i);
  assert.match(html, /does not block, spoof, or change/i);
});

test("popup and Settings scripts reference elements that exist in their pages", async () => {
  for (const name of ["popup", "settings"]) {
    const [html, source] = await Promise.all([
      readFile(new URL(`../${name}.html`, import.meta.url), "utf8"),
      readFile(new URL(`../${name}.js`, import.meta.url), "utf8")
    ]);
    const ids = [...source.matchAll(/querySelector\("#([a-zA-Z0-9_-]+)"\)/g)].map((match) => match[1]);
    for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), `${name}.html should contain #${id}`);
  }
});

test("popup and Settings expose one persistent light and dark appearance preference", async () => {
  const [popup, settings] = await Promise.all([
    readFile(new URL("../popup.html", import.meta.url), "utf8"),
    readFile(new URL("../settings.html", import.meta.url), "utf8")
  ]);
  assert.match(popup, /id="themeToggle"/);
  assert.match(settings, /data-theme-option="system"/);
  assert.match(settings, /data-theme-option="light"/);
  assert.match(settings, /data-theme-option="dark"/);

  const originalChrome = globalThis.chrome;
  const originalDocument = globalThis.document;
  const stored = { veilanceUiTheme: "dark" };
  globalThis.document = { documentElement: { dataset: {}, style: {} } };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: stored[key] }),
        set: async (values) => Object.assign(stored, values)
      },
      onChanged: { addListener() {} }
    }
  };

  try {
    const moduleUrl = new URL(`../lib/theme.js?test=${Date.now()}`, import.meta.url);
    const theme = await import(moduleUrl.href);
    const initial = await theme.initializeTheme();
    assert.deepEqual(initial, { preference: "dark", resolved: "dark" });
    assert.equal(globalThis.document.documentElement.dataset.theme, "dark");
    await theme.setThemePreference("light");
    assert.equal(stored.veilanceUiTheme, "light");
    assert.equal(globalThis.document.documentElement.dataset.theme, "light");
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("manifest enables visit lifecycle observation and local SQLite WASM", async () => {
  const raw = await readFile(new URL("../manifest.json", import.meta.url), "utf8");
  const manifest = JSON.parse(raw);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.6.0");
  assert.ok(manifest.permissions.includes("webRequest"));
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("alarms"));
  assert.ok(manifest.permissions.includes("unlimitedStorage"));
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.options_ui.page, "settings.html");
  assert.match(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/);
  assert.ok(manifest.content_scripts.some((entry) => entry.world === "MAIN"));
  assert.ok(manifest.content_scripts.some((entry) => entry.js?.includes("lib/redacted-html.js")));
  assert.equal(JSON.stringify(manifest).includes("http://localhost"), false);
});

test("tracker updates use the official database three times per day", async () => {
  assert.equal(TRACKER_UPDATE_INTERVAL_MINUTES, 480);
  assert.match(TRACKER_DATABASE_ARCHIVE, /^https:\/\/codeload\.github\.com\/VeilanceApp\/Veilance-Tracker-DB\//);
  const bundle = JSON.parse(await readFile(new URL("../data/veilance-trackers.json", import.meta.url), "utf8"));
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.records.length, 3330);
  assert.match(bundle.revision, /^[a-f0-9]{40}$/);
});

test("detection fingerprints update from the official database every eight hours", async () => {
  assert.equal(DETECTION_UPDATE_INTERVAL_MINUTES, 480);
  assert.equal(DETECTION_DATABASE_FOLDER, "veilance-json-detections");
  assert.match(DETECTION_DATABASE_ARCHIVE, /^https:\/\/codeload\.github\.com\/VeilanceApp\/Veilance-Detection-DB\//);
  const html = await readFile(new URL("../settings.html", import.meta.url), "utf8");
  assert.match(html, /VeilanceApp\/Veilance-Detection-DB/);
  assert.match(html, /id="detectionAutoUpdateEnabled"/);
  assert.match(html, /id="checkDetectionUpdatesButton"/);
});

test("official SQLite runtime assets are bundled locally", async () => {
  const wasmUrl = new URL("../vendor/sqlite/sqlite3.wasm", import.meta.url);
  const wasm = await readFile(wasmUrl);
  assert.equal(wasm.subarray(0, 4).toString("hex"), "0061736d");
  assert.ok((await stat(wasmUrl)).size > 500000);
  const source = await readFile(new URL("../vendor/sqlite/sqlite3.mjs", import.meta.url), "utf8");
  assert.match(source, /SQLITE_VERSION "3\.53\.0"/);
});
