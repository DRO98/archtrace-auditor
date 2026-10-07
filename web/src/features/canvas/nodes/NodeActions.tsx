import { Code2, Trash2, Zap, type LucideIcon } from "lucide-react";
import { probeFromNode } from "@/features/playground/hooks/usePlaygroundTrace";
import { isCanvasComponent } from "../edit/components";
import { useCanvasEdits } from "../edit/store";
import { exploreCode } from "../lib/actions";

function ActionButton({
  icon: Icon,
  label,
  title,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex h-6 items-center gap-1 rounded px-1.5 font-medium text-ink-2 hover:bg-neutral-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </button>
  );
}

/** Acciones del nodo seleccionado: abrir su código (o quitarlo, si se añadió en el lienzo) o lanzar "Probar en vivo" desde él. */
export function NodeActions({ moduleId, selected }: { moduleId: string; selected: boolean }) {
  if (!selected) return null;

  return (
    <div className="nodrag nopan pointer-events-auto absolute -top-9 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-md border border-line bg-white px-1 py-0.5 text-xs shadow-md dark:border-slate-700 dark:bg-slate-800">
      {isCanvasComponent(moduleId) ? (
        <ActionButton icon={Trash2} label="Quitar" title="Quitar componente" onClick={() => useCanvasEdits.getState().remove(moduleId)} />
      ) : (
        <ActionButton icon={Code2} label="Código" title="Ver código" onClick={() => exploreCode(moduleId)} />
      )}
      <ActionButton icon={Zap} label="Probar" title="Probar desde este nodo" onClick={() => probeFromNode(moduleId)} />
    </div>
  );
}
