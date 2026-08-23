import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

import {
  PAYOUTS_ENABLED,
  TELEMETRY_UPLOAD_ENABLED,
  TELEMETRY_UPLOAD_ENDPOINT
} from "../config.js";

test("telemetry uploading remains disabled until a server is configured", () => {
  assert.equal(TELEMETRY_UPLOAD_ENABLED, false);
  assert.equal(TELEMETRY_UPLOAD_ENDPOINT, "");
  assert.equal(PAYOUTS_ENABLED, false);
});

test("popup removes telemetry JSON export and visibly disables payouts", async () => {
  const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /Export JSON/i);
  assert.doesNotMatch(html, /id="exportButton"/);
  assert.match(html, /id="payoutButton"[^>]*disabled/);
  assert.match(html, /Last 20 visits/);
});

test("settings exposes indicator folders, wallet export, and disabled payouts", async () => {
  const html = await readFile(new URL("../settings.html", import.meta.url), "utf8");
  assert.match(html, /webkitdirectory/);
  assert.match(html, /id="downloadStarterButton"/);
  assert.match(html, /id="copySignalTemplateButton"/);
  assert.match(html, /id="copyVeilanceTemplateButton"/);
  assert.match(html, /Veilance JSON tracker format/);
  assert.match(html, /Indicator file format and matching guide/);
  assert.match(html, /Export private key/);
  assert.match(html, /id="settingsPayoutButton"[^>]*disabled/);
  assert.match(html, /does not block, spoof, or change/i);
});

test("manifest enables visit lifecycle observation and local SQLite WASM", async () => {
  const raw = await readFile(new URL("../manifest.json", import.meta.url), "utf8");
  const manifest = JSON.parse(raw);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.4.1");
  assert.ok(manifest.permissions.includes("webRequest"));
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.options_ui.page, "settings.html");
  assert.match(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/);
  assert.ok(manifest.content_scripts.some((entry) => entry.world === "MAIN"));
  assert.equal(JSON.stringify(manifest).includes("http://localhost"), false);
});

test("official SQLite runtime assets are bundled locally", async () => {
  const wasmUrl = new URL("../vendor/sqlite/sqlite3.wasm", import.meta.url);
  const wasm = await readFile(wasmUrl);
  assert.equal(wasm.subarray(0, 4).toString("hex"), "0061736d");
  assert.ok((await stat(wasmUrl)).size > 500000);
  const source = await readFile(new URL("../vendor/sqlite/sqlite3.mjs", import.meta.url), "utf8");
  assert.match(source, /SQLITE_VERSION "3\.53\.0"/);
});
