import { PAYOUTS_ENABLED } from "./config.js";

const elements = {
  version: document.querySelector("#version"),
  enabledCount: document.querySelector("#enabledCount"),
  builtInIndicators: document.querySelector("#builtInIndicators"),
  customIndicators: document.querySelector("#customIndicators"),
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
  elements.saveStatus.style.color = isError ? "#e69aa4" : "#69cfe9";
  statusTimer = setTimeout(() => { elements.saveStatus.textContent = ""; }, 3000);
}

function showImportStatus(message, isError = false) {
  elements.importStatus.hidden = false;
  elements.importStatus.classList.toggle("error", isError);
  elements.importStatus.textContent = message;
}

function indicatorToggleMarkup(indicator, enabled) {
  return `
    <label class="switch" title="${enabled ? "Disable" : "Enable"} ${escapeHtml(indicator.name)}">
      <input type="checkbox" data-indicator-id="${escapeHtml(indicator.id)}" ${enabled ? "checked" : ""}>
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
        showSaveStatus(`${input.checked ? "Enabled" : "Disabled"} ${id}. New visits use this setting immediately.`);
      } catch (error) {
        input.checked = previous;
        showSaveStatus(error.message, true);
      } finally {
        input.disabled = false;
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

async function loadSettings() {
  settingsData = await send({ type: "VEILANCE_GET_SETTINGS" });
  renderBuiltInIndicators();
  renderCustomIndicators();
  renderWallet();
  renderDatabase();
  updateEnabledCount();
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
    elements.chooseFolderButton.textContent = "Choose indicator folder";
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
    "Signal template copied"
  );
});
elements.copyHostTemplateButton.addEventListener("click", () => {
  void copyText(
    JSON.stringify(HOST_TEMPLATE, null, 2),
    elements.copyHostTemplateButton,
    "Host template copied"
  );
});
elements.copyVeilanceTemplateButton.addEventListener("click", () => {
  void copyText(
    JSON.stringify(VEILANCE_TEMPLATE, null, 2),
    elements.copyVeilanceTemplateButton,
    "Veilance JSON copied"
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
  elements.builtInIndicators.innerHTML = `<div class="loading">${escapeHtml(error.message)}</div>`;
  showSaveStatus(error.message, true);
});
