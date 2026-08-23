const TAR_BLOCK_BYTES = 512;
const MAX_COMPRESSED_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_TRACKER_FILE_BYTES = 256 * 1024;
const MAX_TRACKER_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_TRACKER_FILES = 5000;

const decoder = new TextDecoder();

function headerText(bytes, offset, length) {
  const end = Math.min(bytes.length, offset + length);
  let stop = offset;
  while (stop < end && bytes[stop] !== 0) stop += 1;
  return decoder.decode(bytes.subarray(offset, stop)).trim();
}

function tarSize(bytes, offset) {
  const value = headerText(bytes, offset, 12).replace(/\0/g, "").trim();
  if (!value) return 0;
  if (!/^[0-7]+$/.test(value)) throw new Error("Tracker archive contains an invalid TAR size field");
  const size = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Tracker archive contains an unsafe TAR entry size");
  return size;
}

function paxPath(bytes) {
  const text = decoder.decode(bytes).replace(/\0+$/g, "");
  for (const line of text.split("\n")) {
    const separator = line.indexOf(" ");
    const value = separator >= 0 ? line.slice(separator + 1) : line;
    if (value.startsWith("path=")) return value.slice(5);
  }
  return "";
}

function canonicalTrackerPath(name, folderName) {
  const normalized = String(name || "").replaceAll("\\", "/").replace(/^\.\//, "");
  const padded = `/${normalized}`;
  const marker = `/${folderName}/`;
  const markerOffset = padded.indexOf(marker);
  if (markerOffset < 0 || !normalized.toLowerCase().endsWith(".json")) return "";
  const relative = padded.slice(markerOffset + 1);
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return "";
  return relative;
}

export function extractTrackerDocumentsFromTar(buffer, folderName = "veilance-json-trackers") {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const documents = [];
  let relevantBytes = 0;
  let offset = 0;
  let pendingPath = "";

  while (offset + TAR_BLOCK_BYTES <= bytes.length) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (header.every((value) => value === 0)) break;

    const name = headerText(header, 0, 100);
    const prefix = headerText(header, 345, 155);
    const size = tarSize(header, 124);
    const type = String.fromCharCode(header[156] || 0);
    const dataOffset = offset + TAR_BLOCK_BYTES;
    const dataEnd = dataOffset + size;
    if (dataEnd > bytes.length) throw new Error("Tracker archive ended inside a TAR entry");
    const data = bytes.subarray(dataOffset, dataEnd);

    if (type === "x") {
      pendingPath = paxPath(data) || pendingPath;
    } else if (type === "L") {
      pendingPath = decoder.decode(data).replace(/\0.*$/s, "").trim();
    } else if (type === "0" || type === "\0") {
      const entryName = pendingPath || (prefix ? `${prefix}/${name}` : name);
      const sourceName = canonicalTrackerPath(entryName, folderName);
      if (sourceName) {
        if (size > MAX_TRACKER_FILE_BYTES) {
          throw new Error(`${sourceName} is larger than the 256 KB tracker limit`);
        }
        relevantBytes += size;
        if (relevantBytes > MAX_TRACKER_TOTAL_BYTES) {
          throw new Error("Tracker JSON data exceeds the 24 MB safety limit");
        }
        if (documents.length >= MAX_TRACKER_FILES) {
          throw new Error(`Tracker archive contains more than ${MAX_TRACKER_FILES} JSON files`);
        }
        documents.push({ sourceName, text: decoder.decode(data) });
      }
      pendingPath = "";
    } else if (type !== "g") {
      pendingPath = "";
    }

    offset = dataOffset + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  }

  documents.sort((left, right) => left.sourceName.localeCompare(right.sourceName));
  if (!documents.length) {
    throw new Error(`Tracker archive does not contain ${folderName}/*.json records`);
  }
  return documents;
}

async function readStreamWithLimit(stream, maximumBytes) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("Expanded tracker archive exceeds the 64 MB safety limit");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fetchTrackerArchive(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { cache: "no-store", redirect: "follow" });
  if (!response.ok) throw new Error(`Tracker repository returned HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_COMPRESSED_ARCHIVE_BYTES) {
    throw new Error("Compressed tracker archive exceeds the 8 MB safety limit");
  }
  const compressed = new Uint8Array(await response.arrayBuffer());
  if (!compressed.length || compressed.byteLength > MAX_COMPRESSED_ARCHIVE_BYTES) {
    throw new Error("Downloaded tracker archive is empty or exceeds the 8 MB safety limit");
  }
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser does not support secure gzip decompression for tracker updates");
  }

  const expanded = await readStreamWithLimit(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")),
    MAX_EXPANDED_ARCHIVE_BYTES
  );
  return {
    archiveSha256: await sha256Hex(compressed),
    etag: String(response.headers.get("etag") || "").slice(0, 160),
    documents: extractTrackerDocumentsFromTar(expanded)
  };
}

export function diffTrackerSets(previous, next) {
  const before = new Map((previous || []).map((indicator) => [indicator.id, JSON.stringify(indicator)]));
  const after = new Map((next || []).map((indicator) => [indicator.id, JSON.stringify(indicator)]));
  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const [id, value] of after) {
    if (!before.has(id)) added += 1;
    else if (before.get(id) !== value) updated += 1;
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed += 1;
  }
  return { added, updated, removed };
}
