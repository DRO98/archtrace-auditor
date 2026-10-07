"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useResolvedAi } from "@/features/canvas/lib/useResolvedAi";
import { useCanvasStore } from "@/features/canvas/store";
import { useAiSettings } from "@/lib/ai/settings";
import { cn } from "@/lib/cn";
import { BrandMark, PRODUCT_NAME } from "./BrandMark";
import { DASHBOARD_ROUTES, isPipelineEditorPath } from "./routes";

type NavId = "pipelines" | "api" | "settings";

const NAV_ITEMS: readonly { id: NavId; href: string; label: string; icon: LucideIcon }[] = [
  { id: "pipelines", href: DASHBOARD_ROUTES.pipelines, label: "Pipelines", icon: Zap },
  { id: "api", href: DASHBOARD_ROUTES.api, label: "API & Integración", icon: KeyRound },
  { id: "settings", href: DASHBOARD_ROUTES.settings, label: "Ajustes y Plan", icon: Settings },
];

function activeItem(pathname: string): NavId {
  if (pathname.startsWith(DASHBOARD_ROUTES.api)) return "api";
  if (pathname.startsWith(DASHBOARD_ROUTES.settings)) return "settings";
  return "pipelines";
}

/*
 * Plegado recordado por contexto: dentro del editor arranca en modo icono (56px, igual que el LeftRail)
 * para dejar sitio al lienzo; en el resto de vistas, expandido (220px). Cada contexto guarda su última elección.
 */
type CollapsedByContext = { editor: boolean; pages: boolean };

const STORAGE_KEY = "teacher:sidebar-collapsed";
const DEFAULT_COLLAPSED: CollapsedByContext = { editor: true, pages: false };
const listeners = new Set<() => void>();
let collapsed: CollapsedByContext | null = null;

function readCollapsed(): CollapsedByContext {
  if (collapsed) return collapsed;
  collapsed = DEFAULT_COLLAPSED;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof parsed === "object" && parsed !== null && "editor" in parsed && "pages" in parsed) {
      collapsed = { editor: parsed.editor === true, pages: parsed.pages === true };
    }
  } catch {
    // Sin localStorage (modo privado estricto): valores por defecto.
  }
  return collapsed;
}

function setCollapsed(next: CollapsedByContext): void {
  collapsed = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Solo se pierde la preferencia al recargar.
  }
  for (const listener of listeners) listener();
}

function subscribeCollapsed(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverCollapsed = (): CollapsedByContext => DEFAULT_COLLAPSED;

/** Navegación principal del dashboard: plegable entre 56px (iconos, como el LeftRail) y 220px. */
export function GlobalSidebar() {
  const pathname = usePathname();
  const inEditor = isPipelineEditorPath(pathname);
  const context = inEditor ? "editor" : "pages";
  const state = useSyncExternalStore(subscribeCollapsed, readCollapsed, serverCollapsed);
  const isCollapsed = state[context];
  // El modo presentación del lienzo oculta toda la interfaz, también la navegación global.
  const presenting = useCanvasStore((s) => s.presentation && s.view === "architecture");
  const resolved = useResolvedAi();
  const hasProvider = useAiSettings((s) => s.provider !== null);
  const aiMissing = !hasProvider && resolved.status === "none";
  const current = activeItem(pathname);

  if (inEditor && presenting) return null;

  return (
    <nav
      aria-label="Navegación principal"
      className={cn(
        "theme-light flex shrink-0 flex-col gap-1 border-r border-edge bg-panel py-3 transition-[width] duration-200 motion-reduce:transition-none",
        isCollapsed ? "w-14 px-1.5" : "w-[220px] px-3",
      )}
    >
      <div className={cn("mb-3 flex h-8 items-center gap-2", isCollapsed ? "justify-center" : "px-1.5")}>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-white shadow-[0_4px_12px_-2px] shadow-brand/40" aria-hidden>
          <BrandMark className="size-[18px]" />
        </span>
        {isCollapsed ? null : <span className="truncate text-sm font-semibold tracking-tight text-fg">{PRODUCT_NAME}</span>}
      </div>

      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ id, href, label, icon: Icon }) => {
          const active = current === id;
          const badge = id === "api" && aiMissing;
          const title = badge ? `${label} (IA sin configurar)` : label;
          return (
            <li key={id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                aria-label={isCollapsed ? title : undefined}
                title={isCollapsed ? title : undefined}
                className={cn(
                  "relative flex h-9 items-center gap-3 rounded-lg text-sm font-medium text-fg-2 transition-colors hover:bg-app-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-brand",
                  isCollapsed ? "justify-center" : "px-3",
                  active && "bg-brand/10 text-brand-strong hover:bg-brand/10 hover:text-brand-strong before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand",
                )}
              >
                <Icon className={cn("size-4 shrink-0", active && "text-brand-soft")} aria-hidden />
                {isCollapsed ? null : <span className="min-w-0 truncate">{label}</span>}
                {badge ? (
                  <span
                    className={cn(
                      "size-1.5 rounded-full bg-amber-500 ring-2",
                      "ring-panel",
                      isCollapsed ? "absolute right-2.5 top-2.5" : "ml-auto shrink-0",
                    )}
                    aria-hidden
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => setCollapsed({ ...state, [context]: !isCollapsed })}
        aria-label={isCollapsed ? "Expandir navegación" : "Plegar navegación"}
        title={isCollapsed ? "Expandir navegación" : "Plegar navegación"}
        aria-expanded={!isCollapsed}
        className={cn(
          "mt-auto flex h-9 items-center gap-3 rounded-lg text-sm text-fg-3 hover:bg-app-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-brand",
          isCollapsed ? "justify-center" : "px-3",
        )}
      >
        {isCollapsed ? (
          <PanelLeftOpen className="size-4" aria-hidden />
        ) : (
          <>
            <PanelLeftClose className="size-4 shrink-0" aria-hidden />
            <span>Plegar</span>
          </>
        )}
      </button>
    </nav>
  );
}
