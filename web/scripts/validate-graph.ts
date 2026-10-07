import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCodeGraph, validateRanges } from "../src/features/canvas/lib/graph";

const webRoot = process.cwd();
const graphsDir = path.join(webRoot, "public", "graphs");
const sandboxRoot = path.resolve(webRoot, "../sandbox");

const files = readdirSync(graphsDir)
  .filter((name) => name.endsWith(".json") && name !== "stress.json")
  .sort((left, right) => left.localeCompare(right));

let failed = false;
for (const file of files) {
  const raw: unknown = JSON.parse(readFileSync(path.join(graphsDir, file), "utf8"));
  const parsed = parseCodeGraph(raw);
  if (!parsed.ok) {
    failed = true;
    for (const error of parsed.errors) console.error(`${file}: ${error}`);
    continue;
  }
  const errors = validateRanges(parsed.graph, (filePath) => {
    try {
      return readFileSync(path.join(sandboxRoot, filePath), "utf8");
    } catch {
      return null;
    }
  });
  if (errors.length > 0) {
    failed = true;
    for (const error of errors) console.error(`${file}: ${error}`);
  }
}

if (failed) process.exit(1);
