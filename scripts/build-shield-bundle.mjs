import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManagedShieldDocuments } from "../lib/shield-rules.js";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.resolve(
  extensionRoot,
  process.argv[2] || "../Veilance-Shield-DB/veilance-json-shields"
);
const outputPath = path.join(extensionRoot, "data", "veilance-shields.json");

const filenames = (await readdir(sourceDirectory))
  .filter((name) => name.toLowerCase().endsWith(".json"))
  .sort();
const documents = await Promise.all(filenames.map(async (filename) => ({
  sourceName: `veilance-json-shields/${filename}`,
  text: await readFile(path.join(sourceDirectory, filename), "utf8")
})));
const parsed = parseManagedShieldDocuments(documents);
if (!parsed.rules.length || parsed.errors.length) {
  throw new Error([
    `Shield bundle rejected: ${parsed.rules.length} valid and ${parsed.errors.length} invalid rules.`,
    ...parsed.errors.slice(0, 10)
  ].join("\n"));
}

const records = parsed.rules.map(({ sourceName: _sourceName, ...rule }) => rule);
const revision = createHash("sha256").update(JSON.stringify(records)).digest("hex");
const bundle = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  revision,
  records
};
await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(`Wrote ${records.length} Shield rules to ${path.relative(extensionRoot, outputPath)} (${revision.slice(0, 12)}).`);
