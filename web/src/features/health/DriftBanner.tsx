"use client";

import { useState } from "react";
import { AlertTriangle, EyeOff, X } from "lucide-react";
import { useCanvasStore } from "@/features/canvas/store";
import { cn } from "@/lib/cn";
import { checkCopy } from "./ArchitectureCheckPanel";
import { useHealth } from "./store";

/**
 * Aviso en el lienzo cuando el mapa no cuadra con el código: ámbar si hay archivos sin mapear o módulos que ya no
 * existen; discreto si solo hay huérfanos (el lienzo los oculta). Lleva al Architecture Check, donde está el detalle.
 */
export function DriftBanner() {
  const allItems = useHealth((state) => state.drift?.items);
  // Mapa de sistema: solo cuenta lo que el mapa enseña y ya no existe; lo que no está en el mapa no es drift.
  const systemMode = useCanvasStore((state) => state.systemMode);
  const items = systemMode ? allItems?.filter((item) => item.kind === "stale") : allItems;
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!items || items.length === 0) return null;

  const unmapped = items.filter((item) => item.kind === "unmapped").length;
  const stale = items.filter((item) => item.kind === "stale").length;
  const orphans = items.length - unmapped - stale;
  // Se vuelve a mostrar si el drift cambia después de ocultarlo.
  const signature = `${unmapped}:${stale}:${orphans}`;
  if (dismissed === signature) return null;

  const copy = checkCopy();
  const serious = unmapped + stale > 0;
  const Icon = serious ? AlertTriangle : EyeOff;

  return (
    <section
      aria-label={copy.driftTitle}
      className={cn(
        "absolute bottom-3 right-3 z-10 flex max-w-[min(26rem,calc(100%-1.5rem))] items-start gap-2 rounded-xl border p-2.5 text-xs shadow-md",
        serious ? "border-amber-200 bg-amber-50 text-amber-900" : "border-line bg-white/95 text-ink-2 backdrop-blur",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", serious ? "text-amber-600" : "text-ink-3")} aria-hidden />
      <div className="min-w-0 flex-1">
        {serious ? (
          <>
            <p className="font-semibold">{copy.driftTitle}</p>
            <p className="mt-0.5">{copy.drift(unmapped, stale)}</p>
          </>
        ) : null}
        {orphans > 0 ? <p className={serious ? "mt-0.5" : undefined}>{copy.orphans(orphans)}</p> : null}
        <button
          type="button"
          onClick={() => useCanvasStore.getState().setPopover("check")}
          className="mt-1 font-medium underline underline-offset-2 hover:no-underline"
        >
          {copy.open}
        </button>
      </div>
      <button
        type="button"
        aria-label={copy.dismiss}
        onClick={() => setDismissed(signature)}
        className="grid size-6 shrink-0 place-items-center rounded-md opacity-70 hover:bg-black/5 hover:opacity-100"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </section>
  );
}
