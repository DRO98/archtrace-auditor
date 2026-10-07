import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

/** Gramáticas que necesita `createParserHost` (TS y TSX comparten `tree-sitter-tsx.wasm`). */
export const GRAMMAR_NAMES = ["python", "javascript", "tsx"] as const;

/**
 * Copia el runtime de tree-sitter y las gramáticas a `target` (la forma que espera `createParserHost`:
 * todo en una carpeta). Los orígenes se resuelven desde el `node_modules` del paquete `scanner/`,
 * así que el wasm siempre coincide con la versión de `web-tree-sitter` que se ejecuta.
 */
export function prepareWasmDir(target: string): string {
  const runtime = path.dirname(require.resolve("web-tree-sitter/package.json"));
  const grammars = path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
  mkdirSync(target, { recursive: true });
  copyIfMissing(path.join(runtime, "tree-sitter.wasm"), path.join(target, "tree-sitter.wasm"));
  for (const name of GRAMMAR_NAMES) {
    copyIfMissing(path.join(grammars, `tree-sitter-${name}.wasm`), path.join(target, `tree-sitter-${name}.wasm`));
  }
  return target;
}

/** Copia solo si falta o cambió de tamaño (otra versión de la gramática). */
function copyIfMissing(from: string, to: string): void {
  if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to);
}
