"use client";

import { useMemo, type ReactNode } from "react";
import { AlertTriangle, Info, Target, Zap } from "lucide-react";
import type { ExecutionFlowScenario, StepMetrics } from "@core/simulation";
import { cn } from "@/lib/cn";
import {
  aggregateMetrics,
  componentMetrics,
  contextScoreTone,
  formatLatency,
  formatTokens,
  latencyTone,
  metricExtension,
  type MetricTone,
} from "../lib/metrics";

const TEXT_TONE: Record<MetricTone, string> = {
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-rose-700",
};

/** Celda compacta de la rejilla de KPIs de la pestaña Impacto: etiqueta, valor y detalle en una línea. */
export function KpiCell({
  label,
  children,
  detail,
  hint,
}: {
  label: string;
  children: ReactNode;
  detail?: ReactNode;
  /** Nota secundaria: se muestra como tooltip en un icono Info en lugar de ocupar una línea. */
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        <span className="truncate">{label}</span>
        {hint ? (
          <span title={hint} className="inline-flex shrink-0 cursor-help text-slate-400 hover:text-slate-600">
            <Info className="size-3" aria-hidden />
            <span className="sr-only">{hint}</span>
          </span>
        ) : null}
      </dt>
      <dd className="flex min-w-0 items-center gap-1 text-sm font-semibold tabular-nums text-slate-900">{children}</dd>
      {detail ? <dd className="truncate text-[10px] tabular-nums text-slate-500">{detail}</dd> : null}
    </div>
  );
}

/**
 * Coste y rendimiento de un componente en un escenario como celdas KPI (latencia, tokens, relevancia),
 * para componer junto al riesgo en la cabecera de la pestaña Impacto.
 */
export function ComponentMetricsKpis({
  scenario,
  nodeId,
}: {
  scenario: ExecutionFlowScenario;
  nodeId: string;
}) {
  const metrics = useMemo(() => componentMetrics(scenario, nodeId), [scenario, nodeId]);
  if (!metrics) return null;
  const share = metrics.flowLatencyMs > 0 ? Math.round((metrics.latencyMs / metrics.flowLatencyMs) * 100) : null;

  return (
    <>
      <KpiCell
        label="Latencia"
        hint={`Escenario «${scenario.name}» · flujo total ${formatLatency(metrics.flowLatencyMs)} · valores ilustrativos, no medidos en una ejecución real.`}
        detail={share !== null ? `${share} % del flujo` : undefined}>
        <Zap className={cn("size-3.5 shrink-0", TEXT_TONE[latencyTone(metrics.latencyMs)])} aria-hidden />
        <span className={TEXT_TONE[latencyTone(metrics.latencyMs)]}>{formatLatency(metrics.latencyMs)}</span>
      </KpiCell>
      {metrics.errorSteps > 0 ? (
        <KpiCell label="Errores" detail={`${metrics.errorSteps} de ${metrics.measuredSteps} pasos`}>
          <AlertTriangle className="size-3.5 shrink-0 text-rose-700" aria-hidden />
          <span className="text-rose-700">{metrics.errorSteps}</span>
        </KpiCell>
      ) : null}
      {metrics.hasRagExtensions ? (
        <>
          <KpiCell label="Tokens" detail="prompt / gen.">
            <span className="truncate">
              {formatTokens(metrics.tokenCount.prompt)} / {formatTokens(metrics.tokenCount.generation)}
            </span>
          </KpiCell>
          <KpiCell label="Relevancia" detail="contexto">
            {metrics.contextScore !== null ? (
              <>
                <Target className={cn("size-3.5 shrink-0", TEXT_TONE[contextScoreTone(metrics.contextScore)])} aria-hidden />
                <span className={TEXT_TONE[contextScoreTone(metrics.contextScore)]}>{metrics.contextScore.toFixed(2)}</span>
              </>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </KpiCell>
        </>
      ) : null}
    </>
  );
}

/**
 * Tarjeta agregada del escenario: latencia total, errores y, si el perfil las declara,
 * tokens (con relevancia media en el detalle). Tres celdas para caber en el drawer estrecho.
 */
export function FlowMetricsCard({ scenario }: { scenario: ExecutionFlowScenario }) {
  const metrics = useMemo(() => aggregateMetrics(scenario), [scenario]);
  if (metrics.measuredSteps === 0) return null;
  return (
    <section aria-label="Métricas del flujo" className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Métricas del flujo</h3>
      <dl className={cn("grid gap-1.5", metrics.hasRagExtensions ? "grid-cols-3" : "grid-cols-2")}>
        <KpiCell
          label="Latencia"
          hint="Suma de los pasos con métricas · valores ilustrativos, no medidos en una ejecución real."
          detail={`${metrics.measuredSteps} de ${scenario.steps.length} pasos`}
        >
          <Zap className={cn("size-3.5 shrink-0", TEXT_TONE[latencyTone(metrics.latencyMs.total)])} aria-hidden />
          <span className={TEXT_TONE[latencyTone(metrics.latencyMs.total)]}>{formatLatency(metrics.latencyMs.total)}</span>
        </KpiCell>
        <KpiCell label="Errores" detail={metrics.errorSteps > 0 ? "pasos fallidos" : "sin fallos"}>
          {metrics.errorSteps > 0 ? <AlertTriangle className="size-3.5 shrink-0 text-rose-700" aria-hidden /> : null}
          <span className={metrics.errorSteps > 0 ? "text-rose-700" : undefined}>{metrics.errorSteps}</span>
        </KpiCell>
        {metrics.hasRagExtensions ? (
          <KpiCell
            label="Tokens"
            detail={metrics.contextScore !== null ? `contexto ${metrics.contextScore.toFixed(2)}` : undefined}
          >
            <span className="truncate">{formatTokens(metrics.tokenCount.total)}</span>
          </KpiCell>
        ) : null}
      </dl>
    </section>
  );
}

/** Métricas del paso en una línea (latencia + contexto), junto al texto de conexión. */
export function StepMetricsInline({ metrics }: { metrics: StepMetrics }) {
  const contextScore = metricExtension(metrics, "contextScore");
  return (
    <span
      aria-label="Métricas del paso"
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold tabular-nums"
    >
      <span title="Latencia del paso" className={cn("inline-flex items-center gap-0.5", TEXT_TONE[latencyTone(metrics.latencyMs)])}>
        <Zap className="size-3" aria-hidden />
        {formatLatency(metrics.latencyMs)}
      </span>
      {contextScore !== null ? (
        <>
          <span className="text-slate-300" aria-hidden>
            ·
          </span>
          <span
            title="Relevancia del contexto"
            className={cn("inline-flex items-center gap-0.5", TEXT_TONE[contextScoreTone(contextScore)])}
          >
            <Target className="size-3" aria-hidden />
            Contexto {contextScore.toFixed(2)}
          </span>
        </>
      ) : null}
      {metrics.error ? (
        <>
          <span className="text-slate-300" aria-hidden>
            ·
          </span>
          <span title={metrics.error} className="inline-flex items-center gap-0.5 text-rose-700">
            <AlertTriangle className="size-3" aria-hidden />
            Error
          </span>
        </>
      ) : null}
    </span>
  );
}
