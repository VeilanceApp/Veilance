import test from "node:test";
import assert from "node:assert/strict";

import sqlite3InitModule from "../vendor/sqlite/sqlite3-node.mjs";
import { createEmptyState } from "../lib/core.js";
import { SqliteVisitStore } from "../lib/sqlite-visits.js";

function visit(number) {
  const startedAt = 1000 + number * 100;
  const state = createEmptyState(number, `https://site-${number}.example/private?q=secret`, startedAt, {
    visitId: `visit-${number}`,
    navigationId: `navigation-${number}`
  });
  state.network.totalRequests = number;
  state.updatedAt = startedAt + 50;
  state.endedAt = startedAt + 60;
  state.active = false;
  return state;
}

function summary(number) {
  return {
    findingCount: number % 3,
    status: number % 3 ? "observed" : "quiet",
    label: number % 3 ? "Privacy-relevant activity observed" : "No notable signals"
  };
}

test("SQLite history keeps only the 20 newest visits and returns full state", async () => {
  let saved = null;
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  const store = new SqliteVisitStore(sqlite3, {
    load: async () => saved,
    save: async (bytes) => { saved = bytes.slice(); }
  }, { filename: "history-cap.sqlite3", maxVisits: 20 });

  for (let number = 1; number <= 25; number += 1) {
    await store.upsert(visit(number), summary(number));
  }

  const rows = await store.listSummaries(20);
  assert.equal(rows.length, 20);
  assert.equal(rows[0].visitId, "visit-25");
  assert.equal(rows.at(-1).visitId, "visit-6");
  assert.equal(await store.get("visit-5"), null);
  assert.equal((await store.get("visit-25")).hostname, "site-25.example");
  assert.equal(new TextDecoder().decode(saved.subarray(0, 16)), "SQLite format 3\u0000");
  await store.close();
});

test("serialized SQLite bytes restore history after a runtime restart", async () => {
  let saved = null;
  const persistence = {
    load: async () => saved?.slice() || null,
    save: async (bytes) => { saved = bytes.slice(); }
  };

  const firstSqlite = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  const first = new SqliteVisitStore(firstSqlite, persistence, {
    filename: "history-restore.sqlite3",
    maxVisits: 20
  });
  await first.upsert(visit(7), summary(7));
  await first.close();

  const secondSqlite = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  const second = new SqliteVisitStore(secondSqlite, persistence, {
    filename: "history-restore.sqlite3",
    maxVisits: 20
  });
  const restored = await second.get("visit-7");
  assert.equal(restored.hostname, "site-7.example");
  assert.equal((await second.info()).visitCount, 1);
  await second.close();
});

test("active rows without a restored browser tab are finalized at their last observation", async () => {
  let saved = null;
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  const store = new SqliteVisitStore(sqlite3, {
    load: async () => saved,
    save: async (bytes) => { saved = bytes.slice(); }
  }, { filename: "history-orphans.sqlite3", maxVisits: 20 });
  const state = createEmptyState(1, "https://active.example", 1000, {
    visitId: "active-visit",
    navigationId: "active-navigation"
  });
  state.updatedAt = 1450;
  await store.upsert(state, summary(1));
  assert.equal(await store.finalizeOrphaned([]), 1);
  const finalized = await store.get("active-visit");
  assert.equal(finalized.active, false);
  assert.equal(finalized.endedAt, 1450);
  await store.close();
});

test("SQLite snapshot vault stores payloads separately, prunes old rows, and persists upload state", async () => {
  let saved = null;
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  const store = new SqliteVisitStore(sqlite3, {
    load: async () => saved,
    save: async (bytes) => { saved = bytes.slice(); }
  }, { filename: "snapshot-vault.sqlite3", maxVisits: 20, maxSnapshots: 3 });

  for (let number = 1; number <= 4; number += 1) {
    await store.upsertSnapshot({
      snapshotId: `snapshot-${number}`,
      hostname: `site-${number}.example`,
      createdAt: 1000 + number,
      payload: {
        schemaVersion: "veilance.telemetry-snapshot.v2",
        eventId: `event-${number}`,
        site: { hostname: `site-${number}.example`, https: true },
        interest: {
          score: 20,
          level: "interesting",
          minimumScore: 20,
          eligible: true,
          reasons: [{ id: "canvas-readback", severity: "medium", points: 20 }]
        },
        redactedDocument: {
          format: "veilance.redacted-html.v1",
          html: "<!doctype html>\n<html><body>[REDACTED TEXT]</body></html>"
        }
      }
    });
  }

  const summaries = await store.listSnapshotSummaries();
  assert.deepEqual(summaries.map((item) => item.snapshotId), ["snapshot-4", "snapshot-3", "snapshot-2"]);
  assert.equal(summaries[0].interest.score, 20);
  assert.equal(summaries[0].interest.eligible, true);
  assert.equal(await store.getSnapshot("snapshot-1"), null);
  assert.equal((await store.getSnapshot("snapshot-4")).payload.eventId, "event-4");

  await store.updateSnapshotUpload("snapshot-4", {
    status: "queued",
    nextAttemptAt: 2000
  });
  const due = await store.listDueSnapshotUploads(2000, 20);
  assert.equal(due.length, 1);
  assert.equal(due[0].snapshotId, "snapshot-4");

  await store.upsertSnapshot({
    snapshotId: "legacy-snapshot",
    hostname: "legacy.example",
    createdAt: 2000,
    payload: {
      schemaVersion: "veilance.telemetry-snapshot.v1",
      eventId: "legacy-event",
      site: { hostname: "legacy.example", https: true },
      redactedDocument: {
        format: "veilance.redacted-html.v1",
        html: "<!doctype html>\n<html><body>[REDACTED TEXT]</body></html>"
      }
    }
  });
  assert.equal(await store.queueAllSnapshots(3000), 1);
  const afterQueueAll = await store.listSnapshotSummaries();
  assert.equal(afterQueueAll.find((item) => item.snapshotId === "legacy-snapshot").upload.status, "local");
  assert.equal(afterQueueAll.find((item) => item.snapshotId === "snapshot-3").upload.status, "queued");
  assert.equal((await store.info()).snapshotCount, 3);
  await store.close();
});
