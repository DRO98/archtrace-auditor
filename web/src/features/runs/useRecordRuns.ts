"use client";

import { useEffect } from "react";
import { stageLabel } from "@/features/playground/lib/exportRunReport";
import { usePlaygroundStore } from "@/features/playground/store";
import { buildRunRecord } from "./lib/runLog";
import { useRunLog } from "./store";

const INPUT_LIMIT = 2_000;
const clip = (text: string): string => (text.length > INPUT_LIMIT ? `${text.slice(0, INPUT_LIMIT - 1)}…` : text);

/**
 * Guarda en el historial cada prueba (RAG, HTTP, evento) que termina bien en el pipeline `graphName`.
 * Se engancha a la transición `running → done` con resultado: una cancelada o fallida no se registra.
 */
export function useRecordRuns(graphName: string): void {
  useEffect(() => {
    let lastRecorded: string | null = null;
    return usePlaygroundStore.subscribe((state, prev) => {
      if (state.status !== "done" || prev.status !== "running") return;
      const generic = state.traceResult;
      if (state.profile !== "rag" && generic) {
        if (generic.finishedAt === lastRecorded) return;
        lastRecorded = generic.finishedAt;
        useRunLog.getState().record(
          buildRunRecord({
            profile: generic.profile,
            graphName,
            finishedAt: generic.finishedAt,
            question: clip(generic.input),
            answer: clip(typeof generic.output === "string" ? generic.output : JSON.stringify(generic.output ?? null, null, 2)),
            provider: generic.simulated ? "simulado" : "http",
            model: generic.simulated ? "latencias simuladas" : "petición real",
            demo: state.demo !== null,
            entryLabel: generic.entry?.label ?? null,
            stages: generic.stages.map((stage) => ({ ...stage, label: stageLabel(stage) })),
            costUsd: null,
          }),
        );
        return;
      }
      if (!state.result) return;
      const result = state.result;
      if (result.finishedAt === lastRecorded) return;
      lastRecorded = result.finishedAt;
      useRunLog.getState().record(
        buildRunRecord({
          graphName,
          finishedAt: result.finishedAt,
          question: result.question,
          answer: result.answer,
          provider: result.provider,
          model: result.model,
          demo: state.demo !== null,
          entryLabel: result.entry?.label ?? null,
          stages: result.stages.map((stage) => ({ ...stage, label: stageLabel(stage) })),
          usage: result.usage,
          costUsd: result.costUsd,
          chunks: result.chunks,
        }),
      );
    });
  }, [graphName]);
}
