// Snapshot uploading and payouts are intentionally disabled in v0.6.0.
// The snapshot API contract is implemented, but no request is made until this
// build gate is enabled and the user separately opts in from Settings.
export const TELEMETRY_UPLOAD_ENABLED = false;
export const TELEMETRY_UPLOAD_ENDPOINT = "https://api.veilance.com/v1/telemetry/snapshots";
export const TELEMETRY_UPLOAD_BATCH_LIMIT = 20;
export const TELEMETRY_UPLOAD_MAX_BATCH_BYTES = 2 * 1024 * 1024;
export const PAYOUTS_ENABLED = false;

export const TRACKER_DATABASE_REPOSITORY = "https://github.com/VeilanceApp/Veilance-Tracker-DB";
export const TRACKER_DATABASE_ARCHIVE = "https://codeload.github.com/VeilanceApp/Veilance-Tracker-DB/tar.gz/refs/heads/main";
export const TRACKER_DATABASE_BUNDLE = "data/veilance-trackers.json";
export const TRACKER_UPDATE_INTERVAL_MINUTES = 8 * 60;
