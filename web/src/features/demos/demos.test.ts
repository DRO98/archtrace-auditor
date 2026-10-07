import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCodeGraph } from "../canvas/lib/graph";
import { drawnGraph } from "../simulation/lib/drawnEdges";
import { resolveScenarioRoutes } from "../simulation/lib/route";
import { parseScenarioFile } from "../simulation/lib/scenario";
import { EMPTY_TRACE, applyTraceEvent } from "../playground/lib/traceState";
import { DEMOS, demoByGraph } from "./index";
import { demoTimeline } from "./lib/replay";
import { EVENT_DRIVEN_SHOP_DEMO } from "./catalog/eventDrivenShop";
import { eventRunner } from "../trace/runners";
import type { TraceSseEvent } from "@core/trace";

describe("demos en vivo", () => {
  it("tienen nombres de grafo válidos y únicos", () => {
    const names = DEMOS.map((demo) => demo.graphName);
    assert.equal(new Set(names).size, names.length);
    for (const name of names) {
      assert.match(name, /^[a-z0-9_-]+$/);
      assert.equal(demoByGraph(name)?.graphName, name);
    }
    assert.equal(demoByGraph("macro_rag_project"), null);
  });

  for (const demo of DEMOS) {
    describe(demo.title, () => {
      it("el grafo es válido y no oculta módulos", () => {
        const parsed = parseCodeGraph(demo.graph);
        assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors.join("\n"));
        const drawn = drawnGraph(demo.graph);
        assert.equal(drawn.graph.modules.length, demo.graph.modules.length);
      });

      it("los escenarios validan y cada transición tiene camino dibujado", () => {
        const drawn = drawnGraph(demo.graph);
        const parsed = parseScenarioFile(demo.scenarios, drawn.graph, drawn.edges);
        assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors.join("\n"));
        assert.equal(demo.scenarios.graph, demo.graphName);
        for (const scenario of parsed.file.scenarios) {
          const routes = resolveScenarioRoutes(scenario.steps, drawn.edges);
          routes.forEach((route, index) => assert.notEqual(route, null, `${scenario.id} · paso ${index} sin camino`));
        }
      });

      it("tiene al menos un perfil de prueba (RAG grabado o genérico)", () => {
        assert.ok(demo.playground || demo.trace);
        if (demo.trace?.entryNodeId) assert.ok(demo.graph.modules.some((item) => item.id === demo.trace?.entryNodeId));
      });

      it("la traza simulada del playground enciende nodos del grafo y termina con resultado", (context) => {
        if (!demo.playground) return context.skip("demo sin perfil RAG");
        const ids = new Set(demo.graph.modules.map((item) => item.id));
        for (const stage of demo.playground.stages) assert.ok(ids.has(stage.nodeId), stage.nodeId);

        const drawn = drawnGraph(demo.graph);
        const timeline = demoTimeline(demo.playground);
        let state = EMPTY_TRACE;
        for (const { event } of timeline) state = applyTraceEvent(state, event, drawn.edges);
        assert.equal(state.stages.length, demo.playground.stages.length);
        assert.ok(state.stages.every((stage) => stage.status === "done" && stage.label));
        assert.equal(timeline.at(-2)?.event.type, "result");
        assert.equal(timeline.at(-1)?.event.type, "done");
        assert.ok(demo.playground.question.trim() && demo.playground.documentText.trim());
      });
    });
  }
});

it("demo event-driven: el perfil Evento recorre Kafka hasta pagos, stock y analítica", async () => {
  const demo = EVENT_DRIVEN_SHOP_DEMO;
  assert.equal(demo.trace?.profile, "event");
  const events: TraceSseEvent[] = [];
  await eventRunner.run(
    { payload: JSON.parse(demo.trace?.payload ?? "{}") },
    {
      modules: demo.graph.modules.map(({ id, label, filePath, role }) => ({ id, label, filePath, role })),
      edges: demo.graph.edges.map(({ id, source, target, kind }) => ({ id, source, target, kind })),
      entryNodeId: demo.trace?.entryNodeId ?? null,
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      pause: async () => {},
    },
  );
  const visited = events.flatMap((event) => (event.type === "stage_start" && event.nodeId ? [event.nodeId] : []));
  for (const id of [
    "infra/kafka/orders_created_topic.ts",
    "services/billing/billing_consumer.py",
    "services/payments/payments_server.go",
    "services/inventory/stock_cache.ts",
    "services/analytics/clickhouse_sink.ts",
  ]) {
    assert.ok(visited.includes(id), id);
  }
  assert.ok(!visited.includes("gateway/orders_controller.ts"), "un evento no vuelve hacia la API");
});
