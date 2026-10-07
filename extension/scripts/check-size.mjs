import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve("dist");
let total = 0;

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else total += statSync(absolute).size;
  }
}

walk(root);
const megabytes = (total / (1024 * 1024)).toFixed(2);
console.log(`dist/ ${total} bytes (${megabytes} MB)`);
if (total > 5 * 1024 * 1024) {
  console.error("dist/ exceeds 5 MB");
  process.exit(1);
}
