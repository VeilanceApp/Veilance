import {
  initializeTheme,
  subscribeToTheme,
  toggleResolvedTheme
} from "./lib/theme.js";

const elements = {
  loadingState: document.querySelector("#loadingState"),
  errorState: document.querySelector("#errorState"),
  errorMessage: document.querySelector("#errorMessage"),
  retryButton: document.querySelector("#retryButton"),
  reportContent: document.querySelector("#reportContent"),
  refreshButton: document.querySelector("#refreshButton"),
  printButton: document.querySelector("#printButton"),
  settingsButton: document.querySelector("#settingsButton"),
  themeToggle: document.querySelector("#themeToggle"),
  hostname: document.querySelector("#hostname"),
  visitState: document.querySelector("#visitState"),
  visitStarted: document.querySelector("#visitStarted"),
  visitDuration: document.querySelector("#visitDuration"),
  assessment: document.querySelector("#assessment"),
  assessmentLabel: document.querySelector("#assessmentLabel"),
  assessmentNote: document.querySelector("#assessmentNote"),
  plainSummaryTitle: document.querySelector("#plainSummaryTitle"),
  plainSummaryText: document.querySelector("#plainSummaryText"),
  totalRequests: document.querySelector("#totalRequests"),
  requestSplit: document.querySelector("#requestSplit"),
  thirdPartyHosts: document.querySelector("#thirdPartyHosts"),
  trackerCount: document.querySelector("#trackerCount"),
  trackerRequestCount: document.querySelector("#trackerRequestCount"),
  browserActivityCount: document.querySelector("#browserActivityCount"),
  storageActivityCount: document.querySelector("#storageActivityCount"),
  chartSummary: document.querySelector("#chartSummary"),
  chartHowToRead: document.querySelector("#chartHowToRead"),
  activityTimeline: document.querySelector("#activityTimeline"),
  chartTooltip: document.querySelector("#chartTooltip"),
  chartCoverageNote: document.querySelector("#chartCoverageNote"),
  activityRows: document.querySelector("#activityRows"),
  liveUpdatesToggle: document.querySelector("#liveUpdatesToggle"),
  liveUpdatesStatus: document.querySelector("#liveUpdatesStatus"),
  shieldStateBadge: document.querySelector("#shieldStateBadge"),
  shieldSummary: document.querySelector("#shieldSummary"),
  shieldRows: document.querySelector("#shieldRows"),
  trackerEvidenceCount: document.querySelector("#trackerEvidenceCount"),
  connectionEvidenceCount: document.querySelector("#connectionEvidenceCount"),
  browserEvidenceCount: document.querySelector("#browserEvidenceCount"),
  storageEvidenceCount: document.querySelector("#storageEvidenceCount"),
  findingEvidenceCount: document.querySelector("#findingEvidenceCount"),
  evidenceDialog: document.querySelector("#evidenceDialog"),
  evidenceCloseButton: document.querySelector("#evidenceCloseButton"),
  evidenceDialogEyebrow: document.querySelector("#evidenceDialogEyebrow"),
  evidenceDialogTitle: document.querySelector("#evidenceDialogTitle"),
  evidenceDialogIntro: document.querySelector("#evidenceDialogIntro"),
  evidenceMeaning: document.querySelector("#evidenceMeaning"),
  evidenceImportance: document.querySelector("#evidenceImportance"),
  evidenceAction: document.querySelector("#evidenceAction"),
  evidenceDialogCount: document.querySelector("#evidenceDialogCount"),
  evidenceDialogRows: document.querySelector("#evidenceDialogRows"),
  uploadStateBadge: document.querySelector("#uploadStateBadge"),
  uploadStatusCard: document.querySelector("#uploadStatusCard"),
  uploadStatusLabel: document.querySelector("#uploadStatusLabel"),
  uploadStatusTitle: document.querySelector("#uploadStatusTitle"),
  uploadStatusDescription: document.querySelector("#uploadStatusDescription"),
  uploadStatusTime: document.querySelector("#uploadStatusTime"),
  consentValue: document.querySelector("#consentValue"),
  automaticCaptureValue: document.querySelector("#automaticCaptureValue"),
  automaticUploadValue: document.querySelector("#automaticUploadValue"),
  whatSentList: document.querySelector("#whatSentList"),
  neverSentList: document.querySelector("#neverSentList"),
  interestSummary: document.querySelector("#interestSummary"),
  whySentList: document.querySelector("#whySentList"),
  transportOutcome: document.querySelector("#transportOutcome"),
  transportDetails: document.querySelector("#transportDetails"),
  version: document.querySelector("#version")
};

const query = new URLSearchParams(location.search);
const reportRequest = {
  type: "VEILANCE_GET_PRIVACY_REPORT",
  visitId: query.get("visitId") || undefined,
  tabId: /^\d+$/.test(query.get("tabId") || "") ? Number(query.get("tabId")) : undefined
};

let currentReport = null;
let currentEvidenceTopic = null;
let selectedRange = "all";
let liveUpdatesEnabled = false;
let liveUpdateTimer = null;
let reportLoadInFlight = false;
let evidenceTopics = new Map();
let currentChartDetails = new Map();

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

function humanize(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function count(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function plural(value, singular, pluralForm = `${singular}s`) {
  const normalized = count(value);
  return `${normalized.toLocaleString()} ${normalized === 1 ? singular : pluralForm}`;
}

function formatDateTime(value) {
  if (!Number.isFinite(value)) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

function durationMilliseconds(state) {
  const start = Number(state?.startedAt);
  if (!Number.isFinite(start)) return 0;
  const end = state?.active === false && Number.isFinite(state?.endedAt) ? Number(state.endedAt) : Date.now();
  return Math.max(0, end - start);
}

function formatDurationMilliseconds(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  if (seconds < 60) return plural(seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatOffset(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function signalGroups(state) {
  const signals = Object.values(state?.signals || {});
  const storage = signals.filter((signal) => signal.indicatorId === "browser-storage" || signal.kind === "storage");
  const browser = signals.filter((signal) => signal.indicatorId !== "browser-storage" && signal.kind !== "storage");
  return {
    all: signals,
    storage,
    browser,
    storageCount: storage.reduce((sum, signal) => sum + count(signal.count), 0),
    browserCount: browser.reduce((sum, signal) => sum + count(signal.count), 0)
  };
}

function sortedThirdPartyHosts(state) {
  return Object.values(state?.network?.hosts || {})
    .filter((entry) => entry?.thirdParty)
    .sort((a, b) => count(b.count) - count(a.count) || String(a.host).localeCompare(String(b.host)));
}

function resourceTypeSummary(types) {
  return Object.entries(types || {})
    .sort((a, b) => count(b[1]) - count(a[1]))
    .map(([type, value]) => `${humanize(type)} ${count(value)}`)
    .join(" · ") || "Resource type unavailable";
}

function protectionEvents(state) {
  return (Array.isArray(state?.protections?.events) ? state.protections.events : [])
    .filter((event) => event && typeof event === "object")
    .sort((a, b) => Number(b.lastProtectedAt || b.timestamp || 0) - Number(a.lastProtectedAt || a.timestamp || 0));
}

function eventMatchesSignal(event, signal) {
  const eventIndicator = String(event?.indicatorId || "").toLowerCase();
  const signalIndicator = String(signal?.indicatorId || "").toLowerCase();
  if (eventIndicator && signalIndicator && eventIndicator === signalIndicator) return true;
  const eventApi = String(event?.api || "").toLowerCase();
  const signalApi = String(signal?.api || "").toLowerCase();
  if (!eventApi || !signalApi || eventApi !== signalApi) return false;
  const actions = Array.isArray(event?.matchedActions) ? event.matchedActions.map((action) => String(action).toLowerCase()) : [];
  const signalAction = String(signal?.action || "").toLowerCase();
  return !actions.length || actions.includes(signalAction);
}

function relatedShieldCount(state, signal) {
  return protectionEvents(state)
    .filter((event) => eventMatchesSignal(event, signal))
    .reduce((sum, event) => sum + Math.max(1, count(event.count)), 0);
}

function timelineSeries(state) {
  const timeline = state?.network?.requestTimeline;
  if (!timeline || typeof timeline !== "object" || !timeline.buckets || typeof timeline.buckets !== "object") return null;
  const bucketMs = Math.max(1_000, Math.min(60_000, count(timeline.bucketMs) || 5_000));
  const maximumBuckets = Math.max(1, Math.min(2_000, count(timeline.maximumBuckets) || 720));
  const values = new Map();
  for (const [key, value] of Object.entries(timeline.buckets)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= maximumBuckets || !value) continue;
    values.set(index, {
      firstParty: count(value.firstParty),
      thirdParty: count(value.thirdParty),
      total: count(value.total)
    });
  }
  return {
    bucketMs,
    maximumBuckets,
    startedOffsetMs: count(timeline.startedOffsetMs),
    overflowed: timeline.overflowed === true,
    values
  };
}

function groupedTimeline(state, range) {
  const timeline = timelineSeries(state);
  if (!timeline) return null;
  const visitDuration = durationMilliseconds(state);
  const lastObservedIndex = timeline.values.size ? Math.max(...timeline.values.keys()) : 0;
  const coverageEnd = Math.max(timeline.bucketMs, Math.min(
    timeline.maximumBuckets * timeline.bucketMs,
    Math.max(visitDuration, (lastObservedIndex + 1) * timeline.bucketMs)
  ));
  const rangeMs = range === "all" ? coverageEnd : Number(range) * 1000;
  const startMs = Math.max(0, coverageEnd - rangeMs);
  const firstIndex = Math.max(0, Math.floor(startMs / timeline.bucketMs));
  const endIndex = Math.max(firstIndex + 1, Math.min(timeline.maximumBuckets, Math.ceil(coverageEnd / timeline.bucketMs)));
  const dense = [];
  for (let index = firstIndex; index < endIndex; index += 1) {
    const value = timeline.values.get(index) || { firstParty: 0, thirdParty: 0, total: 0 };
    dense.push({
      startMs: index * timeline.bucketMs,
      endMs: (index + 1) * timeline.bucketMs,
      firstParty: value.firstParty,
      thirdParty: value.thirdParty,
      total: Math.max(value.total, value.firstParty + value.thirdParty)
    });
  }
  const groupSize = Math.max(1, Math.ceil(dense.length / 56));
  const groups = [];
  for (let index = 0; index < dense.length; index += groupSize) {
    const members = dense.slice(index, index + groupSize);
    groups.push({
      startMs: members[0].startMs,
      endMs: members[members.length - 1].endMs,
      firstParty: members.reduce((sum, item) => sum + item.firstParty, 0),
      thirdParty: members.reduce((sum, item) => sum + item.thirdParty, 0),
      total: members.reduce((sum, item) => sum + item.total, 0)
    });
  }
  return { ...timeline, coverageEnd, startMs, groups };
}

function chartGrid({ maximum, width, height, left, right, top, bottom }) {
  const plotHeight = height - top - bottom;
  const output = [];
  for (let step = 0; step <= 4; step += 1) {
    const y = top + plotHeight - plotHeight * step / 4;
    const value = Math.ceil(maximum * step / 4);
    output.push(`<line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line>`);
    output.push(`<text class="chart-axis-label" x="${left - 8}" y="${y + 3}" text-anchor="end">${value}</text>`);
  }
  return output.join("");
}

function registerChartDetail(key, detail) {
  currentChartDetails.set(key, detail);
}

function chartMarkAttributes(key, label, x, y, extraClass = "") {
  return `class="chart-mark ${extraClass}" tabindex="0" role="img" data-chart-key="${escapeHtml(key)}" data-chart-x="${Number(x).toFixed(2)}" data-chart-y="${Number(y).toFixed(2)}" aria-label="${escapeHtml(label)}"`;
}

function requestDetail(group) {
  return {
    title: `${formatOffset(group.startMs)}–${formatOffset(group.endMs)} into this visit`,
    rows: [
      ["All requests", group.total.toLocaleString()],
      ["From this website", group.firstParty.toLocaleString()],
      ["From other services", group.thirdParty.toLocaleString()]
    ],
    note: "An outside-service request is not automatically harmful; the evidence section shows where it went."
  };
}

function protectionMarkers(state, series, chartBounds) {
  const startedAt = Number(state?.startedAt);
  if (!Number.isFinite(startedAt)) return "";
  const endMs = series.groups.at(-1)?.endMs || series.coverageEnd;
  const span = Math.max(1, endMs - series.startMs);
  const candidates = protectionEvents(state).filter((event) => {
    const timestamp = Number(event.lastProtectedAt ?? event.timestamp);
    const offset = timestamp - startedAt;
    return Number.isFinite(timestamp) && offset >= series.startMs && offset <= endMs;
  });
  return candidates.slice(0, 20).map((event, index) => {
    const timestamp = Number(event.lastProtectedAt ?? event.timestamp);
    const offset = timestamp - startedAt;
    const x = chartBounds.left + (offset - series.startMs) / span * chartBounds.plotWidth;
    const y = chartBounds.top + 7 + index % 2 * 10;
    const key = `shield-${index}-${String(event.ruleId || "rule")}`;
    const label = `Latest Shield change for ${event.technique || event.surface || "a protected value"} at ${formatOffset(offset)}`;
    registerChartDetail(key, {
      title: "Shield changed a supported answer",
      rows: [
        ["Time", formatOffset(offset)],
        ["Website asked for", event.api || event.surface || "Fingerprint-related data"],
        ["Protection", event.technique || "Fingerprint Shield"],
        ["Protected reads", Math.max(1, count(event.count)).toLocaleString()]
      ],
      note: "This marker shows the latest recorded change for this protection rule. Open the Shield section for what changed and what the site received."
    });
    return `<g ${chartMarkAttributes(key, label, x, y, "chart-shield-mark")}><circle cx="${x}" cy="${y}" r="5"></circle><path d="M${x - 2.4} ${y}l1.6 1.7 3.3-3.5"></path></g>`;
  }).join("");
}

function renderBarChart(state, series) {
  const width = 860;
  const height = 286;
  const left = 48;
  const right = 14;
  const top = 28;
  const bottom = 40;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(1, ...series.groups.map((group) => group.total));
  const columnWidth = plotWidth / Math.max(1, series.groups.length);
  const barWidth = Math.max(1, Math.min(18, columnWidth - 2));
  const bars = series.groups.map((group, index) => {
    const x = left + index * columnWidth + (columnWidth - barWidth) / 2;
    const firstHeight = plotHeight * group.firstParty / maximum;
    const thirdHeight = plotHeight * group.thirdParty / maximum;
    const firstY = top + plotHeight - firstHeight;
    const thirdY = firstY - thirdHeight;
    const key = `request-${index}`;
    const label = `${formatOffset(group.startMs)} to ${formatOffset(group.endMs)}: ${group.total} total requests, ${group.firstParty} from this website and ${group.thirdParty} from other services`;
    registerChartDetail(key, requestDetail(group));
    return `<g ${chartMarkAttributes(key, label, x + barWidth / 2, Math.max(top, thirdY))}><rect class="chart-first-bar" x="${x}" y="${firstY}" width="${barWidth}" height="${firstHeight}" rx="1"></rect><rect class="chart-third-bar" x="${x}" y="${thirdY}" width="${barWidth}" height="${thirdHeight}" rx="1"></rect><rect class="chart-hit-area" x="${x - 2}" y="${top}" width="${barWidth + 4}" height="${plotHeight}"></rect></g>`;
  }).join("");
  const markers = protectionMarkers(state, series, { left, top, plotWidth });
  const endLabel = series.groups.at(-1)?.endMs || series.coverageEnd;
  elements.requestChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar graph of requests from this website and other services over time">
      ${chartGrid({ maximum, width, height, left, right, top, bottom })}${bars}${markers}
      <text class="chart-axis-label" x="${left}" y="${height - 10}" text-anchor="start">${formatOffset(series.startMs)}</text>
      <text class="chart-axis-label" x="${width - right}" y="${height - 10}" text-anchor="end">${formatOffset(endLabel)}</text>
      <text class="chart-axis-label" x="${left + plotWidth / 2}" y="${height - 10}" text-anchor="middle">Time in visit</text>
    </svg>`;
}

function renderLineChart(state, series) {
  const width = 860;
  const height = 286;
  const left = 48;
  const right = 14;
  const top = 28;
  const bottom = 40;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(1, ...series.groups.flatMap((group) => [group.firstParty, group.thirdParty]));
  const pointFor = (value, index) => {
    const x = series.groups.length === 1 ? left + plotWidth / 2 : left + index / (series.groups.length - 1) * plotWidth;
    const y = top + plotHeight - value / maximum * plotHeight;
    return { x, y };
  };
  const firstPoints = series.groups.map((group, index) => pointFor(group.firstParty, index));
  const thirdPoints = series.groups.map((group, index) => pointFor(group.thirdParty, index));
  const pathFor = (points) => points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const hitWidth = Math.max(10, plotWidth / Math.max(1, series.groups.length));
  const marks = series.groups.map((group, index) => {
    const first = firstPoints[index];
    const third = thirdPoints[index];
    const key = `request-${index}`;
    const label = `${formatOffset(group.startMs)} to ${formatOffset(group.endMs)}: ${group.firstParty} requests from this website and ${group.thirdParty} from other services`;
    registerChartDetail(key, requestDetail(group));
    return `<g ${chartMarkAttributes(key, label, first.x, Math.min(first.y, third.y))}><circle class="chart-first-point" cx="${first.x}" cy="${first.y}" r="3.2"></circle><circle class="chart-third-point" cx="${third.x}" cy="${third.y}" r="3.2"></circle><rect class="chart-hit-area" x="${first.x - hitWidth / 2}" y="${top}" width="${hitWidth}" height="${plotHeight}"></rect></g>`;
  }).join("");
  const markers = protectionMarkers(state, series, { left, top, plotWidth });
  const endLabel = series.groups.at(-1)?.endMs || series.coverageEnd;
  elements.requestChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Line chart comparing requests from this website with requests to other services over time">
      ${chartGrid({ maximum, width, height, left, right, top, bottom })}
      <path class="chart-first-line" d="${pathFor(firstPoints)}"></path>
      <path class="chart-third-line" d="${pathFor(thirdPoints)}"></path>
      ${marks}${markers}
      <text class="chart-axis-label" x="${left}" y="${height - 10}" text-anchor="start">${formatOffset(series.startMs)}</text>
      <text class="chart-axis-label" x="${width - right}" y="${height - 10}" text-anchor="end">${formatOffset(endLabel)}</text>
      <text class="chart-axis-label" x="${left + plotWidth / 2}" y="${height - 10}" text-anchor="middle">Time in visit</text>
    </svg>`;
}

function polarPoint(cx, cy, radius, angle) {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function renderPieChart(series) {
  const firstParty = series.groups.reduce((sum, group) => sum + group.firstParty, 0);
  const thirdParty = series.groups.reduce((sum, group) => sum + group.thirdParty, 0);
  const total = firstParty + thirdParty;
  if (!total) {
    elements.requestChart.innerHTML = '<div class="chart-empty"><div><strong>No requests in this timeframe</strong><p>Choose a longer timeframe or turn on live updates while the page is active.</p></div></div>';
    return;
  }
  const cx = 150;
  const cy = 125;
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const slices = [
    { key: "pie-first", label: "This website", technical: "Same-site", value: firstParty, className: "chart-first-slice" },
    { key: "pie-third", label: "Other services", technical: "Third-party", value: thirdParty, className: "chart-third-slice" }
  ];
  const nonEmptySlices = slices.filter((slice) => slice.value > 0).length;
  let consumed = 0;
  const markup = slices.map((slice) => {
    if (!slice.value) return "";
    const share = slice.value / total;
    const start = consumed;
    const segmentLength = circumference * share;
    consumed += segmentLength;
    const mid = -Math.PI / 2 + (start + segmentLength / 2) / circumference * Math.PI * 2;
    const tooltipPoint = polarPoint(cx, cy, radius, mid);
    const percentage = Math.round(share * 100);
    const label = `${slice.label}: ${slice.value} requests, ${percentage} percent of the selected timeframe`;
    registerChartDetail(slice.key, {
      title: `${slice.label} (${slice.technical.toLowerCase()})`,
      rows: [["Requests", slice.value.toLocaleString()], ["Share", `${percentage}%`]],
      note: slice.technical === "Third-party"
        ? "These requests went to a domain outside the website you opened. They may support useful features, analytics, or advertising."
        : "These requests stayed with the same registrable website domain."
    });
    const gap = nonEmptySlices > 1 ? 4 : 0;
    const visibleLength = Math.max(1, segmentLength - gap);
    return `<g ${chartMarkAttributes(slice.key, label, tooltipPoint.x, tooltipPoint.y)}><circle class="chart-donut-segment ${slice.className}" cx="${cx}" cy="${cy}" r="${radius}" transform="rotate(-90 ${cx} ${cy})" stroke-dasharray="${visibleLength.toFixed(2)} ${(circumference - visibleLength).toFixed(2)}" stroke-dashoffset="${(-start).toFixed(2)}"></circle></g>`;
  }).join("");
  const firstPercent = Math.round(firstParty / total * 100);
  const thirdPercent = 100 - firstPercent;
  elements.requestChart.innerHTML = `
    <div class="pie-chart-layout">
      <svg class="pie-chart-svg" viewBox="0 0 300 250" role="img" aria-label="Pie chart showing the share of requests from this website and other services">
        <circle class="chart-donut-track" cx="${cx}" cy="${cy}" r="${radius}"></circle>
        ${markup}
        <text class="pie-center-value" x="${cx}" y="${cy - 2}">${total.toLocaleString()}</text>
        <text class="pie-center-label" x="${cx}" y="${cy + 17}">requests</text>
      </svg>
      <div class="pie-breakdown" aria-label="Selected timeframe request breakdown">
        <span class="pie-breakdown-title">Selected timeframe</span>
        <div class="pie-breakdown-row first"><i aria-hidden="true"></i><div><span>This website</span><small>Same-site requests</small></div><strong>${firstParty.toLocaleString()}<small>${firstPercent}%</small></strong></div>
        <div class="pie-breakdown-row third"><i aria-hidden="true"></i><div><span>Other services</span><small>Third-party requests</small></div><strong>${thirdParty.toLocaleString()}<small>${thirdPercent}%</small></strong></div>
      </div>
    </div>`;
}

const ACTIVITY_LANES = Object.freeze([
  ["same-site", "Site requests"],
  ["outside", "Outside services"],
  ["browser", "Browser features"],
  ["storage", "Storage & permissions"],
  ["shield", "Shield changes"]
]);

function activityCategoryForSignal(signal) {
  const kind = String(signal?.kind || signal?.signalKind || "").toLowerCase();
  const identity = `${signal?.indicatorId || ""} ${signal?.api || ""}`.toLowerCase();
  if (kind === "storage" || /cookie|storage|indexeddb|cache|serviceworker/.test(identity)) return "storage";
  if (kind === "permission" || kind === "sensitive-api" || /permission|geolocation|clipboard|media|camera|microphone|sensor|credential|file|notification|device/.test(identity)) return "permission";
  if (kind === "fingerprinting" || /canvas|webgl|audio|font|navigator|screen|timezone|locale|webgpu|webrtc/.test(identity)) return "fingerprinting";
  return "browser";
}

function fallbackActivityEvents(state) {
  const events = [];
  const startedAt = Number(state?.startedAt) || 0;
  const requestTimeline = state?.network?.requestTimeline;
  const bucketMs = Math.max(1_000, count(requestTimeline?.bucketMs) || 5_000);
  for (const value of Object.values(requestTimeline?.buckets || {})) {
    const offsetMs = Math.max(0, Number(value?.offsetMs) || 0);
    if (count(value?.firstParty)) events.push({ kind: "network", category: "same-site", offsetMs, lastOffsetMs: offsetMs + bucketMs, count: count(value.firstParty), aggregate: true });
    if (count(value?.thirdParty)) events.push({ kind: "network", category: "third-party", offsetMs, lastOffsetMs: offsetMs + bucketMs, count: count(value.thirdParty), aggregate: true });
  }
  for (const signal of Object.values(state?.signals || {})) {
    const first = Math.max(0, Number(signal?.firstSeen) - startedAt || 0);
    const last = Math.max(first, Number(signal?.lastSeen) - startedAt || first);
    events.push({ kind: "browser", category: activityCategoryForSignal(signal), offsetMs: first, lastOffsetMs: last, count: Math.max(1, count(signal?.count)), indicatorId: signal?.indicatorId, signalKind: signal?.kind, api: signal?.api, action: signal?.action, detail: signal?.detail, aggregate: true });
  }
  for (const protection of protectionEvents(state)) {
    const first = Math.max(0, Number(protection?.firstProtectedAt ?? protection?.timestamp) - startedAt || 0);
    const last = Math.max(first, Number(protection?.lastProtectedAt ?? protection?.timestamp) - startedAt || first);
    events.push({ kind: "shield", category: "shield", offsetMs: first, lastOffsetMs: last, count: Math.max(1, count(protection?.count)), ruleId: protection?.ruleId, indicatorId: protection?.indicatorId, api: protection?.api, action: protection?.action, surface: protection?.surface, technique: protection?.technique, changedUnits: protection?.totalChangedUnits ?? protection?.changedUnits, aggregate: true });
  }
  return events;
}

function activitySeries(state, range) {
  const timeline = state?.activityTimeline;
  const recorded = Array.isArray(timeline?.events)
    ? timeline.events.filter((event) => event && Number.isFinite(Number(event.offsetMs)))
    : [];
  const detailed = recorded.length > 0;
  const source = detailed ? recorded : fallbackActivityEvents(state);
  const events = source.map((event) => ({
    ...event,
    offsetMs: Math.max(0, Number(event.offsetMs) || 0),
    lastOffsetMs: Math.max(Number(event.offsetMs) || 0, Number(event.lastOffsetMs) || Number(event.offsetMs) || 0),
    count: Math.max(1, count(event.count))
  }));
  const latestEvent = events.reduce((maximum, event) => Math.max(maximum, event.lastOffsetMs), 0);
  const endMs = Math.max(1_000, durationMilliseconds(state), latestEvent);
  const rangeMs = range === "all" ? endMs : Math.max(1_000, Number(range) * 1_000);
  const startMs = Math.max(0, endMs - rangeMs);
  return {
    detailed,
    startMs,
    endMs,
    startedOffsetMs: Number.isFinite(timeline?.startedOffsetMs) ? Math.max(0, Number(timeline.startedOffsetMs)) : null,
    droppedEvents: count(timeline?.droppedEvents),
    events: events.filter((event) => event.lastOffsetMs >= startMs && event.offsetMs <= endMs)
      .sort((a, b) => a.offsetMs - b.offsetMs || String(a.category).localeCompare(String(b.category)))
  };
}

function activityLane(category) {
  if (category === "same-site") return "same-site";
  if (["third-party", "tracker"].includes(category)) return "outside";
  if (["storage", "permission"].includes(category)) return "storage";
  return category === "shield" ? "shield" : "browser";
}

function activityTypeLabel(category) {
  return ({ "same-site": "Site request", "third-party": "Outside service", tracker: "Known tracker", fingerprinting: "Fingerprinting-related", storage: "Storage", permission: "Permission or device access", browser: "Browser feature", shield: "Shield change" })[category] || "Browser activity";
}

function requestedResourceDescription(type) {
  return ({ main_frame: "the page document", sub_frame: "an embedded page or frame", stylesheet: "a stylesheet controlling page appearance", script: "JavaScript code", image: "an image", font: "a font file", object: "an embedded object", xmlhttprequest: "an API or data response", fetch: "an API or data response", ping: "a beacon or measurement endpoint", csp_report: "a browser security report endpoint", media: "audio or video", websocket: "a live WebSocket connection", webtransport: "a live WebTransport connection", webbundle: "a bundled web resource", other: "another web resource", multiple: "several kinds of web resources" })[String(type || "other").toLowerCase()] || humanize(type || "web resource").toLowerCase();
}

function browserInformationDescription(event) {
  const value = `${event?.indicatorId || ""} ${event?.api || ""}`.toLowerCase();
  if (/canvas/.test(value)) return "canvas pixels, exports, or text measurements";
  if (/webgl|webgpu/.test(value)) return "graphics renderer or hardware capability information";
  if (/audio|analyser/.test(value)) return "audio-processing characteristics";
  if (/font/.test(value)) return "font availability or text measurements";
  if (/navigator|clienthint/.test(value)) return "browser and device characteristics";
  if (/screen|orientation/.test(value)) return "screen size, scale, or orientation characteristics";
  if (/locale|timezone/.test(value)) return "language, locale, or time-zone characteristics";
  if (/webrtc|networkinformation/.test(value)) return "network or connection characteristics";
  if (/cookie/.test(value)) return "cookie storage; names and values were not retained";
  if (/storage|indexeddb|cache|serviceworker/.test(value)) return "site storage; names and stored values were not retained";
  if (/geolocation/.test(value)) return "location access; coordinates were not retained";
  if (/clipboard/.test(value)) return "clipboard access; contents were not retained";
  if (/media|camera|microphone/.test(value)) return "camera, microphone, or media-device access";
  if (/file/.test(value)) return "file or folder access; contents were not retained";
  if (/credential|webauthn/.test(value)) return "credential or authenticator access; secrets were not retained";
  if (/sensor|battery|device|gamepad|midi/.test(value)) return "device capability or sensor information";
  if (/permission|notification/.test(value)) return `permission status${event?.detail?.permission ? ` for ${humanize(event.detail.permission).toLowerCase()}` : ""}`;
  return "a browser capability or characteristic";
}

function matchingProtection(state, event) {
  return protectionEvents(state).find((protection) => (
    (event?.ruleId && protection?.ruleId === event.ruleId) || eventMatchesSignal(protection, event)
  )) || null;
}

function activityTimeLabel(event) {
  const first = Math.max(0, Number(event?.offsetMs) || 0);
  const last = Math.max(first, Number(event?.lastOffsetMs) || first);
  return last - first >= 1_000 ? `${formatOffset(first)}–${formatOffset(last)}` : formatOffset(first);
}

function activityDescription(event) {
  if (event?.kind === "network") {
    if (event.aggregate && !event.host) return `${activityTypeLabel(event.category)} activity from an older aggregate visit record`;
    const tracker = event.category === "tracker" && event.trackerLabel ? `${event.trackerLabel}: ` : "";
    return `${tracker}${event.method || "GET"} ${requestedResourceDescription(event.resourceType)} → ${event.host || "destination unavailable"}`;
  }
  if (event?.kind === "shield") return `${event.surface || event.api || "Fingerprint value"} changed using ${event.technique || "an active Shield rule"}`;
  return `${event.api || "Browser"} · ${humanize(event.action || "used")} — ${browserInformationDescription(event)}`;
}

function activityDetail(state, event) {
  const time = activityTimeLabel(event);
  const occurrences = Math.max(1, count(event?.count));
  if (event?.kind === "network") {
    const outside = ["third-party", "tracker"].includes(event.category);
    const rows = [["Time in visit", time], ["Destination", event.host || (outside ? "Outside domains in this time period" : "This website")], ["Relationship", event.category === "tracker" ? "Known tracker match" : outside ? "Outside service (third-party)" : "This website (same-site)"], ["Requested item", requestedResourceDescription(event.resourceType || (event.aggregate ? "multiple" : "other"))], ["Request method", event.aggregate ? "Not retained in this older record" : event.method || "GET"], ["Occurrences", occurrences.toLocaleString()]];
    if (event.trackerLabel) rows.splice(3, 0, ["Tracker match", `${event.trackerLabel}${event.trackerCategory ? ` · ${humanize(event.trackerCategory)}` : ""}`]);
    return { title: event.trackerLabel || event.host || activityTypeLabel(event.category), rows, note: "Veilance can verify the destination, request method, and browser resource category. It does not inspect the request body, response body, or private data inside the transfer." };
  }
  if (event?.kind === "shield") {
    const protection = matchingProtection(state, event);
    return { title: `Shield protected ${event.surface || event.api || "a browser value"}`, rows: [["Time in visit", time], ["Website asked for", event.api || event.surface || protection?.api || "Fingerprint-related browser information"], ["Shield method", event.technique || protection?.technique || "Active fingerprint rule"], ["Changed units", count(event.changedUnits || protection?.changedUnits).toLocaleString()], ["Website received", returnedValueDescription(protection?.returnedValue)], ["Protected actions", occurrences.toLocaleString()]], note: protection?.explanation || "Shield changed a supported fingerprint answer before the website received it." };
  }
  const shielded = relatedShieldCount(state, event);
  return { title: `${event.api || "Browser"} · ${humanize(event.action || "used")}`, rows: [["Time in visit", time], ["Activity type", activityTypeLabel(event.category)], ["Browser information", browserInformationDescription(event)], ["Action", humanize(event.action || "used")], ["Observed", occurrences.toLocaleString()], ["Shield outcome", shielded ? `${shielded.toLocaleString()} related value changes` : "Observed only; not changed"]], note: shielded ? "A matching Shield marker shows when a supported answer was changed. Open the Shield section for the protected value returned to the website." : "Observation records that the capability was used. It does not mean Veilance blocked it or that the website acted maliciously." };
}

function renderActivityTimeline(state) {
  currentChartDetails = new Map();
  hideChartTooltip();
  const series = activitySeries(state, selectedRange);
  if (!series.events.length) {
    elements.activityTimeline.innerHTML = '<div class="chart-empty"><div><strong>No activity in this timeframe</strong><p>Choose a longer timeframe or turn on live updates while the website is active.</p></div></div>';
    elements.activityRows.innerHTML = '<tr><td colspan="4">No recorded activity in this timeframe.</td></tr>';
    elements.chartSummary.textContent = "No website or browser activity was recorded in this timeframe.";
    elements.chartCoverageNote.textContent = "Veilance records supported activity locally and does not inspect private request or response contents.";
    return;
  }
  const width = 900;
  const left = 150;
  const right = 18;
  const top = 24;
  const laneHeight = 45;
  const bottom = 43;
  const height = top + ACTIVITY_LANES.length * laneHeight + bottom;
  const plotWidth = width - left - right;
  const span = Math.max(1, series.endMs - series.startMs);
  const laneIndex = new Map(ACTIVITY_LANES.map(([id], index) => [id, index]));
  const occupied = new Map();
  const bands = ACTIVITY_LANES.map(([id, label], index) => {
    const y = top + index * laneHeight;
    return `<rect class="activity-lane-band ${index % 2 ? "alternate" : ""}" x="${left}" y="${y}" width="${plotWidth}" height="${laneHeight}"></rect><line class="activity-lane-line" x1="${left}" y1="${y + laneHeight}" x2="${width - right}" y2="${y + laneHeight}"></line><text class="activity-lane-label" x="${left - 12}" y="${y + laneHeight / 2 + 4}" text-anchor="end">${escapeHtml(label)}</text>`;
  }).join("");
  const timeGrid = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const x = left + plotWidth * ratio;
    return `<line class="activity-time-line" x1="${x}" y1="${top}" x2="${x}" y2="${top + ACTIVITY_LANES.length * laneHeight}"></line><text class="chart-axis-label" x="${x}" y="${height - 13}" text-anchor="middle">${formatOffset(series.startMs + span * ratio)}</text>`;
  }).join("");
  const marks = series.events.map((event, index) => {
    const lane = activityLane(event.category);
    const midpoint = (Math.max(series.startMs, event.offsetMs) + Math.min(series.endMs, event.lastOffsetMs)) / 2;
    const x = left + Math.max(0, Math.min(1, (midpoint - series.startMs) / span)) * plotWidth;
    const stackKey = `${lane}:${Math.round(x / 9)}`;
    const stack = occupied.get(stackKey) || 0;
    occupied.set(stackKey, stack + 1);
    const y = top + (laneIndex.get(lane) ?? 2) * laneHeight + laneHeight / 2 + [0, -8, 8, -14, 14][stack % 5];
    const radius = Math.min(8.5, 3.6 + Math.log2(Math.max(1, event.count) + 1) * 1.15);
    const key = `activity-${index}`;
    registerChartDetail(key, activityDetail(state, event));
    const label = `${activityTypeLabel(event.category)} at ${activityTimeLabel(event)}: ${activityDescription(event)}. ${plural(event.count, "occurrence")}.`;
    const shieldCheck = event.category === "shield" ? `<path class="activity-shield-check" d="M${x - 2.5} ${y}l1.7 1.8 3.5-3.8"></path>` : "";
    return `<g ${chartMarkAttributes(key, label, x, y, `activity-event ${escapeHtml(event.category)}`)}><circle class="activity-marker-dot" cx="${x}" cy="${y}" r="${radius}"></circle>${shieldCheck}<circle class="activity-marker-hit" cx="${x}" cy="${y}" r="${Math.max(10, radius + 4)}"></circle></g>`;
  }).join("");
  elements.activityTimeline.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Timeline of website requests, outside services, browser access, storage and permission activity, and Shield changes">${bands}${timeGrid}${marks}<text class="activity-axis-title" x="${left + plotWidth / 2}" y="${height - 1}" text-anchor="middle">Time in this visit</text></svg>`;
  const totals = series.events.reduce((result, event) => {
    const value = Math.max(1, count(event.count));
    result.all += value;
    if (["third-party", "tracker"].includes(event.category)) result.outside += value;
    if (["fingerprinting", "browser", "storage", "permission"].includes(event.category)) result.browser += value;
    if (event.category === "shield") result.shield += value;
    return result;
  }, { all: 0, outside: 0, browser: 0, shield: 0 });
  elements.chartSummary.textContent = `${plural(totals.all, "recorded activity", "recorded activities")} · ${plural(totals.outside, "outside connection")} · ${plural(totals.browser, "browser action")} · ${plural(totals.shield, "Shield change")}.`;
  const notes = ["Network entries show the destination and resource category; Veilance does not inspect request or response contents."];
  if (!series.detailed) notes.unshift("This older visit uses aggregate timing; new visits include destination and action-level timing.");
  if (series.detailed && Number.isFinite(series.startedOffsetMs) && series.startedOffsetMs > 0) notes.push(`Detailed activity capture began ${formatOffset(series.startedOffsetMs)} into this visit.`);
  if (series.droppedEvents) notes.push(`${plural(series.droppedEvents, "additional event")} were summarized after the local timeline reached its safety limit.`);
  elements.chartCoverageNote.textContent = notes.join(" ");
  elements.activityRows.innerHTML = series.events.map((event) => `<tr><td>${escapeHtml(activityTimeLabel(event))}</td><td><span class="activity-table-type ${escapeHtml(event.category)}">${escapeHtml(activityTypeLabel(event.category))}</span></td><td>${escapeHtml(activityDescription(event))}</td><td>${Math.max(1, count(event.count)).toLocaleString()}</td></tr>`).join("");
}

function hideChartTooltip() {
  elements.chartTooltip.hidden = true;
  elements.chartTooltip.innerHTML = "";
}

function showChartTooltip(mark, event) {
  const detail = currentChartDetails.get(mark?.dataset?.chartKey);
  if (!detail) return;
  elements.chartTooltip.innerHTML = `
    <strong>${escapeHtml(detail.title)}</strong>
    <dl>${detail.rows.map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
    ${detail.note ? `<p>${escapeHtml(detail.note)}</p>` : ""}`;
  elements.chartTooltip.hidden = false;
  const visual = elements.activityTimeline.parentElement;
  const bounds = visual.getBoundingClientRect();
  const markBounds = mark.getBoundingClientRect();
  const pointerX = Number.isFinite(event?.clientX) && event.clientX > 0 ? event.clientX : markBounds.left + markBounds.width / 2;
  const pointerY = Number.isFinite(event?.clientY) && event.clientY > 0 ? event.clientY : markBounds.top + markBounds.height / 2;
  const initialX = pointerX - bounds.left + 12;
  const initialY = pointerY - bounds.top + 12;
  elements.chartTooltip.style.left = `${initialX}px`;
  elements.chartTooltip.style.top = `${initialY}px`;
  requestAnimationFrame(() => {
    if (elements.chartTooltip.hidden) return;
    const width = elements.chartTooltip.offsetWidth;
    const height = elements.chartTooltip.offsetHeight;
    elements.chartTooltip.style.left = `${Math.max(8, Math.min(initialX, bounds.width - width - 8))}px`;
    elements.chartTooltip.style.top = `${Math.max(8, Math.min(initialY, bounds.height - height - 8))}px`;
  });
}

function renderChart(state) {
  renderActivityTimeline(state);
}

function findingAdvice(finding) {
  const id = String(finding?.id || "");
  if (["geolocation", "clipboard-read", "media-capture", "connected-device-access", "file-system-access", "speech-access", "credential-management"].includes(id)) {
    return "Check whether you deliberately started the feature. If not, deny or remove the site permission in your browser settings.";
  }
  if (["canvas-readback", "webgl-fingerprint-signal", "webgpu-identity", "audio-fingerprint-pattern", "offline-audio", "broad-fingerprint-surface", "repeated-font-probing"].includes(id)) {
    return "Review the Shield section. If Shield is off, enable it and reload the site; remember that no tool can prevent every form of fingerprinting.";
  }
  if (id === "known-tracker-infrastructure") {
    return "Open Known trackers to see the services. Unexpected advertising or analytics domains deserve more scrutiny than a service you intentionally used.";
  }
  if (id === "third-party-surface") {
    return "Open Outside services and look for domains you do not recognize. A large count can be normal on complex sites, so use the service names and resource types as context.";
  }
  if (["persistent-storage", "cookie-access"].includes(id)) {
    return "Use the browser’s site-data controls if you want to clear stored data or prevent this site from remembering you.";
  }
  return "Use the evidence and timing in this report as context. A signal is something to understand, not automatic proof that the site is unsafe.";
}

function evidenceRowMarkup(row) {
  return `
    <article class="report-list-row modal-evidence-row">
      <div>
        <div class="evidence-row-title">
          ${row.severity ? `<span class="severity ${escapeHtml(row.severity)}">${escapeHtml(humanize(row.severity))}</span>` : ""}
          <strong>${escapeHtml(row.title)}</strong>
          ${row.badge ? `<span class="row-badge ${escapeHtml(row.badgeTone || "")}">${escapeHtml(row.badge)}</span>` : ""}
        </div>
        ${row.detail ? `<span>${escapeHtml(row.detail)}</span>` : ""}
        ${row.evidence ? `<p><b>Evidence:</b> ${escapeHtml(row.evidence)}</p>` : ""}
        ${row.note ? `<p><b>${escapeHtml(row.noteLabel || "Helpful context")}:</b> ${escapeHtml(row.note)}</p>` : ""}
      </div>
      ${row.value ? `<b>${escapeHtml(row.value)}</b>` : ""}
    </article>`;
}

function buildEvidenceTopics(data) {
  const state = data.state;
  const hosts = sortedThirdPartyHosts(state);
  const signals = signalGroups(state);
  const trackers = Array.isArray(data.trackers) ? data.trackers : (Array.isArray(data.payloadPreview?.trackers) ? data.payloadPreview.trackers : []);
  const page = state.page || {};
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const topics = new Map();

  topics.set("trackers", {
    eyebrow: "Network evidence",
    title: "Known trackers",
    intro: "Services on this visit that matched Veilance’s maintained analytics or advertising list.",
    meaning: "A match means a request went to infrastructure commonly used for tracking, analytics, or advertising.",
    importance: "The service may receive information such as the page domain and network address. The match alone does not reveal the service’s intent or exact payload.",
    action: "Look for services you did not expect. Compare their names with the feature you were using, then use browser or site controls if you want less tracking.",
    countLabel: plural(trackers.length, "service"),
    empty: "No request matched the known tracker list during this visit.",
    rows: trackers.map((tracker) => ({
      title: tracker.label || humanize(tracker.id || "Known service"),
      detail: `${humanize(tracker.category || "Uncategorized")} · Database match, not proof of misuse`,
      value: plural(tracker.requests, "request")
    }))
  });

  topics.set("connections", {
    eyebrow: "Network evidence",
    title: "Outside services",
    intro: "Domains outside the website you opened that received a request during this visit.",
    meaning: "Modern sites use outside services for fonts, video, sign-in, payments, support, analytics, and advertising.",
    importance: "Each outside connection gives another organization a chance to observe the request. That is not automatically harmful, but it increases the number of parties involved.",
    action: "Look for unfamiliar domains or a service that seems unrelated to what you were doing. Resource types help explain what each domain supplied.",
    countLabel: plural(hosts.length, "service"),
    empty: "No request went to a domain outside this website.",
    rows: hosts.map((host) => ({
      title: host.host,
      detail: resourceTypeSummary(host.types),
      value: plural(host.count, "request")
    }))
  });

  topics.set("browser", {
    eyebrow: "Browser evidence",
    title: "Browser features",
    intro: "Monitored browser capabilities this page asked to use.",
    meaning: "A browser feature can expose a capability such as graphics, media, location, or device information. Veilance records the API action and count—not the private returned value.",
    importance: "Some features are necessary for the page. Others can contribute to permissions access or a browser fingerprint when several traits are combined.",
    action: "Pay closest attention to actions you did not initiate. The Shield badge identifies supported fingerprint answers that Veilance actually changed.",
    countLabel: plural(signals.browserCount, "call"),
    empty: "No monitored browser feature was used during this visit.",
    rows: signals.browser.map((signal) => {
      const shielded = relatedShieldCount(state, signal);
      return {
        title: `${signal.api || "Browser"} · ${humanize(signal.action || "used")}`,
        detail: `${humanize(signal.indicatorId || signal.kind || "Browser feature")} · First ${formatDateTime(signal.firstSeen)} · Last ${formatDateTime(signal.lastSeen)}`,
        value: plural(signal.count, "call"),
        badge: shielded ? `${shielded.toLocaleString()} Shield changes` : "Observed only",
        badgeTone: shielded ? "protected" : "",
        note: shielded
          ? "Shield changed a supported answer associated with this activity before the website received it."
          : "Observation does not mean Veilance blocked or changed the result."
      };
    })
  });

  const storageRows = [
    ...signals.storage.map((signal) => ({
      title: `${signal.api || "Storage"} · ${humanize(signal.action || "used")}`,
      detail: `${signal.detail?.area || humanize(signal.indicatorId || "Storage")} · Names and values are not retained`,
      value: plural(signal.count, "action")
    })),
    { title: "Script-visible cookies", detail: "Latest count; names and values are not retained", value: count(page.accessibleCookieCount).toLocaleString() },
    { title: "Local Storage keys", detail: "Count only; key names and values are not retained", value: count(page.localStorageKeyCount).toLocaleString() },
    { title: "Session Storage keys", detail: "Count only; key names and values are not retained", value: count(page.sessionStorageKeyCount).toLocaleString() },
    { title: "IndexedDB databases", detail: "Count only; database names are not retained", value: page.indexedDbCount === null ? "Not available" : count(page.indexedDbCount).toLocaleString() },
    { title: "Cache Storage entries", detail: "Count only; cache names are not retained", value: page.cacheCount === null ? "Not available" : count(page.cacheCount).toLocaleString() }
  ];
  topics.set("storage", {
    eyebrow: "Browser evidence",
    title: "Site storage",
    intro: "Counts of cookies and storage areas this page could use or change.",
    meaning: "Site storage lets a website remember sign-in, preferences, shopping carts, and identifiers between page loads.",
    importance: "Storage is often useful, but persistent identifiers can also help recognize a returning browser.",
    action: "Use your browser’s site-data settings to inspect, clear, or block storage when a site remembers more than you want.",
    countLabel: plural(signals.storageCount, "observed storage action"),
    empty: "No storage evidence is available for this visit.",
    rows: storageRows
  });

  topics.set("findings", {
    eyebrow: "Visit assessment",
    title: "Things to review",
    intro: "Plain-language conclusions Veilance drew from the observations above.",
    meaning: "A finding connects one or more observations into a pattern that may deserve attention.",
    importance: "Findings help prioritize the report. They are evidence-based warnings, not claims that a site or company acted maliciously.",
    action: "Start with High items, check whether you initiated the action, then use the recommendation shown with each finding.",
    countLabel: plural(findings.length, "finding"),
    empty: "No enabled indicator produced a finding during this visit.",
    rows: findings.map((finding) => ({
      title: finding.title,
      detail: finding.description,
      severity: finding.severity,
      evidence: finding.evidence,
      noteLabel: "What you can do",
      note: findingAdvice(finding)
    }))
  });
  return topics;
}

function populateEvidenceDialog(topicId) {
  const topic = evidenceTopics.get(topicId);
  if (!topic) return;
  currentEvidenceTopic = topicId;
  elements.evidenceDialogEyebrow.textContent = topic.eyebrow;
  elements.evidenceDialogTitle.textContent = topic.title;
  elements.evidenceDialogIntro.textContent = topic.intro;
  elements.evidenceMeaning.textContent = topic.meaning;
  elements.evidenceImportance.textContent = topic.importance;
  elements.evidenceAction.textContent = topic.action;
  elements.evidenceDialogCount.textContent = topic.countLabel;
  elements.evidenceDialogRows.innerHTML = topic.rows.length
    ? topic.rows.map(evidenceRowMarkup).join("")
    : `<div class="report-list-empty">${escapeHtml(topic.empty)}</div>`;
}

function openEvidenceDialog(topicId) {
  populateEvidenceDialog(topicId);
  if (typeof elements.evidenceDialog.showModal === "function") {
    if (!elements.evidenceDialog.open) elements.evidenceDialog.showModal();
  } else {
    elements.evidenceDialog.setAttribute("open", "");
  }
  elements.evidenceCloseButton.focus();
}

function closeEvidenceDialog() {
  if (typeof elements.evidenceDialog.close === "function" && elements.evidenceDialog.open) elements.evidenceDialog.close();
  else elements.evidenceDialog.removeAttribute("open");
  currentEvidenceTopic = null;
}

function renderEvidence(data) {
  evidenceTopics = buildEvidenceTopics(data);
  elements.trackerEvidenceCount.textContent = String(evidenceTopics.get("trackers").rows.length);
  elements.connectionEvidenceCount.textContent = String(evidenceTopics.get("connections").rows.length);
  elements.browserEvidenceCount.textContent = signalGroups(data.state).browserCount.toLocaleString();
  elements.storageEvidenceCount.textContent = signalGroups(data.state).storageCount.toLocaleString();
  elements.findingEvidenceCount.textContent = String(evidenceTopics.get("findings").rows.length);
  if (currentEvidenceTopic && elements.evidenceDialog.open) populateEvidenceDialog(currentEvidenceTopic);
}

function returnedValueDescription(value) {
  if (!value || typeof value !== "object") return "A protected answer; no preview was stored";
  if (value.kind === "scalar") return `A protected ${value.type || typeof value.value} value (${String(value.value)})`;
  if (value.kind === "array") return `${value.type || "data array"} containing ${plural(value.length, "value")}`;
  if (value.kind === "object") return `${value.type || "object"} with ${plural(Object.keys(value.fields || {}).length, "protected field")}`;
  if (value.kind === "blob") return `${value.type || "binary data"} containing ${plural(value.length, "byte")}`;
  if (value.kind === "encoded-data") return `${value.mimeType || "encoded data"} containing ${plural(value.length, "character")}`;
  return "A protected answer";
}

function relatedObservationText(state, event) {
  const matching = signalGroups(state).all.filter((signal) => eventMatchesSignal(event, signal));
  const total = matching.reduce((sum, signal) => sum + count(signal.count), 0);
  if (!total) return "Shield recorded this change directly; an older record may not include a matching observation label.";
  return `Veilance also observed ${plural(total, "related browser call")} for ${event.api || matching[0]?.api || event.surface || "this surface"}.`;
}

function renderShield(data) {
  const state = data.state;
  const enabled = data.protections?.fingerprintEnabled === true;
  const events = protectionEvents(state);
  const total = Math.max(count(state?.protections?.total), events.reduce((sum, event) => sum + Math.max(1, count(event.count)), 0));
  elements.shieldStateBadge.className = `shield-state ${enabled ? "on" : "off"}`;
  elements.shieldStateBadge.textContent = enabled ? "On" : "Off";
  elements.shieldSummary.textContent = enabled
    ? total
      ? `Shield changed supported fingerprint answers ${plural(total, "time")} on this visit. Detection and network requests are still reported separately.`
      : "Shield is on, but this page has not requested a supported fingerprint value that needed changing."
    : "Shield is off. Veilance observed the activity in this report but did not change what the website received.";
  if (!enabled) {
    elements.shieldRows.innerHTML = '<div class="shield-empty"><strong>No values were changed</strong><p>Turn on Fingerprint Shield in Settings, then reload the website to protect supported fingerprint surfaces.</p></div>';
    return;
  }
  if (!events.length) {
    elements.shieldRows.innerHTML = '<div class="shield-empty"><strong>Nothing needed changing</strong><p>Shield is ready. This page has not made a supported fingerprint read yet.</p></div>';
    return;
  }
  elements.shieldRows.innerHTML = events.map((event, index) => {
    const eventCount = Math.max(1, count(event.count));
    const latestUnits = count(event.changedUnits);
    const totalUnits = count(event.totalChangedUnits) || latestUnits;
    const changedCopy = latestUnits
      ? `${plural(latestUnits, "data point")} in the latest answer${totalUnits > latestUnits ? ` · ${plural(totalUnits, "adjustment")} recorded in total` : ""}`
      : "A supported fingerprint answer";
    const websiteAsked = event.api || event.surface || "Fingerprint-related browser data";
    const actions = Array.isArray(event.matchedActions) && event.matchedActions.length
      ? event.matchedActions.map(humanize).join(", ")
      : humanize(event.action || "read value");
    return `
      <details class="shield-event-card"${index === 0 ? " open" : ""}>
        <summary>
          <span class="shield-event-check" aria-hidden="true">✓</span>
          <span><strong>${escapeHtml(event.technique || `${event.surface || "Fingerprint"} protected`)}</strong><small>${escapeHtml(event.surface || websiteAsked)} · Last changed ${escapeHtml(formatDateTime(Number(event.lastProtectedAt ?? event.timestamp)))}</small></span>
          <b>${eventCount.toLocaleString()}×</b>
        </summary>
        <div class="shield-event-body">
          <p>${escapeHtml(event.explanation || "Shield adjusted a supported fingerprint value before the website received it.")}</p>
          <div class="shield-event-flow">
            <article><span>Website asked</span><strong>${escapeHtml(websiteAsked)}</strong><small>${escapeHtml(actions)}</small></article>
            <article><span>Shield changed</span><strong>${escapeHtml(changedCopy)}</strong><small>${escapeHtml(event.technique || "Fingerprint Shield rule")}</small></article>
            <article><span>Website received</span><strong>${escapeHtml(returnedValueDescription(event.returnedValue))}</strong><small>The full protected answer was returned; this report keeps only a bounded explanation.</small></article>
          </div>
          <div class="shield-correlation"><strong>Related observation</strong><span>${escapeHtml(relatedObservationText(state, event))}</span></div>
        </div>
      </details>`;
  }).join("");
}

function uploadCopy(snapshot) {
  const status = snapshot?.upload?.status || "none";
  const lastError = snapshot?.upload?.lastError;
  const copies = {
    none: { badge: "Not sent", label: "LOCAL ONLY", title: "No research snapshot has been created", description: "This report exists only in local history on this device." },
    local: { badge: "Not sent", label: "SAVED LOCALLY", title: "Snapshot saved locally — not sent", description: "A redacted research snapshot exists on this device, but it has not been queued or uploaded." },
    queued: { badge: "Queued", label: "NOT SENT YET", title: "Snapshot queued for upload", description: "The snapshot is waiting for its scheduled upload attempt. It has not been marked as sent." },
    uploading: { badge: "Uploading", label: "IN PROGRESS", title: "Upload is in progress", description: "Veilance started an upload but has not yet received confirmation that it was accepted." },
    failed: { badge: "Not confirmed", label: "UPLOAD FAILED", title: "The upload was not confirmed", description: `Veilance did not receive an accepted response. The request may have reached the API and can be retried.${lastError ? ` Last error: ${lastError}` : ""}` },
    uploaded: { badge: "Uploaded", label: "API ACCEPTED", title: "Telemetry was uploaded and accepted", description: "The Veilance API confirmed that it accepted the redacted research batch." },
    blocked: { badge: "Blocked locally", label: "NOT SENT", title: "The safety check blocked this snapshot", description: lastError || "The snapshot did not pass Veilance’s final local safety check and was not uploaded." }
  };
  return { status, ...(copies[status] || copies.none) };
}

function listItemsMarkup(items) {
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function detailListMarkup(rows) {
  return rows.map(([term, description]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(description || "Not available")}</dd></div>`).join("");
}

function renderTelemetry(data) {
  const snapshot = data.snapshot;
  const payload = snapshot?.payload || data.payloadPreview || {};
  const receipt = snapshot?.upload?.receipt || null;
  const copy = uploadCopy(snapshot);
  const interest = snapshot?.interest || data.interest || {};
  elements.uploadStateBadge.className = `upload-badge ${copy.status}`;
  elements.uploadStateBadge.textContent = copy.badge;
  elements.uploadStatusCard.className = `upload-status-card ${copy.status}`;
  elements.uploadStatusLabel.textContent = copy.label;
  elements.uploadStatusTitle.textContent = copy.title;
  elements.uploadStatusDescription.textContent = copy.description;
  const statusTime = snapshot?.upload?.uploadedAt || snapshot?.upload?.lastAttemptAt || snapshot?.createdAt;
  elements.uploadStatusTime.textContent = statusTime
    ? `${snapshot?.upload?.uploadedAt ? "Accepted" : snapshot?.upload?.lastAttemptAt ? "Last attempted" : "Snapshot created"} ${formatDateTime(statusTime)}`
    : "No snapshot or upload time exists for this visit.";
  elements.consentValue.textContent = data.telemetry?.consent ? "Allowed" : "Not allowed";
  elements.automaticCaptureValue.textContent = data.telemetry?.automaticCapture ? "On" : "Off";
  elements.automaticUploadValue.textContent = data.telemetry?.automatic ? "On" : "Off";

  const what = [
    "The site name and whether it used HTTPS",
    "How long observation ran and the total number of same-site and outside-service requests",
    "Outside domain names, request counts, and broad file types",
    "Known tracker matches and allowed browser-action counts",
    "Page-structure and security-header counts",
    payload.redactedDocument
      ? "A non-interactive page structure with visible text, form entries, URL paths, inline code, and secrets removed"
      : "No page structure until a redacted snapshot is deliberately created",
    "When an upload is permitted: a random device identifier, the public payout address if configured, the site hostname, and the public IP visible to the receiving server"
  ];
  elements.whatSentList.innerHTML = listItemsMarkup(what);
  elements.neverSentList.innerHTML = listItemsMarkup([
    "Passwords, messages, search text, or anything typed into a form",
    "Cookie names or values, storage keys or values, or database names",
    "Full URL paths, query strings, or fragments after the site name",
    "The request timeline, chart hover details, findings, or Shield explanations",
    "Browser credentials or the page that referred you here"
  ]);

  const score = count(interest.score);
  const minimumScore = count(interest.minimumScore) || 25;
  elements.interestSummary.innerHTML = `<span>${interest.eligible ? "Eligible for a redacted snapshot" : "Below the snapshot threshold"}</span><strong>${score}/100</strong>`;
  const reasons = (Array.isArray(interest.reasons) ? interest.reasons : []).map((reason) => `${humanize(reason.id || "Observed activity")}: +${count(reason.points)} points`);
  if (!reasons.length) reasons.push("No notable activity has contributed to the research score yet");
  reasons.push(`A score of ${minimumScore}/100 is required before a snapshot can be created`);
  reasons.push(data.telemetry?.consent
    ? "Sharing permission is enabled; your manual or automatic upload setting still controls when it sends"
    : "Sharing permission is off, so a local snapshot cannot be uploaded");
  reasons.push("An accepted snapshot may be reviewed for a VLNC payout; uploading never guarantees payment");
  elements.whySentList.innerHTML = listItemsMarkup(reasons);

  const outcome = receipt
    ? receipt.outcome === "accepted"
      ? "Accepted by the Veilance API"
      : receipt.outcome === "not-confirmed"
        ? "Upload attempt was not confirmed"
        : "Upload attempt recorded"
    : "No upload attempt is recorded for this visit";
  elements.transportOutcome.textContent = outcome;
  elements.transportDetails.innerHTML = detailListMarkup([
    ["Connection", "Encrypted HTTPS upload"],
    ["Snapshot", "Compressed redacted data"],
    ["Device identity", (receipt?.clientId || data.telemetry?.clientId) ? "Random device identifier included" : "Created only if needed"],
    ["Network address", "The receiving server sees the public IP during any internet connection"],
    ["Payout wallet", (receipt?.walletAddress || data.telemetry?.walletAddress) ? "Public payout address included" : "No public payout address configured"],
    ["Confirmation", outcome]
  ]);
}

function renderPlainSummary(data) {
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const high = findings.filter((finding) => finding.severity === "high");
  const trackerCount = Array.isArray(data.trackers) ? data.trackers.length : 0;
  const shieldTotal = count(data.state?.protections?.total);
  if (high.length) {
    elements.plainSummaryTitle.textContent = `${plural(high.length, "sensitive action")} deserve a look`;
    elements.plainSummaryText.textContent = `The site used a sensitive browser capability. Check whether you started it. A finding is not proof that the site is unsafe.${shieldTotal ? ` Shield separately changed ${plural(shieldTotal, "supported fingerprint answer")}.` : ""}`;
  } else if (findings.length || trackerCount) {
    elements.plainSummaryTitle.textContent = "Some privacy activity is worth understanding";
    elements.plainSummaryText.textContent = `Veilance found ${plural(findings.length, "item")} to explain${trackerCount ? ` and ${plural(trackerCount, "known tracker service")}` : ""}. Use the evidence buttons to see the reason and practical next step.${shieldTotal ? ` Shield changed supported fingerprint answers ${plural(shieldTotal, "time")}.` : ""}`;
  } else {
    elements.plainSummaryTitle.textContent = "Nothing needs your attention right now";
    elements.plainSummaryText.textContent = `The page is still being observed. Normal requests may appear without becoming a privacy warning.${data.protections?.fingerprintEnabled ? " Shield is on and ready if a supported fingerprint read occurs." : " Shield is off, so observation does not change what the site receives."}`;
  }
}

function renderReport(data) {
  const state = data.state;
  const summary = data.summary || {};
  const signals = signalGroups(state);
  const hosts = sortedThirdPartyHosts(state);
  const trackers = Array.isArray(data.trackers) ? data.trackers : (Array.isArray(data.payloadPreview?.trackers) ? data.payloadPreview.trackers : []);
  const trackerRequests = trackers.reduce((sum, tracker) => sum + count(tracker.requests), 0);
  elements.hostname.textContent = state.hostname || state.origin || "Unknown website";
  document.title = `${state.hostname || "Website"} privacy report · Veilance`;
  elements.visitState.textContent = state.active === false ? "Completed visit" : "Active visit";
  elements.visitStarted.textContent = `Started ${formatDateTime(state.startedAt)}`;
  elements.visitDuration.textContent = formatDurationMilliseconds(durationMilliseconds(state));
  elements.assessment.className = `assessment ${summary.status || "quiet"}`;
  elements.assessmentLabel.textContent = summary.label || "No notable signals";
  elements.assessmentNote.textContent = `${plural(data.findings?.length, "finding")} from activity stored on this device`;
  elements.totalRequests.textContent = count(state.network?.totalRequests).toLocaleString();
  elements.requestSplit.textContent = `${plural(state.network?.firstPartyRequests, "request from this site", "requests from this site")} · ${plural(state.network?.thirdPartyRequests, "request from elsewhere", "requests from elsewhere")}`;
  elements.thirdPartyHosts.textContent = hosts.length.toLocaleString();
  elements.trackerCount.textContent = trackers.length.toLocaleString();
  elements.trackerRequestCount.textContent = plural(trackerRequests, "matched request");
  elements.browserActivityCount.textContent = signals.browserCount.toLocaleString();
  elements.storageActivityCount.textContent = plural(signals.storageCount, "storage action");
  renderPlainSummary(data);
  renderChart(state);
  renderShield(data);
  renderEvidence(data);
  renderTelemetry(data);
  syncLiveUpdateControl(state);
}

function stopLiveUpdates() {
  if (liveUpdateTimer) clearInterval(liveUpdateTimer);
  liveUpdateTimer = null;
  liveUpdatesEnabled = false;
  elements.liveUpdatesToggle.checked = false;
}

function syncLiveUpdateControl(state) {
  const active = state?.active !== false;
  elements.liveUpdatesToggle.disabled = !active;
  if (!active) {
    stopLiveUpdates();
    elements.liveUpdatesStatus.textContent = "Visit finished";
  } else {
    elements.liveUpdatesStatus.textContent = liveUpdatesEnabled ? "Updating every 1.5 seconds" : "Off";
  }
}

function setLiveUpdates(enabled) {
  stopLiveUpdates();
  if (!enabled || currentReport?.state?.active === false) {
    syncLiveUpdateControl(currentReport?.state);
    return;
  }
  liveUpdatesEnabled = true;
  elements.liveUpdatesToggle.checked = true;
  elements.liveUpdatesStatus.textContent = "Updating every 1.5 seconds";
  void loadReport({ silent: true });
  liveUpdateTimer = setInterval(() => {
    if (!document.hidden) void loadReport({ silent: true });
  }, 1500);
}

async function loadReport({ silent = false } = {}) {
  if (reportLoadInFlight) return;
  reportLoadInFlight = true;
  if (!silent) {
    elements.refreshButton.disabled = true;
    elements.loadingState.hidden = false;
    elements.errorState.hidden = true;
  }
  try {
    const response = await send(reportRequest);
    if (!response.state) throw new Error("The local visit record is no longer available");
    currentReport = response;
    renderReport(response);
    elements.reportContent.hidden = false;
    elements.loadingState.hidden = true;
  } catch (error) {
    if (silent) {
      stopLiveUpdates();
      elements.liveUpdatesStatus.textContent = "Paused — refresh failed";
    } else {
      elements.loadingState.hidden = true;
      elements.reportContent.hidden = true;
      elements.errorState.hidden = false;
      elements.errorMessage.textContent = error?.message || "The local visit record is unavailable.";
    }
  } finally {
    reportLoadInFlight = false;
    elements.refreshButton.disabled = false;
  }
}

for (const button of document.querySelectorAll("[data-range]")) {
  button.addEventListener("click", () => {
    selectedRange = button.dataset.range;
    for (const candidate of document.querySelectorAll("[data-range]")) candidate.classList.toggle("active", candidate === button);
    if (currentReport) renderChart(currentReport.state);
  });
}

for (const button of document.querySelectorAll("[data-evidence-topic]")) {
  button.addEventListener("click", () => openEvidenceDialog(button.dataset.evidenceTopic));
}

elements.activityTimeline.addEventListener("pointerover", (event) => {
  const mark = event.target.closest?.(".chart-mark");
  if (mark) showChartTooltip(mark, event);
});
elements.activityTimeline.addEventListener("pointermove", (event) => {
  const mark = event.target.closest?.(".chart-mark");
  if (mark) showChartTooltip(mark, event);
});
elements.activityTimeline.addEventListener("pointerleave", () => {
  if (!elements.activityTimeline.contains(document.activeElement)) hideChartTooltip();
});
elements.activityTimeline.addEventListener("focusin", (event) => {
  const mark = event.target.closest?.(".chart-mark");
  if (mark) showChartTooltip(mark, event);
});
elements.activityTimeline.addEventListener("focusout", () => {
  setTimeout(() => {
    if (!elements.activityTimeline.contains(document.activeElement)) hideChartTooltip();
  }, 0);
});
elements.activityTimeline.addEventListener("click", (event) => {
  const mark = event.target.closest?.(".chart-mark");
  if (mark) showChartTooltip(mark, event);
});

elements.evidenceCloseButton.addEventListener("click", closeEvidenceDialog);
elements.evidenceDialog.addEventListener("click", (event) => {
  if (event.target === elements.evidenceDialog) closeEvidenceDialog();
});
elements.evidenceDialog.addEventListener("close", () => { currentEvidenceTopic = null; });
elements.liveUpdatesToggle.addEventListener("change", () => setLiveUpdates(elements.liveUpdatesToggle.checked));
elements.retryButton.addEventListener("click", () => void loadReport());
elements.refreshButton.addEventListener("click", () => void loadReport());
elements.printButton.addEventListener("click", () => print());
elements.settingsButton.addEventListener("click", () => void chrome.runtime.openOptionsPage());
elements.themeToggle.addEventListener("click", () => void toggleResolvedTheme());
elements.version.textContent = `v${chrome.runtime.getManifest().version}`;

subscribeToTheme(({ resolved }) => {
  const nextTheme = resolved === "dark" ? "light" : "dark";
  elements.themeToggle.title = `Use ${nextTheme} mode`;
  elements.themeToggle.setAttribute("aria-label", `Use ${nextTheme} mode`);
});
addEventListener("unload", () => {
  if (liveUpdateTimer) clearInterval(liveUpdateTimer);
});
void initializeTheme();
void loadReport();
