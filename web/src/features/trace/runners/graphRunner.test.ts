import assert from "node:assert/strict";
import test from "node:test";
import type { TraceSseEvent } from "@core/trace";
import { applyTraceEvent, EMPTY_TRACE, type TraceVisuals } from "../../playground/lib/traceState";
import { eventRunner, httpRunner } from "./graphRunner";

const modules = [
  { id: "api.ts", label: "API", filePath: "src/api.ts", role: "api" as const },
  { id: "svc.ts", label: "Service", filePath: "src/service.ts", role: "service" as const },
  { id: "db.ts", label: "DB", filePath: "src/db.ts", role: "database" as const },
];
const edges = [
  { id: "calls:api.ts:svc.ts", source: "api.ts", target: "svc.ts", kind: "calls" as const },
  { id: "imports:svc.ts:db.ts", source: "svc.ts", target: "db.ts", kind: "imports" as const },
];

async function collect(run: (emit: (event: TraceSseEvent) => void) => Promise<void>): Promise<TraceSseEvent[]> {
  const events: TraceSseEvent[] = [];
  await run((event) => events.push(event));
  return events;
}

test("httpRunner simulado: etapa por nodo, resultado y done; el lienzo acumula latencias", async () => {
  const events = await collect((emit) =>
    httpRunner.run(
      { payload: { id: 1 } },
      { modules, edges, entryNodeId: null, signal: new AbortController().signal, emit, pause: async () => {} },
    ),
  );
  const starts = events.filter((event) => event.type === "stage_start");
  assert.deepEqual(
    starts.map((event) => (event.type === "stage_start" ? event.nodeId : null)),
    ["api.ts", "svc.ts", "db.ts"],
  );
  const result = events.find((event) => event.type === "result");
  assert.ok(result && result.type === "result");
  assert.equal(result.simulated, true);
  assert.equal(result.hops, 3);
  assert.deepEqual(result.output, { id: 1 });
  assert.equal(events.at(-1)?.type, "done");

  const drawn = edges.map(({ id, source, target }) => ({ id, source, target }));
  let state: TraceVisuals = EMPTY_TRACE;
  for (const event of events) state = applyTraceEvent(state, event, drawn);
  assert.deepEqual(Object.keys(state.latencyByNode).sort(), ["api.ts", "db.ts", "svc.ts"]);
  assert.ok(state.stages.every((stage) => stage.status === "done"));
});

test("httpRunner con URL: el paso de entrada hace la petición real y marca el error HTTP", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"error":"boom"}', { status: 503, statusText: "Service Unavailable" })) as typeof fetch;
  try {
    const events = await collect((emit) =>
      httpRunner.run(
        { payload: { id: 1 }, url: "http://localhost:9999/x", method: "POST" },
        { modules, edges, entryNodeId: "api.ts", signal: new AbortController().signal, emit, pause: async () => {} },
      ),
    );
    const firstDone = events.find((event) => event.type === "stage_done");
    assert.ok(firstDone && firstDone.type === "stage_done");
    assert.match(firstDone.error ?? "", /503/);
    const result = events.find((event) => event.type === "result");
    assert.ok(result && result.type === "result");
    assert.equal(result.simulated, false);
    assert.equal(result.errors, 1);
    assert.deepEqual(result.output, { error: "boom" });

    const drawn = edges.map(({ id, source, target }) => ({ id, source, target }));
    let state: TraceVisuals = EMPTY_TRACE;
    for (const event of events) state = applyTraceEvent(state, event, drawn);
    assert.equal(state.stages[0]?.status, "error");
  } finally {
    globalThis.fetch = original;
  }
});

test("eventRunner sin módulos emite error y done", async () => {
  const events = await collect((emit) =>
    eventRunner.run({ payload: {} }, { modules: [], edges: [], entryNodeId: null, signal: new AbortController().signal, emit }),
  );
  assert.deepEqual(
    events.map((event) => event.type),
    ["error", "done"],
  );
});
