import {
  addNetworkRequest,
  addPageSignal,
  applyPageIdentity,
  applyPageSnapshot,
  applyResponseHeaders,
  buildFindings,
  buildSanitizedPayload,
  completeVisit,
  createEmptyState,
  markVisitLoaded,
  safePageIdentity,
  summarizeState
} from "./lib/core.js";
import { historyStoreReady } from "./lib/history-store.js";
import {
  BUILT_IN_INDICATORS,
  evaluateCustomIndicators,
  indicatorExists,
  isIndicatorEnabled,
  mergeIndicatorSettings,
  parseIndicatorDocuments,
  parseManagedTrackerDocuments,
  parseManagedTrackerRecords
} from "./lib/indicators.js";
import {
  TRACKER_DATABASE_ARCHIVE,
  TRACKER_DATABASE_BUNDLE,
  TRACKER_DATABASE_REPOSITORY,
  TRACKER_UPDATE_INTERVAL_MINUTES
} from "./config.js";
import { diffTrackerSets, fetchTrackerArchive } from "./lib/tracker-updater.js";
import { exportSolanaWallet, generateSolanaWallet, publicWalletRecord } from "./lib/wallet.js";

const SESSION_STORAGE_KEY = "veilanceTabStatesV2";
const INDICATOR_SETTINGS_KEY = "veilanceIndicatorSettingsV1";
const CUSTOM_INDICATORS_KEY = "veilanceCustomIndicatorsV1";
const MANAGED_TRACKERS_KEY = "veilanceManagedTrackersV1";
const TRACKER_DATABASE_STATE_KEY = "veilanceTrackerDatabaseStateV1";
const WALLET_STORAGE_KEY = "veilanceSolanaWalletV1";
const TRACKER_UPDATE_ALARM = "veilanceTrackerDatabaseUpdateV1";
const MAX_TRACKER_UPDATE_LOG = 50;
const HISTORY_FLUSH_DELAY_MS = 200;

const states = new Map();
const pendingHistory = new Map();
const tabQueues = new Map();
let sessionPersistTimer = null;
let historyFlushTimer = null;
let customIndicators = [];
let managedTrackers = [];
let indicatorSettings = mergeIndicatorSettings(null);
let trackerDatabaseState = normalizeTrackerDatabaseState(null);
let trackerSyncPromise = null;
let wallet = null;
let walletError = null;
let historyStore = null;

function newId() {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function queueTab(tabId, operation) {
  const previous = tabQueues.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  tabQueues.set(tabId, next);
  void next.finally(() => {
    if (tabQueues.get(tabId) === next) tabQueues.delete(tabId);
  }).catch(() => {});
  return next;
}

async function waitForTab(tabId) {
  await (tabQueues.get(tabId) || Promise.resolve()).catch(() => {});
}

function normalizeRestoredState(tabId, state) {
  if (!state || typeof state !== "object") return null;
  state.tabId = Number(tabId);
  state.visitId ||= newId();
  state.documentId ??= null;
  state.navigationId ??= null;
  state.loadCompletedAt ??= null;
  state.endedAt ??= null;
  state.active = state.active !== false && !Number.isFinite(state.endedAt);
  return state;
}

function findingsFor(state) {
  const combined = [
    ...buildFindings(state),
    ...evaluateCustomIndicators(state, customIndicators, indicatorSettings),
    ...(trackerDatabaseState.databaseEnabled
      ? evaluateCustomIndicators(state, managedTrackers, null)
      : [])
  ];
  const severityOrder = { high: 0, medium: 1, low: 2, notice: 3 };
  return combined.sort((a, b) =>
    (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) ||
    String(a.title).localeCompare(String(b.title))
  );
}

function cleanTrackerLogEntry(value) {
  return {
    timestamp: Number.isFinite(value?.timestamp) ? value.timestamp : Date.now(),
    trigger: String(value?.trigger || "automatic").slice(0, 24),
    status: String(value?.status || "unknown").slice(0, 24),
    message: String(value?.message || "").slice(0, 500),
    trackerCount: Math.max(0, Number(value?.trackerCount) || 0),
    added: Math.max(0, Number(value?.added) || 0),
    updated: Math.max(0, Number(value?.updated) || 0),
    removed: Math.max(0, Number(value?.removed) || 0),
    skipped: Math.max(0, Number(value?.skipped) || 0),
    warnings: Math.max(0, Number(value?.warnings) || 0),
    revision: String(value?.revision || "").slice(0, 128)
  };
}

function normalizeTrackerDatabaseState(value, trackerCount = 0) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    databaseEnabled: state.databaseEnabled !== false,
    autoUpdateEnabled: state.autoUpdateEnabled !== false,
    trackerCount: Math.max(0, Number(state.trackerCount) || trackerCount || 0),
    sourceCount: Math.max(0, Number(state.sourceCount) || trackerCount || 0),
    skippedCount: Math.max(0, Number(state.skippedCount) || 0),
    warningCount: Math.max(0, Number(state.warningCount) || 0),
    lastCheckAt: Number.isFinite(state.lastCheckAt) ? state.lastCheckAt : null,
    lastSuccessAt: Number.isFinite(state.lastSuccessAt) ? state.lastSuccessAt : null,
    lastStatus: String(state.lastStatus || "bundled").slice(0, 32),
    lastError: String(state.lastError || "").slice(0, 500),
    sourceRevision: String(state.sourceRevision || "").slice(0, 128),
    sourceEtag: String(state.sourceEtag || "").slice(0, 160),
    archiveSha256: String(state.archiveSha256 || "").slice(0, 64),
    bundledRevision: String(state.bundledRevision || "").slice(0, 128),
    sourceGeneratedAt: String(state.sourceGeneratedAt || "").slice(0, 64),
    updateLog: Array.isArray(state.updateLog)
      ? state.updateLog.slice(0, MAX_TRACKER_UPDATE_LOG).map(cleanTrackerLogEntry)
      : []
  };
}

function addTrackerUpdateLog(entry) {
  trackerDatabaseState.updateLog = [
    cleanTrackerLogEntry(entry),
    ...trackerDatabaseState.updateLog
  ].slice(0, MAX_TRACKER_UPDATE_LOG);
}

function publicTrackerDatabaseState() {
  return {
    ...trackerDatabaseState,
    repository: TRACKER_DATABASE_REPOSITORY,
    intervalMinutes: TRACKER_UPDATE_INTERVAL_MINUTES,
    updateInProgress: Boolean(trackerSyncPromise)
  };
}

async function loadBundledTrackerDatabase() {
  const response = await fetch(chrome.runtime.getURL(TRACKER_DATABASE_BUNDLE));
  if (!response.ok) throw new Error(`Bundled tracker database returned HTTP ${response.status}`);
  const bundle = await response.json();
  if (bundle?.schemaVersion !== 1 || !Array.isArray(bundle.records)) {
    throw new Error("Bundled tracker database has an unsupported format");
  }
  return { bundle, parsed: parseManagedTrackerRecords(bundle.records) };
}

async function installBundledTrackerDatabase() {
  const { bundle, parsed } = await loadBundledTrackerDatabase();
  if (!parsed.indicators.length) throw new Error("Bundled tracker database has no usable records");
  managedTrackers = parsed.indicators;
  const now = Date.now();
  trackerDatabaseState = normalizeTrackerDatabaseState({
    ...trackerDatabaseState,
    trackerCount: managedTrackers.length,
    sourceCount: parsed.sourceCount,
    skippedCount: parsed.skippedCount,
    warningCount: parsed.warningCount,
    lastSuccessAt: now,
    lastStatus: "bundled",
    lastError: "",
    sourceRevision: bundle.revision,
    bundledRevision: bundle.revision,
    sourceGeneratedAt: bundle.generatedAt
  }, managedTrackers.length);
  addTrackerUpdateLog({
    timestamp: now,
    trigger: "bundled",
    status: "installed",
    message: `Installed ${managedTrackers.length.toLocaleString()} bundled trackers.`,
    trackerCount: managedTrackers.length,
    skipped: parsed.skippedCount,
    warnings: parsed.warningCount,
    revision: bundle.revision
  });
  await chrome.storage.local.set({
    [MANAGED_TRACKERS_KEY]: managedTrackers,
    [TRACKER_DATABASE_STATE_KEY]: trackerDatabaseState
  });
}

function summaryFor(state) {
  const findings = findingsFor(state);
  return { findings, summary: summarizeState(state, findings) };
}

function enabledIndicatorIds() {
  return Object.entries(indicatorSettings)
    .filter(([, enabled]) => enabled)
    .map(([id]) => id);
}

function snapshotForEnabledIndicators(snapshot) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const filtered = {};
  if (isIndicatorEnabled(indicatorSettings, "page-structure")) {
    for (const key of [
      "secureContext", "scriptCount", "thirdPartyScriptCount", "iframeCount",
      "thirdPartyIframeCount", "serviceWorkerControlled"
    ]) {
      if (source[key] !== undefined) filtered[key] = source[key];
    }
  }
  if (isIndicatorEnabled(indicatorSettings, "browser-storage")) {
    for (const key of [
      "accessibleCookieCount", "localStorageKeyCount", "sessionStorageKeyCount",
      "indexedDbCount", "cacheCount"
    ]) {
      if (source[key] !== undefined) filtered[key] = source[key];
    }
  }
  return filtered;
}

const ready = (async () => {
  const [sessionStored, localStored, store] = await Promise.all([
    chrome.storage.session.get(SESSION_STORAGE_KEY).catch(() => ({})),
    chrome.storage.local.get([
      INDICATOR_SETTINGS_KEY,
      CUSTOM_INDICATORS_KEY,
      MANAGED_TRACKERS_KEY,
      TRACKER_DATABASE_STATE_KEY,
      WALLET_STORAGE_KEY
    ]),
    historyStoreReady
  ]);

  historyStore = store;
  const savedCustom = localStored?.[CUSTOM_INDICATORS_KEY];
  customIndicators = Array.isArray(savedCustom) ? savedCustom.slice(0, 100) : [];
  indicatorSettings = mergeIndicatorSettings(
    localStored?.[INDICATOR_SETTINGS_KEY],
    customIndicators
  );
  const savedManagedTrackers = localStored?.[MANAGED_TRACKERS_KEY];
  managedTrackers = Array.isArray(savedManagedTrackers) ? savedManagedTrackers.slice(0, 5000) : [];
  trackerDatabaseState = normalizeTrackerDatabaseState(
    localStored?.[TRACKER_DATABASE_STATE_KEY],
    managedTrackers.length
  );
  if (!managedTrackers.length) {
    try {
      await installBundledTrackerDatabase();
    } catch (error) {
      const now = Date.now();
      trackerDatabaseState.lastStatus = "error";
      trackerDatabaseState.lastError = String(error?.message || error).slice(0, 500);
      addTrackerUpdateLog({
        timestamp: now,
        trigger: "bundled",
        status: "error",
        message: trackerDatabaseState.lastError,
        trackerCount: 0
      });
      await chrome.storage.local.set({ [TRACKER_DATABASE_STATE_KEY]: trackerDatabaseState });
      console.error("Veilance could not load its bundled tracker database", error);
    }
  } else if (trackerDatabaseState.trackerCount !== managedTrackers.length) {
    trackerDatabaseState.trackerCount = managedTrackers.length;
    await chrome.storage.local.set({ [TRACKER_DATABASE_STATE_KEY]: trackerDatabaseState });
  }

  const sessionValue = sessionStored?.[SESSION_STORAGE_KEY];
  if (sessionValue && typeof sessionValue === "object") {
    for (const [tabId, savedState] of Object.entries(sessionValue)) {
      const state = normalizeRestoredState(tabId, savedState);
      if (state) {
        states.set(Number(tabId), state);
        pendingHistory.set(state.visitId, state);
      }
    }
  }

  await historyStore.finalizeOrphaned(
    [...states.values()].filter((state) => state.active !== false).map((state) => state.visitId)
  );

  const savedWallet = localStored?.[WALLET_STORAGE_KEY];
  if (savedWallet?.publicKey && savedWallet?.secretKeyBase64) {
    wallet = savedWallet;
  } else {
    try {
      wallet = await generateSolanaWallet();
      await chrome.storage.local.set({ [WALLET_STORAGE_KEY]: wallet });
    } catch (error) {
      walletError = String(error?.message || error);
      console.error("Veilance could not generate a Solana wallet", error);
    }
  }

  if (pendingHistory.size) await flushHistory();
  await configureTrackerAlarm();
})();

async function configureTrackerAlarm() {
  if (!chrome.alarms) return;
  if (!trackerDatabaseState.autoUpdateEnabled) {
    await chrome.alarms.clear(TRACKER_UPDATE_ALARM);
    return;
  }
  const existing = await chrome.alarms.get(TRACKER_UPDATE_ALARM);
  if (existing?.periodInMinutes === TRACKER_UPDATE_INTERVAL_MINUTES) return;
  chrome.alarms.create(TRACKER_UPDATE_ALARM, {
    delayInMinutes: existing ? TRACKER_UPDATE_INTERVAL_MINUTES : 5,
    periodInMinutes: TRACKER_UPDATE_INTERVAL_MINUTES
  });
}

async function refreshTrackerFindings() {
  for (const [tabId, state] of states) {
    scheduleHistory(state);
    await updateBadge(tabId, state);
  }
}

function trackerUpdateMessage(parsed, changes) {
  const changeText = `${changes.added} added, ${changes.updated} updated, ${changes.removed} removed`;
  const validationText = parsed.skippedCount || parsed.warningCount
    ? ` ${parsed.skippedCount} skipped; ${parsed.warningCount} filter warnings.`
    : "";
  return `${parsed.indicators.length.toLocaleString()} trackers active (${changeText}).${validationText}`;
}

async function performTrackerSync(trigger) {
  const checkedAt = Date.now();
  try {
    const downloaded = await fetchTrackerArchive(TRACKER_DATABASE_ARCHIVE);
    if (downloaded.archiveSha256 === trackerDatabaseState.archiveSha256) {
      trackerDatabaseState.lastCheckAt = checkedAt;
      trackerDatabaseState.lastSuccessAt = checkedAt;
      trackerDatabaseState.lastStatus = "up-to-date";
      trackerDatabaseState.lastError = "";
      addTrackerUpdateLog({
        timestamp: checkedAt,
        trigger,
        status: "up-to-date",
        message: `${managedTrackers.length.toLocaleString()} trackers are already current.`,
        trackerCount: managedTrackers.length,
        skipped: trackerDatabaseState.skippedCount,
        warnings: trackerDatabaseState.warningCount,
        revision: trackerDatabaseState.sourceRevision
      });
      await chrome.storage.local.set({ [TRACKER_DATABASE_STATE_KEY]: trackerDatabaseState });
      return publicTrackerDatabaseState();
    }

    const parsed = parseManagedTrackerDocuments(downloaded.documents);
    if (!parsed.indicators.length) throw new Error("The tracker update contained no usable tracker records");
    if (parsed.errorCount > Math.max(10, Math.floor(parsed.sourceCount * 0.05))) {
      throw new Error(`Tracker update rejected because ${parsed.errorCount} records failed validation`);
    }
    if (managedTrackers.length >= 100 && parsed.indicators.length < managedTrackers.length / 2) {
      throw new Error("Tracker update rejected because it would remove more than half of the active database");
    }
    const changes = diffTrackerSets(managedTrackers, parsed.indicators);
    managedTrackers = parsed.indicators;
    const changed = changes.added > 0 || changes.updated > 0 || changes.removed > 0;
    trackerDatabaseState = normalizeTrackerDatabaseState({
      ...trackerDatabaseState,
      trackerCount: managedTrackers.length,
      sourceCount: parsed.sourceCount,
      skippedCount: parsed.skippedCount,
      warningCount: parsed.warningCount,
      lastCheckAt: checkedAt,
      lastSuccessAt: checkedAt,
      lastStatus: changed ? "updated" : "up-to-date",
      lastError: "",
      sourceRevision: downloaded.archiveSha256,
      sourceEtag: downloaded.etag,
      archiveSha256: downloaded.archiveSha256
    }, managedTrackers.length);
    addTrackerUpdateLog({
      timestamp: checkedAt,
      trigger,
      status: changed ? "updated" : "up-to-date",
      message: trackerUpdateMessage(parsed, changes),
      trackerCount: managedTrackers.length,
      ...changes,
      skipped: parsed.skippedCount,
      warnings: parsed.warningCount,
      revision: downloaded.archiveSha256
    });
    await chrome.storage.local.set({
      [MANAGED_TRACKERS_KEY]: managedTrackers,
      [TRACKER_DATABASE_STATE_KEY]: trackerDatabaseState
    });
    await refreshTrackerFindings();
    return publicTrackerDatabaseState();
  } catch (error) {
    trackerDatabaseState.lastCheckAt = checkedAt;
    trackerDatabaseState.lastStatus = "error";
    trackerDatabaseState.lastError = String(error?.message || error).slice(0, 500);
    addTrackerUpdateLog({
      timestamp: checkedAt,
      trigger,
      status: "error",
      message: trackerDatabaseState.lastError,
      trackerCount: managedTrackers.length,
      skipped: trackerDatabaseState.skippedCount,
      warnings: trackerDatabaseState.warningCount,
      revision: trackerDatabaseState.sourceRevision
    });
    await chrome.storage.local.set({ [TRACKER_DATABASE_STATE_KEY]: trackerDatabaseState });
    throw error;
  }
}

function syncTrackerDatabase(trigger = "automatic") {
  if (trackerSyncPromise) return trackerSyncPromise;
  trackerSyncPromise = performTrackerSync(trigger).finally(() => {
    trackerSyncPromise = null;
  });
  return trackerSyncPromise;
}

function scheduleSessionPersist() {
  clearTimeout(sessionPersistTimer);
  sessionPersistTimer = setTimeout(async () => {
    try {
      await chrome.storage.session.set({
        [SESSION_STORAGE_KEY]: Object.fromEntries(states.entries())
      });
    } catch (error) {
      console.warn("Veilance could not persist active visit telemetry", error);
    }
  }, 100);
}

function scheduleHistory(state) {
  if (!state?.visitId) return;
  pendingHistory.set(state.visitId, state);
  clearTimeout(historyFlushTimer);
  historyFlushTimer = setTimeout(() => {
    void flushHistory().catch((error) => {
      console.error("Veilance could not persist visit history", error);
    });
  }, HISTORY_FLUSH_DELAY_MS);
}

async function flushHistory() {
  if (!historyStore) return;
  clearTimeout(historyFlushTimer);
  historyFlushTimer = null;
  while (pendingHistory.size) {
    const batch = [...pendingHistory.values()];
    pendingHistory.clear();
    for (const state of batch) {
      const { summary } = summaryFor(state);
      await historyStore.upsert(state, summary);
    }
  }
}

async function updateBadge(tabId, state) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const { summary } = summaryFor(state);
  const count = Math.min(summary.findingCount, 99);
  const color = {
    elevated: "#e65b6a",
    active: "#e6a23c",
    observed: "#247cff",
    quiet: "#24364d",
    unsupported: "#24364d"
  }[summary.status];
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" });
    await chrome.action.setTitle({ tabId, title: `Veilance - ${summary.label}` });
  } catch {
    // The tab may have closed between collection and badge update.
  }
}

async function saveState(tabId, state, options = {}) {
  states.set(tabId, state);
  scheduleSessionPersist();
  if (options.immediateHistory) {
    pendingHistory.delete(state.visitId);
    const { summary } = summaryFor(state);
    await historyStore.upsert(state, summary);
  } else {
    scheduleHistory(state);
  }
  await updateBadge(tabId, state);
}

async function finalizeState(tabId, now = Date.now()) {
  const state = states.get(tabId);
  if (!state) return null;
  if (state.active !== false) completeVisit(state, now);
  await saveState(tabId, state, { immediateHistory: true });
  return state;
}

async function beginVisit(tabId, url, metadata = {}) {
  const existing = states.get(tabId);
  if (existing?.active !== false) await finalizeState(tabId, metadata.now || Date.now());
  const state = createEmptyState(tabId, url, metadata.now || Date.now(), {
    visitId: newId(),
    navigationId: metadata.navigationId || newId(),
    documentId: metadata.documentId || null
  });
  state.previousDocumentId = existing?.documentId || null;
  state.previousContentSessionId = existing?.contentSessionId || null;
  await saveState(tabId, state, { immediateHistory: true });
  return state;
}

function stateFor(tabId, url) {
  let state = states.get(tabId);
  if (!state) {
    state = createEmptyState(tabId, url || "", Date.now(), {
      visitId: newId(),
      navigationId: newId()
    });
    states.set(tabId, state);
  }
  return state;
}

function contentState(sender, message) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return null;
  const state = states.get(tabId);
  if (!state || state.active === false) return null;
  if (state.previousDocumentId && sender.documentId === state.previousDocumentId) return null;
  if (
    !sender.documentId &&
    state.previousContentSessionId &&
    message?.pageSessionId === state.previousContentSessionId
  ) return null;
  if (state.documentId && sender.documentId && state.documentId !== sender.documentId) return null;
  const senderPage = safePageIdentity(sender.url || sender.tab?.url || "");
  if (senderPage && state.origin && senderPage.origin !== state.origin) return null;
  if (!state.documentId && sender.documentId) state.documentId = sender.documentId;
  if (!state.contentSessionId) state.contentSessionId = String(message?.pageSessionId || "").slice(0, 100) || null;
  if (!sender.documentId && state.contentSessionId && message?.pageSessionId !== state.contentSessionId) return null;
  state.previousDocumentId = null;
  state.previousContentSessionId = null;
  return { tabId, state };
}

async function broadcastIndicatorConfig() {
  const message = {
    type: "VEILANCE_INDICATOR_CONFIG_CHANGED",
    enabledIndicatorIds: enabledIndicatorIds()
  };
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }).catch(() => []);
  await Promise.all(tabs.map((tab) =>
    chrome.tabs.sendMessage(tab.id, message).catch(() => {})
  ));
}

function isSettingsPage(sender) {
  const expected = chrome.runtime.getURL("settings.html");
  return typeof sender?.url === "string" && (
    sender.url === expected || sender.url.startsWith(`${expected}?`) || sender.url.startsWith(`${expected}#`)
  );
}

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== TRACKER_UPDATE_ALARM) return;
    void ready
      .then(() => trackerDatabaseState.autoUpdateEnabled && syncTrackerDatabase("scheduled"))
      .catch((error) => console.error("Veilance tracker update failed", error));
  });
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || !/^https?:/i.test(details.url)) return;
  void ready.then(() => queueTab(details.tabId, () => beginVisit(details.tabId, details.url, {
    now: details.timeStamp,
    navigationId: newId()
  }))).catch((error) => console.error("Veilance could not start a visit", error));
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || !/^https?:/i.test(details.url)) return;
  void ready.then(() => queueTab(details.tabId, async () => {
    const state = stateFor(details.tabId, details.url);
    applyPageIdentity(state, details.url, details.timeStamp);
    if (details.documentId) state.documentId = details.documentId;
    await saveState(details.tabId, state, { immediateHistory: true });
  })).catch((error) => console.error("Veilance could not commit a visit", error));
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0 || !/^https?:/i.test(details.url)) return;
  void ready.then(() => queueTab(details.tabId, async () => {
    const state = states.get(details.tabId);
    if (!state) return;
    markVisitLoaded(state, details.timeStamp);
    await saveState(details.tabId, state);
  })).catch((error) => console.error("Veilance could not finish loading a visit", error));
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0 || !isIndicatorEnabled(indicatorSettings, "network-requests")) return;
    void ready.then(() => queueTab(details.tabId, async () => {
      if (!isIndicatorEnabled(indicatorSettings, "network-requests")) return;
      const state = stateFor(details.tabId, details.documentUrl || details.initiator || details.url);
      if (details.type === "main_frame") applyPageIdentity(state, details.url, details.timeStamp);
      addNetworkRequest(state, details, details.timeStamp, {
        trackersEnabled: isIndicatorEnabled(indicatorSettings, "known-trackers")
      });
      await saveState(details.tabId, state);
    })).catch((error) => console.error("Veilance could not record a request", error));
  },
  { urls: ["http://*/*", "https://*/*"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (
      details.tabId < 0 ||
      details.type !== "main_frame" ||
      !isIndicatorEnabled(indicatorSettings, "security-headers")
    ) return;
    void ready.then(() => queueTab(details.tabId, async () => {
      if (!isIndicatorEnabled(indicatorSettings, "security-headers")) return;
      const state = stateFor(details.tabId, details.url);
      applyPageIdentity(state, details.url, details.timeStamp);
      applyResponseHeaders(state, details.statusCode, details.responseHeaders || [], details.timeStamp);
      await saveState(details.tabId, state);
    })).catch((error) => console.error("Veilance could not record response headers", error));
  },
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
  ["responseHeaders"]
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url || /^https?:/i.test(changeInfo.url)) return;
  void ready.then(() => queueTab(tabId, async () => {
    await finalizeState(tabId);
    states.delete(tabId);
    scheduleSessionPersist();
    await updateBadge(tabId, null);
  })).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void ready.then(() => queueTab(tabId, async () => {
    await finalizeState(tabId);
    states.delete(tabId);
    scheduleSessionPersist();
  })).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void ready.then(() => updateBadge(tabId, states.get(tabId) || null)).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    await ready;
    switch (message?.type) {
      case "VEILANCE_GET_INDICATOR_CONFIG":
        return { ok: true, enabledIndicatorIds: enabledIndicatorIds() };

      case "VEILANCE_PAGE_EVENT": {
        const tabId = sender.tab?.id;
        if (!Number.isInteger(tabId)) return { ok: false, ignored: true };
        return queueTab(tabId, async () => {
          const current = contentState(sender, message);
          if (!current) return { ok: false, ignored: true };
          if (!isIndicatorEnabled(indicatorSettings, message.event?.indicatorId)) {
            return { ok: false, ignored: true };
          }
          addPageSignal(current.state, message.event);
          await saveState(current.tabId, current.state);
          return { ok: true };
        });
      }

      case "VEILANCE_PAGE_SNAPSHOT": {
        const tabId = sender.tab?.id;
        if (!Number.isInteger(tabId)) return { ok: false, ignored: true };
        return queueTab(tabId, async () => {
          const current = contentState(sender, message);
          if (!current) return { ok: false, ignored: true };
          applyPageSnapshot(current.state, snapshotForEnabledIndicators(message.snapshot));
          await saveState(current.tabId, current.state);
          return { ok: true };
        });
      }

      case "VEILANCE_VISIT_END": {
        const tabId = sender.tab?.id;
        if (!Number.isInteger(tabId)) return { ok: false, ignored: true };
        return queueTab(tabId, async () => {
          const current = contentState(sender, message);
          if (!current) return { ok: false, ignored: true };
          await finalizeState(current.tabId);
          return { ok: true };
        });
      }

      case "VEILANCE_GET_STATE": {
        const tabId = Number(message.tabId);
        await waitForTab(tabId);
        const state = states.get(tabId) || null;
        const { findings, summary } = summaryFor(state);
        return { ok: true, state, findings, summary };
      }

      case "VEILANCE_GET_PAYLOAD": {
        const state = states.get(Number(message.tabId)) || null;
        return { ok: true, payload: buildSanitizedPayload(state, chrome.runtime.getManifest().version) };
      }

      case "VEILANCE_CLEAR_STATE": {
        const tabId = Number(message.tabId);
        return queueTab(tabId, async () => {
          const previous = states.get(tabId);
          let url = previous?.origin || "";
          try {
            const tab = await chrome.tabs.get(tabId);
            url = tab.url || url;
          } catch {
            // Retain the last safe origin if the tab is already gone.
          }
          if (previous?.visitId) {
            pendingHistory.delete(previous.visitId);
            await historyStore.delete(previous.visitId);
          }
          const state = createEmptyState(tabId, url, Date.now(), {
            visitId: newId(),
            navigationId: previous?.navigationId || newId(),
            documentId: previous?.documentId || null
          });
          await saveState(tabId, state, { immediateHistory: true });
          return { ok: true };
        });
      }

      case "VEILANCE_GET_HISTORY":
        await flushHistory();
        return { ok: true, visits: await historyStore.listSummaries(20) };

      case "VEILANCE_GET_VISIT": {
        await flushHistory();
        const state = await historyStore.get(message.visitId);
        const { findings, summary } = summaryFor(state);
        return { ok: true, state, findings, summary };
      }

      case "VEILANCE_DELETE_VISIT": {
        const visitId = String(message.visitId || "");
        pendingHistory.delete(visitId);
        const matchingTabs = [...states.entries()]
          .filter(([, state]) => state.visitId === visitId)
          .map(([tabId]) => tabId);
        for (const tabId of matchingTabs) {
          await queueTab(tabId, async () => {
            if (states.get(tabId)?.visitId !== visitId) return;
            states.delete(tabId);
            await updateBadge(tabId, null);
          });
        }
        scheduleSessionPersist();
        await historyStore.delete(visitId);
        return { ok: true };
      }

      case "VEILANCE_CLEAR_HISTORY":
        pendingHistory.clear();
        await historyStore.clear();
        for (const state of states.values()) scheduleHistory(state);
        return { ok: true };

      case "VEILANCE_GET_SETTINGS":
        return {
          ok: true,
          builtInIndicators: BUILT_IN_INDICATORS,
          customIndicators,
          indicatorSettings,
          trackerDatabase: publicTrackerDatabaseState(),
          wallet: publicWalletRecord(wallet),
          walletError,
          database: await historyStore.info()
        };

      case "VEILANCE_SET_INDICATOR": {
        const id = String(message.id || "");
        if (!indicatorExists(id, customIndicators)) throw new Error("Unknown indicator");
        indicatorSettings[id] = Boolean(message.enabled);
        await chrome.storage.local.set({ [INDICATOR_SETTINGS_KEY]: indicatorSettings });
        await broadcastIndicatorConfig();
        return { ok: true, indicatorSettings };
      }

      case "VEILANCE_RESET_INDICATORS":
        indicatorSettings = mergeIndicatorSettings(null, customIndicators);
        await chrome.storage.local.set({ [INDICATOR_SETTINGS_KEY]: indicatorSettings });
        await broadcastIndicatorConfig();
        return { ok: true, indicatorSettings };

      case "VEILANCE_SET_TRACKER_DATABASE_ENABLED":
        if (!isSettingsPage(sender)) throw new Error("Tracker database controls are available only from Veilance Settings");
        trackerDatabaseState.databaseEnabled = Boolean(message.enabled);
        await chrome.storage.local.set({ [TRACKER_DATABASE_STATE_KEY]: trackerDatabaseState });
        await refreshTrackerFindings();
        return { ok: true, trackerDatabase: publicTrackerDatabaseState() };

      case "VEILANCE_SET_TRACKER_AUTO_UPDATE":
        if (!isSettingsPage(sender)) throw new Error("Tracker update controls are available only from Veilance Settings");
        trackerDatabaseState.autoUpdateEnabled = Boolean(message.enabled);
        await chrome.storage.local.set({ [TRACKER_DATABASE_STATE_KEY]: trackerDatabaseState });
        await configureTrackerAlarm();
        return { ok: true, trackerDatabase: publicTrackerDatabaseState() };

      case "VEILANCE_CHECK_TRACKER_UPDATES":
        if (!isSettingsPage(sender)) throw new Error("Tracker updates are available only from Veilance Settings");
        await syncTrackerDatabase("manual");
        return { ok: true, trackerDatabase: publicTrackerDatabaseState() };

      case "VEILANCE_IMPORT_INDICATORS": {
        const parsed = parseIndicatorDocuments(message.documents);
        const merged = new Map(customIndicators.map((indicator) => [indicator.id, indicator]));
        for (const indicator of parsed.indicators) merged.set(indicator.id, indicator);
        customIndicators = [...merged.values()].slice(0, 100);
        indicatorSettings = mergeIndicatorSettings(indicatorSettings, customIndicators);
        await chrome.storage.local.set({
          [CUSTOM_INDICATORS_KEY]: customIndicators,
          [INDICATOR_SETTINGS_KEY]: indicatorSettings
        });
        await broadcastIndicatorConfig();
        return {
          ok: true,
          importedCount: parsed.indicators.length,
          errors: parsed.errors,
          warnings: parsed.warnings,
          customIndicators,
          indicatorSettings
        };
      }

      case "VEILANCE_REMOVE_CUSTOM_INDICATOR": {
        const id = String(message.id || "");
        customIndicators = customIndicators.filter((indicator) => indicator.id !== id);
        delete indicatorSettings[id];
        indicatorSettings = mergeIndicatorSettings(indicatorSettings, customIndicators);
        await chrome.storage.local.set({
          [CUSTOM_INDICATORS_KEY]: customIndicators,
          [INDICATOR_SETTINGS_KEY]: indicatorSettings
        });
        await broadcastIndicatorConfig();
        return { ok: true, customIndicators, indicatorSettings };
      }

      case "VEILANCE_GET_WALLET":
        return { ok: true, wallet: publicWalletRecord(wallet), walletError };

      case "VEILANCE_EXPORT_WALLET":
        if (!isSettingsPage(sender)) throw new Error("Private key export is available only from Veilance Settings");
        return { ok: true, wallet: exportSolanaWallet(wallet) };

      default:
        return { ok: false, error: "Unknown message" };
    }
  })()
    .then(sendResponse)
    .catch((error) => {
      console.error("Veilance message handler failed", error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void ready.then(async () => {
    console.info(`Veilance v${chrome.runtime.getManifest().version} installed. Collection and history remain local.`);
    if (trackerDatabaseState.autoUpdateEnabled) await syncTrackerDatabase("install");
  }).catch((error) => console.error("Veilance install-time tracker update failed", error));
});
