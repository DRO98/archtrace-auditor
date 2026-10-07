import type { ChangeUnit, DiffLine, DiffSide } from "@core/audit";
import type { LineRange } from "@core/protocol";
import type { FilePatch } from "../git/patch";
import type { BlobEntry, SymbolSummary } from "../index/repoIndex";
import { sha256 } from "../paths";

/** Símbolos de cada versión de un archivo (null = sin gramática o versión inexistente). */
export interface FileVersions {
  base: BlobEntry | null;
  head: BlobEntry | null;
}

const MODULE_SCOPE = "<module>";

/** Símbolo más interno que contiene la línea (un método gana a su clase). */
export function enclosingSymbol(symbols: readonly SymbolSummary[], line: number): SymbolSummary | null {
  let best: SymbolSummary | null = null;
  for (const symbol of symbols) {
    if (line < symbol.range.startLine || line > symbol.range.endLine) continue;
    if (!best || symbol.range.endLine - symbol.range.startLine < best.range.endLine - best.range.startLine) best = symbol;
  }
  return best;
}

interface Group {
  key: string;
  symbol: { summary: SymbolSummary; side: DiffSide } | null;
  lines: DiffLine[];
  headers: Set<string>;
}

/**
 * Hunks → unidades por símbolo envolvente: las líneas añadidas se buscan en los símbolos de head y las borradas
 * en los de base. Las líneas de un mismo símbolo (mismo nombre cualificado en cualquier lado) forman una unidad;
 * lo que queda fuera de cualquier símbolo va a la unidad del módulo.
 */
export function buildUnits(patch: FilePatch, versions: FileVersions): ChangeUnit[] {
  const language = versions.head?.language ?? versions.base?.language ?? null;
  const groups = new Map<string, Group>();

  for (const hunk of patch.hunks) {
    const resolved = hunk.lines.map((line) => {
      const side: DiffSide = line.kind === "add" ? "head" : "base";
      const symbols = (side === "head" ? versions.head : versions.base)?.symbols ?? [];
      return { line, side, symbol: enclosingSymbol(symbols, line.line) };
    });
    // Las líneas en blanco no forman unidad propia: se unen a la línea con contenido más cercana del hunk.
    const anchors = resolved.map((entry, index) => {
      if (entry.line.text.trim().length > 0) return entry;
      for (let offset = 1; offset < resolved.length; offset += 1) {
        const next = resolved[index + offset];
        if (next && next.line.text.trim().length > 0) return next;
        const previous = resolved[index - offset];
        if (previous && previous.line.text.trim().length > 0) return previous;
      }
      return entry;
    });
    for (const [index, { line }] of resolved.entries()) {
      const { symbol, side } = anchors[index]!;
      const key = symbol?.qualifiedName ?? MODULE_SCOPE;
      let group = groups.get(key);
      if (!group) {
        group = { key, symbol: symbol ? { summary: symbol, side } : null, lines: [], headers: new Set() };
        groups.set(key, group);
      } else if (symbol && (!group.symbol || (group.symbol.side === "base" && side === "head"))) {
        // El rango de head manda: es el que se muestra y se revisa.
        group.symbol = { summary: symbol, side };
      }
      group.lines.push(line);
      group.headers.add(hunk.header);
    }
  }

  if (groups.size === 0) {
    // Binario, renombrado puro o cambio de modo: unidad sin líneas para que cuenten las señales de ruta.
    return [makeUnit(patch, language, { key: MODULE_SCOPE, symbol: null, lines: [], headers: new Set() })];
  }
  return [...groups.values()].map((group) => makeUnit(patch, language, group)).sort(byPosition);
}

function makeUnit(patch: FilePatch, language: string | null, group: Group): ChangeUnit {
  const added = group.lines.filter((line) => line.kind === "add");
  const removed = group.lines.filter((line) => line.kind === "del");
  const content = group.lines.map((line) => `${line.kind === "add" ? "+" : "-"}${line.text}`).join("\n");
  return {
    // Sin números de línea: si el hunk solo se desplaza, la unidad (y la caché del LLM) sigue siendo la misma.
    id: sha256(`${patch.path}\0${group.key}\0${content}`).slice(0, 16),
    file: patch.path,
    ...(patch.previousPath ? { previousPath: patch.previousPath } : {}),
    status: patch.status,
    language,
    symbol: group.symbol
      ? {
          qualifiedName: group.symbol.summary.qualifiedName,
          kind: group.symbol.summary.kind,
          side: group.symbol.side,
          range: group.symbol.summary.range,
        }
      : null,
    headLines: span(added),
    baseLines: span(removed),
    added: added.length,
    removed: removed.length,
    lines: group.lines,
    hunkHeaders: [...group.headers],
  };
}

function span(lines: readonly DiffLine[]): LineRange | null {
  if (lines.length === 0) return null;
  let startLine = Infinity;
  let endLine = 0;
  for (const line of lines) {
    startLine = Math.min(startLine, line.line);
    endLine = Math.max(endLine, line.line);
  }
  return { startLine, endLine };
}

function byPosition(left: ChangeUnit, right: ChangeUnit): number {
  const a = left.headLines?.startLine ?? left.baseLines?.startLine ?? 0;
  const b = right.headLines?.startLine ?? right.baseLines?.startLine ?? 0;
  return a - b;
}

/** Lado y líneas que representan la unidad en la revisión (head si hay añadidos). */
export function unitLocation(unit: ChangeUnit): { side: DiffSide; lines: LineRange } {
  if (unit.headLines) return { side: "head", lines: unit.headLines };
  if (unit.baseLines) return { side: "base", lines: unit.baseLines };
  return { side: "head", lines: { startLine: 1, endLine: 1 } };
}
