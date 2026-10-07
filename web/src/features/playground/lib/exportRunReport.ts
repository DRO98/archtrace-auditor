import type { PlaygroundCostLine, RagStageId, RetrievedChunk, TokenUsage } from "@core/playground";
import { RAG_STAGES } from "@/lib/trace/profiles";
import { SYSTEM_ENTRY_LABEL, type EntryPoint } from "./entryPoint";
import type { StageTrace } from "./traceState";
import { formatLatency } from "./traceState";

export const STAGE_LABELS: Readonly<Record<RagStageId, string>> = Object.fromEntries(
  RAG_STAGES.map((stage) => [stage.id, stage.label]),
) as Record<RagStageId, string>;

export interface RunReportInput {
  question: string;
  documentName: string | null;
  /** Opcional para informes antiguos: sin él se asume el sistema completo. */
  entry?: EntryPoint | null;
  answer: string;
  chunks: readonly RetrievedChunk[];
  usage: TokenUsage;
  costUsd: number | null;
  provider: string;
  model: string;
  /** Coste por etapa (embedder + LLM); ausente en informes antiguos y demos. */
  costBreakdown?: readonly PlaygroundCostLine[];
  stages: readonly StageTrace[];
  finishedAt: string;
}

/** "$0.000123", "$0.0421", "gratis (local)", "sin tarifa". */
export function formatCost(costUsd: number | null, provider?: string): string {
  if (costUsd === null) return "sin tarifa conocida";
  if (costUsd === 0) return provider === "ollama" ? "0 $ (local)" : provider === "demo" ? "0 $ (simulado)" : "0 $";
  if (costUsd < 0.01) return `$${costUsd.toFixed(6)}`;
  return `$${costUsd.toFixed(4)}`;
}

const PRICE_SOURCE_LABEL: Readonly<Record<PlaygroundCostLine["priceSource"], string>> = {
  catalog: "catálogo",
  custom: "manual",
  local: "local",
  unknown: "sin tarifa",
};

/** "$0.15 / $0.6 (catálogo)" o "sin tarifa". */
export function formatRate(line: Pick<PlaygroundCostLine, "price" | "priceSource">): string {
  if (!line.price) return PRICE_SOURCE_LABEL.unknown;
  return `$${line.price.input} / $${line.price.output} (${PRICE_SOURCE_LABEL[line.priceSource]})`;
}

export function stageLabel(stage: Pick<StageTrace, "stage" | "label">): string {
  return stage.label ?? (STAGE_LABELS as Readonly<Record<string, string>>)[stage.stage] ?? stage.stage;
}

const cell = (value: string): string => value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** Informe Markdown de una corrida del playground: pregunta, respuesta, traza, fragmentos y coste. */
export function exportRunReport(run: RunReportInput): string {
  const totalMs = run.stages.reduce((sum, stage) => sum + (stage.latencyMs ?? 0), 0);
  const lines = [
    "# Informe de consulta RAG",
    "",
    `- **Fecha:** ${run.finishedAt}`,
    `- **Modelo:** ${run.provider} · ${run.model}`,
    `- **Documento:** ${run.documentName ?? "texto pegado"}`,
    `- **Punto de entrada:** ${run.entry ? run.entry.label : SYSTEM_ENTRY_LABEL}`,
    "",
    "## Pregunta",
    "",
    run.question,
    "",
    "## Respuesta",
    "",
    run.answer.trim(),
    "",
    "## Traza del pipeline",
    "",
    "| # | Etapa | Nodo | Latencia | Detalle |",
    "|---|-------|------|----------|---------|",
    ...run.stages.map(
      (stage, index) =>
        `| ${index + 1} | ${cell(stageLabel(stage))}${stage.upstream ? " (preparación)" : ""} | ${stage.nodeId ? `\`${cell(stage.nodeId)}\`` : "—"} | ${
          stage.latencyMs === undefined ? "—" : formatLatency(stage.latencyMs)
        } | ${cell(stage.detail ?? "")} |`,
    ),
    "",
    `Tiempo total medido: ${formatLatency(totalMs)}.`,
    "",
    "## Fragmentos recuperados",
    "",
    ...(run.chunks.length === 0
      ? ["(ninguno)"]
      : run.chunks.flatMap((chunk, index) => [`${index + 1}. **${chunk.score.toFixed(3)}** · \`${chunk.id}\``, "", `   > ${cell(chunk.text)}`, ""])),
    "## Tokens y coste",
    "",
    `- Prompt: ${run.usage.promptTokens}`,
    `- Respuesta: ${run.usage.completionTokens}`,
    `- Total: ${run.usage.totalTokens}${run.usage.estimated ? " (estimado)" : ""}`,
    `- Coste estimado: ${formatCost(run.costUsd, run.provider)}`,
    "",
    ...(run.costBreakdown && run.costBreakdown.length > 0
      ? [
          "| Etapa | Modelo | Tokens entrada | Tokens salida | Tarifa (USD / 1M) | Coste |",
          "| --- | --- | ---: | ---: | --- | ---: |",
          ...run.costBreakdown.map(
            (line) =>
              `| ${STAGE_LABELS[line.stage]} | ${cell(`${line.provider} · ${line.model}`)} | ${line.promptTokens}${line.estimated ? " (est.)" : ""} | ${line.completionTokens} | ${formatRate(line)} | ${formatCost(line.costUsd, line.provider === "local" ? "ollama" : line.provider)} |`,
          ),
          "",
        ]
      : []),
  ];
  return lines.join("\n");
}
