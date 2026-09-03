export const TELEMETRY_SCHEMA_VERSION = "veilance.telemetry.v1";
export const TELEMETRY_SNAPSHOT_SCHEMA_VERSION = "veilance.telemetry-snapshot.v2";
export const REDACTED_HTML_FORMAT = "veilance.redacted-html.v1";
export const SNAPSHOT_INTEREST_MINIMUM = 25;
export const REQUEST_TIMELINE_BUCKET_MS = 5_000;
export const REQUEST_TIMELINE_MAX_BUCKETS = 720;
export const ACTIVITY_TIMELINE_BUCKET_MS = 1_000;
export const ACTIVITY_TIMELINE_MAX_EVENTS = 600;

const MAX_HOSTS = 120;
const MAX_SIGNALS = 100;
const MAX_RESOURCE_TYPES = 32;
const MAX_TRACKERS = 200;
const MAX_INTEREST_REASONS = 16;
const MAX_REDACTED_HTML_CHARS = 384 * 1024;
const REMOTE_RESOURCE_TYPES = new Set([
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object",
  "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport",
  "webbundle", "other"
]);

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

const ACTIVITY_CATEGORIES = new Set([
  "same-site", "third-party", "tracker", "fingerprinting", "storage", "permission", "browser", "shield"
]);

export function normalizeHostname(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/^\.+|\.+$/g, "");
}

export function isPublicTelemetryHostname(value) {
  const host = normalizeHostname(value).replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid")
  ) return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((part) => part < 0 || part > 255)) return false;
    const [a, b] = octets;
    return !(
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  if (host.includes(":")) {
    const mapped = host.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPublicTelemetryHostname(mapped[1]);
    return !(host === "::" || host === "::1" || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host));
  }
  return host.includes(".");
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
      trackers: {},
      requestTimeline: {
        bucketMs: REQUEST_TIMELINE_BUCKET_MS,
        maximumBuckets: REQUEST_TIMELINE_MAX_BUCKETS,
        startedOffsetMs: 0,
        overflowed: false,
        buckets: {}
      }
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
    droppedSignals: 0,
    activityTimeline: {
      bucketMs: ACTIVITY_TIMELINE_BUCKET_MS,
      maximumEvents: ACTIVITY_TIMELINE_MAX_EVENTS,
      startedOffsetMs: null,
      droppedEvents: 0,
      events: []
    },
    protections: {
      total: 0,
      lastProtectedAt: null,
      events: []
    }
  };
}

function signalActivityCategory(event) {
  const kind = String(event?.kind || "").toLowerCase();
  const indicatorId = String(event?.indicatorId || "").toLowerCase();
  const api = String(event?.api || "").toLowerCase();
  if (kind === "storage" || /cookie|storage|indexeddb|cache|serviceworker/.test(`${indicatorId} ${api}`)) return "storage";
  if (kind === "permission" || kind === "sensitive-api" || /permission|geolocation|clipboard|media|camera|microphone|sensor|credential|file|notification|device/.test(`${indicatorId} ${api}`)) return "permission";
  if (kind === "fingerprinting" || /canvas|webgl|audio|font|navigator|screen|timezone|locale|webgpu|webrtc/.test(`${indicatorId} ${api}`)) return "fingerprinting";
  return "browser";
}

function activityEventSignature(event, bucketIndex) {
  return [
    bucketIndex,
    event.kind,
    event.category,
    event.host,
    event.resourceType,
    event.method,
    event.indicatorId,
    event.api,
    event.action,
    event.ruleId,
    event.surface
  ].map((value) => String(value || "")).join("\u0000");
}

function recordActivityEvent(state, event, now = Date.now()) {
  if (!state || !event || typeof event !== "object") return;
  if (!state.activityTimeline || typeof state.activityTimeline !== "object") {
    state.activityTimeline = {
      bucketMs: ACTIVITY_TIMELINE_BUCKET_MS,
      maximumEvents: ACTIVITY_TIMELINE_MAX_EVENTS,
      startedOffsetMs: null,
      droppedEvents: 0,
      events: []
    };
  }
  const timeline = state.activityTimeline;
  if (!Array.isArray(timeline.events)) timeline.events = [];
  const offsetMs = Math.max(0, now - (Number(state.startedAt) || now));
  const bucketIndex = Math.floor(offsetMs / ACTIVITY_TIMELINE_BUCKET_MS);
  const category = ACTIVITY_CATEGORIES.has(event.category) ? event.category : "browser";
  const clean = {
    kind: ["network", "browser", "shield"].includes(event.kind) ? event.kind : "browser",
    category,
    offsetMs,
    lastOffsetMs: offsetMs,
    count: Math.max(1, Math.min(1_000_000, Math.floor(Number(event.count) || 1)))
  };
  for (const field of ["host", "resourceType", "method", "trackerLabel", "trackerCategory", "indicatorId", "signalKind", "api", "action", "ruleId", "surface", "technique"]) {
    if (typeof event[field] === "string" && event[field]) clean[field] = event[field].slice(0, 120);
  }
  if (event.detail && typeof event.detail === "object" && !Array.isArray(event.detail)) {
    clean.detail = sanitizeEventDetail(event.detail);
  }
  if (Number.isFinite(event.changedUnits)) {
    clean.changedUnits = Math.max(0, Math.min(1_000_000, Math.floor(event.changedUnits)));
  }
  const signature = activityEventSignature(clean, bucketIndex);
  for (let index = timeline.events.length - 1; index >= 0; index -= 1) {
    const existing = timeline.events[index];
    const existingBucket = Math.floor(Math.max(0, Number(existing?.offsetMs) || 0) / ACTIVITY_TIMELINE_BUCKET_MS);
    if (existingBucket < bucketIndex) break;
    if (activityEventSignature(existing, existingBucket) !== signature) continue;
    existing.count = Math.min(1_000_000, Math.max(1, Number(existing.count) || 1) + clean.count);
    existing.lastOffsetMs = offsetMs;
    if (clean.detail && Object.keys(clean.detail).length) existing.detail = clean.detail;
    if (Number.isFinite(clean.changedUnits)) {
      existing.changedUnits = Math.min(1_000_000, Math.max(0, Number(existing.changedUnits) || 0) + clean.changedUnits);
    }
    return;
  }
  if (timeline.events.length >= ACTIVITY_TIMELINE_MAX_EVENTS) {
    timeline.droppedEvents = Math.max(0, Number(timeline.droppedEvents) || 0) + clean.count;
    return;
  }
  timeline.bucketMs = ACTIVITY_TIMELINE_BUCKET_MS;
  timeline.maximumEvents = ACTIVITY_TIMELINE_MAX_EVENTS;
  if (!Number.isFinite(timeline.startedOffsetMs)) timeline.startedOffsetMs = offsetMs;
  timeline.events.push(clean);
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

  if (!state.network.requestTimeline || typeof state.network.requestTimeline !== "object") {
    state.network.requestTimeline = {
      bucketMs: REQUEST_TIMELINE_BUCKET_MS,
      maximumBuckets: REQUEST_TIMELINE_MAX_BUCKETS,
      startedOffsetMs: Math.max(0, now - (Number(state.startedAt) || now)),
      overflowed: false,
      buckets: {}
    };
  }
  const timeline = state.network.requestTimeline;
  const bucketMs = REQUEST_TIMELINE_BUCKET_MS;
  const rawBucketIndex = Math.max(0, Math.floor(
    Math.max(0, now - (Number(state.startedAt) || now)) / bucketMs
  ));
  const bucketIndex = Math.min(REQUEST_TIMELINE_MAX_BUCKETS - 1, rawBucketIndex);
  const bucketKey = String(bucketIndex);
  const bucket = timeline.buckets?.[bucketKey] || {
    offsetMs: bucketIndex * bucketMs,
    total: 0,
    firstParty: 0,
    thirdParty: 0
  };
  bucket.total += 1;
  if (thirdParty) bucket.thirdParty += 1;
  else bucket.firstParty += 1;
  timeline.bucketMs = bucketMs;
  timeline.maximumBuckets = REQUEST_TIMELINE_MAX_BUCKETS;
  timeline.overflowed = timeline.overflowed === true || rawBucketIndex >= REQUEST_TIMELINE_MAX_BUCKETS;
  if (!Number.isFinite(timeline.startedOffsetMs)) timeline.startedOffsetMs = bucket.offsetMs;
  if (!timeline.buckets || typeof timeline.buckets !== "object") timeline.buckets = {};
  timeline.buckets[bucketKey] = bucket;

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

  recordActivityEvent(state, {
    kind: "network",
    category: tracker ? "tracker" : thirdParty ? "third-party" : "same-site",
    host,
    resourceType: type,
    method: typeof details.method === "string" ? details.method.toUpperCase().slice(0, 12) : "GET",
    trackerLabel: tracker?.label,
    trackerCategory: tracker?.category
  }, now);

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
  recordActivityEvent(state, {
    kind: "browser",
    category: signalActivityCategory(event),
    indicatorId: entry.indicatorId,
    signalKind: kind,
    api,
    action,
    detail: cleanDetail
  }, now);
  state.updatedAt = now;
  return state;
}


function sanitizeProtectionReturnedValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = String(value.kind || "").slice(0, 32);
  if (!kind) return null;
  const clean = { kind, type: String(value.type || "unknown").slice(0, 80) };
  if (
    typeof value.value === "string" ||
    typeof value.value === "boolean" ||
    (typeof value.value === "number" && Number.isFinite(value.value)) ||
    value.value === null
  ) clean.value = typeof value.value === "string" ? value.value.slice(0, 200) : value.value;
  if (Number.isFinite(value.length)) clean.length = Math.max(0, Math.min(100000000, Math.floor(value.length)));
  if (typeof value.mimeType === "string") clean.mimeType = value.mimeType.slice(0, 80);
  if (typeof value.preview === "string") clean.preview = value.preview.slice(0, 200);
  if (typeof value.truncated === "boolean") clean.truncated = value.truncated;
  if (Array.isArray(value.sample)) {
    clean.sample = value.sample.slice(0, 16).filter((item) => (
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item)) ||
      item === null
    )).map((item) => typeof item === "string" ? item.slice(0, 120) : item);
  }
  if (value.fields && typeof value.fields === "object" && !Array.isArray(value.fields)) {
    clean.fields = {};
    for (const [name, fieldValue] of Object.entries(value.fields).slice(0, 16)) {
      if (
        typeof fieldValue === "string" ||
        typeof fieldValue === "boolean" ||
        (typeof fieldValue === "number" && Number.isFinite(fieldValue)) ||
        fieldValue === null
      ) clean.fields[String(name).slice(0, 80)] = typeof fieldValue === "string" ? fieldValue.slice(0, 120) : fieldValue;
    }
  }
  return clean;
}

export function addProtectionEvent(state, event, now = Date.now()) {
  if (!state || !event || typeof event !== "object") return state;
  if (!state.protections || typeof state.protections !== "object") {
    state.protections = { total: 0, lastProtectedAt: null, events: [] };
  }
  if (!Array.isArray(state.protections.events)) state.protections.events = [];

  const surface = String(event.surface || "Protected surface").slice(0, 80);
  const ruleId = String(event.ruleId || "").slice(0, 80);
  const timestamp = Number.isFinite(event.timestamp) ? event.timestamp : now;
  const increment = Math.max(1, Math.min(1000000, Number(event.count) || 1));
  const key = `${ruleId}:${surface}`.toLowerCase();
  let count = increment;
  let firstProtectedAt = timestamp;
  let lastProtectedAt = timestamp;
  let action = String(event.action || "Protected").slice(0, 80);
  let technique = String(event.technique || "Fingerprint Shield").slice(0, 120);
  let explanation = String(event.explanation || "").slice(0, 300);
  let indicatorId = String(event.indicatorId || "").slice(0, 80);
  let api = String(event.api || "").slice(0, 120);
  let matchedActions = (Array.isArray(event.matchedActions) ? event.matchedActions : [])
    .slice(0, 12)
    .map((value) => String(value || "").slice(0, 80))
    .filter(Boolean);
  let changedUnits = Math.max(0, Math.min(1000000, Math.floor(Number(event.changedUnits) || 0)));
  let totalChangedUnits = changedUnits;
  let returnedValue = sanitizeProtectionReturnedValue(event.returnedValue);
  const remaining = [];

  for (const entry of state.protections.events) {
    const entryKey = `${String(entry?.ruleId || "").slice(0, 80)}:${String(entry?.surface || "")}`.toLowerCase();
    if (entryKey !== key) {
      remaining.push(entry);
      continue;
    }
    const entryCount = Math.max(1, Number(entry.count) || 1);
    const entryFirst = Number(entry.firstProtectedAt ?? entry.timestamp) || timestamp;
    const entryLast = Number(entry.lastProtectedAt ?? entry.timestamp) || entryFirst;
    const entryChangedUnits = Math.max(0, Math.min(1000000, Math.floor(Number(entry.changedUnits) || 0)));
    const entryTotalChangedUnits = Math.max(entryChangedUnits, Math.min(1000000000, Math.floor(Number(entry.totalChangedUnits) || 0)));
    const entryReturnedValue = sanitizeProtectionReturnedValue(entry.returnedValue);
    count += entryCount;
    totalChangedUnits = Math.min(1000000000, totalChangedUnits + entryTotalChangedUnits);
    firstProtectedAt = Math.min(firstProtectedAt, entryFirst);
    lastProtectedAt = Math.max(lastProtectedAt, entryLast);
    if (entryLast > timestamp) {
      action = String(entry.action || action).slice(0, 80);
      technique = String(entry.technique || technique).slice(0, 120);
      explanation = String(entry.explanation || explanation).slice(0, 300);
      indicatorId = String(entry.indicatorId || indicatorId).slice(0, 80);
      api = String(entry.api || api).slice(0, 120);
      matchedActions = (Array.isArray(entry.matchedActions) ? entry.matchedActions : matchedActions)
        .slice(0, 12)
        .map((value) => String(value || "").slice(0, 80))
        .filter(Boolean);
      changedUnits = entryChangedUnits;
      returnedValue = entryReturnedValue || returnedValue;
    }
    if (!indicatorId && entry.indicatorId) indicatorId = String(entry.indicatorId).slice(0, 80);
    if (!api && entry.api) api = String(entry.api).slice(0, 120);
    if (!matchedActions.length && Array.isArray(entry.matchedActions)) {
      matchedActions = entry.matchedActions.slice(0, 12).map((value) => String(value || "").slice(0, 80)).filter(Boolean);
    }
    if (!returnedValue && entryReturnedValue) returnedValue = entryReturnedValue;
  }

  state.protections.events = [{
    ruleId,
    indicatorId,
    api,
    matchedActions,
    surface,
    action,
    technique,
    explanation,
    returnedValue,
    changedUnits,
    totalChangedUnits,
    count,
    firstProtectedAt,
    lastProtectedAt,
    timestamp: lastProtectedAt
  }, ...remaining].slice(0, 50);
  state.protections.total = Math.max(0, Number(state.protections.total) || 0) + increment;
  state.protections.lastProtectedAt = Math.max(Number(state.protections.lastProtectedAt) || 0, timestamp);
  recordActivityEvent(state, {
    kind: "shield",
    category: "shield",
    ruleId,
    indicatorId,
    api,
    action,
    surface,
    technique,
    changedUnits,
    count: increment
  }, timestamp);
  state.updatedAt = Math.max(state.updatedAt || 0, now);
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

function indicatorSignalCount(state, indicatorId, actions = null) {
  let count = 0;
  const allowedActions = Array.isArray(actions) && actions.length ? new Set(actions) : null;
  for (const signal of Object.values(state?.signals || {})) {
    if (signal.indicatorId !== indicatorId) continue;
    if (allowedActions && !allowedActions.has(signal.action)) continue;
    count += Number(signal.count || 0);
  }
  return count;
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

  const webGpuEvents = indicatorSignalCount(state, "webgpu");
  if (webGpuEvents) {
    push({
      id: "webgpu-identity",
      severity: "medium",
      title: "WebGPU capabilities requested",
      description: "The page requested WebGPU adapter, device, format, or adapter information. These operations are useful for graphics and can also expose identifying hardware capabilities.",
      evidence: `${webGpuEvents} WebGPU event(s)`
    });
  }

  const fingerprintGroups = [
    ["navigator-characteristics", "browser and device"],
    ["screen-characteristics", "screen"],
    ["locale-timezone", "locale and time zone"],
    ["font-probing", "fonts"],
    ["css-media-queries", "media preferences"],
    ["performance-timing", "performance timing"],
    ["network-information", "network characteristics"],
    ["media-capabilities", "media capabilities"]
  ].filter(([id]) => indicatorSignalCount(state, id) > 0);
  if (fingerprintGroups.length >= 3) {
    push({
      id: "broad-fingerprint-surface",
      severity: "medium",
      title: "Multiple fingerprint characteristics queried",
      description: "The page queried several independent browser or device characteristics. Combined characteristics can distinguish a browser more reliably than any one value, although responsive and compatibility code can look similar.",
      evidence: `${fingerprintGroups.length} groups: ${fingerprintGroups.map(([, label]) => label).join(", ")}`
    });
  } else {
    const fontEvents = indicatorSignalCount(state, "font-probing");
    if (fontEvents >= 5) {
      push({
        id: "repeated-font-probing",
        severity: "low",
        title: "Repeated font characteristics queried",
        description: "The page repeatedly checked font availability or measured rendered text. This supports normal layout work and can also contribute to font-based fingerprinting.",
        evidence: `${fontEvents} font probe(s)`
      });
    }
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

  const cookieAccess = indicatorSignalCount(state, "cookie-access");
  if (cookieAccess) {
    const storageAccessRequests = signalCount(state, "StorageAccess", "request-storage-access") +
      signalCount(state, "StorageAccess", "request-storage-access-for-origin");
    push({
      id: "cookie-access",
      severity: storageAccessRequests ? "medium" : "low",
      title: storageAccessRequests ? "Cross-site storage access requested" : "Script-visible cookies accessed",
      description: storageAccessRequests
        ? "The page used the Storage Access API, which can request access to otherwise restricted embedded storage. Veilance does not retain cookie names or values."
        : "The page read or wrote cookies visible to JavaScript. Veilance records only the operation count and never records cookie names or values.",
      evidence: `${cookieAccess} cookie or storage-access event(s)`
    });
  }

  const deviceAccessRequests = indicatorSignalCount(state, "connected-devices", ["request-access"]);
  const deviceEnumerations = indicatorSignalCount(state, "connected-devices", ["enumerate"]);
  if (deviceAccessRequests || deviceEnumerations) {
    push({
      id: "connected-device-access",
      severity: deviceAccessRequests ? "high" : "low",
      title: deviceAccessRequests ? "Connected-device access requested" : "Connected devices enumerated",
      description: deviceAccessRequests
        ? "The page requested access to a Bluetooth, USB, HID, serial, or MIDI device. Browser permission should still be required where the API mandates it."
        : "The page checked for connected peripherals. Veilance records only the API category and not device identifiers or names.",
      evidence: `${deviceAccessRequests} access request(s), ${deviceEnumerations} enumeration call(s)`
    });
  }

  const sensorEvents = indicatorSignalCount(state, "device-sensors");
  if (sensorEvents) {
    push({
      id: "device-sensor-access",
      severity: "medium",
      title: "Motion or sensor access observed",
      description: "The page registered for device motion or orientation, started a sensor, or requested sensor permission. Veilance does not retain sensor readings.",
      evidence: `${sensorEvents} sensor event(s)`
    });
  }

  const credentialOperations = signalCount(state, "Credentials", "get") +
    signalCount(state, "Credentials", "create") +
    signalCount(state, "Credentials", "store");
  const credentialEvents = indicatorSignalCount(state, "credential-management");
  if (credentialEvents) {
    push({
      id: "credential-management",
      severity: credentialOperations ? "high" : "low",
      title: credentialOperations ? "Browser credential operation used" : "Authenticator capabilities checked",
      description: credentialOperations
        ? "The page used the browser's credential container. This is normal during passkey and sign-in flows; Veilance never retains credentials, challenges, or responses."
        : "The page checked WebAuthn or credential capabilities. This is common on sign-in pages and can also reveal supported authenticator features.",
      evidence: `${credentialEvents} credential event(s)`
    });
  }

  const fileSystemEvents = indicatorSignalCount(state, "file-system-access");
  if (fileSystemEvents) {
    push({
      id: "file-system-access",
      severity: "high",
      title: "Local file-system access used",
      description: "The page opened a file or directory picker, checked handle permissions, or used a selected file-system handle. Veilance never retains file names or contents.",
      evidence: `${fileSystemEvents} file-system event(s)`
    });
  }

  const speechRecognition = signalCount(state, "SpeechRecognition", "start");
  const voiceEnumeration = signalCount(state, "SpeechSynthesis", "get-voices");
  if (speechRecognition || voiceEnumeration) {
    push({
      id: "speech-access",
      severity: speechRecognition ? "high" : "low",
      title: speechRecognition ? "Speech recognition started" : "Installed voices enumerated",
      description: speechRecognition
        ? "The page started browser speech recognition. Veilance records the API call and never retains audio or recognized text."
        : "The page requested the browser's installed speech voices. The voice list can vary across systems and contribute to a fingerprint.",
      evidence: `${speechRecognition} recognition start(s), ${voiceEnumeration} voice-list request(s)`
    });
  }

  const advertisingApiEvents = indicatorSignalCount(state, "privacy-sandbox");
  if (advertisingApiEvents) {
    push({
      id: "advertising-privacy-api",
      severity: "medium",
      title: "Advertising privacy API used",
      description: "The page used Topics, Protected Audience, or Shared Storage. Veilance records only the API operation and never retains returned interests, auction configuration, or shared-storage contents.",
      evidence: `${advertisingApiEvents} advertising API event(s)`
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
    .filter((entry) => entry.thirdParty && isPublicTelemetryHostname(entry.host))
    .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
    .slice(0, MAX_HOSTS)
    .map((entry) => ({
      host: entry.host,
      requests: Math.max(0, Math.floor(Number(entry.count) || 0)),
      resourceTypes: Object.fromEntries(Object.entries(entry.types || {})
        .filter(([type]) => REMOTE_RESOURCE_TYPES.has(type))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 16)
        .map(([type, count]) => [String(type).slice(0, 48), Math.max(0, Math.floor(Number(count) || 0))]))
    }));
}

function cleanIdentifier(value, maximum = 100) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maximum);
}

function finiteCount(value, maximum = 10000000) {
  return Math.max(0, Math.min(maximum, Math.floor(Number(value) || 0)));
}

function defaultTrackerObservations(state) {
  return Object.values(state?.network?.trackers || {}).map((entry) => ({
    id: entry.domain,
    category: entry.category,
    requests: entry.count
  }));
}

function cleanTrackerObservations(values) {
  const merged = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const id = cleanIdentifier(value?.id || value?.domain);
    if (!id) continue;
    const current = merged.get(id) || {
      id,
      category: cleanIdentifier(value?.category || "unknown", 64) || "unknown",
      requests: 0
    };
    current.requests += finiteCount(value?.requests ?? value?.count);
    merged.set(id, current);
    if (merged.size >= MAX_TRACKERS) break;
  }
  return [...merged.values()]
    .map((entry) => ({ ...entry, requests: finiteCount(entry.requests) }))
    .sort((a, b) => b.requests - a.requests || a.id.localeCompare(b.id));
}

function telemetryPageCounts(page) {
  const source = page && typeof page === "object" ? page : {};
  return {
    scriptCount: finiteCount(source.scriptCount),
    thirdPartyScriptCount: finiteCount(source.thirdPartyScriptCount),
    iframeCount: finiteCount(source.iframeCount),
    thirdPartyIframeCount: finiteCount(source.thirdPartyIframeCount),
    accessibleCookieCount: finiteCount(source.accessibleCookieCount),
    localStorageKeyCount: finiteCount(source.localStorageKeyCount),
    sessionStorageKeyCount: finiteCount(source.sessionStorageKeyCount),
    indexedDbCount: source.indexedDbCount === null ? null : finiteCount(source.indexedDbCount),
    cacheCount: source.cacheCount === null ? null : finiteCount(source.cacheCount),
    serviceWorkerControlled: Boolean(source.serviceWorkerControlled)
  };
}

function randomEventId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

const REMOTE_SIGNAL_ALLOWLIST = new Set([
  ...["write", "remove", "clear"].map((action) => `browser-storage|Storage|${action}`),
  ...["open", "delete"].map((action) => `browser-storage|IndexedDB|${action}`),
  ...["open", "delete"].map((action) => `browser-storage|CacheStorage|${action}`),
  "browser-storage|ServiceWorker|register",
  ...["read", "write"].map((action) => `cookie-access|Cookie|${action}`),
  ...["has-storage-access", "request-storage-access", "request-storage-access-for-origin"].map((action) => `cookie-access|StorageAccess|${action}`),
  ...["get", "get-all", "set", "delete"].map((action) => `cookie-access|CookieStore|${action}`),
  ...["export", "readback"].map((action) => `canvas|Canvas|${action}`),
  "font-probing|Canvas2D|measure-text",
  ...["check", "load"].map((action) => `font-probing|Fonts|${action}`),
  ...["renderer-query", "read-pixels"].map((action) => `webgl|WebGL|${action}`),
  ...["create-oscillator", "create-analyser", "create-compressor", "offline-render"].map((action) => `audio|AudioContext|${action}`),
  "audio|AudioBuffer|read-buffer",
  ...[
    "user-agent", "app-version", "platform", "vendor", "product-sub",
    "hardware-concurrency", "device-memory", "max-touch-points", "language",
    "languages", "plugins", "mime-types", "pdf-viewer-enabled", "do-not-track",
    "global-privacy-control", "webdriver"
  ].map((property) => `navigator-characteristics|Navigator|read-${property}`),
  ...["high-entropy-values", "serialize", "read-brands", "read-mobile", "read-platform"]
    .map((action) => `navigator-characteristics|ClientHints|${action}`),
  ...["width", "height", "avail-width", "avail-height", "color-depth", "pixel-depth", "is-extended", "device-pixel-ratio"]
    .map((property) => `screen-characteristics|Screen|read-${property}`),
  ...["read-type", "read-angle"].map((action) => `screen-characteristics|ScreenOrientation|${action}`),
  ...["timezone-offset", "resolved-options"].map((action) => `locale-timezone|Locale|${action}`),
  "css-media-queries|CSSMedia|match",
  ...["get-entries", "get-entries-by-type", "get-entries-by-name", "observe"]
    .map((action) => `performance-timing|Performance|${action}`),
  ...["request-adapter", "preferred-format", "request-device", "adapter-info"]
    .map((action) => `webgpu|WebGPU|${action}`),
  ...["type", "effective-type", "downlink", "downlink-max", "rtt", "save-data"]
    .map((property) => `network-information|NetworkInformation|read-${property}`),
  ...["decoding-info", "encoding-info"].map((action) => `media-capabilities|MediaCapabilities|${action}`),
  "media-capabilities|EncryptedMedia|key-system-access",
  ...["create-offer", "create-data-channel", "get-stats"].map((action) => `webrtc|WebRTC|${action}`),
  ...["enumerate-devices", "get-user-media"].map((action) => `media-devices|MediaDevices|${action}`),
  ...["get-position", "watch-position"].map((action) => `geolocation|Geolocation|${action}`),
  "permission-queries|Permissions|query",
  ...["Bluetooth", "USB", "HID", "Serial"].flatMap((api) => [
    `connected-devices|${api}|enumerate`,
    `connected-devices|${api}|request-access`
  ]),
  "connected-devices|MIDI|request-access",
  "connected-devices|Gamepad|enumerate",
  ...["listen", "start", "request-permission"].map((action) => `device-sensors|Sensors|${action}`),
  ...["get", "create", "store", "prevent-silent-access"].map((action) => `credential-management|Credentials|${action}`),
  ...[
    "is-user-verifying-platform-authenticator-available",
    "is-conditional-mediation-available",
    "get-client-capabilities"
  ].map((action) => `credential-management|WebAuthn|${action}`),
  ...[
    "open-picker", "save-picker", "directory-picker", "query-permission",
    "request-permission", "get-file", "create-writable", "get-file-handle",
    "get-directory-handle", "remove-entry", "resolve"
  ].map((action) => `file-system-access|FileSystem|${action}`),
  "speech|SpeechSynthesis|get-voices",
  "speech|SpeechRecognition|start",
  ...["read", "read-text", "write", "write-text"].map((action) => `clipboard|Clipboard|${action}`),
  "notifications|Notification|request-permission",
  "battery|Battery|read-status",
  "beacon|Beacon|send",
  "privacy-sandbox|Topics|read",
  ...[
    "join-ad-interest-group", "leave-ad-interest-group", "update-ad-interest-groups",
    "run-ad-auction", "clear-origin-joined-ad-interest-groups", "create-auction-nonce"
  ].map((action) => `privacy-sandbox|ProtectedAudience|${action}`),
  ...["set", "append", "delete", "clear", "get", "run", "select-url", "read-length", "add-module"]
    .map((action) => `privacy-sandbox|SharedStorage|${action}`),
  ...["push-state", "replace-state", "pop-state"].map((action) => `spa-navigation|History|${action}`)
]);

export function isRemoteSignalAllowed(signal) {
  const indicatorId = cleanIdentifier(signal?.indicatorId, 80);
  const api = String(signal?.api || "").slice(0, 80);
  const action = String(signal?.action || "").slice(0, 80);
  return REMOTE_SIGNAL_ALLOWLIST.has(`${indicatorId}|${api}|${action}`);
}

const INTEREST_SEVERITY_POINTS = Object.freeze({
  high: 25,
  medium: 10,
  low: 2
});

function interestLevelForScore(score) {
  if (score >= 70) return "critical";
  if (score >= 40) return "high";
  if (score >= SNAPSHOT_INTEREST_MINIMUM) return "interesting";
  return "routine";
}

export function scoreTelemetryInterest(state, findingsOverride = null) {
  const findings = Array.isArray(findingsOverride) ? findingsOverride : buildFindings(state);
  const reasonsById = new Map();
  for (const finding of findings) {
    const severity = String(finding?.severity || "").toLowerCase();
    const points = INTEREST_SEVERITY_POINTS[severity] || 0;
    const id = cleanIdentifier(finding?.id || finding?.indicatorId, 80);
    if (!id || !points) continue;
    const reason = { id, severity, points };
    const previous = reasonsById.get(id);
    if (!previous || reason.points > previous.points) reasonsById.set(id, reason);
  }

  const allowedActionCount = Object.values(state?.signals || {})
    .filter(isRemoteSignalAllowed)
    .reduce((total, signal) => total + finiteCount(signal?.count), 0);
  if (allowedActionCount >= 25) {
    reasonsById.set("repeated-api-activity", {
      id: "repeated-api-activity",
      severity: "low",
      points: allowedActionCount >= 100 ? 10 : 5
    });
  }

  const reasons = [...reasonsById.values()]
    .sort((a, b) => b.points - a.points || a.id.localeCompare(b.id))
    .slice(0, MAX_INTEREST_REASONS);
  const score = Math.min(100, reasons.reduce((total, reason) => total + reason.points, 0));
  return {
    score,
    level: interestLevelForScore(score),
    minimumScore: SNAPSHOT_INTEREST_MINIMUM,
    eligible: score >= SNAPSHOT_INTEREST_MINIMUM,
    reasons
  };
}

export function buildSanitizedPayload(state, extensionVersion = "0.0.0", now = Date.now(), options = {}) {
  if (!state) return null;
  const observedUntil = Number.isFinite(state.endedAt) ? state.endedAt : Math.max(Number(state.updatedAt) || 0, now);
  const durationSeconds = finiteCount(Math.max(0, observedUntil - (Number(state.startedAt) || observedUntil)) / 1000, 30 * 24 * 60 * 60);
  const trackers = cleanTrackerObservations(
    Array.isArray(options.trackers) ? options.trackers : defaultTrackerObservations(state)
  );
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: String(options.eventId || randomEventId()).slice(0, 100),
    extensionVersion: String(extensionVersion || "0.0.0").slice(0, 40),
    site: {
      hostname: normalizeHostname(state.hostname),
      https: state.protocol === "https:"
    },
    observation: {
      durationSeconds,
      totalRequests: finiteCount(state.network?.totalRequests),
      firstPartyRequests: finiteCount(state.network?.firstPartyRequests),
      thirdPartyRequests: finiteCount(state.network?.thirdPartyRequests)
    },
    thirdPartyHosts: sortedHostList(state),
    trackers,
    signals: Object.values(state.signals || {})
      .filter(isRemoteSignalAllowed)
      .sort((a, b) => b.count - a.count || a.api.localeCompare(b.api))
      .slice(0, MAX_SIGNALS)
      .map((signal) => ({
        indicatorId: cleanIdentifier(signal.indicatorId, 80) || null,
        api: String(signal.api || "Unknown").slice(0, 80),
        action: String(signal.action || "used").slice(0, 80),
        count: finiteCount(signal.count)
      })),
    page: telemetryPageCounts(state.page),
    security: {
      contentSecurityPolicy: Boolean(state.security?.headers?.contentSecurityPolicy),
      strictTransportSecurity: Boolean(state.security?.headers?.strictTransportSecurity),
      permissionsPolicy: Boolean(state.security?.headers?.permissionsPolicy),
      referrerPolicy: Boolean(state.security?.headers?.referrerPolicy),
      xFrameOptions: Boolean(state.security?.headers?.xFrameOptions),
      crossOriginOpenerPolicy: Boolean(state.security?.headers?.crossOriginOpenerPolicy),
      crossOriginResourcePolicy: Boolean(state.security?.headers?.crossOriginResourcePolicy)
    }
  };
}

const REDACTION_COUNTER_FIELDS = [
  "textNodesRedacted", "attributesRemoved", "urlsReduced", "privateUrlsRemoved",
  "inlineScriptsRedacted", "styleBlocksRedacted", "formControlsRedacted",
  "commentsRemoved", "opaqueNodesRedacted", "nodesOmitted"
];
const SCRIPT_HINT_FIELDS = [
  "canvas", "webgl", "webgpu", "audio", "fonts", "navigator", "screen",
  "webrtc", "advertising", "antiBlocking"
];
const DOM_MARKER_FIELDS = ["advertising", "consent", "antiBlocking", "tracking"];
const SAFE_REDACTED_TAGS = new Set((
  "a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption " +
  "cite code col colgroup custom-element data datalist dd del details dfn dialog div dl dt em embed " +
  "fieldset figcaption figure footer form g h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe " +
  "img input ins kbd label legend li line link main map mark math menu meta meter nav noscript object " +
  "ol optgroup option output p path picture polygon polyline pre progress q rect rp rt ruby s samp " +
  "script search section select slot small source span strong style sub summary sup svg symbol table " +
  "tbody td template textarea tfoot th thead time title tr track u ul use var video wbr circle defs ellipse"
).split(/\s+/));
const SAFE_REDACTED_TYPES = new Set((
  "module text/javascript application/javascript application/ld+json application/veilance-redacted text/css image audio video font " +
  "document fetch worker text search email url tel password number checkbox radio file hidden submit " +
  "reset button date time datetime-local month week color range"
).split(/\s+/));
const SAFE_REDACTED_REL = new Set((
  "stylesheet preload modulepreload prefetch dns-prefetch preconnect icon manifest alternate canonical noopener noreferrer"
).split(/\s+/));
const SAFE_REDACTED_SANDBOX = new Set((
  "allow-downloads allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups " +
  "allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts " +
  "allow-storage-access-by-user-activation allow-top-navigation allow-top-navigation-by-user-activation"
).split(/\s+/));

function cleanCounterObject(value, allowedFields) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(allowedFields.map((field) => [field, finiteCount(source[field])]));
}

export function isRedactedHtmlSafe(value) {
  const html = String(value || "");
  if (!html.startsWith("<!doctype html>\n") || html.length > MAX_REDACTED_HTML_CHARS + 64) return false;
  if (/\s(?:value|src|href|action|poster|srcdoc|nonce|integrity|style|content|id|class|name|on[a-z0-9_-]+)\s*=/i.test(html)) {
    return false;
  }
  if (/\sdata-(?!veilance-)[a-z0-9_-]+\s*=/i.test(html)) return false;
  if (/[?#]/.test(html)) return false;
  if (/\b(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)\b/i.test(html)) return false;
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    if (!/^https?:\/\/(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d{1,5})?$/i.test(match[0])) return false;
  }
  for (const token of html.match(/<[^>]*>/g) || []) {
    if (/^<!doctype html>$/i.test(token) || /^<!-- veilance: snapshot truncated -->$/.test(token)) continue;
    const closing = token.match(/^<\/([a-z0-9-]+)>$/i);
    if (closing) {
      if (!SAFE_REDACTED_TAGS.has(closing[1].toLowerCase())) return false;
      continue;
    }
    const opening = token.match(/^<([a-z0-9-]+)([\s\S]*)>$/i);
    if (!opening || !SAFE_REDACTED_TAGS.has(opening[1].toLowerCase())) return false;
    const attributeText = opening[2] || "";
    let consumed = "";
    const seenAttributes = new Map();
    for (const match of attributeText.matchAll(/\s+([a-z0-9:-]+)(?:="([^"]*)")?/gi)) {
      consumed += match[0];
      const name = match[1].toLowerCase();
      const attributeValue = match[2];
      if (seenAttributes.has(name)) return false;
      seenAttributes.set(name, attributeValue);
      if (["async", "defer", "nomodule"].includes(name)) {
        if (attributeValue !== undefined) return false;
      } else if (name === "type") {
        if (!SAFE_REDACTED_TYPES.has(attributeValue || "")) return false;
      } else if (name === "rel") {
        if (!(attributeValue || "").split(/\s+/).every((item) => SAFE_REDACTED_REL.has(item))) return false;
      } else if (name === "crossorigin") {
        if (!["anonymous", "use-credentials"].includes(attributeValue)) return false;
      } else if (name === "loading") {
        if (!["lazy", "eager"].includes(attributeValue)) return false;
      } else if (name === "method") {
        if (!["get", "post", "dialog"].includes(attributeValue)) return false;
      } else if (name === "referrerpolicy") {
        if (!["no-referrer", "no-referrer-when-downgrade", "origin", "origin-when-cross-origin", "same-origin", "strict-origin", "strict-origin-when-cross-origin", "unsafe-url"].includes(attributeValue)) return false;
      } else if (name === "sandbox") {
        if (!(attributeValue || "").split(/\s+/).every((item) => SAFE_REDACTED_SANDBOX.has(item))) return false;
      } else if (name === "width" || name === "height") {
        if (!/^\d{1,6}$/.test(attributeValue || "") || Number(attributeValue) > 100000) return false;
      } else if (/^data-veilance-(?:src|href|action|poster|data)-origin$/.test(name)) {
        try {
          const origin = new URL(attributeValue || "");
          if (origin.origin !== attributeValue || !isPublicTelemetryHostname(origin.hostname)) return false;
        } catch {
          return false;
        }
      } else if (/^data-veilance-(?:src|href|action|poster|data)$/.test(name)) {
        if (!["non-network-redacted", "private-origin-redacted"].includes(attributeValue)) return false;
      } else if (name === "data-veilance-markers") {
        if (!(attributeValue || "").split(",").every((item) => DOM_MARKER_FIELDS.includes(item))) return false;
      } else if (name === "data-veilance-api-hints") {
        if (!(attributeValue || "").split(",").every((item) => SCRIPT_HINT_FIELDS.includes(item))) return false;
      } else if (name === "data-veilance-inline") {
        if (attributeValue !== "redacted") return false;
      } else if (name === "data-veilance-size-bucket") {
        if (!["0", "1kb", "4kb", "16kb", "64kb", "256kb", "256kb+"].includes(attributeValue)) return false;
      } else if (name === "data-veilance-control") {
        if (!/^(?:input:(?:text|search|email|url|tel|password|number|checkbox|radio|file|hidden|submit|reset|button|date|time|datetime-local|month|week|color|range|other)|textarea|select|option|button|output)$/.test(attributeValue || "")) return false;
      } else {
        return false;
      }
    }
    if (consumed !== attributeText) return false;
    if (opening[1].toLowerCase() === "script" && seenAttributes.get("type") !== "application/veilance-redacted") {
      return false;
    }
  }
  const withoutMarkup = html
    .replace(/^<!doctype html>\n/i, "")
    .replace(/<!-- veilance: snapshot truncated -->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\[REDACTED (?:TEXT|INLINE SCRIPT|STYLE|FORM CONTROL|OPAQUE CONTENT)\]/g, "")
    .trim();
  return withoutMarkup === "";
}

function cleanDocumentCapture(capture, expectedHostname) {
  if (!capture || capture.format !== REDACTED_HTML_FORMAT) throw new Error("Redacted document format is invalid");
  const hostname = normalizeHostname(capture.hostname);
  if (!hostname || hostname !== normalizeHostname(expectedHostname)) {
    throw new Error("Redacted document does not match the observed website");
  }
  const html = String(capture.html || "");
  if (!isRedactedHtmlSafe(html)) throw new Error("Redacted document failed the telemetry safety validator");
  const resources = [];
  for (const value of Array.isArray(capture.resourceHosts) ? capture.resourceHosts : []) {
    const host = normalizeHostname(value?.host);
    if (!isPublicTelemetryHostname(host)) continue;
    const tags = {};
    for (const [tag, count] of Object.entries(value?.tags || {}).slice(0, 12)) {
      const cleanTag = cleanIdentifier(tag, 32);
      if (SAFE_REDACTED_TAGS.has(cleanTag)) tags[cleanTag] = finiteCount(count);
    }
    resources.push({
      host,
      thirdParty: Boolean(value?.thirdParty),
      count: finiteCount(value?.count),
      tags
    });
    if (resources.length >= 160) break;
  }
  return {
    format: REDACTED_HTML_FORMAT,
    html,
    truncated: Boolean(capture.truncated),
    originalElementCount: finiteCount(capture.originalElementCount, 1000000),
    serializedChars: html.length,
    redaction: cleanCounterObject(capture.redaction, REDACTION_COUNTER_FIELDS),
    evidence: {
      resourceHosts: resources,
      inlineScriptHints: cleanCounterObject(capture.inlineScriptHints, SCRIPT_HINT_FIELDS),
      domMarkers: cleanCounterObject(capture.domMarkers, DOM_MARKER_FIELDS)
    }
  };
}

export function buildTelemetrySnapshot(state, documentCapture, extensionVersion = "0.0.0", now = Date.now(), options = {}) {
  const telemetry = buildSanitizedPayload(state, extensionVersion, now, options);
  if (!telemetry || !isPublicTelemetryHostname(telemetry.site.hostname)) {
    throw new Error("Telemetry snapshots are limited to public HTTP(S) websites");
  }
  const interest = scoreTelemetryInterest(state, options.findings);
  if (!interest.eligible) {
    throw new Error(
      `This visit is routine activity (${interest.score}/100 interest). ` +
      `Veilance saves snapshots only at ${SNAPSHOT_INTEREST_MINIMUM}/100 or higher.`
    );
  }
  if (Boolean(documentCapture?.https) !== telemetry.site.https) {
    throw new Error("Redacted document protocol does not match the observed website");
  }
  const redactedDocument = cleanDocumentCapture(documentCapture, telemetry.site.hostname);
  return {
    ...telemetry,
    schemaVersion: TELEMETRY_SNAPSHOT_SCHEMA_VERSION,
    interest,
    redactedDocument
  };
}

function hasOnlyKeys(value, allowed) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}

function isValidCount(value, maximum = 10000000) {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}

function hasExactCounterKeys(value, fields) {
  return hasOnlyKeys(value, fields) && fields.every((field) => isValidCount(value[field]));
}

export function validateTelemetrySnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== TELEMETRY_SNAPSHOT_SCHEMA_VERSION) return false;
  if (!hasOnlyKeys(snapshot, [
    "schemaVersion", "eventId", "extensionVersion", "site", "observation",
    "thirdPartyHosts", "trackers", "signals", "page", "security", "interest", "redactedDocument"
  ])) return false;
  if (!/^[a-z0-9._-]{8,100}$/i.test(String(snapshot.eventId || "")) || !isPublicTelemetryHostname(snapshot.site?.hostname)) return false;
  if (!/^[a-z0-9.+_-]{1,40}$/i.test(String(snapshot.extensionVersion || ""))) return false;
  if (!hasOnlyKeys(snapshot.site, ["hostname", "https"])) return false;
  if (snapshot.site?.https !== true && snapshot.site?.https !== false) return false;
  if (!hasOnlyKeys(snapshot.observation, [
    "durationSeconds", "totalRequests", "firstPartyRequests", "thirdPartyRequests"
  ]) || !isValidCount(snapshot.observation.durationSeconds, 30 * 24 * 60 * 60) ||
      !isValidCount(snapshot.observation.totalRequests) ||
      !isValidCount(snapshot.observation.firstPartyRequests) ||
      !isValidCount(snapshot.observation.thirdPartyRequests)) return false;
  if (!Array.isArray(snapshot.thirdPartyHosts) || snapshot.thirdPartyHosts.length > MAX_HOSTS) return false;
  for (const entry of snapshot.thirdPartyHosts) {
    if (!hasOnlyKeys(entry, ["host", "requests", "resourceTypes"]) ||
        !isPublicTelemetryHostname(entry.host) || !isValidCount(entry.requests)) return false;
    if (!hasOnlyKeys(entry.resourceTypes, [...REMOTE_RESOURCE_TYPES]) ||
        !Object.values(entry.resourceTypes).every((value) => isValidCount(value))) return false;
  }
  if (!Array.isArray(snapshot.trackers) || snapshot.trackers.length > MAX_TRACKERS) return false;
  for (const tracker of snapshot.trackers) {
    if (!hasOnlyKeys(tracker, ["id", "category", "requests"]) ||
        !/^[a-z0-9._-]{1,100}$/.test(String(tracker.id || "")) ||
        !/^[a-z0-9._-]{1,64}$/.test(String(tracker.category || "")) ||
        !isValidCount(tracker.requests)) return false;
  }
  if (!Array.isArray(snapshot.signals) || snapshot.signals.length > MAX_SIGNALS) return false;
  for (const signal of snapshot.signals) {
    if (!hasOnlyKeys(signal, ["indicatorId", "api", "action", "count"]) ||
        !isRemoteSignalAllowed(signal) || !isValidCount(signal.count)) return false;
  }
  if (!hasOnlyKeys(snapshot.page, [
    "scriptCount", "thirdPartyScriptCount", "iframeCount", "thirdPartyIframeCount",
    "accessibleCookieCount", "localStorageKeyCount", "sessionStorageKeyCount",
    "indexedDbCount", "cacheCount", "serviceWorkerControlled"
  ])) return false;
  for (const [key, value] of Object.entries(snapshot.page)) {
    if (key === "serviceWorkerControlled") {
      if (typeof value !== "boolean") return false;
    } else if ((key === "indexedDbCount" || key === "cacheCount") && value === null) {
      continue;
    } else if (!isValidCount(value, 100000)) return false;
  }
  if (!hasOnlyKeys(snapshot.security, [
    "contentSecurityPolicy", "strictTransportSecurity", "permissionsPolicy",
    "referrerPolicy", "xFrameOptions", "crossOriginOpenerPolicy", "crossOriginResourcePolicy"
  ]) || !Object.values(snapshot.security).every((value) => typeof value === "boolean")) return false;
  const interest = snapshot.interest;
  if (!hasOnlyKeys(interest, ["score", "level", "minimumScore", "eligible", "reasons"]) ||
      !isValidCount(interest.score, 100) ||
      interest.minimumScore !== SNAPSHOT_INTEREST_MINIMUM ||
      interest.eligible !== true ||
      interest.score < SNAPSHOT_INTEREST_MINIMUM ||
      interest.level !== interestLevelForScore(interest.score) ||
      !Array.isArray(interest.reasons) ||
      !interest.reasons.length ||
      interest.reasons.length > MAX_INTEREST_REASONS) return false;
  let interestPoints = 0;
  const interestReasonIds = new Set();
  for (const reason of interest.reasons) {
    if (!hasOnlyKeys(reason, ["id", "severity", "points"]) ||
        !/^[a-z0-9._-]{1,80}$/.test(String(reason.id || "")) ||
        !Object.hasOwn(INTEREST_SEVERITY_POINTS, reason.severity) ||
        !isValidCount(reason.points, 40) || reason.points === 0 ||
        interestReasonIds.has(reason.id)) return false;
    interestReasonIds.add(reason.id);
    interestPoints += reason.points;
  }
  if (interest.score !== Math.min(100, interestPoints)) return false;
  if (!snapshot.redactedDocument || snapshot.redactedDocument.format !== REDACTED_HTML_FORMAT) return false;
  if (!hasOnlyKeys(snapshot.redactedDocument, [
    "format", "html", "truncated", "originalElementCount", "serializedChars",
    "redaction", "evidence"
  ])) return false;
  if (!isRedactedHtmlSafe(snapshot.redactedDocument.html)) return false;
  if (typeof snapshot.redactedDocument.truncated !== "boolean" ||
      !isValidCount(snapshot.redactedDocument.originalElementCount, 1000000) ||
      snapshot.redactedDocument.serializedChars !== snapshot.redactedDocument.html.length ||
      !hasExactCounterKeys(snapshot.redactedDocument.redaction, REDACTION_COUNTER_FIELDS)) return false;
  const evidence = snapshot.redactedDocument.evidence;
  if (!hasOnlyKeys(evidence, ["resourceHosts", "inlineScriptHints", "domMarkers"]) ||
      !hasExactCounterKeys(evidence.inlineScriptHints, SCRIPT_HINT_FIELDS) ||
      !hasExactCounterKeys(evidence.domMarkers, DOM_MARKER_FIELDS) ||
      !Array.isArray(evidence.resourceHosts) || evidence.resourceHosts.length > 160) return false;
  for (const resource of evidence.resourceHosts) {
    if (!hasOnlyKeys(resource, ["host", "thirdParty", "count", "tags"]) ||
        !isPublicTelemetryHostname(resource.host) || typeof resource.thirdParty !== "boolean" ||
        !isValidCount(resource.count) || !hasOnlyKeys(resource.tags, [...SAFE_REDACTED_TAGS]) ||
        !Object.values(resource.tags).every((value) => isValidCount(value))) return false;
  }
  if (containsForbiddenPayloadKey(snapshot)) return false;
  const serialized = JSON.stringify(snapshot);
  return serialized.length <= MAX_REDACTED_HTML_CHARS + 512 * 1024 &&
    !/"(?:wallet|privateKey|secretKey|visitId|origin|generatedAt|observedFrom|observedUntil|loadCompletedAt)"\s*:/i.test(serialized);
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
