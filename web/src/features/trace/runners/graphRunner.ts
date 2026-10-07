import type { TraceGenericResult, TraceProfileId, TraceSseEvent } from "@core/trace";
import { defaultEntry, simulatedLatency, walkGraph } from "@/lib/trace/graphWalk";
import { abortableWait, type TraceRunContext, type TraceRunner } from "./types";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface GraphTraceInput {
  /** JSON (o texto) que se inyecta en el punto de entrada. */
  payload: unknown;
  /** Solo HTTP: si hay URL, el paso de entrada hace la petición real y mide su latencia. */
  url?: string;
  method?: HttpMethod;
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 4000;
/** Tiempo en pantalla de cada paso: la latencia simulada es de milisegundos; se estira a algo legible. */
const MIN_VISIBLE_MS = 280;
const MAX_VISIBLE_MS = 900;

interface HttpOutcome {
  latencyMs: number;
  detail: string;
  error?: string;
  output?: unknown;
}

async function callEndpoint(input: GraphTraceInput, signal: AbortSignal): Promise<HttpOutcome> {
  const method = input.method ?? "POST";
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("timeout")), REQUEST_TIMEOUT_MS);
  const started = performance.now();
  try {
    const hasBody = method !== "GET" && method !== "DELETE" && input.payload !== undefined;
    const response = await fetch(input.url ?? "", {
      method,
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? (typeof input.payload === "string" ? input.payload : JSON.stringify(input.payload)) : undefined,
      signal: controller.signal,
    });
    const text = (await response.text()).slice(0, MAX_OUTPUT_CHARS);
    const latencyMs = performance.now() - started;
    let output: unknown = text;
    try {
      output = JSON.parse(text);
    } catch {
      // Respuesta no JSON: se muestra como texto.
    }
    const detail = `${method} → HTTP ${response.status}`;
    return response.ok ? { latencyMs, detail, output } : { latencyMs, detail, output, error: `HTTP ${response.status} ${response.statusText}`.trim() };
  } catch (error) {
    if (signal.aborted) throw error;
    const latencyMs = performance.now() - started;
    const reason = controller.signal.aborted ? `sin respuesta en ${REQUEST_TIMEOUT_MS / 1000} s` : error instanceof Error ? error.message : "fallo de red";
    // Un `TypeError: Failed to fetch` en el navegador suele ser CORS o el servicio apagado.
    return { latencyMs, detail: `${method} → sin respuesta`, error: `No se pudo llamar a ${input.url} (${reason}; ¿servicio caído o CORS?)` };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Runner genérico de los perfiles HTTP y Evento: recorre el grafo desde el punto de entrada por las
 * aristas que prefiere el perfil y pinta cada salto. Las latencias son simuladas por rol, salvo la
 * del paso de entrada de HTTP cuando hay URL (petición real, medida).
 */
export function createGraphRunner(profile: Exclude<TraceProfileId, "rag">): TraceRunner<GraphTraceInput> {
  return {
    profile,
    async run(input: GraphTraceInput, context: TraceRunContext<TraceSseEvent>): Promise<void> {
      const { modules, edges, signal, emit } = context;
      const pause = context.pause ?? ((ms: number) => abortableWait(ms, signal));
      const entry = context.entryNodeId ?? defaultEntry(profile, modules, edges);
      if (!entry) {
        emit({ type: "error", message: "El grafo no tiene módulos que recorrer." });
        emit({ type: "done" });
        return;
      }

      const byId = new Map(modules.map((item) => [item.id, item]));
      const kindOf = new Map(edges.map((edge) => [edge.id, edge.kind]));
      const hops = walkGraph(profile, entry, edges);
      const real = profile === "http" && typeof input.url === "string" && input.url.trim().length > 0;
      let total = 0;
      let errors = 0;
      let output: unknown = input.payload;

      for (const hop of hops) {
        const node = byId.get(hop.nodeId);
        emit({ type: "stage_start", stage: hop.nodeId, nodeId: hop.nodeId, label: node?.label ?? hop.nodeId });
        let latencyMs = simulatedLatency(node?.role, hop.nodeId);
        let detail = hop.edgeId ? `vía ${kindOf.get(hop.edgeId) ?? "arista"} desde ${byId.get(hop.from ?? "")?.label ?? hop.from}` : profile === "event" ? "evento inyectado" : "petición recibida";
        let error: string | undefined;
        if (real && hop.from === null) {
          const outcome = await callEndpoint({ ...input, url: input.url?.trim() }, signal);
          latencyMs = outcome.latencyMs;
          detail = outcome.detail;
          error = outcome.error;
          if (outcome.output !== undefined) output = outcome.output;
        }
        await pause(Math.min(MAX_VISIBLE_MS, Math.max(MIN_VISIBLE_MS, latencyMs)));
        total += latencyMs;
        if (error) errors += 1;
        emit({ type: "stage_done", stage: hop.nodeId, nodeId: hop.nodeId, latencyMs, detail, ...(error ? { error } : {}) });
      }

      const result: TraceGenericResult = {
        type: "result",
        profile,
        summary:
          profile === "event"
            ? `El evento alcanzó ${hops.length} ${hops.length === 1 ? "nodo" : "nodos"} desde ${byId.get(entry)?.label ?? entry}.`
            : `La petición recorrió ${hops.length} ${hops.length === 1 ? "nodo" : "nodos"} desde ${byId.get(entry)?.label ?? entry}.`,
        output,
        totalLatencyMs: total,
        hops: hops.length,
        errors,
        simulated: !real,
      };
      emit(result);
      emit({ type: "done" });
    },
  };
}

export const httpRunner = createGraphRunner("http");
export const eventRunner = createGraphRunner("event");
