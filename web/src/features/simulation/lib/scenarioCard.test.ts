import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionFlowScenario, FlowStep } from "@core/simulation";
import { pipelineLabels, scenarioOperation } from "./scenarioCard";

function step(index: number, nodeId: string, functionName: string): FlowStep {
  return {
    stepIndex: index,
    nodeId,
    title: `Paso ${index}`,
    description: "d",
    fileReference: { path: `${nodeId}.py`, lineStart: 1, lineEnd: 2, functionName },
    mockPayload: { input: "i", output: "o" },
  };
}

function scenario(
  partial: Pick<ExecutionFlowScenario, "id" | "name" | "description">,
  steps: FlowStep[],
): ExecutionFlowScenario {
  return { ...partial, entryNodeId: steps[0]?.nodeId ?? "", steps };
}

test("guardar un documento es ingestión aunque la descripción mencione preguntas", () => {
  const item = scenario(
    {
      id: "ingest-document",
      name: "Guardar un documento",
      description: "Queda guardado y listo para responder preguntas.",
    },
    [step(0, "routes", "ingest_document"), step(1, "store", "VectorStore.upsert")],
  );
  assert.equal(scenarioOperation(item), "ingest");
});

test("responder una pregunta es consulta", () => {
  const item = scenario(
    {
      id: "answer-question",
      name: "Responder una pregunta",
      description: "Busca pistas y redacta la respuesta.",
    },
    [step(0, "routes", "ask_question"), step(1, "llm", "LlmService.complete")],
  );
  assert.equal(scenarioOperation(item), "query");
});

test("el recorrido lista cada módulo una sola vez, en orden de primera visita", () => {
  const item = scenario(
    { id: "q", name: "Consulta", description: "" },
    [step(0, "api", "ask"), step(1, "pipe", "retrieve"), step(2, "store", "search"), step(3, "pipe", "answer")],
  );
  assert.deepEqual(
    pipelineLabels(item, (id) => id.toUpperCase()),
    ["API", "PIPE", "STORE"],
  );
});
