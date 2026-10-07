import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionFlowScenario, FlowStep } from "@core/simulation";
import { estimateSeconds, toStepViews } from "./stepView";

function step(index: number, nodeId: string, output: FlowStep["mockPayload"]["output"], durationMs?: number): FlowStep {
  const built: FlowStep = {
    stepIndex: index,
    nodeId,
    title: `Título ${index}`,
    description: `Descripción ${index}`,
    fileReference: { path: `${nodeId}.py`, lineStart: 10 + index, lineEnd: 20 + index, functionName: `fn${index}` },
    mockPayload: { input: "in", output },
  };
  if (durationMs !== undefined) built.durationMs = durationMs;
  return built;
}

const SCENARIO: ExecutionFlowScenario = {
  id: "s",
  name: "s",
  description: "s",
  entryNodeId: "a",
  steps: [step(0, "a", { text: "x", size: 1 }), step(1, "b", "hola", 3000), step(2, "b", { ok: true })],
};

test("toStepViews: numeración, ubicación y conexión con el siguiente", () => {
  const labels: Record<string, string> = { a: "Alfa", b: "Beta" };
  const views = toStepViews(SCENARIO, (id) => labels[id] ?? id);
  assert.deepEqual(
    views.map((view) => view.stepNumber),
    [1, 2, 3],
  );
  assert.equal(views[0]?.locationLabel, "a.py · L10–20 · fn0");
  assert.equal(views[0]?.connectionReason, "Envía {text, size} a «Beta».");
  assert.equal(views[1]?.connectionReason, 'Sigue dentro de «Beta» con "hola".');
  assert.equal(views[2]?.connectionReason, "Devuelve {ok}.");
});

test("estimateSeconds suma duraciones y usa 2000 ms por defecto", () => {
  assert.equal(estimateSeconds(SCENARIO), 7); // 2000 + 3000 + 2000
});
