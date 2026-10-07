import type {
  MapCall,
  MapFile,
  MapInstantiation,
  MapLanguage,
  MapScope,
  MapSymbol,
  MapSymbolKind,
  ProjectMap,
} from "@core/projectMap";

const LANGUAGES: ReadonlySet<string> = new Set(["python", "typescript", "javascript"]);
const KINDS: ReadonlySet<string> = new Set(["class", "function", "method"]);
const MAX_FILES = 2000;
const MAX_SYMBOLS = 20_000;

export function parseProjectMap(raw: unknown): ProjectMap | null {
  if (!isRecord(raw) || raw.version !== 1) return null;
  if (typeof raw.workspaceName !== "string" || typeof raw.generatedAt !== "string") return null;
  if (typeof raw.revision !== "string" || typeof raw.truncated !== "boolean") return null;
  if (!Array.isArray(raw.files) || raw.files.length > MAX_FILES) return null;

  const files: MapFile[] = [];
  const ids = new Set<string>();
  for (const item of raw.files) {
    const file = readFile(item, ids);
    if (!file) return null;
    files.push(file);
  }
  if (ids.size > MAX_SYMBOLS) return null;

  const known = ids;
  for (const file of files) {
    file.imports = file.imports.filter((imported) => files.some((candidate) => candidate.filePath === imported));
    file.symbols = file.symbols.map((symbol) => ({
      ...symbol,
      calls: symbol.calls.filter((call) => known.has(call.target)),
      instantiations: symbol.instantiations.filter((item) => known.has(item.target)),
    }));
    file.moduleScope = {
      calls: file.moduleScope.calls.filter((call) => known.has(call.target)),
      instantiations: file.moduleScope.instantiations.filter((item) => known.has(item.target)),
    };
  }

  const stats = isRecord(raw.stats) ? raw.stats : {};
  return {
    version: 1,
    workspaceName: raw.workspaceName,
    generatedAt: raw.generatedAt,
    revision: raw.revision,
    truncated: raw.truncated,
    stats: {
      files: readCount(stats.files, files.length),
      symbols: readCount(stats.symbols, ids.size),
      skippedFiles: readCount(stats.skippedFiles, 0),
      unresolvedCalls: readCount(stats.unresolvedCalls, 0),
      ambiguousCalls: readCount(stats.ambiguousCalls, 0),
    },
    files: [...files].sort((left, right) => left.filePath.localeCompare(right.filePath)),
  };
}

function readFile(raw: unknown, ids: Set<string>): MapFile | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.filePath !== "string" || raw.filePath.length === 0) return null;
  if (typeof raw.language !== "string" || !LANGUAGES.has(raw.language)) return null;
  if (!isLine(raw.lineCount)) return null;
  if (!Array.isArray(raw.imports) || raw.imports.some((item) => typeof item !== "string")) return null;
  if (!Array.isArray(raw.symbols)) return null;

  const symbols: MapSymbol[] = [];
  for (const item of raw.symbols) {
    const symbol = readSymbol(item, raw.filePath);
    if (!symbol || ids.has(symbol.id)) return null;
    ids.add(symbol.id);
    symbols.push(symbol);
  }

  return {
    filePath: raw.filePath,
    language: raw.language as MapLanguage,
    lineCount: raw.lineCount,
    ...(typeof raw.doc === "string" ? { doc: raw.doc } : {}),
    imports: raw.imports as string[],
    symbols,
    moduleScope: readScope(raw.moduleScope) ?? { calls: [], instantiations: [] },
  };
}

function readSymbol(raw: unknown, filePath: string): MapSymbol | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id.startsWith(`${filePath}::`)) return null;
  if (typeof raw.kind !== "string" || !KINDS.has(raw.kind)) return null;
  if (typeof raw.name !== "string" || typeof raw.qualifiedName !== "string" || typeof raw.signature !== "string") {
    return null;
  }
  const range = readRange(raw.range);
  if (!range) return null;
  return {
    id: raw.id,
    kind: raw.kind as MapSymbolKind,
    name: raw.name,
    qualifiedName: raw.qualifiedName,
    ...(typeof raw.parentId === "string" ? { parentId: raw.parentId } : {}),
    range,
    signature: raw.signature,
    ...(typeof raw.doc === "string" ? { doc: raw.doc } : {}),
    calls: readCalls(raw.calls),
    instantiations: readInstantiations(raw.instantiations),
  };
}

function readScope(raw: unknown): MapScope | null {
  if (!isRecord(raw)) return null;
  return { calls: readCalls(raw.calls), instantiations: readInstantiations(raw.instantiations) };
}

function readCalls(raw: unknown): MapCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: MapCall[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.target !== "string" || !isLine(item.line)) continue;
    calls.push({ target: item.target, line: item.line });
  }
  return calls;
}

function readInstantiations(raw: unknown): MapInstantiation[] {
  if (!Array.isArray(raw)) return [];
  const items: MapInstantiation[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.target !== "string") continue;
    const range = readRange(item.range);
    if (!range) continue;
    items.push({ target: item.target, range });
  }
  return items;
}

function readRange(raw: unknown): { startLine: number; endLine: number } | null {
  if (!isRecord(raw) || !isLine(raw.startLine) || !isLine(raw.endLine) || raw.endLine < raw.startLine) return null;
  return { startLine: raw.startLine, endLine: raw.endLine };
}

function readCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isLine(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
