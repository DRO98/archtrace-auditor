import { test } from "node:test";
import assert from "node:assert/strict";
import type { CodeGraph, CodeModule } from "@core/graph";
import { detectApiRoutes, detectTechnologies, languageBreakdown } from "./architectureFacts";

function mod(id: string, filePath: string, blocks: string[] = [], extra: Partial<CodeModule> = {}): CodeModule {
  return {
    id,
    label: id,
    filePath,
    groupId: "g",
    language: filePath.endsWith(".py") ? "python" : "typescript",
    subBlocks: blocks.map((name, index) => ({ id: `${id}#${name}`, kind: "function", name, range: { startLine: index * 10 + 1, endLine: index * 10 + 5 } })),
    ...extra,
  };
}

const graph: CodeGraph = {
  version: 1,
  projectName: "p",
  groups: [],
  edges: [],
  modules: [
    mod("chat", "web/src/app/api/lesson/chat/route.ts", ["POST", "helper"]),
    mod("group", "src/app/(dash)/api/items/[id]/route.ts", ["GET", "DELETE"]),
    mod("pages", "pages/api/health/index.ts"),
    mod("server", "src/api/server.py", ["get_documents", "create_answer", "_private"], { role: "api", summary: "FastAPI app con Redis" }),
    mod("store", "src/rag/vector_store.py", ["search"], { summary: "Índice FAISS en memoria" }),
    mod("guard", "canvas/guardrails-1", [], { language: "virtual", summary: "redis" }),
  ],
};

test("detectApiRoutes: Next app router, pages/api y handlers de módulos de API", () => {
  const routes = detectApiRoutes(graph).map((route) => `${route.method} ${route.path} ${route.handler}`);
  assert.deepEqual(routes, [
    "ANY /api/health default",
    "GET /api/items/[id] GET",
    "DELETE /api/items/[id] DELETE",
    "POST /api/lesson/chat POST",
    "GET — get_documents",
    "POST — create_answer",
  ]);
});

test("detectTechnologies ignora componentes virtuales y agrupa por módulo", () => {
  const techs = detectTechnologies(graph);
  const names = techs.map((tech) => tech.name);
  assert.ok(names.includes("FastAPI"));
  assert.ok(names.includes("FAISS"));
  assert.deepEqual(techs.find((tech) => tech.name === "Redis")?.modules, ["server"]);
});

test("languageBreakdown cuenta módulos reales", () => {
  assert.deepEqual(languageBreakdown(graph), [
    { language: "typescript", modules: 3 },
    { language: "python", modules: 2 },
  ]);
});
