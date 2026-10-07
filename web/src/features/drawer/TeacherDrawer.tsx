"use client";

import { useEffect, useRef } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { X, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMotionDuration } from "@/lib/motion";
import { inferRole } from "@/features/canvas/lib/architecture";
import { FIT_NODE_DURATION_MS, fitNode } from "@/features/canvas/lib/fitNode";
import { describeModule } from "@/features/canvas/lib/describe";
import { useCanvasStore, type DrawerTab } from "@/features/canvas/store";
import { ModuleIcon } from "@/features/canvas/nodes/ModuleIcon";
import { RIGHT_PANEL_CLASS, ROLE_TONE } from "@/features/canvas/theme";
import { probeFromNode } from "@/features/playground/hooks/usePlaygroundTrace";
import { useActiveScenario, useSimStore } from "@/features/simulation/store";
import { CodeTab } from "./CodeTab";
import { FlowTab } from "./FlowTab";
import { ImpactTab } from "./ImpactTab";
import { LessonTab } from "./LessonTab";

const TABS: ReadonlyArray<{ id: DrawerTab; label: string }> = [
  { id: "code", label: "Código" },
  { id: "lesson", label: "Lección" },
  { id: "impact", label: "Impacto" },
  { id: "flow", label: "Flujo" },
];

export function TeacherDrawer() {
  const open = useCanvasStore((state) => state.drawer.open);
  const tab = useCanvasStore((state) => state.drawer.tab);
  const moduleId = useCanvasStore((state) => state.drawer.moduleId);
  const indexes = useCanvasStore((state) => state.indexes);
  const codeModule = moduleId ? (indexes?.modulesById.get(moduleId) ?? null) : null;
  const scenarioCount = useSimStore((state) => state.scenarios.length);
  const scenario = useActiveScenario();
  const stepIndex = useSimStore((state) => state.stepIndex);
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { fitView } = useReactFlow();
  const edges = useStore((state) => state.edges);
  const duration = useMotionDuration(FIT_NODE_DURATION_MS);

  useEffect(() => {
    if (!open || !moduleId) return;
    // Con una simulación en marcha la cámara la lleva SimulationBridge: encuadrar aquí la haría saltar.
    if (useSimStore.getState().activeScenarioId !== null) return;
    const timer = window.setTimeout(() => {
      fitNode(fitView, moduleId, duration);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [open, moduleId, fitView, duration]);

  useEffect(() => {
    if (!open) return;
    if (closeRef.current) closeRef.current.focus();
    else asideRef.current?.focus();
  }, [open, moduleId]);

  if (!open) return null;

  const flowModule =
    tab === "flow" && scenario
      ? (indexes?.modulesById.get(scenario.steps[stepIndex]?.nodeId ?? "") ?? null)
      : null;
  const headerModule = flowModule ?? codeModule;
  const role = headerModule ? (headerModule.role ?? inferRole(headerModule)) : null;
  const subtitle = headerModule && role ? describeModule(headerModule, role) : "";
  const visibleTabs = TABS.filter((item) => item.id !== "flow" || scenarioCount > 0);

  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      aria-label="Panel del profesor"
      data-right-panel
      onKeyDown={(event) => {
        if (event.key === "Escape") useCanvasStore.getState().closeDrawer();
      }}
      className={RIGHT_PANEL_CLASS}
    >
      <header className="border-b border-line px-4 py-3">
        {headerModule ? (
          <div className="flex items-start gap-3">
            {role ? (
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", ROLE_TONE[role].tile)} aria-hidden>
                <ModuleIcon role={role} filePath={headerModule.filePath} className="size-4" />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h2 title={headerModule.label} className="min-w-0 max-w-[60%] truncate text-base font-semibold text-slate-900">
                  {headerModule.label}
                </h2>
                {subtitle ? (
                  <p title={subtitle} className="min-w-0 flex-1 truncate text-right text-xs font-medium text-slate-500">{subtitle}</p>
                ) : (
                  <span className="flex-1" />
                )}
                <button
                  type="button"
                  aria-label="Probar desde este nodo"
                  title="Probar en vivo desde este nodo"
                  onClick={() => probeFromNode(headerModule.id)}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Zap className="size-4" aria-hidden />
                </button>
                <button
                  ref={closeRef}
                  type="button"
                  aria-label="Cerrar panel"
                  onClick={() => useCanvasStore.getState().closeDrawer()}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <p title={headerModule.filePath} className="truncate font-mono text-xs text-slate-400">{headerModule.filePath}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-slate-500">Selecciona un componente del lienzo</p>
            <button
              ref={closeRef}
              type="button"
              aria-label="Cerrar panel"
              onClick={() => useCanvasStore.getState().closeDrawer()}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </header>
      <div className="border-b border-line px-4 py-2">
        <div role="tablist" aria-label="Contenido del panel" className="flex gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          {visibleTabs.map(({ id, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  const store = useCanvasStore.getState();
                  if (id === "impact" && moduleId) store.startImpact(moduleId);
                  else store.setDrawerTab(id);
                }}
                className={cn(
                  "min-w-0 flex-1 truncate px-2 py-1 text-xs font-medium transition-all focus-visible:outline-2 focus-visible:outline-accent",
                  active
                    ? "rounded-md bg-white text-slate-900 shadow-sm"
                    : "rounded-md text-slate-600 hover:text-slate-900",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto text-sm">
        {tab === "flow" ? (
          <FlowTab />
        ) : tab === "lesson" ? (
          <LessonTab module={codeModule} />
        ) : tab === "impact" ? (
          <ImpactTab edges={edges} />
        ) : !codeModule ? (
          <p className="flex h-full items-center justify-center text-sm text-ink-3">
            Selecciona un componente del lienzo
          </p>
        ) : (
          <CodeTab module={codeModule} />
        )}
      </div>
    </aside>
  );
}
