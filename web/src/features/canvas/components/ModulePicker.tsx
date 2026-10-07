"use client";

import { useEffect, useMemo, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { Search } from "lucide-react";
import type { CodeModule } from "@core/graph";
import { cn } from "@/lib/cn";
import { useMotionDuration } from "@/lib/motion";
import { inferRole } from "../lib/architecture";
import { FIT_NODE_DURATION_MS, fitNode } from "../lib/fitNode";
import { matchModules } from "../lib/search";
import { useCanvasStore } from "../store";
import { GROUP_STYLES, ROLE_TONE } from "../theme";
import { ModuleIcon } from "../nodes/ModuleIcon";

export function ModulePicker() {
  const graph = useCanvasStore((state) => state.graph);
  const indexes = useCanvasStore((state) => state.indexes);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { fitView } = useReactFlow();
  const duration = useMotionDuration(FIT_NODE_DURATION_MS);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(draft);
      setActive(0);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const rows = useMemo(() => {
    if (!graph || !indexes) return [];
    const match = matchModules(indexes, { query, groups: new Set(), kinds: new Set() });
    const allowed = match?.modules ?? null;
    const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length > 0);
    const grouped: Array<{ groupId: string; label: string; color: (typeof graph.groups)[number]["color"]; items: CodeModule[] }> = [];
    for (const group of graph.groups) {
      const items = graph.modules.filter(
        (item) => item.groupId === group.id && (allowed === null || allowed.has(item.id)),
      );
      if (items.length === 0) continue;
      grouped.push({ groupId: group.id, label: group.label, color: group.color, items });
    }
    return grouped.flatMap((group) =>
      group.items.map((item) => ({
        item,
        groupLabel: group.label,
        color: group.color,
        hits:
          tokens.length === 0
            ? []
            : item.subBlocks
                .filter((block) => tokens.some((token) => block.name.toLowerCase().includes(token)))
                .slice(0, 2)
                .map((block) => block.name),
      })),
    );
  }, [graph, indexes, query]);

  function choose(id: string): void {
    useCanvasStore.getState().selectModule(id);
    fitNode(fitView, id, duration);
    useCanvasStore.getState().setPopover(null);
  }

  return (
    <div
      className="flex flex-col"
      onKeyDown={(event) => {
        if (rows.length === 0) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((index) => (index + 1) % rows.length);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((index) => (index - 1 + rows.length) % rows.length);
        } else if (event.key === "Enter") {
          event.preventDefault();
          const row = rows[active];
          if (row) choose(row.item.id);
        }
      }}
    >
      <label className="flex items-center gap-2 border-b border-line px-3">
        <Search className="size-4 text-ink-3" aria-hidden />
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Buscar módulo"
          className="h-10 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
      </label>
      <div className="max-h-80 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-ink-3">No hay módulos que coincidan</p>
        ) : (
          rows.map((row, index) => {
            const role = row.item.role ?? inferRole(row.item);
            const showHeader = index === 0 || rows[index - 1]?.groupLabel !== row.groupLabel;
            return (
              <div key={row.item.id}>
                {showHeader ? (
                  <p className="flex items-center gap-2 px-2 pb-1 pt-2 text-xs font-medium text-ink-3">
                    <span className={cn("size-2 rounded-full", GROUP_STYLES[row.color].dot)} aria-hidden />
                    {row.groupLabel}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => choose(row.item.id)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                    index === active ? "bg-neutral-100" : "hover:bg-neutral-50",
                  )}
                >
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", ROLE_TONE[role].tile)} aria-hidden>
                    <ModuleIcon role={role} filePath={row.item.filePath} className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{row.item.label}</span>
                    {row.hits.length > 0 ? (
                      <span className="block truncate text-xs text-ink-2">{row.hits.join(" · ")}</span>
                    ) : null}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
