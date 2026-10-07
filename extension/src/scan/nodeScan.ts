import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ProjectMap } from "@core/projectMap";
import { rankSources } from "@core/rankSources";
import { createParserHost, grammarFor } from "./parserHost.js";
import { buildProjectMap } from "./resolve.js";
import type { RawFile } from "./types.js";

export interface ScanOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  exclude?: readonly string[];
  workspaceName?: string;
  generatedAt?: string;
}

const SOURCE_EXT = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function excluded(relativePath: string, patterns: readonly string[]): boolean {
  const posix = toPosix(relativePath);
  return patterns.some((pattern) => matchGlob(pattern, posix));
}

function matchGlob(pattern: string, filePath: string): boolean {
  const source = pattern.split(path.sep).join("/");
  const body = source
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`(?:^|/)${body}(?:$|/)`).test(`/${filePath}`);
}

function walk(directory: string, root: string, exclude: readonly string[], out: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = toPosix(path.relative(root, absolute));
    if (excluded(relative, exclude)) continue;
    if (entry.isDirectory()) walk(absolute, root, exclude, out);
    else if (SOURCE_EXT.has(path.extname(entry.name).toLowerCase())) out.push(absolute);
  }
}

export async function scanDirectory(root: string, wasmDir: string, opts: ScanOptions = {}): Promise<ProjectMap> {
  const maxFiles = opts.maxFiles ?? 400;
  const maxFileBytes = opts.maxFileBytes ?? 524288;
  const exclude = opts.exclude ?? [];
  const absoluteRoot = path.resolve(root);
  const found: string[] = [];
  walk(absoluteRoot, absoluteRoot, exclude, found);
  // De mejor a peor: si se llega a `maxFiles`, lo que queda fuera es el relleno, no los paquetes de letras tardías.
  const ranked = rankSources(found.map((absolute) => ({ path: toPosix(path.relative(absoluteRoot, absolute)), absolute })));

  const host = await createParserHost(wasmDir);
  const files: Array<{ filePath: string; raw: RawFile }> = [];
  let skippedFiles = 0;
  let truncated = false;
  try {
    for (const { absolute } of ranked) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const relative = toPosix(path.relative(absoluteRoot, absolute));
      const kind = grammarFor(relative);
      if (!kind) continue;
      const info = statSync(absolute);
      if (info.size > maxFileBytes) {
        skippedFiles += 1;
        continue;
      }
      const text = readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
      if (text.includes("\0")) {
        skippedFiles += 1;
        continue;
      }
      try {
        const raw = await host.parse(kind.language, relative, text);
        files.push({ filePath: relative, raw });
      } catch {
        skippedFiles += 1;
      }
    }
  } finally {
    host.dispose();
  }

  files.sort((left, right) => left.filePath.localeCompare(right.filePath));
  return buildProjectMap(files, {
    workspaceName: opts.workspaceName ?? path.basename(absoluteRoot),
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    truncated,
    skippedFiles,
  });
}
