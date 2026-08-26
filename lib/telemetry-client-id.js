export const TELEMETRY_CLIENT_ID_STORAGE_KEY = "veilanceTelemetryClientIdentityV1";
export const LEGACY_TELEMETRY_CONTRIBUTOR_ID_STORAGE_KEY = "veilanceTelemetryContributorIdV1";

const IDENTITY_SCHEMA_VERSION = 1;
const CLIENT_ID_PATTERN = /^[a-f0-9]{64}$/;
const ENVIRONMENT_HASH_PATTERN = /^[a-f0-9]{64}$/;

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function cleanPlatformToken(value, fallback = "unknown") {
  const token = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return token || fallback;
}

export function isValidTelemetryClientId(value) {
  return CLIENT_ID_PATTERN.test(String(value || ""));
}

export function detectBrowserFamily(navigatorObject = globalThis.navigator) {
  if (navigatorObject?.brave) return "brave";

  const brands = Array.isArray(navigatorObject?.userAgentData?.brands)
    ? navigatorObject.userAgentData.brands.map((entry) => String(entry?.brand || "").toLowerCase()).join(" ")
    : "";
  const userAgent = String(navigatorObject?.userAgent || "").toLowerCase();
  const browserText = `${brands} ${userAgent}`;

  if (/microsoft edge|\bedg(?:e|a|ios)?\//.test(browserText)) return "edge";
  if (/opera|\bopr\//.test(browserText)) return "opera";
  if (/firefox|\bfxios\//.test(browserText)) return "firefox";
  if (/google chrome|\bchrome\//.test(browserText)) return "chrome";
  if (/chromium/.test(browserText)) return "chromium";
  if (/safari/.test(browserText)) return "safari";
  return "unknown";
}

function navigatorOs(navigatorObject) {
  const value = [
    navigatorObject?.userAgentData?.platform,
    navigatorObject?.platform,
    navigatorObject?.userAgent
  ].filter(Boolean).join(" ").toLowerCase();
  if (/windows|win32|win64/.test(value)) return "win";
  if (/android/.test(value)) return "android";
  if (/cros|chrome os/.test(value)) return "cros";
  if (/iphone|ipad|ipod|ios/.test(value)) return "ios";
  if (/macintosh|macintel|mac os/.test(value)) return "mac";
  if (/linux/.test(value)) return "linux";
  return "unknown";
}

export async function collectTelemetryClientEnvironment({
  runtime = globalThis.chrome?.runtime,
  navigatorObject = globalThis.navigator
} = {}) {
  let platform = null;
  if (typeof runtime?.getPlatformInfo === "function") {
    try {
      platform = await runtime.getPlatformInfo();
    } catch {
      platform = null;
    }
  }

  return {
    browserFamily: detectBrowserFamily(navigatorObject),
    os: cleanPlatformToken(platform?.os || navigatorOs(navigatorObject)),
    arch: cleanPlatformToken(platform?.arch),
    naclArch: cleanPlatformToken(platform?.nacl_arch)
  };
}

async function sha256Hex(value, cryptoObject) {
  if (typeof cryptoObject?.subtle?.digest !== "function") {
    throw new Error("The browser does not provide SHA-256 support");
  }
  const digest = await cryptoObject.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function randomClientId(cryptoObject) {
  if (typeof cryptoObject?.getRandomValues !== "function") {
    throw new Error("The browser does not provide a secure random generator");
  }
  const bytes = new Uint8Array(32);
  cryptoObject.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function validIdentityRecord(value) {
  return Boolean(
    value &&
    value.schemaVersion === IDENTITY_SCHEMA_VERSION &&
    isValidTelemetryClientId(value.clientId) &&
    ENVIRONMENT_HASH_PATTERN.test(String(value.environmentHash || ""))
  );
}

/**
 * Returns the stable, pseudonymous telemetry client id for this extension
 * profile. Only a hash of coarse browser/platform data is retained locally.
 * The random id is rotated when that hash changes; neither the hash nor its
 * source fields are included in telemetry uploads.
 */
export async function ensureTelemetryClientIdentity({
  storageArea = globalThis.chrome?.storage?.local,
  runtime = globalThis.chrome?.runtime,
  navigatorObject = globalThis.navigator,
  cryptoObject = globalThis.crypto,
  storedValues = null
} = {}) {
  if (!storageArea || typeof storageArea.get !== "function" || typeof storageArea.set !== "function") {
    throw new Error("Extension-local storage is unavailable");
  }

  const environment = await collectTelemetryClientEnvironment({ runtime, navigatorObject });
  const environmentHash = await sha256Hex(
    `veilance.telemetry-client-environment.v1\n${JSON.stringify(environment)}`,
    cryptoObject
  );
  const stored = storedValues || await storageArea.get([
    TELEMETRY_CLIENT_ID_STORAGE_KEY,
    LEGACY_TELEMETRY_CONTRIBUTOR_ID_STORAGE_KEY
  ]);
  const existing = stored?.[TELEMETRY_CLIENT_ID_STORAGE_KEY];
  const legacyClientId = stored?.[LEGACY_TELEMETRY_CONTRIBUTOR_ID_STORAGE_KEY];

  let clientId;
  let status;
  if (validIdentityRecord(existing) && existing.environmentHash === environmentHash) {
    clientId = existing.clientId;
    status = "existing";
  } else if (validIdentityRecord(existing)) {
    clientId = randomClientId(cryptoObject);
    status = "rotated";
  } else if (isValidTelemetryClientId(legacyClientId)) {
    clientId = legacyClientId;
    status = "migrated";
  } else {
    clientId = randomClientId(cryptoObject);
    status = "created";
  }

  const identity = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    clientId,
    environmentHash
  };
  const identityIsCurrent = validIdentityRecord(existing) &&
    existing.clientId === identity.clientId &&
    existing.environmentHash === identity.environmentHash;
  if (!identityIsCurrent || legacyClientId !== clientId) {
    await storageArea.set({
      [TELEMETRY_CLIENT_ID_STORAGE_KEY]: identity,
      [LEGACY_TELEMETRY_CONTRIBUTOR_ID_STORAGE_KEY]: clientId
    });
  }

  return { clientId, status };
}
