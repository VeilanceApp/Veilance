import { PAYOUTS_ENABLED } from "./config.js";
import {
  initializeTheme,
  setThemePreference,
  subscribeToTheme
} from "./lib/theme.js";

const elements = {
  version: document.querySelector("#version"),
  enabledCount: document.querySelector("#enabledCount"),
  builtInIndicators: document.querySelector("#builtInIndicators"),
  customIndicators: document.querySelector("#customIndicators"),
  trackerDatabaseStatus: document.querySelector("#trackerDatabaseStatus"),
  trackerDatabaseEnabled: document.querySelector("#trackerDatabaseEnabled"),
  trackerAutoUpdateEnabled: document.querySelector("#trackerAutoUpdateEnabled"),
  checkTrackerUpdatesButton: document.querySelector("#checkTrackerUpdatesButton"),
  trackerCount: document.querySelector("#trackerCount"),
  trackerSchedule: document.querySelector("#trackerSchedule"),
  trackerLastChecked: document.querySelector("#trackerLastChecked"),
  trackerRevision: document.querySelector("#trackerRevision"),
  trackerUpdateError: document.querySelector("#trackerUpdateError"),
  trackerRepositoryLink: document.querySelector("#trackerRepositoryLink"),
  trackerUpdateLog: document.querySelector("#trackerUpdateLog"),
  detectionDatabaseStatus: document.querySelector("#detectionDatabaseStatus"),
  detectionDatabaseEnabled: document.querySelector("#detectionDatabaseEnabled"),
  detectionAutoUpdateEnabled: document.querySelector("#detectionAutoUpdateEnabled"),
  checkDetectionUpdatesButton: document.querySelector("#checkDetectionUpdatesButton"),
  detectionCount: document.querySelector("#detectionCount"),
  detectionSchedule: document.querySelector("#detectionSchedule"),
  detectionLastChecked: document.querySelector("#detectionLastChecked"),
  detectionRevision: document.querySelector("#detectionRevision"),
  detectionUpdateError: document.querySelector("#detectionUpdateError"),
  detectionRepositoryLink: document.querySelector("#detectionRepositoryLink"),
  detectionUpdateLog: document.querySelector("#detectionUpdateLog"),
  resetIndicatorsButton: document.querySelector("#resetIndicatorsButton"),
  chooseFolderButton: document.querySelector("#chooseFolderButton"),
  indicatorFolderInput: document.querySelector("#indicatorFolderInput"),
  downloadStarterButton: document.querySelector("#downloadStarterButton"),
  copySignalTemplateButton: document.querySelector("#copySignalTemplateButton"),
  copyHostTemplateButton: document.querySelector("#copyHostTemplateButton"),
  copyVeilanceTemplateButton: document.querySelector("#copyVeilanceTemplateButton"),
  importStatus: document.querySelector("#importStatus"),
  walletAddress: document.querySelector("#walletAddress"),
  copyAddressButton: document.querySelector("#copyAddressButton"),
  exportWalletButton: document.querySelector("#exportWalletButton"),
  settingsPayoutButton: document.querySelector("#settingsPayoutButton"),
  databaseEngine: document.querySelector("#databaseEngine"),
  databaseVersion: document.querySelector("#databaseVersion"),
  databaseCount: document.querySelector("#databaseCount"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  snapshotCount: document.querySelector("#snapshotCount"),
  snapshotUploadConsent: document.querySelector("#snapshotUploadConsent"),
  snapshotUploadDescription: document.querySelector("#snapshotUploadDescription"),
  queueAllSnapshotsButton: document.querySelector("#queueAllSnapshotsButton"),
  refreshSnapshotsButton: document.querySelector("#refreshSnapshotsButton"),
  clearSnapshotsButton: document.querySelector("#clearSnapshotsButton"),
  snapshotList: document.querySelector("#snapshotList"),
  snapshotDialog: document.querySelector("#snapshotDialog"),
  snapshotDialogTitle: document.querySelector("#snapshotDialogTitle"),
  snapshotPreviewMetadata: document.querySelector("#snapshotPreviewMetadata"),
  snapshotHtmlPreview: document.querySelector("#snapshotHtmlPreview"),
  downloadSnapshotButton: document.querySelector("#downloadSnapshotButton"),
  downloadSnapshotHtmlButton: document.querySelector("#downloadSnapshotHtmlButton"),
  queueSnapshotButton: document.querySelector("#queueSnapshotButton"),
  closeSnapshotDialogButton: document.querySelector("#closeSnapshotDialogButton"),
  saveStatus: document.querySelector("#saveStatus"),
  walletDialog: document.querySelector("#walletDialog"),
  privateKeyConfirmation: document.querySelector("#privateKeyConfirmation"),
  privateKeyReveal: document.querySelector("#privateKeyReveal"),
  privateKeyValue: document.querySelector("#privateKeyValue"),
  revealPrivateKeyButton: document.querySelector("#revealPrivateKeyButton"),
  cancelWalletExportButton: document.querySelector("#cancelWalletExportButton"),
  copyPrivateKeyButton: document.querySelector("#copyPrivateKeyButton"),
  downloadKeypairButton: document.querySelector("#downloadKeypairButton")
};

let settingsData = null;
let exportedWallet = null;
let statusTimer = null;
let snapshotSummaries = [];
let selectedSnapshot = null;

const settingsTabs = [...document.querySelectorAll("[data-settings-tab]")];
const settingsPanels = [...document.querySelectorAll("[data-settings-panel]")];
const themeButtons = [...document.querySelectorAll("[data-theme-option]")];

subscribeToTheme(({ preference }) => {
  for (const button of themeButtons) {
    const active = button.dataset.themeOption === preference;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
});

for (const button of themeButtons) {
  button.addEventListener("click", () => void setThemePreference(button.dataset.themeOption).catch((error) => {
    showSaveStatus(error.message, true);
  }));
}

void initializeTheme();

function activateSettingsTab(requestedTab, options = {}) {
  const tabName = settingsTabs.some((button) => button.dataset.settingsTab === requestedTab)
    ? requestedTab
    : "trackers";
  for (const button of settingsTabs) {
    const active = button.dataset.settingsTab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && options.focus) button.focus();
  }
  for (const panel of settingsPanels) panel.hidden = panel.dataset.settingsPanel !== tabName;
  if (options.updateHash !== false && location.hash !== `#${tabName}`) {
    history.replaceState(null, "", `#${tabName}`);
  }
}

for (const [index, button] of settingsTabs.entries()) {
  button.addEventListener("click", () => activateSettingsTab(button.dataset.settingsTab, { updateHash: true }));
  button.addEventListener("keydown", (event) => {
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % settingsTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + settingsTabs.length) % settingsTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = settingsTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    activateSettingsTab(settingsTabs[nextIndex].dataset.settingsTab, { focus: true, updateHash: true });
  });
}

addEventListener("hashchange", () => activateSettingsTab(location.hash.slice(1), { updateHash: false }));
activateSettingsTab(location.hash.slice(1), { updateHash: false });

const NON_SIGNAL_INDICATOR_IDS = new Set([
  "network-requests",
  "known-trackers",
  "security-headers",
  "page-structure"
]);

const SIGNAL_TEMPLATE = {
  id: "my-signal-rule",
  name: "My signal rule",
  category: "Custom",
  description: "Explain in plain language what this rule means.",
  severity: "low",
  defaultEnabled: true,
  match: {
    indicatorId: "font-probing",
    minCount: 5
  }
};

const HOST_TEMPLATE = {
  id: "my-host-rule",
  name: "My host rule",
  category: "Network",
  description: "A website contacted this service or one of its subdomains.",
  severity: "low",
  defaultEnabled: true,
  match: {
    hosts: ["metrics.example"]
  }
};

const VEILANCE_TEMPLATE = {
  format: "veilance-json",
  name: "Platform161",
  category: "advertising",
  website_url: "https://platform161.com/",
  organization: "platform161",
  domains: [
    "creative-serving.com",
    "p161.net"
  ],
  filters: [
    "||ads.creative-serving.com^$3p",
    "||p161.net^$3p"
  ]
};

const STARTER_RULES = {
  indicators: [
    {
      id: "broad-fingerprint-profile",
      name: "Broad fingerprint profile",
      category: "Fingerprinting",
      description: "A page queried navigator, screen, and font characteristics during the same visit.",
      severity: "medium",
      match: {
        mode: "all",
        signals: [
          { indicatorId: "navigator-characteristics" },
          { indicatorId: "screen-characteristics" },
          { indicatorId: "font-probing" }
        ]
      }
    },
    {
      id: "repeated-font-probing",
      name: "Repeated font probing",
      category: "Fingerprinting",
      description: "A page used font-probing signals at least ten times.",
      severity: "medium",
      match: { indicatorId: "font-probing", minCount: 10 }
    },
    {
      id: "sensitive-local-access",
      name: "Sensitive local access",
      category: "Sensitive APIs",
      description: "A page used credential, peripheral, or local file-system APIs.",
      severity: "high",
      match: {
        mode: "any",
        signals: [
          { indicatorId: "credential-management" },
          { indicatorId: "connected-devices" },
          { indicatorId: "file-system-access" }
        ]
      }
    },
    {
      id: "advertising-privacy-api-use",
      name: "Advertising privacy API use",
      category: "Advertising",
      description: "A page used Topics, Protected Audience, or Shared Storage.",
      severity: "medium",
      match: { indicatorId: "privacy-sandbox" }
    },
    {
      id: "replace-with-your-service-host",
      name: "Your service host",
      category: "Network",
      description: "Replace metrics.example with a host you want to watch.",
      severity: "low",
      defaultEnabled: false,
      match: { hosts: ["metrics.example"] }
    }
  ]
};

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Veilance did not return a response");
  return response;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showSaveStatus(message, isError = false) {
  clearTimeout(statusTimer);
  elements.saveStatus.textContent = message;
  elements.saveStatus.classList.toggle("error", isError);
  statusTimer = setTimeout(() => {
    elements.saveStatus.textContent = "";
    elements.saveStatus.classList.remove("error");
  }, 3500);
}

function showImportStatus(message, isError = false) {
  elements.importStatus.hidden = false;
  elements.importStatus.classList.toggle("error", isError);
  elements.importStatus.textContent = message;
}

function indicatorToggleMarkup(indicator, enabled) {
  return `
    <label class="switch" title="${enabled ? "Disable" : "Enable"} ${escapeHtml(indicator.name)}">
      <input type="checkbox" data-indicator-id="${escapeHtml(indicator.id)}" aria-label="${enabled ? "Disable" : "Enable"} ${escapeHtml(indicator.name)}" ${enabled ? "checked" : ""}>
      <span aria-hidden="true"></span>
    </label>
  `;
}

function updateEnabledCount() {
  if (!settingsData) return;
  const all = [...settingsData.builtInIndicators, ...settingsData.customIndicators];
  const enabled = all.filter((indicator) => settingsData.indicatorSettings[indicator.id] !== false).length;
  elements.enabledCount.textContent = `${enabled} of ${all.length} enabled`;
}

function bindIndicatorToggles(root) {
  for (const input of root.querySelectorAll("[data-indicator-id]")) {
    input.addEventListener("change", async () => {
      const id = input.dataset.indicatorId;
      const indicator = [...settingsData.builtInIndicators, ...settingsData.customIndicators]
        .find((item) => item.id === id);
      const indicatorName = indicator?.name || id;
      const previous = !input.checked;
      input.disabled = true;
      try {
        const response = await send({
          type: "VEILANCE_SET_INDICATOR",
          id,
          enabled: input.checked
        });
        settingsData.indicatorSettings = response.indicatorSettings;
        updateEnabledCount();
        showSaveStatus(`${indicatorName} is now ${input.checked ? "enabled" : "disabled"}. New activity uses this setting immediately.`);
      } catch (error) {
        input.checked = previous;
        showSaveStatus(error.message, true);
      } finally {
        input.disabled = false;
        const action = input.checked ? "Disable" : "Enable";
        input.setAttribute("aria-label", `${action} ${indicatorName}`);
        input.closest("label")?.setAttribute("title", `${action} ${indicatorName}`);
      }
    });
  }
}

function renderBuiltInIndicators() {
  const groups = new Map();
  for (const indicator of settingsData.builtInIndicators) {
    const group = groups.get(indicator.category) || [];
    group.push(indicator);
    groups.set(indicator.category, group);
  }
  elements.builtInIndicators.innerHTML = [...groups.entries()].map(([category, indicators]) => `
    <section class="indicator-group">
      <h3>${escapeHtml(category)}</h3>
      <div class="indicator-list">
        ${indicators.map((indicator) => `
          <div class="indicator-row">
            <div class="indicator-copy">
              <div class="indicator-heading">
                <strong>${escapeHtml(indicator.name)}</strong>
                <code class="indicator-id">${NON_SIGNAL_INDICATOR_IDS.has(indicator.id) ? "setting" : "indicatorId"}: ${escapeHtml(indicator.id)}</code>
              </div>
              <p>${escapeHtml(indicator.description)}${indicator.dependsOn ? ` <span class="dependency">Requires ${escapeHtml(indicator.dependsOn)}.</span>` : ""}</p>
            </div>
            ${indicatorToggleMarkup(indicator, settingsData.indicatorSettings[indicator.id] !== false)}
          </div>
        `).join("")}
      </div>
    </section>
  `).join("");
  bindIndicatorToggles(elements.builtInIndicators);
}

function matchSummary(indicator) {
  const pieces = [];
  if (indicator.match?.signals?.length) pieces.push(`${indicator.match.signals.length} signal rule${indicator.match.signals.length === 1 ? "" : "s"}`);
  if (indicator.match?.hosts?.length) pieces.push(`${indicator.match.hosts.length} host rule${indicator.match.hosts.length === 1 ? "" : "s"}`);
  if (indicator.match?.networkFilters?.length) pieces.push(`${indicator.match.networkFilters.length} Veilance network filter${indicator.match.networkFilters.length === 1 ? "" : "s"}`);
  return pieces.join(` ${indicator.match?.mode || "any"} `) || "Matching rule";
}

function customRuleMeta(indicator) {
  const pieces = [matchSummary(indicator)];
  if (indicator.sourceFormat === "veilance-json") pieces.push("Veilance JSON");
  if (indicator.dependsOn) pieces.push(`requires ${indicator.dependsOn}`);
  if (indicator.organization) pieces.push(indicator.organization);
  if (indicator.websiteUrl) {
    try {
      const url = new URL(indicator.websiteUrl);
      if (url.protocol === "https:" || url.protocol === "http:") pieces.push(url.hostname);
    } catch {
      // Ignore malformed restored metadata.
    }
  }
  pieces.push(indicator.sourceName || "Imported");
  return pieces.join(" · ");
}

function renderCustomIndicators() {
  if (!settingsData.customIndicators.length) {
    elements.customIndicators.innerHTML = '<div class="empty-state">No custom indicators loaded. Choose a folder containing JSON rule files to add them.</div>';
    return;
  }
  elements.customIndicators.innerHTML = settingsData.customIndicators.map((indicator) => `
    <div class="custom-row">
      <div>
        <div class="custom-meta">
          <span class="severity ${escapeHtml(indicator.severity)}">${escapeHtml(indicator.severity)}</span>
          <strong>${escapeHtml(indicator.name)}</strong>
        </div>
        <p>${escapeHtml(indicator.description)}</p>
        <small>${escapeHtml(customRuleMeta(indicator))}${indicator.importWarnings?.length ? ` <span class="rule-warning">· ${indicator.importWarnings.length} skipped item${indicator.importWarnings.length === 1 ? "" : "s"}</span>` : ""}</small>
      </div>
      <div class="custom-actions">
        ${indicatorToggleMarkup(indicator, settingsData.indicatorSettings[indicator.id] !== false)}
        <button class="remove-button" type="button" data-remove-indicator="${escapeHtml(indicator.id)}" title="Remove indicator" aria-label="Remove ${escapeHtml(indicator.name)}">×</button>
      </div>
    </div>
  `).join("");
  bindIndicatorToggles(elements.customIndicators);
  for (const button of elements.customIndicators.querySelectorAll("[data-remove-indicator]")) {
    button.addEventListener("click", async () => {
      const indicator = settingsData.customIndicators.find((item) => item.id === button.dataset.removeIndicator);
      if (!indicator || !confirm(`Remove the imported indicator “${indicator.name}”?`)) return;
      button.disabled = true;
      try {
        const response = await send({ type: "VEILANCE_REMOVE_CUSTOM_INDICATOR", id: indicator.id });
        settingsData.customIndicators = response.customIndicators;
        settingsData.indicatorSettings = response.indicatorSettings;
        renderCustomIndicators();
        updateEnabledCount();
        showSaveStatus(`Removed ${indicator.name}.`);
      } catch (error) {
        button.disabled = false;
        showSaveStatus(error.message, true);
      }
    });
  }
}

function formatTrackerDate(value) {
  if (!Number.isFinite(value)) return "Not checked yet";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

function trackerLogMeta(entry) {
  const values = [formatTrackerDate(entry.timestamp), entry.trigger || "automatic"];
  if (entry.added || entry.updated || entry.removed) {
    values.push(`+${entry.added || 0} / ~${entry.updated || 0} / −${entry.removed || 0}`);
  }
  if (entry.skipped) values.push(`${entry.skipped} skipped`);
  if (entry.warnings) values.push(`${entry.warnings} warnings`);
  if (entry.revision) values.push(`rev ${String(entry.revision).slice(0, 12)}`);
  return values;
}

function renderTrackerDatabase() {
  const database = settingsData.trackerDatabase || {};
  const trackerCount = Math.max(0, Number(database.trackerCount) || 0);
  const intervalHours = Math.max(1, (Number(database.intervalMinutes) || 480) / 60);
  const revision = String(database.sourceRevision || database.bundledRevision || "");
  elements.trackerDatabaseEnabled.checked = database.databaseEnabled !== false;
  elements.trackerAutoUpdateEnabled.checked = database.autoUpdateEnabled !== false;
  elements.trackerCount.textContent = trackerCount.toLocaleString();
  elements.trackerSchedule.textContent = database.autoUpdateEnabled === false
    ? "Disabled"
    : `Every ${intervalHours.toLocaleString()} hours`;
  elements.trackerLastChecked.textContent = formatTrackerDate(database.lastCheckAt);
  elements.trackerRevision.textContent = revision ? revision.slice(0, 12) : "Unavailable";
  elements.trackerRevision.title = revision;
  elements.trackerDatabaseStatus.textContent = database.databaseEnabled === false
    ? `${trackerCount.toLocaleString()} downloaded · disabled`
    : `${trackerCount.toLocaleString()} active`;
  elements.trackerRepositoryLink.href = database.repository || elements.trackerRepositoryLink.href;
  elements.trackerUpdateError.hidden = !database.lastError;
  elements.trackerUpdateError.textContent = database.lastError || "";

  const entries = Array.isArray(database.updateLog) ? database.updateLog : [];
  if (!entries.length) {
    elements.trackerUpdateLog.innerHTML = '<div class="empty-state">No tracker update checks recorded yet.</div>';
    return;
  }
  elements.trackerUpdateLog.innerHTML = entries.map((entry) => {
    const status = ["installed", "updated", "up-to-date", "error"].includes(entry.status)
      ? entry.status
      : "unknown";
    return `
      <div class="tracker-log-entry">
        <span class="tracker-log-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
        <div class="tracker-log-copy">
          <strong>${escapeHtml(entry.message || "Tracker database check completed.")}</strong>
          <p>${escapeHtml((Number(entry.trackerCount) || 0).toLocaleString())} active tracker${Number(entry.trackerCount) === 1 ? "" : "s"}</p>
          <div class="tracker-log-meta">
            ${trackerLogMeta(entry).map((value) => `<span>${escapeHtml(value)}</span>`).join("")}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderDetectionDatabase() {
  const database = settingsData.detectionDatabase || {};
  const detectionCount = Math.max(0, Number(database.detectionCount) || 0);
  const intervalHours = Math.max(1, (Number(database.intervalMinutes) || 480) / 60);
  const revision = String(database.sourceRevision || "");
  elements.detectionDatabaseEnabled.checked = database.databaseEnabled !== false;
  elements.detectionAutoUpdateEnabled.checked = database.autoUpdateEnabled !== false;
  elements.detectionCount.textContent = detectionCount.toLocaleString();
  elements.detectionSchedule.textContent = database.autoUpdateEnabled === false
    ? "Disabled"
    : `Every ${intervalHours.toLocaleString()} hours`;
  elements.detectionLastChecked.textContent = formatTrackerDate(database.lastCheckAt);
  elements.detectionRevision.textContent = revision ? revision.slice(0, 12) : "Not downloaded";
  elements.detectionRevision.title = revision;
  elements.detectionDatabaseStatus.textContent = database.databaseEnabled === false
    ? `${detectionCount.toLocaleString()} downloaded · disabled`
    : `${detectionCount.toLocaleString()} active`;
  elements.detectionRepositoryLink.href = database.repository || elements.detectionRepositoryLink.href;
  elements.detectionUpdateError.hidden = !database.lastError;
  elements.detectionUpdateError.textContent = database.lastError || "";

  const entries = Array.isArray(database.updateLog) ? database.updateLog : [];
  if (!entries.length) {
    elements.detectionUpdateLog.innerHTML = '<div class="empty-state">No detection update checks recorded yet.</div>';
    return;
  }
  elements.detectionUpdateLog.innerHTML = entries.map((entry) => {
    const status = ["installed", "updated", "up-to-date", "error"].includes(entry.status)
      ? entry.status
      : "unknown";
    return `
      <div class="tracker-log-entry">
        <span class="tracker-log-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
        <div class="tracker-log-copy">
          <strong>${escapeHtml(entry.message || "Detection database check completed.")}</strong>
          <p>${escapeHtml((Number(entry.detectionCount) || 0).toLocaleString())} active detection${Number(entry.detectionCount) === 1 ? "" : "s"}</p>
          <div class="tracker-log-meta">
            ${trackerLogMeta(entry).map((value) => `<span>${escapeHtml(value)}</span>`).join("")}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderWallet() {
  const publicKey = settingsData.wallet?.publicKey || "";
  elements.walletAddress.textContent = publicKey || settingsData.walletError || "Wallet unavailable";
  elements.copyAddressButton.disabled = !publicKey;
  elements.exportWalletButton.disabled = !publicKey;
}

function renderDatabase() {
  const database = settingsData.database || {};
  elements.databaseEngine.textContent = database.engine || "SQLite WASM";
  elements.databaseVersion.textContent = database.sqliteVersion || "Unknown";
  elements.databaseCount.textContent = `${database.visitCount || 0} / ${database.maximumVisits || 20}`;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function canQueueSnapshot(snapshot) {
  const upload = settingsData?.snapshotUpload || {};
  return Boolean(
    upload.available &&
    upload.consent &&
    snapshot?.interest?.eligible === true &&
    Number(snapshot.interest.score) >= Number(snapshot.interest.minimumScore) &&
    Number(snapshot.interest.minimumScore) > 0 &&
    ["local", "failed"].includes(snapshot?.upload?.status)
  );
}

function snapshotQueueTitle(snapshot) {
  const upload = settingsData?.snapshotUpload || {};
  if (!upload.available) return "Uploads are disabled in this build.";
  if (!upload.consent) return "Allow pseudonymous uploads above before queueing a snapshot.";
  if (snapshot?.interest?.eligible !== true) return "This snapshot does not meet the upload interest threshold.";
  if (snapshot?.upload?.status === "uploaded") return "This snapshot has already been uploaded.";
  if (["queued", "uploading"].includes(snapshot?.upload?.status)) return "This snapshot is already queued.";
  return "Queue this snapshot for a privacy-delayed upload batch.";
}

function renderSnapshotUpload() {
  const upload = settingsData?.snapshotUpload || {};
  elements.snapshotUploadConsent.disabled = !upload.available;
  elements.snapshotUploadConsent.checked = Boolean(upload.available && upload.consent);
  if (!upload.available) {
    elements.snapshotUploadDescription.textContent = "Uploads are disabled in this build. Interest-qualified local capture, review, download, and deletion remain available.";
    elements.queueAllSnapshotsButton.title = "Uploads are disabled in this build.";
  } else if (!upload.consent) {
    elements.snapshotUploadDescription.textContent = `Uploads are available through ${upload.endpointHost}. Enable this control to opt in; only interest-qualified snapshots can be queued.`;
    elements.queueAllSnapshotsButton.title = "Allow pseudonymous uploads before queueing snapshots.";
  } else {
    elements.snapshotUploadDescription.textContent = `Uploads are allowed through ${upload.endpointHost}. Only interest-qualified snapshots you explicitly queue are batched after a randomized 5–15 minute delay.`;
    elements.queueAllSnapshotsButton.title = "Queue every eligible local snapshot.";
  }
}

function snapshotRowMarkup(snapshot) {
  const status = String(snapshot.upload?.status || "local");
  const interest = snapshot.interest;
  const interestLevel = ["interesting", "high", "critical"].includes(interest?.level)
    ? interest.level
    : "legacy";
  const interestText = interest
    ? `${Math.max(0, Number(interest.score) || 0)}/100 ${interest.level}`
    : "unscored legacy";
  const queueDisabled = canQueueSnapshot(snapshot) ? "" : "disabled";
  const error = snapshot.upload?.lastError
    ? `<p class="snapshot-row-error">${escapeHtml(snapshot.upload.lastError)}</p>`
    : "";
  return `
    <article class="snapshot-row">
      <div class="snapshot-row-copy">
        <div class="snapshot-row-title">
          <strong>${escapeHtml(snapshot.hostname || "Unknown website")}</strong>
          <span class="snapshot-interest-badge ${escapeHtml(interestLevel)}">${escapeHtml(interestText)}</span>
          <span class="snapshot-upload-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
        </div>
        <div class="snapshot-row-meta">
          <span>${escapeHtml(formatTrackerDate(snapshot.createdAt))}</span>
          <span>${escapeHtml(formatBytes(snapshot.sizeBytes))}</span>
          <span>${escapeHtml(snapshot.eventId || snapshot.snapshotId)}</span>
          ${snapshot.upload?.nextAttemptAt ? `<span>next ${escapeHtml(formatTrackerDate(snapshot.upload.nextAttemptAt))}</span>` : ""}
          ${snapshot.upload?.uploadedAt ? `<span>uploaded ${escapeHtml(formatTrackerDate(snapshot.upload.uploadedAt))}</span>` : ""}
          ${snapshot.upload?.attempts ? `<span>${escapeHtml(snapshot.upload.attempts)} attempt${snapshot.upload.attempts === 1 ? "" : "s"}</span>` : ""}
        </div>
        ${error}
      </div>
      <div class="snapshot-row-actions">
        <button class="secondary-button" type="button" data-preview-snapshot="${escapeHtml(snapshot.snapshotId)}">Review</button>
        <button class="secondary-button" type="button" data-download-snapshot="${escapeHtml(snapshot.snapshotId)}">Download</button>
        <button class="primary-button" type="button" data-queue-snapshot="${escapeHtml(snapshot.snapshotId)}" title="${escapeHtml(snapshotQueueTitle(snapshot))}" ${queueDisabled}>Queue</button>
        <button class="danger-outline-button" type="button" data-delete-snapshot="${escapeHtml(snapshot.snapshotId)}">Delete</button>
      </div>
    </article>
  `;
}

async function loadSnapshots() {
  const response = await send({ type: "VEILANCE_LIST_TELEMETRY_SNAPSHOTS" });
  snapshotSummaries = response.snapshots || [];
  const maximum = settingsData?.database?.maximumSnapshots || 20;
  elements.snapshotCount.textContent = `${snapshotSummaries.length} / ${maximum}`;
  elements.clearSnapshotsButton.disabled = snapshotSummaries.length === 0;
  elements.queueAllSnapshotsButton.disabled = !(
    settingsData?.snapshotUpload?.available &&
    settingsData?.snapshotUpload?.consent &&
    snapshotSummaries.some((snapshot) => canQueueSnapshot(snapshot))
  );
  if (!snapshotSummaries.length) {
    elements.snapshotList.innerHTML = '<div class="empty-state">No interesting telemetry snapshots stored. Veilance enables capture when a public website reaches 25/100 interest.</div>';
    return;
  }
  elements.snapshotList.innerHTML = snapshotSummaries.map(snapshotRowMarkup).join("");
  for (const button of elements.snapshotList.querySelectorAll("[data-preview-snapshot]")) {
    button.addEventListener("click", () => void openSnapshot(button.dataset.previewSnapshot));
  }
  for (const button of elements.snapshotList.querySelectorAll("[data-download-snapshot]")) {
    button.addEventListener("click", () => void downloadSnapshotById(button.dataset.downloadSnapshot));
  }
  for (const button of elements.snapshotList.querySelectorAll("[data-queue-snapshot]")) {
    button.addEventListener("click", () => void queueSnapshotById(button.dataset.queueSnapshot));
  }
  for (const button of elements.snapshotList.querySelectorAll("[data-delete-snapshot]")) {
    button.addEventListener("click", () => void deleteSnapshotById(button.dataset.deleteSnapshot));
  }
}

function snapshotFilename(snapshot, suffix) {
  const host = String(snapshot?.hostname || "website").replace(/[^a-z0-9.-]+/gi, "-").slice(0, 80);
  const stamp = new Date(snapshot?.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-");
  return `veilance-snapshot-${host}-${stamp}.${suffix}`;
}

async function getSnapshot(snapshotId) {
  const response = await send({ type: "VEILANCE_GET_TELEMETRY_SNAPSHOT", snapshotId });
  return response.snapshot;
}

async function openSnapshot(snapshotId) {
  try {
    selectedSnapshot = await getSnapshot(snapshotId);
    const payload = selectedSnapshot.payload || {};
    const redactedDocument = payload.redactedDocument || {};
    const metadata = {
      local: {
        snapshotId: selectedSnapshot.snapshotId,
        createdAt: new Date(selectedSnapshot.createdAt).toISOString(),
        sizeBytes: selectedSnapshot.sizeBytes,
        upload: selectedSnapshot.upload
      },
      payload: {
        ...payload,
        redactedDocument: {
          ...redactedDocument,
          html: "[shown in the redacted HTML field below]"
        }
      }
    };
    elements.snapshotDialogTitle.textContent = selectedSnapshot.hostname || "Telemetry snapshot";
    elements.snapshotPreviewMetadata.textContent = JSON.stringify(metadata, null, 2);
    elements.snapshotHtmlPreview.value = String(redactedDocument.html || "");
    elements.queueSnapshotButton.disabled = !canQueueSnapshot(selectedSnapshot);
    elements.snapshotDialog.showModal();
  } catch (error) {
    showSaveStatus(error.message, true);
  }
}

async function downloadSnapshotById(snapshotId) {
  try {
    const snapshot = await getSnapshot(snapshotId);
    downloadJson(snapshotFilename(snapshot, "json"), snapshot);
    showSaveStatus("Telemetry snapshot downloaded as JSON.");
  } catch (error) {
    showSaveStatus(error.message, true);
  }
}

async function queueSnapshotById(snapshotId) {
  try {
    const response = await send({ type: "VEILANCE_QUEUE_TELEMETRY_SNAPSHOT", snapshotId });
    await loadSnapshots();
    if (selectedSnapshot?.snapshotId === snapshotId) elements.queueSnapshotButton.disabled = true;
    showSaveStatus(`Snapshot queued for a privacy-delayed batch after ${formatTrackerDate(response.nextAttemptAt)}.`);
  } catch (error) {
    showSaveStatus(error.message, true);
  }
}

async function deleteSnapshotById(snapshotId) {
  const snapshot = snapshotSummaries.find((item) => item.snapshotId === snapshotId);
  if (!confirm(`Delete the local snapshot for ${snapshot?.hostname || "this website"}?`)) return;
  try {
    await send({ type: "VEILANCE_DELETE_TELEMETRY_SNAPSHOT", snapshotId });
    if (selectedSnapshot?.snapshotId === snapshotId) elements.snapshotDialog.close();
    await loadSnapshots();
    showSaveStatus("Local telemetry snapshot deleted.");
  } catch (error) {
    showSaveStatus(error.message, true);
  }
}

async function loadSettings() {
  settingsData = await send({ type: "VEILANCE_GET_SETTINGS" });
  renderBuiltInIndicators();
  renderCustomIndicators();
  renderTrackerDatabase();
  renderDetectionDatabase();
  renderWallet();
  renderDatabase();
  renderSnapshotUpload();
  updateEnabledCount();
  try {
    await loadSnapshots();
  } catch (error) {
    elements.snapshotCount.textContent = "Unavailable";
    elements.snapshotList.innerHTML = `<div class="empty-state">Saved snapshots could not be loaded. ${escapeHtml(error?.message || "Try refreshing this section.")}</div>`;
    elements.queueAllSnapshotsButton.disabled = true;
    elements.clearSnapshotsButton.disabled = true;
    showSaveStatus("Settings loaded, but saved snapshots are temporarily unavailable.", true);
  }
}

async function importFolder(files) {
  const jsonFiles = [...files]
    .filter((file) => file.name.toLowerCase().endsWith(".json"))
    .slice(0, 100);
  if (!jsonFiles.length) {
    showImportStatus("The selected folder does not contain any .json files.", true);
    return;
  }
  elements.chooseFolderButton.disabled = true;
  elements.chooseFolderButton.textContent = "Reading folder…";
  try {
    const documents = [];
    for (const file of jsonFiles) {
      if (file.size > 262144) {
        documents.push({ sourceName: file.webkitRelativePath || file.name, text: "" });
      } else {
        documents.push({
          sourceName: file.webkitRelativePath || file.name,
          text: await file.text()
        });
      }
    }
    const response = await send({ type: "VEILANCE_IMPORT_INDICATORS", documents });
    settingsData.customIndicators = response.customIndicators;
    settingsData.indicatorSettings = response.indicatorSettings;
    renderCustomIndicators();
    updateEnabledCount();
    const errorText = response.errors?.length
      ? ` ${response.errors.length} error${response.errors.length === 1 ? "" : "s"}: ${response.errors.slice(0, 3).join(" | ")}`
      : "";
    const warningText = response.warnings?.length
      ? ` ${response.warnings.length} warning${response.warnings.length === 1 ? "" : "s"}: ${response.warnings.slice(0, 3).join(" | ")}`
      : "";
    showImportStatus(
      `Loaded ${response.importedCount} indicator${response.importedCount === 1 ? "" : "s"} from the selected folder.${errorText}${warningText}`,
      Boolean(response.errors?.length && !response.importedCount)
    );
  } catch (error) {
    showImportStatus(error.message, true);
  } finally {
    elements.chooseFolderButton.disabled = false;
    elements.chooseFolderButton.textContent = "Choose folder";
    elements.indicatorFolderInput.value = "";
  }
}

async function copyText(value, button, successText) {
  await navigator.clipboard.writeText(value);
  const original = button.textContent;
  button.textContent = successText;
  setTimeout(() => { button.textContent = original; }, 1300);
}

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(filename, value) {
  const blob = new Blob([String(value || "")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resetWalletDialog() {
  exportedWallet = null;
  elements.privateKeyConfirmation.checked = false;
  elements.privateKeyReveal.hidden = true;
  elements.privateKeyValue.value = "";
  elements.revealPrivateKeyButton.hidden = false;
  elements.revealPrivateKeyButton.disabled = true;
}

async function revealPrivateKey() {
  elements.revealPrivateKeyButton.disabled = true;
  elements.revealPrivateKeyButton.textContent = "Revealing…";
  try {
    const response = await send({ type: "VEILANCE_EXPORT_WALLET" });
    exportedWallet = response.wallet;
    elements.privateKeyValue.value = exportedWallet.privateKeyBase58;
    elements.privateKeyReveal.hidden = false;
    elements.revealPrivateKeyButton.hidden = true;
  } catch (error) {
    showSaveStatus(error.message, true);
    elements.walletDialog.close();
  } finally {
    elements.revealPrivateKeyButton.textContent = "Reveal private key";
  }
}

function downloadKeypair() {
  if (!exportedWallet?.keypair) return;
  const blob = new Blob([`${JSON.stringify(exportedWallet.keypair)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `veilance-solana-keypair-${exportedWallet.publicKey.slice(0, 8)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

elements.resetIndicatorsButton.addEventListener("click", async () => {
  elements.resetIndicatorsButton.disabled = true;
  try {
    const response = await send({ type: "VEILANCE_RESET_INDICATORS" });
    settingsData.indicatorSettings = response.indicatorSettings;
    renderBuiltInIndicators();
    renderCustomIndicators();
    updateEnabledCount();
    showSaveStatus("Indicator defaults restored.");
  } catch (error) {
    showSaveStatus(error.message, true);
  } finally {
    elements.resetIndicatorsButton.disabled = false;
  }
});

async function saveTrackerToggle(input, messageType, enabledMessage, disabledMessage) {
  const previous = !input.checked;
  input.disabled = true;
  try {
    const response = await send({ type: messageType, enabled: input.checked });
    settingsData.trackerDatabase = response.trackerDatabase;
    renderTrackerDatabase();
    showSaveStatus(input.checked ? enabledMessage : disabledMessage);
  } catch (error) {
    input.checked = previous;
    showSaveStatus(error.message, true);
  } finally {
    input.disabled = false;
  }
}

async function saveDetectionToggle(input, messageType, enabledMessage, disabledMessage) {
  const previous = !input.checked;
  input.disabled = true;
  try {
    const response = await send({ type: messageType, enabled: input.checked });
    settingsData.detectionDatabase = response.detectionDatabase;
    renderDetectionDatabase();
    showSaveStatus(input.checked ? enabledMessage : disabledMessage);
  } catch (error) {
    input.checked = previous;
    showSaveStatus(error.message, true);
  } finally {
    input.disabled = false;
  }
}

elements.trackerDatabaseEnabled.addEventListener("change", () => {
  void saveTrackerToggle(
    elements.trackerDatabaseEnabled,
    "VEILANCE_SET_TRACKER_DATABASE_ENABLED",
    "Downloaded tracker matching enabled.",
    "Downloaded tracker matching disabled. The database remains stored locally."
  );
});

elements.trackerAutoUpdateEnabled.addEventListener("change", () => {
  void saveTrackerToggle(
    elements.trackerAutoUpdateEnabled,
    "VEILANCE_SET_TRACKER_AUTO_UPDATE",
    "Automatic tracker updates enabled. Veilance will check every eight hours.",
    "Automatic tracker updates disabled. Manual checks remain available."
  );
});

elements.checkTrackerUpdatesButton.addEventListener("click", async () => {
  elements.checkTrackerUpdatesButton.disabled = true;
  elements.checkTrackerUpdatesButton.textContent = "Checking…";
  try {
    const response = await send({ type: "VEILANCE_CHECK_TRACKER_UPDATES" });
    settingsData.trackerDatabase = response.trackerDatabase;
    renderTrackerDatabase();
    showSaveStatus("Tracker database check completed.");
  } catch (error) {
    await loadSettings().catch(() => {});
    showSaveStatus(error.message, true);
  } finally {
    elements.checkTrackerUpdatesButton.disabled = false;
    elements.checkTrackerUpdatesButton.textContent = "Check now";
  }
});

elements.detectionDatabaseEnabled.addEventListener("change", () => {
  void saveDetectionToggle(
    elements.detectionDatabaseEnabled,
    "VEILANCE_SET_DETECTION_DATABASE_ENABLED",
    "Managed detection matching enabled.",
    "Managed detection matching disabled. Downloaded rules remain stored locally."
  );
});

elements.detectionAutoUpdateEnabled.addEventListener("change", () => {
  void saveDetectionToggle(
    elements.detectionAutoUpdateEnabled,
    "VEILANCE_SET_DETECTION_AUTO_UPDATE",
    "Automatic detection updates enabled. Veilance will check every eight hours.",
    "Automatic detection updates disabled. Manual checks remain available."
  );
});

elements.checkDetectionUpdatesButton.addEventListener("click", async () => {
  elements.checkDetectionUpdatesButton.disabled = true;
  elements.checkDetectionUpdatesButton.textContent = "Checking…";
  try {
    const response = await send({ type: "VEILANCE_CHECK_DETECTION_UPDATES" });
    settingsData.detectionDatabase = response.detectionDatabase;
    renderDetectionDatabase();
    showSaveStatus("Detection database check completed.");
  } catch (error) {
    await loadSettings().catch(() => {});
    showSaveStatus(error.message, true);
  } finally {
    elements.checkDetectionUpdatesButton.disabled = false;
    elements.checkDetectionUpdatesButton.textContent = "Check now";
  }
});

elements.chooseFolderButton.addEventListener("click", () => elements.indicatorFolderInput.click());
elements.indicatorFolderInput.addEventListener("change", () => void importFolder(elements.indicatorFolderInput.files));
elements.downloadStarterButton.addEventListener("click", () => {
  downloadJson("veilance-indicator-starter-rules.json", STARTER_RULES);
  showImportStatus("Starter rules downloaded. Put the file in a folder, edit any rule you want, then choose that folder above.");
});
elements.copySignalTemplateButton.addEventListener("click", () => {
  void copyText(
    JSON.stringify(SIGNAL_TEMPLATE, null, 2),
    elements.copySignalTemplateButton,
    "Signal example copied"
  );
});
elements.copyHostTemplateButton.addEventListener("click", () => {
  void copyText(
    JSON.stringify(HOST_TEMPLATE, null, 2),
    elements.copyHostTemplateButton,
    "Host example copied"
  );
});
elements.copyVeilanceTemplateButton.addEventListener("click", () => {
  void copyText(
    JSON.stringify(VEILANCE_TEMPLATE, null, 2),
    elements.copyVeilanceTemplateButton,
    "Tracker example copied"
  );
});

elements.copyAddressButton.addEventListener("click", () => {
  const value = settingsData?.wallet?.publicKey;
  if (value) void copyText(value, elements.copyAddressButton, "Copied");
});

elements.exportWalletButton.addEventListener("click", () => {
  resetWalletDialog();
  elements.walletDialog.showModal();
});
elements.privateKeyConfirmation.addEventListener("change", () => {
  elements.revealPrivateKeyButton.disabled = !elements.privateKeyConfirmation.checked;
});
elements.cancelWalletExportButton.addEventListener("click", () => elements.walletDialog.close());
elements.revealPrivateKeyButton.addEventListener("click", () => void revealPrivateKey());
elements.copyPrivateKeyButton.addEventListener("click", () => {
  if (exportedWallet?.privateKeyBase58) {
    void copyText(exportedWallet.privateKeyBase58, elements.copyPrivateKeyButton, "Copied");
  }
});
elements.downloadKeypairButton.addEventListener("click", downloadKeypair);
elements.walletDialog.addEventListener("close", resetWalletDialog);

elements.snapshotUploadConsent.addEventListener("change", async () => {
  const previous = !elements.snapshotUploadConsent.checked;
  elements.snapshotUploadConsent.disabled = true;
  try {
    const response = await send({
      type: "VEILANCE_SET_SNAPSHOT_UPLOAD_CONSENT",
      enabled: elements.snapshotUploadConsent.checked
    });
    settingsData.snapshotUpload = response.snapshotUpload;
    renderSnapshotUpload();
    await loadSnapshots();
    showSaveStatus(elements.snapshotUploadConsent.checked
      ? "Pseudonymous snapshot uploads allowed. Nothing is uploaded until you queue it."
      : "Snapshot uploads paused. Local snapshots remain available.");
  } catch (error) {
    elements.snapshotUploadConsent.checked = previous;
    showSaveStatus(error.message, true);
  } finally {
    elements.snapshotUploadConsent.disabled = !settingsData?.snapshotUpload?.available;
  }
});

elements.refreshSnapshotsButton.addEventListener("click", async () => {
  elements.refreshSnapshotsButton.disabled = true;
  try {
    await loadSnapshots();
    showSaveStatus("Telemetry snapshot list refreshed.");
  } catch (error) {
    showSaveStatus(error.message, true);
  } finally {
    elements.refreshSnapshotsButton.disabled = false;
  }
});

elements.queueAllSnapshotsButton.addEventListener("click", async () => {
  elements.queueAllSnapshotsButton.disabled = true;
  try {
    const response = await send({ type: "VEILANCE_QUEUE_ALL_TELEMETRY_SNAPSHOTS" });
    await loadSnapshots();
    showSaveStatus(`${response.queued || 0} snapshot${response.queued === 1 ? "" : "s"} queued for a privacy-delayed batch.`);
  } catch (error) {
    showSaveStatus(error.message, true);
  } finally {
    elements.queueAllSnapshotsButton.disabled = !(
      settingsData?.snapshotUpload?.available &&
      settingsData?.snapshotUpload?.consent &&
      snapshotSummaries.some((snapshot) => canQueueSnapshot(snapshot))
    );
  }
});

elements.clearSnapshotsButton.addEventListener("click", async () => {
  if (!confirm("Clear every locally stored telemetry snapshot? Visit history is not affected.")) return;
  elements.clearSnapshotsButton.disabled = true;
  try {
    await send({ type: "VEILANCE_CLEAR_TELEMETRY_SNAPSHOTS" });
    if (elements.snapshotDialog.open) elements.snapshotDialog.close();
    await loadSnapshots();
    showSaveStatus("Local telemetry snapshots cleared.");
  } catch (error) {
    showSaveStatus(error.message, true);
  } finally {
    elements.clearSnapshotsButton.disabled = snapshotSummaries.length === 0;
  }
});

elements.downloadSnapshotButton.addEventListener("click", () => {
  if (!selectedSnapshot) return;
  downloadJson(snapshotFilename(selectedSnapshot, "json"), selectedSnapshot);
  showSaveStatus("Telemetry snapshot downloaded as JSON.");
});
elements.downloadSnapshotHtmlButton.addEventListener("click", () => {
  if (!selectedSnapshot) return;
  downloadText(
    snapshotFilename(selectedSnapshot, "redacted-html.txt"),
    selectedSnapshot.payload?.redactedDocument?.html || ""
  );
  showSaveStatus("Redacted HTML downloaded as inert text.");
});
elements.queueSnapshotButton.addEventListener("click", () => {
  if (selectedSnapshot) void queueSnapshotById(selectedSnapshot.snapshotId);
});
elements.closeSnapshotDialogButton.addEventListener("click", () => elements.snapshotDialog.close());
elements.snapshotDialog.addEventListener("close", () => {
  selectedSnapshot = null;
  elements.snapshotPreviewMetadata.textContent = "";
  elements.snapshotHtmlPreview.value = "";
});

elements.clearHistoryButton.addEventListener("click", async () => {
  if (!confirm("Clear all locally stored visit history? The current active visit may appear again as it continues.")) return;
  elements.clearHistoryButton.disabled = true;
  try {
    await send({ type: "VEILANCE_CLEAR_HISTORY" });
    await loadSettings();
    showSaveStatus("Local visit history cleared.");
  } catch (error) {
    showSaveStatus(error.message, true);
  } finally {
    elements.clearHistoryButton.disabled = false;
  }
});

elements.settingsPayoutButton.disabled = !PAYOUTS_ENABLED;
elements.version.textContent = `v${chrome.runtime.getManifest().version}`;
void loadSettings().catch((error) => {
  const message = error?.message || "Veilance settings could not be loaded.";
  elements.builtInIndicators.innerHTML = `<div class="loading">${escapeHtml(message)}</div>`;
  elements.trackerDatabaseStatus.textContent = "Unavailable";
  elements.trackerUpdateError.hidden = false;
  elements.trackerUpdateError.textContent = "Veilance settings could not be loaded. Reload this page or restart the extension.";
  elements.checkTrackerUpdatesButton.disabled = true;
  elements.detectionDatabaseStatus.textContent = "Unavailable";
  elements.detectionUpdateError.hidden = false;
  elements.detectionUpdateError.textContent = "Veilance settings could not be loaded. Reload this page or restart the extension.";
  elements.checkDetectionUpdatesButton.disabled = true;
  elements.clearSnapshotsButton.disabled = true;
  elements.clearHistoryButton.disabled = true;
  showSaveStatus(message, true);
});
