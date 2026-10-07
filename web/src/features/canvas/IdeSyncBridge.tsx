"use client";

import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { useTeacherIdeState } from "@/hooks/useTeacherSocket";
import { useMotionDuration } from "@/lib/motion";
import { FIT_NODE_DURATION_MS, fitNode } from "./lib/fitNode";
import { findSubBlockAt } from "./lib/ideSync";
import { useCanvasStore } from "./store";

export function IdeSyncBridge() {
  const ide = useTeacherIdeState();
  const followIde = useCanvasStore((state) => state.followIde);
  const indexes = useCanvasStore((state) => state.indexes);
  const { fitView } = useReactFlow();
  const duration = useMotionDuration(FIT_NODE_DURATION_MS);
  const lastModuleId = useRef<string | null>(null);

  useEffect(() => {
    if (!indexes || !ide) {
      useCanvasStore.getState().setIdeLocation(null, null);
      lastModuleId.current = null;
      return;
    }

    const block = findSubBlockAt(indexes.subBlocksByFile, ide.activeFile, ide.cursorLine);
    const moduleId = block?.moduleId ?? indexes.modulesByFile.get(ide.activeFile) ?? null;

    useCanvasStore.getState().setIdeLocation(moduleId, block?.id ?? null);
    if (followIde && moduleId && moduleId !== lastModuleId.current) {
      fitNode(fitView, moduleId, duration);
    }
    lastModuleId.current = moduleId;
  }, [ide, indexes, followIde, fitView, duration]);

  return null;
}
