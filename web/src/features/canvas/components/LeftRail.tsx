"use client";

import { useRouter } from "next/navigation";
import { Activity, Blocks, GitCompare, History, LayoutTemplate, ScanSearch, type LucideIcon } from "lucide-react";
import { DASHBOARD_ROUTES } from "@/features/dashboard/routes";
import { DiffPanel } from "@/features/diff/DiffPanel";
import { useGitDiff } from "@/features/diff/store";
import { ArchitectureCheckPanel, useCheckBadge } from "@/features/health/ArchitectureCheckPanel";
import { HealthPanel, useHealthAlertCount } from "@/features/health/HealthPanel";
import { useTeacherStatus } from "@/hooks/useTeacherSocket";
import { cn } from "@/lib/cn";
import type { ConnectionStatus } from "@/lib/ws/TeacherSocketManager";
import { ideOption } from "../lib/ideSetup";
import { useIdeSetup } from "../lib/useIdeSetup";
import { useCanvasStore, type PopoverId } from "../store";
import { ComponentPalette } from "../edit/ComponentPalette";
import { Popover } from "./Popover";
import { ArchitectureKindPanel } from "./ArchitectureKindPanel";
import { IdeConnectionSection } from "./SettingsSections";

const BUTTON =
  "relative grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-neutral-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent";
const ACTIVE = "bg-ink text-white hover:bg-ink hover:text-white";

const STATUS_DOT: Record<ConnectionStatus, string> = {
  open: "bg-emerald-500",
  connecting: "animate-pulse bg-amber-500",
  closed: "bg-rose-500",
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  open: "IDE conectado",
  connecting: "Conectando con el IDE…",
  closed: "IDE desconectado",
};

function RailButton({
  id,
  label,
  icon: Icon,
  badge,
}: {
  id: PopoverId;
  label: string;
  icon: LucideIcon;
  /** Indicador en la esquina: número de alertas, o `true` para un punto (estado activo). */
  badge?: number | boolean;
}) {
  const open = useCanvasStore((state) => state.popover === id);
  return (
    <button
      type="button"
      data-rail-button
      aria-label={label}
      title={label}
      aria-expanded={open}
      onClick={() => useCanvasStore.getState().setPopover(open ? null : id)}
      className={cn(BUTTON, open && ACTIVE)}
    >
      <Icon className="size-4" aria-hidden />
      {typeof badge === "number" && badge > 0 ? (
        <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[9px] font-semibold text-white ring-2 ring-white" aria-hidden>
          {badge > 99 ? "99+" : badge}
        </span>
      ) : badge === true ? (
        <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-teal-600 ring-2 ring-white" aria-hidden />
      ) : null}
    </button>
  );
}

/** Alterna entre el lienzo y el historial de lecciones de este pipeline. */
function HistoryButton() {
  const active = useCanvasStore((state) => state.view === "history");
  const label = active ? "Volver al lienzo" : "Historial de lecciones";
  return (
    <button
      type="button"
      data-rail-button
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={() => {
        const state = useCanvasStore.getState();
        state.setPopover(null);
        state.setView(active ? "architecture" : "history");
      }}
      className={cn(BUTTON, active && ACTIVE)}
    >
      <History className="size-4" aria-hidden />
    </button>
  );
}

/** Badge compacto del IDE: icono del editor + punto de estado; abre el popover de conexión. */
function IdeStatusBadge() {
  const status = useTeacherStatus();
  const { setup } = useIdeSetup();
  const active = useCanvasStore((state) => state.popover === "ide");
  const mark = setup ? ideOption(setup.ide).mark : "?";
  const label = `${STATUS_LABEL[status]}${setup ? ` · ${ideOption(setup.ide).label}` : ""}`;

  return (
    <button
      type="button"
      data-rail-button
      aria-label={label}
      title={label}
      aria-expanded={active}
      onClick={() => useCanvasStore.getState().setPopover(active ? null : "ide")}
      className={cn(BUTTON, active && ACTIVE)}
    >
      <span
        className={cn(
          "grid h-5 min-w-5 place-items-center rounded px-0.5 font-mono text-[9px] font-semibold",
          active ? "bg-white/15 text-white" : "bg-neutral-100 text-ink",
        )}
        aria-hidden
      >
        {mark}
      </span>
      <span
        className={cn(
          "absolute right-1.5 bottom-1.5 size-1.5 rounded-full ring-2",
          active ? "ring-ink" : "ring-white",
          STATUS_DOT[status],
        )}
        aria-hidden
      />
    </button>
  );
}

/**
 * Barra de herramientas del lienzo: añadir componentes, historial (excluyente con los popovers), ejemplos de arquitectura, diff de git,
 * Architecture Check (hallazgos del grafo + drift), rendimiento (SLA) y estado del IDE. Los servicios locales viven solo en Ajustes (el popover tapaba el grafo);
 * la navegación global y la gestión (claves, ajustes, fuentes) están en la barra del dashboard.
 */
export function LeftRail() {
  const router = useRouter();
  const alertCount = useHealthAlertCount();
  const checkCount = useCheckBadge();
  const diffActive = useGitDiff((state) => state.active);

  return (
    <nav
      aria-label="Catálogo del lienzo"
      className="relative z-30 flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-white py-3"
    >
      <RailButton id="components" label="Añadir componente (Guardrails, Reranker, Cache…)" icon={Blocks} />
      <Popover id="components" title="Añadir componente">
        <ComponentPalette />
      </Popover>
      <HistoryButton />

      <div className="my-1 w-8 border-t border-line" aria-hidden />
      <RailButton id="architecture" label="Ejemplos de arquitectura" icon={LayoutTemplate} />
      <Popover id="architecture" title="Ejemplos de arquitectura">
        <ArchitectureKindPanel />
      </Popover>
      <RailButton id="diff" label="Diff visual de git (commits y ramas)" icon={GitCompare} badge={diffActive} />
      <Popover id="diff" title="Diff visual de git">
        <DiffPanel />
      </Popover>
      <RailButton
        id="check"
        label={checkCount > 0 ? `Architecture Check: ${checkCount} hallazgos graves o drift` : "Architecture Check: ciclos, hubs, capas y drift"}
        icon={ScanSearch}
        badge={checkCount}
      />
      <Popover id="check" title="Architecture Check">
        <ArchitectureCheckPanel />
      </Popover>
      <RailButton id="health" label={alertCount > 0 ? `Rendimiento: ${alertCount} alertas de SLA` : "Rendimiento (SLA)"} icon={Activity} badge={alertCount} />
      <Popover id="health" title="Rendimiento (SLA)">
        <HealthPanel />
      </Popover>

      <div className="mt-auto flex flex-col items-center gap-1">
        <IdeStatusBadge />
      </div>
      <Popover id="ide" title="Conexión con el IDE" anchor="bottom">
        <div className="p-4">
          <IdeConnectionSection onConfigureRoot={() => router.push(DASHBOARD_ROUTES.settings)} />
        </div>
      </Popover>
    </nav>
  );
}
