export const TELEMETRY_SCHEMA_VERSION = "veilance.telemetry.v0.2";

const MAX_HOSTS = 120;
const MAX_SIGNALS = 100;
const MAX_RESOURCE_TYPES = 32;

const MULTIPART_PUBLIC_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk",
  "com.au", "net.au", "org.au",
  "co.nz", "com.br", "com.mx", "co.jp", "co.kr", "co.in",
  "com.sg", "com.tr", "com.cn", "com.tw", "com.hk", "co.za"
]);

const TRACKER_RULES = [
  ["google-analytics.com", "Google Analytics", "analytics"],
  ["googletagmanager.com", "Google Tag Manager", "tag-manager"],
  ["doubleclick.net", "Google DoubleClick", "advertising"],
  ["googleadservices.com", "Google Ads", "advertising"],
  ["connect.facebook.net", "Meta Pixel", "analytics"],
  ["facebook.com", "Meta", "social"],
  ["hotjar.com", "Hotjar", "session-analytics"],
  ["clarity.ms", "Microsoft Clarity", "session-analytics"],
  ["segment.com", "Twilio Segment", "analytics"],
  ["segment.io", "Twilio Segment", "analytics"],
  ["mixpanel.com", "Mixpanel", "analytics"],
  ["amplitude.com", "Amplitude", "analytics"],
  ["fullstory.com", "FullStory", "session-analytics"],
  ["mouseflow.com", "Mouseflow", "session-analytics"],
  ["scorecardresearch.com", "Comscore", "analytics"],
  ["criteo.com", "Criteo", "advertising"],
  ["taboola.com", "Taboola", "advertising"],
  ["outbrain.com", "Outbrain", "advertising"],
  ["adsrvr.org", "The Trade Desk", "advertising"],
  ["bat.bing.com", "Microsoft Advertising", "advertising"],
  ["quantserve.com", "Quantcast", "analytics"],
  ["chartbeat.com", "Chartbeat", "analytics"],
  ["branch.io", "Branch", "attribution"],
  ["appsflyer.com", "AppsFlyer", "attribution"],
  ["intercom.io", "Intercom", "customer-messaging"]
];

const FORBIDDEN_DETAIL_KEYS = new Set([
  "value", "text", "body", "payload", "cookie", "cookies", "authorization",
  "token", "password", "query", "path", "pathname", "search", "hash", "title",
  "html", "content", "clipboard", "form", "input", "database", "key", "keys",
  "latitude", "longitude", "lat", "lon", "lng", "accuracy", "altitude",
  "altitudeaccuracy", "heading", "speed"
]);

export function normalizeHostname(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

export function safePageIdentity(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return {
      origin: parsed.origin,
      hostname: normalizeHostname(parsed.hostname),
      protocol: parsed.protocol,
      port: parsed.port || null
    };
  } catch {
    return null;
  }
}

export function registrableDomain(hostname) {
  const host = normalizeHostname(hostname);
  if (!host || host === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    return host;
  }

  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;
  const suffix2 = labels.slice(-2).join(".");
  if (MULTIPART_PUBLIC_SUFFIXES.has(suffix2) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

export function isThirdParty(requestHost, pageHost) {
  const requestSite = registrableDomain(requestHost);
  const pageSite = registrableDomain(pageHost);
  return Boolean(requestSite && pageSite && requestSite !== pageSite);
}

export function classifyTrackerHost(hostname) {
  const host = normalizeHostname(hostname);
  for (const [domain, label, category] of TRACKER_RULES) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return { domain, label, category };
    }
  }
  return null;
}

export function createEmptyState(tabId, url, now = Date.now(), metadata = {}) {
  const page = safePageIdentity(url);
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    visitId: typeof metadata.visitId === "string" ? metadata.visitId : null,
    tabId,
    documentId: typeof metadata.documentId === "string" ? metadata.documentId : null,
    navigationId: typeof metadata.navigationId === "string" ? metadata.navigationId : null,
    origin: page?.origin ?? null,
    hostname: page?.hostname ?? null,
    protocol: page?.protocol ?? null,
    startedAt: now,
    updatedAt: now,
    loadCompletedAt: null,
    endedAt: null,
    active: true,
    network: {
      totalRequests: 0,
      firstPartyRequests: 0,
      thirdPartyRequests: 0,
      resourceTypes: {},
      hosts: {},
      trackers: {}
    },
    security: {
      statusCode: null,
      headers: {
        contentSecurityPolicy: false,
        strictTransportSecurity: false,
        permissionsPolicy: false,
        referrerPolicy: false,
        xFrameOptions: false,
        crossOriginOpenerPolicy: false,
        crossOriginResourcePolicy: false
      }
    },
    page: {
      secureContext: null,
      scriptCount: 0,
      thirdPartyScriptCount: 0,
      iframeCount: 0,
      thirdPartyIframeCount: 0,
      accessibleCookieCount: 0,
      localStorageKeyCount: 0,
      sessionStorageKeyCount: 0,
      indexedDbCount: null,
      cacheCount: null,
      serviceWorkerControlled: false
    },
    signals: {},
    droppedSignals: 0
  };
}

export function applyPageIdentity(state, url, now = Date.now()) {
  if (!state) return state;
  const page = safePageIdentity(url);
  if (!page) return state;
  state.origin = page.origin;
  state.hostname = page.hostname;
  state.protocol = page.protocol;
  state.updatedAt = Math.max(state.updatedAt || 0, now);
  return state;
}

export function completeVisit(state, now = Date.now()) {
  if (!state) return state;
  const endedAt = Math.max(state.updatedAt || 0, now);
  state.updatedAt = endedAt;
  state.endedAt = endedAt;
  state.active = false;
  return state;
}

export function markVisitLoaded(state, now = Date.now()) {
  if (!state) return state;
  state.loadCompletedAt = Math.max(state.startedAt || 0, now);
  state.updatedAt = Math.max(state.updatedAt || 0, now);
  return state;
}

export function shouldResetState(state, url) {
  const page = safePageIdentity(url);
  if (!page) return false;
  return !state || state.origin !== page.origin;
}

export function addNetworkRequest(state, details, now = Date.now(), options = {}) {
  if (!state || !details?.url) return state;
  let request;
  try {
    request = new URL(details.url);
  } catch {
    return state;
  }
  if (request.protocol !== "http:" && request.protocol !== "https:") return state;

  const host = normalizeHostname(request.hostname);
  if (!host) return state;
  const type = typeof details.type === "string" ? details.type : "other";
  const thirdParty = isThirdParty(host, state.hostname);

  state.network.totalRequests += 1;
  if (thirdParty) state.network.thirdPartyRequests += 1;
  else state.network.firstPartyRequests += 1;

  if (Object.keys(state.network.resourceTypes).length < MAX_RESOURCE_TYPES || state.network.resourceTypes[type]) {
    state.network.resourceTypes[type] = (state.network.resourceTypes[type] || 0) + 1;
  }

  if (Object.keys(state.network.hosts).length < MAX_HOSTS || state.network.hosts[host]) {
    const entry = state.network.hosts[host] || {
      host,
      thirdParty,
      count: 0,
      types: {}
    };
    entry.count += 1;
    if (Object.keys(entry.types).length < 16 || entry.types[type]) {
      entry.types[type] = (entry.types[type] || 0) + 1;
    }
    state.network.hosts[host] = entry;
  }

  const tracker = options.trackersEnabled === false ? null : classifyTrackerHost(host);
  if (tracker) {
    const key = tracker.domain;
    const entry = state.network.trackers[key] || { ...tracker, count: 0, hosts: [] };
    entry.count += 1;
    if (!entry.hosts.includes(host) && entry.hosts.length < 12) entry.hosts.push(host);
    state.network.trackers[key] = entry;
  }

  state.updatedAt = now;
  return state;
}

export function applyResponseHeaders(state, statusCode, responseHeaders = [], now = Date.now()) {
  if (!state) return state;
  state.security.statusCode = Number.isFinite(statusCode) ? statusCode : state.security.statusCode;
  const names = new Set(
    responseHeaders
      .map((header) => String(header?.name || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const map = state.security.headers;
  map.contentSecurityPolicy = names.has("content-security-policy");
  map.strictTransportSecurity = names.has("strict-transport-security");
  map.permissionsPolicy = names.has("permissions-policy");
  map.referrerPolicy = names.has("referrer-policy");
  map.xFrameOptions = names.has("x-frame-options");
  map.crossOriginOpenerPolicy = names.has("cross-origin-opener-policy");
  map.crossOriginResourcePolicy = names.has("cross-origin-resource-policy");
  state.updatedAt = now;
  return state;
}

function sanitizePrimitive(value) {
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 160);
  return null;
}

export function sanitizeEventDetail(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
  const clean = {};
  for (const [rawKey, value] of Object.entries(detail)) {
    const key = String(rawKey).slice(0, 64);
    if (!key || FORBIDDEN_DETAIL_KEYS.has(key.toLowerCase())) continue;
    const primitive = sanitizePrimitive(value);
    if (primitive !== null) clean[key] = primitive;
    if (Object.keys(clean).length >= 8) break;
  }
  return clean;
}

export function addPageSignal(state, event, now = Date.now()) {
  if (!state || !event || typeof event !== "object") return state;
  const kind = String(event.kind || "api-use").slice(0, 48);
  const api = String(event.api || "Unknown").slice(0, 80);
  const action = String(event.action || "used").slice(0, 80);
  const key = `${kind}:${api}:${action}`;

  if (!state.signals[key] && Object.keys(state.signals).length >= MAX_SIGNALS) {
    state.droppedSignals += 1;
    state.updatedAt = now;
    return state;
  }

  const entry = state.signals[key] || {
    indicatorId: typeof event.indicatorId === "string" ? event.indicatorId.slice(0, 80) : null,
    kind,
    api,
    action,
    count: 0,
    firstSeen: now,
    lastSeen: now,
    detail: {}
  };
  entry.count += 1;
  entry.lastSeen = now;
  if (!entry.indicatorId && typeof event.indicatorId === "string") {
    entry.indicatorId = event.indicatorId.slice(0, 80);
  }
  const cleanDetail = sanitizeEventDetail(event.detail);
  if (Object.keys(cleanDetail).length) entry.detail = cleanDetail;
  state.signals[key] = entry;
  state.updatedAt = now;
  return state;
}

export function applyPageSnapshot(state, snapshot, now = Date.now()) {
  if (!state || !snapshot || typeof snapshot !== "object") return state;
  const target = state.page;
  const numericFields = [
    "scriptCount", "thirdPartyScriptCount", "iframeCount", "thirdPartyIframeCount",
    "accessibleCookieCount", "localStorageKeyCount", "sessionStorageKeyCount",
    "indexedDbCount", "cacheCount"
  ];
  for (const field of numericFields) {
    const value = snapshot[field];
    if (value === null && (field === "indexedDbCount" || field === "cacheCount")) {
      target[field] = null;
    } else if (Number.isFinite(value) && value >= 0) {
      target[field] = Math.min(Math.floor(value), 100000);
    }
  }
  if (typeof snapshot.secureContext === "boolean") target.secureContext = snapshot.secureContext;
  if (typeof snapshot.serviceWorkerControlled === "boolean") {
    target.serviceWorkerControlled = snapshot.serviceWorkerControlled;
  }
  state.updatedAt = now;
  return state;
}

function signalCount(state, api, action) {
  let count = 0;
  for (const signal of Object.values(state?.signals || {})) {
    if (signal.api === api && signal.action === action) count += signal.count;
  }
  return count;
}

function hasSignal(state, api, action) {
  return signalCount(state, api, action) > 0;
}

export function buildFindings(state) {
  if (!state) return [];
  const findings = [];
  const push = (finding) => findings.push(finding);

  const offlineAudio = signalCount(state, "AudioContext", "offline-render");
  const audioReadback = signalCount(state, "AudioBuffer", "read-buffer");
  const oscillator = signalCount(state, "AudioContext", "create-oscillator");
  if (offlineAudio && (audioReadback || oscillator)) {
    push({
      id: "audio-fingerprint-pattern",
      severity: "medium",
      title: "Audio fingerprinting pattern",
      description: "The page rendered audio offline and accessed generated audio data. That pattern can contribute to a browser fingerprint, although legitimate audio processing can look similar.",
      evidence: `${offlineAudio} offline render event(s), ${audioReadback} buffer read(s)`
    });
  } else if (offlineAudio) {
    push({
      id: "offline-audio",
      severity: "low",
      title: "Offline audio processing",
      description: "The page used OfflineAudioContext. This is sometimes used in fingerprinting and is also used by legitimate audio applications.",
      evidence: `${offlineAudio} offline render event(s)`
    });
  }

  const canvasReadback = signalCount(state, "Canvas", "readback") + signalCount(state, "Canvas", "export");
  if (canvasReadback) {
    push({
      id: "canvas-readback",
      severity: "medium",
      title: "Canvas data read back",
      description: "The page read or exported rendered canvas pixels. This can be used for graphics, image processing, or browser fingerprint construction.",
      evidence: `${canvasReadback} canvas readback event(s)`
    });
  }

  const webglQueries = signalCount(state, "WebGL", "renderer-query") + signalCount(state, "WebGL", "read-pixels");
  if (webglQueries) {
    push({
      id: "webgl-fingerprint-signal",
      severity: "medium",
      title: "WebGL identity data accessed",
      description: "The page queried renderer information or read pixels from WebGL. Those values may help distinguish graphics hardware and browser configurations.",
      evidence: `${webglQueries} WebGL identity event(s)`
    });
  }

  const mediaEnumeration = signalCount(state, "MediaDevices", "enumerate-devices");
  if (mediaEnumeration) {
    push({
      id: "media-enumeration",
      severity: "low",
      title: "Media devices enumerated",
      description: "The page requested a list of available cameras, microphones, or audio outputs. Device labels normally remain restricted until permission is granted.",
      evidence: `${mediaEnumeration} enumeration request(s)`
    });
  }

  const userMedia = signalCount(state, "MediaDevices", "get-user-media");
  if (userMedia) {
    push({
      id: "media-capture",
      severity: "high",
      title: "Camera or microphone access requested",
      description: "The page requested access to media capture devices. The browser should still require user permission before access is granted.",
      evidence: `${userMedia} media request(s)`
    });
  }

  const geolocation = signalCount(state, "Geolocation", "get-position") + signalCount(state, "Geolocation", "watch-position");
  if (geolocation) {
    push({
      id: "geolocation",
      severity: "high",
      title: "Location access requested",
      description: "The page requested the browser's geolocation API. Veilance records the request, not the resulting coordinates.",
      evidence: `${geolocation} location request(s)`
    });
  }

  const clipboardReads = signalCount(state, "Clipboard", "read") + signalCount(state, "Clipboard", "read-text");
  if (clipboardReads) {
    push({
      id: "clipboard-read",
      severity: "high",
      title: "Clipboard read requested",
      description: "The page attempted to read from the clipboard. Veilance records only that the API was called and never reads or stores clipboard contents.",
      evidence: `${clipboardReads} clipboard read request(s)`
    });
  }

  const rtc = signalCount(state, "WebRTC", "create-offer") + signalCount(state, "WebRTC", "get-stats");
  if (rtc) {
    push({
      id: "webrtc",
      severity: "low",
      title: "WebRTC connection activity",
      description: "The page created or inspected a peer connection. WebRTC is common in calls and real-time apps, but it can expose additional network characteristics.",
      evidence: `${rtc} WebRTC event(s)`
    });
  }

  const storageWrites = signalCount(state, "Storage", "write") + signalCount(state, "IndexedDB", "open") + signalCount(state, "CacheStorage", "open");
  if (storageWrites) {
    push({
      id: "persistent-storage",
      severity: "low",
      title: "Persistent browser storage used",
      description: "The page wrote to browser storage. Veilance records counts and storage types, not keys or stored values.",
      evidence: `${storageWrites} storage event(s)`
    });
  }

  const trackerEntries = Object.values(state.network.trackers || {});
  if (trackerEntries.length) {
    const labels = trackerEntries.slice(0, 4).map((entry) => entry.label).join(", ");
    push({
      id: "known-tracker-infrastructure",
      severity: trackerEntries.length >= 4 ? "medium" : "low",
      title: "Known analytics or advertising infrastructure",
      description: `Requests matched ${trackerEntries.length} known service${trackerEntries.length === 1 ? "" : "s"}: ${labels}${trackerEntries.length > 4 ? ", and others" : ""}. A match identifies infrastructure, not intent.`,
      evidence: `${trackerEntries.reduce((sum, entry) => sum + entry.count, 0)} matched request(s)`
    });
  }

  const thirdPartyHosts = Object.values(state.network.hosts || {}).filter((entry) => entry.thirdParty).length;
  if (thirdPartyHosts >= 10) {
    push({
      id: "third-party-surface",
      severity: thirdPartyHosts >= 20 ? "medium" : "low",
      title: "Large third-party request surface",
      description: "The page contacted a relatively large number of third-party hosts. Some may be required for content delivery, payments, support, or analytics.",
      evidence: `${thirdPartyHosts} third-party host(s)`
    });
  }

  const severityOrder = { high: 0, medium: 1, low: 2, notice: 3 };
  return findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.title.localeCompare(b.title));
}

export function summarizeState(state, findingsOverride = null) {
  if (!state) {
    return {
      status: "unsupported",
      label: "Not available",
      findingCount: 0,
      signalCount: 0,
      thirdPartyHostCount: 0,
      trackerCount: 0
    };
  }
  const findings = Array.isArray(findingsOverride) ? findingsOverride : buildFindings(state);
  const signalCountTotal = Object.values(state.signals || {}).reduce((sum, signal) => sum + signal.count, 0);
  const thirdPartyHostCount = Object.values(state.network.hosts || {}).filter((entry) => entry.thirdParty).length;
  const high = findings.filter((item) => item.severity === "high").length;
  const medium = findings.filter((item) => item.severity === "medium").length;
  let status = "quiet";
  let label = "No notable signals";
  if (high) {
    status = "elevated";
    label = "Sensitive activity observed";
  } else if (medium) {
    status = "active";
    label = "Fingerprinting signals observed";
  } else if (findings.length) {
    status = "observed";
    label = "Privacy-relevant activity observed";
  }
  return {
    status,
    label,
    findingCount: findings.length,
    signalCount: signalCountTotal,
    thirdPartyHostCount,
    trackerCount: Object.keys(state.network.trackers || {}).length
  };
}

function sortedHostList(state) {
  return Object.values(state.network.hosts || {})
    .filter((entry) => entry.thirdParty)
    .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
    .slice(0, MAX_HOSTS)
    .map((entry) => ({
      host: entry.host,
      count: entry.count,
      resourceTypes: Object.entries(entry.types)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count })),
      tracker: classifyTrackerHost(entry.host)
    }));
}

export function buildSanitizedPayload(state, extensionVersion = "0.0.0", now = Date.now()) {
  if (!state) return null;
  const summary = summarizeState(state);
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    source: {
      product: "Veilance",
      extensionVersion,
      collectionMode: "local-opt-in"
    },
    site: {
      visitId: state.visitId,
      origin: state.origin,
      hostname: state.hostname,
      protocol: state.protocol,
      observedFrom: new Date(state.startedAt).toISOString(),
      observedUntil: new Date(state.endedAt || state.updatedAt).toISOString(),
      loadCompletedAt: Number.isFinite(state.loadCompletedAt)
        ? new Date(state.loadCompletedAt).toISOString()
        : null,
      active: state.active !== false
    },
    summary,
    network: {
      totalRequests: state.network.totalRequests,
      firstPartyRequests: state.network.firstPartyRequests,
      thirdPartyRequests: state.network.thirdPartyRequests,
      thirdPartyHosts: sortedHostList(state),
      knownServices: Object.values(state.network.trackers || {})
        .sort((a, b) => b.count - a.count)
        .map((entry) => ({
          label: entry.label,
          category: entry.category,
          domain: entry.domain,
          count: entry.count
        }))
    },
    page: { ...state.page },
    securityHeaders: { ...state.security.headers },
    signals: Object.values(state.signals || {})
      .sort((a, b) => b.count - a.count || a.api.localeCompare(b.api))
      .map((signal) => ({
        indicatorId: signal.indicatorId || null,
        kind: signal.kind,
        api: signal.api,
        action: signal.action,
        count: signal.count,
        firstSeen: new Date(signal.firstSeen).toISOString(),
        lastSeen: new Date(signal.lastSeen).toISOString(),
        detail: sanitizeEventDetail(signal.detail)
      })),
    findings: buildFindings(state),
    exclusions: [
      "full URL paths",
      "query strings",
      "page text",
      "form values",
      "cookie values",
      "storage keys and values",
      "authorization data",
      "clipboard contents",
      "geolocation coordinates"
    ]
  };
}

export function containsForbiddenPayloadKey(value, path = []) {
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    const inSignalDetail = path.includes("signals") && path.includes("detail");
    const alwaysForbidden = [
      "password", "authorization", "authtoken", "accesstoken", "refreshtoken",
      "cookievalue", "clipboardcontent", "latitude", "longitude", "lat", "lon",
      "lng", "accuracy", "altitude", "altitudeaccuracy", "heading", "speed"
    ].includes(lowerKey);
    if (alwaysForbidden || (inSignalDetail && FORBIDDEN_DETAIL_KEYS.has(lowerKey))) return true;
    if (child && typeof child === "object" && containsForbiddenPayloadKey(child, [...path, lowerKey])) {
      return true;
    }
  }
  return false;
}

export function hasSignalForTesting(state, api, action) {
  return hasSignal(state, api, action);
}
