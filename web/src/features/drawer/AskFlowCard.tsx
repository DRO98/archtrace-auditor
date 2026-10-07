"use client";

import { useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { aiSelection, useAiSettings } from "@/lib/ai/settings";
import { uiLanguage } from "@/lib/i18n/lang";
import { buildLevel0 } from "@/features/canvas/lib/level0";
import { prepareGraph } from "@/features/canvas/lib/subsystems";
import { useCanvasStore } from "@/features/canvas/store";
import { startSimulation } from "@/features/simulation/lib/actions";
import { scenarioFromBlockIds } from "@/features/simulation/lib/systemScenario";
import { useSimStore } from "@/features/simulation/store";

/**
 * Pide a la IA un recorrido custom sobre los servicios del mapa y lo añade a la lista de escenarios.
 */
export function AskFlowCard() {
  const graph = useCanvasStore((state) => state.graph);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = useAiSettings((state) => state.provider);

  const level0 = useMemo(() => (graph ? buildLevel0(prepareGraph(graph)) : null), [graph]);
  const system = level0?.style === "system";

  if (!graph || !level0 || !system) return null;

  const submit = async () => {
    const trimmed = goal.trim();
    if (trimmed.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ai = aiSelection();
      const response = await fetch("/api/flow-scenario", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: trimmed,
          lang: uiLanguage(),
          ai,
          services: level0.blocks.map((block) => ({
            id: block.id,
            label: block.label,
            role: block.role,
            kind: block.kind,
          })),
        }),
      });
      const body = (await response.json()) as { plan?: { name: string; description: string; blockIds: string[] }; error?: string };
      if (!response.ok || !body.plan) {
        setError(body.error ?? "No se pudo generar el recorrido.");
        return;
      }
      const scenario = scenarioFromBlockIds(
        level0,
        graph,
        body.plan.blockIds,
        {
          id: `ai-flow-${Date.now()}`,
          name: body.plan.name,
          description: body.plan.description,
        },
        uiLanguage(),
      );
      if (!scenario) {
        setError("La IA eligió servicios que no encajan en el mapa.");
        return;
      }
      const current = useSimStore.getState().scenarios;
      useSimStore.getState().setScenarios([...current.filter((item) => item.id !== scenario.id), scenario], null);
      setGoal("");
      startSimulation(scenario.id);
    } catch {
      setError("Error de red al pedir el recorrido.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl border border-dashed border-line bg-neutral-50/80 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700" aria-hidden>
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-ink">Pedir recorrido a la IA</h3>
          <p className="mt-1 text-sm leading-5 text-ink-2">
            Describe el flujo que quieres ver (p. ej. «desde gestos hasta la respuesta del chatbot RAG») y lo arma sobre los
            servicios del mapa.
          </p>
          <label className="mt-3 block">
            <span className="sr-only">Qué recorrido generar</span>
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={2}
              placeholder="Ej.: Cómo llega un gesto de freno hasta Ollama"
              className="w-full resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600"
            />
          </label>
          {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
          {provider === null ? (
            <p className="mt-2 text-xs text-ink-3">Si no hay clave en el servidor, elige un proveedor BYOK en Ajustes.</p>
          ) : null}
          <button
            type="button"
            disabled={busy || goal.trim().length < 4}
            onClick={() => void submit()}
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-violet-700 px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-800 disabled:pointer-events-none disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
            Generar y simular
          </button>
        </div>
      </div>
    </li>
  );
}
