import type { LineRange } from "./protocol.js";

export type MapLanguage = "python" | "typescript" | "javascript";
export type MapSymbolKind = "class" | "function" | "method";

/** A call resolved to a symbol of the workspace. Unresolved/external calls are not stored. */
export interface MapCall {
  target: string;
  line: number;
}

/** `target` is always a class symbol id. `range` spans the whole call expression. */
export interface MapInstantiation {
  target: string;
  range: LineRange;
}

export interface MapScope {
  calls: MapCall[];
  instantiations: MapInstantiation[];
}

export interface MapSymbol {
  id: string;
  kind: MapSymbolKind;
  name: string;
  qualifiedName: string;
  parentId?: string;
  range: LineRange;
  signature: string;
  doc?: string;
  calls: MapCall[];
  instantiations: MapInstantiation[];
}

export interface MapFile {
  filePath: string;
  language: MapLanguage;
  lineCount: number;
  doc?: string;
  imports: string[];
  symbols: MapSymbol[];
  moduleScope: MapScope;
}

export interface ProjectMapStats {
  files: number;
  symbols: number;
  skippedFiles: number;
  unresolvedCalls: number;
  ambiguousCalls: number;
}

export interface ProjectMap {
  version: 1;
  workspaceName: string;
  generatedAt: string;
  revision: string;
  truncated: boolean;
  stats: ProjectMapStats;
  files: MapFile[];
}
