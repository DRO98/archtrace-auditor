import type { ReactNode } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

const NAV_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-30";

export interface TimelineStep {
  stepNumber: number;
  title: string;
  summary: string;
  connectionReason: string;
  locationLabel: string;
}

interface StepTimelineProps {
  steps: readonly TimelineStep[];
  activeIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onOpenInIde: (index: number) => void;
  label?: string;
  /**
   * Controles anterior/siguiente. En simulación el PlayerBar ya navega; pásalo a false para no duplicar.
   * En lecciones (sin barra flotante) déjalo activo.
   */
  showStepNav?: boolean;
  /** Contenido compacto en la línea superior, junto a la ruta del archivo (p. ej. métricas del paso). */
  renderConnectionAside?: (index: number) => ReactNode;
  renderDetail?: (index: number) => ReactNode;
}

/** Un solo paso a ancho completo: navegación compacta, metadatos y detalle, sin stepper ni cards anidadas. */
export function StepTimeline({
  steps,
  activeIndex,
  onPrev,
  onNext,
  onOpenInIde,
  label = "Pasos de la lección",
  showStepNav = true,
  renderConnectionAside,
  renderDetail,
}: StepTimelineProps) {
  const step = steps[activeIndex];
  if (!step) return null;

  const aside = renderConnectionAside?.(activeIndex) ?? null;

  const last = activeIndex >= steps.length - 1;

  return (
    <section
      tabIndex={showStepNav ? 0 : undefined}
      aria-label={label}
      onKeyDown={
        showStepNav
          ? (event) => {
              if (event.key === "ArrowLeft") onPrev();
              if (event.key === "ArrowRight") onNext();
            }
          : undefined
      }
      className="flex w-full flex-col gap-3 p-4 focus-visible:outline-2 focus-visible:outline-accent"
    >
      {showStepNav ? (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            aria-label="Paso anterior"
            title="Paso anterior (←)"
            disabled={activeIndex <= 0}
            onClick={onPrev}
            className={NAV_BUTTON}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="min-w-28 text-center text-xs font-semibold tabular-nums text-slate-700">
            Paso {step.stepNumber} de {steps.length}
          </span>
          <button
            type="button"
            aria-label="Paso siguiente"
            title="Paso siguiente (→)"
            disabled={last}
            onClick={onNext}
            className={NAV_BUTTON}
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="flex min-w-0 items-center gap-2 border-b border-slate-100 pb-2 text-[11px]">
        <button
          type="button"
          title={`Ver en el IDE: ${step.locationLabel}`}
          onClick={() => onOpenInIde(activeIndex)}
          className="inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 font-mono text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="truncate">{step.locationLabel}</span>
          <ExternalLink className="size-3 shrink-0 text-slate-400" aria-hidden />
        </button>
        {aside ? <div className="ml-auto shrink-0">{aside}</div> : null}
      </div>

      <div className="w-full min-w-0 [overflow-wrap:anywhere]">
        <h3 className="mb-1 text-sm font-bold text-slate-900">{step.title}</h3>
        <p className="text-sm leading-relaxed text-slate-600">{step.summary}</p>
        {step.connectionReason ? (
          <p className="mt-2 flex min-w-0 gap-1.5 text-xs leading-5 text-slate-500">
            <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
            <span>{step.connectionReason}</span>
          </p>
        ) : null}
      </div>

      {renderDetail?.(activeIndex)}
    </section>
  );
}
