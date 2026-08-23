import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TELEMETRY_UPLOAD_ENABLED,
  TELEMETRY_UPLOAD_ENDPOINT
} from "../config.js";

test("telemetry uploading is disabled until a server is configured", () => {
  assert.equal(TELEMETRY_UPLOAD_ENABLED, false);
  assert.equal(TELEMETRY_UPLOAD_ENDPOINT, "");
});

test("popup visibly disables the upload action", async () => {
  const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  assert.match(html, /id="uploadButton"[^>]*disabled/);
  assert.match(html, /SERVER NOT CONFIGURED/);
});

test("manifest uses MV3 observation permissions and local scripts", async () => {
  const raw = await readFile(new URL("../manifest.json", import.meta.url), "utf8");
  const manifest = JSON.parse(raw);
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("webRequest"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.equal(manifest.background.type, "module");
  assert.ok(manifest.content_scripts.some((entry) => entry.world === "MAIN"));
  assert.equal(JSON.stringify(manifest).includes("http://localhost"), false);
});
