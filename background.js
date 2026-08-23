import {
  addNetworkRequest,
  addPageSignal,
  applyPageSnapshot,
  applyResponseHeaders,
  buildFindings,
  buildSanitizedPayload,
  createEmptyState,
  shouldResetState,
  summarizeState
} from "./lib/core.js";

const SESSION_STORAGE_KEY = "veilanceTabStates";
const states = new Map();
let persistTimer = null;

const ready = (async () => {
  try {
    const stored = await chrome.storage.session.get(SESSION_STORAGE_KEY);
    const value = stored?.[SESSION_STORAGE_KEY];
    if (value && typeof value === "object") {
      for (const [tabId, state] of Object.entries(value)) states.set(Number(tabId), state);
    }
  } catch (error) {
    console.warn("Veilance could not restore session telemetry", error);
  }
})();

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: Object.fromEntries(states.entries()) });
    } catch (error) {
      console.warn("Veilance could not persist session telemetry", error);
    }
  }, 150);
}

function stateFor(tabId, url) {
  let state = states.get(tabId);
  if (!state || (url && shouldResetState(state, url))) {
    state = createEmptyState(tabId, url || state?.origin || "");
    states.set(tabId, state);
  }
  return state;
}

async function updateBadge(tabId, state) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const summary = summarizeState(state);
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

async function saveState(tabId, state) {
  states.set(tabId, state);
  schedulePersist();
  await updateBadge(tabId, state);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    void ready.then(async () => {
      let state;
      if (details.type === "main_frame") state = createEmptyState(details.tabId, details.url);
      else state = stateFor(details.tabId, details.documentUrl || details.initiator || "");
      addNetworkRequest(state, details);
      await saveState(details.tabId, state);
    });
  },
  { urls: ["http://*/*", "https://*/*"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || details.type !== "main_frame") return;
    void ready.then(async () => {
      const state = stateFor(details.tabId, details.url);
      applyResponseHeaders(state, details.statusCode, details.responseHeaders || []);
      await saveState(details.tabId, state);
    });
  },
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
  ["responseHeaders"]
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (!/^https?:/i.test(changeInfo.url)) {
    states.delete(tabId);
    schedulePersist();
    void updateBadge(tabId, null);
    return;
  }
  void ready.then(async () => {
    if (!states.has(tabId)) await saveState(tabId, createEmptyState(tabId, changeInfo.url));
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  states.delete(tabId);
  schedulePersist();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void ready.then(() => updateBadge(tabId, states.get(tabId) || null));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    await ready;
    switch (message?.type) {
      case "VEILANCE_PAGE_EVENT": {
        const tabId = sender.tab?.id;
        if (!Number.isInteger(tabId)) return { ok: false, error: "No sender tab" };
        const state = stateFor(tabId, sender.tab?.url || "");
        addPageSignal(state, message.event);
        await saveState(tabId, state);
        return { ok: true };
      }
      case "VEILANCE_PAGE_SNAPSHOT": {
        const tabId = sender.tab?.id;
        if (!Number.isInteger(tabId)) return { ok: false, error: "No sender tab" };
        const state = stateFor(tabId, sender.tab?.url || "");
        applyPageSnapshot(state, message.snapshot);
        await saveState(tabId, state);
        return { ok: true };
      }
      case "VEILANCE_GET_STATE": {
        const tabId = Number(message.tabId);
        const state = states.get(tabId) || null;
        return state
          ? { ok: true, state, findings: buildFindings(state), summary: summarizeState(state) }
          : { ok: true, state: null, findings: [], summary: summarizeState(null) };
      }
      case "VEILANCE_GET_PAYLOAD": {
        const tabId = Number(message.tabId);
        const state = states.get(tabId) || null;
        return {
          ok: true,
          payload: buildSanitizedPayload(state, chrome.runtime.getManifest().version)
        };
      }
      case "VEILANCE_CLEAR_STATE": {
        const tabId = Number(message.tabId);
        let url = "";
        try {
          const tab = await chrome.tabs.get(tabId);
          url = tab.url || "";
        } catch {
          // Use an empty identity if the tab no longer exists.
        }
        await saveState(tabId, createEmptyState(tabId, url));
        return { ok: true };
      }
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
  console.info("Veilance v0.1.0 installed. Telemetry uploading is disabled.");
});
