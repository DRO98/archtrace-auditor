import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { CodeGraph } from "@core/graph";
import { parseCodeGraph, validateRanges } from "./graph";
import { loadCodeGraph } from "./graphRepair";

function sample(): CodeGraph {
  return {
    version: 1,
    projectName: "sandbox",
    groups: [{ id: "rag", label: "RAG Pipeline", color: "violet" }],
    modules: [
      {
        id: "src/rag/vector_store.py",
        label: "vector_store.py",
        filePath: "src/rag/vector_store.py",
        groupId: "rag",
        language: "python",
        subBlocks: [
          {
            id: "src/rag/vector_store.py::VectorStore",
            kind: "class",
            name: "VectorStore",
            range: { startLine: 24, endLine: 77 },
          },
          {
            id: "src/rag/vector_store.py::VectorStore.search",
            kind: "method",
            name: "VectorStore.search",
            range: { startLine: 56, endLine: 68 },
            parentId: "src/rag/vector_store.py::VectorStore",
          },
        ],
      },
    ],
    edges: [],
  };
}

test("parseCodeGraph acepta un JSON válido", () => {
  const parsed = parseCodeGraph(sample());
  assert.equal(parsed.ok, true);
});

test("parseCodeGraph rechaza un id de módulo duplicado", () => {
  const graph = sample();
  graph.modules.push({ ...graph.modules[0], subBlocks: [] });
  const parsed = parseCodeGraph(graph);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.ok(parsed.errors.some((error) => error.includes("duplicado")));
});

test("parseCodeGraph rechaza una arista hacia un módulo inexistente", () => {
  const graph = sample();
  graph.edges.push({ id: "e1", source: graph.modules[0].id, target: "src/missing.py", kind: "imports" });
  const parsed = parseCodeGraph(graph);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.ok(parsed.errors.some((error) => error.includes("inexistente")));
});

test("parseCodeGraph rechaza endLine < startLine", () => {
  const graph = sample();
  graph.modules[0].subBlocks[0].range = { startLine: 10, endLine: 4 };
  const parsed = parseCodeGraph(graph);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.ok(parsed.errors.some((error) => error.includes("endLine < startLine")));
});

test("parseCodeGraph rechaza filePath con barra invertida", () => {
  const graph = sample();
  graph.modules[0].filePath = "src\\rag\\vector_store.py";
  const parsed = parseCodeGraph(graph);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.ok(parsed.errors.some((error) => error.includes("filePath")));
});

test("parseCodeGraph rechaza un parentId inexistente", () => {
  const graph = sample();
  graph.modules[0].subBlocks[1].parentId = "src/rag/vector_store.py::Missing";
  const parsed = parseCodeGraph(graph);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.ok(parsed.errors.some((error) => error.includes("parentId inexistente")));
});

test("parseCodeGraph conserva role, subtitle y supportOf", () => {
  const graph = sample();
  const parent = graph.modules[0];
  parent.role = "database";
  parent.subtitle = "upsert · search";
  graph.modules.push({
    id: "src/rag/embeddings.py",
    label: "embeddings.py",
    filePath: "src/rag/embeddings.py",
    groupId: "rag",
    language: "python",
    role: "ai-model",
    subtitle: "embed",
    supportOf: parent.id,
    subBlocks: [],
  });
  const parsed = parseCodeGraph(graph);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const stored = parsed.graph.modules.find((item) => item.id === "src/rag/embeddings.py");
  assert.equal(stored?.role, "ai-model");
  assert.equal(stored?.subtitle, "embed");
  assert.equal(stored?.supportOf, parent.id);
  assert.equal(parsed.graph.modules[0]?.role, "database");
  assert.equal(parsed.graph.modules[0]?.subtitle, "upsert · search");
});

test("parseCodeGraph rechaza un role inválido", () => {
  const graph = sample();
  const parsed = parseCodeGraph({
    ...graph,
    modules: [{ ...graph.modules[0], role: "banana" }],
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.ok(parsed.errors.some((error) => error.includes("role inválido")));
});

test("parseCodeGraph rechaza un supportOf inexistente", () => {
  const graph = sample();
  const parsed = parseCodeGraph({
    ...graph,
    modules: [{ ...graph.modules[0], supportOf: "src/missing.py" }],
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.ok(parsed.errors.some((error) => error.includes("supportOf inexistente")));
});

test("parseCodeGraph rechaza un supportOf que apunta a sí mismo", () => {
  const graph = sample();
  const parsed = parseCodeGraph({
    ...graph,
    modules: [{ ...graph.modules[0], supportOf: graph.modules[0].id }],
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.ok(parsed.errors.some((error) => error.includes("supportOf apunta a sí mismo")));
});

test("parseCodeGraph rechaza una cadena de módulos de apoyo", () => {
  const graph = sample();
  const base = graph.modules[0];
  const parsed = parseCodeGraph({
    ...graph,
    modules: [
      { ...base, id: "src/c.py", filePath: "src/c.py", subBlocks: [] },
      { ...base, id: "src/b.py", filePath: "src/b.py", supportOf: "src/c.py", subBlocks: [] },
      { ...base, id: "src/a.py", filePath: "src/a.py", supportOf: "src/b.py", subBlocks: [] },
    ],
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.ok(parsed.errors.some((error) => error.includes("supportOf apunta a otro módulo de apoyo")));
  }
});

test("validateRanges acepta la fuente real de vector_store.py", () => {
  const source = readFileSync(path.resolve(process.cwd(), "../sandbox/src/rag/vector_store.py"), "utf8");
  const errors = validateRanges(sample(), () => source);
  assert.deepEqual(errors, []);
});

test("validateRanges nombra el sub-bloque cuando los rangos se desplazan", () => {
  const source = readFileSync(path.resolve(process.cwd(), "../sandbox/src/rag/vector_store.py"), "utf8");
  const errors = validateRanges(sample(), () => `\n${source}`);
  assert.ok(errors.some((error) => error.includes("VectorStore.search")));
});

test("validateRanges avisa si el archivo no existe", () => {
  const errors = validateRanges(sample(), () => null);
  assert.ok(errors.some((error) => error.includes("VectorStore.search") && error.includes("inexistente")));
});

test("parseCodeGraph conserva lo que necesita el mapa de sistema: tech, service, descripción de grupo y omitidos", () => {
  const raw = {
    version: 1,
    projectName: "pisd",
    groups: [{ id: "infra", label: "Infraestructura", color: "zinc", summary: "Servicios del compose" }],
    modules: [
      { id: "infra:mongodb", label: "MongoDB", filePath: "docker-compose.yml", groupId: "infra", language: "yaml", role: "database", tech: ["mongodb"], subBlocks: [] },
      { id: "api/app.py", label: "App", filePath: "api/app.py", groupId: "infra", language: "python", role: "api", service: "acceso", tech: ["fastapi"], subBlocks: [] },
    ],
    edges: [{ id: "e", source: "api/app.py", target: "infra:mongodb", kind: "data-flow", label: "MongoDB" }],
    omitted: { count: 2, paths: ["tests/test_a.py", "pkg/__init__.py"] },
  };
  const parsed = parseCodeGraph(raw);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.graph.modules[0]?.tech, ["mongodb"]);
  assert.equal(parsed.graph.modules[1]?.service, "acceso");
  assert.equal(parsed.graph.groups[0]?.summary, "Servicios del compose");
  assert.deepEqual(parsed.graph.omitted, { count: 2, paths: ["tests/test_a.py", "pkg/__init__.py"] });
  // Ida y vuelta: lo que construye el import sobrevive a la carga.
  assert.deepEqual(loadCodeGraph(JSON.parse(JSON.stringify(parsed.graph))).ok, true);
});
