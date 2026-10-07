"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { isPipelineEditorPath } from "@/features/dashboard/routes";
import { cn } from "@/lib/cn";
import { IDE_OPTIONS, isAbsoluteRoot, type IdeId, type IdeSetup } from "../lib/ideSetup";
import { useIdeSetup } from "../lib/useIdeSetup";

const ENV_ROOT = process.env.NEXT_PUBLIC_PROJECT_ROOT ?? "";

/**
 * Modal global de conexión con el IDE. Nunca se pinta dentro del editor de pipelines: allí taparía
 * el zoom y las herramientas del lienzo (la barra del lienzo manda a Ajustes y Plan).
 */
export function IDESetupModal() {
  const { setup, hydrated, open, save, setOpen } = useIdeSetup();
  const inEditor = isPipelineEditorPath(usePathname());

  useEffect(() => {
    if (!hydrated || inEditor) return;
    if (!setup) setOpen(true);
  }, [hydrated, inEditor, setup, setOpen]);

  // El diálogo se monta al abrirse: su borrador parte siempre de lo guardado, sin sincronizarlo con un efecto.
  if (!open || inEditor) return null;
  return <IdeSetupDialog initial={setup} onSave={save} onClose={() => setOpen(false)} />;
}

function IdeSetupDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: IdeSetup | null;
  onSave: (setup: IdeSetup) => void;
  onClose: () => void;
}) {
  const [ide, setIde] = useState<IdeId>(initial?.ide ?? "cursor");
  const [projectRoot, setProjectRoot] = useState(initial?.projectRoot ?? ENV_ROOT);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  const canSave = isAbsoluteRoot(projectRoot);

  async function detectRoot(): Promise<void> {
    setDetecting(true);
    setDetectError(null);
    try {
      const response = await fetch("/api/project-root");
      if (!response.ok) {
        setDetectError("El backend no tiene una ruta configurada. Escríbela a mano.");
        return;
      }
      const body: unknown = await response.json();
      if (
        typeof body === "object" &&
        body !== null &&
        "projectRoot" in body &&
        typeof body.projectRoot === "string" &&
        body.projectRoot.trim()
      ) {
        setProjectRoot(body.projectRoot);
        return;
      }
      setDetectError("El backend no tiene una ruta configurada. Escríbela a mano.");
    } catch {
      setDetectError("No se pudo contactar el backend. Escríbela a mano.");
    } finally {
      setDetecting(false);
    }
  }

  function submit(): void {
    if (!canSave) return;
    onSave({ ide, projectRoot });
    onClose();
  }

  return (
    <div className="theme-light fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-6 backdrop-blur-sm" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ide-setup-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl shadow-slate-900/15"
      >
        <header className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h2 id="ide-setup-title" className="text-base font-semibold text-fg">
            Conectar el IDE
          </h2>
          <button
            type="button"
            aria-label="Cerrar configuración"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-fg-3 hover:bg-panel-2 hover:text-fg"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <form
          className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset>
            <legend className="text-xs font-medium text-fg-2">Editor</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {IDE_OPTIONS.map((option) => {
                const selected = ide === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setIde(option.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm",
                      selected ? "border-brand/60 bg-brand/10 text-fg" : "border-edge text-fg-2 hover:bg-panel-2",
                    )}
                  >
                    <span className="grid h-7 min-w-7 place-items-center rounded-md bg-app-2 px-1 font-mono text-[10px] font-semibold text-fg">
                      {option.mark}
                    </span>
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-2">
            Ruta absoluta raíz del proyecto en tu máquina
            <input
              value={projectRoot}
              onChange={(event) => setProjectRoot(event.target.value)}
              placeholder="C:/Users/me/mi-repo"
              spellCheck={false}
              className="h-10 rounded-lg border border-edge bg-app-2 px-3 font-mono text-xs font-normal text-fg outline-none placeholder:text-fg-3 focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <button
            type="button"
            onClick={() => void detectRoot()}
            disabled={detecting}
            className="self-start text-sm font-medium text-brand-soft underline-offset-2 hover:underline disabled:opacity-50"
          >
            {detecting ? "Detectando…" : "Detectar ruta automáticamente"}
          </button>
          {detectError ? <p className="text-sm text-rose-700">{detectError}</p> : null}
          <button
            type="submit"
            disabled={!canSave}
            className="h-10 rounded-lg bg-brand text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-40"
          >
            Conectar y Continuar
          </button>
        </form>
      </div>
    </div>
  );
}
