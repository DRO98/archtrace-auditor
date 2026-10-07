import type { MapFile, MapSymbol, ProjectMap } from "@core/projectMap";

export interface ProjectDigest {
  text: string;
  handles: ReadonlyMap<string, string>;
  estimatedTokens: number;
}

const LINE_CAP = 220;

export function buildDigest(map: ProjectMap): ProjectDigest {
  const handles = new Map<string, string>();
  let index = 1;
  for (const file of map.files) {
    for (const symbol of file.symbols) {
      handles.set(`S${index}`, symbol.id);
      index += 1;
    }
  }

  const byId = new Map<string, string>();
  for (const [handle, id] of handles) byId.set(id, handle);

  const lines: string[] = [];
  let cursor = 1;
  for (const file of map.files) {
    lines.push(clip(`F ${file.filePath} · ${file.lineCount} lines · ${file.language}`));
    if (file.doc) lines.push(clip(`  doc: ${sanitize(file.doc)}`));
    if (file.imports.length > 0) lines.push(clip(`  imports: ${file.imports.join(", ")}`));
    for (const symbol of file.symbols) {
      const handle = `S${cursor}`;
      cursor += 1;
      lines.push(clip(symbolLine(symbol, handle)));
      const calls = formatCalls(symbol, byId);
      const creates = formatCreates(symbol, byId);
      if (calls) lines.push(clip(`        calls: ${calls}`));
      if (creates) lines.push(clip(`        creates: ${creates}`));
    }
    const moduleCalls = formatScopeCalls(file, byId);
    if (moduleCalls) lines.push(clip(`  module calls: ${moduleCalls}`));
  }

  const text = lines.join("\n");
  return { text, handles, estimatedTokens: Math.ceil(text.length / 4) };
}

function symbolLine(symbol: MapSymbol, handle: string): string {
  const indent = symbol.kind === "method" ? "  " : "";
  const range = `L${symbol.range.startLine}-${symbol.range.endLine}`;
  const head = `${indent}${handle} ${symbol.kind} ${symbol.qualifiedName} ${range}`;
  const showSig = symbol.qualifiedName.endsWith(".__init__") || symbol.name === "__init__" || !symbol.doc;
  if (symbol.doc && !showSig) return `${head} | ${sanitize(symbol.doc)}`;
  if (symbol.doc) return `${head} | sig: ${sanitize(symbol.signature)} | ${sanitize(symbol.doc)}`;
  return `${head} | sig: ${sanitize(symbol.signature)}`;
}

function formatCalls(symbol: MapSymbol, byId: Map<string, string>): string {
  return symbol.calls
    .map((call) => {
      const handle = byId.get(call.target);
      return handle ? `L${call.line}→${handle}` : null;
    })
    .filter((item): item is string => item !== null)
    .join(" · ");
}

function formatCreates(symbol: MapSymbol, byId: Map<string, string>): string {
  return symbol.instantiations
    .map((item) => {
      const handle = byId.get(item.target);
      if (!handle) return null;
      return `L${item.range.startLine}-${item.range.endLine}→${handle}`;
    })
    .filter((item): item is string => item !== null)
    .join(" · ");
}

function formatScopeCalls(file: MapFile, byId: Map<string, string>): string {
  return file.moduleScope.calls
    .map((call) => {
      const handle = byId.get(call.target);
      return handle ? `L${call.line}→${handle}` : null;
    })
    .filter((item): item is string => item !== null)
    .join(" · ");
}

export function sanitize(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(line: string): string {
  return line.length <= LINE_CAP ? line : `${line.slice(0, LINE_CAP - 1)}…`;
}
