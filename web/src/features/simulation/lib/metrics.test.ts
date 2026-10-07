import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionFlowScenario, FlowStep, StepMetrics } from "@core/simulation";
import { aggregateMetrics, componentMetrics, contextScoreTone, formatLatency, latencyTone, ragStepMetrics } from "./metrics";

function step(stepIndex: number, metrics?: StepMetrics): FlowStep {
  const built: FlowStep = {
    stepIndex,
    nodeId: "a.py",
    title: "t",
    description: "d",
    fileReference: { path: "a.py", lineStart: 1, lineEnd: 2, functionName: "f" },
    mockPayload: { input: "i", output: "o" },
  };
  if (metrics) built.metrics = metrics;
  return built;
}

function scenario(steps: FlowStep[]): ExecutionFlowScenario {
  return { id: "s", name: "s", description: "s", entryNodeId: "a.py", steps };
}

test("aggregateMetrics suma latencias y tokens y promedia contextScore de los pasos con métricas", () => {
  const result = aggregateMetrics(
    scenario([
      step(0, ragStepMetrics(100, 10, 0, 0.9)),
      step(1),
      step(2, ragStepMetrics(400, 30, 20, 0.5)),
    ]),
  );
  assert.deepEqual(result.latencyMs, { steps: [100, null, 400], total: 500 });
  assert.deepEqual(result.tokenCount, { prompt: 40, generation: 20, total: 60 });
  assert.ok(result.contextScore !== null && Math.abs(result.contextScore - 0.7) < 1e-9);
  assert.equal(result.measuredSteps, 2);
});

test("aggregateMetrics sin métricas devuelve ceros y contextScore null", () => {
  const result = aggregateMetrics(scenario([step(0), step(1)]));
  assert.deepEqual(result.latencyMs, { steps: [null, null], total: 0 });
  assert.deepEqual(result.tokenCount, { prompt: 0, generation: 0, total: 0 });
  assert.equal(result.contextScore, null);
  assert.equal(result.measuredSteps, 0);
});

test("umbrales de color de latencia y contextScore", () => {
  assert.equal(latencyTone(150), "good");
  assert.equal(latencyTone(151), "warn");
  assert.equal(latencyTone(500), "warn");
  assert.equal(latencyTone(501), "bad");
  assert.equal(contextScoreTone(0.7), "good");
  assert.equal(contextScoreTone(0.69), "warn");
  assert.equal(contextScoreTone(0.4), "warn");
  assert.equal(contextScoreTone(0.39), "bad");
});

test("formatLatency pasa a segundos a partir de 1000 ms", () => {
  assert.equal(formatLatency(320), "320 ms");
  assert.equal(formatLatency(1350), "1.4 s");
});

test("componentMetrics agrega solo los pasos del componente y guarda la latencia del flujo", () => {
  const other = step(1, ragStepMetrics(300, 5, 5, 0.2));
  other.nodeId = "b.py";
  const flow = scenario([
    step(0, ragStepMetrics(100, 10, 0, 0.9)),
    other,
    step(2, ragStepMetrics(50, 0, 20, 0.7)),
  ]);
  const result = componentMetrics(flow, "a.py");
  assert.ok(result);
  assert.equal(result.latencyMs, 150);
  assert.equal(result.flowLatencyMs, 450);
  assert.deepEqual(result.tokenCount, { prompt: 10, generation: 20, total: 30 });
  assert.ok(Math.abs((result.contextScore ?? 0) - 0.8) < 1e-9);
  assert.equal(componentMetrics(flow, "zzz"), null);
});

test("aggregateMetrics con métricas genéricas (sin extensiones RAG) cuenta latencia y errores", () => {
  const result = aggregateMetrics(
    scenario([step(0, { latencyMs: 40 }), step(1, { latencyMs: 60, error: "timeout", extensions: { status: 504 } })]),
  );
  assert.equal(result.latencyMs.total, 100);
  assert.equal(result.errorSteps, 1);
  assert.equal(result.hasRagExtensions, false);
  assert.equal(result.contextScore, null);
  assert.deepEqual(result.tokenCount, { prompt: 0, generation: 0, total: 0 });
});
