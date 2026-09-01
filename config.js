export const VEILANCE_USE_PRODUCTION_API = true;
export const VEILANCE_DEVELOPMENT_API_ORIGIN = "http://10.0.10.211:5132";
export const VEILANCE_PRODUCTION_API_ORIGIN = "https://api.veilance.org";

export function veilanceApiOrigin(useProduction = VEILANCE_USE_PRODUCTION_API) {
  return useProduction
    ? VEILANCE_PRODUCTION_API_ORIGIN
    : VEILANCE_DEVELOPMENT_API_ORIGIN;
}

export function veilanceApiEndpoint(path, useProduction = VEILANCE_USE_PRODUCTION_API) {
  const normalizedPath = String(path || "").startsWith("/") ? String(path) : `/${String(path || "")}`;
  return `${veilanceApiOrigin(useProduction)}${normalizedPath}`;
}

export const VEILANCE_API_ORIGIN = veilanceApiOrigin();
export const TELEMETRY_UPLOAD_ENABLED = true;
export const TELEMETRY_UPLOAD_ENDPOINT = veilanceApiEndpoint("/api/v1/telemetry/upload");
export const TELEMETRY_IP_ADDRESS_ENDPOINT = veilanceApiEndpoint("/api/v1/telemetry/ip");
export const TELEMETRY_UPLOAD_ALLOW_INSECURE_HTTP = !VEILANCE_USE_PRODUCTION_API;
export const TELEMETRY_UPLOAD_BATCH_LIMIT = 20;
export const TELEMETRY_UPLOAD_MAX_BATCH_BYTES = 2 * 1024 * 1024;
export const PAYOUTS_ENABLED = false;

export const TRACKER_DATABASE_REPOSITORY = "https://github.com/VeilanceApp/Veilance-Tracker-DB";
export const TRACKER_DATABASE_ARCHIVE = "https://codeload.github.com/VeilanceApp/Veilance-Tracker-DB/tar.gz/refs/heads/main";
export const TRACKER_DATABASE_BUNDLE = "data/veilance-trackers.json";
export const TRACKER_UPDATE_INTERVAL_MINUTES = 8 * 60;

export const DETECTION_DATABASE_REPOSITORY = "https://github.com/VeilanceApp/Veilance-Detection-DB";
export const DETECTION_DATABASE_ARCHIVE = "https://codeload.github.com/VeilanceApp/Veilance-Detection-DB/tar.gz/refs/heads/main";
export const DETECTION_DATABASE_FOLDER = "veilance-json-detections";
export const DETECTION_UPDATE_INTERVAL_MINUTES = 8 * 60;

export const SHIELD_DATABASE_REPOSITORY = "https://github.com/VeilanceApp/Veilance-Shield-DB";
export const SHIELD_DATABASE_ARCHIVE = "https://codeload.github.com/VeilanceApp/Veilance-Shield-DB/tar.gz/refs/heads/main";
export const SHIELD_DATABASE_BUNDLE = "data/veilance-shields.json";
export const SHIELD_DATABASE_FOLDER = "veilance-json-shields";
export const SHIELD_UPDATE_INTERVAL_MINUTES = 8 * 60;
