import type { LineRange } from "@core/protocol";
import type { MapLanguage, MapSymbolKind } from "@core/projectMap";

export interface RawSymbol {
  kind: MapSymbolKind;
  name: string;
  qualifiedName: string;
  parentQualifiedName?: string;
  range: LineRange;
  signature: string;
  doc?: string;
}

export interface RawCallSite {
  name: string;
  receiver: "self" | string | null;
  isNew: boolean;
  range: LineRange;
  enclosing: string | null;
}

export interface RawImport {
  specifier: string;
  level: number;
}

export interface RawFile {
  language: MapLanguage;
  lineCount: number;
  doc?: string;
  imports: RawImport[];
  symbols: RawSymbol[];
  callSites: RawCallSite[];
}
