import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraph, CodeModule } from "@core/graph";
import type { MapFile, MapSymbol, ProjectMap } from "@core/projectMap";
import { affectedModules, rebuildFromMap, sameSourceFile, subBlockPatches, symbolsToSubBlocks } from "./sourceSync";

const CHUNKER: CodeModule = {
  id: "src/rag/chunker.py",
  label: "Chunker",
  filePath: "src/rag/chunker.py",
  groupId: "rag",
  language: "python",
  subBlocks: [
    {
      id: "src/rag/chunker.py::chunk_text",
      kind: "function",
      name: "chunk_text",
      range: { startLine: 4, endLine: 12 },
      summary: "Parte el texto",
    },
  ],
};
const ROUTES: CodeModule = { ...CHUNKER, id: "src/api/routes.py", filePath: "src/api/routes.py", subBlocks: [] };
const GRAPH: CodeGraph = { version: 1, projectName: "sandbox", groups: [], modules: [CHUNKER, ROUTES], edges: [] };

function symbol(partial: Partial<MapSymbol> & Pick<MapSymbol, "id" | "kind" | "name" | "qualifiedName">): MapSymbol {
  return { range: { startLine: 1, endLine: 1 }, signature: "", calls: [], instantiations: [], ...partial };
}

function mapFile(filePath: string, symbols: MapSymbol[]): MapFile {
  return {
    filePath,
    language: "python",
    lineCount: 40,
    imports: [],
    symbols,
    moduleScope: { calls: [], instantiations: [] },
  };
}

function projectMap(files: MapFile[]): ProjectMap {
  return {
    version: 1,
    workspaceName: "TEACHER",
    generatedAt: "2026-09-26T10:00:00.000Z",
    revision: "r1",
    truncated: false,
    stats: { files: files.length, symbols: 0, skippedFiles: 0, unresolvedCalls: 0, ambiguousCalls: 0 },
    files,
  };
}

test("sameSourceFile acepta rutas del workspace padre pero no nombres que solo comparten sufijo", () => {
  assert.equal(sameSourceFile("sandbox/src/rag/chunker.py", "src/rag/chunker.py"), true);
  assert.equal(sameSourceFile("src/rag/chunker.py", "src/rag/chunker.py"), true);
  assert.equal(sameSourceFile("src/rag/mychunker.py", "rag/chunker.py"), false);
});

test("affectedModules devuelve solo los módulos cambiados", () => {
  assert.deepEqual(
    affectedModules(GRAPH, ["sandbox/src/rag/chunker.py", "README.md"]).map((item) => item.id),
    ["src/rag/chunker.py"],
  );
});

test("symbolsToSubBlocks usa ids del grafo, enlaza padres y conserva resúmenes", () => {
  const file = mapFile("sandbox/src/rag/chunker.py", [
    symbol({ id: "c", kind: "class", name: "Chunker", qualifiedName: "Chunker", range: { startLine: 2, endLine: 20 } }),
    symbol({
      id: "m",
      kind: "method",
      name: "split",
      qualifiedName: "Chunker.split",
      parentId: "c",
      range: { startLine: 5, endLine: 9 },
    }),
    symbol({ id: "f", kind: "function", name: "chunk_text", qualifiedName: "chunk_text", range: { startLine: 22, endLine: 30 } }),
  ]);
  assert.deepEqual(symbolsToSubBlocks(CHUNKER, file), [
    { id: "src/rag/chunker.py::Chunker", kind: "class", name: "Chunker", range: { startLine: 2, endLine: 20 } },
    {
      id: "src/rag/chunker.py::Chunker.split",
      kind: "method",
      name: "Chunker.split",
      range: { startLine: 5, endLine: 9 },
      parentId: "src/rag/chunker.py::Chunker",
    },
    {
      id: "src/rag/chunker.py::chunk_text",
      kind: "function",
      name: "chunk_text",
      range: { startLine: 22, endLine: 30 },
      summary: "Parte el texto",
    },
  ]);
});

test("subBlockPatches omite módulos sin cambios y archivos que el IDE no indexó", () => {
  const same = projectMap([
    mapFile("src/rag/chunker.py", [
      symbol({ id: "f", kind: "function", name: "chunk_text", qualifiedName: "chunk_text", range: { startLine: 4, endLine: 12 } }),
    ]),
  ]);
  assert.equal(subBlockPatches(GRAPH, same, ["src/rag/chunker.py"]).size, 0);
  assert.equal(subBlockPatches(GRAPH, projectMap([]), ["src/rag/chunker.py"]).size, 0);

  const moved = projectMap([
    mapFile("src/rag/chunker.py", [
      symbol({ id: "f", kind: "function", name: "chunk_text", qualifiedName: "chunk_text", range: { startLine: 6, endLine: 15 } }),
    ]),
  ]);
  const patches = subBlockPatches(GRAPH, moved, ["src/rag/chunker.py"]);
  assert.deepEqual([...patches.keys()], ["src/rag/chunker.py"]);
  assert.deepEqual(patches.get("src/rag/chunker.py")?.[0]?.range, { startLine: 6, endLine: 15 });
});

test("rebuildFromMap: añade imports y calls nuevos, módulos nuevos y respeta aristas curadas al revés", () => {
  const graph: CodeGraph = {
    ...GRAPH,
    groups: [{ id: "rag", label: "rag", color: "violet" }],
    edges: [
      // Curada "al revés": routes importa chunker, pero se dibuja chunker → routes.
      { id: "imports:src/rag/chunker.py:src/api/routes.py", source: "src/rag/chunker.py", target: "src/api/routes.py", kind: "imports" },
    ],
  };
  const routes = {
    ...mapFile("sandbox/src/api/routes.py", [symbol({ id: "sandbox/src/api/routes.py::handle", kind: "function", name: "handle", qualifiedName: "handle", calls: [{ target: "sandbox/src/kafka/producer.py::publish", line: 3 }] })]),
    imports: ["sandbox/src/rag/chunker.py"],
  };
  const producer = mapFile("sandbox/src/kafka/producer.py", [symbol({ id: "sandbox/src/kafka/producer.py::publish", kind: "function", name: "publish", qualifiedName: "publish" })]);
  const chunker = mapFile("sandbox/src/rag/chunker.py", [symbol({ id: "sandbox/src/rag/chunker.py::chunk_text", kind: "function", name: "chunk_text", qualifiedName: "chunk_text", range: { startLine: 4, endLine: 12 } })]);
  const rebuilt = rebuildFromMap(graph, projectMap([routes, producer, chunker]), ["sandbox/src/api/routes.py", "sandbox/src/kafka/producer.py"]);
  assert.ok(rebuilt);
  assert.deepEqual(rebuilt.added, ["src/kafka/producer.py"]);
  const producerModule = rebuilt.graph.modules.find((item) => item.id === "src/kafka/producer.py");
  assert.equal(producerModule?.role, "broker");
  assert.equal(producerModule?.groupId, "kafka");
  assert.ok(rebuilt.graph.groups.some((group) => group.id === "kafka"));
  assert.deepEqual(rebuilt.addedEdges, ["calls:src/api/routes.py:src/kafka/producer.py"]);
  assert.deepEqual(rebuilt.removedEdges, []);
});

test("rebuildFromMap: quita un import que ya no existe en ningún sentido; null si nada cambia", () => {
  const graph: CodeGraph = {
    ...GRAPH,
    edges: [{ id: "imports:src/api/routes.py:src/rag/chunker.py", source: "src/api/routes.py", target: "src/rag/chunker.py", kind: "imports" }],
  };
  const chunker = mapFile("src/rag/chunker.py", [symbol({ id: "src/rag/chunker.py::chunk_text", kind: "function", name: "chunk_text", qualifiedName: "chunk_text", range: { startLine: 4, endLine: 12 } })]);
  const rebuilt = rebuildFromMap(graph, projectMap([mapFile("src/api/routes.py", []), chunker]), ["src/api/routes.py"]);
  assert.ok(rebuilt);
  assert.deepEqual(rebuilt.removedEdges, ["imports:src/api/routes.py:src/rag/chunker.py"]);
  assert.equal(rebuilt.graph.edges.length, 0);

  const same = rebuildFromMap(GRAPH, projectMap([mapFile("src/api/routes.py", []), chunker]), ["src/api/routes.py"]);
  assert.equal(same, null);
});
