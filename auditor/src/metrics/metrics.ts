import type { AuditMetrics } from "@core/audit";
import type { TokenUsage } from "@core/playground";

/** Acumulador de métricas de una auditoría (tokens, llamadas, latencia por etapa, contexto por nivel). */
export class MetricsRecorder {
  readonly data: AuditMetrics = {
    llmCalls: 0,
    cacheHits: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensEstimated: false,
    contextTokensByLevel: [],
    stageMs: {},
    filesChanged: 0,
    linesTotal: 0,
    linesPrioritized: 0,
    unitsTotal: 0,
    unitsWithoutLlm: 0,
    index: { blobsParsed: 0, blobsReused: 0, docsParsed: 0, docsReused: 0 },
    retrieval: { mode: "bm25", embedded: 0, reused: 0 },
  };

  async time<T>(stage: string, run: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await run();
    } finally {
      this.addStage(stage, performance.now() - started);
    }
  }

  addStage(stage: string, ms: number): void {
    this.data.stageMs[stage] = Math.round((this.data.stageMs[stage] ?? 0) + ms);
  }

  recordCall(usage: TokenUsage): void {
    this.data.llmCalls += 1;
    this.data.tokensIn += usage.promptTokens;
    this.data.tokensOut += usage.completionTokens;
    if (usage.estimated) this.data.tokensEstimated = true;
  }

  recordCacheHit(): void {
    this.data.cacheHits += 1;
  }

  recordContext(level: number, tokens: number): void {
    const levels = this.data.contextTokensByLevel;
    while (levels.length <= level) levels.push(0);
    levels[level] = (levels[level] ?? 0) + tokens;
  }
}
