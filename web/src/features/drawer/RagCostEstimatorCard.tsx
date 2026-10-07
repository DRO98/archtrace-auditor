"use client";

import { useId, useState } from "react";
import { Calculator, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePlaygroundStore } from "@/features/playground/store";
import {
  DEFAULT_MONTHLY_REQUESTS,
  FALLBACK_USAGE,
  RAG_COST_MODELS,
  estimateRagCost,
  formatUsd,
} from "@/lib/ai/ragCostEstimator";

const CARD = "rounded-xl border border-slate-200 bg-white shadow-sm";
const LABEL = "flex min-w-0 flex-col gap-0.5 text-[10px] font-medium text-slate-600";
const INPUT = "h-7 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs tabular-nums text-slate-900 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-500/30";

function toCount(raw: string): number {
  const value = Number(raw.replace(/[^\d]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/**
 * "Estimador de Costes de Operación RAG": coste mensual a partir de los tokens de la última
 * ejecución del playground/demo. Todo se calcula en React, en el navegador; ninguna cifra sale de él.
 */
export function RagCostEstimatorCard() {
  const usage = usePlaygroundStore((state) => state.result?.usage ?? null);
  const [modelId, setModelId] = useState(RAG_COST_MODELS[0]?.id ?? "");
  const [requests, setRequests] = useState(DEFAULT_MONTHLY_REQUESTS);
  // null = seguir el uso capturado en la ejecución; un número = el usuario lo ajustó a mano.
  const [promptOverride, setPromptOverride] = useState<number | null>(null);
  const [completionOverride, setCompletionOverride] = useState<number | null>(null);
  // Cada ejecución nueva de "Probar en vivo" vuelve a rellenar los tokens: descarta los ajustes manuales.
  const [seenUsage, setSeenUsage] = useState(usage);
  if (usage !== seenUsage) {
    setSeenUsage(usage);
    setPromptOverride(null);
    setCompletionOverride(null);
  }
  const ids = { model: useId(), requests: useId(), prompt: useId(), completion: useId() };

  const base = usage ?? FALLBACK_USAGE;
  const tokens = {
    promptTokens: promptOverride ?? base.promptTokens,
    completionTokens: completionOverride ?? base.completionTokens,
  };
  const source = promptOverride !== null || completionOverride !== null
    ? "ajustado a mano"
    : usage
      ? `capturado en la última ejecución${usage.estimated ? " (estimado)" : ""}`
      : "consulta RAG típica · usa «Probar en vivo» para tokens reales";

  const rows = RAG_COST_MODELS.map((model) => ({ model, estimate: estimateRagCost(tokens, model.price, requests) }));
  const selected = rows.find((row) => row.model.id === modelId) ?? rows[0];
  const max = Math.max(...rows.map((row) => row.estimate.totalUsd), 0);
  if (!selected) return null;
  const { estimate } = selected;
  const inputShare = estimate.totalUsd > 0 ? (estimate.inputUsd / estimate.totalUsd) * 100 : 0;

  return (
    <section className={cn(CARD, "flex flex-col gap-2.5 p-3")} aria-labelledby={`${ids.model}-title`}>
      <header className="flex items-center gap-2">
        <Calculator className="size-3.5 shrink-0 text-slate-500" aria-hidden />
        <h3 id={`${ids.model}-title`} className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
          Estimador de costes RAG
        </h3>
        <span
          title="Calculado en tu navegador; ninguna métrica sale de él. Precios públicos aproximados; no incluye embeddings ni caché."
          className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-medium leading-4 text-emerald-700"
        >
          <Lock className="size-2.5" aria-hidden />
          Cálculos 100% locales
        </span>
      </header>

      <div className="flex flex-col gap-1.5">
        <select
          id={ids.model}
          aria-label="Proveedor / modelo"
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          className={INPUT}
        >
          {RAG_COST_MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.provider} · {model.label}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label htmlFor={ids.prompt} className={LABEL}>
            prompt_tokens
            <input id={ids.prompt} inputMode="numeric" value={tokens.promptTokens} onChange={(event) => setPromptOverride(toCount(event.target.value))} className={INPUT} />
          </label>
          <label htmlFor={ids.completion} className={LABEL}>
            completion_tokens
            <input id={ids.completion} inputMode="numeric" value={tokens.completionTokens} onChange={(event) => setCompletionOverride(toCount(event.target.value))} className={INPUT} />
          </label>
          <label htmlFor={ids.requests} className={LABEL}>
            Peticiones/mes
            <input id={ids.requests} inputMode="numeric" value={requests} onChange={(event) => setRequests(toCount(event.target.value))} className={INPUT} />
          </label>
        </div>
        <p className="flex items-center gap-1 text-[10px] text-slate-500">
          <span className="truncate">Tokens: {source}</span>
          {promptOverride !== null || completionOverride !== null ? (
            <button
              type="button"
              onClick={() => {
                setPromptOverride(null);
                setCompletionOverride(null);
              }}
              className="shrink-0 font-medium text-teal-700 underline"
            >
              restablecer
            </button>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-3">
        <div className="min-w-0 rounded-lg bg-slate-50 px-2.5 py-2">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">Coste / mes</p>
          <p className="truncate text-xl font-semibold tabular-nums text-slate-900">{formatUsd(estimate.totalUsd)}</p>
          <p
            className="truncate text-[10px] tabular-nums text-slate-500"
            title={`Entrada ${formatUsd(estimate.inputUsd)} (${Math.round(inputShare)} %) · salida ${formatUsd(estimate.outputUsd)} · ${requests.toLocaleString("es-ES")} peticiones`}
          >
            {formatUsd(estimate.perRequestUsd)} / petición
          </p>
        </div>

        <ul aria-label="Comparativa al mismo volumen" className="flex min-w-0 flex-col gap-1">
          {rows.map(({ model, estimate: row }) => {
            const active = model.id === selected.model.id;
            const width = max > 0 ? Math.max(1.5, (row.totalUsd / max) * 100) : 0;
            return (
              <li key={model.id}>
                <button
                  type="button"
                  onClick={() => setModelId(model.id)}
                  title={`${model.provider} · ${model.label}: ${formatUsd(row.totalUsd)} al mes ($${model.price.input} / $${model.price.output} por millón de tokens entrada/salida)`}
                  aria-pressed={active}
                  className="grid w-full grid-cols-[minmax(0,4.5rem)_1fr_auto] items-center gap-1.5 rounded px-0.5 text-left hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
                >
                  <span className={cn("truncate text-[11px]", active ? "font-semibold text-slate-900" : "text-slate-600")}>{model.label}</span>
                  <span className="h-1.5 rounded-full bg-slate-100" aria-hidden>
                    <span
                      className={cn("block h-1.5 rounded-full", active ? "bg-teal-600" : "bg-teal-300")}
                      style={{ width: `${width}%` }}
                    />
                  </span>
                  <span className="text-right text-[11px] tabular-nums text-slate-900">{formatUsd(row.totalUsd)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
