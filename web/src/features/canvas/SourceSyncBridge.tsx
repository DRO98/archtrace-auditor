"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import type { SourceFilesChangedPayload } from "@core/protocol";
import { useSourceFilesChanged } from "@/hooks/useTeacherSocket";
import { useLessonStore } from "@/features/lesson/store";
import { cn } from "@/lib/cn";
import { affectedModules, rebuildFromMap } from "./lib/sourceSync";
import { useCanvasStore } from "./store";

type Notice =
  | { phase: "syncing"; label: string }
  | { phase: "done"; label: string; patched: number; added: number; edges: number }
  | { phase: "error"; label: string; message: string };

const DONE_HIDE_MS = 3000;
const ERROR_HIDE_MS = 6000;

function describePaths(paths: readonly string[]): string {
  const [first] = paths;
  if (!first) return "";
  return paths.length === 1 ? first : `${first} y ${paths.length - 1} más`;
}

function describeRebuild({ patched, added, edges }: { patched: number; added: number; edges: number }): string {
  const parts = [
    patched > 0 ? (patched === 1 ? "1 módulo" : `${patched} módulos`) : null,
    added > 0 ? (added === 1 ? "1 nuevo" : `${added} nuevos`) : null,
    edges > 0 ? (edges === 1 ? "1 conexión" : `${edges} conexiones`) : null,
  ].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(" · ")})` : "";
}

/**
 * Escucha `SOURCE_FILES_CHANGED` del IDE: avisa con un banner, invalida lecciones afectadas, vuelve a pedir
 * el mapa del proyecto y reconstruye parcialmente el grafo (`rebuildFromMap`): sub-bloques con los rangos
 * nuevos, módulos para archivos nuevos y aristas de imports/llamadas que aparecen o desaparecen.
 */
export function SourceSyncBridge() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const sequence = useRef(0);

  useSourceFilesChanged((change: SourceFilesChangedPayload) => {
    const run = ++sequence.current;
    const label = describePaths(change.changedPaths);
    setNotice({ phase: "syncing", label });

    const lessons = useLessonStore.getState();
    lessons.invalidateSources(change.changedPaths);

    void lessons
      .refreshMap({ quiet: true })
      .then((map) => {
        if (run !== sequence.current) return;
        const graph = useCanvasStore.getState().graph;
        let patched = 0;
        let added = 0;
        let edges = 0;
        const affected = graph ? affectedModules(graph, change.changedPaths) : [];
        const rebuilt = map && graph ? rebuildFromMap(graph, map, change.changedPaths) : null;
        if (rebuilt) {
          // El lienzo lee el grafo del store: la reconstrucción parcial lo vuelve a pintar sin recargar la página.
          useCanvasStore.getState().applyGraphPatch(rebuilt.graph);
          patched = rebuilt.patched.length;
          added = rebuilt.added.length;
          edges = rebuilt.addedEdges.length + rebuilt.removedEdges.length;
        }
        useCanvasStore.getState().markSynced([...affected.map((item) => item.id), ...(rebuilt?.added ?? [])]);
        setNotice({ phase: "done", label, patched, added, edges });
      })
      .catch((error: unknown) => {
        if (run !== sequence.current) return;
        const message = error instanceof Error ? error.message : "No se pudo refrescar el análisis.";
        setNotice({ phase: "error", label, message });
      });
  });

  useEffect(() => {
    if (!notice || notice.phase === "syncing") return;
    const id = window.setTimeout(() => setNotice(null), notice.phase === "done" ? DONE_HIDE_MS : ERROR_HIDE_MS);
    return () => window.clearTimeout(id);
  }, [notice]);

  if (!notice) return null;

  const tone =
    notice.phase === "error"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-sky-200 bg-sky-50 text-sky-900";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed left-1/2 top-16 z-30 w-[min(32rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border px-3 py-2 text-sm shadow-md",
        tone,
      )}
    >
      <div className="flex items-start gap-2">
        {notice.phase === "syncing" ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
        ) : notice.phase === "done" ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          Código actualizado en <span className="font-mono text-xs">{notice.label}</span>
          {" — "}
          {notice.phase === "syncing" ? (
            "Refrescando análisis…"
          ) : notice.phase === "done" ? (
            `Análisis actualizado${describeRebuild(notice)}.`
          ) : (
            <>No se pudo refrescar: {notice.message}</>
          )}
        </p>
        {notice.phase === "syncing" ? null : (
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setNotice(null)}
            className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-black/5"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
