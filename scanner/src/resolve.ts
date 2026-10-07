import { createHash } from "node:crypto";
import type { LineRange } from "@core/protocol";
import type {
  MapCall,
  MapFile,
  MapInstantiation,
  MapSymbol,
  ProjectMap,
} from "@core/projectMap";
import type { RawCallSite, RawFile, RawImport, RawSymbol } from "./types.js";

const CALL_CAP = 40;

export interface ProjectMapMeta {
  workspaceName: string;
  generatedAt: string;
  truncated: boolean;
  skippedFiles: number;
}

interface IndexedSymbol {
  symbol: MapSymbol;
  filePath: string;
}

function symbolId(filePath: string, qualifiedName: string): string {
  return `${filePath}::${qualifiedName}`;
}

function rangesEqual(left: LineRange, right: LineRange): boolean {
  return left.startLine === right.startLine && left.endLine === right.endLine;
}

function tryExtensions(base: string, known: ReadonlySet<string>): string | null {
  const candidates = [
    `${base}.py`,
    `${base}/__init__.py`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/index.mjs`,
  ];
  const found = candidates.filter((item) => known.has(item));
  return found.length === 1 ? found[0] ?? null : found.length > 1 ? null : null;
}

function sharedPrefix(left: string, right: string): number {
  const a = left.split("/");
  const b = right.split("/");
  a.pop();
  b.pop();
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
  return count;
}

function resolveImport(filePath: string, imported: RawImport, known: readonly string[]): string | null {
  const knownSet = new Set(known);
  let spec = imported.specifier;
  if (spec.startsWith("@/")) spec = `src/${spec.slice(2)}`;
  else if (spec.startsWith("@")) return null;

  if (imported.level > 0 || spec.startsWith(".")) {
    const dir = filePath.split("/");
    dir.pop();
    const ups = spec.startsWith(".")
      ? spec.split("/").filter((part) => part === "..").length
      : Math.max(0, imported.level - 1);
    if (ups > dir.length) return null;
    for (let index = 0; index < ups; index += 1) dir.pop();
    const rest = spec.startsWith(".")
      ? spec.split("/").filter((part) => part !== "." && part !== "..")
      : spec.split(".").filter((part) => part.length > 0);
    const base = [...dir, ...rest].join("/");
    return tryExtensions(base, knownSet);
  }

  const suffix = `${spec.replaceAll(".", "/")}.py`;
  const tsSuffixes = [".ts", ".tsx", ".js", ".jsx"].map((ext) => `${spec.replaceAll(".", "/")}${ext}`);
  const matches = known.filter((file) => file === suffix || file.endsWith(`/${suffix}`) || tsSuffixes.some((item) => file.endsWith(`/${item}`) || file === item));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0] ?? null;
  const ranked = matches
    .map((file) => ({ file, prefix: sharedPrefix(filePath, file) }))
    .sort((left, right) => right.prefix - left.prefix);
  if (!ranked[0] || !ranked[1]) return ranked[0]?.file ?? null;
  if (ranked[0].prefix === ranked[1].prefix) return null;
  return ranked[0].file;
}

function sameName(symbol: RawSymbol, name: string): boolean {
  return symbol.name === name;
}

function dedupeCalls(calls: MapCall[]): MapCall[] {
  const seen = new Set<string>();
  const result: MapCall[] = [];
  for (const call of calls) {
    const key = `${call.target}:${call.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(call);
    if (result.length >= CALL_CAP) break;
  }
  return result;
}

function dedupeInstantiations(items: MapInstantiation[]): MapInstantiation[] {
  const seen = new Set<string>();
  const result: MapInstantiation[] = [];
  for (const item of items) {
    const key = `${item.target}:${item.range.startLine}:${item.range.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= CALL_CAP) break;
  }
  return result;
}

export function buildProjectMap(
  input: ReadonlyArray<{ filePath: string; raw: RawFile }>,
  meta: ProjectMapMeta,
): ProjectMap {
  const ordered = [...input].sort((left, right) => left.filePath.localeCompare(right.filePath));
  const known = ordered.map((file) => file.filePath);
  const byId = new Map<string, IndexedSymbol>();
  const byFile = new Map<string, IndexedSymbol[]>();

  const drafts: MapFile[] = ordered.map((file) => {
    const symbols: MapSymbol[] = file.raw.symbols.map((raw) => {
      const symbol: MapSymbol = {
        id: symbolId(file.filePath, raw.qualifiedName),
        kind: raw.kind,
        name: raw.name,
        qualifiedName: raw.qualifiedName,
        range: raw.range,
        signature: raw.signature,
        calls: [],
        instantiations: [],
      };
      if (raw.parentQualifiedName) symbol.parentId = symbolId(file.filePath, raw.parentQualifiedName);
      if (raw.doc) symbol.doc = raw.doc;
      return symbol;
    });
    const indexed = symbols.map((symbol) => ({ symbol, filePath: file.filePath }));
    for (const item of indexed) byId.set(item.symbol.id, item);
    byFile.set(file.filePath, indexed);
    const imports = file.raw.imports
      .map((item) => resolveImport(file.filePath, item, known))
      .filter((item): item is string => item !== null && item !== file.filePath);
    const uniqueImports = [...new Set(imports)].sort((left, right) => left.localeCompare(right));
    const mapped: MapFile = {
      filePath: file.filePath,
      language: file.raw.language,
      lineCount: file.raw.lineCount,
      imports: uniqueImports,
      symbols,
      moduleScope: { calls: [], instantiations: [] },
    };
    if (file.raw.doc) mapped.doc = file.raw.doc;
    return mapped;
  });

  let unresolvedCalls = 0;
  let ambiguousCalls = 0;

  function finish(target: IndexedSymbol, site: RawCallSite, bucket: { calls: MapCall[]; instantiations: MapInstantiation[] }): void {
    if (target.symbol.kind === "class") {
      bucket.instantiations.push({ target: target.symbol.id, range: site.range });
      return;
    }
    bucket.calls.push({ target: target.symbol.id, line: site.range.startLine });
  }

  function lookup(filePath: string, site: RawCallSite, imported: readonly string[]): IndexedSymbol | "ambiguous" | null {
    const local = byFile.get(filePath) ?? [];
    if (site.receiver === "self") {
      const owner = local.find((item) => item.symbol.qualifiedName === site.enclosing);
      const className = owner?.symbol.kind === "method" ? owner.symbol.qualifiedName.split(".")[0] : owner?.symbol.kind === "class" ? owner.symbol.name : null;
      if (!className) return null;
      const methods = local.filter((item) => item.symbol.kind === "method" && item.symbol.name === site.name && item.symbol.qualifiedName.startsWith(`${className}.`));
      if (methods.length === 1) return methods[0] ?? null;
      return methods.length > 1 ? "ambiguous" : null;
    }

    const pool = (paths: readonly string[]): IndexedSymbol[] => {
      const found: IndexedSymbol[] = [];
      for (const candidatePath of paths) {
        for (const item of byFile.get(candidatePath) ?? []) {
          if (sameName(item.symbol, site.name)) found.push(item);
        }
      }
      return found;
    };

    if (site.receiver === null) {
      const here = pool([filePath]);
      if (here.length === 1) return here[0] ?? null;
      if (here.length > 1) return "ambiguous";
      const abroad = pool(imported);
      if (abroad.length === 1) return abroad[0] ?? null;
      if (abroad.length > 1) return "ambiguous";
      return null;
    }

    const abroad = pool(imported);
    if (abroad.length === 1) return abroad[0] ?? null;
    if (abroad.length > 1) return "ambiguous";
    return null;
  }

  ordered.forEach((file, index) => {
    const mapped = drafts[index];
    if (!mapped) return;
    for (const site of file.raw.callSites) {
      const resolved = lookup(file.filePath, site, mapped.imports);
      if (resolved === "ambiguous") {
        ambiguousCalls += 1;
        continue;
      }
      if (!resolved) {
        unresolvedCalls += 1;
        continue;
      }
      if (!site.enclosing) {
        finish(resolved, site, mapped.moduleScope);
        continue;
      }
      const owner = mapped.symbols.find((symbol) => symbol.qualifiedName === site.enclosing);
      if (!owner) {
        finish(resolved, site, mapped.moduleScope);
        continue;
      }
      finish(resolved, site, owner);
    }
  });

  for (const file of drafts) {
    file.moduleScope.calls = dedupeCalls(file.moduleScope.calls);
    file.moduleScope.instantiations = dedupeInstantiations(file.moduleScope.instantiations);
    for (const symbol of file.symbols) {
      symbol.calls = dedupeCalls(symbol.calls);
      symbol.instantiations = dedupeInstantiations(symbol.instantiations);
    }
  }

  const revision = createHash("sha1").update(stableFiles(drafts)).digest("hex").slice(0, 12);
  const symbols = drafts.reduce((total, file) => total + file.symbols.length, 0);
  return {
    version: 1,
    workspaceName: meta.workspaceName,
    generatedAt: meta.generatedAt,
    revision,
    truncated: meta.truncated,
    stats: {
      files: drafts.length,
      symbols,
      skippedFiles: meta.skippedFiles,
      unresolvedCalls,
      ambiguousCalls,
    },
    files: drafts,
  };
}

function stableFiles(files: readonly MapFile[]): string {
  return JSON.stringify(files);
}

export function sameRange(left: LineRange, right: LineRange): boolean {
  return rangesEqual(left, right);
}
