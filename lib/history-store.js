import sqlite3InitModule from "../vendor/sqlite/sqlite3.mjs";
import { base64ToBytes, bytesToBase64 } from "./encoding.js";
import { SqliteVisitStore } from "./sqlite-visits.js";

const DATABASE_STORAGE_KEY = "veilanceHistorySqliteV1";

async function loadDatabase() {
  const stored = await chrome.storage.local.get(DATABASE_STORAGE_KEY);
  const encoded = stored?.[DATABASE_STORAGE_KEY];
  return typeof encoded === "string" && encoded ? base64ToBytes(encoded) : null;
}

async function saveDatabase(bytes) {
  await chrome.storage.local.set({ [DATABASE_STORAGE_KEY]: bytesToBase64(bytes) });
}

export const historyStoreReady = (async () => {
  const previousApiConfig = globalThis.sqlite3ApiConfig;
  globalThis.sqlite3ApiConfig = {
    ...(previousApiConfig || {}),
    disable: {
      ...(previousApiConfig?.disable || {}),
      vfs: {
        ...(previousApiConfig?.disable?.vfs || {}),
        // History is serialized into extension storage, so OPFS workers are unnecessary.
        opfs: true,
        "opfs-sahpool": true,
        "opfs-wl": true
      }
    }
  };
  let sqlite3;
  try {
    sqlite3 = await sqlite3InitModule({
      print: () => {},
      printErr: (...args) => console.warn("Veilance SQLite", ...args)
    });
  } finally {
    if (previousApiConfig === undefined) delete globalThis.sqlite3ApiConfig;
    else globalThis.sqlite3ApiConfig = previousApiConfig;
  }
  const store = new SqliteVisitStore(
    sqlite3,
    { load: loadDatabase, save: saveDatabase },
    { filename: "veilance-history.sqlite3", maxVisits: 20 }
  );
  await store.ready;
  return store;
})();
