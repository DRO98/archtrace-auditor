import type { CodeGraph } from "@core/graph";
import type { ExecutionFlowScenario, FlowStep } from "@core/simulation";
import { SUBSYSTEM_NODE_PREFIX } from "@/features/canvas/lib/flow";
import { SYSTEM_LAYER, systemLayers, type Level0Block, type Level0Graph } from "@/features/canvas/lib/level0";

/**
 * «Simular flujo» sobre el mapa de sistema: escenarios cuyos pasos son nodos de Level 0 (no archivos).
 * Payloads JSON ilustrativos que evolucionan a lo largo del recorrido; narración concreta por servicio.
 */

export const SYSTEM_SCENARIO_ID = "system-flow";
export const SYSTEM_QUERY_SCENARIO_ID = "system-query";
export const SYSTEM_BATCH_SCENARIO_ID = "system-batch";
/** Separa el nombre del nodo de su papel en el título del paso («Redpanda — cola de eventos»). */
export const STEP_TITLE_SEPARATOR = " — ";
const MAX_STEPS = 10;
const STEP_MS = 2800;

type Lang = "es" | "en";
type Stage = "entry" | "ingest" | "queue" | "stream" | "batch" | "store" | "api" | "consumer" | "llm" | "observability" | "vector";

interface StageMeta {
  role: Record<Lang, string>;
}

const STAGE_ROLE: Readonly<Record<Stage, StageMeta>> = {
  entry: { role: { es: "origen de los datos", en: "data source" } },
  ingest: { role: { es: "API de captura", en: "ingestion API" } },
  queue: { role: { es: "cola de eventos", en: "event queue" } },
  stream: { role: { es: "procesado en streaming", en: "stream processing" } },
  batch: { role: { es: "orquestación por lotes", en: "batch orchestration" } },
  store: { role: { es: "almacenamiento operativo", en: "operational store" } },
  vector: { role: { es: "índice vectorial", en: "vector index" } },
  api: { role: { es: "API de consulta", en: "query API" } },
  consumer: { role: { es: "asistente / chatbot", en: "assistant / chatbot" } },
  llm: { role: { es: "modelo de lenguaje", en: "language model" } },
  observability: { role: { es: "observabilidad", en: "observability" } },
};

function stageOf(block: Level0Block, layer: number): Stage {
  const label = block.label.toLowerCase();
  if (/qdrant|chroma|pinecone|milvus|weaviate|vector/.test(label) || block.role === "database" && /vector|embed/.test(label)) {
    return "vector";
  }
  const byLayer: Partial<Record<number, Stage>> = {
    [SYSTEM_LAYER.entry]: "entry",
    [SYSTEM_LAYER.ingest]: "ingest",
    [SYSTEM_LAYER.queue]: "queue",
    [SYSTEM_LAYER.store]: "store",
    [SYSTEM_LAYER.api]: "api",
    [SYSTEM_LAYER.observability]: "observability",
  };
  if (layer === SYSTEM_LAYER.process) return block.role === "pipeline" ? "batch" : "stream";
  if (layer === SYSTEM_LAYER.consumers) return block.kind === "infra" && block.role === "ai-model" ? "llm" : "consumer";
  if (layer === SYSTEM_LAYER.store && (/qdrant|chroma|pinecone|milvus|weaviate/.test(label) || block.role === "cache")) {
    return /qdrant|chroma|pinecone|milvus|weaviate|vector/.test(label) ? "vector" : "store";
  }
  return byLayer[layer] ?? "consumer";
}

interface Hop {
  edgeId: string;
  to: string;
  weight: number;
}

function outgoing(level0: Level0Graph): Map<string, Hop[]> {
  const layers = systemLayers(level0);
  const layer = (id: string) => layers.get(id) ?? 0;
  const out = new Map<string, Hop[]>();
  for (const edge of level0.edges) {
    const flipped = layer(edge.source) > layer(edge.target);
    const from = flipped ? edge.target : edge.source;
    const to = flipped ? edge.source : edge.target;
    out.set(from, [...(out.get(from) ?? []), { edgeId: edge.id, to, weight: edge.weight }]);
  }
  return out;
}

/**
 * Recorrido principal: desde la entrada hacia la respuesta (LLM), columna a columna.
 */
export function systemPath(level0: Level0Graph): Array<{ block: Level0Block; edgeIdToNext?: string }> {
  const layers = systemLayers(level0);
  const byId = new Map(level0.blocks.map((block) => [block.id, block]));
  const layer = (id: string) => layers.get(id) ?? 0;
  const out = outgoing(level0);
  const feedsIngest = (id: string) => (out.get(id) ?? []).some((hop) => layer(hop.to) === SYSTEM_LAYER.ingest);
  const onlyFeedsIngest = (id: string) => (out.get(id) ?? []).every((hop) => layer(hop.to) === SYSTEM_LAYER.ingest);
  const candidates = level0.blocks
    .filter((block) => (out.get(block.id)?.length ?? 0) > 0)
    .sort(
      (left, right) =>
        layer(left.id) - layer(right.id) ||
        Number(onlyFeedsIngest(right.id) && feedsIngest(right.id)) - Number(onlyFeedsIngest(left.id) && feedsIngest(left.id)) ||
        left.label.localeCompare(right.label),
    );
  const start = candidates[0];
  if (!start) return [];

  const path: Array<{ block: Level0Block; edgeIdToNext?: string }> = [{ block: start }];
  const visited = new Set([start.id]);
  let current = start;
  while (path.length < MAX_STEPS) {
    const here = layer(current.id);
    const options = (out.get(current.id) ?? []).filter((hop) => {
      if (visited.has(hop.to)) return false;
      const there = layer(hop.to);
      if (there > here) return there !== SYSTEM_LAYER.observability || here === SYSTEM_LAYER.observability;
      const target = byId.get(hop.to);
      return there === here && here === SYSTEM_LAYER.consumers && target?.kind === "infra" && target.role === "ai-model";
    });
    const next = options.sort(
      (left, right) => layer(left.to) - layer(right.to) || right.weight - left.weight || (byId.get(left.to)?.label ?? "").localeCompare(byId.get(right.to)?.label ?? ""),
    )[0];
    const block = next ? byId.get(next.to) : undefined;
    if (!next || !block) break;
    path[path.length - 1]!.edgeIdToNext = next.edgeId;
    path.push({ block });
    visited.add(block.id);
    current = block;
  }
  return path;
}

/** Recorrido de consulta: chatbot → API → store (y opcionalmente vector + LLM). */
export function queryPath(level0: Level0Graph): Array<{ block: Level0Block; edgeIdToNext?: string }> {
  const layers = systemLayers(level0);
  const byId = new Map(level0.blocks.map((block) => [block.id, block]));
  const layer = (id: string) => layers.get(id) ?? 0;
  const out = outgoing(level0);
  const consumers = level0.blocks
    .filter((block) => layer(block.id) === SYSTEM_LAYER.consumers && !(block.kind === "infra" && block.role === "ai-model"))
    .sort((left, right) => right.label.length - left.label.length || left.label.localeCompare(right.label));
  const start = consumers.find((block) => /rag|chatbot/i.test(block.label)) ?? consumers[0];
  if (!start) return [];

  const path: Array<{ block: Level0Block; edgeIdToNext?: string }> = [{ block: start }];
  const visited = new Set([start.id]);
  let current = start;
  const prefer = (hop: Hop): number => {
    const target = byId.get(hop.to);
    if (!target) return 0;
    const there = layer(hop.to);
    if (there === SYSTEM_LAYER.api) return 40;
    if (there === SYSTEM_LAYER.store && stageOf(target, there) === "vector") return 35;
    if (there === SYSTEM_LAYER.store) return 30;
    if (target.kind === "infra" && target.role === "ai-model") return 25;
    if (there === SYSTEM_LAYER.consumers && target.kind === "infra" && target.role === "ai-model") return 25;
    return hop.weight;
  };
  while (path.length < 6) {
    const options = (out.get(current.id) ?? [])
      .filter((hop) => !visited.has(hop.to))
      .filter((hop) => {
        const there = layer(hop.to);
        return there === SYSTEM_LAYER.api || there === SYSTEM_LAYER.store || (there === SYSTEM_LAYER.consumers && byId.get(hop.to)?.role === "ai-model");
      });
    // También aristas «hacia atrás» en el grafo dibujado (chatbot → API acceso).
    for (const edge of level0.edges) {
      const other = edge.source === current.id ? edge.target : edge.target === current.id ? edge.source : null;
      if (!other || visited.has(other)) continue;
      const there = layer(other);
      if (there !== SYSTEM_LAYER.api && there !== SYSTEM_LAYER.store && !(byId.get(other)?.role === "ai-model")) continue;
      if ((out.get(current.id) ?? []).some((hop) => hop.to === other)) continue;
      options.push({ edgeId: edge.id, to: other, weight: 1 });
    }
    const next = options.sort((left, right) => prefer(right) - prefer(left) || (byId.get(left.to)?.label ?? "").localeCompare(byId.get(right.to)?.label ?? ""))[0];
    const block = next ? byId.get(next.to) : undefined;
    if (!next || !block) break;
    path[path.length - 1]!.edgeIdToNext = next.edgeId;
    path.push({ block });
    visited.add(block.id);
    current = block;
    if (block.role === "ai-model" || stageOf(block, layer(block.id)) === "llm") break;
  }
  return path.length >= 3 ? path : [];
}

/** Recorrido por lotes: Airflow/orquestador → Spark → stores. */
export function batchPath(level0: Level0Graph): Array<{ block: Level0Block; edgeIdToNext?: string }> {
  const layers = systemLayers(level0);
  const byId = new Map(level0.blocks.map((block) => [block.id, block]));
  const layer = (id: string) => layers.get(id) ?? 0;
  const out = outgoing(level0);
  const start =
    level0.blocks.find((block) => block.role === "pipeline" || /airflow|dag|batch/i.test(block.label)) ??
    level0.blocks.find((block) => layer(block.id) === SYSTEM_LAYER.process && block.role === "pipeline");
  if (!start) return [];
  const path: Array<{ block: Level0Block; edgeIdToNext?: string }> = [{ block: start }];
  const visited = new Set([start.id]);
  let current = start;
  while (path.length < 5) {
    const options = (out.get(current.id) ?? []).filter((hop) => {
      if (visited.has(hop.to)) return false;
      const there = layer(hop.to);
      return there === SYSTEM_LAYER.process || there === SYSTEM_LAYER.store || there === SYSTEM_LAYER.queue;
    });
    for (const edge of level0.edges) {
      const other = edge.source === current.id ? edge.target : edge.target === current.id ? edge.source : null;
      if (!other || visited.has(other)) continue;
      const there = layer(other);
      if (there !== SYSTEM_LAYER.process && there !== SYSTEM_LAYER.store) continue;
      if ((out.get(current.id) ?? []).some((hop) => hop.to === other)) continue;
      options.push({ edgeId: edge.id, to: other, weight: 1 });
    }
    const next = options.sort(
      (left, right) => layer(left.to) - layer(right.to) || right.weight - left.weight || (byId.get(left.to)?.label ?? "").localeCompare(byId.get(right.to)?.label ?? ""),
    )[0];
    const block = next ? byId.get(next.to) : undefined;
    if (!next || !block) break;
    path[path.length - 1]!.edgeIdToNext = next.edgeId;
    path.push({ block });
    visited.add(block.id);
    current = block;
  }
  return path.length >= 3 ? path : [];
}

type Payload = Record<string, unknown> | string;

interface StepContent {
  description: string;
  input: Payload;
  output: Payload;
}

/** Historia coherente del dato a lo largo del recorrido (dominio gestos / flota / genérico). */
function narratePath(
  path: Array<{ block: Level0Block }>,
  layers: Map<string, number>,
  lang: Lang,
  kind: "ingest" | "query" | "batch",
): StepContent[] {
  const labels = path.map(({ block }) => block.label.toLowerCase()).join(" ");
  const gestures = /gesto|simulador|mediapipe|reconoc/.test(labels);
  const question =
    lang === "es"
      ? gestures
        ? "¿Cuántos gestos de freno brusco hubo ayer en la línea 7?"
        : "¿Cuál fue el consumo medio de la flota ayer?"
      : gestures
        ? "How many hard-brake gestures happened yesterday on line 7?"
        : "What was the fleet's average consumption yesterday?";

  const event =
    lang === "es"
      ? gestures
        ? { event_id: "evt_8f2a", tipo: "gesto", gesto: "freno_brusco", linea: "7", vehiculo: "BUS-104", ts: "2026-03-26T08:14:22Z", confianza: 0.91 }
        : { event_id: "evt_8f2a", tipo: "telemetria", vehiculo: "BUS-104", km: 12.4, combustible_l: 3.1, ts: "2026-03-26T08:14:22Z" }
      : gestures
        ? { event_id: "evt_8f2a", type: "gesture", gesture: "hard_brake", line: "7", vehicle: "BUS-104", ts: "2026-03-26T08:14:22Z", confidence: 0.91 }
        : { event_id: "evt_8f2a", type: "telemetry", vehicle: "BUS-104", km: 12.4, fuel_l: 3.1, ts: "2026-03-26T08:14:22Z" };

  const topic = gestures ? "captura.gestos" : "captura.telemetria";
  const doc =
    lang === "es"
      ? gestures
        ? { _id: "agg_linea7_2026-03-26", linea: "7", gestos_freno: 128, ventana: "1d" }
        : { _id: "agg_flota_2026-03-26", flota: "norte", consumo_medio_l_100km: 28.4, ventana: "1d" }
      : gestures
        ? { _id: "agg_line7_2026-03-26", line: "7", hard_brakes: 128, window: "1d" }
        : { _id: "agg_fleet_2026-03-26", fleet: "north", avg_l_100km: 28.4, window: "1d" };

  const answer =
    lang === "es"
      ? gestures
        ? "Ayer en la línea 7 se registraron 128 gestos de freno brusco (confianza media 0.89)."
        : "El consumo medio de la flota ayer fue 28,4 L/100 km."
      : gestures
        ? "Yesterday line 7 recorded 128 hard-brake gestures (mean confidence 0.89)."
        : "Fleet average consumption yesterday was 28.4 L/100 km.";

  return path.map(({ block }, index) => {
    const stage = stageOf(block, layers.get(block.id) ?? 0);
    const next = path[index + 1]?.block.label;
    const prev = path[index - 1]?.block.label;
    return stepContent({ stage, block, next, prev, lang, kind, event, topic, doc, question, answer });
  });
}

function stepContent(args: {
  stage: Stage;
  block: Level0Block;
  next?: string;
  prev?: string;
  lang: Lang;
  kind: "ingest" | "query" | "batch";
  event: Record<string, unknown>;
  topic: string;
  doc: Record<string, unknown>;
  question: string;
  answer: string;
}): StepContent {
  const { stage, block, next, prev, lang, kind, event, topic, doc, question, answer } = args;
  const es = lang === "es";
  const to = next ?? (es ? "el siguiente servicio" : "the next service");

  if (kind === "query") {
    switch (stage) {
      case "consumer":
        return {
          description: es
            ? `${block.label} recibe la pregunta del operador, decide qué APIs e índices consultar y prepara el contexto para el modelo.`
            : `${block.label} takes the operator's question, decides which APIs/indexes to query, and prepares context for the model.`,
          input: { pregunta: question, usuario: "operador_linea", canal: "chat" },
          output: {
            plan: es ? ["consultar API acceso", "recuperar fragmentos en Qdrant", "llamar al LLM"] : ["query read API", "retrieve chunks", "call LLM"],
            consulta: es ? { linea: "7", metrica: "gestos_freno", desde: "ayer" } : { line: "7", metric: "hard_brakes", since: "yesterday" },
          },
        };
      case "api":
        return {
          description: es
            ? `${block.label} aplica permisos y privacidad, lee el almacén operativo y devuelve solo los campos que el chatbot puede ver.`
            : `${block.label} enforces permissions/privacy, reads the operational store, and returns only fields the chatbot may see.`,
          input: { method: "GET", path: "/metricas", query: { linea: "7", metrica: "gestos_freno", desde: "2026-03-26" } },
          output: { status: 200, body: doc },
        };
      case "store":
        return {
          description: es
            ? `${block.label} guarda el agregado ya calculado. Aquí ${prev ?? "la API"} obtiene el número sin recorrer el histórico crudo.`
            : `${block.label} holds the pre-computed aggregate. ${prev ?? "The API"} reads the number without scanning raw history.`,
          input: { find: { _id: doc._id } },
          output: doc,
        };
      case "vector":
        return {
          description: es
            ? `${block.label} busca fragmentos semánticamente cercanos a la pregunta (manuales, políticas) para anclar la respuesta.`
            : `${block.label} finds chunks semantically close to the question (manuals, policies) to ground the answer.`,
          input: { query: question, top_k: 3 },
          output: {
            hits: [
              { score: 0.84, texto: es ? "Umbral freno brusco: deceleración > 0.35 g durante ≥ 0.4 s." : "Hard-brake threshold: deceleration > 0.35 g for ≥ 0.4 s." },
              { score: 0.79, texto: es ? "Los gestos se agregan por línea y día en el job de Spark." : "Gestures are aggregated per line and day in the Spark job." },
            ],
          },
        };
      case "llm":
        return {
          description: es
            ? `${block.label} recibe el prompt (pregunta + datos de la API + fragmentos) y redacta la respuesta en lenguaje natural.`
            : `${block.label} receives the prompt (question + API data + chunks) and writes the natural-language answer.`,
          input: {
            model: "llama3.1",
            messages: [
              { role: "system", content: es ? "Eres un analista de flota. Responde solo con los datos dados." : "You are a fleet analyst. Answer only from the given data." },
              { role: "user", content: es ? `${question}\n\nDatos:\n${JSON.stringify(doc, null, 2)}` : `${question}\n\nData:\n${JSON.stringify(doc, null, 2)}` },
            ],
          },
          output: { text: answer, tokens: { prompt: 420, completion: 48 } },
        };
      default:
        break;
    }
  }

  switch (stage) {
    case "entry":
      return {
        description: es
          ? `${block.label} produce el evento de origen (sensor, gesto o telemetría) y lo empuja hacia ${to} como JSON.`
          : `${block.label} produces the source event (sensor, gesture or telemetry) and pushes it to ${to} as JSON.`,
        input: es ? { origen: "cámara / dispositivo", muestra: "frame_t" } : { source: "camera / device", sample: "frame_t" },
        output: event,
      };
    case "ingest":
      return {
        description: es
          ? `${block.label} valida el esquema del evento, asigna un id y lo publica en ${to}. Quien envía no espera al procesado.`
          : `${block.label} validates the event schema, assigns an id and publishes it to ${to}. The sender does not wait for processing.`,
        input: event,
        output: { accepted: true, topic, offset: 184422, key: event.event_id },
      };
    case "queue":
      return {
        description: es
          ? `${block.label} retiene los mensajes en orden. Desacopla la captura del procesado y absorbe picos; ${to} consume a su ritmo.`
          : `${block.label} keeps messages in order. It decouples capture from processing and absorbs spikes; ${to} consumes at its own pace.`,
        input: { topic, messages: [event] },
        output: { topic, partition: 0, offset: 184422, payload: event },
      };
    case "stream":
      return {
        description: es
          ? `${block.label} lee la cola, limpia y agrega (ventanas por línea/vehículo) y escribe el resultado en ${to}.`
          : `${block.label} reads the queue, cleans and aggregates (windows per line/vehicle) and writes the result to ${to}.`,
        input: { topic, batch: [event, { ...event, event_id: "evt_8f2b" }] },
        output: { write: "upsert", collection: es ? "metricas_diarias" : "daily_metrics", document: doc },
      };
    case "batch":
      return {
        description: es
          ? `${block.label} programa la carga histórica y lanza el job de procesado; el resultado acaba en ${to}.`
          : `${block.label} schedules the historical load and launches the processing job; the result lands in ${to}.`,
        input: { dag: "ingest_historico", run_id: "manual__2026-03-26T02:00:00", params: { fecha: "2026-03-25" } },
        output: { job: "spark_agregar_metricas", status: "submitted", target: to },
      };
    case "store":
      return {
        description: es
          ? `${block.label} persiste el agregado. ${to} consultará estos documentos sin tocar el histórico crudo.`
          : `${block.label} persists the aggregate. ${to} will query these documents without touching raw history.`,
        input: { upsert: doc },
        output: { ok: 1, _id: doc._id },
      };
    case "vector":
      return {
        description: es
          ? `${block.label} indexa embeddings de documentos/eventos para búsquedas semánticas posteriores (RAG).`
          : `${block.label} indexes embeddings of documents/events for later semantic search (RAG).`,
        input: { upsert: [{ id: String(doc._id), vector: "[…1536 dims]", payload: doc }] },
        output: { indexed: 1, collection: "docs_flota" },
      };
    case "api":
      return {
        description: es
          ? `${block.label} es la puerta de lectura: permisos, filtros y forma de respuesta. Entrega datos limpios a ${to} sin exponer la base.`
          : `${block.label} is the read gateway: permissions, filters and response shape. It gives clean data to ${to} without exposing the DB.`,
        input: { method: "GET", path: "/metricas", query: { linea: "7" } },
        output: { status: 200, body: doc },
      };
    case "consumer":
      return {
        description: es
          ? `${block.label} pide datos a la API${next ? ` y apoya la redacción en ${next}` : ""}. Construye la respuesta que ve el operador.`
          : `${block.label} asks the API for data${next ? ` and leans on ${next} to draft text` : ""}. It builds the answer the operator sees.`,
        input: { pregunta: question },
        output: {
          contexto: doc,
          prompt_para_llm: es ? `Pregunta: ${question}\nDatos: ${JSON.stringify(doc)}` : `Question: ${question}\nData: ${JSON.stringify(doc)}`,
        },
      };
    case "llm":
      return {
        description: es
          ? `${block.label} genera el texto final a partir del prompt (pregunta + datos + contexto). No conoce el resto del sistema: solo lo que le pasan.`
          : `${block.label} generates the final text from the prompt (question + data + context). It does not know the rest of the system—only what it is given.`,
        input: {
          model: "llama3.1",
          prompt: es ? `Pregunta: ${question}\nDatos: ${JSON.stringify(doc)}` : `Question: ${question}\nData: ${JSON.stringify(doc)}`,
        },
        output: { text: answer, finish_reason: "stop" },
      };
    case "observability":
      return {
        description: es
          ? `${block.label} recoge métricas y trazas de los servicios para vigilar latencia y errores del recorrido.`
          : `${block.label} collects metrics and traces from services to watch latency and errors along the journey.`,
        input: { scrape: ["api_captura", "spark", "api_acceso"] },
        output: { panels: ["latencia_p95", "errores_5xx"], alert: null },
      };
  }
}

function buildScenario(
  id: string,
  name: Record<Lang, string>,
  description: Record<Lang, string>,
  path: Array<{ block: Level0Block; edgeIdToNext?: string }>,
  level0: Level0Graph,
  graph: Pick<CodeGraph, "modules">,
  lang: Lang,
  kind: "ingest" | "query" | "batch",
): ExecutionFlowScenario | null {
  if (path.length < 3) return null;
  const layers = systemLayers(level0);
  const story = narratePath(path, layers, lang, kind);
  const modules = new Map(graph.modules.map((item) => [item.id, item]));
  const steps: FlowStep[] = path.map(({ block, edgeIdToNext }, index) => {
    const stage = stageOf(block, layers.get(block.id) ?? 0);
    const content = story[index]!;
    const owner = modules.get(block.primaryModuleId ?? block.moduleIds[0] ?? "");
    const anchor = owner?.subBlocks[0];
    const step: FlowStep = {
      stepIndex: index,
      nodeId: `${SUBSYSTEM_NODE_PREFIX}${block.id}`,
      title: `${block.label}${STEP_TITLE_SEPARATOR}${STAGE_ROLE[stage].role[lang]}`,
      description: content.description,
      fileReference: {
        path: owner?.filePath ?? block.label,
        lineStart: anchor?.range.startLine ?? 1,
        lineEnd: anchor?.range.endLine ?? 1,
        functionName: anchor?.name ?? block.label,
      },
      mockPayload: { input: content.input, output: content.output },
      durationMs: STEP_MS,
    };
    if (edgeIdToNext) step.edgeIdToNext = edgeIdToNext;
    return step;
  });
  const names = path.map(({ block }) => block.label).join(" → ");
  return {
    id,
    name: name[lang],
    description: `${description[lang]} ${names}.`,
    entryNodeId: steps[0]!.nodeId,
    steps,
  };
}

/** Escenario «Recorrido del dato» (compat). Preferir `buildSystemScenarios`. */
export function buildSystemScenario(level0: Level0Graph, graph: Pick<CodeGraph, "modules">, lang: Lang = "es"): ExecutionFlowScenario | null {
  return buildSystemScenarios(level0, graph, lang)[0] ?? null;
}

/**
 * Varios recorridos listos sobre el esqueleto: captura→respuesta, pregunta→datos→LLM, y lote histórico si hay orquestador.
 */
export function buildSystemScenarios(level0: Level0Graph, graph: Pick<CodeGraph, "modules">, lang: Lang = "es"): ExecutionFlowScenario[] {
  if (level0.style !== "system") return [];
  const out: ExecutionFlowScenario[] = [];
  const ingest = buildScenario(
    SYSTEM_SCENARIO_ID,
    { es: "Recorrido del dato", en: "Data journey" },
    {
      es: "De la captura a la respuesta del asistente:",
      en: "From capture to the assistant's answer:",
    },
    systemPath(level0),
    level0,
    graph,
    lang,
    "ingest",
  );
  if (ingest) out.push(ingest);

  const query = buildScenario(
    SYSTEM_QUERY_SCENARIO_ID,
    { es: "Pregunta al asistente", en: "Ask the assistant" },
    {
      es: "El operador pregunta; el chatbot consulta APIs/índices y el LLM responde:",
      en: "The operator asks; the chatbot queries APIs/indexes and the LLM answers:",
    },
    queryPath(level0),
    level0,
    graph,
    lang,
    "query",
  );
  if (query && query.steps.map((step) => step.nodeId).join() !== ingest?.steps.map((step) => step.nodeId).join()) out.push(query);

  const batch = buildScenario(
    SYSTEM_BATCH_SCENARIO_ID,
    { es: "Carga histórica (lotes)", en: "Historical batch load" },
    {
      es: "El orquestador lanza el procesado por lotes hasta el almacén:",
      en: "The orchestrator runs batch processing into the store:",
    },
    batchPath(level0),
    level0,
    graph,
    lang,
    "batch",
  );
  if (batch) out.push(batch);

  return out;
}

/** Construye un escenario a partir de una lista ordenada de ids de bloque Level 0 (p. ej. generada por la IA). */
export function scenarioFromBlockIds(
  level0: Level0Graph,
  graph: Pick<CodeGraph, "modules">,
  blockIds: readonly string[],
  meta: { id: string; name: string; description: string },
  lang: Lang = "es",
): ExecutionFlowScenario | null {
  const byId = new Map(level0.blocks.map((block) => [block.id, block]));
  const edgeBetween = (from: string, to: string): string | undefined => {
    const hit = level0.edges.find(
      (edge) => (edge.source === from && edge.target === to) || (edge.source === to && edge.target === from),
    );
    return hit?.id;
  };
  const path: Array<{ block: Level0Block; edgeIdToNext?: string }> = [];
  for (let index = 0; index < blockIds.length; index += 1) {
    const block = byId.get(blockIds[index]!);
    if (!block) continue;
    const nextId = blockIds[index + 1];
    path.push({ block, edgeIdToNext: nextId ? edgeBetween(block.id, nextId) : undefined });
  }
  if (path.length < 2) return null;
  const built = buildScenario(meta.id, { es: meta.name, en: meta.name }, { es: meta.description, en: meta.description }, path, level0, graph, lang, "query");
  if (!built) return null;
  return { ...built, name: meta.name, description: meta.description };
}
