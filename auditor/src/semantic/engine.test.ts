import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChangeUnit } from "@core/audit";
import { AiError, type AiProvider } from "@llm/types";
import { MetricsRecorder } from "../metrics/metrics";
import { Bm25Retriever } from "../retrieval/bm25";
import { loadTaxonomy } from "../rules/taxonomy";
import { LlmCache } from "./cache";
import { SemanticEngine } from "./engine";

const taxonomy = loadTaxonomy(null);

function unit(id: string): ChangeUnit {
  return {
    id,
    file: `${id}.py`,
    status: "modified",
    language: "python",
    symbol: null,
    headLines: { startLine: 1, endLine: 1 },
    baseLines: null,
    added: 1,
    removed: 0,
    lines: [{ kind: "add", line: 1, text: `x_${id} = 1` }],
    hunkHeaders: ["@@"],
  };
}

describe("SemanticEngine: cortacircuitos", () => {
  it("tras 3 fallos seguidos deja de llamar al proveedor", async () => {
    let calls = 0;
    const provider: AiProvider = {
      id: "gemini",
      model: "lento",
      async completeJson() {
        calls += 1;
        throw new AiError("bad_response", "La IA no devolvió JSON válido.");
      },
      async completeText() {
        throw new Error("no se usa");
      },
    };
    const engine = new SemanticEngine({ provider, taxonomy, cache: new LlmCache(null), metrics: new MetricsRecorder(), sectionIds: new Set(), maxEscalations: 0 });
    for (const id of ["a", "b", "c", "d", "e"]) {
      const result = await engine.assess({
        unit: unit(id),
        signals: [],
        versions: { base: null, head: null },
        readText: async () => null,
        retriever: new Bm25Retriever([]),
        categoryRules: [],
        sectionsById: new Map(),
      });
      assert.equal(result, null);
    }
    assert.equal(calls, 3);
    assert.match(engine.disabledReason ?? "", /falló 3 veces seguidas/);
  });
});
