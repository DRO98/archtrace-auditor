import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraph } from "@core/graph";
import { generateArchitectureMarkdown, generateMermaidGraph, type MermaidNode } from "./mermaidExporter";

const nodes: MermaidNode[] = [
  { id: "subsystem:rag", type: "subsystem", data: { label: "RAG Core" } },
  {
    id: "src/rag/chunker.py",
    type: "module",
    parentId: "subsystem:rag",
    data: { label: "unused", role: "transform", module: { label: "Chunker", role: "transform" } },
  },
  {
    id: "src/api/routes.py",
    type: "module",
    data: { role: "api", module: { label: 'Ask "now"' } },
  },
];

test("el diagrama agrupa subsistemas, aliasa rutas y omite aristas de apoyo", () => {
  const mermaid = generateMermaidGraph(nodes, [
    { id: "e1", source: "src/rag/chunker.py", target: "src/api/routes.py" },
    { id: "support:src/rag/chunker.py:helper", source: "src/rag/chunker.py", target: "helper" },
  ]);
  assert.match(mermaid, /^graph TD/);
  assert.match(mermaid, /subgraph n0\["RAG Core"\]/);
  assert.match(mermaid, /n1\["Chunker \(transform\)"\]/);
  assert.match(mermaid, /n2\["Ask #quot;now#quot; \(api\)"\]/);
  assert.match(mermaid, /n1 --> n2/);
  assert.equal(mermaid.includes("support:"), false);
  assert.equal(mermaid.includes("src/rag"), false);
});

test("el diagrama distingue tipos de arista y colorea por rol", () => {
  const mermaid = generateMermaidGraph(nodes, [
    { id: "e1", source: "src/api/routes.py", target: "src/rag/chunker.py", kind: "calls" },
    { id: "e2", source: "src/rag/chunker.py", target: "src/api/routes.py", kind: "data-flow" },
  ]);
  assert.match(mermaid, /n2 -->\|calls\| n1/);
  assert.match(mermaid, /n1 -\.->\|datos\| n2/);
  assert.match(mermaid, /classDef role_api fill:/);
  assert.match(mermaid, /class n2 role_api/);
});

test("el markdown incluye el diagrama y la descripción de la lección", () => {
  const graph: CodeGraph = {
    version: 1,
    projectName: "Macro RAG",
    groups: [],
    modules: [
      {
        id: "src/rag/chunker.py",
        label: "Chunker",
        filePath: "src/rag/chunker.py",
        groupId: "rag",
        language: "python",
        summary: "Parte el documento.",
        subBlocks: [],
      },
    ],
    edges: [],
  };
  const markdown = generateArchitectureMarkdown(graph, "graph LR", new Map([["src/rag/chunker.py", "Lección: trocea por tokens."]]));
  assert.match(markdown, /^# Macro RAG/);
  assert.match(markdown, /```mermaid\ngraph LR\n```/);
  assert.match(markdown, /Parte el documento\. Lección: trocea por tokens\./);
  assert.match(markdown, /`src\/rag\/chunker.py`/);
});

test("el markdown documenta dependencias, subsistemas y el flujo de datos de los escenarios", () => {
  const makeModule = (id: string, label: string, layer: number): CodeGraph["modules"][number] => ({
    id,
    label,
    filePath: id,
    groupId: "g",
    language: "python",
    role: layer === 0 ? "api" : "transform",
    layer,
    subBlocks: [{ id: `${id}::run`, kind: "function", name: "run", range: { startLine: 3, endLine: 9 }, summary: "Hace el trabajo." }],
  });
  const graph: CodeGraph = {
    version: 1,
    projectName: "Demo",
    groups: [],
    modules: [makeModule("api.py", "API", 0), makeModule("chunker.py", "Chunker", 1)],
    edges: [{ id: "imports:api.py:chunker.py", source: "api.py", target: "chunker.py", kind: "imports" }],
  };
  const markdown = generateArchitectureMarkdown(graph, "graph TD", new Map(), {
    subsystemByModuleId: new Map([["chunker.py", "RAG Core"]]),
    generatedAt: new Date("2026-01-02T00:00:00Z"),
    scenarios: [
      {
        id: "ask",
        name: "Preguntar",
        description: "De la API al chunker.",
        entryNodeId: "api.py",
        steps: [
          {
            stepIndex: 0,
            nodeId: "api.py",
            title: "Entra",
            description: "Llega la petición.",
            fileReference: { path: "api.py", lineStart: 3, lineEnd: 9, functionName: "run" },
            mockPayload: { input: "a", output: "b" },
          },
          {
            stepIndex: 1,
            nodeId: "chunker.py",
            title: "Trocea",
            description: "Parte el texto.",
            fileReference: { path: "chunker.py", lineStart: 3, lineEnd: 9, functionName: "run" },
            mockPayload: { input: "a", output: "b" },
          },
        ],
      },
    ],
  });
  assert.match(markdown, /^# Demo — Arquitectura/);
  assert.match(markdown, /2026-01-02/);
  assert.match(markdown, /\*\*Depende de:\*\* \[Chunker\]\(#chunker\) _\(importa\)_/);
  assert.match(markdown, /\*\*Usado por:\*\* \[API\]\(#api\)/);
  assert.match(markdown, /\| RAG Core \| Chunker \|/);
  assert.match(markdown, /## Flujo de datos\n\n### Preguntar/);
  assert.match(markdown, /Recorrido: API → Chunker/);
  assert.match(markdown, /`run` \(L3–9\) — Hace el trabajo\./);
  assert.match(markdown, /\| API \| Chunker \| imports \|/);
});
