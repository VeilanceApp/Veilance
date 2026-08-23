(() => {
  "use strict";

  const EVENT_NAME = "__veilance_event_v1__";
  const CONTROL_NAME = "__veilance_control_v1__";
  const INSTALLED_FLAG = Symbol.for("veilance.instrumentation.v1");
  const WRAPPED_FLAG = Symbol.for("veilance.wrapped.v1");
  const MAX_BUFFERED_EVENTS = 300;
  const MAX_EVENTS_PER_SIGNAL = 75;

  if (window[INSTALLED_FLAG]) return;
  Object.defineProperty(window, INSTALLED_FLAG, { value: true, configurable: false });

  const sessionId = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let sequence = 0;
  const buffer = [];
  const signalCounts = new Map();

  function safeHost(value) {
    if (typeof value !== "string") return undefined;
    try {
      const parsed = new URL(value, location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
      return parsed.hostname.toLowerCase();
    } catch {
      return undefined;
    }
  }

  function cleanDetail(detail) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
    const allowed = {};
    for (const [key, value] of Object.entries(detail)) {
      if (typeof value === "string") allowed[key] = value.slice(0, 120);
      else if (typeof value === "number" || typeof value === "boolean") allowed[key] = value;
      if (Object.keys(allowed).length >= 6) break;
    }
    return allowed;
  }

  function emit(kind, api, action, detail = {}) {
    const rateKey = `${kind}:${api}:${action}`;
    const count = (signalCounts.get(rateKey) || 0) + 1;
    signalCounts.set(rateKey, count);
    if (count > MAX_EVENTS_PER_SIGNAL) return;

    const event = {
      id: `${sessionId}:${++sequence}`,
      kind,
      api,
      action,
      detail: cleanDetail(detail),
      timestamp: Date.now()
    };
    if (buffer.length < MAX_BUFFERED_EVENTS) buffer.push(event);
    document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: event }));
  }

  function wrapMethod(target, method, beforeCall) {
    if (!target) return;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(target, method);
    } catch {
      return;
    }
    if (!descriptor || typeof descriptor.value !== "function") return;
    const original = descriptor.value;
    if (original[WRAPPED_FLAG]) return;

    function veilanceWrappedMethod(...args) {
      try {
        beforeCall.call(this, args);
      } catch {
        // Instrumentation must never break the host page.
      }
      return Reflect.apply(original, this, args);
    }

    try {
      Object.defineProperty(veilanceWrappedMethod, WRAPPED_FLAG, { value: true });
      Object.defineProperty(veilanceWrappedMethod, "toString", {
        value: () => Function.prototype.toString.call(original),
        configurable: true
      });
      Object.defineProperty(target, method, { ...descriptor, value: veilanceWrappedMethod });
    } catch {
      // Some browser properties are not configurable in every build.
    }
  }

  function storageArea(instance) {
    try {
      if (instance === window.localStorage) return "localStorage";
      if (instance === window.sessionStorage) return "sessionStorage";
    } catch {
      // Access can throw in restricted storage contexts.
    }
    return "Storage";
  }

  // Browser storage. No key names or values are emitted.
  wrapMethod(globalThis.Storage?.prototype, "setItem", function () {
    emit("storage", "Storage", "write", { area: storageArea(this) });
  });
  wrapMethod(globalThis.Storage?.prototype, "removeItem", function () {
    emit("storage", "Storage", "remove", { area: storageArea(this) });
  });
  wrapMethod(globalThis.Storage?.prototype, "clear", function () {
    emit("storage", "Storage", "clear", { area: storageArea(this) });
  });
  wrapMethod(globalThis.IDBFactory?.prototype, "open", () => {
    emit("storage", "IndexedDB", "open");
  });
  wrapMethod(globalThis.IDBFactory?.prototype, "deleteDatabase", () => {
    emit("storage", "IndexedDB", "delete");
  });
  wrapMethod(globalThis.CacheStorage?.prototype, "open", () => {
    emit("storage", "CacheStorage", "open");
  });
  wrapMethod(globalThis.CacheStorage?.prototype, "delete", () => {
    emit("storage", "CacheStorage", "delete");
  });
  wrapMethod(globalThis.ServiceWorkerContainer?.prototype, "register", () => {
    emit("storage", "ServiceWorker", "register");
  });

  // Canvas readback. Normal drawing calls are intentionally ignored.
  wrapMethod(globalThis.HTMLCanvasElement?.prototype, "toDataURL", () => {
    emit("fingerprinting", "Canvas", "export");
  });
  wrapMethod(globalThis.HTMLCanvasElement?.prototype, "toBlob", () => {
    emit("fingerprinting", "Canvas", "export");
  });
  wrapMethod(globalThis.CanvasRenderingContext2D?.prototype, "getImageData", () => {
    emit("fingerprinting", "Canvas", "readback");
  });

  const interestingWebGlParameters = new Map([
    [37445, "UNMASKED_VENDOR_WEBGL"],
    [37446, "UNMASKED_RENDERER_WEBGL"],
    [7936, "VENDOR"],
    [7937, "RENDERER"],
    [35724, "SHADING_LANGUAGE_VERSION"]
  ]);

  function instrumentWebGl(prototype) {
    wrapMethod(prototype, "getExtension", (args) => {
      const name = String(args[0] || "");
      if (name.toLowerCase() === "webgl_debug_renderer_info") {
        emit("fingerprinting", "WebGL", "renderer-query", { parameter: "WEBGL_debug_renderer_info" });
      }
    });
    wrapMethod(prototype, "getParameter", (args) => {
      const parameter = Number(args[0]);
      const label = interestingWebGlParameters.get(parameter);
      if (label) emit("fingerprinting", "WebGL", "renderer-query", { parameter: label });
    });
    wrapMethod(prototype, "readPixels", () => {
      emit("fingerprinting", "WebGL", "read-pixels");
    });
  }

  instrumentWebGl(globalThis.WebGLRenderingContext?.prototype);
  instrumentWebGl(globalThis.WebGL2RenderingContext?.prototype);

  // Audio fingerprinting primitives.
  wrapMethod(globalThis.BaseAudioContext?.prototype, "createOscillator", () => {
    emit("audio", "AudioContext", "create-oscillator");
  });
  wrapMethod(globalThis.BaseAudioContext?.prototype, "createAnalyser", () => {
    emit("audio", "AudioContext", "create-analyser");
  });
  wrapMethod(globalThis.BaseAudioContext?.prototype, "createDynamicsCompressor", () => {
    emit("audio", "AudioContext", "create-compressor");
  });
  wrapMethod(globalThis.OfflineAudioContext?.prototype, "startRendering", () => {
    emit("fingerprinting", "AudioContext", "offline-render");
  });
  wrapMethod(globalThis.AudioBuffer?.prototype, "getChannelData", () => {
    emit("fingerprinting", "AudioBuffer", "read-buffer");
  });
  wrapMethod(globalThis.AudioBuffer?.prototype, "copyFromChannel", () => {
    emit("fingerprinting", "AudioBuffer", "read-buffer");
  });

  // WebRTC and device APIs.
  wrapMethod(globalThis.RTCPeerConnection?.prototype, "createOffer", () => {
    emit("network-identity", "WebRTC", "create-offer");
  });
  wrapMethod(globalThis.RTCPeerConnection?.prototype, "createDataChannel", () => {
    emit("network-identity", "WebRTC", "create-data-channel");
  });
  wrapMethod(globalThis.RTCPeerConnection?.prototype, "getStats", () => {
    emit("network-identity", "WebRTC", "get-stats");
  });
  wrapMethod(globalThis.MediaDevices?.prototype, "enumerateDevices", () => {
    emit("sensitive-api", "MediaDevices", "enumerate-devices");
  });
  wrapMethod(globalThis.MediaDevices?.prototype, "getUserMedia", () => {
    emit("sensitive-api", "MediaDevices", "get-user-media");
  });
  wrapMethod(globalThis.Geolocation?.prototype, "getCurrentPosition", () => {
    emit("sensitive-api", "Geolocation", "get-position");
  });
  wrapMethod(globalThis.Geolocation?.prototype, "watchPosition", () => {
    emit("sensitive-api", "Geolocation", "watch-position");
  });
  wrapMethod(globalThis.Permissions?.prototype, "query", (args) => {
    const permission = typeof args[0]?.name === "string" ? args[0].name : "unknown";
    emit("permission", "Permissions", "query", { permission });
  });

  const clipboardPrototype = globalThis.Clipboard?.prototype;
  wrapMethod(clipboardPrototype, "read", () => emit("sensitive-api", "Clipboard", "read"));
  wrapMethod(clipboardPrototype, "readText", () => emit("sensitive-api", "Clipboard", "read-text"));
  wrapMethod(clipboardPrototype, "write", () => emit("sensitive-api", "Clipboard", "write"));
  wrapMethod(clipboardPrototype, "writeText", () => emit("sensitive-api", "Clipboard", "write-text"));

  wrapMethod(globalThis.Notification, "requestPermission", () => {
    emit("permission", "Notification", "request-permission");
  });
  wrapMethod(globalThis.Navigator?.prototype, "getBattery", () => {
    emit("device-api", "Battery", "read-status");
  });
  wrapMethod(globalThis.Navigator?.prototype, "sendBeacon", (args) => {
    emit("network", "Beacon", "send", { destinationHost: safeHost(args[0]) || "unknown" });
  });

  // Record SPA navigations without recording path, query, or fragment data.
  wrapMethod(globalThis.History?.prototype, "pushState", () => {
    emit("navigation", "History", "push-state", { origin: location.origin });
  });
  wrapMethod(globalThis.History?.prototype, "replaceState", () => {
    emit("navigation", "History", "replace-state", { origin: location.origin });
  });
  addEventListener("popstate", () => {
    emit("navigation", "History", "pop-state", { origin: location.origin });
  });

  document.addEventListener(CONTROL_NAME, (event) => {
    if (event?.detail?.action !== "drain") return;
    for (const bufferedEvent of buffer) {
      document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: bufferedEvent }));
    }
  });

})();
