"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Download, History, Trash2 } from "lucide-react";
import { Metric, Modal, BTN_GHOST, BTN_SECONDARY } from "@/features/dashboard/ui";
import { isProviderId, modelLabel } from "@/lib/ai/catalog";
import { cn } from "@/lib/cn";
import { downloadText } from "@/lib/download";
import { TRACE_PROFILES, TRACE_PROFILE_IDS, isTraceProfileId } from "@/lib/trace/profiles";
import type { TraceProfileId } from "@core/trace";
import {
  RELEVANCE_THRESHOLD,
  aggregateRuns,
  filterRuns,
  formatRatio,
  formatRunCost,
  formatRunLatency,
  latencyByNode,
  type RagQualityMetrics,
  type RunRecord,
} from "./lib/runLog";
import { useRunLog, useRuns } from "./store";

const ALL = "__all__";

const METRIC_INFO: readonly { key: keyof RagQualityMetrics; label: string; hint: string }[] = [
  { key: "topScore", label: "Mejor similitud", hint: "Similitud coseno del fragmento más parecido a la pregunta." },
  { key: "meanScore", label: "Relevancia del contexto", hint: "Similitud media de los fragmentos recuperados." },
  {
    key: "precisionAtK",
    label: "Precisión@k",
    hint: `Fracción de fragmentos recuperados con similitud ≥ ${RELEVANCE_THRESHOLD}.`,
  },
  { key: "citationCoverage", label: "Cobertura de citas", hint: "Fracción de fragmentos que la respuesta cita como [n]." },
  { key: "groundedness", label: "Fundamentación", hint: "Fracción de palabras con contenido de la respuesta presentes en el contexto." },
];

function modelName(run: RunRecord): string {
  if (run.profile !== "rag") return TRACE_PROFILES[run.profile].label;
  return isProviderId(run.provider) ? modelLabel(run.provider, run.model) : run.model;
}

const SELECT_CLASS =
  "h-8 max-w-[16rem] rounded-lg border border-edge bg-panel px-2 font-mono text-xs text-fg focus:border-brand focus:outline-none";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("es", { dateStyle: "short", timeStyle: "medium" });
}

/**
 * "Tracing Log": cada ejecución de «Probar / Simular» (RAG, HTTP, evento) con su traza por nodo,
 * latencia y errores; en RAG, además consumo, fragmentos y calidad. Filtrable por pipeline, perfil y nodo.
 */
export function RunHistoryModal({ graphName = null, onClose }: { graphName?: string | null; onClose: () => void }) {
  const allRuns = useRuns();
  const [filter, setFilter] = useState<string>(graphName ?? ALL);
  const [profile, setProfile] = useState<TraceProfileId | null>(null);
  const [nodeFilter, setNodeFilter] = useState<string>(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const graphs = useMemo(() => [...new Set(allRuns.map((run) => run.graphName))].sort(), [allRuns]);
  const byGraph = useMemo(() => (filter === ALL ? allRuns : allRuns.filter((run) => run.graphName === filter)), [allRuns, filter]);
  const nodeOptions = useMemo(() => {
    const labels = new Map<string, string>();
    for (const run of byGraph) for (const stage of run.stages) if (stage.nodeId) labels.set(stage.nodeId, stage.label);
    return [...labels].sort((left, right) => left[1].localeCompare(right[1]));
  }, [byGraph]);
  const runs = useMemo(
    () => filterRuns(byGraph, { profile, nodeId: nodeFilter === ALL ? null : nodeFilter }),
    [byGraph, profile, nodeFilter],
  );
  const hasRag = runs.some((run) => run.profile === "rag");
  const aggregate = useMemo(() => aggregateRuns(runs), [runs]);
  const nodes = useMemo(() => [...latencyByNode(runs)].sort((left, right) => right[1].avgMs - left[1].avgMs), [runs]);
  const maxNodeMs = nodes[0]?.[1].avgMs ?? 0;

  const exportJson = (): void => {
    const name = filter === ALL ? "todos" : filter;
    downloadText(`ejecuciones-${name}.json`, JSON.stringify(runs, null, 2), "application/json");
  };

  const clear = (): void => {
    const scope = filter === ALL ? "todo el historial" : `el historial de «${filter}»`;
    if (window.confirm(`¿Borrar ${scope}? No se puede deshacer.`)) useRunLog.getState().clear(filter === ALL ? undefined : filter);
  };

  return (
    <Modal
      title="Tracing Log"
      description="Cada ejecución de «Probar / Simular» (RAG, HTTP, evento): traza por nodo, latencia, errores y, en RAG, consumo y calidad. Se guarda solo en este navegador."
      onClose={onClose}
      className="max-w-4xl"
    >
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-fg-3">
            Pipeline
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setOpenId(null);
              }}
              className={SELECT_CLASS}
            >
              <option value={ALL}>Todos ({allRuns.length})</option>
              {graphs.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {graphName && !graphs.includes(graphName) ? <option value={graphName}>{graphName}</option> : null}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg-3">
            Perfil
            <select
              value={profile ?? ALL}
              onChange={(event) => {
                setProfile(isTraceProfileId(event.target.value) ? event.target.value : null);
                setOpenId(null);
              }}
              className={SELECT_CLASS}
            >
              <option value={ALL}>Todos</option>
              {TRACE_PROFILE_IDS.map((id) => (
                <option key={id} value={id}>
                  {TRACE_PROFILES[id].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg-3">
            Nodo
            <select
              value={nodeFilter}
              onChange={(event) => {
                setNodeFilter(event.target.value);
                setOpenId(null);
              }}
              className={SELECT_CLASS}
            >
              <option value={ALL}>Todos</option>
              {nodeOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={exportJson} disabled={runs.length === 0} className={BTN_SECONDARY}>
              <Download className="size-4" aria-hidden />
              Exportar JSON
            </button>
            <button type="button" onClick={clear} disabled={runs.length === 0} className={BTN_GHOST}>
              <Trash2 className="size-4" aria-hidden />
              Borrar
            </button>
          </div>
        </div>

        {runs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-edge px-6 py-12 text-center">
            <History className="size-5 text-fg-3" aria-hidden />
            <p className="text-sm text-fg-2">Aún no hay ejecuciones registradas.</p>
            <p className="max-w-sm text-xs text-fg-3">Lanza una prueba desde «Probar / Simular» en el lienzo: cada corrida completada aparece aquí.</p>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4 rounded-xl border border-edge bg-app-2/50 p-4 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Ejecuciones" value={aggregate.count} />
              <Metric label="Latencia media" value={formatRunLatency(aggregate.avgLatencyMs)} />
              <Metric label="Latencia p95" value={formatRunLatency(aggregate.p95LatencyMs)} />
              <Metric label="Errores" value={formatRatio(aggregate.avgErrorRate)} hint="Fracción media de etapas que fallaron" />
              {hasRag ? (
                <>
                  <Metric label="Coste medio" value={formatRunCost(aggregate.avgCostUsd)} hint={`Total: ${formatRunCost(aggregate.totalCostUsd)}`} />
                  <Metric label="Relevancia" value={formatRatio(aggregate.avgRelevance)} hint="Similitud media de los fragmentos recuperados (RAG)" />
                </>
              ) : null}
            </dl>

            {nodes.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-3">Latencia media por nodo</h3>
                <ul className="flex flex-col gap-1.5">
                  {nodes.map(([id, entry]) => (
                    <li key={id} className="grid grid-cols-[minmax(0,10rem)_1fr_4.5rem] items-center gap-3 text-xs">
                      <span className="truncate text-fg-2" title={id}>
                        {entry.label}
                      </span>
                      <span className="h-2 overflow-hidden rounded-full bg-app-2">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${maxNodeMs > 0 ? Math.max(2, (entry.avgMs / maxNodeMs) * 100) : 0}%` }} />
                      </span>
                      <span className="text-right font-mono text-fg">{formatRunLatency(entry.avgMs)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="flex flex-col gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-3">Peticiones</h3>
              <ul className="flex flex-col divide-y divide-edge overflow-hidden rounded-xl border border-edge">
                {runs.map((run) => (
                  <RunRow key={run.id} run={run} open={openId === run.id} showGraph={filter === ALL} onToggle={() => setOpenId(openId === run.id ? null : run.id)} />
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function RunRow({ run, open, showGraph, onToggle }: { run: RunRecord; open: boolean; showGraph: boolean; onToggle: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-brand"
      >
        <ChevronRight className={cn("size-4 text-fg-3 transition-transform", open && "rotate-90")} aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-sm text-fg">{run.question}</span>
          <span className="block truncate text-[11px] text-fg-3">
            {formatDate(run.finishedAt)} · {modelName(run)}
            {run.demo ? " · demo" : ""}
            {showGraph ? ` · ${run.graphName}` : ""}
          </span>
        </span>
        <span className="flex gap-4 font-mono text-xs text-fg-2">
          <span title="Latencia total">{formatRunLatency(run.totalLatencyMs)}</span>
          {run.errorRate > 0 ? (
            <span title="Etapas con error" className="text-rose-700">
              {formatRatio(run.errorRate)} err
            </span>
          ) : null}
          {run.metrics ? (
            <>
              <span title="Tokens (entrada + salida)" className="hidden sm:inline">
                {run.usage.totalTokens}
                {run.usage.estimated ? "~" : ""} tok
              </span>
              <span title="Coste estimado">{formatRunCost(run.costUsd)}</span>
              <span title="Relevancia del contexto" className="hidden md:inline">
                {formatRatio(run.metrics.meanScore)}
              </span>
            </>
          ) : null}
        </span>
      </button>
      {open ? <RunDetail run={run} /> : null}
    </li>
  );
}

function RunDetail({ run }: { run: RunRecord }) {
  const maxMs = Math.max(1, ...run.stages.map((stage) => stage.latencyMs));
  return (
    <div className="flex flex-col gap-4 border-t border-edge bg-app-2/40 px-5 py-4 text-xs">
      {run.metrics ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {METRIC_INFO.map((item) => (
            <Metric key={item.key} label={item.label} value={formatRatio(run.metrics?.[item.key] ?? null)} hint={item.hint} />
          ))}
        </dl>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-1.5">
          <h4 className="font-semibold text-fg-2">Traza por nodo</h4>
          <ol className="flex flex-col gap-1">
            {run.stages.map((stage, index) => (
              <li key={index} className={cn("grid grid-cols-[minmax(0,8rem)_1fr_4rem] items-center gap-2", stage.upstream && "opacity-60")}>
                <span className="truncate text-fg-2" title={stage.nodeId ?? "sin nodo en el grafo"}>
                  {stage.label}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-panel" title={stage.error}>
                  <span
                    className={cn("block h-full rounded-full", stage.error ? "bg-rose-500" : "bg-teal-500")}
                    style={{ width: `${Math.max(2, (stage.latencyMs / maxMs) * 100)}%` }}
                  />
                </span>
                <span className="text-right font-mono text-fg">{formatRunLatency(stage.latencyMs)}</span>
              </li>
            ))}
          </ol>
          <p className="text-fg-3">
            {run.metrics ? (
              <>
                Tokens: {run.usage.promptTokens} entrada + {run.usage.completionTokens} salida{run.usage.estimated ? " (estimado)" : ""} · Coste{" "}
                {formatRunCost(run.costUsd)}
              </>
            ) : (
              <>Perfil: {TRACE_PROFILES[run.profile].label}</>
            )}
            {run.entryLabel ? ` · Entrada: ${run.entryLabel}` : ""}
          </p>
        </section>

        {run.metrics ? (
          <section className="flex flex-col gap-1.5">
            <h4 className="font-semibold text-fg-2">Fragmentos recuperados ({run.chunks.length})</h4>
            <ol className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
              {run.chunks.map((chunk, index) => (
                <li key={chunk.id} className="rounded-lg border border-edge bg-panel p-2">
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="text-fg-3">
                      [{index + 1}] {chunk.id}
                    </span>
                    <span className={cn(chunk.score >= RELEVANCE_THRESHOLD ? "text-emerald-700" : "text-amber-700")}>{formatRatio(chunk.score)}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-fg-2">{chunk.text}</p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>

      <section className="flex flex-col gap-1.5">
        <h4 className="font-semibold text-fg-2">{run.profile === "rag" ? "Respuesta" : "Salida"}</h4>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-edge bg-panel p-3 text-fg [overflow-wrap:anywhere]">{run.answer}</p>
      </section>
    </div>
  );
}
