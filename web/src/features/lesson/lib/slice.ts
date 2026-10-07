import type { ProjectMap } from "@core/projectMap";
import { buildDigest, sanitize, type ProjectDigest } from "./digest";

const NEIGHBOR_SYMBOL_CAP = 40;

export function buildOutline(map: ProjectMap, goal: string, fileCap = 80): string {
  const importedBy = countImportedBy(map);
  const ranked = rankFiles(map, goal);
  const chosen = ranked.slice(0, fileCap);
  return chosen
    .map((filePath) => {
      const file = map.files.find((item) => item.filePath === filePath);
      if (!file) return null;
      const classes = file.symbols.filter((symbol) => symbol.kind === "class").length;
      const functions = file.symbols.filter((symbol) => symbol.kind !== "class").length;
      const doc = file.doc ? sanitize(file.doc) : "";
      return `${file.filePath} · classes ${classes} · functions ${functions} · imports ${file.imports.length} · importedBy ${importedBy.get(file.filePath) ?? 0}${doc ? ` · ${doc}` : ""}`;
    })
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function pickSlice(map: ProjectMap, chosenFiles: readonly string[]): ProjectDigest {
  const chosen = new Set(chosenFiles.filter((filePath) => map.files.some((file) => file.filePath === filePath)));
  const neighbors = new Set<string>();
  for (const file of map.files) {
    if (!chosen.has(file.filePath)) continue;
    for (const imported of file.imports) neighbors.add(imported);
  }
  for (const file of map.files) {
    if (file.imports.some((imported) => chosen.has(imported))) neighbors.add(file.filePath);
  }

  const referenced = new Set<string>();
  for (const file of map.files) {
    if (!chosen.has(file.filePath)) continue;
    for (const symbol of file.symbols) {
      for (const call of symbol.calls) referenced.add(call.target);
      for (const created of symbol.instantiations) referenced.add(created.target);
    }
  }

  let neighborSymbols = 0;
  const files = map.files
    .filter((file) => chosen.has(file.filePath) || neighbors.has(file.filePath))
    .map((file) => {
      if (chosen.has(file.filePath)) return file;
      const symbols = file.symbols.filter((symbol) => referenced.has(symbol.id));
      const room = Math.max(0, NEIGHBOR_SYMBOL_CAP - neighborSymbols);
      const kept = symbols.slice(0, room);
      neighborSymbols += kept.length;
      return { ...file, symbols: kept };
    });

  return buildDigest({ ...map, files });
}

export function rankFiles(map: ProjectMap, goal: string): string[] {
  const needles = fold(goal).split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  const scored = map.files.map((file) => {
    const haystack = fold(
      [file.filePath, file.doc ?? "", ...file.symbols.map((symbol) => symbol.qualifiedName)].join(" "),
    );
    const score = needles.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
    return { filePath: file.filePath, score };
  });
  scored.sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));
  return scored.map((item) => item.filePath);
}

function countImportedBy(map: ProjectMap): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of map.files) {
    for (const imported of file.imports) {
      counts.set(imported, (counts.get(imported) ?? 0) + 1);
    }
  }
  return counts;
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
