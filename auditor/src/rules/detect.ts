import type { ChangeUnit, Signal } from "@core/audit";
import type { Taxonomy } from "./taxonomy";

const MAX_SIGNALS = 60;
const COMMENT = /^\s*(#|\/\/|\/\*|\*|--|<!--|"""|''')/;

/**
 * Señales deterministas de una unidad: detectores de ruta sobre el archivo y detectores de línea sobre cada línea
 * añadida o borrada (quitar un `has_perm` es tan delicado como añadirlo). En archivos triviales por ruta
 * (tests, estilos, docs) no se ejecutan detectores de línea; en comentarios las señales fuertes pasan a débiles.
 */
export function detectSignals(unit: ChangeUnit, taxonomy: Taxonomy): Signal[] {
  const signals: Signal[] = [];
  const paths = [unit.file, ...(unit.previousPath ? [unit.previousPath] : [])];

  for (const detector of taxonomy.detectors) {
    if (detector.target !== "path") continue;
    for (const file of paths) {
      const match = detector.pattern.exec(file);
      if (!match) continue;
      signals.push({
        detector: detector.id,
        category: detector.category,
        strength: detector.strength,
        floor: detector.floor,
        token: match[0],
        line: 0,
        side: "path",
        text: file,
      });
      break;
    }
  }

  // Tests, estilos y docs (incluidos CLAUDE.md y similares): su texto menciona `has_perm`, 403… sin ejecutarlo.
  if (signals.some((signal) => taxonomy.byId.get(signal.category)?.trivial === true)) return signals;

  const seen = new Set<string>();
  for (const line of unit.lines) {
    if (signals.length >= MAX_SIGNALS) break;
    const comment = COMMENT.test(line.text);
    for (const detector of taxonomy.detectors) {
      if (detector.target !== "line") continue;
      if (detector.paths && !detector.paths.test(unit.file)) continue;
      const match = detector.pattern.exec(line.text);
      if (!match) continue;
      const side = line.kind === "add" ? "head" : "base";
      const key = `${detector.id}:${side}:${line.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      signals.push({
        detector: detector.id,
        category: detector.category,
        strength: comment ? "weak" : detector.strength,
        floor: detector.floor,
        token: match[0].slice(0, 80),
        line: line.line,
        side,
        text: line.text.trim().slice(0, 200),
      });
    }
  }
  return signals;
}

/** Trivial: solo señales débiles de ruta de categorías triviales (CSS, tests, docs). Se resuelve sin LLM. */
export function isTrivial(signals: readonly Signal[], taxonomy: Taxonomy): boolean {
  return (
    signals.length > 0 &&
    signals.every((signal) => signal.strength === "weak" && taxonomy.byId.get(signal.category)?.trivial === true)
  );
}
