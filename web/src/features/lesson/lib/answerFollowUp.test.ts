import assert from "node:assert/strict";
import test from "node:test";
import type { MapSymbol, ProjectMap } from "@core/projectMap";
import { buildDigest } from "./digest";
import { resolveHandles } from "./answerFollowUp";

function symbol(id: string, name: string, startLine: number, endLine: number): MapSymbol {
  return {
    id,
    kind: "function",
    name,
    qualifiedName: name,
    range: { startLine, endLine },
    signature: `def ${name}()`,
    calls: [],
    instantiations: [],
  };
}

const map: ProjectMap = {
  version: 1,
  workspaceName: "demo",
  generatedAt: "2026-01-01T00:00:00Z",
  revision: "r1",
  truncated: false,
  stats: { files: 1, symbols: 2, skippedFiles: 0, unresolvedCalls: 0, ambiguousCalls: 0 },
  files: [
    {
      filePath: "src/rag/pipeline.py",
      language: "python",
      lineCount: 80,
      imports: [],
      symbols: [symbol("a", "ingest", 10, 20), symbol("b", "retrieve", 22, 40)],
      moduleScope: { calls: [], instantiations: [] },
    },
  ],
};

test("resolveHandles cambia las citas por identificador (S2) por el rango de líneas del símbolo", () => {
  const digest = buildDigest(map);
  const answer = resolveHandles("Mira `src/rag/pipeline.py:S2` y src/rag/pipeline.py:S1.", digest, map);
  assert.equal(answer, "Mira `src/rag/pipeline.py:22-40` y src/rag/pipeline.py:10-20.");
});

test("resolveHandles deja solo la ruta si el identificador no existe", () => {
  const digest = buildDigest(map);
  assert.equal(resolveHandles("src/rag/pipeline.py:S9", digest, map), "src/rag/pipeline.py");
});
