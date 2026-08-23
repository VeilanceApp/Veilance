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
  return cleanText(value, 253)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^\*\./, "")
    .split(/[/?#]/, 1)[0]
    .replace(/:\d+$/, "")
    .replace(/^\.+|\.+$/g, "");
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

export function validateCustomIndicator(input, sourceName = "Imported indicator") {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${sourceName}: each indicator must be a JSON object`);
  }

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
    match: { mode, signals, hosts }
  };
}

export function parseIndicatorDocuments(documents) {
  if (!Array.isArray(documents) || !documents.length) {
    throw new Error("Choose a folder containing at least one JSON indicator file");
  }
  const imported = [];
  const errors = [];

  for (const document of documents.slice(0, MAX_CUSTOM_INDICATORS)) {
    const sourceName = cleanText(document?.sourceName || "indicator.json", 160);
    const text = typeof document?.text === "string" ? document.text : "";
    if (!text || text.length > 262144) {
      errors.push(`${sourceName}: file is empty or larger than 256 KB`);
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.indicators) ? parsed.indicators : [parsed];
      for (let index = 0; index < values.length; index += 1) {
        if (imported.length >= MAX_CUSTOM_INDICATORS) break;
        imported.push(validateCustomIndicator(values[index], values.length > 1 ? `${sourceName} #${index + 1}` : sourceName));
      }
    } catch (error) {
      errors.push(`${sourceName}: ${String(error?.message || error)}`);
    }
  }

  const unique = new Map(imported.map((indicator) => [indicator.id, indicator]));
  return { indicators: [...unique.values()], errors };
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

export function evaluateCustomIndicators(state, indicators, settings) {
  if (!state || !Array.isArray(indicators)) return [];
  const findings = [];

  for (const indicator of indicators) {
    if (!indicator?.id || !isIndicatorEnabled(settings, indicator.id)) continue;
    const signalCounts = indicator.match.signals.map((matcher) => matchingSignalCount(state, matcher));
    const signalMatches = signalCounts.map((count, index) => count >= indicator.match.signals[index].minCount);
    const matchedHosts = indicator.match.hosts.filter((suffix) =>
      Object.keys(state.network?.hosts || {}).some((host) => hostMatches(host, suffix))
    );

    const conditions = [];
    if (signalMatches.length) {
      conditions.push(indicator.match.mode === "all" ? signalMatches.every(Boolean) : signalMatches.some(Boolean));
    }
    if (indicator.match.hosts.length) conditions.push(matchedHosts.length > 0);
    const matched = indicator.match.mode === "all" ? conditions.every(Boolean) : conditions.some(Boolean);
    if (!matched) continue;

    const evidence = [];
    const totalSignals = signalCounts.reduce((sum, count) => sum + count, 0);
    if (totalSignals) evidence.push(`${totalSignals} matching signal event(s)`);
    if (matchedHosts.length) evidence.push(`${matchedHosts.length} matching host(s)`);
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
