import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

import {
  DETECTION_DATABASE_ARCHIVE,
  DETECTION_DATABASE_FOLDER,
  DETECTION_UPDATE_INTERVAL_MINUTES,
  PAYOUTS_ENABLED,
  SHIELD_DATABASE_ARCHIVE,
  SHIELD_DATABASE_FOLDER,
  SHIELD_UPDATE_INTERVAL_MINUTES,
  TELEMETRY_IP_ADDRESS_ENDPOINT,
  TELEMETRY_UPLOAD_ALLOW_INSECURE_HTTP,
  TELEMETRY_UPLOAD_ENABLED,
  TELEMETRY_UPLOAD_ENDPOINT,
  TRACKER_DATABASE_ARCHIVE,
  TRACKER_UPDATE_INTERVAL_MINUTES,
  VEILANCE_API_ORIGIN,
  VEILANCE_DEVELOPMENT_API_ORIGIN,
  VEILANCE_PRODUCTION_API_ORIGIN,
  VEILANCE_USE_PRODUCTION_API,
  veilanceApiEndpoint,
  veilanceApiOrigin
} from "../config.js";

test("one production constant switches every Veilance telemetry endpoint", () => {
  assert.equal(VEILANCE_USE_PRODUCTION_API, true);
  assert.equal(VEILANCE_DEVELOPMENT_API_ORIGIN, "http://10.0.10.211:5132");
  assert.equal(VEILANCE_PRODUCTION_API_ORIGIN, "https://api.veilance.org");
  assert.equal(veilanceApiOrigin(false), VEILANCE_DEVELOPMENT_API_ORIGIN);
  assert.equal(veilanceApiOrigin(true), VEILANCE_PRODUCTION_API_ORIGIN);
  assert.equal(
    veilanceApiEndpoint("/api/v1/telemetry/upload", true),
    "https://api.veilance.org/api/v1/telemetry/upload"
  );
  assert.equal(
    veilanceApiEndpoint("/api/v1/telemetry/ip", true),
    "https://api.veilance.org/api/v1/telemetry/ip"
  );
  assert.equal(VEILANCE_API_ORIGIN, VEILANCE_PRODUCTION_API_ORIGIN);
  assert.equal(TELEMETRY_UPLOAD_ENABLED, true);
  assert.equal(TELEMETRY_UPLOAD_ENDPOINT, "https://api.veilance.org/api/v1/telemetry/upload");
  assert.equal(TELEMETRY_IP_ADDRESS_ENDPOINT, "https://api.veilance.org/api/v1/telemetry/ip");
  assert.equal(TELEMETRY_UPLOAD_ALLOW_INSECURE_HTTP, false);
  assert.equal(PAYOUTS_ENABLED, false);
});

test("popup keeps snapshots local and links to compact payout settings", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../popup.html", import.meta.url), "utf8"),
    readFile(new URL("../popup.js", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(html, /Export JSON/i);
  assert.doesNotMatch(html, /id="exportButton"/);
  assert.doesNotMatch(html, /class="wallet-card"/);
  assert.match(html, /id="payoutSettingsButton"/);
  assert.match(html, /id="snapshotInterestScore"/);
  assert.match(html, /id="snapshotInterest"[^>]*role="meter"/);
  assert.match(html, /class="interest-meter-track"/);
  assert.match(html, /Last 20 visits/);
  assert.match(html, /id="snapshotButton"/);
  assert.match(html, /id="snapshotButton"[^>]*aria-describedby="snapshotStatus"/);
  assert.match(html, /redacted snapshot/i);
  assert.match(html, /Veilance doesn’t support this page/i);
  assert.match(html, /Nothing was collected from this page/i);
  assert.doesNotMatch(html, /baseline/i);
  assert.doesNotMatch(html, /60 seconds|60-second|reference sites/i);
  assert.match(html, /What happened here/i);
  assert.match(html, /These are observations, not accusations/i);
  assert.doesNotMatch(html, /High range:/i);
  assert.doesNotMatch(html, /metric-threshold/i);
  assert.match(html, /id="statusPill"[^>]*aria-describedby="statusExplanation"/i);
  assert.match(html, /id="statusExplanation"/i);
  assert.match(source, /Sensitive access needs attention/);
  assert.match(source, /statusPill\.addEventListener\("click"/);
  assert.match(source, /automaticSnapshotCaptureEnabled/);
  assert.match(source, /Automatic snapshots are enabled\. Disable them in Settings/i);
  assert.match(html, /id="activityBreakdown"/);
  assert.match(html, /id="openReportButton"/);
  assert.match(html, /Charts, plain-English explanations, and Shield details/i);
  assert.match(html, /More options/i);
  assert.match(source, /Website connections/);
  assert.match(source, /Browser and storage access/);
  assert.match(source, /Veilance Shield/);
  assert.doesNotMatch(html, /class="activity-category/);
  assert.doesNotMatch(html, /donut|trackers blocked|pause on this site/i);
  assert.match(html, /id="setupNotice"/);
  assert.match(html, /id="finishSetupButton"/);
  assert.doesNotMatch(html, /privacy detective|velvet rope|tiny trench coat/i);
});

test("popup groups protection activity and keeps the explanation simple", async () => {
  const [html, source, contentSource] = await Promise.all([
    readFile(new URL("../popup.html", import.meta.url), "utf8"),
    readFile(new URL("../popup.js", import.meta.url), "utf8"),
    readFile(new URL("../content.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /data-view="protections"[^>]*>[\s\S]*?Shielded/i);
  assert.match(html, /Veilance Shield/i);
  assert.match(html, /Shielded activity/i);
  assert.match(html, /Tracker Shield/i);
  assert.match(html, /protecting supported fingerprint surfaces/i);
  assert.match(html, /Click an item to inspect the protected value returned to the website/i);
  assert.match(source, /function stackProtectionEvents/);
  assert.match(source, /function returnedValueMarkup/);
  assert.match(source, /Returned to website/);
  assert.match(source, /Canvas fingerprint shielded/);
  assert.match(source, /activeRuleCount/);
  assert.match(contentSource, /indicatorId: String\(detail\.indicatorId/);
  assert.match(contentSource, /matchedActions:/);
  assert.match(contentSource, /changedUnits:/);
  assert.doesNotMatch(html, /Original local signature|protected signature/i);
  assert.doesNotMatch(html, /protection-flow|signature-difference|fingerprintProtectionStatus|protection-feature-card/i);
});

test("settings exposes indicator folders, wallet export, and disabled payouts", async () => {
  const html = await readFile(new URL("../settings.html", import.meta.url), "utf8");
  assert.match(html, /role="tablist"/);
  assert.match(html, /data-settings-tab="snapshots"/);
  assert.match(html, /data-settings-tab="wallet"/);
  assert.match(html, /Routine visits below 25 are never snapshotted/i);
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
  assert.match(html, /id="snapshotAutomaticCapture"[^>]*disabled/);
  assert.match(html, /id="automaticSnapshotWarningDialog"/);
  assert.match(html, /Automatic snapshots may affect page performance/i);
  assert.match(html, /several tabs loading simultaneously may experience additional latency/i);
  assert.match(html, /Enable automatic snapshots/i);
  assert.match(html, /id="snapshotAutomaticUpload"[^>]*disabled/);
  assert.match(html, /id="uploadNowButton"[^>]*disabled/);
  assert.match(html, /id="snapshotList"/);
  assert.match(html, /id="snapshotHtmlPreview"/);
  assert.match(html, /private\/internal hosts/i);
  assert.match(html, /data-settings-tab="protections"[^>]*>Shield<\/button>/i);
  assert.match(html, /Fingerprint Shield/i);
  assert.match(html, /On by default/i);
  assert.match(html, /Tracker Shield/i);
  assert.match(html, /id="fingerprintProtectionEnabled"/);
  assert.match(html, /VeilanceApp\/Veilance-Shield-DB/);
  assert.match(html, /id="shieldDatabaseEnabled"/);
  assert.match(html, /id="shieldAutoUpdateEnabled"/);
  assert.match(html, /id="checkShieldUpdatesButton"/);
  assert.match(html, /id="trackerProtectionEnabled"[^>]*disabled/);
  assert.match(html, /Contributor UUID/i);
  assert.match(html, /https:\/\/veilance\.org\/leaderboard/i);
});

test("extension UI scripts reference elements that exist in their pages", async () => {
  for (const name of ["onboarding", "popup", "report", "settings"]) {
    const [html, source] = await Promise.all([
      readFile(new URL(`../${name}.html`, import.meta.url), "utf8"),
      readFile(new URL(`../${name}.js`, import.meta.url), "utf8")
    ]);
    const ids = [...source.matchAll(/querySelector\("#([a-zA-Z0-9_-]+)"\)/g)].map((match) => match[1]);
    for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), `${name}.html should contain #${id}`);
  }
});

test("full privacy report teaches the evidence with an accessible activity timeline and no raw dump", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../report.html", import.meta.url), "utf8"),
    readFile(new URL("../report.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /Website activity timeline/i);
  assert.match(html, /View this activity as a list/i);
  assert.match(html, /Site request/i);
  assert.match(html, /Outside service/i);
  assert.match(html, /Known tracker/i);
  assert.match(html, /Browser feature/i);
  assert.match(html, /Storage or permission/i);
  assert.match(html, /Shield changed it/i);
  assert.doesNotMatch(html, /data-chart-type|Bar graph|Line chart|Pie chart/i);
  assert.match(html, /id="chartTooltip"[^>]*role="status"/i);
  assert.match(html, /id="liveUpdatesToggle"[^>]*role="switch"/i);
  assert.match(html, /How to read this timeline/i);
  assert.match(html, /What Veilance Shield changed/i);
  assert.match(html, /A quick guide to this report/i);
  assert.match(html, /data-evidence-topic="trackers"/i);
  assert.match(html, /id="evidenceDialog"[^>]*aria-labelledby="evidenceDialogTitle"/i);
  assert.match(html, /Did Veilance send anything/i);
  assert.doesNotMatch(html, /Raw data|Copy JSON|Download JSON|<pre/i);
  assert.match(source, /VEILANCE_GET_PRIVACY_REPORT/);
  assert.match(source, /No research snapshot has been created/);
  assert.match(source, /Snapshot saved locally — not sent/);
  assert.match(source, /Telemetry was uploaded and accepted/);
  assert.match(source, /The upload was not confirmed/);
  assert.match(source, /function renderActivityTimeline/);
  assert.match(source, /function browserInformationDescription/);
  assert.match(source, /It does not inspect the request body, response body/i);
  assert.match(source, /function showChartTooltip/);
  assert.match(source, /Updating every 1\.5 seconds/);
  assert.match(source, /function renderShield/);
  assert.match(source, /function openEvidenceDialog/);
  assert.match(source, /destination and action-level timing/i);
  assert.match(source, /random device identifier/i);
  assert.doesNotMatch(source, /rawValues|copyRaw|downloadRaw/);
});

test("first-run onboarding is explicit, local-first, and telemetry remains optional", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../onboarding.html", import.meta.url), "utf8"),
    readFile(new URL("../onboarding.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /Continue without an account/i);
  assert.match(html, /Sign in to Veilance/i);
  assert.match(html, /Account services are not active in this release/i);
  assert.match(html, /https:\/\/veilance\.org\/privacy/i);
  assert.match(html, /I have read and accept/i);
  assert.match(html, /Keep automatic telemetry off/i);
  assert.match(html, /Enable automatic telemetry/i);
  assert.match(html, /randomized 5–15 minute delay/i);
  assert.match(html, /public IP address/i);
  assert.match(html, /upload does not guarantee payment/i);
  assert.match(source, /VEILANCE_COMPLETE_ONBOARDING/);
  assert.match(source, /privacyAccepted: elements\.privacyAcceptance\.checked/);
  assert.match(source, /telemetryEnabled/);
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
  assert.equal(manifest.version, "0.7");
  assert.ok(manifest.permissions.includes("webRequest"));
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("alarms"));
  assert.ok(manifest.permissions.includes("unlimitedStorage"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.options_ui.page, "settings.html");
  assert.match(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/);
  assert.ok(manifest.content_scripts.some((entry) => entry.world === "MAIN"));
  assert.ok(manifest.content_scripts.some((entry) => entry.js?.includes("lib/redacted-html.js")));
  assert.equal(JSON.stringify(manifest).includes("http://localhost"), false);
  assert.ok(manifest.host_permissions.includes("https://api.veilance.org/*"));
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

test("Shield rules update from the official data-only database every eight hours", async () => {
  assert.equal(SHIELD_UPDATE_INTERVAL_MINUTES, 480);
  assert.equal(SHIELD_DATABASE_FOLDER, "veilance-json-shields");
  assert.match(SHIELD_DATABASE_ARCHIVE, /^https:\/\/codeload\.github\.com\/VeilanceApp\/Veilance-Shield-DB\//);
  const bundle = JSON.parse(await readFile(new URL("../data/veilance-shields.json", import.meta.url), "utf8"));
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.records.length, 30);
  assert.match(bundle.revision, /^[a-f0-9]{64}$/);
});

test("official SQLite runtime assets are bundled locally", async () => {
  const wasmUrl = new URL("../vendor/sqlite/sqlite3.wasm", import.meta.url);
  const wasm = await readFile(wasmUrl);
  assert.equal(wasm.subarray(0, 4).toString("hex"), "0061736d");
  assert.ok((await stat(wasmUrl)).size > 500000);
  const source = await readFile(new URL("../vendor/sqlite/sqlite3.mjs", import.meta.url), "utf8");
  assert.match(source, /SQLITE_VERSION "3\.53\.0"/);
});
