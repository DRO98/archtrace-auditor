"use client";

import { useId } from "react";
import { AlertTriangle, Download, Globe, Radio, Sparkles } from "lucide-react";
import type { TraceProfileId } from "@core/trace";
import { FIELD_CLASS } from "@/features/canvas/theme";
import type { HttpMethod } from "@/features/trace/runners";
import { cn } from "@/lib/cn";
import { downloadText } from "@/lib/download";
import { TRACE_PROFILES, TRACE_PROFILE_IDS } from "@/lib/trace/profiles";
import { parsePayload } from "../hooks/usePlaygroundTrace";
import { stageLabel } from "../lib/exportRunReport";
import { formatLatency, routeByNode } from "../lib/traceState";
import { usePlaygroundStore, type GenericTraceResult } from "../store";

const FIELD = `${FIELD_CLASS} px-2.5 py-1.5`;
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-ink-3";
const METHODS: readonly HttpMethod[] = ["POST", "GET", "PUT", "PATCH", "DELETE"];
const BUTTON_SM =
  "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-line px-2 text-xs font-medium text-ink-2 hover:bg-neutral-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-teal-500";

const PROFILE_ICON: Readonly<Record<TraceProfileId, typeof Globe>> = { rag: Sparkles, http: Globe, event: Radio };

/** Selector de perfil de "Probar / Simular": RAG es un perfil más, junto a petición HTTP y evento. */
export function ProfileSelector({ disabled }: { disabled: boolean }) {
  const profile = usePlaygroundStore((state) => state.profile);
  return (
    <div role="radiogroup" aria-label="Perfil de prueba" className="flex shrink-0 gap-1 border-b border-line px-3 py-2">
      {TRACE_PROFILE_IDS.map((id) => {
        const Icon = PROFILE_ICON[id];
        const selected = profile === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            title={TRACE_PROFILES[id].description}
            onClick={() => usePlaygroundStore.getState().setProfile(id)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-teal-500 disabled:cursor-not-allowed disabled:opacity-50",
              selected ? "bg-teal-100 text-teal-800" : "text-ink-2 hover:bg-neutral-100 hover:text-ink",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {TRACE_PROFILES[id].label}
          </button>
        );
      })}
    </div>
  );
}

/** Formulario de los perfiles genéricos: payload JSON y, en HTTP, método + URL real opcional. */
export function GenericProbeForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: () => void }) {
  const profile = usePlaygroundStore((state) => state.profile);
  const payload = usePlaygroundStore((state) => state.payload);
  const targetUrl = usePlaygroundStore((state) => state.targetUrl);
  const method = usePlaygroundStore((state) => state.httpMethod);
  const payloadId = useId();
  const urlId = useId();
  const store = usePlaygroundStore.getState;
  const parsed = parsePayload(payload);
  const invalidJson = payload.trim().length > 0 && typeof parsed === "string";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-3">{TRACE_PROFILES[profile].description}</p>

      {profile === "http" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={urlId} className={LABEL}>
            Endpoint real (opcional)
          </label>
          <div className="flex gap-1.5">
            <select
              aria-label="Método HTTP"
              value={method}
              disabled={disabled}
              onChange={(event) => store().setHttpMethod(event.target.value as HttpMethod)}
              className={cn(FIELD, "w-24 font-mono text-xs")}
            >
              {METHODS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <input
              id={urlId}
              type="url"
              inputMode="url"
              value={targetUrl}
              disabled={disabled}
              placeholder="http://localhost:8000/orders"
              onChange={(event) => store().setTargetUrl(event.target.value)}
              className={cn(FIELD, "min-w-0 flex-1 font-mono text-xs")}
            />
          </div>
          <p className="text-[11px] text-ink-3">
            Sin URL, el recorrido y las latencias son simulados por rol. Con URL, el navegador hace la petición (el servicio debe permitir CORS).
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={payloadId} className={LABEL}>
          {profile === "event" ? "Evento (JSON)" : "Body (JSON)"}
        </label>
        <textarea
          id={payloadId}
          rows={7}
          spellCheck={false}
          value={payload}
          disabled={disabled}
          onChange={(event) => store().setPayload(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !disabled) onSubmit();
          }}
          className={cn(FIELD, "min-h-28 resize-y font-mono text-xs")}
        />
        {invalidJson ? (
          <p className="flex items-center gap-1 text-[11px] text-amber-700">
            <AlertTriangle className="size-3" aria-hidden />
            No es JSON válido: se enviará como texto.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function stringify(value: unknown): string {
  if (value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** Informe Markdown de una prueba genérica. */
export function exportGenericReport(result: GenericTraceResult): string {
  const lines = [
    `# ${TRACE_PROFILES[result.profile].label} · ${result.finishedAt}`,
    "",
    result.summary,
    "",
    `- Entrada: ${result.entry?.label ?? "automática"}`,
    `- Latencia total: ${formatLatency(result.totalLatencyMs)}${result.simulated ? " (simulada)" : ""}`,
    `- Nodos: ${result.hops} · Errores: ${result.errors}`,
    "",
    "## Recorrido",
    "",
    "| # | Nodo | Latencia | Detalle |",
    "|---|---|---|---|",
    ...result.stages.map(
      (stage, index) =>
        `| ${index + 1} | ${stageLabel(stage).replace(/\|/g, "\\|")} | ${formatLatency(stage.latencyMs ?? 0)} | ${(stage.detail ?? "").replace(/\|/g, "\\|")} |`,
    ),
    "",
    "## Entrada",
    "",
    "```json",
    result.input,
    "```",
    "",
    "## Salida",
    "",
    "```json",
    stringify(result.output),
    "```",
    "",
  ];
  return lines.join("\n");
}

/** Pestaña "Resultado" de los perfiles genéricos: resumen, recorrido con latencia por nodo y salida. */
export function GenericResultsPanel() {
  const result = usePlaygroundStore((state) => state.traceResult);
  if (!result) {
    return <p className="px-3 py-10 text-center text-sm text-ink-3">Lanza una prueba para ver aquí el recorrido.</p>;
  }
  const hops = routeByNode(result.stages);
  const maxMs = Math.max(1, ...hops.map((hop) => hop.latencyMs));
  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm text-ink">{result.summary}</p>
        <button
          type="button"
          className={BUTTON_SM}
          onClick={() => downloadText(`traza-${result.profile}.md`, exportGenericReport(result), "text/markdown")}
        >
          <Download className="size-3.5" aria-hidden />
          .md
        </button>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-line px-2 py-1.5">
          <dt className={LABEL}>Latencia</dt>
          <dd className="font-mono text-ink">
            {formatLatency(result.totalLatencyMs)}
            {result.simulated ? <span className="text-ink-3"> sim.</span> : null}
          </dd>
        </div>
        <div className="rounded-lg border border-line px-2 py-1.5">
          <dt className={LABEL}>Nodos</dt>
          <dd className="font-mono text-ink">{result.hops}</dd>
        </div>
        <div className="rounded-lg border border-line px-2 py-1.5">
          <dt className={LABEL}>Errores</dt>
          <dd className={cn("font-mono", result.errors > 0 ? "text-rose-700" : "text-ink")}>{result.errors}</dd>
        </div>
      </dl>

      <section className="flex flex-col gap-1.5">
        <h3 className={LABEL}>Recorrido por nodo</h3>
        <ol className="flex flex-col gap-1">
          {hops.map((hop) => (
            <li key={hop.key} className="grid grid-cols-[minmax(0,8rem)_1fr_4rem] items-center gap-2 text-xs">
              <span className="truncate text-ink-2" title={hop.nodeId ?? undefined}>
                {stageLabel(hop.stage)}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-neutral-100" title={hop.stage.detail}>
                <span
                  className={cn("block h-full rounded-full", hop.stage.status === "error" ? "bg-rose-500" : "bg-teal-500")}
                  style={{ width: `${Math.max(2, (hop.latencyMs / maxMs) * 100)}%` }}
                />
              </span>
              <span className="text-right font-mono text-ink">{formatLatency(hop.latencyMs)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className={LABEL}>Salida</h3>
        <pre className="scrollbar-thin max-h-64 overflow-auto rounded-lg border border-line bg-neutral-50 p-2 font-mono text-[11px] text-ink [overflow-wrap:anywhere] whitespace-pre-wrap">
          {stringify(result.output)}
        </pre>
      </section>
    </div>
  );
}
