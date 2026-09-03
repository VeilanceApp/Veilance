import {
  initializeTheme,
  subscribeToTheme,
  toggleResolvedTheme
} from "./lib/theme.js";

const elements = {
  setupNotice: document.querySelector("#setupNotice"),
  finishSetupButton: document.querySelector("#finishSetupButton"),
  themeToggle: document.querySelector("#themeToggle"),
  liveState: document.querySelector("#liveState"),
  hostname: document.querySelector("#hostname"),
  statusPill: document.querySelector("#statusPill"),
  statusPillText: document.querySelector("#statusPillText"),
  statusExplanation: document.querySelector("#statusExplanation"),
  visitTiming: document.querySelector("#visitTiming"),
  liveMessage: document.querySelector("#liveMessage"),
  activityBreakdown: document.querySelector("#activityBreakdown"),
  openReportButton: document.querySelector("#openReportButton"),
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
  liveDashboard: document.querySelector("#liveDashboard"),
  unsupportedPage: document.querySelector("#unsupportedPage"),
  unsupportedKind: document.querySelector("#unsupportedKind"),
  unsupportedDescription: document.querySelector("#unsupportedDescription"),
  unsupportedRetryButton: document.querySelector("#unsupportedRetryButton"),
  unsupportedSettingsButton: document.querySelector("#unsupportedSettingsButton"),
  historyView: document.querySelector("#historyView"),
  historyBadge: document.querySelector("#historyBadge"),
  historyList: document.querySelector("#historyList"),
  historyRefreshButton: document.querySelector("#historyRefreshButton"),
  historyListView: document.querySelector("#historyListView"),
  historyDetailView: document.querySelector("#historyDetailView"),
  historyDetail: document.querySelector("#historyDetail"),
  historyBackButton: document.querySelector("#historyBackButton"),
  protectionsView: document.querySelector("#protectionsView"),
  protectionBadge: document.querySelector("#protectionBadge"),
  protectionStateBadge: document.querySelector("#protectionStateBadge"),
  protectionSummary: document.querySelector("#protectionSummary"),
  protectionTotal: document.querySelector("#protectionTotal"),
  protectionEventCount: document.querySelector("#protectionEventCount"),
  protectionEvents: document.querySelector("#protectionEvents"),
  openProtectionSettings: document.querySelector("#openProtectionSettings"),
  version: document.querySelector("#version")
};

let activeTabId = null;
let activeView = "live";
let currentLiveState = null;
let currentLiveInterest = { score: 0, level: "routine", minimumScore: 25, eligible: false, reasons: [] };
let snapshotCaptureBusy = false;
let automaticSnapshotCaptureEnabled = false;
let currentProtectionSettings = { fingerprintEnabled: true, trackerEnabled: false, trackerAvailable: false };
const ONBOARDING_STATE_KEY = "veilanceOnboardingStateV1";

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

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

function overviewIcon(kind) {
  const paths = {
    connections: '<circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="6" r="3"></circle><circle cx="18" cy="18" r="3"></circle><path d="m8.6 10.5 6.8-3M8.6 13.5l6.8 3"></path>',
    browser: '<rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M3 9h18M7 6.5h.01M10 6.5h.01M8 14h3M14 14h2M8 17h8"></path>',
    shield: '<path d="M12 3 5.5 5.7v5.5c0 4.2 2.7 7.7 6.5 9.8 3.8-2.1 6.5-5.6 6.5-9.8V5.7L12 3Z"></path><path d="m9 12 2 2 4-4"></path>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind]}</svg>`;
}

function overviewRowMarkup(category) {
  return `
    <div class="overview-row ${category.tone || ""}" data-overview-row="${category.id}">
      <span class="overview-icon">${overviewIcon(category.icon)}</span>
      <span class="overview-copy"><strong>${escapeHtml(category.title)}</strong><small>${escapeHtml(category.summary)}</small></span>
      <span class="overview-value"><b>${escapeHtml(category.value)}</b><small>${escapeHtml(category.unit)}</small></span>
    </div>`;
}

function renderPrivacyBreakdown(state, trackerObservations = [], availability = "available") {
  const available = availability === "available" && state;
  const totalRequests = available ? Math.max(0, Number(state.network?.totalRequests) || 0) : 0;
  const firstPartyRequests = available ? Math.max(0, Number(state.network?.firstPartyRequests) || 0) : 0;
  const thirdPartyRequests = available ? Math.max(0, Number(state.network?.thirdPartyRequests) || 0) : 0;
  elements.openReportButton.disabled = !available;

  if (!available) {
    elements.activityBreakdown.innerHTML = `<div class="activity-loading">${availability === "pending" ? "Checking page activity…" : "Activity is unavailable for this page."}</div>`;
    return;
  }

  const trackers = (Array.isArray(trackerObservations) ? trackerObservations : [])
    .filter((entry) => entry && typeof entry === "object")
    .sort((a, b) => Number(b.requests || 0) - Number(a.requests || 0) || String(a.id).localeCompare(String(b.id)));
  const trackerRequests = trackers.reduce((sum, entry) => sum + Math.max(0, Number(entry.requests) || 0), 0);
  const thirdPartyHosts = Object.values(state.network?.hosts || {})
    .filter((entry) => entry.thirdParty)
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.host).localeCompare(String(b.host)));
  const allSignals = Object.values(state.signals || {});
  const storageSignals = allSignals
    .filter((signal) => signal.indicatorId === "browser-storage" || signal.kind === "storage")
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  const browserSignals = allSignals
    .filter((signal) => signal.indicatorId !== "browser-storage" && signal.kind !== "storage")
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  const storageEvents = storageSignals.reduce((sum, signal) => sum + Math.max(0, Number(signal.count) || 0), 0);
  const browserEvents = browserSignals.reduce((sum, signal) => sum + Math.max(0, Number(signal.count) || 0), 0);
  const protectionEnabled = currentProtectionSettings?.fingerprintEnabled === true;
  const protectionCount = Math.max(0, Number(state.protections?.total) || 0);

  const categories = [
    {
      id: "connections",
      icon: "connections",
      title: "Website connections",
      value: totalRequests.toLocaleString(),
      unit: totalRequests === 1 ? "request" : "requests",
      tone: trackers.length ? "attention" : "clear",
      summary: totalRequests
        ? `${firstPartyRequests.toLocaleString()} stayed with this site; ${thirdPartyRequests.toLocaleString()} went to ${plural(thirdPartyHosts.length, "outside service")}. ${trackers.length ? `${plural(trackerRequests, "request")} matched ${plural(trackers.length, "known tracker service")}.` : "None matched a known tracker service."}`
        : "No network requests have been observed yet. Requests are how a page loads images, sign-in, payments, analytics, and other features."
    },
    {
      id: "browser",
      icon: "browser",
      title: "Browser and storage access",
      value: (browserEvents + storageEvents).toLocaleString(),
      unit: browserEvents + storageEvents === 1 ? "action" : "actions",
      tone: browserEvents + storageEvents ? "neutral" : "clear",
      summary: browserEvents + storageEvents
        ? `${plural(browserEvents, "browser action")} and ${plural(storageEvents, "storage action")} were observed. Veilance records counts—not passwords, messages, locations, or stored values.`
        : "No monitored browser or storage action has been observed. Veilance never reads passwords, messages, or saved values."
    },
    {
      id: "shield",
      icon: "shield",
      title: "Veilance Shield",
      value: protectionEnabled ? (protectionCount ? protectionCount.toLocaleString() : "On") : "Off",
      unit: protectionEnabled && protectionCount ? (protectionCount === 1 ? "change" : "changes") : "",
      tone: protectionEnabled ? "protected" : "neutral",
      summary: protectionEnabled
        ? protectionCount
          ? `Shield changed supported fingerprinting answers ${plural(protectionCount, "time")} before this site received them. The report shows exactly what and how.`
          : "Shield is on. Nothing supported has needed changing yet; observation and protection are shown separately."
        : "Shield is off, so Veilance is observing this page without changing what the website receives."
    }
  ];

  elements.activityBreakdown.innerHTML = categories.map(overviewRowMarkup).join("");
}

function findingCountLabel(count) {
  const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
  return `${normalizedCount} ${normalizedCount === 1 ? "finding" : "findings"}`;
}

function renderStatus(summary, findings = []) {
  const highFindings = findings.filter((finding) => finding.severity === "high");
  const label = highFindings.length
    ? "Sensitive access needs attention"
    : findings.length
      ? "Privacy activity worth reviewing"
      : "No concerns found so far";

  elements.statusPill.className = `status ${summary?.status || "quiet"}`;
  elements.statusPill.classList.add("opens-report");
  elements.statusPillText.textContent = label;
  elements.statusPill.disabled = false;
  elements.statusPill.title = "Open the privacy report";
  elements.statusPill.setAttribute("aria-label", `${label}. Open the privacy report.`);
  elements.statusExplanation.textContent = highFindings.length
    ? `Veilance noticed ${plural(highFindings.length, "sensitive action")} such as permission or device access. This does not automatically mean the site is unsafe.`
    : findings.length
      ? `Veilance found ${plural(findings.length, "item")} worth explaining. Open the report to see what happened, why it matters, and what you can do.`
      : "Nothing concerning has been noticed so far. Veilance is still watching this visit.";
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
    <article class="finding" tabindex="-1">
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
  const minimumScore = Math.max(1, Math.min(100, Math.floor(Number(value?.minimumScore) || 25)));
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
  elements.snapshotInterest.className = `interest-meter ${level}${currentLiveInterest.eligible ? " ready" : ""}`;
  elements.snapshotInterest.style.setProperty("--interest-progress", `${score}%`);
  elements.snapshotInterestScore.textContent = String(score);
  elements.snapshotInterestLabel.textContent = currentLiveInterest.eligible
    ? "Ready to save"
    : `${minimumScore - score} ${minimumScore - score === 1 ? "point" : "points"} until ready`;
  elements.snapshotInterest.setAttribute("aria-valuenow", String(score));
  elements.snapshotInterest.setAttribute(
    "aria-valuetext",
    currentLiveInterest.eligible
      ? `${score} out of 100. Ready to save.`
      : `${score} out of 100. ${minimumScore - score} points until ready.`
  );
  elements.snapshotInterest.title = currentLiveInterest.reasons.length
    ? currentLiveInterest.reasons.map((reason) => `${reason.id}: +${reason.points}`).join("\n")
    : "No notable activity has contributed to the score yet.";
}

function renderSnapshotButtonState() {
  elements.snapshotButton.disabled =
    automaticSnapshotCaptureEnabled ||
    !currentLiveState ||
    snapshotCaptureBusy ||
    !currentLiveInterest.eligible;

  if (automaticSnapshotCaptureEnabled) {
    elements.snapshotButton.title = "Automatic snapshots are enabled. Disable them in Settings to take snapshots manually.";
    if (!snapshotCaptureBusy) {
      elements.snapshotStatus.classList.remove("error");
      elements.snapshotStatus.dataset.automaticCaptureNotice = "true";
      elements.snapshotStatus.textContent = "Automatic snapshots are enabled. Disable them in Settings to save one manually.";
    }
    return;
  }

  elements.snapshotButton.title = currentLiveInterest.eligible
    ? `Capture this ${currentLiveInterest.score}/100 interest visit`
    : `Snapshots require ${currentLiveInterest.minimumScore}/100 interest`;
  if (elements.snapshotStatus.dataset.automaticCaptureNotice === "true") {
    delete elements.snapshotStatus.dataset.automaticCaptureNotice;
    elements.snapshotStatus.textContent = "";
  }
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
      <div class="detail-block-head"><h3>Visit timeline</h3><span>${state.active === false ? "Complete" : "Active"}</span></div>
      ${keyGridMarkup([
        ["Started", formatDateTime(state.startedAt)],
        ["Page load completed", formatDateTime(state.loadCompletedAt)],
        ["Ended", state.active === false ? formatDateTime(state.endedAt) : "Still active"],
        ["Duration", formatDuration(state.startedAt, state.endedAt)]
      ])}
    </section>
    <section class="detail-block">
      <div class="detail-block-head"><h3>Network contacts</h3><span>${hosts.length} host${hosts.length === 1 ? "" : "s"}</span></div>
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
      <div class="detail-block-head"><h3>Browser API calls</h3><span>${signals.length} type${signals.length === 1 ? "" : "s"}</span></div>
      ${dataRowsMarkup(signals, "No enabled API indicators fired during this visit.")}
    </section>
    <section class="detail-block">
      <div class="detail-block-head"><h3>Page snapshot</h3><span>Counts only</span></div>
      ${keyGridMarkup(pageEntries)}
    </section>
    <section class="detail-block">
      <div class="detail-block-head"><h3>Response security</h3><span>Status ${escapeHtml(displayValue(state.security?.statusCode))}</span></div>
      ${keyGridMarkup(headerEntries)}
    </section>
  `;
}

function renderUnsupported(tab) {
  currentLiveState = null;
  renderSnapshotInterest(null);
  elements.liveDashboard.hidden = true;
  elements.unsupportedPage.hidden = false;
  const url = String(tab?.url || "");
  if (/^(?:chrome|edge|brave|about):/i.test(url)) {
    elements.unsupportedKind.textContent = "Protected browser page";
    elements.unsupportedDescription.textContent = "Browsers do not allow extensions to inspect internal pages. Veilance will resume automatically on a regular website.";
  } else if (/^(?:chrome|moz)-extension:/i.test(url)) {
    elements.unsupportedKind.textContent = "Extension page";
    elements.unsupportedDescription.textContent = "Veilance does not inspect other extension pages. Open a regular website to resume monitoring.";
  } else if (/^file:/i.test(url)) {
    elements.unsupportedKind.textContent = "Local file";
    elements.unsupportedDescription.textContent = "Local computer files are outside Veilance’s observation boundary and remain untouched.";
  } else {
    elements.unsupportedKind.textContent = "Unsupported address";
    elements.unsupportedDescription.textContent = "This tab does not use a supported web address. Veilance works on standard HTTP and HTTPS websites.";
  }
  elements.hostname.textContent = tab?.url?.startsWith("chrome://") ? "Chrome internal page" : "Unsupported page";
  elements.statusPill.className = "status unsupported";
  elements.statusPillText.textContent = "Veilance cannot inspect this page";
  elements.statusPill.disabled = true;
  elements.statusPill.title = "Veilance cannot inspect this page";
  elements.statusPill.setAttribute("aria-label", "Veilance cannot inspect this page");
  elements.statusExplanation.textContent = "Browser and extension pages are private boundaries. Veilance resumes automatically on a normal website.";
  elements.visitTiming.textContent = "Browser-internal and extension pages are outside the observation boundary.";
  elements.liveMessage.textContent = "";
  elements.liveState.classList.add("unavailable");
  elements.liveState.innerHTML = "<i></i><span>Paused</span>";
  renderPrivacyBreakdown(null, [], "unavailable");
  elements.clearButton.disabled = true;
  elements.snapshotButton.disabled = true;
  elements.snapshotStatus.textContent = "Snapshots are unavailable for browser-internal pages.";
}

function stackProtectionEvents(events) {
  const stacked = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const surface = String(event?.surface || "Fingerprint").trim() || "Fingerprint";
    const technique = String(event?.technique || "").trim();
    const ruleId = String(event?.ruleId || "").trim();
    const key = `${ruleId}:${surface}:${technique}`.toLowerCase();
    const count = Math.max(1, Number(event?.count) || 1);
    const timestamp = Number(event?.lastProtectedAt ?? event?.timestamp) || 0;
    const current = stacked.get(key);
    if (current) {
      current.count += count;
      if (timestamp >= current.timestamp) {
        current.timestamp = timestamp;
        current.action = String(event?.action || current.action || "Protected").trim();
        current.explanation = String(event?.explanation || current.explanation || "").trim();
        current.returnedValue = event?.returnedValue || current.returnedValue;
      }
    } else {
      stacked.set(key, {
        key,
        action: String(event?.action || "Protected").trim(),
        surface,
        technique,
        explanation: String(event?.explanation || "").trim(),
        returnedValue: event?.returnedValue || null,
        count,
        timestamp
      });
    }
  }
  return [...stacked.values()].sort((a, b) => b.timestamp - a.timestamp);
}

function returnedValueMarkup(value) {
  if (!value || typeof value !== "object") {
    return '<p class="protection-return-empty">A return-value preview was not recorded for this event.</p>';
  }
  let display;
  if (value.kind === "scalar") {
    display = {
      type: value.type || typeof value.value,
      value: value.value
    };
  } else if (value.kind === "array") {
    display = {
      type: value.type || "Array",
      length: Math.max(0, Number(value.length) || 0),
      sample: Array.isArray(value.sample) ? value.sample : [],
      truncated: value.truncated === true
    };
  } else if (value.kind === "object") {
    display = {
      type: value.type || "Object",
      fields: value.fields && typeof value.fields === "object" ? value.fields : {}
    };
  } else if (value.kind === "blob") {
    display = {
      type: value.type || "application/octet-stream",
      size: Math.max(0, Number(value.length) || 0)
    };
  } else if (value.kind === "encoded-data") {
    display = {
      type: value.mimeType || value.type || "encoded data",
      length: Math.max(0, Number(value.length) || 0),
      preview: String(value.preview || "")
    };
  } else {
    display = value;
  }
  return `<pre class="protection-return-value">${escapeHtml(JSON.stringify(display, null, 2))}</pre>`;
}

function protectionEventCopy(event) {
  const surface = event?.surface;
  if (event?.technique) {
    return {
      title: String(event.technique),
      description: String(event.explanation || `${surface || "Fingerprint data"} was protected before the website received it.`)
    };
  }
  const normalized = String(surface || "").toLowerCase();
  if (normalized.includes("canvas")) {
    return {
      title: "Canvas fingerprint shielded",
      description: "The website received randomized Canvas data."
    };
  }
  if (normalized.includes("webgl")) {
    return {
      title: "WebGL fingerprint shielded",
      description: "The website received randomized graphics data."
    };
  }
  if (normalized.includes("audio")) {
    return {
      title: "Audio fingerprint shielded",
      description: "The website received randomized audio data."
    };
  }
  return {
    title: `${surface || "Fingerprint"} shielded`,
    description: "Veilance Shield changed the fingerprint data before the website received it."
  };
}

function protectionEventMarkup(event, expanded = false) {
  const count = Math.max(1, Number(event?.count) || 1);
  const copy = protectionEventCopy(event);
  return `
    <details class="protection-event-card" data-protection-key="${escapeHtml(event.key || "")}"${expanded ? " open" : ""}>
      <summary class="protection-event-summary">
        <span class="protection-event-icon" aria-hidden="true">✓</span>
        <span class="protection-event-copy">
          <strong>${escapeHtml(copy.title)}</strong>
          <span>${escapeHtml(copy.description)}</span>
        </span>
        <span class="protection-event-count">${count.toLocaleString()}×</span>
        <span class="protection-event-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="protection-returned-data">
        <span class="label">Returned to website</span>
        ${returnedValueMarkup(event.returnedValue)}
        <p>Large pixel and audio buffers show a bounded sample; the website received the full protected value.</p>
      </div>
    </details>`;
}

function renderProtections(state = currentLiveState, settings = currentProtectionSettings) {
  const enabled = settings?.fingerprintEnabled === true;
  const protectionState = state?.protections || {};
  const events = Array.isArray(protectionState.events) ? protectionState.events : [];
  const stackedEvents = stackProtectionEvents(events);
  const eventTotal = stackedEvents.reduce((sum, event) => sum + event.count, 0);
  const total = Math.max(eventTotal, Math.max(0, Number(protectionState.total) || 0));
  elements.protectionBadge.textContent = String(total);
  elements.protectionTotal.textContent = total.toLocaleString();
  elements.protectionEventCount.textContent = `${total.toLocaleString()} total`;
  elements.protectionStateBadge.textContent = enabled ? "On" : "Off";
  elements.protectionStateBadge.className = `protection-state ${enabled ? "on" : "off"}`;
  elements.protectionSummary.textContent = enabled
    ? total > 0
      ? `Veilance Shield protected fingerprint data ${total.toLocaleString()} time${total === 1 ? "" : "s"} before this website received it.`
      : `Veilance Shield is on with ${Math.max(0, Number(settings?.activeRuleCount) || 0).toLocaleString()} active protection rules.`
    : "Fingerprint Shield is off. Turn it on to protect supported fingerprint surfaces.";
  if (!enabled) {
    elements.protectionEvents.innerHTML = '<div class="protection-empty-state"><strong>Veilance Shield is off</strong><p>Turn it on in Settings, then reload the page.</p></div>';
  } else if (!stackedEvents.length) {
    elements.protectionEvents.innerHTML = '<div class="protection-empty-state"><strong>Nothing shielded yet</strong><p>This page has not tried a supported fingerprint read.</p></div>';
  } else {
    const expanded = new Set(
      [...elements.protectionEvents.querySelectorAll("details[data-protection-key][open]")]
        .map((entry) => entry.dataset.protectionKey)
    );
    elements.protectionEvents.innerHTML = stackedEvents
      .map((event) => protectionEventMarkup(event, expanded.has(event.key)))
      .join("");
  }
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
  automaticSnapshotCaptureEnabled = response.snapshotCapture?.automatic === true;
  currentProtectionSettings = response.protections || currentProtectionSettings;
  renderProtections(state, currentProtectionSettings);
  renderSnapshotInterest(response.interest);
  elements.unsupportedPage.hidden = true;
  elements.liveDashboard.hidden = false;

  elements.hostname.textContent = state?.hostname || new URL(tab.url).hostname;
  elements.liveMessage.textContent = "";
  renderStatus(summary, findings);
  elements.liveState.classList.remove("unavailable");
  elements.liveState.innerHTML = "<i></i><span>Monitoring</span>";
  renderPrivacyBreakdown(state, response.trackers);
  elements.visitTiming.textContent = state
    ? `${state.active === false ? "Completed" : "Active"} · started ${formatDateTime(state.startedAt)} · ${formatDuration(state.startedAt, state.endedAt)}`
    : "Waiting for this page to begin reporting.";
  elements.clearButton.disabled = !state;
  renderSnapshotButtonState();
}

function renderLiveError(error) {
  currentLiveState = null;
  renderSnapshotInterest(null);
  elements.unsupportedPage.hidden = true;
  elements.liveDashboard.hidden = false;
  elements.hostname.textContent = "Unable to load site data";
  elements.statusPill.className = "status unsupported";
  elements.statusPillText.textContent = "Veilance did not respond";
  elements.statusPill.disabled = true;
  elements.statusPill.title = "Veilance did not respond";
  elements.statusPill.setAttribute("aria-label", "Veilance did not respond");
  elements.statusExplanation.textContent = "The page was not changed. Reload the extension or try again.";
  elements.visitTiming.textContent = "Monitoring has not changed the page. Try refreshing this view or reloading the extension.";
  elements.liveMessage.textContent = error?.message || "An unexpected extension error occurred.";
  elements.liveState.classList.add("unavailable");
  elements.liveState.innerHTML = "<i></i><span>Unavailable</span>";
  renderPrivacyBreakdown(null, [], "unavailable");
  elements.clearButton.disabled = true;
  elements.snapshotButton.disabled = true;
}

function renderHistoryError(error) {
  elements.historyList.innerHTML = `<div class="empty panel-empty">Visit history could not be loaded. ${escapeHtml(error?.message || "Try again in a moment.")}</div>`;
}

async function refreshLive() {
  elements.refreshButton.disabled = true;
  elements.refreshButton.classList.add("is-loading");
  try {
    await loadState();
  } catch (error) {
    renderLiveError(error);
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.classList.remove("is-loading");
  }
}

async function refreshHistory() {
  elements.historyRefreshButton.disabled = true;
  elements.historyRefreshButton.classList.add("is-loading");
  try {
    await loadHistory();
  } catch (error) {
    renderHistoryError(error);
  } finally {
    elements.historyRefreshButton.disabled = false;
    elements.historyRefreshButton.classList.remove("is-loading");
  }
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
          <span class="${visit.active ? "active-tag" : ""}">${visit.active ? "Active" : escapeHtml(formatDuration(visit.startedAt, endedAt))}</span>
        </div>
        <div class="visit-metrics">
          <span>${visit.requestCount} requests</span>
          <span>${visit.signalCount} browser API calls</span>
          <span>${findingCountLabel(visit.findingCount)}</span>
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
        <span class="label">Complete visit</span>
        <h1>${escapeHtml(state.hostname || state.origin || "Unknown site")}</h1>
        <div class="status ${escapeHtml(summary.status)}">${escapeHtml(summary.label)}</div>
        <p>${escapeHtml(formatDateTime(state.startedAt))} · ${escapeHtml(formatDuration(state.startedAt, state.endedAt))} · ${state.active === false ? "Visit complete" : "Visit still active"}</p>
      </section>
      <section class="metrics">
        <article><strong>${state.network?.totalRequests || 0}</strong><span>requests</span></article>
        <article><strong>${summary.signalCount || 0}</strong><span>browser API calls</span></article>
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
      <button class="history-report-button" type="button" data-open-report="${escapeHtml(state.visitId)}">
        View graphs and full privacy report <span aria-hidden="true">→</span>
      </button>
      <button class="delete-visit" type="button" data-delete-visit="${escapeHtml(state.visitId)}">Delete this visit</button>
    `;
    renderFindings(
      elements.historyDetail.querySelector(".history-findings"),
      findings,
      "No enabled indicator produced a finding during this visit."
    );
    elements.historyDetail.querySelector("[data-open-report]").addEventListener("click", () => {
      void openPrivacyReport({ visitId: state.visitId, tabId: null });
    });
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
  if (!confirm("Reset the current visit? Veilance will discard its live data and immediately begin monitoring the page again.")) return;
  await send({ type: "VEILANCE_CLEAR_STATE", tabId: activeTabId });
  await Promise.all([loadState(), loadHistory()]);
}

async function takeTelemetrySnapshot() {
  if (
    !Number.isInteger(activeTabId) ||
    automaticSnapshotCaptureEnabled ||
    snapshotCaptureBusy ||
    !currentLiveInterest.eligible
  ) return;
  snapshotCaptureBusy = true;
  elements.snapshotButton.disabled = true;
  elements.snapshotButton.textContent = "Redacting…";
  elements.snapshotStatus.classList.remove("error");
  delete elements.snapshotStatus.dataset.automaticCaptureNotice;
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
    elements.snapshotButton.textContent = "Save snapshot";
    renderSnapshotButtonState();
  }
}

async function switchView(view) {
  activeView = view;
  elements.liveView.hidden = view !== "live";
  elements.historyView.hidden = view !== "history";
  elements.protectionsView.hidden = view !== "protections";
  for (const button of document.querySelectorAll(".nav-button[data-view]")) {
    button.classList.toggle("active", button.dataset.view === view);
  }
  if (view === "history") {
    showHistoryList();
    await refreshHistory();
  } else if (view === "protections") {
    await loadState();
    renderProtections(currentLiveState, currentProtectionSettings);
  } else {
    await refreshLive();
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

async function openPrivacyReport({ visitId = currentLiveState?.visitId, tabId = activeTabId } = {}) {
  const parameters = new URLSearchParams();
  if (visitId) parameters.set("visitId", visitId);
  if (Number.isInteger(tabId)) parameters.set("tabId", String(tabId));
  const url = chrome.runtime.getURL(`report.html${parameters.size ? `?${parameters}` : ""}`);
  if (typeof chrome.tabs?.create === "function") await chrome.tabs.create({ url });
}

async function updateOnboardingNotice() {
  try {
    const stored = await chrome.storage.local.get(ONBOARDING_STATE_KEY);
    elements.setupNotice.hidden = stored?.[ONBOARDING_STATE_KEY]?.completed === true;
  } catch {
    elements.setupNotice.hidden = false;
  }
}

async function openOnboarding() {
  const url = chrome.runtime.getURL("onboarding.html");
  if (typeof chrome.tabs?.create === "function") await chrome.tabs.create({ url });
}

for (const button of document.querySelectorAll(".nav-button[data-view]")) {
  button.addEventListener("click", () => void switchView(button.dataset.view));
}
elements.settingsButton.addEventListener("click", () => void chrome.runtime.openOptionsPage());
elements.finishSetupButton.addEventListener("click", () => void openOnboarding());
elements.unsupportedSettingsButton.addEventListener("click", () => void chrome.runtime.openOptionsPage());
elements.unsupportedRetryButton.addEventListener("click", () => {
  elements.unsupportedRetryButton.disabled = true;
  void refreshLive().finally(() => { elements.unsupportedRetryButton.disabled = false; });
});
elements.themeToggle.addEventListener("click", () => void toggleResolvedTheme().catch((error) => {
  console.error("Veilance could not save the theme preference", error);
}));
elements.refreshButton.addEventListener("click", () => void refreshLive());
elements.statusPill.addEventListener("click", () => void openPrivacyReport({
  visitId: currentLiveState?.visitId,
  tabId: activeTabId
}));
elements.historyRefreshButton.addEventListener("click", () => void refreshHistory());
elements.historyBackButton.addEventListener("click", showHistoryList);
elements.clearButton.addEventListener("click", () => void clearCurrentVisit().catch((error) => {
  elements.liveMessage.textContent = error?.message || "The current visit could not be reset.";
}));
elements.snapshotButton.addEventListener("click", () => void takeTelemetrySnapshot());
elements.openReportButton.addEventListener("click", () => void openPrivacyReport({
  visitId: currentLiveState?.visitId,
  tabId: activeTabId
}));
elements.payoutSettingsButton.addEventListener("click", () => void openSettingsSection("wallet"));
elements.openProtectionSettings.addEventListener("click", () => void openSettingsSection("protections"));

elements.version.textContent = `v${chrome.runtime.getManifest().version}`;
renderPrivacyBreakdown(null, [], "pending");

subscribeToTheme(({ resolved }) => {
  const nextTheme = resolved === "dark" ? "light" : "dark";
  elements.themeToggle.title = `Use ${nextTheme} mode`;
  elements.themeToggle.setAttribute("aria-label", `Use ${nextTheme} mode`);
});
void initializeTheme();
void updateOnboardingNotice();

chrome.storage.onChanged?.addListener?.((changes, areaName) => {
  if (areaName === "local" && changes[ONBOARDING_STATE_KEY]) void updateOnboardingNotice();
});

void loadState().catch(renderLiveError);
void loadHistory().catch(renderHistoryError);
const refreshTimer = setInterval(() => {
  if (activeView === "live" || activeView === "protections") void loadState().catch(() => {});
}, 1500);
addEventListener("unload", () => clearInterval(refreshTimer));
