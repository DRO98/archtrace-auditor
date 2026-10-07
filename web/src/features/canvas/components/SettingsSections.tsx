"use client";

import { useId } from "react";
import { useTeacherStatus } from "@/hooks/useTeacherSocket";
import { cn } from "@/lib/cn";
import type { ConnectionStatus } from "@/lib/ws/TeacherSocketManager";
import { IDE_OPTIONS, shortenPath, type IdeId } from "../lib/ideSetup";
import { useIdeSetup } from "../lib/useIdeSetup";
import { useCanvasStore } from "../store";
import { AiSettingsSection } from "./AiSettingsSection";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  open: "Conectado",
  connecting: "Conectando…",
  closed: "Desconectado",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  open: "bg-emerald-500",
  connecting: "animate-pulse bg-amber-500",
  closed: "bg-rose-500",
};

const STATUS_PILL: Record<ConnectionStatus, string> = {
  open: "border-emerald-200 bg-emerald-50 text-emerald-800",
  connecting: "border-amber-200 bg-amber-50 text-amber-800",
  closed: "border-rose-200 bg-rose-50 text-rose-800",
};

export function SwitchRow({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const descriptionId = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <span className="text-sm font-medium text-ink">{label}</span>
        <p id={descriptionId} className="mt-0.5 text-xs text-slate-500">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-describedby={descriptionId}
        onClick={onToggle}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 overflow-visible rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500",
          checked ? "bg-teal-600" : "bg-slate-300",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-5",
          )}
          aria-hidden
        />
      </button>
    </div>
  );
}

/**
 * Editor activo, estado del puente WebSocket y sincronización lienzo ↔ IDE.
 * `onConfigureRoot`: qué hacer cuando aún no hay ruta del proyecto (el lienzo manda a Ajustes y Plan
 * en lugar de abrir un modal encima de sus herramientas).
 */
export function IdeConnectionSection({ onConfigureRoot }: { onConfigureRoot?: () => void } = {}) {
  const focusEditor = useCanvasStore((state) => state.focusEditor);
  const followIde = useCanvasStore((state) => state.followIde);
  const status = useTeacherStatus();
  const { setup, save, setOpen } = useIdeSetup();
  const activeIde = setup?.ide ?? "vscode";
  const configureRoot = onConfigureRoot ?? (() => setOpen(true));

  function selectIde(ide: IdeId): void {
    if (setup) {
      save({ ...setup, ide });
      return;
    }
    configureRoot();
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Editor activo</h3>
        <div className="grid grid-cols-2 gap-2">
          {IDE_OPTIONS.map((option) => {
            const selected = activeIde === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                onClick={() => selectIde(option.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  selected ? "border-ink bg-neutral-50 text-ink" : "border-line text-ink-2 hover:bg-neutral-50",
                )}
              >
                <span className="grid h-7 min-w-7 place-items-center rounded-md bg-neutral-100 px-1 font-mono text-[10px] font-semibold text-ink">
                  {option.mark}
                </span>
                <span className="min-w-0 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
        {!setup ? (
          <button
            type="button"
            onClick={configureRoot}
            className="self-start text-xs font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            Configurar ruta del proyecto…
          </button>
        ) : (
          <p className="font-mono text-[11px] text-slate-500" title={setup.projectRoot}>
            Proyecto · {shortenPath(setup.projectRoot)}
          </p>
        )}
      </section>

      <span
        role="status"
        aria-label={`Estado de conexión: ${STATUS_LABEL[status]}`}
        className={cn(
          "inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
          STATUS_PILL[status],
        )}
      >
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[status])} aria-hidden />
        {STATUS_LABEL[status]}
      </span>

      <section className="flex flex-col gap-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sincronización</h3>
        <SwitchRow
          label="Enfocar IDE al navegar"
          description="Salta automáticamente al archivo y línea de código en tu editor cuando selecciones un módulo en el lienzo."
          checked={focusEditor}
          onToggle={() => useCanvasStore.getState().toggleFocusEditor()}
        />
        <SwitchRow
          label="Seguir el cursor del IDE"
          description="Resalta el nodo del diagrama equivalente al archivo que estás editando activamente en el IDE."
          checked={followIde}
          onToggle={() => useCanvasStore.getState().toggleFollowIde()}
        />
      </section>
    </div>
  );
}

/** Proveedor de IA (BYOK / Ollama) y, en desarrollo, el interruptor de foco de lección. */
export function AiProviderSection() {
  const lessonOn = useCanvasStore((state) => state.lessonFocusIds.size > 0);

  return (
    <div className="flex flex-col gap-5">
      <AiSettingsSection />
      {process.env.NODE_ENV === "development" ? (
        <div className="border-t border-line pt-4">
          <SwitchRow
            label="Simular foco de lección"
            description="Atenúa los módulos secundarios para enfocar la explicación en el componente actual."
            checked={lessonOn}
            onToggle={() =>
              useCanvasStore
                .getState()
                .setLessonFocus(lessonOn ? new Set() : new Set(["src/rag/pipeline.py", "src/rag/vector_store.py"]))
            }
          />
        </div>
      ) : null}
    </div>
  );
}
