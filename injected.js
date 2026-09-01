(() => {
  "use strict";

  const EVENT_NAME = "__veilance_event_v1__";
  const CONTROL_NAME = "__veilance_control_v1__";
  const PROTECTION_EVENT_NAME = "__veilance_protection_event_v1__";
  const INSTALLED_FLAG = Symbol.for("veilance.instrumentation.v1");
  const WRAPPED_FLAG = Symbol.for("veilance.wrapped.v1");
  const FINGERPRINT_PROTECTION_FLAG = Symbol.for("veilance.fingerprint-protection-enabled.v1");
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
  let shieldRuleIndex = new Map();
  let configured = false;
  let drained = false;

  const fingerprintSeedBytes = new Uint32Array(1);
  const farbleMetadata = new WeakMap();
  try {
    crypto.getRandomValues(fingerprintSeedBytes);
  } catch {
    fingerprintSeedBytes[0] = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  function fingerprintProtectionEnabled() {
    try {
      return window[FINGERPRINT_PROTECTION_FLAG] === true;
    } catch {
      return false;
    }
  }

  function mixFingerprintSeed(value) {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  }

  function ruleSeed(ruleId) {
    let hash = fingerprintSeedBytes[0] >>> 0;
    for (const character of String(ruleId || "")) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return mixFingerprintSeed(hash);
  }

  function runtimeRule(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const id = typeof value.id === "string" ? value.id.slice(0, 80) : "";
    const name = typeof value.name === "string" ? value.name.slice(0, 100) : "";
    const surface = typeof value.surface === "string" ? value.surface.slice(0, 80) : "";
    const description = typeof value.description === "string" ? value.description.slice(0, 400) : "";
    const match = value.match;
    const protection = value.protection;
    if (!id || !name || !surface || !description || !match || !protection) return null;
    const indicatorId = typeof match.indicatorId === "string" ? match.indicatorId.slice(0, 80) : "";
    const api = typeof match.api === "string" ? match.api.slice(0, 80) : "";
    const actions = Array.isArray(match.actions)
      ? [...new Set(match.actions.slice(0, 8).map((action) => String(action).slice(0, 80)).filter(Boolean))]
      : [];
    if (!indicatorId || !api || !actions.length) return null;
    const detail = {};
    if (match.detail && typeof match.detail === "object" && !Array.isArray(match.detail)) {
      for (const [key, detailValue] of Object.entries(match.detail).slice(0, 8)) {
        if (
          typeof detailValue === "string" ||
          typeof detailValue === "boolean" ||
          (typeof detailValue === "number" && Number.isFinite(detailValue))
        ) detail[String(key).slice(0, 80)] = detailValue;
      }
    }
    const strategy = typeof protection.strategy === "string" ? protection.strategy.slice(0, 64) : "";
    if (![
      "binary-number", "bucket-number", "cap-number", "canvas-pixel-farbling", "float-array-farbling",
      "replace-number", "replace-string", "text-metrics-farbling", "typed-array-farbling"
    ].includes(strategy)) return null;
    const parameters = protection.parameters && typeof protection.parameters === "object" && !Array.isArray(protection.parameters)
      ? { ...protection.parameters }
      : {};
    return {
      id,
      name,
      surface,
      description,
      match: { indicatorId, api, actions, detail },
      protection: { strategy, parameters }
    };
  }

  function configureShieldRules(values) {
    const next = new Map();
    for (const value of Array.isArray(values) ? values.slice(0, 500) : []) {
      const rule = runtimeRule(value);
      if (!rule) continue;
      for (const action of rule.match.actions) {
        const key = `${rule.match.indicatorId}\u0000${rule.match.api}\u0000${action}`;
        const rules = next.get(key) || [];
        rules.push(rule);
        next.set(key, rules);
      }
    }
    shieldRuleIndex = next;
  }

  function shieldRuleFor(indicatorId, api, action, detail = {}) {
    if (!fingerprintProtectionEnabled()) return null;
    const key = `${indicatorId}\u0000${api}\u0000${action}`;
    for (const rule of shieldRuleIndex.get(key) || []) {
      const expected = rule.match.detail || {};
      if (Object.entries(expected).every(([name, value]) => detail?.[name] === value)) return rule;
    }
    return null;
  }

  function signatureFor(value) {
    let hash = 0x811c9dc5;
    const text = `${typeof value}:${String(value)}`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function returnedValuePreview(value, { fields, sensitiveString = false, type } = {}) {
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
      const cleanFields = {};
      for (const [name, fieldValue] of Object.entries(fields).slice(0, 16)) {
        if (
          typeof fieldValue === "string" ||
          typeof fieldValue === "boolean" ||
          (typeof fieldValue === "number" && Number.isFinite(fieldValue)) ||
          fieldValue === null
        ) cleanFields[String(name).slice(0, 80)] = fieldValue;
      }
      return {
        kind: "object",
        type: String(type || value?.constructor?.name || "Object").slice(0, 80),
        fields: cleanFields
      };
    }
    if (value === null) return { kind: "scalar", type: "null", value: null };
    if (["number", "boolean"].includes(typeof value)) {
      return Number.isFinite(value) || typeof value === "boolean"
        ? { kind: "scalar", type: typeof value, value }
        : null;
    }
    if (typeof value === "string") {
      if (sensitiveString || /^data:/i.test(value)) {
        const mimeType = /^data:([^;,]+)/i.exec(value)?.[1] || "application/octet-stream";
        return {
          kind: "encoded-data",
          type: "string",
          length: value.length,
          mimeType: mimeType.slice(0, 80),
          preview: `${value.slice(0, 80)}${value.length > 80 ? "…" : ""}`
        };
      }
      return { kind: "scalar", type: "string", value: value.slice(0, 200) };
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      return {
        kind: "blob",
        type: String(value.type || "application/octet-stream").slice(0, 80),
        length: Math.max(0, Number(value.size) || 0)
      };
    }
    const array = value?.data && Number.isFinite(value.data.length) ? value.data : value;
    if (array && Number.isFinite(array.length) && typeof array !== "function") {
      const length = Math.max(0, Math.floor(Number(array.length) || 0));
      const sample = [];
      for (let index = 0; index < Math.min(16, length); index += 1) {
        const item = array[index];
        if (typeof item === "number" && Number.isFinite(item)) sample.push(item);
        else if (typeof item === "string" || typeof item === "boolean" || item === null) sample.push(item);
        else break;
      }
      return {
        kind: "array",
        type: String(array?.constructor?.name || type || "Array").slice(0, 80),
        length,
        sample,
        truncated: length > sample.length
      };
    }
    return null;
  }

  function reportShieldProtection(rule, action, originalValue, protectedValue, changedUnits = 1, returnedValue = null) {
    if (!rule || Object.is(originalValue, protectedValue) || changedUnits <= 0) return;
    dispatchProtection({
      ruleId: rule.id,
      surface: rule.surface,
      action,
      technique: rule.name,
      beforeSignature: signatureFor(originalValue),
      afterSignature: signatureFor(protectedValue),
      changedUnits,
      returnedValue: returnedValue || returnedValuePreview(protectedValue),
      explanation: rule.description,
      timestamp: Date.now()
    });
  }

  function applyScalarProtection(rule, value) {
    if (!rule) return value;
    const strategy = rule.protection.strategy;
    const parameters = rule.protection.parameters || {};
    if (strategy === "replace-string") {
      return typeof value === "string" && typeof parameters.value === "string"
        ? parameters.value.slice(0, 160)
        : value;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    if (strategy === "replace-number") {
      return Number.isFinite(parameters.value) ? Number(parameters.value) : value;
    }
    if (strategy === "binary-number") {
      const replacement = value === 0 ? parameters.zeroValue : parameters.nonZeroValue;
      return Number.isFinite(replacement) ? Number(replacement) : value;
    }
    if (strategy === "cap-number") {
      return Number.isFinite(parameters.maximum)
        ? Math.min(value, Number(parameters.maximum))
        : value;
    }
    if (strategy !== "bucket-number") return value;
    const step = Number(parameters.step);
    const minimum = Number(parameters.minimum);
    const maximum = Number(parameters.maximum);
    if (!(step > 0) || !Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) return value;
    if (parameters.preserveZero === true && value === 0) return value;
    const round = parameters.rounding === "floor"
      ? Math.floor
      : parameters.rounding === "ceil"
        ? Math.ceil
        : Math.round;
    const bucketed = round(value / step) * step;
    return Math.max(minimum, Math.min(maximum, Number(bucketed.toFixed(10))));
  }

  function shieldScalar(indicatorId, api, action, value, detail = {}) {
    const rule = shieldRuleFor(indicatorId, api, action, detail);
    const protectedValue = applyScalarProtection(rule, value);
    reportShieldProtection(rule, action, value, protectedValue);
    return protectedValue;
  }

  function arraySignature(value) {
    if (!value || !Number.isFinite(value.length)) return "00000000";
    let hash = 0x811c9dc5;
    const length = Math.max(0, Math.floor(value.length));
    const samples = Math.min(32, length);
    for (let index = 0; index < samples; index += 1) {
      const offset = samples === length ? index : Math.floor(index * length / samples);
      const text = String(value[offset]);
      for (let character = 0; character < text.length; character += 1) {
        hash ^= text.charCodeAt(character);
        hash = Math.imul(hash, 0x01000193);
      }
    }
    hash ^= length;
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function reportArrayProtection(rule, action, beforeSignature, value, changedUnits) {
    if (!rule || changedUnits <= 0) return;
    dispatchProtection({
      ruleId: rule.id,
      surface: rule.surface,
      action,
      technique: rule.name,
      beforeSignature,
      afterSignature: arraySignature(value),
      changedUnits,
      returnedValue: returnedValuePreview(value),
      explanation: rule.description,
      timestamp: Date.now()
    });
  }

  function integerArrayBounds(value) {
    const name = String(value?.constructor?.name || "");
    if (name === "Uint8Array" || name === "Uint8ClampedArray") return [0, 255];
    if (name === "Int8Array") return [-128, 127];
    if (name === "Uint16Array") return [0, 65535];
    if (name === "Int16Array") return [-32768, 32767];
    if (name === "Uint32Array") return [0, 4294967295];
    if (name === "Int32Array") return [-2147483648, 2147483647];
    return null;
  }

  function farbleIntegerArray(rule, value, startOffset = 0) {
    const bounds = integerArrayBounds(value);
    const length = Math.max(0, Number(value?.length) || 0);
    const start = Math.max(0, Math.min(length, Math.floor(Number(startOffset) || 0)));
    if (!rule || !bounds || start >= length) return { value, changedUnits: 0, beforeSignature: arraySignature(value) };
    const beforeSignature = arraySignature(value);
    const maximumEdits = Math.max(1, Math.min(64, Number(rule.protection?.parameters?.maximumEdits) || 8));
    const delta = Math.max(1, Math.min(8, Number(rule.protection?.parameters?.delta) || 1));
    const count = Math.min(maximumEdits, length - start);
    const seed = ruleSeed(rule.id);
    const changedOffsets = new Set();
    for (let attempt = 0; changedOffsets.size < count && attempt < count * 4; attempt += 1) {
      const mixed = mixFingerprintSeed(seed ^ Math.imul(attempt + 1, 0x9e3779b1));
      const offset = start + (mixed % (length - start));
      if (changedOffsets.has(offset)) continue;
      const original = Number(value[offset]);
      if (!Number.isFinite(original)) continue;
      const direction = (mixed & 1) === 0 ? -1 : 1;
      let next = original + direction * delta;
      if (next < bounds[0] || next > bounds[1]) next = original - direction * delta;
      next = Math.max(bounds[0], Math.min(bounds[1], next));
      if (next === original) continue;
      value[offset] = next;
      changedOffsets.add(offset);
    }
    return { value, changedUnits: changedOffsets.size, beforeSignature };
  }

  function farbleFloatArray(rule, value, { copy = false } = {}) {
    const name = String(value?.constructor?.name || "");
    const length = Math.max(0, Number(value?.length) || 0);
    if (!rule || !["Float32Array", "Float64Array"].includes(name) || !length) {
      return { value, changedUnits: 0, beforeSignature: arraySignature(value) };
    }
    let output = value;
    if (copy) {
      try {
        output = value.slice();
      } catch {
        return { value, changedUnits: 0, beforeSignature: arraySignature(value) };
      }
    }
    const beforeSignature = arraySignature(value);
    const maximumEdits = Math.max(1, Math.min(64, Number(rule.protection?.parameters?.maximumEdits) || 8));
    const epsilon = Math.max(0.000000001, Math.min(0.001, Number(rule.protection?.parameters?.epsilon) || 0.0000001));
    const count = Math.min(maximumEdits, length);
    const seed = ruleSeed(rule.id);
    const changedOffsets = new Set();
    for (let attempt = 0; changedOffsets.size < count && attempt < count * 4; attempt += 1) {
      const mixed = mixFingerprintSeed(seed ^ Math.imul(attempt + 1, 0x9e3779b1));
      const offset = mixed % length;
      if (changedOffsets.has(offset)) continue;
      const original = Number(output[offset]);
      if (!Number.isFinite(original)) continue;
      const next = original + ((mixed & 1) === 0 ? -epsilon : epsilon);
      if (Object.is(next, original)) continue;
      output[offset] = next;
      if (Object.is(Number(output[offset]), original)) continue;
      changedOffsets.add(offset);
    }
    return { value: output, changedUnits: changedOffsets.size, beforeSignature };
  }

  function farbleImageData(imageData, rule) {
    if (!rule || !fingerprintProtectionEnabled() || !imageData?.data || !imageData.data.length) return imageData;
    const copy = new Uint8ClampedArray(imageData.data);
    const pixelCount = Math.max(1, Math.floor(copy.length / 4));
    const maximumEdits = Math.max(1, Math.min(64, Number(rule.protection?.parameters?.maximumEdits) || 8));
    const deltaMagnitude = Math.max(1, Math.min(8, Number(rule.protection?.parameters?.delta) || 1));
    const edits = Math.min(maximumEdits, pixelCount);
    const seed = ruleSeed(rule.id);
    let beforeHash = 0x811c9dc5;
    let afterHash = 0x811c9dc5;
    let changedPixels = 0;
    for (let index = 0; index < edits; index += 1) {
      const mixed = mixFingerprintSeed(seed ^ Math.imul(index + 1, 0x9e3779b1));
      const pixel = mixed % pixelCount;
      const channel = (mixed >>> 8) % 3;
      const offset = pixel * 4 + channel;
      const originalValue = copy[offset];
      const delta = (mixed & 1) === 0 ? -deltaMagnitude : deltaMagnitude;
      let protectedValue = Math.max(0, Math.min(255, originalValue + delta));
      if (protectedValue === originalValue) {
        protectedValue = Math.max(0, Math.min(255, originalValue - delta));
      }
      copy[offset] = protectedValue;
      beforeHash ^= originalValue;
      beforeHash = Math.imul(beforeHash, 0x01000193);
      afterHash ^= protectedValue;
      afterHash = Math.imul(afterHash, 0x01000193);
      if (protectedValue !== originalValue) changedPixels += 1;
    }
    let result;
    try {
      result = new ImageData(copy, imageData.width, imageData.height, { colorSpace: imageData.colorSpace });
    } catch {
      try {
        result = new ImageData(copy, imageData.width, imageData.height);
      } catch {
        return imageData;
      }
    }
    try {
      farbleMetadata.set(result, {
        beforeSignature: (beforeHash >>> 0).toString(16).padStart(8, "0"),
        afterSignature: (afterHash >>> 0).toString(16).padStart(8, "0"),
        changedPixels
      });
    } catch {
      // Metadata is only used for Veilance's local protection explanation.
    }
    return result;
  }

  const TEXT_METRIC_PROPERTIES = Object.freeze([
    "width",
    "actualBoundingBoxLeft",
    "actualBoundingBoxRight",
    "fontBoundingBoxAscent",
    "fontBoundingBoxDescent",
    "actualBoundingBoxAscent",
    "actualBoundingBoxDescent",
    "emHeightAscent",
    "emHeightDescent",
    "hangingBaseline",
    "alphabeticBaseline",
    "ideographicBaseline"
  ]);

  function protectTextMetrics(rule, metrics) {
    if (!rule || rule.protection?.strategy !== "text-metrics-farbling" || !metrics) return metrics;
    const epsilon = Math.max(0.000001, Math.min(0.1, Number(rule.protection?.parameters?.epsilon) || 0.0001));
    const protectedValues = new Map();
    const before = [];
    const after = [];
    for (const property of TEXT_METRIC_PROPERTIES) {
      let original;
      try {
        original = Reflect.get(metrics, property, metrics);
      } catch {
        continue;
      }
      if (typeof original !== "number" || !Number.isFinite(original)) continue;
      const mixed = ruleSeed(`${rule.id}:${property}`);
      const protectedValue = Number((original + ((mixed & 1) === 0 ? -epsilon : epsilon)).toFixed(6));
      if (Object.is(original, protectedValue)) continue;
      protectedValues.set(property, protectedValue);
      before.push(`${property}:${original}`);
      after.push(`${property}:${protectedValue}`);
    }
    if (!protectedValues.size) return metrics;
    let protectedMetrics;
    try {
      protectedMetrics = new Proxy(metrics, {
        get(target, property) {
          if (protectedValues.has(property)) return protectedValues.get(property);
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    } catch {
      return metrics;
    }
    reportShieldProtection(
      rule,
      "Canvas text measurement",
      before.join("|"),
      after.join("|"),
      protectedValues.size,
      returnedValuePreview(protectedMetrics, {
        type: "TextMetrics",
        fields: Object.fromEntries(protectedValues)
      })
    );
    return protectedMetrics;
  }

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

  function dispatchProtection(detail) {
    try {
      document.dispatchEvent(new CustomEvent(PROTECTION_EVENT_NAME, { detail }));
    } catch {
      // Protection reporting must never interfere with the host page.
    }
  }

  function reportCanvasProtection(rule, action, original, protectedData, returnedValue = null) {
    if (!rule || !fingerprintProtectionEnabled() || !original?.data || !protectedData?.data) return;
    const metadata = farbleMetadata.get(protectedData);
    if (!metadata || metadata.changedPixels <= 0 || metadata.beforeSignature === metadata.afterSignature) return;
    dispatchProtection({
      ruleId: rule.id,
      surface: rule.surface,
      action,
      technique: rule.name,
      beforeSignature: metadata.beforeSignature,
      afterSignature: metadata.afterSignature,
      changedUnits: metadata.changedPixels,
      returnedValue: returnedValue || returnedValuePreview(protectedData),
      explanation: rule.description,
      timestamp: Date.now()
    });
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

  function wrapMethod(target, method, beforeCall, afterCall) {
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
      const result = Reflect.apply(original, this, args);
      if (typeof afterCall !== "function") return result;
      try {
        return afterCall.call(this, result, args);
      } catch {
        return result;
      }
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

  function observeMethodAccess(target, method, onAccess, protectedMethod = null, shouldProtect = fingerprintProtectionEnabled) {
    if (!target) return;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(target, method);
    } catch {
      return;
    }
    if (
      !descriptor ||
      !descriptor.configurable ||
      typeof descriptor.value !== "function"
    ) return;

    const original = descriptor.value;
    if (original[WRAPPED_FLAG]) return;

    function veilanceObservedMethodGetter() {
      try {
        onAccess.call(this);
      } catch {
        // Instrumentation must never break the host page.
      }
      // Return the native method directly when protection is off so browser
      // diagnostics created by the call remain attributed to the website.
      if (protectedMethod) {
        try {
          if (shouldProtect.call(this)) return protectedMethod;
        } catch {
          // Fall through to the native method when protection lookup fails.
        }
      }
      return original;
    }

    let veilanceObservedMethodSetter;
    if (descriptor.writable) {
      veilanceObservedMethodSetter = function (value) {
        try {
          if (this === target) {
            Object.defineProperty(target, method, { ...descriptor, value });
          } else {
            Object.defineProperty(this, method, {
              value,
              writable: true,
              enumerable: true,
              configurable: true
            });
          }
        } catch {
          // Preserve best-effort assignment behavior for unusual receivers.
        }
      };
    }

    try {
      Object.defineProperty(veilanceObservedMethodGetter, WRAPPED_FLAG, { value: true });
      if (veilanceObservedMethodSetter) {
        Object.defineProperty(veilanceObservedMethodSetter, WRAPPED_FLAG, { value: true });
      }
      Object.defineProperty(target, method, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: veilanceObservedMethodGetter,
        set: veilanceObservedMethodSetter
      });
    } catch {
      // Some browser properties are not configurable in every build.
    }
  }

  function wrapAccessor(target, property, beforeGet, beforeSet, afterGet) {
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
        const value = Reflect.apply(originalGet, this, []);
        if (typeof afterGet !== "function") return value;
        try {
          return afterGet.call(this, value);
        } catch {
          return value;
        }
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

  const IS_WINDOWS = (() => {
    const clientHintPlatform = safeValue(() => globalThis.navigator?.userAgentData?.platform);
    if (typeof clientHintPlatform === "string" && /^windows$/i.test(clientHintPlatform)) {
      return true;
    }

    const legacyPlatform = safeValue(() => globalThis.navigator?.platform);
    if (typeof legacyPlatform === "string" && /^win/i.test(legacyPlatform)) {
      return true;
    }

    const userAgent = safeValue(() => globalThis.navigator?.userAgent);
    return typeof userAgent === "string" && /windows/i.test(userAgent);
  })();

  function normalizeGpuAdapterOptions(options) {
    if (
      !IS_WINDOWS ||
      options === null ||
      (typeof options !== "object" && typeof options !== "function")
    ) {
      return options;
    }

    let powerPreference;
    try {
      powerPreference = Reflect.get(options, "powerPreference", options);
    } catch {
      return options;
    }
    if (powerPreference === undefined) return options;

    try {
      // Chromium currently ignores powerPreference on Windows and logs a
      // warning for every request. Hide only that ignored hint while passing
      // all current and future adapter options through unchanged.
      return new Proxy(Object.create(null), {
        get(_target, property) {
          if (property === "powerPreference") return undefined;
          return Reflect.get(options, property, options);
        },
        has(_target, property) {
          if (property === "powerPreference") return false;
          return Reflect.has(options, property);
        }
      });
    } catch {
      return options;
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

  // Canvas readback. When Fingerprint Protection is enabled, readback is
  // slightly and consistently perturbed for this page without changing the
  // visible canvas. Protection is installed at document_start by protection.js.
  const canvasPrototype = globalThis.HTMLCanvasElement?.prototype;
  const canvas2dPrototype = globalThis.CanvasRenderingContext2D?.prototype;
  const nativeCanvasToDataURL = canvasPrototype?.toDataURL;
  const nativeCanvasToBlob = canvasPrototype?.toBlob;
  const nativeGetImageData = canvas2dPrototype?.getImageData;
  const nativePutImageData = canvas2dPrototype?.putImageData;
  const nativeDrawImage = canvas2dPrototype?.drawImage;

  function nativeLike(original, replacement) {
    try {
      Object.defineProperty(replacement, "toString", {
        value: () => Function.prototype.toString.call(original),
        configurable: true
      });
    } catch {
      // Function metadata is best effort.
    }
    return replacement;
  }

  function protectedCanvasCopy(source, rule) {
    if (!rule || !fingerprintProtectionEnabled()) return null;
    const width = Number(source?.width) || 0;
    const height = Number(source?.height) || 0;
    if (width <= 0 || height <= 0 || width * height > 16777216) return null;
    if (typeof nativeDrawImage !== "function" || typeof nativeGetImageData !== "function" || typeof nativePutImageData !== "function") return null;
    const copy = document.createElement("canvas");
    copy.width = width;
    copy.height = height;
    const context = copy.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    Reflect.apply(nativeDrawImage, context, [source, 0, 0]);
    const originalPixels = Reflect.apply(nativeGetImageData, context, [0, 0, width, height]);
    const protectedPixels = farbleImageData(originalPixels, rule);
    Reflect.apply(nativePutImageData, context, [protectedPixels, 0, 0]);
    return { copy, originalPixels, protectedPixels };
  }

  if (typeof nativeCanvasToDataURL === "function") {
    const protectedToDataURL = nativeLike(nativeCanvasToDataURL, function (...args) {
      try {
        const rule = shieldRuleFor("canvas", "Canvas", "export-data-url");
        const result = protectedCanvasCopy(this, rule);
        if (result?.copy) {
          const protectedUrl = Reflect.apply(nativeCanvasToDataURL, result.copy, args);
          reportCanvasProtection(
            rule,
            "Canvas data URL export",
            result.originalPixels,
            result.protectedPixels,
            returnedValuePreview(protectedUrl, { sensitiveString: true })
          );
          return protectedUrl;
        }
      } catch {
        // Preserve native behavior for tainted or unsupported canvases.
      }
      return Reflect.apply(nativeCanvasToDataURL, this, args);
    });
    observeMethodAccess(canvasPrototype, "toDataURL", function () {
      emit("canvas", "fingerprinting", "Canvas", "export");
    }, protectedToDataURL, () => Boolean(shieldRuleFor("canvas", "Canvas", "export-data-url")));
  }

  if (typeof nativeCanvasToBlob === "function") {
    const protectedToBlob = nativeLike(nativeCanvasToBlob, function (...args) {
      try {
        const rule = shieldRuleFor("canvas", "Canvas", "export-blob");
        const result = protectedCanvasCopy(this, rule);
        if (result?.copy) {
          const callback = args[0];
          if (typeof callback === "function") {
            const protectedCallback = function (blob) {
              reportCanvasProtection(
                rule,
                "Canvas blob export",
                result.originalPixels,
                result.protectedPixels,
                returnedValuePreview(blob)
              );
              return Reflect.apply(callback, this, [blob]);
            };
            return Reflect.apply(nativeCanvasToBlob, result.copy, [protectedCallback, ...args.slice(1)]);
          }
          return Reflect.apply(nativeCanvasToBlob, result.copy, args);
        }
      } catch {
        // Preserve native behavior for tainted or unsupported canvases.
      }
      return Reflect.apply(nativeCanvasToBlob, this, args);
    });
    observeMethodAccess(canvasPrototype, "toBlob", function () {
      emit("canvas", "fingerprinting", "Canvas", "export");
    }, protectedToBlob, () => Boolean(shieldRuleFor("canvas", "Canvas", "export-blob")));
  }

  if (typeof nativeGetImageData === "function") {
    const protectedGetImageData = nativeLike(nativeGetImageData, function (...args) {
      const originalPixels = Reflect.apply(nativeGetImageData, this, args);
      const rule = shieldRuleFor("canvas", "Canvas", "readback");
      const protectedPixels = farbleImageData(originalPixels, rule);
      reportCanvasProtection(rule, "Pixel readback", originalPixels, protectedPixels);
      return protectedPixels;
    });
    observeMethodAccess(canvas2dPrototype, "getImageData", function () {
      emit("canvas", "fingerprinting", "Canvas", "readback");
    }, protectedGetImageData, () => Boolean(shieldRuleFor("canvas", "Canvas", "readback")));
  }
  wrapMethod(globalThis.CanvasRenderingContext2D?.prototype, "measureText", () => {
    emit("font-probing", "fingerprinting", "Canvas2D", "measure-text");
  }, (metrics) => {
    const rule = shieldRuleFor("font-probing", "Canvas2D", "measure-text");
    return protectTextMetrics(rule, metrics);
  });

  const interestingWebGlParameters = new Map([
    [37445, { action: "renderer-query", label: "UNMASKED_VENDOR_WEBGL" }],
    [37446, { action: "renderer-query", label: "UNMASKED_RENDERER_WEBGL" }],
    [7936, { action: "renderer-query", label: "VENDOR" }],
    [7937, { action: "renderer-query", label: "RENDERER" }],
    [35724, { action: "renderer-query", label: "SHADING_LANGUAGE_VERSION" }],
    [3379, { action: "capability-query", label: "MAX_TEXTURE_SIZE" }],
    [34076, { action: "capability-query", label: "MAX_CUBE_MAP_TEXTURE_SIZE" }],
    [34024, { action: "capability-query", label: "MAX_RENDERBUFFER_SIZE" }],
    [34921, { action: "capability-query", label: "MAX_VERTEX_ATTRIBS" }],
    [34930, { action: "capability-query", label: "MAX_TEXTURE_IMAGE_UNITS" }],
    [35660, { action: "capability-query", label: "MAX_VERTEX_TEXTURE_IMAGE_UNITS" }],
    [35661, { action: "capability-query", label: "MAX_COMBINED_TEXTURE_IMAGE_UNITS" }],
    [36348, { action: "capability-query", label: "MAX_VARYING_VECTORS" }],
    [36347, { action: "capability-query", label: "MAX_VERTEX_UNIFORM_VECTORS" }],
    [36349, { action: "capability-query", label: "MAX_FRAGMENT_UNIFORM_VECTORS" }]
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
      const entry = interestingWebGlParameters.get(parameter);
      if (entry) emit("webgl", "fingerprinting", "WebGL", entry.action, { parameter: entry.label });
    }, (value, args) => {
      const entry = interestingWebGlParameters.get(Number(args[0]));
      return entry
        ? shieldScalar("webgl", "WebGL", entry.action, value, { parameter: entry.label })
        : value;
    });
    wrapMethod(prototype, "readPixels", () => {
      emit("webgl", "fingerprinting", "WebGL", "read-pixels");
    }, (result, args) => {
      const rule = shieldRuleFor("webgl", "WebGL", "read-pixels");
      const protectedArray = farbleIntegerArray(rule, args[6], args[7]);
      reportArrayProtection(rule, "WebGL pixel readback", protectedArray.beforeSignature, protectedArray.value, protectedArray.changedUnits);
      return result;
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
  }, (value) => {
    const rule = shieldRuleFor("audio", "AudioBuffer", "get-channel-data");
    const protectedArray = farbleFloatArray(rule, value, { copy: true });
    reportArrayProtection(rule, "Audio channel readback", protectedArray.beforeSignature, protectedArray.value, protectedArray.changedUnits);
    return protectedArray.value;
  });
  wrapMethod(globalThis.AudioBuffer?.prototype, "copyFromChannel", () => {
    emit("audio", "fingerprinting", "AudioBuffer", "read-buffer");
  }, (result, args) => {
    const rule = shieldRuleFor("audio", "AudioBuffer", "copy-from-channel");
    const protectedArray = farbleFloatArray(rule, args[0]);
    reportArrayProtection(rule, "Audio copy readback", protectedArray.beforeSignature, protectedArray.value, protectedArray.changedUnits);
    return result;
  });
  for (const [method, floating] of [
    ["getFloatFrequencyData", true],
    ["getFloatTimeDomainData", true],
    ["getByteFrequencyData", false],
    ["getByteTimeDomainData", false]
  ]) {
    const action = hyphenate(method);
    wrapMethod(globalThis.AnalyserNode?.prototype, method, () => {
      emit("audio", "fingerprinting", "AnalyserNode", action);
    }, (result, args) => {
      const rule = shieldRuleFor("audio", "AnalyserNode", action);
      const protectedArray = floating
        ? farbleFloatArray(rule, args[0])
        : farbleIntegerArray(rule, args[0]);
      reportArrayProtection(
        rule,
        `Audio analyser ${floating ? "floating-point" : "byte"} readback`,
        protectedArray.beforeSignature,
        protectedArray.value,
        protectedArray.changedUnits
      );
      return result;
    });
  }

  // Browser and device characteristics commonly combined into fingerprints.
  for (const property of [
    "userAgent", "appVersion", "platform", "vendor", "productSub",
    "hardwareConcurrency", "deviceMemory", "maxTouchPoints", "language",
    "languages", "plugins", "mimeTypes", "pdfViewerEnabled", "doNotTrack",
    "globalPrivacyControl", "webdriver"
  ]) {
    const action = `read-${hyphenate(property)}`;
    wrapAccessor(
      globalThis.Navigator?.prototype,
      property,
      () => emit("navigator-characteristics", "fingerprinting", "Navigator", action),
      undefined,
      (value) => shieldScalar("navigator-characteristics", "Navigator", action, value)
    );
  }
  const userAgentDataPrototype = globalThis.NavigatorUAData?.prototype || optionalPrototypes.userAgentData;
  wrapMethod(userAgentDataPrototype, "getHighEntropyValues", () => {
    emit("navigator-characteristics", "fingerprinting", "ClientHints", "high-entropy-values");
  });
  wrapMethod(userAgentDataPrototype, "toJSON", () => {
    emit("navigator-characteristics", "fingerprinting", "ClientHints", "serialize");
  });
  for (const property of ["brands", "mobile", "platform"]) {
    const action = `read-${hyphenate(property)}`;
    wrapAccessor(
      userAgentDataPrototype,
      property,
      () => emit("navigator-characteristics", "fingerprinting", "ClientHints", action),
      undefined,
      (value) => shieldScalar("navigator-characteristics", "ClientHints", action, value)
    );
  }

  for (const property of [
    "width", "height", "availWidth", "availHeight", "colorDepth", "pixelDepth", "isExtended"
  ]) {
    const action = `read-${hyphenate(property)}`;
    wrapAccessor(
      globalThis.Screen?.prototype,
      property,
      () => emit("screen-characteristics", "fingerprinting", "Screen", action),
      undefined,
      (value) => shieldScalar("screen-characteristics", "Screen", action, value)
    );
  }
  for (const property of ["type", "angle"]) {
    wrapAccessor(globalThis.ScreenOrientation?.prototype, property, () => {
      emit("screen-characteristics", "fingerprinting", "ScreenOrientation", `read-${property}`);
    });
  }
  wrapAccessor(
    globalThis.Window?.prototype,
    "devicePixelRatio",
    () => emit("screen-characteristics", "fingerprinting", "Screen", "read-device-pixel-ratio"),
    undefined,
    (value) => shieldScalar("screen-characteristics", "Screen", "read-device-pixel-ratio", value)
  );

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
  wrapMethod(gpuPrototype, "requestAdapter", (args) => {
    if (args.length > 0) args[0] = normalizeGpuAdapterOptions(args[0]);
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
      configureShieldRules(event.detail.shieldRules);
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
