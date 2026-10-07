import assert from "node:assert/strict";
import test from "node:test";
import { resolveScriptImports, scanScriptSource } from "./jsScan";

test("scanScriptSource encuentra funciones, clases y arrows de nivel superior", () => {
  const source = ["import x from 'y';", "", "export class Store {", "  get() {}", "}", "", "export const run = async (a: number) => {", "  return a;", "};", "function helper() {}", ""].join("\n");
  assert.deepEqual(scanScriptSource(source), [
    { name: "Store", kind: "class", startLine: 3, endLine: 5 },
    { name: "run", kind: "function", startLine: 7, endLine: 9 },
    { name: "helper", kind: "function", startLine: 10, endLine: 10 },
  ]);
});

test("resolveScriptImports resuelve relativos, index, .js→.ts y alias @/", () => {
  const known = new Set(["src/a.ts", "src/lib/index.ts", "src/b.tsx", "src/util/c.ts"]);
  const source = [
    'import { x } from "./lib";',
    'import B from "./b.js";',
    'export * from "@/util/c";',
    'const r = require("react");',
    'import "../outside";',
  ].join("\n");
  assert.deepEqual(resolveScriptImports(source, "src/a.ts", known), ["src/b.tsx", "src/lib/index.ts", "src/util/c.ts"]);
});
