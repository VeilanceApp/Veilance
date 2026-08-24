const elements = {
  liveState: document.querySelector("#liveState"),
  hostname: document.querySelector("#hostname"),
  statusPill: document.querySelector("#statusPill"),
  visitTiming: document.querySelector("#visitTiming"),
  thirdPartyHosts: document.querySelector("#thirdPartyHosts"),
  requestCount: document.querySelector("#requestCount"),
  signalCount: document.querySelector("#signalCount"),
  storageCount: document.querySelector("#storageCount"),
  findingCount: document.querySelector("#findingCount"),
  findings: document.querySelector("#findings"),
  liveDetailPanel: document.querySelector("#liveDetailPanel"),
  liveDetails: document.querySelector("#liveDetails"),
  snapshotButton: document.querySelector("#snapshotButton"),
  snapshotStatus: document.querySelector("#snapshotStatus"),
  snapshotInterest: document.querySelector("#snapshotInterest"),
  snapshotInterestScore: document.querySelector("#snapshotInterestScore"),
  snapshotInterestLabel: document.querySelector("#snapshotInterestLabel"),
  payoutSettingsButton: document.querySelector("#payoutSettingsButton"),
  clearButton: document.querySelector("#clearButton"),
  refreshButton: document.querySelector("#refreshButton"),
  settingsButton: document.querySelector("#settingsButton"),
  liveView: document.querySelector("#liveView"),
  historyView: document.querySelector("#historyView"),
  historyBadge: document.querySelector("#historyBadge"),
  historyList: document.querySelector("#historyList"),
  historyRefreshButton: document.querySelector("#historyRefreshButton"),
  historyListView: document.querySelector("#historyListView"),
  historyDetailView: document.querySelector("#historyDetailView"),
  historyDetail: document.querySelector("#historyDetail"),
  historyBackButton: document.querySelector("#historyBackButton"),
  version: document.querySelector("#version")
};

let activeTabId = null;
let activeView = "live";
let currentLiveState = null;
let currentLiveFindings = [];
let currentLiveInterest = { score: 0, level: "routine", minimumScore: 20, eligible: false, reasons: [] };
let snapshotCaptureBusy = false;

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

function totalStorageEvents(state) {
  return Object.values(state?.signals || {})
    .filter((signal) => signal.indicatorId === "browser-storage" || signal.kind === "storage")
    .reduce((sum, signal) => sum + Number(signal.count || 0), 0);
}

function formatDateTime(value) {
  if (!Number.isFinite(value)) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatListDate(value) {
  if (!Number.isFinite(value)) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDuration(startedAt, endedAt) {
  if (!Number.isFinite(startedAt)) return "Unknown duration";
  const milliseconds = Math.max(0, (Number.isFinite(endedAt) ? endedAt : Date.now()) - startedAt);
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function humanizeKey(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function displayValue(value) {
  if (value === null || value === undefined) return "Not observed";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function findingMarkup(finding) {
  return `
    <article class="finding">
      <div class="finding-title">
        <span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span>
        <strong>${escapeHtml(finding.title)}</strong>
      </div>
      <p>${escapeHtml(finding.description)}</p>
      <small>${escapeHtml(finding.evidence)}</small>
    </article>
  `;
}

function renderFindings(container, findings, emptyText) {
  if (!findings.length) {
    container.innerHTML = `<div class="empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  container.innerHTML = findings.map(findingMarkup).join("");
}

function renderSnapshotInterest(value) {
  const score = Math.max(0, Math.min(100, Math.floor(Number(value?.score) || 0)));
  const minimumScore = Math.max(1, Math.min(100, Math.floor(Number(value?.minimumScore) || 20)));
  const level = ["routine", "interesting", "high", "critical"].includes(value?.level)
    ? value.level
    : "routine";
  currentLiveInterest = {
    score,
    minimumScore,
    level,
    eligible: value?.eligible === true && score >= minimumScore,
    reasons: Array.isArray(value?.reasons) ? value.reasons : []
  };
  elements.snapshotInterest.className = `interest-meter ${level}`;
  elements.snapshotInterestScore.textContent = String(score);
  elements.snapshotInterestLabel.textContent = currentLiveInterest.eligible
    ? `${level} · ready`
    : `${minimumScore - score} more needed`;
  elements.snapshotInterest.title = currentLiveInterest.reasons.length
    ? currentLiveInterest.reasons.map((reason) => `${reason.id}: +${reason.points}`).join("\n")
    : "No notable activity has contributed to the score yet.";
}

function keyGridMarkup(values) {
  return `<div class="key-grid">${values.map(([label, value]) => `
    <div class="key-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(displayValue(value))}</strong>
    </div>
  `).join("")}</div>`;
}

function dataRowsMarkup(rows, emptyText) {
  if (!rows.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return `<div class="row-list">${rows.map((row) => `
    <div class="data-row">
      <div class="data-row-head">
        <strong>${escapeHtml(row.title)}</strong>
        <span>${escapeHtml(row.value)}</span>
      </div>
      ${row.detail ? `<p>${escapeHtml(row.detail)}</p>` : ""}
    </div>
  `).join("")}</div>`;
}

function telemetryDetailsMarkup(state) {
  if (!state) return '<div class="empty">No visit data is available.</div>';
  const hosts = Object.values(state.network?.hosts || {})
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.host).localeCompare(String(b.host)))
    .map((host) => ({
      title: host.host,
      value: `${host.count} request${host.count === 1 ? "" : "s"}`,
      detail: `${host.thirdParty ? "Third-party" : "First-party"} · ${Object.entries(host.types || {})
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type} ${count}`)
        .join(", ") || "resource type unavailable"}`
    }));
  const signals = Object.values(state.signals || {})
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.api).localeCompare(String(b.api)))
    .map((signal) => {
      const detail = Object.entries(signal.detail || {}).map(([key, value]) => `${humanizeKey(key)}: ${value}`);
      detail.push(`First ${formatDateTime(signal.firstSeen)} · Last ${formatDateTime(signal.lastSeen)}`);
      return {
        title: `${signal.api} · ${signal.action}`,
        value: `${signal.count} event${signal.count === 1 ? "" : "s"}`,
        detail: `${signal.kind}${signal.indicatorId ? ` · ${signal.indicatorId}` : ""} · ${detail.join(" · ")}`
      };
    });
  const pageEntries = Object.entries(state.page || {}).map(([key, value]) => [humanizeKey(key), value]);
  const headerEntries = Object.entries(state.security?.headers || {}).map(([key, value]) => [humanizeKey(key), value ? "Present" : "Not observed"]);
  const resourceTypes = Object.entries(state.network?.resourceTypes || {})
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${humanizeKey(type)} ${count}`)
    .join(" · ") || "None observed";

  return `
    <section class="detail-block">
      <div class="detail-block-head"><h3>Visit timeline</h3><span>${state.active === false ? "COMPLETE" : "ACTIVE"}</span></div>
      ${keyGridMarkup([
        ["Started", formatDateTime(state.startedAt)],
        ["Page load completed", formatDateTime(state.loadCompletedAt)],
        ["Ended", state.active === false ? formatDateTime(state.endedAt) : "Still active"],
        ["Duration", formatDuration(state.startedAt, state.endedAt)]
      ])}
    </section>
    <section class="detail-block">
      <div class="detail-block-head"><h3>Network contacts</h3><span>${hosts.length} HOSTS</span></div>
      ${keyGridMarkup([
        ["Total requests", state.network?.totalRequests || 0],
        ["First-party", state.network?.firstPartyRequests || 0],
        ["Third-party", state.network?.thirdPartyRequests || 0],
        ["Known services", Object.keys(state.network?.trackers || {}).length]
      ])}
      <p class="visit-timing">Resource types: ${escapeHtml(resourceTypes)}</p>
      ${dataRowsMarkup(hosts, "No network hosts were observed for this visit.")}
    </section>
    <section class="detail-block">
      <div class="detail-block-head"><h3>Browser API signals</h3><span>${signals.length} TYPES</span></div>
      ${dataRowsMarkup(signals, "No enabled API indicators fired during this visit.")}
    </section>
    <section class="detail-block">
      <div class="detail-block-head"><h3>Page snapshot</h3><span>COUNTS ONLY</span></div>
      ${keyGridMarkup(pageEntries)}
    </section>
    <section class="detail-block">
      <div class="detail-block-head"><h3>Response security</h3><span>STATUS ${escapeHtml(displayValue(state.security?.statusCode))}</span></div>
      ${keyGridMarkup(headerEntries)}
    </section>
  `;
}

function renderUnsupported(tab) {
  currentLiveState = null;
  currentLiveFindings = [];
  renderSnapshotInterest(null);
  elements.hostname.textContent = tab?.url?.startsWith("chrome://") ? "Chrome internal page" : "Unsupported page";
  elements.statusPill.className = "status unsupported";
  elements.statusPill.textContent = "Veilance cannot inspect this page";
  elements.visitTiming.textContent = "Browser-internal and extension pages are outside the observation boundary.";
  elements.liveState.textContent = "UNAVAILABLE";
  elements.thirdPartyHosts.textContent = "0";
  elements.requestCount.textContent = "0";
  elements.signalCount.textContent = "0";
  elements.storageCount.textContent = "0";
  elements.findingCount.textContent = "0";
  renderFindings(elements.findings, [], "Nothing is collected from this type of page.");
  elements.liveDetails.innerHTML = '<div class="empty">Complete details are unavailable for this page.</div>';
  elements.clearButton.disabled = true;
  elements.snapshotButton.disabled = true;
  elements.snapshotStatus.textContent = "Snapshots are unavailable for browser-internal pages.";
}

async function loadState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  if (!Number.isInteger(activeTabId) || !/^https?:/i.test(tab?.url || "")) {
    renderUnsupported(tab);
    return;
  }

  const response = await send({ type: "VEILANCE_GET_STATE", tabId: activeTabId });
  const state = response.state;
  const summary = response.summary;
  const findings = response.findings || [];
  currentLiveState = state;
  currentLiveFindings = findings;
  renderSnapshotInterest(response.interest);

  elements.hostname.textContent = state?.hostname || new URL(tab.url).hostname;
  elements.statusPill.className = `status ${summary?.status || "quiet"}`;
  elements.statusPill.textContent = summary?.label || "Observing locally";
  elements.liveState.innerHTML = "<i></i> LOCAL";
  elements.thirdPartyHosts.textContent = String(summary?.thirdPartyHostCount || 0);
  elements.requestCount.textContent = String(state?.network?.totalRequests || 0);
  elements.signalCount.textContent = String(summary?.signalCount || 0);
  elements.storageCount.textContent = String(totalStorageEvents(state));
  elements.findingCount.textContent = String(findings.length);
  elements.visitTiming.textContent = state
    ? `${state.active === false ? "Completed" : "Active"} · started ${formatDateTime(state.startedAt)} · ${formatDuration(state.startedAt, state.endedAt)}`
    : "Waiting for this page to begin reporting.";
  elements.clearButton.disabled = !state;
  elements.snapshotButton.disabled = !state || snapshotCaptureBusy || !currentLiveInterest.eligible;
  elements.snapshotButton.title = currentLiveInterest.eligible
    ? `Capture this ${currentLiveInterest.score}/100 interest visit`
    : `Snapshots require ${currentLiveInterest.minimumScore}/100 interest`;
  renderFindings(
    elements.findings,
    findings,
    "No privacy-relevant activity has been observed yet. Enabled indicators continue watching this visit."
  );
  if (elements.liveDetailPanel.open) elements.liveDetails.innerHTML = telemetryDetailsMarkup(state);
}

function historyCardMarkup(visit) {
  const endedAt = visit.endedAt || visit.updatedAt;
  return `
    <article class="visit-card">
      <button class="visit-open" type="button" data-visit-id="${escapeHtml(visit.visitId)}">
        <div class="visit-top">
          <strong class="visit-host">${escapeHtml(visit.hostname || visit.origin || "Unknown site")}</strong>
          <span class="status-dot ${escapeHtml(visit.status)}"></span>
        </div>
        <div class="visit-meta">
          <span>${escapeHtml(formatListDate(visit.startedAt))}</span>
          <span class="${visit.active ? "active-tag" : ""}">${visit.active ? "ACTIVE" : escapeHtml(formatDuration(visit.startedAt, endedAt))}</span>
        </div>
        <div class="visit-metrics">
          <span>${visit.requestCount} requests</span>
          <span>${visit.signalCount} signals</span>
          <span>${visit.findingCount} findings</span>
        </div>
      </button>
    </article>
  `;
}

async function loadHistory() {
  const response = await send({ type: "VEILANCE_GET_HISTORY" });
  const visits = response.visits || [];
  elements.historyBadge.textContent = String(visits.length);
  if (!visits.length) {
    elements.historyList.innerHTML = '<div class="empty panel-empty">No visits have been recorded yet. Browse normally and Veilance will keep up to 20 local visit sessions.</div>';
    return;
  }
  elements.historyList.innerHTML = visits.map(historyCardMarkup).join("");
  for (const button of elements.historyList.querySelectorAll("[data-visit-id]")) {
    button.addEventListener("click", () => void openHistoryVisit(button.dataset.visitId));
  }
}

async function openHistoryVisit(visitId) {
  elements.historyListView.hidden = true;
  elements.historyDetailView.hidden = false;
  elements.historyDetail.innerHTML = '<div class="empty panel-empty">Loading the complete visit…</div>';
  try {
    const response = await send({ type: "VEILANCE_GET_VISIT", visitId });
    const state = response.state;
    const summary = response.summary;
    const findings = response.findings || [];
    if (!state) throw new Error("This visit is no longer in history");
    elements.historyDetail.innerHTML = `
      <section class="detail-hero">
        <span class="label">COMPLETE VISIT</span>
        <h1>${escapeHtml(state.hostname || state.origin || "Unknown site")}</h1>
        <div class="status ${escapeHtml(summary.status)}">${escapeHtml(summary.label)}</div>
        <p>${escapeHtml(formatDateTime(state.startedAt))} · ${escapeHtml(formatDuration(state.startedAt, state.endedAt))} · ${state.active === false ? "Visit complete" : "Visit still active"}</p>
      </section>
      <section class="metrics">
        <article><strong>${state.network?.totalRequests || 0}</strong><span>requests</span></article>
        <article><strong>${summary.signalCount || 0}</strong><span>API signals</span></article>
        <article><strong>${summary.thirdPartyHostCount || 0}</strong><span>third parties</span></article>
        <article><strong>${findings.length}</strong><span>findings</span></article>
      </section>
      <section class="detail-section">
        <header><h3>Findings</h3><p>Observed behavior is evidence, not proof of malicious intent.</p></header>
        <div class="section-body history-findings"></div>
      </section>
      <section class="details-panel" open>
        <div class="telemetry-details">${telemetryDetailsMarkup(state)}</div>
      </section>
      <button class="delete-visit" type="button" data-delete-visit="${escapeHtml(state.visitId)}">Delete this visit</button>
    `;
    renderFindings(
      elements.historyDetail.querySelector(".history-findings"),
      findings,
      "No enabled indicator produced a finding during this visit."
    );
    elements.historyDetail.querySelector("[data-delete-visit]").addEventListener("click", async () => {
      if (!confirm("Delete this visit from local history?")) return;
      await send({ type: "VEILANCE_DELETE_VISIT", visitId: state.visitId });
      showHistoryList();
      await loadHistory();
    });
  } catch (error) {
    elements.historyDetail.innerHTML = `<div class="empty panel-empty">${escapeHtml(error.message)}</div>`;
  }
}

function showHistoryList() {
  elements.historyDetailView.hidden = true;
  elements.historyListView.hidden = false;
  elements.historyDetail.innerHTML = "";
}

async function clearCurrentVisit() {
  if (!Number.isInteger(activeTabId)) return;
  await send({ type: "VEILANCE_CLEAR_STATE", tabId: activeTabId });
  await Promise.all([loadState(), loadHistory()]);
}

async function takeTelemetrySnapshot() {
  if (!Number.isInteger(activeTabId) || snapshotCaptureBusy || !currentLiveInterest.eligible) return;
  snapshotCaptureBusy = true;
  elements.snapshotButton.disabled = true;
  elements.snapshotButton.textContent = "Redacting…";
  elements.snapshotStatus.classList.remove("error");
  elements.snapshotStatus.textContent = "Building an inert, redacted copy of this page locally…";
  try {
    const response = await send({
      type: "VEILANCE_CREATE_TELEMETRY_SNAPSHOT",
      tabId: activeTabId
    });
    const host = response.snapshot?.hostname || currentLiveState?.hostname || "this site";
    const score = response.snapshot?.interest?.score ?? currentLiveInterest.score;
    elements.snapshotStatus.textContent = `Saved ${host} locally at ${score}/100 interest. Review it in Settings.`;
  } catch (error) {
    elements.snapshotStatus.classList.add("error");
    elements.snapshotStatus.textContent = error.message;
  } finally {
    snapshotCaptureBusy = false;
    elements.snapshotButton.textContent = "Take snapshot";
    elements.snapshotButton.disabled = !currentLiveState || !currentLiveInterest.eligible;
  }
}

async function switchView(view) {
  activeView = view;
  elements.liveView.hidden = view !== "live";
  elements.historyView.hidden = view !== "history";
  for (const button of document.querySelectorAll(".nav-button[data-view]")) {
    button.classList.toggle("active", button.dataset.view === view);
  }
  if (view === "history") {
    showHistoryList();
    await loadHistory();
  } else {
    await loadState();
  }
}

async function openSettingsSection(section) {
  const url = chrome.runtime.getURL(`settings.html#${section}`);
  if (typeof chrome.tabs?.create === "function") {
    await chrome.tabs.create({ url });
    return;
  }
  await chrome.runtime.openOptionsPage();
}

for (const button of document.querySelectorAll(".nav-button[data-view]")) {
  button.addEventListener("click", () => void switchView(button.dataset.view));
}
elements.settingsButton.addEventListener("click", () => void chrome.runtime.openOptionsPage());
elements.refreshButton.addEventListener("click", () => void loadState());
elements.historyRefreshButton.addEventListener("click", () => void loadHistory());
elements.historyBackButton.addEventListener("click", showHistoryList);
elements.clearButton.addEventListener("click", () => void clearCurrentVisit());
elements.snapshotButton.addEventListener("click", () => void takeTelemetrySnapshot());
elements.payoutSettingsButton.addEventListener("click", () => void openSettingsSection("wallet"));
elements.liveDetailPanel.addEventListener("toggle", () => {
  if (elements.liveDetailPanel.open) elements.liveDetails.innerHTML = telemetryDetailsMarkup(currentLiveState);
});

elements.version.textContent = `v${chrome.runtime.getManifest().version}`;

void Promise.all([loadState(), loadHistory()]).catch((error) => {
  console.error("Veilance popup failed to initialize", error);
});
const refreshTimer = setInterval(() => {
  if (activeView === "live") void loadState().catch(() => {});
}, 1500);
addEventListener("unload", () => clearInterval(refreshTimer));
