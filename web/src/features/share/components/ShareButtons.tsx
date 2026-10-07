"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2, MonitorPlay } from "lucide-react";
import { useCanvasStore } from "@/features/canvas/store";
import { HEADER_BUTTON_ACTIVE, HEADER_BUTTON_SECONDARY } from "@/features/canvas/theme";
import { LONG_URL_WARNING, buildShareUrl } from "../lib/shareState";

/** Entra en modo presentación (y en pantalla completa si el navegador lo permite). */
export function enterPresentation(): void {
  useCanvasStore.getState().setPresentation(true);
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

export function exitPresentation(): void {
  useCanvasStore.getState().setPresentation(false);
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

export function PresentationButton() {
  return (
    <button
      type="button"
      onClick={enterPresentation}
      title="Oculta paneles y barras de edición para proyectar o compartir pantalla (Esc para salir)"
      className={HEADER_BUTTON_SECONDARY}
    >
      <MonitorPlay className="size-4" aria-hidden />
      Modo Presentación
    </button>
  );
}

type CopyState = { status: "idle" } | { status: "copied"; long: boolean } | { status: "error" };

/**
 * Copia un enlace con el diagrama comprimido en `#data=`: no se guarda nada en ningún servidor
 * (el fragmento de la URL no viaja en la petición HTTP). Incluye rutas y nombres, nunca código.
 */
export function ShareStateButton() {
  const [state, setState] = useState<CopyState>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function share(): Promise<void> {
    const { graph, selectedModuleId, presentation } = useCanvasStore.getState();
    if (!graph) return;
    const url = buildShareUrl(window.location, { v: 1, graph, selectedModuleId, presentation });
    try {
      await navigator.clipboard.writeText(url);
      setState({ status: "copied", long: url.length > LONG_URL_WARNING });
    } catch {
      // Sin permiso de portapapeles: al menos deja el enlace en la barra de direcciones.
      window.history.replaceState(null, "", url);
      setState({ status: "error" });
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState({ status: "idle" }), 4000);
  }

  const label =
    state.status === "copied"
      ? state.long
        ? "Copiado (enlace largo)"
        : "¡Enlace copiado!"
      : state.status === "error"
        ? "Enlace en la barra de direcciones"
        : "Compartir estado";

  return (
    <button
      type="button"
      onClick={() => void share()}
      title="Copia un enlace con el diagrama comprimido en la URL. No se guarda en ningún servidor; solo viajan rutas y nombres, nunca código."
      className={state.status === "idle" ? HEADER_BUTTON_SECONDARY : HEADER_BUTTON_ACTIVE}
    >
      {state.status === "copied" ? <Check className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
      <span aria-live="polite">{label}</span>
    </button>
  );
}
