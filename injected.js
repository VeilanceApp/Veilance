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
  let enabledIndicatorIds = new Set();
  let configured = false;
  let drained = false;

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

  function dispatch(event) {
    document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: event }));
  }

  function emit(indicatorId, kind, api, action, detail = {}) {
    if (configured && !enabledIndicatorIds.has(indicatorId)) return;
    const rateKey = `${indicatorId}:${kind}:${api}:${action}`;
    const count = (signalCounts.get(rateKey) || 0) + 1;
    signalCounts.set(rateKey, count);
    if (count > MAX_EVENTS_PER_SIGNAL) return;

    const event = {
      id: `${sessionId}:${++sequence}`,
      indicatorId,
      kind,
      api,
      action,
      detail: cleanDetail(detail),
      timestamp: Date.now()
    };
    if (buffer.length < MAX_BUFFERED_EVENTS) buffer.push(event);
    if (configured && enabledIndicatorIds.has(indicatorId)) dispatch(event);
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

  function wrapAccessor(target, property, beforeGet, beforeSet) {
    if (!target) return;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(target, property);
    } catch {
      return;
    }
    if (!descriptor) return;

    const originalGet = descriptor.get;
    const originalSet = descriptor.set;
    if (
      (originalGet && originalGet[WRAPPED_FLAG]) ||
      (originalSet && originalSet[WRAPPED_FLAG])
    ) return;

    let wrappedGet = originalGet;
    let wrappedSet = originalSet;
    if (typeof originalGet === "function" && typeof beforeGet === "function") {
      wrappedGet = function veilanceWrappedGetter() {
        try {
          beforeGet.call(this);
        } catch {
          // Instrumentation must never break the host page.
        }
        return Reflect.apply(originalGet, this, []);
      };
      try {
        Object.defineProperty(wrappedGet, WRAPPED_FLAG, { value: true });
        Object.defineProperty(wrappedGet, "toString", {
          value: () => Function.prototype.toString.call(originalGet),
          configurable: true
        });
      } catch {
        // Function metadata is best effort.
      }
    }
    if (typeof originalSet === "function" && typeof beforeSet === "function") {
      wrappedSet = function veilanceWrappedSetter(value) {
        try {
          beforeSet.call(this);
        } catch {
          // Instrumentation must never break the host page.
        }
        return Reflect.apply(originalSet, this, [value]);
      };
      try {
        Object.defineProperty(wrappedSet, WRAPPED_FLAG, { value: true });
        Object.defineProperty(wrappedSet, "toString", {
          value: () => Function.prototype.toString.call(originalSet),
          configurable: true
        });
      } catch {
        // Function metadata is best effort.
      }
    }

    if (wrappedGet === originalGet && wrappedSet === originalSet) return;
    try {
      Object.defineProperty(target, property, {
        ...descriptor,
        get: wrappedGet,
        set: wrappedSet
      });
    } catch {
      // Some browser properties are not configurable in every build.
    }
  }

  function safeValue(read) {
    try {
      return read();
    } catch {
      return undefined;
    }
  }

  function prototypeOf(value) {
    try {
      return value ? Object.getPrototypeOf(value) : null;
    } catch {
      return null;
    }
  }

  function hyphenate(value) {
    return String(value)
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
  }

  function coarseMediaFeature(query) {
    const text = String(query || "").toLowerCase();
    const known = [
      "prefers-color-scheme", "prefers-reduced-motion", "prefers-contrast",
      "forced-colors", "inverted-colors", "pointer", "any-pointer", "hover",
      "any-hover", "color-gamut", "dynamic-range", "video-dynamic-range",
      "display-mode", "orientation", "resolution", "width", "height"
    ];
    return known.find((feature) => text.includes(feature)) || "other";
  }

  // Capture optional object prototypes before accessors are instrumented so
  // Veilance's own setup reads never appear as website activity.
  const optionalPrototypes = {
    userAgentData: prototypeOf(safeValue(() => navigator.userAgentData)),
    connection: prototypeOf(safeValue(() => navigator.connection)),
    gpu: prototypeOf(safeValue(() => navigator.gpu)),
    bluetooth: prototypeOf(safeValue(() => navigator.bluetooth)),
    usb: prototypeOf(safeValue(() => navigator.usb)),
    hid: prototypeOf(safeValue(() => navigator.hid)),
    serial: prototypeOf(safeValue(() => navigator.serial)),
    credentials: prototypeOf(safeValue(() => navigator.credentials)),
    mediaCapabilities: prototypeOf(safeValue(() => navigator.mediaCapabilities)),
    fonts: prototypeOf(safeValue(() => document.fonts)),
    cookieStore: prototypeOf(safeValue(() => globalThis.cookieStore)),
    speechSynthesis: prototypeOf(safeValue(() => globalThis.speechSynthesis)),
    sharedStorage: prototypeOf(safeValue(() => globalThis.sharedStorage)),
    sharedStorageWorklet: prototypeOf(safeValue(() => globalThis.sharedStorage?.worklet))
  };

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
    emit("browser-storage", "storage", "Storage", "write", { area: storageArea(this) });
  });
  wrapMethod(globalThis.Storage?.prototype, "removeItem", function () {
    emit("browser-storage", "storage", "Storage", "remove", { area: storageArea(this) });
  });
  wrapMethod(globalThis.Storage?.prototype, "clear", function () {
    emit("browser-storage", "storage", "Storage", "clear", { area: storageArea(this) });
  });
  wrapMethod(globalThis.IDBFactory?.prototype, "open", () => {
    emit("browser-storage", "storage", "IndexedDB", "open");
  });
  wrapMethod(globalThis.IDBFactory?.prototype, "deleteDatabase", () => {
    emit("browser-storage", "storage", "IndexedDB", "delete");
  });
  wrapMethod(globalThis.CacheStorage?.prototype, "open", () => {
    emit("browser-storage", "storage", "CacheStorage", "open");
  });
  wrapMethod(globalThis.CacheStorage?.prototype, "delete", () => {
    emit("browser-storage", "storage", "CacheStorage", "delete");
  });
  wrapMethod(globalThis.ServiceWorkerContainer?.prototype, "register", () => {
    emit("browser-storage", "storage", "ServiceWorker", "register");
  });

  // Cookie and cross-site storage access. Cookie names and values are never read
  // by the instrumentation and are never included in an event.
  wrapAccessor(
    globalThis.Document?.prototype,
    "cookie",
    () => emit("cookie-access", "storage", "Cookie", "read"),
    () => emit("cookie-access", "storage", "Cookie", "write")
  );
  for (const method of ["hasStorageAccess", "requestStorageAccess", "requestStorageAccessForOrigin"]) {
    wrapMethod(globalThis.Document?.prototype, method, () => {
      emit("cookie-access", "storage", "StorageAccess", hyphenate(method));
    });
  }
  for (const method of ["get", "getAll", "set", "delete"]) {
    wrapMethod(globalThis.CookieStore?.prototype || optionalPrototypes.cookieStore, method, () => {
      emit("cookie-access", "storage", "CookieStore", hyphenate(method));
    });
  }

  // Canvas readback. Normal drawing calls are intentionally ignored.
  wrapMethod(globalThis.HTMLCanvasElement?.prototype, "toDataURL", () => {
    emit("canvas", "fingerprinting", "Canvas", "export");
  });
  wrapMethod(globalThis.HTMLCanvasElement?.prototype, "toBlob", () => {
    emit("canvas", "fingerprinting", "Canvas", "export");
  });
  wrapMethod(globalThis.CanvasRenderingContext2D?.prototype, "getImageData", () => {
    emit("canvas", "fingerprinting", "Canvas", "readback");
  });
  wrapMethod(globalThis.CanvasRenderingContext2D?.prototype, "measureText", () => {
    emit("font-probing", "fingerprinting", "Canvas2D", "measure-text");
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
        emit("webgl", "fingerprinting", "WebGL", "renderer-query", { parameter: "WEBGL_debug_renderer_info" });
      }
    });
    wrapMethod(prototype, "getParameter", (args) => {
      const parameter = Number(args[0]);
      const label = interestingWebGlParameters.get(parameter);
      if (label) emit("webgl", "fingerprinting", "WebGL", "renderer-query", { parameter: label });
    });
    wrapMethod(prototype, "readPixels", () => {
      emit("webgl", "fingerprinting", "WebGL", "read-pixels");
    });
  }

  instrumentWebGl(globalThis.WebGLRenderingContext?.prototype);
  instrumentWebGl(globalThis.WebGL2RenderingContext?.prototype);

  // Audio fingerprinting primitives.
  wrapMethod(globalThis.BaseAudioContext?.prototype, "createOscillator", () => {
    emit("audio", "audio", "AudioContext", "create-oscillator");
  });
  wrapMethod(globalThis.BaseAudioContext?.prototype, "createAnalyser", () => {
    emit("audio", "audio", "AudioContext", "create-analyser");
  });
  wrapMethod(globalThis.BaseAudioContext?.prototype, "createDynamicsCompressor", () => {
    emit("audio", "audio", "AudioContext", "create-compressor");
  });
  wrapMethod(globalThis.OfflineAudioContext?.prototype, "startRendering", () => {
    emit("audio", "fingerprinting", "AudioContext", "offline-render");
  });
  wrapMethod(globalThis.AudioBuffer?.prototype, "getChannelData", () => {
    emit("audio", "fingerprinting", "AudioBuffer", "read-buffer");
  });
  wrapMethod(globalThis.AudioBuffer?.prototype, "copyFromChannel", () => {
    emit("audio", "fingerprinting", "AudioBuffer", "read-buffer");
  });

  // Browser and device characteristics commonly combined into fingerprints.
  for (const property of [
    "userAgent", "appVersion", "platform", "vendor", "productSub",
    "hardwareConcurrency", "deviceMemory", "maxTouchPoints", "language",
    "languages", "plugins", "mimeTypes", "pdfViewerEnabled", "doNotTrack",
    "globalPrivacyControl", "webdriver"
  ]) {
    wrapAccessor(globalThis.Navigator?.prototype, property, () => {
      emit("navigator-characteristics", "fingerprinting", "Navigator", `read-${hyphenate(property)}`);
    });
  }
  const userAgentDataPrototype = globalThis.NavigatorUAData?.prototype || optionalPrototypes.userAgentData;
  wrapMethod(userAgentDataPrototype, "getHighEntropyValues", () => {
    emit("navigator-characteristics", "fingerprinting", "ClientHints", "high-entropy-values");
  });
  wrapMethod(userAgentDataPrototype, "toJSON", () => {
    emit("navigator-characteristics", "fingerprinting", "ClientHints", "serialize");
  });
  for (const property of ["brands", "mobile", "platform"]) {
    wrapAccessor(userAgentDataPrototype, property, () => {
      emit("navigator-characteristics", "fingerprinting", "ClientHints", `read-${hyphenate(property)}`);
    });
  }

  for (const property of [
    "width", "height", "availWidth", "availHeight", "colorDepth", "pixelDepth", "isExtended"
  ]) {
    wrapAccessor(globalThis.Screen?.prototype, property, () => {
      emit("screen-characteristics", "fingerprinting", "Screen", `read-${hyphenate(property)}`);
    });
  }
  for (const property of ["type", "angle"]) {
    wrapAccessor(globalThis.ScreenOrientation?.prototype, property, () => {
      emit("screen-characteristics", "fingerprinting", "ScreenOrientation", `read-${property}`);
    });
  }
  wrapAccessor(globalThis.Window?.prototype, "devicePixelRatio", () => {
    emit("screen-characteristics", "fingerprinting", "Screen", "read-device-pixel-ratio");
  });

  wrapMethod(globalThis.Date?.prototype, "getTimezoneOffset", () => {
    emit("locale-timezone", "fingerprinting", "Locale", "timezone-offset");
  });
  for (const formatterName of [
    "DateTimeFormat", "NumberFormat", "Collator", "PluralRules",
    "RelativeTimeFormat", "ListFormat", "DisplayNames", "Segmenter"
  ]) {
    const formatter = globalThis.Intl?.[formatterName];
    wrapMethod(formatter?.prototype, "resolvedOptions", () => {
      emit("locale-timezone", "fingerprinting", "Locale", "resolved-options", {
        formatter: formatterName
      });
    });
  }

  const fontSetPrototype = globalThis.FontFaceSet?.prototype || optionalPrototypes.fonts;
  wrapMethod(fontSetPrototype, "check", () => {
    emit("font-probing", "fingerprinting", "Fonts", "check");
  });
  wrapMethod(fontSetPrototype, "load", () => {
    emit("font-probing", "fingerprinting", "Fonts", "load");
  });

  wrapMethod(globalThis.Window?.prototype, "matchMedia", (args) => {
    emit("css-media-queries", "fingerprinting", "CSSMedia", "match", {
      feature: coarseMediaFeature(args[0])
    });
  });

  for (const method of ["getEntries", "getEntriesByType", "getEntriesByName"]) {
    wrapMethod(globalThis.Performance?.prototype, method, (args) => {
      const requestedType = method === "getEntriesByType" && typeof args[0] === "string"
        ? String(args[0]).slice(0, 40)
        : "multiple";
      emit("performance-timing", "fingerprinting", "Performance", hyphenate(method), {
        entryType: requestedType
      });
    });
  }
  wrapMethod(globalThis.PerformanceObserver?.prototype, "observe", () => {
    emit("performance-timing", "fingerprinting", "Performance", "observe");
  });

  const gpuPrototype = globalThis.GPU?.prototype || optionalPrototypes.gpu;
  wrapMethod(gpuPrototype, "requestAdapter", () => {
    emit("webgpu", "fingerprinting", "WebGPU", "request-adapter");
  });
  wrapMethod(gpuPrototype, "getPreferredCanvasFormat", () => {
    emit("webgpu", "fingerprinting", "WebGPU", "preferred-format");
  });
  wrapMethod(globalThis.GPUAdapter?.prototype, "requestDevice", () => {
    emit("webgpu", "fingerprinting", "WebGPU", "request-device");
  });
  wrapMethod(globalThis.GPUAdapter?.prototype, "requestAdapterInfo", () => {
    emit("webgpu", "fingerprinting", "WebGPU", "adapter-info");
  });
  wrapAccessor(globalThis.GPUAdapter?.prototype, "info", () => {
    emit("webgpu", "fingerprinting", "WebGPU", "adapter-info");
  });

  const connectionPrototype = globalThis.NetworkInformation?.prototype || optionalPrototypes.connection;
  for (const property of ["type", "effectiveType", "downlink", "downlinkMax", "rtt", "saveData"]) {
    wrapAccessor(connectionPrototype, property, () => {
      emit("network-information", "fingerprinting", "NetworkInformation", `read-${hyphenate(property)}`);
    });
  }

  const mediaCapabilitiesPrototype = globalThis.MediaCapabilities?.prototype || optionalPrototypes.mediaCapabilities;
  for (const method of ["decodingInfo", "encodingInfo"]) {
    wrapMethod(mediaCapabilitiesPrototype, method, () => {
      emit("media-capabilities", "fingerprinting", "MediaCapabilities", hyphenate(method));
    });
  }
  wrapMethod(globalThis.Navigator?.prototype, "requestMediaKeySystemAccess", () => {
    emit("media-capabilities", "fingerprinting", "EncryptedMedia", "key-system-access");
  });

  // WebRTC and device APIs.
  wrapMethod(globalThis.RTCPeerConnection?.prototype, "createOffer", () => {
    emit("webrtc", "network-identity", "WebRTC", "create-offer");
  });
  wrapMethod(globalThis.RTCPeerConnection?.prototype, "createDataChannel", () => {
    emit("webrtc", "network-identity", "WebRTC", "create-data-channel");
  });
  wrapMethod(globalThis.RTCPeerConnection?.prototype, "getStats", () => {
    emit("webrtc", "network-identity", "WebRTC", "get-stats");
  });
  wrapMethod(globalThis.MediaDevices?.prototype, "enumerateDevices", () => {
    emit("media-devices", "sensitive-api", "MediaDevices", "enumerate-devices");
  });
  wrapMethod(globalThis.MediaDevices?.prototype, "getUserMedia", () => {
    emit("media-devices", "sensitive-api", "MediaDevices", "get-user-media");
  });
  wrapMethod(globalThis.Geolocation?.prototype, "getCurrentPosition", () => {
    emit("geolocation", "sensitive-api", "Geolocation", "get-position");
  });
  wrapMethod(globalThis.Geolocation?.prototype, "watchPosition", () => {
    emit("geolocation", "sensitive-api", "Geolocation", "watch-position");
  });
  wrapMethod(globalThis.Permissions?.prototype, "query", (args) => {
    const permission = typeof args[0]?.name === "string" ? args[0].name : "unknown";
    emit("permission-queries", "permission", "Permissions", "query", { permission });
  });

  const connectedApis = [
    [globalThis.Bluetooth?.prototype || optionalPrototypes.bluetooth, "Bluetooth", ["getAvailability", "getDevices", "requestDevice"]],
    [globalThis.USB?.prototype || optionalPrototypes.usb, "USB", ["getDevices", "requestDevice"]],
    [globalThis.HID?.prototype || optionalPrototypes.hid, "HID", ["getDevices", "requestDevice"]],
    [globalThis.Serial?.prototype || optionalPrototypes.serial, "Serial", ["getPorts", "requestPort"]]
  ];
  for (const [prototype, api, methods] of connectedApis) {
    for (const method of methods) {
      wrapMethod(prototype, method, () => {
        const action = /^request/i.test(method) ? "request-access" : "enumerate";
        emit("connected-devices", "sensitive-api", api, action);
      });
    }
  }
  wrapMethod(globalThis.Navigator?.prototype, "requestMIDIAccess", () => {
    emit("connected-devices", "sensitive-api", "MIDI", "request-access");
  });
  wrapMethod(globalThis.Navigator?.prototype, "getGamepads", () => {
    emit("connected-devices", "sensitive-api", "Gamepad", "enumerate");
  });

  wrapMethod(globalThis.EventTarget?.prototype, "addEventListener", (args) => {
    const type = String(args[0] || "").toLowerCase();
    if (type === "devicemotion" || type === "deviceorientation" || type === "deviceorientationabsolute") {
      emit("device-sensors", "sensitive-api", "Sensors", "listen", {
        sensor: type.replace(/^device/, "")
      });
    }
  });
  wrapMethod(globalThis.Sensor?.prototype, "start", function () {
    emit("device-sensors", "sensitive-api", "Sensors", "start", {
      sensor: String(this?.constructor?.name || "Sensor").slice(0, 60)
    });
  });
  for (const constructor of [globalThis.DeviceMotionEvent, globalThis.DeviceOrientationEvent]) {
    wrapMethod(constructor, "requestPermission", () => {
      emit("device-sensors", "permission", "Sensors", "request-permission");
    });
  }

  const credentialPrototype = globalThis.CredentialsContainer?.prototype || optionalPrototypes.credentials;
  for (const method of ["get", "create", "store", "preventSilentAccess"]) {
    wrapMethod(credentialPrototype, method, () => {
      emit("credential-management", "sensitive-api", "Credentials", hyphenate(method));
    });
  }
  for (const method of [
    "isUserVerifyingPlatformAuthenticatorAvailable",
    "isConditionalMediationAvailable",
    "getClientCapabilities"
  ]) {
    wrapMethod(globalThis.PublicKeyCredential, method, () => {
      emit("credential-management", "fingerprinting", "WebAuthn", hyphenate(method));
    });
  }

  for (const [method, action] of [
    ["showOpenFilePicker", "open-picker"],
    ["showSaveFilePicker", "save-picker"],
    ["showDirectoryPicker", "directory-picker"]
  ]) {
    wrapMethod(globalThis.Window?.prototype, method, () => {
      emit("file-system-access", "sensitive-api", "FileSystem", action);
    });
    wrapMethod(globalThis, method, () => {
      emit("file-system-access", "sensitive-api", "FileSystem", action);
    });
  }
  for (const method of ["queryPermission", "requestPermission"]) {
    wrapMethod(globalThis.FileSystemHandle?.prototype, method, () => {
      emit("file-system-access", "sensitive-api", "FileSystem", hyphenate(method));
    });
  }
  for (const method of ["getFile", "createWritable"] ) {
    wrapMethod(globalThis.FileSystemFileHandle?.prototype, method, () => {
      emit("file-system-access", "sensitive-api", "FileSystem", hyphenate(method));
    });
  }
  for (const method of ["getFileHandle", "getDirectoryHandle", "removeEntry", "resolve"]) {
    wrapMethod(globalThis.FileSystemDirectoryHandle?.prototype, method, () => {
      emit("file-system-access", "sensitive-api", "FileSystem", hyphenate(method));
    });
  }

  wrapMethod(globalThis.SpeechSynthesis?.prototype || optionalPrototypes.speechSynthesis, "getVoices", () => {
    emit("speech", "fingerprinting", "SpeechSynthesis", "get-voices");
  });
  for (const recognition of [globalThis.SpeechRecognition, globalThis.webkitSpeechRecognition]) {
    wrapMethod(recognition?.prototype, "start", () => {
      emit("speech", "sensitive-api", "SpeechRecognition", "start");
    });
  }

  const clipboardPrototype = globalThis.Clipboard?.prototype;
  wrapMethod(clipboardPrototype, "read", () => emit("clipboard", "sensitive-api", "Clipboard", "read"));
  wrapMethod(clipboardPrototype, "readText", () => emit("clipboard", "sensitive-api", "Clipboard", "read-text"));
  wrapMethod(clipboardPrototype, "write", () => emit("clipboard", "sensitive-api", "Clipboard", "write"));
  wrapMethod(clipboardPrototype, "writeText", () => emit("clipboard", "sensitive-api", "Clipboard", "write-text"));

  wrapMethod(globalThis.Notification, "requestPermission", () => {
    emit("notifications", "permission", "Notification", "request-permission");
  });
  wrapMethod(globalThis.Navigator?.prototype, "getBattery", () => {
    emit("battery", "device-api", "Battery", "read-status");
  });
  wrapMethod(globalThis.Navigator?.prototype, "sendBeacon", (args) => {
    emit("beacon", "network", "Beacon", "send", { destinationHost: safeHost(args[0]) || "unknown" });
  });

  // Browser advertising APIs. Returned topics, interest groups, auction
  // configuration, and shared-storage keys or values are intentionally omitted.
  wrapMethod(globalThis.Document?.prototype, "browsingTopics", () => {
    emit("privacy-sandbox", "advertising", "Topics", "read");
  });
  for (const method of [
    "joinAdInterestGroup", "leaveAdInterestGroup", "updateAdInterestGroups",
    "runAdAuction", "clearOriginJoinedAdInterestGroups", "createAuctionNonce"
  ]) {
    wrapMethod(globalThis.Navigator?.prototype, method, () => {
      emit("privacy-sandbox", "advertising", "ProtectedAudience", hyphenate(method));
    });
  }
  const sharedStoragePrototype = globalThis.SharedStorage?.prototype || optionalPrototypes.sharedStorage;
  for (const method of ["set", "append", "delete", "clear", "get", "run", "selectURL"]) {
    wrapMethod(sharedStoragePrototype, method, () => {
      emit("privacy-sandbox", "advertising", "SharedStorage", hyphenate(method));
    });
  }
  wrapAccessor(sharedStoragePrototype, "length", () => {
    emit("privacy-sandbox", "advertising", "SharedStorage", "read-length");
  });
  wrapMethod(
    globalThis.SharedStorageWorklet?.prototype || optionalPrototypes.sharedStorageWorklet,
    "addModule",
    () => emit("privacy-sandbox", "advertising", "SharedStorage", "add-module")
  );

  // Record SPA navigations without recording path, query, or fragment data.
  wrapMethod(globalThis.History?.prototype, "pushState", () => {
    emit("spa-navigation", "navigation", "History", "push-state", { origin: location.origin });
  });
  wrapMethod(globalThis.History?.prototype, "replaceState", () => {
    emit("spa-navigation", "navigation", "History", "replace-state", { origin: location.origin });
  });
  addEventListener("popstate", () => {
    emit("spa-navigation", "navigation", "History", "pop-state", { origin: location.origin });
  });

  document.addEventListener(CONTROL_NAME, (event) => {
    const action = event?.detail?.action;
    if (action === "configure") {
      const values = Array.isArray(event.detail.enabledIndicatorIds)
        ? event.detail.enabledIndicatorIds.slice(0, 200)
        : [];
      enabledIndicatorIds = new Set(values.map((value) => String(value).slice(0, 80)));
      configured = true;
      for (let index = buffer.length - 1; index >= 0; index -= 1) {
        if (!enabledIndicatorIds.has(buffer[index].indicatorId)) buffer.splice(index, 1);
      }
      return;
    }
    if (action === "drain" && configured && !drained) {
      drained = true;
      for (const bufferedEvent of buffer) {
        if (enabledIndicatorIds.has(bufferedEvent.indicatorId)) dispatch(bufferedEvent);
      }
    }
  });

})();
