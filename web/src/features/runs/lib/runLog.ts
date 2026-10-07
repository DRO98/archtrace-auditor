import type { RetrievedChunk, TokenUsage } from "@core/playground";
import type { TraceProfileId, TraceStageId } from "@core/trace";
import { isTraceProfileId } from "@/lib/trace/profiles";

/**
 * Registro de ejecuciones de "Probar / Simular" (tracing log), de cualquier perfil: RAG, HTTP, evento.
 * Funciones puras: el store las usa para persistir en `localStorage` y las tarjetas de Pipelines para
 * agregar latencia y coste reales. La calidad RAG (fragmentos + métricas) es una extensión opcional.
 *
 * Versiones: v1 (solo RAG) se lee como v2 con `profile: "rag"`. La clave de almacenamiento no cambia
 * para no perder el historial.
 */

export const RUN_LOG_STORAGE_KEY = "tc:runs:v1";
/** Tope global: las más antiguas se descartan primero. */
export const MAX_RUNS = 300;
/** Recorte del texto de cada fragmento guardado (el log no debe crecer con documentos enteros). */
const CHUNK_TEXT_LIMIT = 600;
const ANSWER_LIMIT = 8_000;
/** Similitud a partir de la cual un fragmento cuenta como relevante para `precisionAtK`. */
export const RELEVANCE_THRESHOLD = 0.3;

/**
 * Métricas de calidad del RAG calculadas sin LLM juez (heurísticas deterministas, en [0, 1]):
 * - `topScore` / `meanScore`: similitud del mejor fragmento y media de los recuperados (relevancia del contexto).
 * - `precisionAtK`: fracción de fragmentos con similitud ≥ RELEVANCE_THRESHOLD.
 * - `citationCoverage`: fracción de fragmentos que la respuesta cita como `[n]`.
 * - `groundedness`: fracción de palabras con contenido de la respuesta que aparecen en el contexto.
 * `null` cuando no hay datos (sin fragmentos o respuesta vacía).
 */
export interface RagQualityMetrics {
  topScore: number | null;
  meanScore: number | null;
  precisionAtK: number | null;
  citationCoverage: number | null;
  groundedness: number | null;
}

export interface RunStageRecord {
  stage: TraceStageId;
  label: string;
  nodeId: string | null;
  latencyMs: number;
  upstream: boolean;
  /** Mensaje si la etapa falló. */
  error?: string;
}

export interface RunRecord {
  version: 2;
  id: string;
  profile: TraceProfileId;
  /** Nombre del grafo (pipeline) en el que se lanzó la consulta. */
  graphName: string;
  finishedAt: string;
  /** Lo que se inyectó: la pregunta (RAG) o el payload resumido (HTTP, evento). */
  question: string;
  /** Lo que salió: la respuesta del LLM o la salida del último nodo / del endpoint. */
  answer: string;
  provider: string;
  model: string;
  /** true si fue una reproducción de demo (sin red ni coste real). */
  demo: boolean;
  entryLabel: string | null;
  totalLatencyMs: number;
  stages: RunStageRecord[];
  /** Latencia sumada por nodo (id → ms) de esta ejecución. */
  latencyByNode: Record<string, number>;
  /** Fracción de etapas con error, en [0, 1]. */
  errorRate: number;
  /** Tokens (RAG); todo a 0 en perfiles sin IA. */
  usage: TokenUsage;
  costUsd: number | null;
  /** Extensión RAG: fragmentos recuperados (vacío en otros perfiles). */
  chunks: RetrievedChunk[];
  /** Extensión RAG: calidad del contexto y la respuesta; null en otros perfiles. */
  metrics: RagQualityMetrics | null;
}

export interface RunInput {
  /** Por defecto "rag". */
  profile?: TraceProfileId;
  graphName: string;
  finishedAt: string;
  question: string;
  answer: string;
  provider: string;
  model: string;
  demo: boolean;
  entryLabel: string | null;
  stages: readonly {
    stage: TraceStageId;
    label: string;
    nodeId: string | null;
    latencyMs?: number;
    upstream?: boolean;
    status?: "active" | "done" | "error";
    detail?: string;
  }[];
  usage?: TokenUsage;
  costUsd: number | null;
  chunks?: readonly RetrievedChunk[];
}

const NO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

const STOPWORDS = new Set(
  (
    "el la los las un una unos unas de del al a en y o u que se es por para con sin su sus lo le les como más mas pero " +
    "este esta estos estas ese esa eso esto ya no si sí muy también entre sobre cuando donde qué cómo cual cuál the a an of " +
    "to in and or is are be it this that for with on as by at from not can will"
  ).split(/\s+/),
);

function words(text: string): string[] {
  return (text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
    (word) => !STOPWORDS.has(word),
  );
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export function computeQualityMetrics(answer: string, chunks: readonly RetrievedChunk[]): RagQualityMetrics {
  if (chunks.length === 0) {
    return { topScore: null, meanScore: null, precisionAtK: null, citationCoverage: null, groundedness: null };
  }
  const scores = chunks.map((chunk) => clamp01(chunk.score));
  const cited = new Set<number>();
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= chunks.length) cited.add(n);
  }
  const context = new Set(chunks.flatMap((chunk) => words(chunk.text)));
  const answerWords = words(answer);
  const grounded = answerWords.filter((word) => context.has(word)).length;
  return {
    topScore: round3(Math.max(...scores)),
    meanScore: round3(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    precisionAtK: round3(scores.filter((score) => score >= RELEVANCE_THRESHOLD).length / scores.length),
    citationCoverage: round3(cited.size / chunks.length),
    groundedness: answerWords.length === 0 ? null : round3(grounded / answerWords.length),
  };
}

function nodeLatencies(stages: readonly RunStageRecord[]): Record<string, number> {
  const byNode: Record<string, number> = {};
  for (const stage of stages) {
    if (stage.nodeId) byNode[stage.nodeId] = (byNode[stage.nodeId] ?? 0) + stage.latencyMs;
  }
  return byNode;
}

function errorRateOf(stages: readonly RunStageRecord[]): number {
  return stages.length === 0 ? 0 : round3(stages.filter((stage) => stage.error !== undefined).length / stages.length);
}

export function buildRunRecord(input: RunInput, id: string = randomId()): RunRecord {
  const profile = input.profile ?? "rag";
  const stages = input.stages.map((stage): RunStageRecord => {
    const record: RunStageRecord = {
      stage: stage.stage,
      label: stage.label,
      nodeId: stage.nodeId,
      latencyMs: Math.max(0, stage.latencyMs ?? 0),
      upstream: stage.upstream === true,
    };
    if (stage.status === "error") record.error = stage.detail ?? "error";
    return record;
  });
  const chunks = input.chunks ?? [];
  return {
    version: 2,
    id,
    profile,
    graphName: input.graphName,
    finishedAt: input.finishedAt,
    question: input.question,
    answer: input.answer.slice(0, ANSWER_LIMIT),
    provider: input.provider,
    model: input.model,
    demo: input.demo,
    entryLabel: input.entryLabel,
    totalLatencyMs: stages.reduce((sum, stage) => sum + stage.latencyMs, 0),
    stages,
    latencyByNode: nodeLatencies(stages),
    errorRate: errorRateOf(stages),
    usage: { ...(input.usage ?? NO_USAGE) },
    costUsd: input.costUsd,
    chunks: chunks.map((chunk) => ({ id: chunk.id, score: chunk.score, text: chunk.text.slice(0, CHUNK_TEXT_LIMIT) })),
    metrics: profile === "rag" ? computeQualityMetrics(input.answer, chunks) : null,
  };
}

export interface RunAggregate {
  count: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  /** Media de las ejecuciones con coste conocido; null si ninguna lo tiene. */
  avgCostUsd: number | null;
  totalCostUsd: number | null;
  totalTokens: number;
  /** Media de `meanScore` (relevancia del contexto). */
  avgRelevance: number | null;
  avgGroundedness: number | null;
  /** Media de `errorRate`; null si no hay ejecuciones. */
  avgErrorRate: number | null;
  lastRunAt: string | null;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

export function aggregateRuns(runs: readonly RunRecord[]): RunAggregate {
  const costs = runs.map((run) => run.costUsd).filter((cost): cost is number => cost !== null);
  const latencies = runs.map((run) => run.totalLatencyMs);
  const pick = (key: keyof RagQualityMetrics) =>
    runs.map((run) => run.metrics?.[key] ?? null).filter((value): value is number => value !== null);
  return {
    count: runs.length,
    avgLatencyMs: mean(latencies),
    p95LatencyMs: percentile(latencies, 95),
    avgCostUsd: mean(costs),
    totalCostUsd: costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0),
    totalTokens: runs.reduce((sum, run) => sum + run.usage.totalTokens, 0),
    avgRelevance: mean(pick("meanScore")),
    avgGroundedness: mean(pick("groundedness")),
    avgErrorRate: mean(runs.map((run) => run.errorRate)),
    lastRunAt: runs.reduce<string | null>((latest, run) => (latest === null || run.finishedAt > latest ? run.finishedAt : latest), null),
  };
}

/** Ejecuciones de un perfil y/o que pasaron por un nodo (filtros del Tracing Log). */
export function filterRuns(runs: readonly RunRecord[], filter: { profile?: TraceProfileId | null; nodeId?: string | null }): RunRecord[] {
  return runs.filter(
    (run) =>
      (!filter.profile || run.profile === filter.profile) &&
      (!filter.nodeId || run.stages.some((stage) => stage.nodeId === filter.nodeId)),
  );
}

/** Latencia media por nodo (id → ms) de las ejecuciones dadas. */
export function latencyByNode(runs: readonly RunRecord[]): Map<string, { label: string; avgMs: number; samples: number }> {
  const totals = new Map<string, { label: string; total: number; samples: number }>();
  for (const run of runs) {
    for (const stage of run.stages) {
      const key = stage.nodeId ?? `stage:${stage.stage}`;
      const entry = totals.get(key) ?? { label: stage.label, total: 0, samples: 0 };
      entry.total += stage.latencyMs;
      entry.samples += 1;
      totals.set(key, entry);
    }
  }
  return new Map([...totals].map(([key, entry]) => [key, { label: entry.label, avgMs: entry.total / entry.samples, samples: entry.samples }]));
}

/** Añade `run` al principio (más reciente primero), sin duplicar ids y respetando MAX_RUNS. */
export function appendRun(runs: readonly RunRecord[], run: RunRecord, max = MAX_RUNS): RunRecord[] {
  return [run, ...runs.filter((item) => item.id !== run.id)].slice(0, max);
}

// ---------------------------------------------------------------------------------------------
// Validación de lo leído de localStorage: un dato corrupto se descarta, nunca rompe la interfaz.

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isStr = (value: unknown): value is string => typeof value === "string";
const numOrNull = (value: unknown): number | null => (isNum(value) ? value : null);

function parseRun(value: unknown): RunRecord | null {
  if (!isRec(value) || (value.version !== 1 && value.version !== 2)) return null;
  if (!isStr(value.id) || !isStr(value.graphName) || !isStr(value.finishedAt) || !isStr(value.question)) return null;
  if (!isStr(value.answer) || !isStr(value.provider) || !isStr(value.model) || !isNum(value.totalLatencyMs)) return null;
  const usage = isRec(value.usage) ? value.usage : null;
  if (!usage || !isNum(usage.promptTokens) || !isNum(usage.completionTokens) || !isNum(usage.totalTokens)) return null;
  const stages = Array.isArray(value.stages) ? value.stages.filter(isRec) : [];
  const chunks = Array.isArray(value.chunks) ? value.chunks.filter(isRec) : [];
  const profile: TraceProfileId = value.version === 1 ? "rag" : isTraceProfileId(value.profile) ? value.profile : "rag";
  const metrics = isRec(value.metrics) ? value.metrics : null;
  const parsedStages = stages
    .filter((stage) => isStr(stage.stage) && isNum(stage.latencyMs))
    .map((stage) => {
      const record: RunStageRecord = {
        stage: stage.stage as string,
        label: isStr(stage.label) ? stage.label : String(stage.stage),
        nodeId: isStr(stage.nodeId) ? stage.nodeId : null,
        latencyMs: stage.latencyMs as number,
        upstream: stage.upstream === true,
      };
      if (isStr(stage.error)) record.error = stage.error;
      return record;
    });
  return {
    version: 2,
    id: value.id,
    profile,
    graphName: value.graphName,
    finishedAt: value.finishedAt,
    question: value.question,
    answer: value.answer,
    provider: value.provider,
    model: value.model,
    demo: value.demo === true,
    entryLabel: isStr(value.entryLabel) ? value.entryLabel : null,
    totalLatencyMs: value.totalLatencyMs,
    stages: parsedStages,
    latencyByNode: nodeLatencies(parsedStages),
    errorRate: isNum(value.errorRate) ? value.errorRate : errorRateOf(parsedStages),
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      ...(usage.estimated === true ? { estimated: true } : {}),
    },
    costUsd: numOrNull(value.costUsd),
    chunks: chunks
      .filter((chunk) => isStr(chunk.id) && isStr(chunk.text) && isNum(chunk.score))
      .map((chunk) => ({ id: chunk.id as string, text: chunk.text as string, score: chunk.score as number })),
    metrics:
      profile === "rag"
        ? {
            topScore: numOrNull(metrics?.topScore),
            meanScore: numOrNull(metrics?.meanScore),
            precisionAtK: numOrNull(metrics?.precisionAtK),
            citationCoverage: numOrNull(metrics?.citationCoverage),
            groundedness: numOrNull(metrics?.groundedness),
          }
        : null,
  };
}

export function parseRuns(raw: string | null): RunRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseRun).filter((run): run is RunRecord => run !== null).slice(0, MAX_RUNS);
  } catch {
    return [];
  }
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------------------------
// Formato compartido por tarjetas, modal y chat.

export function formatRunLatency(ms: number | null): string {
  if (ms === null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function formatRunCost(usd: number | null): string {
  if (usd === null) return "—";
  if (usd === 0) return "$0.00";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function formatRatio(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}
