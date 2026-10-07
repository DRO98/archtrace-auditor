"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useCanvasStore, type PopoverId } from "../store";

interface PopoverProps {
  id: PopoverId;
  title: string;
  anchor?: "top" | "bottom";
  /** "dialog": modal centrado y más ancho, en un portal para quedar sobre el lienzo y el player. */
  variant?: "popover" | "dialog";
  children: ReactNode;
}

/** Botones que abren/cierran un popover: un clic en ellos no cuenta como "clic fuera". */
export const POPOVER_TOGGLE = "[data-rail-button]";

export function Popover({ id, title, anchor = "top", variant = "popover", children }: PopoverProps) {
  const open = useCanvasStore((s) => s.popover === id);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (ref.current?.contains(target) || target.closest(POPOVER_TOGGLE)) return;
      useCanvasStore.getState().setPopover(null);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      useCanvasStore.getState().setPopover(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!open) return null;

  if (variant === "dialog") {
    return createPortal(
      <div className="fixed inset-0 z-[100] grid place-items-center bg-ink/20 p-4 backdrop-blur-[1px]">
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-white shadow-xl"
        >
          {children}
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className={cn(
        // Ancho fijo (320px). Altura acotada al rail (no al viewport): el panel no se sale del editor.
        // Scroll en el wrapper interno (min-h-0) para que flex no recorte el contenido sin barra.
        "absolute left-full z-50 ml-2 flex max-h-[calc(100%-1.5rem)] w-80 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-[0_12px_32px_-12px_rgb(15_23_42/0.25),0_2px_6px_-2px_rgb(15_23_42/0.08)]",
        anchor === "top" ? "top-3" : "bottom-3",
      )}
    >
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
