import { TELEMETRY_UPLOAD_ENABLED, TELEMETRY_UPLOAD_ENDPOINT } from "./config.js";

const elements = {
  hostname: document.querySelector("#hostname"),
  liveState: document.querySelector("#liveState"),
  statusPill: document.querySelector("#statusPill"),
  thirdPartyHosts: document.querySelector("#thirdPartyHosts"),
  requestCount: document.querySelector("#requestCount"),
  signalCount: document.querySelector("#signalCount"),
  storageCount: document.querySelector("#storageCount"),
  findingCount: document.querySelector("#findingCount"),
  findings: document.querySelector("#findings"),
  payloadPreview: document.querySelector("#payloadPreview"),
  uploadButton: document.querySelector("#uploadButton"),
  exportButton: document.querySelector("#exportButton"),
  clearButton: document.querySelector("#clearButton"),
  refreshButton: document.querySelector("#refreshButton"),
  version: document.querySelector("#version"),
  payloadPanel: document.querySelector(".payload-panel")
};

let activeTabId = null;
let currentPayload = null;

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function totalStorageEvents(state) {
  return Object.values(state?.signals || {})
    .filter((signal) => signal.kind === "storage")
    .reduce((sum, signal) => sum + signal.count, 0);
}

function renderFindings(findings) {
  elements.findingCount.textContent = String(findings.length);
  if (!findings.length) {
    elements.findings.innerHTML = '<div class="empty">No privacy-relevant activity has been observed yet. Reload the page after installing Veilance to capture the earliest API calls.</div>';
    return;
  }
  elements.findings.innerHTML = findings.map((finding) => `
    <article class="finding">
      <div class="finding-title">
        <span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span>
        <strong>${escapeHtml(finding.title)}</strong>
      </div>
      <p>${escapeHtml(finding.description)}</p>
      <small>${escapeHtml(finding.evidence)}</small>
    </article>
  `).join("");
}

function renderUnsupported(tab) {
  elements.hostname.textContent = tab?.url?.startsWith("chrome://") ? "Chrome internal page" : "Unsupported page";
  elements.statusPill.className = "status unsupported";
  elements.statusPill.textContent = "Veilance cannot inspect this page";
  elements.liveState.innerHTML = "UNAVAILABLE";
  elements.thirdPartyHosts.textContent = "0";
  elements.requestCount.textContent = "0";
  elements.signalCount.textContent = "0";
  elements.storageCount.textContent = "0";
  renderFindings([]);
  elements.exportButton.disabled = true;
  elements.clearButton.disabled = true;
}

async function loadState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  if (!Number.isInteger(activeTabId) || !/^https?:/i.test(tab?.url || "")) {
    renderUnsupported(tab);
    return;
  }

  const response = await send({ type: "VEILANCE_GET_STATE", tabId: activeTabId });
  const state = response?.state;
  const summary = response?.summary;
  const findings = response?.findings || [];

  elements.hostname.textContent = state?.hostname || new URL(tab.url).hostname;
  elements.statusPill.className = `status ${summary?.status || "quiet"}`;
  elements.statusPill.textContent = summary?.label || "Observing locally";
  elements.liveState.innerHTML = "<i></i> LOCAL";
  elements.thirdPartyHosts.textContent = String(summary?.thirdPartyHostCount || 0);
  elements.requestCount.textContent = String(state?.network?.totalRequests || 0);
  elements.signalCount.textContent = String(summary?.signalCount || 0);
  elements.storageCount.textContent = String(totalStorageEvents(state));
  elements.exportButton.disabled = !state;
  elements.clearButton.disabled = !state;
  renderFindings(findings);

  if (elements.payloadPanel.open) await refreshPayloadPreview();
}

async function refreshPayloadPreview() {
  if (!Number.isInteger(activeTabId)) return;
  const response = await send({ type: "VEILANCE_GET_PAYLOAD", tabId: activeTabId });
  currentPayload = response?.payload || null;
  elements.payloadPreview.textContent = currentPayload
    ? JSON.stringify(currentPayload, null, 2)
    : "No telemetry is available for this page.";
}

function safeFilename(hostname) {
  return String(hostname || "site").replace(/[^a-z0-9.-]+/gi, "-").slice(0, 100);
}

async function exportPayload() {
  await refreshPayloadPreview();
  if (!currentPayload) return;
  const blob = new Blob([`${JSON.stringify(currentPayload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `veilance-${safeFilename(currentPayload.site?.hostname)}-${Date.now()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function clearState() {
  if (!Number.isInteger(activeTabId)) return;
  await send({ type: "VEILANCE_CLEAR_STATE", tabId: activeTabId });
  currentPayload = null;
  await loadState();
}

async function uploadPayload() {
  if (!TELEMETRY_UPLOAD_ENABLED || !TELEMETRY_UPLOAD_ENDPOINT) return;
  await refreshPayloadPreview();
  if (!currentPayload) return;
  const response = await fetch(TELEMETRY_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(currentPayload)
  });
  if (!response.ok) throw new Error(`Upload failed with HTTP ${response.status}`);
}

elements.refreshButton.addEventListener("click", () => void loadState());
elements.exportButton.addEventListener("click", () => void exportPayload());
elements.clearButton.addEventListener("click", () => void clearState());
elements.payloadPanel.addEventListener("toggle", () => {
  if (elements.payloadPanel.open) void refreshPayloadPreview();
});
elements.uploadButton.addEventListener("click", () => void uploadPayload());

elements.uploadButton.disabled = !TELEMETRY_UPLOAD_ENABLED || !TELEMETRY_UPLOAD_ENDPOINT;
elements.version.textContent = `v${chrome.runtime.getManifest().version}`;

void loadState();
const refreshTimer = setInterval(() => void loadState(), 1200);
addEventListener("unload", () => clearInterval(refreshTimer));
