"use client";

import { Cable, Database, GripVertical, HardDrive, MessageSquareText, Plus, Radio, Scissors, Server, ShieldCheck, Waves, type LucideIcon } from "lucide-react";
import { playgroundContext } from "@/features/playground/store";
import { resolveStageNode } from "@/lib/rag/stageNodes";
import { useCanvasStore } from "../store";
import { COMPONENT_TEMPLATE_IDS, COMPONENT_TEMPLATES, type ComponentTemplateId } from "./components";
import { useCanvasEdits, type ComponentPlacement } from "./store";

/** Tipo MIME del arrastre: el lienzo solo acepta soltar lo que venga de esta paleta. */
export const COMPONENT_DRAG_TYPE = "application/x-teacher-component";

const TEMPLATE_ICON: Record<ComponentTemplateId, LucideIcon> = {
  guardrails: ShieldCheck,
  reranker: Scissors,
  cache: Database,
  "query-rewriter": MessageSquareText,
  memory: Database,
  "output-guard": Server,
  database: HardDrive,
  broker: Radio,
  "stream-processor": Waves,
  "rpc-service": Cable,
};

/**
 * Añade el componente y lo destaca. Con `placement.detached` queda suelto (sin aristas) y `before` es solo el
 * destino sugerido para «Empalmar en el flujo»; sin placement se empalma antes de `before` (acción explícita
 * del usuario sobre un nodo concreto). Sin nodo de destino, la sugerencia es el nodo seleccionado o el LLM.
 */
export function insertComponent(template: ComponentTemplateId, before: string | null, placement?: ComponentPlacement): void {
  const canvas = useCanvasStore.getState();
  const anchor = before ?? canvas.selectedModuleId ?? resolveStageNode("llm", playgroundContext().modules);
  const id = useCanvasEdits.getState().add(template, anchor, placement);
  canvas.selectModule(id);
  canvas.spotlight(id);
}

/** Paleta de componentes: se arrastran al lienzo (o se añaden con el botón) y quedan sueltos hasta empalmarlos. */
export function ComponentPalette() {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-3">
      <p className="text-xs text-ink-2">
        Arrastra al lienzo; clic derecho → <strong>Empalmar en el flujo</strong>.
      </p>
      <ul className="flex flex-col gap-1">
        {COMPONENT_TEMPLATE_IDS.map((id) => {
          const template = COMPONENT_TEMPLATES[id];
          const Icon = TEMPLATE_ICON[id];
          return (
            <li
              key={id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(COMPONENT_DRAG_TYPE, id);
                event.dataTransfer.effectAllowed = "copy";
              }}
              title={template.description}
              className="group flex cursor-grab items-center gap-2 rounded-lg border border-line bg-white px-2 py-1.5 hover:border-teal-300 hover:bg-teal-50/50 active:cursor-grabbing"
            >
              <GripVertical className="size-3.5 shrink-0 text-ink-3" aria-hidden />
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-teal-100 text-teal-700" aria-hidden>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{template.label}</span>
                <span className="block truncate text-[11px] text-ink-3">{template.subtitle}</span>
              </span>
              <button
                type="button"
                aria-label={`Añadir ${template.label}`}
                title="Añadir suelto al lienzo (se sugerirá empalmarlo delante del nodo seleccionado o del LLM)"
                onClick={() => insertComponent(id, null, { detached: true })}
                className="grid size-7 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-teal-100 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-teal-500"
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
