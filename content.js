(() => {
  "use strict";

  const EVENT_NAME = "__veilance_event_v1__";
  const CONTROL_NAME = "__veilance_control_v1__";
  const seenEventIds = new Set();
  const pageSessionId = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let snapshotTimer = null;
  let enabledIndicatorIds = new Set();
  let configured = false;

  function safeSend(message) {
    try {
      const promise = chrome.runtime.sendMessage({ ...message, pageSessionId });
      if (promise && typeof promise.catch === "function") promise.catch(() => {});
    } catch {
      // The extension may have been reloaded while this page remained open.
    }
  }

  function sanitizePageEvent(detail) {
    if (!detail || typeof detail !== "object") return null;
    const indicatorId = typeof detail.indicatorId === "string" ? detail.indicatorId.slice(0, 80) : "";
    if (!configured || !indicatorId || !enabledIndicatorIds.has(indicatorId)) return null;
    const id = typeof detail.id === "string" ? detail.id.slice(0, 100) : "";
    if (!id || seenEventIds.has(id)) return null;
    seenEventIds.add(id);
    if (seenEventIds.size > 800) {
      const first = seenEventIds.values().next().value;
      seenEventIds.delete(first);
    }

    const cleanDetail = {};
    if (detail.detail && typeof detail.detail === "object" && !Array.isArray(detail.detail)) {
      for (const [key, value] of Object.entries(detail.detail)) {
        if (typeof value === "string") cleanDetail[String(key).slice(0, 64)] = value.slice(0, 160);
        else if (typeof value === "number" || typeof value === "boolean") cleanDetail[String(key).slice(0, 64)] = value;
        if (Object.keys(cleanDetail).length >= 8) break;
      }
    }

    return {
      indicatorId,
      kind: String(detail.kind || "api-use").slice(0, 48),
      api: String(detail.api || "Unknown").slice(0, 80),
      action: String(detail.action || "used").slice(0, 80),
      detail: cleanDetail
    };
  }

  document.addEventListener(EVENT_NAME, (event) => {
    const clean = sanitizePageEvent(event.detail);
    if (clean) safeSend({ type: "VEILANCE_PAGE_EVENT", event: clean });
  });

  function registrableDomain(hostname) {
    const host = String(hostname || "").toLowerCase();
    const labels = host.split(".").filter(Boolean);
    if (labels.length <= 2) return host;
    const multipart = new Set([
      "co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au",
      "co.nz", "com.br", "com.mx", "co.jp", "co.kr", "co.in", "com.sg",
      "com.tr", "com.cn", "com.tw", "com.hk", "co.za"
    ]);
    const suffix = labels.slice(-2).join(".");
    return multipart.has(suffix) ? labels.slice(-3).join(".") : suffix;
  }

  function isThirdPartyUrl(value) {
    try {
      const parsed = new URL(value, location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
      return registrableDomain(parsed.hostname) !== registrableDomain(location.hostname);
    } catch {
      return false;
    }
  }

  function countAccessibleCookies() {
    try {
      const cookieString = document.cookie;
      if (!cookieString) return 0;
      return cookieString.split(";").filter((part) => part.trim()).length;
    } catch {
      return 0;
    }
  }

  function storageLengthByName(name) {
    try {
      return globalThis[name]?.length || 0;
    } catch {
      return 0;
    }
  }

  async function optionalIndexedDbCount() {
    try {
      if (typeof indexedDB?.databases !== "function") return null;
      const databases = await indexedDB.databases();
      return Array.isArray(databases) ? databases.length : null;
    } catch {
      return null;
    }
  }

  async function optionalCacheCount() {
    try {
      if (!globalThis.caches?.keys) return null;
      const cacheNames = await caches.keys();
      return Array.isArray(cacheNames) ? cacheNames.length : null;
    } catch {
      return null;
    }
  }

  async function collectPageSnapshot() {
    const pageStructureEnabled = enabledIndicatorIds.has("page-structure");
    const storageEnabled = enabledIndicatorIds.has("browser-storage");
    if (!pageStructureEnabled && !storageEnabled) return null;
    const scripts = Array.from(document.scripts || []);
    const iframes = Array.from(document.querySelectorAll("iframe[src]"));
    const [indexedDbCount, cacheCount] = await Promise.all([
      storageEnabled ? optionalIndexedDbCount() : null,
      storageEnabled ? optionalCacheCount() : null
    ]);

    return {
      secureContext: pageStructureEnabled ? Boolean(globalThis.isSecureContext) : undefined,
      scriptCount: pageStructureEnabled ? scripts.length : undefined,
      thirdPartyScriptCount: pageStructureEnabled
        ? scripts.filter((script) => script.src && isThirdPartyUrl(script.src)).length
        : undefined,
      iframeCount: pageStructureEnabled ? iframes.length : undefined,
      thirdPartyIframeCount: pageStructureEnabled
        ? iframes.filter((frame) => frame.src && isThirdPartyUrl(frame.src)).length
        : undefined,
      accessibleCookieCount: storageEnabled ? countAccessibleCookies() : undefined,
      localStorageKeyCount: storageEnabled ? storageLengthByName("localStorage") : undefined,
      sessionStorageKeyCount: storageEnabled ? storageLengthByName("sessionStorage") : undefined,
      indexedDbCount,
      cacheCount,
      serviceWorkerControlled: pageStructureEnabled
        ? Boolean(navigator.serviceWorker?.controller)
        : undefined
    };
  }

  async function captureSnapshot() {
    const snapshot = await collectPageSnapshot();
    if (snapshot) safeSend({ type: "VEILANCE_PAGE_SNAPSHOT", snapshot });
  }

  function scheduleSnapshot(delay = 300) {
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => void captureSnapshot(), delay);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scheduleSnapshot(0), { once: true });
  } else {
    scheduleSnapshot(0);
  }
  addEventListener("load", () => scheduleSnapshot(250), { once: true });
  addEventListener("pageshow", () => scheduleSnapshot(100));
  addEventListener("pagehide", (event) => {
    if (!event.persisted) safeSend({ type: "VEILANCE_VISIT_END" });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") scheduleSnapshot(0);
  });

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) =>
      node?.nodeType === Node.ELEMENT_NODE &&
      (node.matches?.("script,iframe") || node.querySelector?.("script,iframe"))
    ))) {
      scheduleSnapshot(500);
    }
  });

  function startObserver() {
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      document.addEventListener("readystatechange", startObserver, { once: true });
    }
  }
  startObserver();

  function configureMainWorld(ids, drain = false) {
    enabledIndicatorIds = new Set(Array.isArray(ids) ? ids.map(String) : []);
    configured = true;
    document.dispatchEvent(new CustomEvent(CONTROL_NAME, {
      detail: { action: "configure", enabledIndicatorIds: [...enabledIndicatorIds] }
    }));
    if (drain) {
      document.dispatchEvent(new CustomEvent(CONTROL_NAME, { detail: { action: "drain" } }));
    }
    scheduleSnapshot(0);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "VEILANCE_INDICATOR_CONFIG_CHANGED") {
      configureMainWorld(message.enabledIndicatorIds, false);
      return undefined;
    }
    if (message?.type !== "VEILANCE_CAPTURE_REDACTED_DOCUMENT") return undefined;
    void (async () => {
      try {
        const redactor = globalThis.VeilanceRedactedHtml;
        if (!redactor?.captureRedactedDocument) throw new Error("The redacted HTML capture policy is unavailable");
        const [pageSnapshot, captured] = await Promise.all([
          collectPageSnapshot(),
          Promise.resolve().then(() => redactor.captureRedactedDocument(document, location))
        ]);
        sendResponse({ ok: true, document: captured, pageSnapshot });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    })();
    return true;
  });

  void (async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "VEILANCE_GET_INDICATOR_CONFIG",
        pageSessionId
      });
      configureMainWorld(response?.enabledIndicatorIds || [], true);
    } catch {
      // Keep collection off if the extension was reloaded or configuration is unavailable.
      configureMainWorld([], true);
    }
  })();
})();
