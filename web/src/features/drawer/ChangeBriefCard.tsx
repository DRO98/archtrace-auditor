"use client";

import { useState } from "react";
import { Check, ClipboardCopy, History } from "lucide-react";
import type { CodeModule } from "@core/graph";
import { useGraphName } from "@/features/canvas/lib/useGraphName";
import { uiLanguage } from "@/lib/i18n/lang";
import { cn } from "@/lib/cn";
import { useBriefSeed } from "./briefStore";
import { addBrief, briefsKey, buildCursorPrompt, countByDepth, parseBriefs, type SavedBrief } from "./lib/changeBrief";

const CARD = "rounded-xl border border-slate-200 bg-white shadow-sm";
const COPIED_MS = 2000;

function readBriefs(graphName: string | null): SavedBrief[] {
  if (!graphName) return [];
  try {
    return parseBriefs(window.localStorage.getItem(briefsKey(graphName)));
  } catch {
    return [];
  }
}

function writeBriefs(graphName: string | null, briefs: readonly SavedBrief[]): void {
  if (!graphName) return;
  try {
    window.localStorage.setItem(briefsKey(graphName), JSON.stringify(briefs));
  } catch {
    // Sin localStorage el brief se copia igual; solo no queda en el historial.
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Brief de cambio: objetivo corto + subgrafo de impacto → prompt pegable en Cursor, acotado a los archivos del
 * blast radius. Montar con `key={origen}` para que el objetivo se reinicie al cambiar de módulo.
 */
export function ChangeBriefCard({
  origin,
  outgoing,
  callers,
  riskLabel,
}: {
  origin: CodeModule;
  outgoing: ReadonlyArray<{ module: CodeModule; depth: number }>;
  callers: readonly CodeModule[];
  riskLabel: string;
}) {
  const graphName = useGraphName();
  const seed = useBriefSeed((state) => (state.seed?.moduleId === origin.id ? state.seed : null));
  const [goal, setGoal] = useState(() => seed?.fixHint ?? "");
  const [briefs, setBriefs] = useState(() => readBriefs(graphName));
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const depths = countByDepth(outgoing);

  function flashCopied(id: string): void {
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), COPIED_MS);
  }

  async function copyPrompt(): Promise<void> {
    const prompt = buildCursorPrompt({
      goal,
      origin,
      outgoing: outgoing.map(({ module, depth }) => ({ label: module.label, filePath: module.filePath, depth })),
      callers,
      riskLabel,
      finding: seed ? { title: seed.title, fixHint: seed.fixHint } : null,
      lang: uiLanguage(),
    });
    const brief: SavedBrief = { id: `${Date.now()}`, createdAt: Date.now(), goal: goal.trim(), originId: origin.id, originLabel: origin.label, prompt };
    const next = addBrief(briefs, brief);
    setBriefs(next);
    writeBriefs(graphName, next);
    if (await copyText(prompt)) {
      setFallback(null);
      flashCopied("current");
    } else {
      setFallback(prompt);
    }
  }

  async function recopy(brief: SavedBrief): Promise<void> {
    if (await copyText(brief.prompt)) flashCopied(brief.id);
    else setFallback(brief.prompt);
  }

  return (
    <section aria-label="Brief de cambio" className={cn(CARD, "flex flex-col gap-2.5 p-3")}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Brief de cambio</h4>
        <p className="text-[11px] tabular-nums text-slate-500" title="Archivos afectados por profundidad">
          {depths.length === 0 ? "Sin dependientes" : depths.map((item) => `n${item.depth}: ${item.count}`).join(" · ")}
          {callers.length > 0 ? ` · ${callers.length} consumidor${callers.length === 1 ? "" : "es"}` : ""}
        </p>
      </div>
      {seed ? (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900" title={seed.title}>
          Desde Architecture Check: <span className="font-medium">{seed.title}</span>
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-600">
        ¿Qué quieres cambiar?
        <input
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          maxLength={200}
          placeholder="p. ej. añadir paginación al listado de pedidos"
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        />
      </label>
      <button
        type="button"
        onClick={() => void copyPrompt()}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {copiedId === "current" ? <Check className="size-3.5" aria-hidden /> : <ClipboardCopy className="size-3.5" aria-hidden />}
        {copiedId === "current" ? "Copiado" : "Copiar prompt para Cursor"}
      </button>
      <p className="text-[11px] leading-snug text-slate-500">
        Acota el cambio a los {outgoing.length + 1} archivos del impacto y protege el contrato de quien lo llama. Sin IA: se genera del grafo.
      </p>
      {fallback ? (
        <label className="flex flex-col gap-1 text-[11px] text-slate-600">
          El navegador no dejó copiar: selecciona el texto y cópialo a mano.
          <textarea readOnly value={fallback} rows={6} onFocus={(event) => event.target.select()} className="rounded-md border border-slate-200 p-2 font-mono text-[10px] text-slate-800" />
        </label>
      ) : null}
      {briefs.length > 0 ? (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900">
            <History className="size-3" aria-hidden />
            Briefs recientes ({briefs.length})
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {briefs.map((brief) => (
              <li key={brief.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-slate-800">{brief.goal || "(sin objetivo)"}</span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {brief.originLabel} · {new Date(brief.createdAt).toLocaleString()}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void recopy(brief)}
                  title="Copiar de nuevo"
                  aria-label={`Copiar de nuevo el brief «${brief.goal || brief.originLabel}»`}
                  className="grid size-6 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                  {copiedId === brief.id ? <Check className="size-3.5" aria-hidden /> : <ClipboardCopy className="size-3.5" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
