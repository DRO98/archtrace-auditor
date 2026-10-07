import type { SemanticAssessment } from "@core/audit";
import type { TokenUsage } from "@core/playground";
import { approximateTokens } from "@llm/costEstimate";
import { AiError, type AiProvider } from "@llm/types";
import { buildContext, MAX_LEVEL, type ContextInput } from "../context/builder";
import { CONFIDENCE_THRESHOLD } from "../decision/decide";
import type { MetricsRecorder } from "../metrics/metrics";
import type { Taxonomy } from "../rules/taxonomy";
import { LlmCache } from "./cache";
import { assessmentSchema, buildSystemPrompt, buildUserMessage, MAX_OUTPUT_TOKENS, PROMPT_VERSION, SCHEMA_NAME } from "./prompt";
import { validateAssessment } from "./validate";

export interface SemanticEngineOptions {
  provider: AiProvider;
  taxonomy: Taxonomy;
  cache: LlmCache;
  metrics: MetricsRecorder;
  /** Ids de secciones de docs del índice: `rule_refs` fuera de este conjunto se descartan. */
  sectionIds: ReadonlySet<string>;
  /** Escalados de contexto como máximo (L0 → L1 → L2). */
  maxEscalations?: number;
  timeoutMs?: number;
  /** Espera base entre reintentos ante 429 / 5xx (se duplica en cada intento). */
  retryBaseMs?: number;
  /** Tiempo total máximo de la capa LLM en esta auditoría; agotado, el resto se decide por reglas. */
  budgetMs?: number;
  /** Fallos seguidos (sin ningún acierto en medio) tras los que se deja de llamar al proveedor. */
  maxConsecutiveFailures?: number;
}

/** Errores tras los que no tiene sentido seguir llamando al proveedor en esta auditoría. */
const FATAL_CODES = new Set(["auth", "quota", "unconfigured", "network"]);
/** Errores pasajeros que responden rápido: se reintenta con espera creciente. Un timeout no se reintenta. */
const RETRYABLE_CODES = new Set(["rate_limit", "unavailable"]);
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BUDGET_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

/** Un 400/404 del proveedor (modelo inexistente, esquema rechazado) se repetiría en todas las unidades. */
function isFatal(error: AiError): boolean {
  if (FATAL_CODES.has(error.code)) return true;
  const status = error.providerError?.status;
  return error.code === "provider" && (status === 400 || status === 404);
}

/**
 * Capa semántica: contexto progresivo (L0 hunk → L1 función → L2 estructura, con reglas L4 en todos), salida JSON
 * con esquema, validación y caché. Solo escala si el modelo pide más contexto o la confianza queda bajo el umbral.
 */
export class SemanticEngine {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion = PROMPT_VERSION;
  /** Motivo por el que se dejó de consultar al LLM (clave inválida, sin saldo…). */
  disabledReason: string | null = null;
  readonly errors: string[] = [];
  private readonly system: string;
  private readonly schema: Record<string, unknown>;
  private readonly deadline: number;
  private consecutiveFailures = 0;

  constructor(private readonly options: SemanticEngineOptions) {
    this.provider = options.provider.id;
    this.model = options.provider.model;
    this.system = buildSystemPrompt(options.taxonomy);
    this.schema = assessmentSchema(options.taxonomy);
    this.deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
  }

  async assess(input: ContextInput): Promise<SemanticAssessment | null> {
    if (this.disabledReason) return null;
    const maxEscalations = Math.min(this.options.maxEscalations ?? 2, MAX_LEVEL);
    let result: SemanticAssessment | null = null;
    let previous = "";
    for (let level = 0; level <= maxEscalations; level += 1) {
      const context = await buildContext(input, level);
      if (level > 0 && context.text === previous) break; // El nivel siguiente no aporta nada nuevo.
      previous = context.text;
      const user = buildUserMessage(context.text, level, maxEscalations);
      const key = LlmCache.key({ promptVersion: PROMPT_VERSION, provider: this.provider, model: this.model, unitId: input.unit.id, level, context: context.text });

      let value: unknown;
      let usage: TokenUsage | undefined;
      let cached = false;
      const hit = this.options.cache.get(key);
      if (hit) {
        value = hit.value;
        usage = hit.usage;
        cached = true;
        this.options.metrics.recordCacheHit();
      } else {
        if (Date.now() >= this.deadline) {
          this.disabledReason ??= `Tiempo máximo de análisis con LLM agotado (${Math.round((this.options.budgetMs ?? DEFAULT_BUDGET_MS) / 1000)} s): el resto se decidió por reglas.`;
          return result;
        }
        try {
          const response = await this.call(user);
          this.consecutiveFailures = 0;
          value = response.value;
          usage = response.usage ?? estimateUsage(this.system, user, response.value);
          this.options.metrics.recordCall(usage);
          this.options.metrics.recordContext(level, context.tokens);
          this.options.cache.set(key, value, usage);
        } catch (error) {
          this.recordError(error);
          return result;
        }
      }

      result = validateAssessment(value, input.unit, this.options.taxonomy, this.options.sectionIds, {
        provider: this.provider,
        model: this.model,
        promptVersion: PROMPT_VERSION,
        contextLevel: level,
        escalations: level,
        cached,
        ...(usage ? { usage } : {}),
      });
      if (!result.needsMoreContext && result.confidence >= CONFIDENCE_THRESHOLD) break;
    }
    return result;
  }

  cacheSave(): void {
    this.options.cache.save();
  }

  private async call(user: string): Promise<{ value: unknown; usage?: TokenUsage }> {
    for (let attempt = 1; ; attempt += 1) {
      if (this.disabledReason) throw new AiError("unconfigured", this.disabledReason);
      try {
        return await this.callOnce(user);
      } catch (error) {
        const mapped = error instanceof AiError ? error : null;
        if (!mapped || !RETRYABLE_CODES.has(mapped.code) || attempt >= MAX_ATTEMPTS) throw error;
        await sleep((this.options.retryBaseMs ?? 4000) * 2 ** (attempt - 1));
      }
    }
  }

  private async callOnce(user: string): Promise<{ value: unknown; usage?: TokenUsage }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1, Math.min(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS, this.deadline - Date.now())));
    try {
      return await this.options.provider.completeJson(
        { system: this.system, user, schema: this.schema, schemaName: SCHEMA_NAME, maxTokens: MAX_OUTPUT_TOKENS },
        controller.signal,
      );
    } catch (error) {
      if (timedOut) {
        const seconds = (this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000;
        throw new AiError("timeout", `${this.provider} no respondió en ${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)} s (¿proveedor saturado?).`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private recordError(error: unknown): void {
    const message =
      error instanceof AiError ? (error.detail ? `${error.hint} (${error.detail.slice(0, 200)})` : error.hint) : error instanceof Error ? error.message : String(error);
    if (this.errors.length < 5 && !this.errors.includes(message)) this.errors.push(message);
    if (error instanceof AiError && isFatal(error)) this.disabledReason ??= message;
    this.consecutiveFailures += 1;
    const limit = this.options.maxConsecutiveFailures ?? 3;
    if (this.consecutiveFailures >= limit) {
      this.disabledReason ??= `${this.provider} falló ${limit} veces seguidas (${message}); el resto se decidió por reglas.`;
    }
  }
}

function estimateUsage(system: string, user: string, value: unknown): TokenUsage {
  const promptTokens = approximateTokens(system) + approximateTokens(user);
  const completionTokens = approximateTokens(JSON.stringify(value) ?? "");
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, estimated: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
