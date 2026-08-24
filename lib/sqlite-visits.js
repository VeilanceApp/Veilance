const SQLITE_HEADER = "SQLite format 3\u0000";

function isSqliteDatabase(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < SQLITE_HEADER.length) return false;
  return [...SQLITE_HEADER].every((character, index) => bytes[index] === character.charCodeAt(0));
}

function finiteInteger(value, fallback = 0) {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function safeLimit(value, maximum) {
  return Math.max(1, Math.min(maximum, finiteInteger(value, maximum)));
}

export class SqliteVisitStore {
  #db = null;
  #writeQueue = Promise.resolve();

  constructor(sqlite3, persistence, options = {}) {
    if (!sqlite3?.oo1?.DB || !sqlite3?.capi?.sqlite3_js_db_export) {
      throw new Error("A compatible SQLite WebAssembly module is required");
    }
    if (typeof persistence?.load !== "function" || typeof persistence?.save !== "function") {
      throw new Error("SQLite persistence requires load and save functions");
    }
    this.sqlite3 = sqlite3;
    this.persistence = persistence;
    this.filename = String(options.filename || "veilance-history.sqlite3").replace(/[^a-z0-9._-]/gi, "-");
    this.maxVisits = safeLimit(options.maxVisits || 20, 100);
    this.maxSnapshots = safeLimit(options.maxSnapshots || 20, 100);
    this.ready = this.#initialize();
  }

  async #initialize() {
    const saved = await this.persistence.load();
    if (isSqliteDatabase(saved)) {
      this.sqlite3.capi.sqlite3_js_posix_create_file(this.filename, saved, saved.byteLength);
    }
    this.#db = new this.sqlite3.oo1.DB(this.filename, "c");
    this.#db.exec(`
      PRAGMA journal_mode=MEMORY;
      PRAGMA synchronous=OFF;
      CREATE TABLE IF NOT EXISTS visits (
        visit_id TEXT PRIMARY KEY NOT NULL,
        tab_id INTEGER NOT NULL,
        origin TEXT,
        hostname TEXT,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ended_at INTEGER,
        load_completed_at INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        request_count INTEGER NOT NULL DEFAULT 0,
        signal_count INTEGER NOT NULL DEFAULT 0,
        finding_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        label TEXT NOT NULL,
        state_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS visits_recent_idx
        ON visits(COALESCE(ended_at, updated_at) DESC, started_at DESC);
      CREATE TABLE IF NOT EXISTS telemetry_snapshots (
        snapshot_id TEXT PRIMARY KEY NOT NULL,
        event_id TEXT UNIQUE NOT NULL,
        hostname TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        upload_status TEXT NOT NULL DEFAULT 'local',
        upload_attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER,
        last_attempt_at INTEGER,
        uploaded_at INTEGER,
        last_error TEXT,
        snapshot_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS telemetry_snapshots_recent_idx
        ON telemetry_snapshots(created_at DESC);
      CREATE INDEX IF NOT EXISTS telemetry_snapshots_upload_idx
        ON telemetry_snapshots(upload_status, next_attempt_at);
    `);
    if (!isSqliteDatabase(saved)) await this.#persist();
    return this;
  }

  async #persist() {
    const bytes = this.sqlite3.capi.sqlite3_js_db_export(this.#db.pointer);
    await this.persistence.save(bytes);
  }

  #enqueueWrite(operation) {
    const result = this.#writeQueue.then(async () => {
      await this.ready;
      const value = operation(this.#db);
      await this.#persist();
      return value;
    });
    this.#writeQueue = result.catch(() => {});
    return result;
  }

  async #afterWrites() {
    await this.ready;
    await this.#writeQueue;
  }

  upsert(state, summary) {
    if (!state?.visitId) return Promise.reject(new Error("Visit state is missing visitId"));
    const signalCount = Object.values(state.signals || {}).reduce(
      (total, signal) => total + finiteInteger(signal?.count),
      0
    );
    const serialized = JSON.stringify(state);
    return this.#enqueueWrite((db) => {
      db.transaction(() => {
        db.exec({
          sql: `
            INSERT INTO visits (
              visit_id, tab_id, origin, hostname, started_at, updated_at, ended_at,
              load_completed_at, active, request_count, signal_count, finding_count,
              status, label, state_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(visit_id) DO UPDATE SET
              tab_id=excluded.tab_id,
              origin=excluded.origin,
              hostname=excluded.hostname,
              started_at=excluded.started_at,
              updated_at=excluded.updated_at,
              ended_at=excluded.ended_at,
              load_completed_at=excluded.load_completed_at,
              active=excluded.active,
              request_count=excluded.request_count,
              signal_count=excluded.signal_count,
              finding_count=excluded.finding_count,
              status=excluded.status,
              label=excluded.label,
              state_json=excluded.state_json
          `,
          bind: [
            String(state.visitId),
            finiteInteger(state.tabId, -1),
            state.origin || null,
            state.hostname || null,
            finiteInteger(state.startedAt),
            finiteInteger(state.updatedAt),
            Number.isFinite(state.endedAt) ? finiteInteger(state.endedAt) : null,
            Number.isFinite(state.loadCompletedAt) ? finiteInteger(state.loadCompletedAt) : null,
            state.active === false ? 0 : 1,
            finiteInteger(state.network?.totalRequests),
            signalCount,
            finiteInteger(summary?.findingCount),
            String(summary?.status || "quiet"),
            String(summary?.label || "No notable signals"),
            serialized
          ]
        });
        db.exec(`
          DELETE FROM visits
          WHERE visit_id NOT IN (
            SELECT visit_id FROM visits
            ORDER BY COALESCE(ended_at, updated_at) DESC, started_at DESC
            LIMIT ${this.maxVisits}
          )
        `);
      });
    });
  }

  async listSummaries(limit = this.maxVisits) {
    await this.#afterWrites();
    return this.#db.selectObjects(
      `
        SELECT visit_id, hostname, origin, started_at, updated_at, ended_at,
               load_completed_at, active, request_count, signal_count,
               finding_count, status, label
        FROM visits
        ORDER BY COALESCE(ended_at, updated_at) DESC, started_at DESC
        LIMIT ?
      `,
      [safeLimit(limit, this.maxVisits)]
    ).map((row) => ({
      visitId: row.visit_id,
      hostname: row.hostname,
      origin: row.origin,
      startedAt: Number(row.started_at),
      updatedAt: Number(row.updated_at),
      endedAt: row.ended_at === null ? null : Number(row.ended_at),
      loadCompletedAt: row.load_completed_at === null ? null : Number(row.load_completed_at),
      active: Boolean(row.active),
      requestCount: Number(row.request_count),
      signalCount: Number(row.signal_count),
      findingCount: Number(row.finding_count),
      status: row.status,
      label: row.label
    }));
  }

  async get(visitId) {
    await this.#afterWrites();
    const row = this.#db.selectObject(
      "SELECT state_json FROM visits WHERE visit_id = ? LIMIT 1",
      [String(visitId || "")]
    );
    if (!row?.state_json) return null;
    try {
      return JSON.parse(row.state_json);
    } catch {
      return null;
    }
  }

  upsertSnapshot(record) {
    const snapshotId = String(record?.snapshotId || "").slice(0, 100);
    const eventId = String(record?.payload?.eventId || "").slice(0, 100);
    const hostname = String(record?.hostname || record?.payload?.site?.hostname || "").slice(0, 253);
    if (!snapshotId || !eventId || !hostname || !record?.payload) {
      return Promise.reject(new Error("Telemetry snapshot metadata is incomplete"));
    }
    const serialized = JSON.stringify(record.payload);
    const sizeBytes = new TextEncoder().encode(serialized).byteLength;
    if (sizeBytes > 1024 * 1024) return Promise.reject(new Error("Telemetry snapshot exceeds the 1 MiB local limit"));
    const createdAt = finiteInteger(record.createdAt, Date.now());
    return this.#enqueueWrite((db) => {
      db.transaction(() => {
        db.exec({
          sql: `
            INSERT INTO telemetry_snapshots (
              snapshot_id, event_id, hostname, created_at, size_bytes,
              upload_status, upload_attempts, snapshot_json
            ) VALUES (?, ?, ?, ?, ?, 'local', 0, ?)
            ON CONFLICT(snapshot_id) DO UPDATE SET
              event_id=excluded.event_id,
              hostname=excluded.hostname,
              created_at=excluded.created_at,
              size_bytes=excluded.size_bytes,
              snapshot_json=excluded.snapshot_json
          `,
          bind: [snapshotId, eventId, hostname, createdAt, sizeBytes, serialized]
        });
        db.exec(`
          DELETE FROM telemetry_snapshots
          WHERE snapshot_id NOT IN (
            SELECT snapshot_id FROM telemetry_snapshots
            ORDER BY created_at DESC
            LIMIT ${this.maxSnapshots}
          )
        `);
      });
    });
  }

  async listSnapshotSummaries(limit = this.maxSnapshots) {
    await this.#afterWrites();
    return this.#db.selectObjects(
      `
        SELECT snapshot_id, event_id, hostname, created_at, size_bytes,
               upload_status, upload_attempts, next_attempt_at, last_attempt_at,
               uploaded_at, last_error
        FROM telemetry_snapshots
        ORDER BY created_at DESC
        LIMIT ?
      `,
      [safeLimit(limit, this.maxSnapshots)]
    ).map((row) => this.#snapshotSummary(row));
  }

  async getSnapshot(snapshotId) {
    await this.#afterWrites();
    const row = this.#db.selectObject(
      `
        SELECT snapshot_id, event_id, hostname, created_at, size_bytes,
               upload_status, upload_attempts, next_attempt_at, last_attempt_at,
               uploaded_at, last_error, snapshot_json
        FROM telemetry_snapshots
        WHERE snapshot_id = ?
        LIMIT 1
      `,
      [String(snapshotId || "")]
    );
    if (!row?.snapshot_json) return null;
    let payload;
    try {
      payload = JSON.parse(row.snapshot_json);
    } catch {
      return null;
    }
    return { ...this.#snapshotSummary(row), payload };
  }

  deleteSnapshot(snapshotId) {
    return this.#enqueueWrite((db) => {
      db.exec({ sql: "DELETE FROM telemetry_snapshots WHERE snapshot_id = ?", bind: [String(snapshotId || "")] });
    });
  }

  clearSnapshots() {
    return this.#enqueueWrite((db) => db.exec("DELETE FROM telemetry_snapshots"));
  }

  updateSnapshotUpload(snapshotId, patch = {}) {
    const allowedStatus = new Set(["local", "queued", "uploading", "failed", "uploaded", "blocked"]);
    return this.#enqueueWrite((db) => {
      const row = db.selectObject(
        `SELECT upload_status, upload_attempts, next_attempt_at, last_attempt_at, uploaded_at, last_error
         FROM telemetry_snapshots WHERE snapshot_id = ? LIMIT 1`,
        [String(snapshotId || "")]
      );
      if (!row) return false;
      const status = allowedStatus.has(patch.status) ? patch.status : String(row.upload_status || "local");
      const attempts = patch.attempts === undefined
        ? finiteInteger(row.upload_attempts)
        : Math.max(0, finiteInteger(patch.attempts));
      const nullableInteger = (value, fallback) => value === undefined
        ? fallback
        : (value === null ? null : finiteInteger(value));
      const nextAttemptAt = nullableInteger(patch.nextAttemptAt, row.next_attempt_at === null ? null : Number(row.next_attempt_at));
      const lastAttemptAt = nullableInteger(patch.lastAttemptAt, row.last_attempt_at === null ? null : Number(row.last_attempt_at));
      const uploadedAt = nullableInteger(patch.uploadedAt, row.uploaded_at === null ? null : Number(row.uploaded_at));
      const lastError = patch.lastError === undefined
        ? (row.last_error || null)
        : (patch.lastError === null ? null : String(patch.lastError).slice(0, 500));
      db.exec({
        sql: `
          UPDATE telemetry_snapshots
          SET upload_status = ?, upload_attempts = ?, next_attempt_at = ?,
              last_attempt_at = ?, uploaded_at = ?, last_error = ?
          WHERE snapshot_id = ?
        `,
        bind: [status, attempts, nextAttemptAt, lastAttemptAt, uploadedAt, lastError, String(snapshotId || "")]
      });
      return true;
    });
  }

  queueAllSnapshots(nextAttemptAt) {
    return this.#enqueueWrite((db) => {
      const count = Number(db.selectValue(`
        SELECT COUNT(*) FROM telemetry_snapshots
        WHERE upload_status IN ('local', 'failed')
      `) || 0);
      db.exec({
        sql: `
          UPDATE telemetry_snapshots
          SET upload_status = 'queued', next_attempt_at = ?, last_error = NULL
          WHERE upload_status IN ('local', 'failed')
        `,
        bind: [finiteInteger(nextAttemptAt, Date.now())]
      });
      return count;
    });
  }

  async listDueSnapshotUploads(now = Date.now(), limit = 20) {
    await this.#afterWrites();
    const rows = this.#db.selectObjects(
      `
        SELECT snapshot_id, event_id, hostname, created_at, size_bytes,
               upload_status, upload_attempts, next_attempt_at, last_attempt_at,
               uploaded_at, last_error, snapshot_json
        FROM telemetry_snapshots
        WHERE upload_status IN ('queued', 'failed')
          AND COALESCE(next_attempt_at, 0) <= ?
        ORDER BY COALESCE(next_attempt_at, 0), created_at
        LIMIT ?
      `,
      [finiteInteger(now), safeLimit(limit, 20)]
    );
    const results = [];
    for (const row of rows) {
      try {
        results.push({ ...this.#snapshotSummary(row), payload: JSON.parse(row.snapshot_json) });
      } catch {
        // A malformed local record cannot be uploaded.
      }
    }
    return results;
  }

  async nextSnapshotUploadAt() {
    await this.#afterWrites();
    const value = this.#db.selectValue(`
      SELECT MIN(COALESCE(next_attempt_at, 0))
      FROM telemetry_snapshots
      WHERE upload_status IN ('queued', 'failed')
    `);
    return value === null || value === undefined ? null : Number(value);
  }

  recoverInterruptedSnapshotUploads(now = Date.now()) {
    return this.#enqueueWrite((db) => {
      db.exec({
        sql: `
          UPDATE telemetry_snapshots
          SET upload_status = 'failed', next_attempt_at = ?,
              last_error = 'Previous upload was interrupted before completion.'
          WHERE upload_status = 'uploading'
        `,
        bind: [finiteInteger(now)]
      });
    });
  }

  #snapshotSummary(row) {
    return {
      snapshotId: row.snapshot_id,
      eventId: row.event_id,
      hostname: row.hostname,
      createdAt: Number(row.created_at),
      sizeBytes: Number(row.size_bytes),
      upload: {
        status: row.upload_status,
        attempts: Number(row.upload_attempts),
        nextAttemptAt: row.next_attempt_at === null ? null : Number(row.next_attempt_at),
        lastAttemptAt: row.last_attempt_at === null ? null : Number(row.last_attempt_at),
        uploadedAt: row.uploaded_at === null ? null : Number(row.uploaded_at),
        lastError: row.last_error || null
      }
    };
  }

  delete(visitId) {
    return this.#enqueueWrite((db) => {
      db.exec({ sql: "DELETE FROM visits WHERE visit_id = ?", bind: [String(visitId || "")] });
    });
  }

  finalizeOrphaned(activeVisitIds = []) {
    const active = new Set([...activeVisitIds].map(String));
    return this.#enqueueWrite((db) => {
      const rows = db.selectObjects("SELECT visit_id, state_json FROM visits WHERE active = 1");
      let finalized = 0;
      db.transaction(() => {
        for (const row of rows) {
          if (active.has(String(row.visit_id))) continue;
          let state;
          try {
            state = JSON.parse(row.state_json);
          } catch {
            state = null;
          }
          const endedAt = finiteInteger(state?.updatedAt, finiteInteger(state?.startedAt, Date.now()));
          if (state) {
            state.active = false;
            state.endedAt = endedAt;
            state.updatedAt = endedAt;
          }
          db.exec({
            sql: "UPDATE visits SET active = 0, ended_at = ?, updated_at = ?, state_json = ? WHERE visit_id = ?",
            bind: [endedAt, endedAt, state ? JSON.stringify(state) : row.state_json, String(row.visit_id)]
          });
          finalized += 1;
        }
      });
      return finalized;
    });
  }

  clear() {
    return this.#enqueueWrite((db) => db.exec("DELETE FROM visits"));
  }

  async info() {
    await this.#afterWrites();
    return {
      engine: "SQLite WASM",
      sqliteVersion: this.sqlite3.version?.libVersion || "unknown",
      visitCount: Number(this.#db.selectValue("SELECT COUNT(*) FROM visits") || 0),
      maximumVisits: this.maxVisits,
      snapshotCount: Number(this.#db.selectValue("SELECT COUNT(*) FROM telemetry_snapshots") || 0),
      maximumSnapshots: this.maxSnapshots
    };
  }

  async close() {
    await this.#afterWrites();
    this.#db?.close();
    this.#db = null;
  }
}
