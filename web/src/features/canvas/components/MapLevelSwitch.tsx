"use client";

import { Layers, Network } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCanvasStore } from "../store";

const OPTIONS = [
  { id: "system" as const, label: "Sistema", icon: Layers, hint: "Un nodo por servicio: la abstracción general" },
  { id: "architecture" as const, label: "Arquitectura", icon: Network, hint: "Cada servicio abierto en sus componentes (API, agente, datos…)" },
];

/**
 * Conmutador Sistema / Arquitectura en el mapa. Dentro de un servicio la salida vive en `LevelBreadcrumb`
 * (no se duplica un «Volver al mapa» en la cabecera).
 */
export function MapLevelSwitch({ className }: { className?: string }) {
  const systemMode = useCanvasStore((state) => state.systemMode);
  const archView = useCanvasStore((state) => state.archView);
  const archLevel = useCanvasStore((state) => state.archLevel);
  if (!systemMode || archLevel === 1) return null;
  return (
    <div role="group" aria-label="Nivel del mapa" className={cn("flex shrink-0 items-center rounded-lg bg-neutral-100 p-0.5", className)}>
      {OPTIONS.map(({ id, label, icon: Icon, hint }) => {
        const active = archView === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            title={hint}
            onClick={() => {
              const canvas = useCanvasStore.getState();
              if (id === "system") canvas.exitToLevel0();
              else canvas.setArchView("architecture");
            }}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors",
              active ? "bg-white text-ink shadow-sm" : "text-ink-3 hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
