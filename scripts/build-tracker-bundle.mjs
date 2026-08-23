#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { parseManagedTrackerRecords } from "../lib/indicators.js";

const sourceRoot = resolve(process.argv[2] || "../Veilance-Tracker-DB/veilance-json-trackers");
const outputPath = resolve(process.argv[3] || "data/veilance-trackers.json");
const repositoryRoot = resolve(sourceRoot, "..");

async function jsonFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) files.push(path);
  }
  return files;
}

function gitValue(args, fallback) {
  try {
    return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8" }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const paths = (await jsonFiles(sourceRoot)).sort((left, right) => left.localeCompare(right));
const records = [];
for (const path of paths) {
  records.push({
    sourceName: `veilance-json-trackers/${relative(sourceRoot, path).replaceAll("\\", "/")}`,
    tracker: JSON.parse(await readFile(path, "utf8"))
  });
}

const validation = parseManagedTrackerRecords(records);
if (!validation.indicators.length) throw new Error("No usable Veilance tracker records were found");

const revision = gitValue(["rev-parse", "HEAD"], "unversioned");
const generatedAt = gitValue(["show", "-s", "--format=%cI", "HEAD"], new Date().toISOString());
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  source: "https://github.com/VeilanceApp/Veilance-Tracker-DB/tree/main/veilance-json-trackers",
  revision,
  generatedAt,
  records
})}\n`);

console.log(
  `Bundled ${validation.indicators.length} of ${validation.sourceCount} trackers ` +
  `(${validation.skippedCount} skipped, ${validation.warningCount} warnings) from ${revision}.`
);
