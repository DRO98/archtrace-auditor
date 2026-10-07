"use client";

import { ChevronLeft, FileCode2, Layers2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { blockNeighbours, isLeafBlock, type Level0Block, type Level0Graph } from "../lib/level0";
import { useCanvasStore } from "../store";

const MAX_NEIGHBOURS = 6;

/**
 * Cómo se engancha el bloque abierto al resto del sistema. Chips ligeros; click → ese bloque (o selección si es hoja).
 */
function BlockConnections({ level0, block }: { level0: Level0Graph; block: Level0Block }) {
  const neighbours = blockNeighbours(level0, block.id);
  if (neighbours.length === 0) return null;
  const shown = neighbours.slice(0, MAX_NEIGHBOURS);
  const open = (target: Level0Block) => {
    const state = useCanvasStore.getState();
    if (target.primaryModuleId && isLeafBlock(target)) state.selectModule(target.primaryModuleId);
    else state.enterSubsystem(target.id);
  };
  return (
    <div className="flex max-w-[28rem] flex-wrap items-center gap-x-1 gap-y-1 px-1 text-[11px] text-ink-3">
      <span className="font-medium">Conecta</span>
      {shown.map(({ block: target, direction, weight }) => (
        <button
          key={`${direction}:${target.id}`}
          type="button"
          onClick={() => open(target)}
          title={`${weight} dependencia${weight === 1 ? "" : "s"} ${direction === "out" ? "hacia" : "desde"} ${target.label}`}
          className="inline-flex max-w-[10rem] items-center gap-0.5 rounded-md px-1.5 py-0.5 text-ink-2 transition-colors hover:bg-white hover:text-ink"
        >
          {direction === "in" ? <span aria-hidden>←</span> : null}
          <span className="truncate">{target.label}</span>
          {direction === "out" ? <span aria-hidden>→</span> : null}
        </button>
      ))}
      {neighbours.length > shown.length ? <span>+{neighbours.length - shown.length}</span> : null}
    </div>
  );
}

/**
 * Navegación al entrar en un servicio: volver · nombre · Abstracciones | Archivos.
 * Una sola barra ligera (sin botón negro ni slash de breadcrumb).
 */
export function LevelBreadcrumb({
  level0,
  showLevel0,
  focusedBlock,
  architectureMode = false,
}: {
  level0: Level0Graph;
  showLevel0: boolean;
  focusedBlock: Level0Block | null;
  architectureMode?: boolean;
}) {
  const exitToLevel0 = useCanvasStore((state) => state.exitToLevel0);
  const setDrillFiles = useCanvasStore((state) => state.setDrillFiles);
  const drillFiles = useCanvasStore((state) => state.drillFiles);
  const system = level0.style === "system";
  if (showLevel0 || architectureMode) return null;

  const title = focusedBlock?.label ?? (system ? "Sistema" : "Mapa");

  return (
    <div className="pointer-events-none flex w-full flex-col gap-1.5">
      <nav
        aria-label="Nivel de arquitectura"
        className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-line/70 bg-white/90 p-1 shadow-[0_1px_3px_rgba(16,24,40,0.06)] backdrop-blur-md"
      >
        <button
          type="button"
          onClick={exitToLevel0}
          title="Volver al mapa"
          aria-label="Volver al mapa"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-xl px-2 text-sm font-medium text-ink-2 transition-colors hover:bg-neutral-100 hover:text-ink"
        >
          <ChevronLeft className="size-4 shrink-0" aria-hidden />
          <span className="hidden sm:inline">Mapa</span>
        </button>

        <span className="h-4 w-px shrink-0 bg-line" aria-hidden />

        <div className="min-w-0 flex-1 px-2" aria-current="location">
          <p className="truncate text-sm font-semibold tracking-tight text-ink">{title}</p>
          {focusedBlock && !system ? (
            <p className="truncate text-[10px] text-ink-3">{focusedBlock.size} módulos</p>
          ) : null}
        </div>

        {focusedBlock && system ? (
          <div
            role="group"
            aria-label="Qué ver del servicio"
            className="flex shrink-0 rounded-xl bg-neutral-100/90 p-0.5"
          >
            {(
              [
                { files: false, label: "Abstracciones", Icon: Layers2 },
                { files: true, label: "Archivos", Icon: FileCode2 },
              ] as const
            ).map(({ files, label, Icon }) => {
              const active = drillFiles === files;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDrillFiles(files)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-[10px] px-2 text-xs font-medium transition-colors",
                    active ? "bg-white text-ink shadow-sm" : "text-ink-3 hover:text-ink",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}
      </nav>
      {focusedBlock ? (
        <div className="pointer-events-auto rounded-xl border border-line/50 bg-white/70 px-1.5 py-1 backdrop-blur-sm">
          <BlockConnections level0={level0} block={focusedBlock} />
        </div>
      ) : null}
    </div>
  );
}
