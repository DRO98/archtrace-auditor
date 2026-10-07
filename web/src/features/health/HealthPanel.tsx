"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, Crosshair, ScanSearch, XCircle, type LucideIcon } from "lucide-react";
import { useCanvasStore } from "@/features/canvas/store";
import { cn } from "@/lib/cn";
import { SLA_THRESHOLDS, type NodeHealth } from "./lib/sla";
import { useHealth } from "./store";

const SECTION = "text-[11px] font-semibold uppercase tracking-wide text-ink-3";
/** La barra llega al final en 2× el umbral: la marca del umbral queda siempre a mitad de la pista. */
const BAR_SCALE = 2;

function spotlightModule(moduleId: string): void {
  const canvas = useCanvasStore.getState();
  canvas.selectModule(moduleId);
  canvas.spotlight(moduleId);
}

/** Número de alertas de SLA para el punto rojo del botón de la barra lateral (el drift cuenta en Architecture Check). */
export function useHealthAlertCount(): number {
  return useHealth((state) => state.alerts.length);
}

function ThresholdChip({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-neutral-50 px-2 py-0.5 text-[11px] text-ink-2">
      <Icon className="size-3 text-ink-3" aria-hidden />
      {children}
    </span>
  );
}

/** Valor frente a su umbral: pista con marca en el umbral, relleno rojo si lo supera y verde si no. */
function MetricBar({ label, value, threshold, format }: { label: string; value: number; threshold: number; format: (value: number) => string }) {
  const breach = value > threshold;
  const fill = Math.min(1, value / (threshold * BAR_SCALE));
  const ratio = threshold > 0 ? value / threshold : 0;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-ink-3">{label}</span>
        <span className={cn("font-mono tabular-nums", breach ? "font-semibold text-rose-700" : "text-ink-2")}>
          {format(value)}
          {breach ? <span className="ml-1 font-sans font-normal text-rose-600">×{ratio.toFixed(1)}</span> : null}
        </span>
      </div>
      <div
        className="relative h-1.5 overflow-hidden rounded-full bg-neutral-100"
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={threshold * BAR_SCALE}
      >
        <div className={cn("h-full rounded-full", breach ? "bg-rose-500" : "bg-emerald-500")} style={{ width: `${fill * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-ink/50" style={{ left: `${100 / BAR_SCALE}%` }} aria-hidden />
      </div>
    </div>
  );
}

function AlertCard({ item }: { item: NodeHealth }) {
  const errors = item.breaches.includes("errors");
  return (
    <li className={cn("flex flex-col gap-2 rounded-lg border border-l-[3px] border-line bg-white px-2.5 py-2", errors ? "border-l-rose-500" : "border-l-amber-500")}>
      <div className="flex items-center gap-2">
        <AlertTriangle className={cn("size-3.5 shrink-0", errors ? "text-rose-600" : "text-amber-600")} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-ink">{item.label}</span>
          <span className="block text-[10px] text-ink-3">
            {item.samples} {item.samples === 1 ? "ejecución" : "ejecuciones"} · pico {Math.round(item.maxLatencyMs)} ms
          </span>
        </span>
        <button
          type="button"
          aria-label={`Destacar ${item.label} en el lienzo`}
          onClick={() => spotlightModule(item.nodeId)}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-[11px] text-ink-2 hover:bg-neutral-100"
        >
          <Crosshair className="size-3" aria-hidden />
          Destacar
        </button>
      </div>
      <MetricBar label="Latencia media" value={item.avgLatencyMs} threshold={SLA_THRESHOLDS.latencyMs} format={(ms) => `${Math.round(ms)} ms`} />
      <MetricBar label="Errores" value={item.errorRate} threshold={SLA_THRESHOLDS.errorRate} format={(rate) => `${(rate * 100).toFixed(1)} %`} />
    </li>
  );
}

/**
 * Rendimiento: nodos que incumplen el SLA según el Tracing Log (latencia media > 1000 ms o errores > 1 %).
 * Cada alerta enseña sus métricas frente al umbral. Los nodos con alerta también se marcan en el lienzo;
 * el drift con el código vive en Architecture Check.
 */
export function HealthPanel() {
  const alerts = useHealth((state) => state.alerts);

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 overflow-x-hidden p-3">
      <section className="flex flex-col gap-2" aria-labelledby="sla-title">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 id="sla-title" className={cn(SECTION, "mr-auto")}>
            Umbrales
          </h3>
          <ThresholdChip icon={Clock}>Latencia &gt; {SLA_THRESHOLDS.latencyMs} ms</ThresholdChip>
          <ThresholdChip icon={XCircle}>Errores &gt; {SLA_THRESHOLDS.errorRate * 100} %</ThresholdChip>
        </div>
        {alerts.length === 0 ? (
          <p className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2 text-xs text-emerald-900">
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
            Ningún nodo supera los umbrales en el Tracing Log de este pipeline.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {alerts.map((item) => (
              <AlertCard key={item.nodeId} item={item} />
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={() => useCanvasStore.getState().setPopover("check")}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line px-3 text-xs text-ink-2 hover:bg-neutral-50 hover:text-ink"
      >
        <ScanSearch className="size-3.5" aria-hidden />
        Ver drift y hallazgos en Architecture Check
      </button>
    </div>
  );
}
