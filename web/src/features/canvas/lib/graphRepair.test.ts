import assert from "node:assert/strict";
import test from "node:test";
import { loadCodeGraph, normalizePath } from "./graphRepair";

function damaged(): Record<string, unknown> {
  return {
    version: 1,
    projectName: "demo",
    groups: [{ id: "core", label: "Core", color: "sky" }],
    modules: [
      { id: "src/a.py", filePath: "src/a.py", label: "A", groupId: "core", language: "python", subBlocks: [] },
      {
        id: "src/b.py",
        groupId: "core",
        language: "python",
        subBlocks: [{ id: "b1", kind: "function", name: "f", range: { startLine: 5, endLine: 2 } }],
      },
      {
        id: "src/c.py",
        filePath: "src/c.py",
        label: "C",
        groupId: "fantasma",
        language: "python",
        subBlocks: [],
        supportOf: "src/zzz.py",
      },
      { filePath: "sin-id.py" },
    ],
    edges: [
      { id: "e1", source: "src/a.py", target: "src/b.py", kind: "calls" },
      { id: "e2", source: "src/a.py", target: "src/no-existe.py", kind: "calls" },
      { id: "e3", source: "src/b.py", target: "src/c.py", kind: "raro" },
    ],
  };
}

test("loadCodeGraph acepta un grafo válido sin avisos", () => {
  const graph = damaged();
  graph.modules = [(graph.modules as unknown[])[0]];
  graph.edges = [];
  const loaded = loadCodeGraph(graph);
  assert.ok(loaded.ok);
  assert.equal(loaded.ok && loaded.warnings.length, 0);
});

test("loadCodeGraph repara aristas colgantes, nombres, grupos y vínculos rotos", () => {
  const loaded = loadCodeGraph(damaged());
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.errors.join("; "));
  if (!loaded.ok) return;
  const { graph, warnings } = loaded;
  assert.deepEqual(
    graph.modules.map((item) => item.id),
    ["src/a.py", "src/b.py", "src/c.py"],
  );
  const b = graph.modules.find((item) => item.id === "src/b.py");
  assert.equal(b?.label, "b.py");
  assert.equal(b?.filePath, "src/b.py");
  assert.equal(b?.subBlocks.length, 0);
  const c = graph.modules.find((item) => item.id === "src/c.py");
  assert.equal(c?.supportOf, undefined);
  assert.ok(graph.groups.some((group) => group.id === c?.groupId));
  assert.deepEqual(
    graph.edges.map((edge) => edge.id),
    ["e1", "e3"],
  );
  assert.equal(graph.edges.find((edge) => edge.id === "e3")?.kind, "imports");
  assert.ok(warnings.some((warning) => /conexiones hacia módulos que no existen/.test(warning)));
});

test("loadCodeGraph rechaza lo irrecuperable", () => {
  assert.equal(loadCodeGraph(null).ok, false);
  assert.equal(loadCodeGraph({ modules: "nope" }).ok, false);
});

test("normalizePath limpia rutas de Windows y relativas, y rechaza absolutas", () => {
  assert.equal(normalizePath(".\\src\\a.py"), "src/a.py");
  assert.equal(normalizePath("./src/a.py"), "src/a.py");
  assert.equal(normalizePath("C:/x/a.py"), null);
  assert.equal(normalizePath("../a.py"), null);
});
