"use client";

import { useEffect, useId, useRef, forwardRef, type ComponentType, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/*
 * Primitivas del dashboard en tema claro (Pipelines, API, Ajustes). El lienzo del editor
 * tiene su propia paleta (`canvas`/`ink`): estas clases solo se usan dentro de `.theme-light`.
 */

const BUTTON_BASE =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_PRIMARY = `${BUTTON_BASE} bg-brand text-white shadow-[0_0_0_1px_rgb(13_148_136/0.5),0_6px_16px_-8px_rgb(13_148_136/0.5)] hover:bg-brand-strong`;
export const BTN_SECONDARY = `${BUTTON_BASE} border border-edge bg-panel text-fg hover:border-edge-strong hover:bg-panel-2`;
export const BTN_GHOST = `${BUTTON_BASE} text-fg-2 hover:bg-panel-2 hover:text-fg`;

/** Icono de Lucide o una marca propia en SVG. */
export type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** Marca de GitHub (Lucide ya no incluye logotipos de marcas). */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

/** Cajas de texto y selectores: fondo blanco y borde fino. */
export const FIELD =
  "h-9 w-full rounded-lg border border-edge bg-panel px-3 text-sm text-fg placeholder:text-fg-3 transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60";

export type BadgeTone = "brand" | "live" | "neutral" | "amber" | "rose" | "sky";

const BADGE_TONE: Record<BadgeTone, string> = {
  brand: "border-brand/30 bg-brand/10 text-brand-soft",
  live: "border-live/30 bg-live/10 text-emerald-700",
  neutral: "border-edge bg-app-2 text-fg-2",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-700",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-700",
};

export function Badge({ tone = "neutral", dot = false, children, className }: { tone?: BadgeTone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md border px-1.5 text-[11px] font-medium leading-none",
        BADGE_TONE[tone],
        className,
      )}
    >
      {dot ? <span className={cn("size-1.5 rounded-full bg-current", tone === "live" && "shadow-[0_0_6px] shadow-live")} aria-hidden /> : null}
      {children}
    </span>
  );
}

/** Tarjeta base: fondo `panel`, borde fino. */
export const Panel = forwardRef<HTMLElement, { children: ReactNode; className?: string; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>>(
  function Panel({ children, className, as: Tag = "section", ...rest }, ref) {
    return (
      <Tag ref={ref as never} className={cn("rounded-xl border border-edge bg-panel", className)} {...rest}>
        {children}
      </Tag>
    );
  },
);

/** Cabecera de panel con título, descripción y acciones a la derecha. */
export function PanelHeader({ icon: Icon, title, description, actions, id }: { icon?: IconComponent; title: string; description?: string; actions?: ReactNode; id?: string }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-edge bg-app-2 text-fg-2" aria-hidden>
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 id={id} className="text-sm font-semibold text-fg">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-xs text-fg-3">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Métrica compacta: etiqueta en versalitas y valor monoespaciado. */
export function Metric({ label, value, hint, className }: { label: string; value: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[10px] font-medium uppercase tracking-wider text-fg-3">{label}</dt>
      <dd className="mt-1 truncate font-mono text-sm text-fg" title={hint}>
        {value}
      </dd>
    </div>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: IconComponent;
  suffix?: ReactNode;
}

/** Pestañas segmentadas con semántica `tablist`. */
export function Tabs<T extends string>({ items, value, onChange, label, className }: { items: readonly TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-1 rounded-lg border border-edge bg-app-2 p-1", className)}>
      {items.map(({ id, label: text, icon: Icon, suffix }) => {
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={cn(
              "inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
              active ? "bg-panel text-fg shadow-sm shadow-slate-900/5 ring-1 ring-edge" : "text-fg-3 hover:text-fg",
            )}
          >
            {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
            <span className="truncate">{text}</span>
            {suffix}
          </button>
        );
      })}
    </div>
  );
}

/** Modal: se cierra con Escape o clic fuera; el foco entra al abrirse y vuelve al cerrarse. */
export function Modal({ title, description, onClose, children, className }: { title: string; description?: string; onClose: () => void; children: ReactNode; className?: string }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // El foco se toma una sola vez al montar: `onClose` puede cambiar en cada render sin robar el foco.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") closeRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="theme-light fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-edge bg-panel text-fg shadow-2xl shadow-slate-900/15 outline-none",
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-xs text-fg-3">{description}</p> : null}
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-3 hover:bg-panel-2 hover:text-fg">
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="scrollbar-thin min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** Interruptor accesible. */
export function Switch({ label, description, checked, onToggle }: { label: string; description: string; checked: boolean; onToggle: () => void }) {
  const descriptionId = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <span className="text-sm font-medium text-fg">{label}</span>
        <p id={descriptionId} className="mt-0.5 text-xs text-fg-3">
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
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          checked ? "bg-brand" : "bg-edge-strong",
        )}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform", checked && "translate-x-4")} aria-hidden />
      </button>
    </div>
  );
}
