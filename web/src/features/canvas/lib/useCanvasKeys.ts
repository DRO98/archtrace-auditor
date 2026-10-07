"use client";

import { useEffect } from "react";
import { exitPresentation } from "@/features/share/components/ShareButtons";
import { clearHighlights } from "./actions";
import { useCanvasStore } from "../store";

export function useCanvasKeys(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        if (useCanvasStore.getState().presentation) {
          exitPresentation();
          return;
        }
        if (useCanvasStore.getState().popover !== null) return;
        clearHighlights();
        return;
      }

      if (event.key !== "Enter" || !(event.target instanceof HTMLElement)) return;
      const node = event.target.closest(".react-flow__node");
      if (!(node instanceof HTMLElement) || !node.dataset.id) return;
      useCanvasStore.getState().openDrawer(node.dataset.id, "code");
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
