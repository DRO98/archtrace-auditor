import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scanDirectory } from "../src/scan/nodeScan.js";

const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/*.min.js",
  "**/*.d.ts",
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/tests/**",
  "**/test_*.py",
];

function wasmDir(): string {
  return path.resolve("dist/wasm");
}

async function main(): Promise<void> {
  const outFlag = process.argv.indexOf("--out");
  const outPath = outFlag >= 0 ? process.argv[outFlag + 1] : undefined;
  const map = await scanDirectory(path.resolve("..", "sandbox"), wasmDir(), { exclude: DEFAULT_EXCLUDE });
  const { files, symbols, skippedFiles, unresolvedCalls, ambiguousCalls } = map.stats;
  console.log(
    `files=${files} symbols=${symbols} skippedFiles=${skippedFiles} unresolved=${unresolvedCalls} ambiguous=${ambiguousCalls} revision=${map.revision}`,
  );
  if (outPath) {
    const destination = path.resolve(outPath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(detail);
  process.exit(1);
});
