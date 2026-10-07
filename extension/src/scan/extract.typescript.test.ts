import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createParserHost } from "./parserHost.js";
import { buildProjectMap } from "./resolve.js";
import { mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";

const SOURCE = `/** Builds the greeting. */
export function greet(name: string): string {
  return \`Hello \${name}\`;
}

export class Store {
  private items: string[] = [];
  add(item: string): void {
    this.items.push(item);
  }
}

export const makeStore = (): Store => new Store();

export function App() {
  return <Panel title={greet("x")} />;
}
`;

function wasmDir(): string {
  const dir = path.resolve("dist/wasm");
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.resolve("node_modules/web-tree-sitter/tree-sitter.wasm"), path.join(dir, "tree-sitter.wasm"));
  const grammars = path.resolve("node_modules/tree-sitter-wasms/out");
  for (const name of ["python", "javascript", "tsx"]) {
    copyFileSync(path.join(grammars, `tree-sitter-${name}.wasm`), path.join(dir, `tree-sitter-${name}.wasm`));
  }
  return dir;
}

describe("typescript extraction", () => {
  it("reads the example component", async () => {
    const host = await createParserHost(wasmDir());
    try {
      const raw = await host.parse("typescript", "example.tsx", SOURCE);
      const map = buildProjectMap([{ filePath: "example.tsx", raw }], {
        workspaceName: "example",
        generatedAt: "2026-01-01T00:00:00.000Z",
        truncated: false,
        skippedFiles: 0,
      });
      const file = map.files[0];
      assert.ok(file);
      const byName = new Map(file.symbols.map((symbol) => [symbol.qualifiedName, symbol]));
      assert.deepEqual(byName.get("greet")?.range, { startLine: 2, endLine: 4 });
      assert.equal(byName.get("greet")?.doc, "Builds the greeting.");
      assert.deepEqual(byName.get("Store")?.range, { startLine: 6, endLine: 11 });
      assert.deepEqual(byName.get("Store.add")?.range, { startLine: 8, endLine: 10 });
      assert.deepEqual(byName.get("makeStore")?.range, { startLine: 13, endLine: 13 });
      assert.deepEqual(byName.get("makeStore")?.instantiations[0]?.range, { startLine: 13, endLine: 13 });
      assert.deepEqual(byName.get("App")?.range, { startLine: 15, endLine: 17 });
      assert.equal(byName.get("App")?.calls[0]?.target, "example.tsx::greet");
      assert.equal(byName.get("App")?.calls[0]?.line, 16);
    } finally {
      host.dispose();
    }
  });
});
