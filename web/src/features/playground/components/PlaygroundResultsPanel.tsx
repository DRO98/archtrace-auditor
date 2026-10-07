"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ChevronDown, ChevronRight, Download, Eraser } from "lucide-react";
import { MarkdownAnswer } from "@/features/lesson/components/MarkdownAnswer";
import { isProviderId, modelLabel } from "@/lib/ai/catalog";
import { downloadText } from "@/lib/download";
import { cn } from "@/lib/cn";
import { RELEVANCE_THRESHOLD, computeQualityMetrics, formatRatio } from "@/features/runs/lib/runLog";
import { SYSTEM_ENTRY_LABEL } from "../lib/entryPoint";
import { STAGE_LABELS, exportRunReport, formatCost, formatRate, stageLabel } from "../lib/exportRunReport";
import { formatLatency, routeByNode, type StageTrace } from "../lib/traceState";
import { playgroundContext, usePlaygroundStore, type PlaygroundResult } from "../store";

const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-ink-3";
const BUTTON_SM =
  "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-line px-2 text-xs font-medium text-ink-2 hover:bg-neutral-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-teal-500";
const CITE_BADGE =
  "inline-flex items-center rounded bg-teal-100 px-1.5 py-0.5 align-baseline font-mono text-xs font-semibold leading-none text-teal-700 transition-colors hover:bg-teal-200 focus-visible:outline-2 focus-visible:outline-teal-500 dark:bg-teal-900/40 dark:text-teal-300 dark:hover:bg-teal-900/70";
/** `[1]`, `[2]`… en la respuesta: el LLM cita así los fragmentos recuperados (numerados desde 1). */
const CITE_MARK = /\[(\d+)\]/g;
/** Lo que dura el halo del fragmento tras pulsar su cita. */
const FLASH_MS = 1400;

/**
 * Pestaña "Resultado" del panel "Probar en vivo": respuesta, métricas y fragmentos recuperados de la
 * última corrida. Vive en la columna derecha para que el lienzo quede siempre despejado.
 */
export function PlaygroundResultsPanel() {
  const result = usePlaygroundStore((state) => state.result);
  if (!result) {
    return <p className="px-3 py-10 text-center text-sm text-ink-3">Ejecuta una consulta para ver aquí el resultado.</p>;
  }
  return <ResultView key={result.finishedAt} result={result} />;
}

function ResultView({ result }: { result: PlaygroundResult }) {
  const chunksRef = useRef<HTMLDetailsElement>(null);
  const chunkRefs = useRef(new Map<number, HTMLDetailsElement>());
  const flashTimer = useRef<number | undefined>(undefined);
  /** Fragmento resaltado: mientras el ratón está sobre su cita, o durante FLASH_MS tras pulsarla. */
  const [hovered, setHovered] = useState<number | null>(null);
  const [flashed, setFlashed] = useState<number | null>(null);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const focusChunk = useCallback((n: number): void => {
    const card = chunkRefs.current.get(n);
    if (!card) return;
    if (chunksRef.current) chunksRef.current.open = true;
    card.open = true;
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setFlashed(n);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashed(null), FLASH_MS);
  }, []);

  const renderText = useCallback(
    (text: string): ReactNode => {
      const parts: ReactNode[] = [];
      let last = 0;
      for (const match of text.matchAll(CITE_MARK)) {
        const n = Number(match[1]);
        if (n < 1 || n > result.chunks.length) continue;
        parts.push(text.slice(last, match.index));
        parts.push(
          <button
            key={match.index}
            type="button"
            title={`Ver fragmento [${n}] · ${result.chunks[n - 1]?.id ?? ""}`}
            onClick={() => focusChunk(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(n)}
            onBlur={() => setHovered(null)}
            className={CITE_BADGE}
          >
            [{n}]
          </button>,
        );
        last = match.index + match[0].length;
      }
      if (last === 0) return text;
      parts.push(text.slice(last));
      return parts;
    },
    [result.chunks, focusChunk],
  );

  const totalMs = result.stages.reduce((sum, stage) => sum + (stage.latencyMs ?? 0), 0);
  const download = (): void =>
    downloadText(`informe-rag-${result.finishedAt.slice(0, 19).replace(/[:T]/g, "-")}.md`, exportRunReport(result), "text/markdown");

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      <div className="flex flex-col gap-1">
        <dl className="grid grid-cols-3 divide-x divide-line rounded-md border border-line text-xs">
          <Stat label="Tiempo" value={formatLatency(totalMs)} />
          <Stat label="Coste" value={formatCost(result.costUsd, result.provider)} detail="Coste aproximado" />
          <Stat
            label="Tokens"
            value={`${result.usage.totalTokens}${result.usage.estimated ? " est." : ""}`}
            detail={`${result.usage.promptTokens} entrada + ${result.usage.completionTokens} salida${result.usage.estimated ? " (estimado)" : ""}`}
          />
        </dl>
        <p className="self-start max-w-full truncate rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-ink-2 dark:bg-slate-800" title={`${result.provider} · ${result.model}`}>
          {isProviderId(result.provider) ? modelLabel(result.provider, result.model) : result.model}
        </p>
      </div>

      <section className="flex flex-col gap-1.5">
        <h3 className={LABEL}>Respuesta</h3>
        <p className="border-l-2 border-line pl-2 text-xs italic text-ink-3 [overflow-wrap:anywhere]">{result.question}</p>
        <div className="text-sm leading-6 text-ink [&>div]:gap-3 [&_pre]:scrollbar-thin [&_pre]:max-h-36 [&_pre]:overflow-auto [&_pre]:text-xs">
          <MarkdownAnswer source={result.answer} files={null} renderText={renderText} />
        </div>
      </section>

      <QualityMetrics result={result} />

      {/* Detalle técnico: cerrado por defecto para que la respuesta mande. */}
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <CostBreakdown result={result} />
        <NodeRoute result={result} />
        <Collapsible ref={chunksRef} title="Fragmentos recuperados" hint={String(result.chunks.length)}>
          <ol className="flex flex-col gap-1.5">
            {result.chunks.map((chunk, index) => {
              const n = index + 1;
              return (
                <li key={chunk.id}>
                  <details
                    ref={(node) => {
                      if (node) chunkRefs.current.set(n, node);
                      else chunkRefs.current.delete(n);
                    }}
                    className={cn(
                      "group/chunk scroll-my-2 rounded-md border border-line bg-slate-50 text-xs transition-shadow duration-300 dark:bg-slate-900",
                      (hovered === n || flashed === n) && "border-teal-300 shadow-[0_0_0_5px_rgba(139,92,246,0.15)] ring-2 ring-teal-400/70",
                    )}
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 select-none">
                      <ChevronDown className="size-3 shrink-0 -rotate-90 text-ink-3 transition-transform group-open/chunk:rotate-0" aria-hidden />
                      <span className="rounded bg-teal-100 px-1.5 py-0.5 font-mono font-semibold leading-none text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                        [{n}]
                      </span>
                      <span className="min-w-0 truncate font-mono text-ink-3">{chunk.id}</span>
                      <span className="ml-auto h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-neutral-200 dark:bg-slate-700" aria-hidden>
                        <span className="block h-full bg-teal-500" style={{ width: `${Math.round(Math.max(0, Math.min(1, chunk.score)) * 100)}%` }} />
                      </span>
                      <span className="shrink-0 font-mono text-ink-2" title="Similitud coseno">
                        {chunk.score.toFixed(3)}
                      </span>
                    </summary>
                    <p className="scrollbar-thin max-h-28 overflow-y-auto border-t border-line px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-slate-600 [overflow-wrap:anywhere] dark:text-slate-400">
                      {chunk.text}
                    </p>
                  </details>
                </li>
              );
            })}
          </ol>
        </Collapsible>
      </div>

      <div className="flex items-center gap-1.5 border-t border-line pt-3">
        <button type="button" onClick={download} className={BUTTON_SM}>
          <Download className="size-3.5" aria-hidden />
          Exportar informe
        </button>
        <button
          type="button"
          title="Quitar la traza del lienzo"
          onClick={() => usePlaygroundStore.getState().clear()}
          className={BUTTON_SM}
        >
          <Eraser className="size-3.5" aria-hidden />
          Limpiar traza
        </button>
      </div>
    </div>
  );
}

/** Recorrido por nodo con su tiempo: API Routes · 4 ms → RAG Pipeline · 120 ms → LLM Client · 1.2 s. */
function NodeRoute({ result }: { result: PlaygroundResult }) {
  const hops = routeByNode(result.stages);
  if (hops.length === 0) return null;
  const modules = playgroundContext().modules;
  const name = (nodeId: string | null, stage: StageTrace): string =>
    (nodeId ? modules.find((item) => item.id === nodeId)?.label : undefined) ?? stageLabel(stage);

  return (
    <Collapsible title="Recorrido por nodo" hint={`${hops.length} ${hops.length === 1 ? "nodo" : "nodos"}`} tooltip={`Entrada: ${result.entry?.label ?? SYSTEM_ENTRY_LABEL}`}>
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {hops.map((hop, index) => (
          <li key={hop.key} className="flex items-center gap-1">
            {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-ink-3" aria-hidden /> : null}
            <span
              title={hop.upstream ? "Preparación: se ejecutó antes del punto de entrada" : (hop.nodeId ?? "sin nodo en el grafo")}
              className={cn(
                "inline-flex max-w-[14rem] items-center gap-1 rounded border px-1.5 py-0.5",
                hop.upstream ? "border-dashed border-line text-ink-3" : "border-teal-200 bg-teal-50 text-teal-900",
                hop.nodeId === result.entry?.nodeId && "ring-1 ring-teal-400",
              )}
            >
              <span className="truncate font-medium">{name(hop.nodeId, hop.stage)}</span>
              <span className="shrink-0 font-mono">{formatLatency(hop.latencyMs)}</span>
            </span>
          </li>
        ))}
      </ol>
    </Collapsible>
  );
}

/**
 * Coste paso a paso: etapa, barra proporcional al coste e importe. Tokens y tarifa (catálogo, manual,
 * local o sin tarifa) van en el tooltip para que la fila quepa en el panel estrecho.
 */
function CostBreakdown({ result }: { result: PlaygroundResult }) {
  const lines = result.costBreakdown;
  if (!lines || lines.length === 0) return null;
  const max = Math.max(...lines.map((line) => line.costUsd ?? 0), 0);
  return (
    <Collapsible title="Coste por etapa" hint={formatCost(result.costUsd, result.provider)}>
      <ul className="flex flex-col gap-1.5 text-xs">
        {lines.map((line) => {
          const cost = line.costUsd ?? 0;
          const width = max > 0 && cost > 0 ? Math.max(1.5, (cost / max) * 100) : 0;
          const tokens = `${line.promptTokens} entrada + ${line.completionTokens} salida${line.estimated ? " (estimado)" : ""}`;
          return (
            <li
              key={line.stage}
              title={`${line.provider} · ${line.model}\nTokens: ${tokens}\nTarifa / 1M: ${formatRate(line)}`}
              className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{STAGE_LABELS[line.stage]}</span>
                <span className="block truncate text-[11px] text-ink-3">{line.model}</span>
              </span>
              <span className="h-1.5 rounded-full bg-neutral-100 dark:bg-slate-800" aria-hidden>
                <span className="block h-1.5 rounded-full bg-teal-500" style={{ width: `${width}%` }} />
              </span>
              <StageCost costUsd={line.costUsd} />
            </li>
          );
        })}
      </ul>
    </Collapsible>
  );
}

function StageCost({ costUsd }: { costUsd: number | null }) {
  if (costUsd === null) return <span className="text-right text-[11px] text-amber-700">sin tarifa</span>;
  if (costUsd === 0) return <span className="text-right text-[11px] text-ink-3">Gratis</span>;
  return <span className="text-right font-mono text-ink">{formatCost(costUsd)}</span>;
}

/** Sección de detalle plegable (cerrada por defecto) con un dato resumen a la derecha del título. */
function Collapsible({
  title,
  hint,
  tooltip,
  ref,
  children,
}: {
  title: string;
  hint?: string;
  tooltip?: string;
  ref?: Ref<HTMLDetailsElement>;
  children: ReactNode;
}) {
  return (
    <details ref={ref} className="group flex flex-col">
      <summary title={tooltip} className={`${LABEL} flex cursor-pointer list-none items-center gap-1 py-0.5 select-none hover:text-ink`}>
        <ChevronDown className="size-3.5 shrink-0 -rotate-90 transition-transform group-open:rotate-0" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
        {hint ? <span className="ml-auto shrink-0 font-mono font-normal normal-case tracking-normal text-ink-3">{hint}</span> : null}
      </summary>
      <div className="mt-2 mb-1">{children}</div>
    </details>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 px-2.5 py-1.5" title={detail ?? value}>
      <dt className="text-[10px] uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="truncate font-mono font-medium text-ink">
        {value}
      </dd>
    </div>
  );
}

/** Calidad del RAG de esta corrida: heurísticas deterministas (sin LLM juez), las mismas del historial. */
function QualityMetrics({ result }: { result: PlaygroundResult }) {
  const metrics = computeQualityMetrics(result.answer, result.chunks);
  if (metrics.meanScore === null) return null;
  const items = [
    { label: "Relevancia", value: metrics.meanScore, hint: "Similitud media de los fragmentos recuperados" },
    { label: `Precisión@${result.chunks.length}`, value: metrics.precisionAtK, hint: `Fragmentos con similitud ≥ ${RELEVANCE_THRESHOLD}` },
    { label: "Citas", value: metrics.citationCoverage, hint: "Fragmentos citados como [n] en la respuesta" },
    { label: "Fundamentación", value: metrics.groundedness, hint: "Palabras de la respuesta presentes en el contexto" },
  ];
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className={LABEL}>Calidad del RAG</h3>
      <dl className="grid grid-cols-2 gap-1.5 text-xs">
        {items.map((item) => (
          <div key={item.label} title={item.hint} className="rounded-md border border-line px-2 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="min-w-0 truncate text-[11px] text-ink-3">{item.label}</dt>
              <dd className="shrink-0 font-mono font-semibold text-ink">{formatRatio(item.value)}</dd>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
              <div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.round((item.value ?? 0) * 100)}%` }} />
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
