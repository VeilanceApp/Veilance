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
  parseIndicatorDocuments
} from "./lib/indicators.js";
import { exportSolanaWallet, generateSolanaWallet, publicWalletRecord } from "./lib/wallet.js";

const SESSION_STORAGE_KEY = "veilanceTabStatesV2";
const INDICATOR_SETTINGS_KEY = "veilanceIndicatorSettingsV1";
const CUSTOM_INDICATORS_KEY = "veilanceCustomIndicatorsV1";
const WALLET_STORAGE_KEY = "veilanceSolanaWalletV1";
const HISTORY_FLUSH_DELAY_MS = 200;

const states = new Map();
const pendingHistory = new Map();
const tabQueues = new Map();
let sessionPersistTimer = null;
let historyFlushTimer = null;
let customIndicators = [];
let indicatorSettings = mergeIndicatorSettings(null);
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
    ...evaluateCustomIndicators(state, customIndicators, indicatorSettings)
  ];
  const severityOrder = { high: 0, medium: 1, low: 2, notice: 3 };
  return combined.sort((a, b) =>
    (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) ||
    String(a.title).localeCompare(String(b.title))
  );
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
})();

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
  void ready.then(() => {
    console.info(`Veilance v${chrome.runtime.getManifest().version} installed. Collection and history remain local.`);
  });
});
