"use client";

import type { SubBlockKind } from "@core/graph";
import { cn } from "@/lib/cn";
import { KIND_ICON } from "@/features/drawer/kindIcons";
import { useCanvasStore } from "../store";
import { GROUP_STYLES } from "../theme";

const KINDS: readonly SubBlockKind[] = ["class", "function", "method", "block"];

export function FiltersPanel() {
  const graph = useCanvasStore((state) => state.graph);
  const groupFilter = useCanvasStore((state) => state.groupFilter);
  const kindFilter = useCanvasStore((state) => state.kindFilter);
  const match = useCanvasStore((state) => state.match);
  if (!graph) return null;

  const counts = new Map<string, number>();
  for (const item of graph.modules) {
    counts.set(item.groupId, (counts.get(item.groupId) ?? 0) + 1);
  }
  const shown = match === null ? graph.modules.length : match.modules.size;

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold text-ink">Filtros</h2>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-ink-3">Grupos</h3>
        <div className="flex flex-wrap gap-1.5">
          {graph.groups.map((group) => {
            const pressed = groupFilter.has(group.id);
            return (
              <button
                key={group.id}
                type="button"
                aria-pressed={pressed}
                onClick={() => useCanvasStore.getState().toggleGroup(group.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs",
                  pressed ? GROUP_STYLES[group.color].chip : "border-line text-ink-2 hover:bg-neutral-50",
                )}
              >
                <span className={cn("size-2 rounded-full", GROUP_STYLES[group.color].dot)} aria-hidden />
                {group.label}
                <span className="font-mono text-[10px]">{counts.get(group.id) ?? 0}</span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-ink-3">Tipo de bloque</h3>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((kind) => {
            const Icon = KIND_ICON[kind];
            const pressed = kindFilter.has(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={pressed}
                onClick={() => useCanvasStore.getState().toggleKind(kind)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
                  pressed ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:bg-neutral-50",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {kind}
              </button>
            );
          })}
        </div>
      </section>
      <div className="flex items-center justify-between border-t border-line pt-3">
        <p className="text-xs text-ink-2">
          {shown} / {graph.modules.length} módulos
        </p>
        <button
          type="button"
          onClick={() => useCanvasStore.getState().clearFilters()}
          className="text-xs font-medium text-ink hover:underline"
        >
          Restablecer filtros
        </button>
      </div>
    </div>
  );
}
