import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Marco común de las vistas de gestión (tema oscuro): cabecera con acciones y contenido con scroll propio. */
export function PageShell({
  title,
  description,
  actions,
  children,
  wide = false,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Vistas tipo explorador que aprovechan todo el ancho. */
  wide?: boolean;
}) {
  return (
    <div className="theme-light scrollbar-thin h-full overflow-y-auto bg-app text-fg">
      <div className={cn("mx-auto flex w-full flex-col gap-5 px-4 py-6 sm:px-8", wide ? "max-w-7xl" : "max-w-6xl")}>
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-edge pb-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-fg-2">{description}</p>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
        {children}
      </div>
    </div>
  );
}
