import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";

import {
  diffTrackerSets,
  extractTrackerDocumentsFromTar,
  fetchJsonDatabaseArchive,
  fetchTrackerArchive,
  sha256Hex
} from "../lib/tracker-updater.js";

const encoder = new TextEncoder();

function writeAscii(target, offset, length, value) {
  target.set(encoder.encode(String(value)).subarray(0, length), offset);
}

function tarEntry(name, text) {
  const data = encoder.encode(text);
  const header = new Uint8Array(512);
  writeAscii(header, 0, 100, name);
  writeAscii(header, 100, 8, "0000644\0");
  writeAscii(header, 108, 8, "0000000\0");
  writeAscii(header, 116, 8, "0000000\0");
  writeAscii(header, 124, 12, `${data.length.toString(8).padStart(11, "0")}\0`);
  writeAscii(header, 136, 12, "00000000000\0");
  writeAscii(header, 148, 8, "        ");
  writeAscii(header, 156, 1, "0");
  writeAscii(header, 257, 6, "ustar\0");
  writeAscii(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  return [header, padded];
}

function tarArchive(entries) {
  const chunks = entries.flatMap(([name, text]) => tarEntry(name, text));
  chunks.push(new Uint8Array(1024));
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

test("TAR extraction reads only nested veilance-json-trackers JSON files", () => {
  const archive = tarArchive([
    ["Veilance-Tracker-DB-main/README.md", "ignored"],
    ["Veilance-Tracker-DB-main/veilance-json-trackers/advertising/one.json", '{"name":"One"}'],
    ["Veilance-Tracker-DB-main/veilance-json-trackers/site_analytics/two.json", '{"name":"Two"}']
  ]);
  const documents = extractTrackerDocumentsFromTar(archive);
  assert.deepEqual(documents.map((document) => document.sourceName), [
    "veilance-json-trackers/advertising/one.json",
    "veilance-json-trackers/site_analytics/two.json"
  ]);
});

test("TAR extraction supports the flat Veilance detection database folder", () => {
  const archive = tarArchive([
    ["Veilance-Detection-DB-main/README.md", "ignored"],
    ["Veilance-Detection-DB-main/veilance-json-detections/one.json", '{"id":"one"}'],
    ["Veilance-Detection-DB-main/veilance-json-detections/two.json", '{"id":"two"}'],
    ["Veilance-Detection-DB-main/other/three.json", '{"id":"three"}']
  ]);
  const documents = extractTrackerDocumentsFromTar(archive, "veilance-json-detections");
  assert.deepEqual(documents.map((document) => document.sourceName), [
    "veilance-json-detections/one.json",
    "veilance-json-detections/two.json"
  ]);
});

test("remote detection download uses the requested JSON folder", async () => {
  const archive = tarArchive([
    ["Veilance-Detection-DB-main/veilance-json-detections/test.json", '{"id":"test"}']
  ]);
  const compressed = gzipSync(archive);
  const result = await fetchJsonDatabaseArchive(
    "https://example.test/detections.tar.gz",
    "veilance-json-detections",
    async () => new Response(compressed, {
      status: 200,
      headers: { "content-length": String(compressed.length), etag: '"detection-revision"' }
    })
  );
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].sourceName, "veilance-json-detections/test.json");
  assert.equal(result.etag, '"detection-revision"');
});

test("remote tracker download verifies, decompresses, and hashes the archive", async () => {
  const archive = tarArchive([
    ["Veilance-Tracker-DB-main/veilance-json-trackers/misc/test.json", '{"name":"Test"}']
  ]);
  const compressed = gzipSync(archive);
  const result = await fetchTrackerArchive("https://example.test/trackers.tar.gz", async () => new Response(compressed, {
    status: 200,
    headers: { "content-length": String(compressed.length), etag: '"test-revision"' }
  }));
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].sourceName, "veilance-json-trackers/misc/test.json");
  assert.equal(result.archiveSha256, await sha256Hex(compressed));
  assert.equal(result.etag, '"test-revision"');
});

test("tracker diffs report additions, changes, and removals", () => {
  assert.deepEqual(diffTrackerSets(
    [{ id: "one", name: "Old" }, { id: "removed", name: "Removed" }],
    [{ id: "one", name: "New" }, { id: "added", name: "Added" }]
  ), { added: 1, updated: 1, removed: 1 });
});
