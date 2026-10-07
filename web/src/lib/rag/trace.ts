import type { PlaygroundCostLine, PlaygroundModuleRef, PlaygroundSseEvent, PlaygroundStageId, TokenUsage } from "@core/playground";
import type { AiProviderId } from "../ai/catalog";
import { approximateTokens, costFor, resolvePrice, type ResolvedPrice } from "../ai/costEstimate";
import { AiError, type CompleteTextRequest, type CompleteTextResult } from "../ai/types";
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from "./chunker";
import { ANSWER_SYSTEM_PROMPT, DEFAULT_TOP_K, RagPipeline, buildAnswerPrompt } from "./pipeline";
import { resolveStageNodes } from "./stageNodes";

/** Pausa tras cada etapa para que el brillo se vea: trocear o embeber tarda microsegundos. No cuenta en `latencyMs`. */
export const DEFAULT_STAGE_DWELL_MS = 350;
export const ANSWER_MAX_TOKENS = 700;
const DOCUMENT_ID = "doc";

export interface RagTraceInput {
  question: string;
  documentText: string;
  modules: readonly PlaygroundModuleRef[];
  provider: AiProviderId;
  model: string;
  /** Tarifa del LLM ya resuelta (precio manual del usuario o catálogo). Sin ella se consulta el catálogo. */
  price?: ResolvedPrice;
  /** Llamada al LLM ya envuelta con plazo y cancelación. */
  complete: (request: CompleteTextRequest) => Promise<CompleteTextResult>;
  emit: (event: PlaygroundSseEvent) => void;
  signal: AbortSignal;
  /** `performance.now()` al recibir la petición: la etapa `api` mide desde ahí. */
  startedAt: number;
  dwellMs?: number;
  now?: () => number;
}

/**
 * Ejecuta el pipeline RAG didáctico emitiendo la traza: api → chunker → embedder → vector_store
 * (indexar) → embedder + vector_store (recuperar) → llm → result → done.
 * Nunca lanza: un fallo se emite como `error` seguido de `done`. Si el cliente cancela, calla.
 */
export async function runRagTrace(input: RagTraceInput): Promise<void> {
  const { emit, signal } = input;
  const now = input.now ?? (() => performance.now());
  const dwellMs = input.dwellMs ?? DEFAULT_STAGE_DWELL_MS;
  const nodes = resolveStageNodes(input.modules);
  const pipeline = new RagPipeline();

  const stage = async <T>(id: PlaygroundStageId, work: () => T | Promise<T>, detail: (value: T) => string, from = now()): Promise<T> => {
    signal.throwIfAborted();
    emit({ type: "stage_start", stage: id, nodeId: nodes[id] });
    const value = await work();
    const latencyMs = Math.max(0, Math.round((now() - from) * 100) / 100);
    signal.throwIfAborted();
    emit({ type: "stage_done", stage: id, nodeId: nodes[id], latencyMs, detail: detail(value) });
    await pause(dwellMs, signal);
    return value;
  };

  try {
    await stage("api", () => null, () => `${input.question.length} car. de pregunta · ${input.documentText.length} car. de documento`, input.startedAt);

    const chunks = await stage("chunker", () => pipeline.chunk(input.documentText), (value) =>
      `${value.length} fragmentos (${DEFAULT_CHUNK_SIZE}/${DEFAULT_CHUNK_OVERLAP})`,
    );
    if (chunks.length === 0) throw new AiError("bad_response", "El documento no tiene texto que indexar.");

    let embeddedChars = 0;
    const vectors = await stage("embedder", () => {
      embeddedChars += chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      return pipeline.embed(chunks);
    }, (value) =>
      `${value.length} vectores × ${pipeline.embedder.dimensions} dims`,
    );
    await stage("vector_store", () => pipeline.index(DOCUMENT_ID, chunks, vectors), (written) => `${written} registros indexados`);

    await stage("embedder", () => {
      embeddedChars += input.question.length;
      return pipeline.embedder.embed(input.question);
    }, () => "pregunta → vector");
    const hits = await stage("vector_store", () => pipeline.retrieve(input.question, DEFAULT_TOP_K), (value) =>
      `top-${value.length} por coseno${value[0] ? ` (máx ${value[0].score.toFixed(2)})` : ""}`,
    );

    const user = buildAnswerPrompt(input.question, hits);
    const completion = await stage(
      "llm",
      () => input.complete({ system: ANSWER_SYSTEM_PROMPT, user, maxTokens: ANSWER_MAX_TOKENS }),
      (value) => `${value.usage?.totalTokens ?? "?"} tokens`,
    );
    const usage = completion.usage ?? estimateUsage(`${ANSWER_SYSTEM_PROMPT}\n${user}`, completion.text);
    const costBreakdown = [
      embedderCost(pipeline.embedder.dimensions, embeddedChars),
      llmCost(input.provider, input.model, usage, input.price ?? resolvePrice(input.provider, input.model)),
    ];
    emit({
      type: "result",
      answer: completion.text,
      chunks: hits,
      usage,
      costUsd: sumCosts(costBreakdown),
      costBreakdown,
      provider: input.provider,
      model: input.model,
    });
  } catch (error) {
    if (signal.aborted) return;
    const message = error instanceof AiError ? error.hint : "Error inesperado en el pipeline RAG.";
    if (!(error instanceof AiError)) console.error("[playground] error inesperado", error);
    emit(error instanceof AiError ? { type: "error", message, code: error.code } : { type: "error", message });
  }
  emit({ type: "done" });
}

/**
 * El embedder didáctico (bolsa de palabras hasheada) corre en el servidor de la app: 0 $.
 * Se cuentan igualmente sus tokens para que el desglose muestre el volumen que pasaría por un embedder de pago.
 */
function embedderCost(dimensions: number, chars: number): PlaygroundCostLine {
  return {
    stage: "embedder",
    provider: "local",
    model: `hashed-bow-${dimensions}d`,
    promptTokens: Math.ceil(chars / 4),
    completionTokens: 0,
    estimated: true,
    price: { input: 0, output: 0 },
    priceSource: "local",
    costUsd: 0,
  };
}

function llmCost(provider: AiProviderId, model: string, usage: TokenUsage, resolved: ResolvedPrice): PlaygroundCostLine {
  return {
    stage: "llm",
    provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    estimated: usage.estimated === true,
    price: resolved.price,
    priceSource: resolved.source,
    costUsd: costFor(resolved.price, usage),
  };
}

/** Suma del desglose; null si alguna etapa no tiene tarifa (el total no sería real). */
export function sumCosts(lines: readonly PlaygroundCostLine[]): number | null {
  let total = 0;
  for (const line of lines) {
    if (line.costUsd === null) return null;
    total += line.costUsd;
  }
  return total;
}

function estimateUsage(prompt: string, answer: string): TokenUsage {
  const promptTokens = approximateTokens(prompt);
  const completionTokens = approximateTokens(answer);
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, estimated: true };
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
