import { isPublicTelemetryHostname, normalizeHostname } from "./core.js";

const TELEMETRY_BATCH_SCHEMA_VERSION = "veilance.telemetry-snapshot-batch.v1";
const TELEMETRY_IP_LOOKUP_TIMEOUT_MS = 10_000;

function isHostnameOnly(value) {
  const hostname = String(value || "");
  if (!hostname || hostname.length > 253 || /[\s/?#@]/.test(hostname)) return false;
  if (hostname.includes(":")) return /^[0-9a-f:.]+$/i.test(hostname);
  return hostname.split(".").every((label) => (
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ));
}

function normalizedIpv4(value) {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  if (!parts.every((part) => /^(?:0|[1-9][0-9]{0,2})$/.test(part))) return null;
  if (parts.some((part) => Number(part) > 255)) return null;
  return parts.join(".");
}

/**
 * Returns a normalized IP literal or null. Hostnames, ports, bracketed IPv6,
 * zone identifiers, and other non-address values are rejected.
 */
export function normalizeTelemetryIpAddress(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > 45) return null;

  if (!candidate.includes(":")) return normalizedIpv4(candidate);
  if (!/^[0-9a-f:.]+$/i.test(candidate)) return null;
  try {
    const parsed = new URL(`http://[${candidate}]/`);
    if (!parsed.hostname.startsWith("[") || !parsed.hostname.endsWith("]")) return null;
    return candidate.toLowerCase();
  } catch {
    return null;
  }
}

function ipAddressFromReport(report) {
  return normalizeTelemetryIpAddress(
    report?.output?.ip_address ??
    report?.output?.ip ??
    report?.ip_address ??
    report?.ip
  );
}

/**
 * Resolves the address observed by the configured Veilance API immediately
 * before uploading. This avoids WebRTC/STUN fingerprinting and third-party IP
 * services. The API response must contain output.ip_address (preferred) or a
 * compatible ip_address/ip field.
 */
export async function fetchTelemetryIpAddress({
  endpoint,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = TELEMETRY_IP_LOOKUP_TIMEOUT_MS
}) {
  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(String(endpoint || ""));
  } catch {
    throw new Error("A valid telemetry IP lookup endpoint is required");
  }
  if (!["http:", "https:"].includes(parsedEndpoint.protocol)) {
    throw new Error("Telemetry IP lookup requires an HTTP(S) endpoint");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("This browser cannot resolve the telemetry IP address");
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener?.("abort", abortFromCaller, { once: true });
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetchImpl(parsedEndpoint.href, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
    if (!response?.ok) {
      throw new Error(`Telemetry IP lookup returned HTTP ${response?.status || "unknown"}`);
    }

    let report;
    try {
      report = await response.json();
    } catch {
      throw new Error("Telemetry IP lookup returned an invalid JSON response");
    }
    const ipAddress = ipAddressFromReport(report);
    if (!ipAddress) {
      const message = String(
        report?.error?.error_string || "Telemetry IP lookup returned an invalid IP address"
      );
      throw new Error(message.slice(0, 500));
    }
    return ipAddress;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abortFromCaller);
  }
}

/**
 * Builds the exact multipart request body accepted by the Veilance telemetry
 * API. The telemetry part is a raw gzip byte stream, not Base64 text.
 */
export async function buildTelemetryMultipartUpload({
  records,
  clientId,
  walletAddress,
  batchId,
  ipAddress,
  CompressionStreamClass = globalThis.CompressionStream
}) {
  if (!Array.isArray(records) || !records.length) {
    throw new Error("At least one telemetry record is required");
  }
  if (typeof CompressionStreamClass !== "function") {
    throw new Error("This browser cannot create gzip telemetry uploads");
  }
  if (!/^[a-f0-9]{64}$/.test(String(clientId || ""))) {
    throw new Error("A valid telemetry client ID is required for telemetry uploads");
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(walletAddress || ""))) {
    throw new Error("A valid public Solana wallet address is required for telemetry uploads");
  }

  const domainName = normalizeHostname(records[0]?.payload?.site?.hostname);
  if (!isHostnameOnly(domainName) || !isPublicTelemetryHostname(domainName)) {
    throw new Error("A valid public hostname is required for telemetry uploads");
  }
  if (records.some((record) => normalizeHostname(record?.payload?.site?.hostname) !== domainName)) {
    throw new Error("A telemetry upload cannot contain snapshots from different hostnames");
  }
  const normalizedIpAddress = normalizeTelemetryIpAddress(ipAddress);
  if (!normalizedIpAddress) {
    throw new Error("A valid server-observed IP address is required for telemetry uploads");
  }

  const envelope = {
    schemaVersion: TELEMETRY_BATCH_SCHEMA_VERSION,
    batchId: String(batchId || ""),
    contributorId: String(clientId || ""),
    observations: records.map((record) => record.payload)
  };
  const json = JSON.stringify(envelope);
  const compressed = new Blob([json], { type: "application/json" })
    .stream()
    .pipeThrough(new CompressionStreamClass("gzip"));
  const gzipBytes = await new Response(compressed).arrayBuffer();

  const form = new FormData();
  form.append("client_id", String(clientId || ""));
  form.append("wallet_address", String(walletAddress));
  form.append("domain_name", domainName);
  form.append("ip_address", normalizedIpAddress);
  form.append(
    "telemetry",
    new Blob([gzipBytes], { type: "application/gzip" }),
    "telemetry.bin"
  );

  return {
    body: form,
    compressedBytes: gzipBytes.byteLength,
    uncompressedBytes: new TextEncoder().encode(json).byteLength
  };
}

export async function requireSuccessfulTelemetryUpload(response) {
  if (!response?.ok) {
    throw new Error(`Snapshot API returned HTTP ${response?.status || "unknown"}`);
  }

  let report;
  try {
    report = await response.json();
  } catch {
    throw new Error("Snapshot API returned an invalid JSON response");
  }

  if (report?.output?.ok !== true) {
    const message = String(report?.error?.error_string || "Snapshot API rejected the telemetry upload");
    throw new Error(message.slice(0, 500));
  }
  return report;
}
