export const BUILT_IN_INDICATORS = Object.freeze([
  {
    id: "network-requests",
    name: "Network requests",
    category: "Network",
    description: "Counts first-party and third-party HTTP(S) requests and the hosts they contact.",
    defaultEnabled: true
  },
  {
    id: "known-trackers",
    name: "Known tracker services",
    category: "Network",
    description: "Matches contacted hosts against Veilance's local analytics and advertising catalog.",
    defaultEnabled: true,
    dependsOn: "network-requests"
  },
  {
    id: "security-headers",
    name: "Security headers",
    category: "Page",
    description: "Records whether selected top-level response security headers are present.",
    defaultEnabled: true
  },
  {
    id: "page-structure",
    name: "Page structure",
    category: "Page",
    description: "Counts scripts, embedded frames, secure-context state, and service-worker control.",
    defaultEnabled: true
  },
  {
    id: "browser-storage",
    name: "Browser storage",
    category: "Storage",
    description: "Observes storage API use and counts storage containers without reading keys or values.",
    defaultEnabled: true
  },
  {
    id: "cookie-access",
    name: "Cookie and storage access",
    category: "Storage",
    description: "Detects script-visible cookie reads or writes and Storage Access API requests without recording cookie names or values.",
    defaultEnabled: true
  },
  {
    id: "canvas",
    name: "Canvas readback",
    category: "Fingerprinting",
    description: "Detects canvas pixel reads and exports that may contribute to a fingerprint.",
    defaultEnabled: true
  },
  {
    id: "webgl",
    name: "WebGL identity",
    category: "Fingerprinting",
    description: "Detects renderer queries and WebGL pixel reads.",
    defaultEnabled: true
  },
  {
    id: "audio",
    name: "Audio fingerprinting",
    category: "Fingerprinting",
    description: "Detects offline audio rendering, oscillator creation, and generated-buffer reads.",
    defaultEnabled: true
  },
  {
    id: "navigator-characteristics",
    name: "Navigator characteristics",
    category: "Fingerprinting",
    description: "Detects reads of browser, platform, memory, CPU, touch, language, plugin, and high-entropy client-hint characteristics without retaining their values.",
    defaultEnabled: true
  },
  {
    id: "screen-characteristics",
    name: "Screen characteristics",
    category: "Fingerprinting",
    description: "Detects reads of screen geometry, color depth, orientation, and device-pixel ratio without retaining the measurements.",
    defaultEnabled: true
  },
  {
    id: "locale-timezone",
    name: "Locale and time zone",
    category: "Fingerprinting",
    description: "Detects locale-resolution and time-zone-offset calls without retaining the resolved locale or time zone.",
    defaultEnabled: true
  },
  {
    id: "font-probing",
    name: "Font probing",
    category: "Fingerprinting",
    description: "Detects font availability checks, font loading probes, and canvas text measurement without retaining text or font names.",
    defaultEnabled: true
  },
  {
    id: "css-media-queries",
    name: "CSS media and preference queries",
    category: "Fingerprinting",
    description: "Detects JavaScript media queries for display capabilities and user preferences while retaining only a coarse feature name.",
    defaultEnabled: true
  },
  {
    id: "performance-timing",
    name: "Performance timing",
    category: "Fingerprinting",
    description: "Detects reads and observers for navigation, resource, paint, and other browser timing entries.",
    defaultEnabled: true
  },
  {
    id: "webgpu",
    name: "WebGPU identity",
    category: "Fingerprinting",
    description: "Detects WebGPU adapter, device, format, and adapter-information requests that can expose graphics capabilities.",
    defaultEnabled: true
  },
  {
    id: "network-information",
    name: "Network characteristics",
    category: "Fingerprinting",
    description: "Detects reads of connection type, estimated speed, latency, and data-saver state without retaining their values.",
    defaultEnabled: true
  },
  {
    id: "media-capabilities",
    name: "Media capabilities and DRM",
    category: "Fingerprinting",
    description: "Detects media decode/encode capability probes and protected-media key-system checks.",
    defaultEnabled: true
  },
  {
    id: "webrtc",
    name: "WebRTC activity",
    category: "Network",
    description: "Observes peer-connection offers, data channels, and statistics access.",
    defaultEnabled: true
  },
  {
    id: "media-devices",
    name: "Camera and microphone",
    category: "Sensitive APIs",
    description: "Detects device enumeration and camera or microphone access requests.",
    defaultEnabled: true
  },
  {
    id: "geolocation",
    name: "Geolocation",
    category: "Sensitive APIs",
    description: "Detects location requests without recording coordinates.",
    defaultEnabled: true
  },
  {
    id: "clipboard",
    name: "Clipboard",
    category: "Sensitive APIs",
    description: "Detects clipboard reads and writes without reading clipboard contents.",
    defaultEnabled: true
  },
  {
    id: "permission-queries",
    name: "Permission queries",
    category: "Sensitive APIs",
    description: "Records which browser permission names a page queries.",
    defaultEnabled: true
  },
  {
    id: "connected-devices",
    name: "Connected devices and peripherals",
    category: "Sensitive APIs",
    description: "Detects Bluetooth, USB, HID, serial, MIDI, and gamepad enumeration or access requests without retaining device details.",
    defaultEnabled: true
  },
  {
    id: "device-sensors",
    name: "Motion, orientation, and sensors",
    category: "Sensitive APIs",
    description: "Detects motion or orientation listeners, sensor starts, and sensor permission requests without retaining readings.",
    defaultEnabled: true
  },
  {
    id: "credential-management",
    name: "Credentials and authenticators",
    category: "Sensitive APIs",
    description: "Detects Credential Management and WebAuthn availability or credential operations without retaining credentials or challenge data.",
    defaultEnabled: true
  },
  {
    id: "file-system-access",
    name: "Local file-system access",
    category: "Sensitive APIs",
    description: "Detects file and directory picker, permission, read-handle, and writable-handle operations without retaining file names or contents.",
    defaultEnabled: true
  },
  {
    id: "speech",
    name: "Speech and installed voices",
    category: "Sensitive APIs",
    description: "Detects installed-voice enumeration and speech-recognition starts without retaining spoken text or voice details.",
    defaultEnabled: true
  },
  {
    id: "privacy-sandbox",
    name: "Advertising privacy APIs",
    category: "Advertising",
    description: "Detects Topics, Protected Audience, and Shared Storage API use without retaining returned interests or auction data.",
    defaultEnabled: true
  },
  {
    id: "notifications",
    name: "Notification permission",
    category: "Sensitive APIs",
    description: "Detects requests for notification permission.",
    defaultEnabled: true
  },
  {
    id: "battery",
    name: "Battery status",
    category: "Device",
    description: "Detects access to the browser battery-status API.",
    defaultEnabled: true
  },
  {
    id: "beacon",
    name: "Beacon transmissions",
    category: "Network",
    description: "Detects sendBeacon calls and retains only the destination host.",
    defaultEnabled: true
  },
  {
    id: "spa-navigation",
    name: "In-page navigation",
    category: "Page",
    description: "Observes History API navigation while retaining only the page origin.",
    defaultEnabled: true
  }
]);

const BUILT_IN_IDS = new Set(BUILT_IN_INDICATORS.map((indicator) => indicator.id));
const SEVERITIES = new Set(["low", "medium", "high"]);
const MATCH_MODES = new Set(["any", "all"]);
const MAX_CUSTOM_INDICATORS = 100;
const MAX_MANAGED_TRACKERS = 5000;
const MAX_MANAGED_DETECTIONS = 5000;
const MAX_VEILANCE_DOMAINS = 100;
const MAX_VEILANCE_FILTERS = 100;
const MAX_TRACKER_REPORT_ITEMS = 50;
const INDICATOR_INDEX_CACHE = new WeakMap();

const NETWORK_TYPE_ALIASES = new Map([
  ["document", "main_frame"],
  ["subdocument", "sub_frame"],
  ["script", "script"],
  ["stylesheet", "stylesheet"],
  ["image", "image"],
  ["font", "font"],
  ["media", "media"],
  ["object", "object"],
  ["xmlhttprequest", "xmlhttprequest"],
  ["xhr", "xmlhttprequest"],
  ["ping", "ping"],
  ["websocket", "websocket"],
  ["other", "other"]
]);

function cleanText(value, maximum) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function cleanId(value) {
  return cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function cleanHost(value) {
  const host = cleanText(value, 253)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^\*\./, "")
    .split(/[/?#]/, 1)[0]
    .replace(/:\d+$/, "")
    .replace(/^\.+|\.+$/g, "");
  if (
    !host ||
    host.includes("..") ||
    !/^[a-z0-9.-]+$/.test(host) ||
    host.split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))
  ) return "";
  return host;
}

function cleanWebsiteUrl(value, sourceName) {
  const text = String(value || "").trim().slice(0, 512);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
    return url.href.slice(0, 512);
  } catch {
    throw new Error(`${sourceName}: website_url must be a valid HTTP(S) URL`);
  }
}

function normalizeDomainOption(value) {
  const include = [];
  const exclude = [];
  for (const raw of String(value || "").split("|")) {
    const negated = raw.startsWith("~");
    const host = cleanHost(negated ? raw.slice(1) : raw);
    if (!host) return null;
    (negated ? exclude : include).push(host);
  }
  return {
    include: [...new Set(include)].slice(0, 30),
    exclude: [...new Set(exclude)].slice(0, 30)
  };
}

export function parseVeilanceNetworkFilter(value) {
  const raw = String(value || "").trim().slice(0, 512);
  if (!raw) return { supported: false, reason: "filter is empty" };
  if (raw.startsWith("@@")) {
    return { supported: false, reason: "exception filters are not supported" };
  }

  const separator = raw.indexOf("$");
  const pattern = separator >= 0 ? raw.slice(0, separator) : raw;
  const optionText = separator >= 0 ? raw.slice(separator + 1) : "";
  const hostMatch = /^\|\|([a-z0-9.-]+)(?:\^)?$/i.exec(pattern);
  if (!hostMatch) {
    return {
      supported: false,
      reason: "only host-anchored filters such as ||tracker.example^$3p are supported"
    };
  }

  const host = cleanHost(hostMatch[1]);
  if (!host) return { supported: false, reason: "filter hostname is invalid" };

  let thirdParty = null;
  const includeTypes = [];
  const excludeTypes = [];
  let includePageHosts = [];
  let excludePageHosts = [];

  for (const rawOption of optionText.split(",").map((item) => item.trim()).filter(Boolean)) {
    const option = rawOption.toLowerCase();
    if (option === "3p" || option === "third-party") {
      thirdParty = true;
      continue;
    }
    if (option === "1p" || option === "first-party" || option === "~3p" || option === "~third-party") {
      thirdParty = false;
      continue;
    }
    if (option.startsWith("domain=")) {
      const domains = normalizeDomainOption(option.slice("domain=".length));
      if (!domains) return { supported: false, reason: `invalid domain option: ${rawOption}` };
      includePageHosts = domains.include;
      excludePageHosts = domains.exclude;
      continue;
    }

    const negated = option.startsWith("~");
    const type = NETWORK_TYPE_ALIASES.get(negated ? option.slice(1) : option);
    if (type) {
      (negated ? excludeTypes : includeTypes).push(type);
      continue;
    }
    return { supported: false, reason: `unsupported filter option: ${rawOption}` };
  }

  return {
    supported: true,
    rule: {
      host,
      thirdParty,
      includeTypes: [...new Set(includeTypes)],
      excludeTypes: [...new Set(excludeTypes)],
      includePageHosts,
      excludePageHosts
    }
  };
}

function normalizeSignalMatcher(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const matcher = {
    indicatorId: cleanId(value.indicatorId),
    kind: cleanText(value.kind, 48),
    api: cleanText(value.api, 80),
    action: cleanText(value.action, 80),
    minCount: Number.isFinite(value.minCount)
      ? Math.max(1, Math.min(100000, Math.floor(value.minCount)))
      : 1
  };
  if (!matcher.indicatorId && !matcher.kind && !matcher.api && !matcher.action) return null;
  return matcher;
}

export function defaultIndicatorSettings(customIndicators = []) {
  const settings = Object.fromEntries(
    BUILT_IN_INDICATORS.map((indicator) => [indicator.id, indicator.defaultEnabled !== false])
  );
  for (const indicator of customIndicators) {
    if (indicator?.id) settings[indicator.id] = indicator.defaultEnabled !== false;
  }
  return settings;
}

export function mergeIndicatorSettings(stored, customIndicators = []) {
  const settings = defaultIndicatorSettings(customIndicators);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return settings;
  for (const id of Object.keys(settings)) {
    if (typeof stored[id] === "boolean") settings[id] = stored[id];
  }
  return settings;
}

export function isIndicatorEnabled(settings, id) {
  return settings?.[id] !== false;
}

function isVeilanceTrackerIndicator(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.match) return false;
  const format = String(input.format || input.type || "").toLowerCase();
  return (
    format === "veilance-json" ||
    Array.isArray(input.domains) ||
    Array.isArray(input.filters)
  );
}

export function validateVeilanceTrackerIndicator(input, sourceName = "Imported Veilance tracker") {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${sourceName}: each Veilance tracker must be a JSON object`);
  }
  const format = String(input.format || input.type || "").trim().toLowerCase();
  if (format && format !== "veilance-json") {
    throw new Error(`${sourceName}: format must be \"veilance-json\"`);
  }
  if (input.domains !== undefined && !Array.isArray(input.domains)) {
    throw new Error(`${sourceName}: domains must be a JSON array of hostnames`);
  }
  if (input.filters !== undefined && !Array.isArray(input.filters)) {
    throw new Error(`${sourceName}: filters must be a JSON array of filter strings`);
  }

  const name = cleanText(input.name, 100);
  if (!name) throw new Error(`${sourceName}: Veilance tracker name is required`);
  const organization = cleanText(input.organization, 100);
  const rawId = cleanId(input.id || organization || name);
  if (!rawId) throw new Error(`${sourceName}: Veilance tracker id or organization is required`);
  const id = rawId.startsWith("custom.") ? rawId : `custom.${rawId}`;

  const category = cleanText(input.category || "Advertising", 60);
  const severity = cleanText(input.severity || "low", 16).toLowerCase();
  if (!SEVERITIES.has(severity)) throw new Error(`${sourceName}: severity must be low, medium, or high`);

  const importWarnings = [];
  const inputDomains = Array.isArray(input.domains) ? input.domains : [];
  const rawDomains = inputDomains.slice(0, MAX_VEILANCE_DOMAINS);
  if (inputDomains.length > MAX_VEILANCE_DOMAINS) {
    importWarnings.push(`only the first ${MAX_VEILANCE_DOMAINS} domains were loaded`);
  }
  const normalizedDomains = rawDomains.map(cleanHost);
  const hosts = [...new Set(normalizedDomains.filter(Boolean))];
  const invalidDomainCount = normalizedDomains.filter((host) => !host).length;

  const inputFilters = Array.isArray(input.filters) ? input.filters : [];
  const rawFilters = inputFilters.slice(0, MAX_VEILANCE_FILTERS);
  if (inputFilters.length > MAX_VEILANCE_FILTERS) {
    importWarnings.push(`only the first ${MAX_VEILANCE_FILTERS} filters were loaded`);
  }
  const networkFilterMap = new Map();
  let supportedFilterCount = 0;
  for (let index = 0; index < rawFilters.length; index += 1) {
    const parsed = parseVeilanceNetworkFilter(rawFilters[index]);
    if (!parsed.supported) {
      importWarnings.push(`filter #${index + 1} skipped: ${parsed.reason}`);
      continue;
    }
    supportedFilterCount += 1;
    networkFilterMap.set(JSON.stringify(parsed.rule), parsed.rule);
  }
  if (invalidDomainCount) {
    importWarnings.push(`${invalidDomainCount} invalid domain entr${invalidDomainCount === 1 ? "y was" : "ies were"} skipped`);
  }
  const networkFilters = [...networkFilterMap.values()];
  if (!hosts.length && !networkFilters.length) {
    const detail = importWarnings[0] ? ` First issue: ${importWarnings[0]}.` : "";
    throw new Error(`${sourceName}: Veilance tracker needs at least one valid domain or supported filter.${detail}`);
  }

  const websiteUrl = cleanWebsiteUrl(input.website_url ?? input.websiteUrl, sourceName);
  const description = cleanText(
    input.description || `Detects network requests associated with ${name}${organization ? ` (${organization})` : ""}.`,
    320
  );

  return {
    id,
    name,
    category,
    description,
    severity,
    defaultEnabled: input.defaultEnabled !== false,
    sourceName: cleanText(sourceName, 160),
    sourceFormat: "veilance-json",
    dependsOn: "network-requests",
    organization,
    websiteUrl,
    importWarnings: importWarnings.slice(0, 10),
    veilance: {
      domainCount: inputDomains.length,
      filterCount: inputFilters.length,
      supportedFilterCount,
      skippedFilterCount: inputFilters.length - supportedFilterCount
    },
    match: {
      mode: "any",
      signals: [],
      hosts,
      networkFilters
    }
  };
}

export function validateCustomIndicator(input, sourceName = "Imported indicator") {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${sourceName}: each indicator must be a JSON object`);
  }
  if (isVeilanceTrackerIndicator(input)) return validateVeilanceTrackerIndicator(input, sourceName);

  const rawId = cleanId(input.id || input.name);
  if (!rawId) throw new Error(`${sourceName}: indicator id is required`);
  const id = rawId.startsWith("custom.") ? rawId : `custom.${rawId}`;
  if (BUILT_IN_IDS.has(id)) throw new Error(`${sourceName}: indicator id conflicts with a built-in indicator`);

  const name = cleanText(input.name, 100);
  if (!name) throw new Error(`${sourceName}: indicator name is required`);
  const description = cleanText(input.description, 320);
  if (!description) throw new Error(`${sourceName}: indicator description is required`);
  const severity = cleanText(input.severity || "low", 16).toLowerCase();
  if (!SEVERITIES.has(severity)) throw new Error(`${sourceName}: severity must be low, medium, or high`);

  const match = input.match;
  if (!match || typeof match !== "object" || Array.isArray(match)) {
    throw new Error(`${sourceName}: match must be an object`);
  }

  let rawSignals = Array.isArray(match.signals) ? match.signals : [];
  if (!rawSignals.length && (match.indicatorId || match.kind || match.api || match.action)) {
    rawSignals = [match];
  }
  const signals = rawSignals.map(normalizeSignalMatcher).filter(Boolean).slice(0, 20);

  let rawHosts = Array.isArray(match.hosts) ? match.hosts : [];
  if (!rawHosts.length && match.hostSuffix) rawHosts = [match.hostSuffix];
  const hosts = [...new Set(rawHosts.map(cleanHost).filter(Boolean))].slice(0, 50);
  if (!signals.length && !hosts.length) {
    throw new Error(`${sourceName}: match needs at least one signal or host rule`);
  }

  const mode = MATCH_MODES.has(String(match.mode || "any").toLowerCase())
    ? String(match.mode || "any").toLowerCase()
    : "any";

  return {
    id,
    name,
    category: cleanText(input.category || "Imported", 60),
    description,
    severity,
    defaultEnabled: input.defaultEnabled !== false,
    sourceName: cleanText(sourceName, 160),
    sourceFormat: "veilance-json",
    importWarnings: [],
    match: { mode, signals, hosts, networkFilters: [] }
  };
}

export function parseIndicatorDocuments(documents) {
  if (!Array.isArray(documents) || !documents.length) {
    throw new Error("Choose a folder containing at least one JSON indicator file");
  }
  const imported = [];
  const errors = [];
  const warnings = [];

  for (const document of documents.slice(0, MAX_CUSTOM_INDICATORS)) {
    const sourceName = cleanText(document?.sourceName || "indicator.json", 160);
    const text = typeof document?.text === "string" ? document.text : "";
    if (!text || text.length > 262144) {
      errors.push(`${sourceName}: file is empty or larger than 256 KB`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      errors.push(`${sourceName}: ${String(error?.message || error)}`);
      continue;
    }

    const values = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.indicators)
        ? parsed.indicators
        : Array.isArray(parsed?.trackers)
          ? parsed.trackers
          : Array.isArray(parsed?.rules)
            ? parsed.rules
            : [parsed];
    for (let index = 0; index < values.length; index += 1) {
      if (imported.length >= MAX_CUSTOM_INDICATORS) break;
      const itemSource = values.length > 1 ? `${sourceName} #${index + 1}` : sourceName;
      try {
        const indicator = validateCustomIndicator(values[index], itemSource);
        imported.push(indicator);
        for (const warning of indicator.importWarnings || []) {
          warnings.push(`${itemSource}: ${warning}`);
        }
      } catch (error) {
        const message = String(error?.message || error);
        errors.push(message.startsWith(`${itemSource}:`) ? message : `${itemSource}: ${message}`);
      }
    }
  }

  const unique = new Map(imported.map((indicator) => [indicator.id, indicator]));
  return { indicators: [...unique.values()], errors, warnings };
}

function trackerSourceHash(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of String(value || "")) {
    const code = character.codePointAt(0);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

export function managedTrackerId(sourceName, itemIndex = 0) {
  const normalized = String(sourceName || "tracker")
    .replaceAll("\\", "/")
    .replace(/^.*\/veilance-json-trackers\//, "")
    .replace(/\.json$/i, "");
  const identity = itemIndex ? `${normalized}#${itemIndex + 1}` : normalized;
  const base = cleanId(identity) || "tracker";
  return `tracker.${base.slice(0, 54)}-${trackerSourceHash(identity)}`;
}

export function managedDetectionId(sourceName, itemIndex = 0) {
  const normalized = String(sourceName || "detection")
    .replaceAll("\\", "/")
    .replace(/^.*\/veilance-json-detections\//, "")
    .replace(/\.json$/i, "");
  const identity = itemIndex ? `${normalized}#${itemIndex + 1}` : normalized;
  const base = cleanId(identity) || "detection";
  return `detection.${base.slice(0, 50)}-${trackerSourceHash(identity)}`;
}

function managedTrackerValues(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.trackers)) return value.trackers;
  if (Array.isArray(value?.indicators)) return value.indicators;
  if (Array.isArray(value?.rules)) return value.rules;
  return [value];
}

function parseManagedTrackerEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error("The Veilance tracker database did not contain any JSON records");
  }

  const indicators = [];
  const ids = new Set();
  const errors = [];
  const warnings = [];
  let errorCount = 0;
  let warningCount = 0;
  let sourceCount = 0;

  const report = (collection, message) => {
    if (collection.length < MAX_TRACKER_REPORT_ITEMS) collection.push(message);
  };

  for (const entry of entries) {
    const sourceName = cleanText(entry?.sourceName || "tracker.json", 160);
    for (const [itemIndex, value] of managedTrackerValues(entry?.value).entries()) {
      if (sourceCount >= MAX_MANAGED_TRACKERS) {
        errorCount += 1;
        report(errors, `Only the first ${MAX_MANAGED_TRACKERS} tracker records were loaded`);
        break;
      }
      sourceCount += 1;
      const itemSource = itemIndex ? `${sourceName} #${itemIndex + 1}` : sourceName;
      try {
        const indicator = validateVeilanceTrackerIndicator(value, itemSource);
        indicator.id = managedTrackerId(sourceName, itemIndex);
        indicator.defaultEnabled = true;
        indicator.managed = true;
        if (ids.has(indicator.id)) {
          throw new Error(`${itemSource}: generated a duplicate managed tracker id`);
        }
        ids.add(indicator.id);
        indicators.push(indicator);
        for (const warning of indicator.importWarnings || []) {
          warningCount += 1;
          report(warnings, `${itemSource}: ${warning}`);
        }
      } catch (error) {
        errorCount += 1;
        const message = String(error?.message || error);
        report(errors, message.startsWith(`${itemSource}:`) ? message : `${itemSource}: ${message}`);
      }
    }
    if (sourceCount >= MAX_MANAGED_TRACKERS) break;
  }

  return {
    indicators,
    sourceCount,
    skippedCount: Math.max(0, sourceCount - indicators.length),
    errorCount,
    warningCount,
    errors,
    warnings
  };
}

export function parseManagedTrackerRecords(records) {
  return parseManagedTrackerEntries((records || []).slice(0, MAX_MANAGED_TRACKERS).map((record) => ({
    sourceName: record?.sourceName,
    value: record?.tracker ?? record?.value ?? record
  })));
}

export function parseManagedTrackerDocuments(documents) {
  if (!Array.isArray(documents) || !documents.length) {
    throw new Error("The Veilance tracker archive did not contain any tracker JSON files");
  }
  const entries = [];
  for (const document of documents.slice(0, MAX_MANAGED_TRACKERS)) {
    const sourceName = cleanText(document?.sourceName || "tracker.json", 160);
    const text = typeof document?.text === "string" ? document.text : "";
    if (!text || text.length > 262144) {
      entries.push({ sourceName, value: null });
      continue;
    }
    try {
      entries.push({ sourceName, value: JSON.parse(text) });
    } catch (error) {
      entries.push({
        sourceName,
        value: {
          format: "invalid-json",
          name: `Invalid JSON: ${String(error?.message || error)}`
        }
      });
    }
  }
  return parseManagedTrackerEntries(entries);
}

function managedDetectionValues(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.detections)) return value.detections;
  if (Array.isArray(value?.indicators)) return value.indicators;
  if (Array.isArray(value?.rules)) return value.rules;
  return [value];
}

export function parseManagedDetectionDocuments(documents) {
  if (!Array.isArray(documents) || !documents.length) {
    throw new Error("The Veilance detection archive did not contain any detection JSON files");
  }

  const indicators = [];
  const ids = new Set();
  const errors = [];
  const warnings = [];
  let errorCount = 0;
  let warningCount = 0;
  let sourceCount = 0;

  const report = (collection, message) => {
    if (collection.length < MAX_TRACKER_REPORT_ITEMS) collection.push(message);
  };

  for (const document of documents.slice(0, MAX_MANAGED_DETECTIONS)) {
    const sourceName = cleanText(document?.sourceName || "detection.json", 160);
    const text = typeof document?.text === "string" ? document.text : "";
    let value = null;
    if (!text || text.length > 262144) {
      errorCount += 1;
      sourceCount += 1;
      report(errors, `${sourceName}: file is empty or larger than 256 KB`);
      continue;
    }
    try {
      value = JSON.parse(text);
    } catch (error) {
      errorCount += 1;
      sourceCount += 1;
      report(errors, `${sourceName}: ${String(error?.message || error)}`);
      continue;
    }

    for (const [itemIndex, item] of managedDetectionValues(value).entries()) {
      if (sourceCount >= MAX_MANAGED_DETECTIONS) {
        errorCount += 1;
        report(errors, `Only the first ${MAX_MANAGED_DETECTIONS} detection records were loaded`);
        break;
      }
      sourceCount += 1;
      const itemSource = itemIndex ? `${sourceName} #${itemIndex + 1}` : sourceName;
      try {
        if (isVeilanceTrackerIndicator(item)) {
          throw new Error(`${itemSource}: tracker records are not valid managed detections`);
        }
        const indicator = validateCustomIndicator(item, itemSource);
        indicator.id = managedDetectionId(sourceName, itemIndex);
        indicator.defaultEnabled = true;
        indicator.managed = true;
        indicator.managedSource = "detection-database";
        if (ids.has(indicator.id)) {
          throw new Error(`${itemSource}: generated a duplicate managed detection id`);
        }
        ids.add(indicator.id);
        indicators.push(indicator);
        for (const warning of indicator.importWarnings || []) {
          warningCount += 1;
          report(warnings, `${itemSource}: ${warning}`);
        }
      } catch (error) {
        errorCount += 1;
        const message = String(error?.message || error);
        report(errors, message.startsWith(`${itemSource}:`) ? message : `${itemSource}: ${message}`);
      }
    }
    if (sourceCount >= MAX_MANAGED_DETECTIONS) break;
  }

  return {
    indicators,
    sourceCount,
    skippedCount: Math.max(0, sourceCount - indicators.length),
    errorCount,
    warningCount,
    errors,
    warnings
  };
}

function matchingSignalCount(state, matcher) {
  let count = 0;
  for (const signal of Object.values(state?.signals || {})) {
    if (matcher.indicatorId && signal.indicatorId !== matcher.indicatorId) continue;
    if (matcher.kind && signal.kind !== matcher.kind) continue;
    if (matcher.api && signal.api !== matcher.api) continue;
    if (matcher.action && signal.action !== matcher.action) continue;
    count += Number(signal.count || 0);
  }
  return count;
}

function hostMatches(host, suffix) {
  return host === suffix || host.endsWith(`.${suffix}`);
}

function indexIndicators(indicators) {
  let index = INDICATOR_INDEX_CACHE.get(indicators);
  if (index) return index;
  const byHost = new Map();
  const always = new Set();

  for (const indicator of indicators) {
    const match = indicator?.match && typeof indicator.match === "object" ? indicator.match : {};
    const signals = Array.isArray(match.signals) ? match.signals : [];
    const hosts = Array.isArray(match.hosts) ? match.hosts : [];
    const networkFilters = Array.isArray(match.networkFilters) ? match.networkFilters : [];
    if (signals.length || (!hosts.length && !networkFilters.length)) always.add(indicator);
    for (const host of [
      ...hosts,
      ...networkFilters.map((rule) => rule?.host).filter(Boolean)
    ]) {
      const values = byHost.get(host) || [];
      values.push(indicator);
      byHost.set(host, values);
    }
  }

  index = { byHost, always: [...always] };
  INDICATOR_INDEX_CACHE.set(indicators, index);
  return index;
}

function candidateIndicators(state, indicators) {
  const index = indexIndicators(indicators);
  const candidates = new Set(index.always);
  for (const host of Object.keys(state?.network?.hosts || {})) {
    const labels = host.split(".");
    for (let offset = 0; offset < labels.length; offset += 1) {
      const indexed = index.byHost.get(labels.slice(offset).join("."));
      if (indexed) for (const indicator of indexed) candidates.add(indicator);
    }
  }
  return candidates;
}

function matchingNetworkHosts(state, rule) {
  if (!rule?.host) return [];
  const pageHost = String(state?.hostname || "").toLowerCase();
  const includePageHosts = Array.isArray(rule.includePageHosts) ? rule.includePageHosts : [];
  const excludePageHosts = Array.isArray(rule.excludePageHosts) ? rule.excludePageHosts : [];
  if (includePageHosts.length && !includePageHosts.some((host) => hostMatches(pageHost, host))) return [];
  if (excludePageHosts.some((host) => hostMatches(pageHost, host))) return [];

  const includeTypes = new Set(Array.isArray(rule.includeTypes) ? rule.includeTypes : []);
  const excludeTypes = new Set(Array.isArray(rule.excludeTypes) ? rule.excludeTypes : []);
  const matches = [];
  for (const entry of Object.values(state?.network?.hosts || {})) {
    if (!entry?.host || !hostMatches(entry.host, rule.host)) continue;
    if (typeof rule.thirdParty === "boolean" && Boolean(entry.thirdParty) !== rule.thirdParty) continue;
    const observedTypes = Object.keys(entry.types || {});
    if (includeTypes.size && !observedTypes.some((type) => includeTypes.has(type))) continue;
    if (excludeTypes.size && !observedTypes.some((type) => !excludeTypes.has(type))) continue;
    matches.push(entry.host);
  }
  return matches;
}

export function evaluateCustomIndicators(state, indicators, settings) {
  if (!state || !Array.isArray(indicators)) return [];
  const findings = [];

  for (const indicator of candidateIndicators(state, indicators)) {
    if (!indicator?.id || !isIndicatorEnabled(settings, indicator.id)) continue;
    const match = indicator.match && typeof indicator.match === "object" ? indicator.match : {};
    const mode = match.mode === "all" ? "all" : "any";
    const signals = Array.isArray(match.signals) ? match.signals : [];
    const hosts = Array.isArray(match.hosts) ? match.hosts : [];
    const networkFilters = Array.isArray(match.networkFilters) ? match.networkFilters : [];
    const signalCounts = signals.map((matcher) => matchingSignalCount(state, matcher));
    const signalMatches = signalCounts.map((count, index) => count >= signals[index].minCount);
    const matchedHosts = hosts.filter((suffix) =>
      Object.keys(state.network?.hosts || {}).some((host) => hostMatches(host, suffix))
    );
    const networkFilterMatches = networkFilters.map((rule) => matchingNetworkHosts(state, rule));
    const matchedNetworkFilterCount = networkFilterMatches.filter((hostsForRule) => hostsForRule.length).length;

    const conditions = [];
    if (signalMatches.length) {
      conditions.push(mode === "all" ? signalMatches.every(Boolean) : signalMatches.some(Boolean));
    }
    if (hosts.length) conditions.push(matchedHosts.length > 0);
    if (networkFilters.length) {
      conditions.push(mode === "all"
        ? matchedNetworkFilterCount === networkFilters.length
        : matchedNetworkFilterCount > 0);
    }
    const matched = mode === "all" ? conditions.length > 0 && conditions.every(Boolean) : conditions.some(Boolean);
    if (!matched) continue;

    const evidence = [];
    const totalSignals = signalCounts.reduce((sum, count) => sum + count, 0);
    if (totalSignals) evidence.push(`${totalSignals} matching signal event(s)`);
    if (matchedHosts.length) evidence.push(`${matchedHosts.length} matching host(s)`);
    if (matchedNetworkFilterCount) evidence.push(`${matchedNetworkFilterCount} matching Veilance network filter(s)`);
    findings.push({
      id: indicator.id,
      indicatorId: indicator.id,
      severity: indicator.severity,
      title: indicator.name,
      description: indicator.description,
      evidence: evidence.join(", ") || "Imported rule matched"
    });
  }

  return findings;
}

export function indicatorExists(id, customIndicators = []) {
  return BUILT_IN_IDS.has(id) || customIndicators.some((indicator) => indicator?.id === id);
}
