"use client";

import type { CodeModule } from "@core/graph";
import { useCanvasStore } from "@/features/canvas/store";
import { sessionNodeFor, sessionNodeFrom, type SessionNode } from "@/features/history/lib/sessionNode";
import type { LessonSession } from "@/features/history/types";
import { LessonPanel } from "@/features/lesson/LessonPanel";
import { useLessonStore } from "@/features/lesson/store";

const PROJECT_GOAL = "Explícame el recorrido completo de una pregunta, de principio a fin";

export function LessonTab({ module: codeModule }: { module: CodeModule | null }) {
  const projectName = useCanvasStore((state) => state.graph?.projectName ?? "Proyecto");
  const drawerModuleId = useCanvasStore((state) => state.drawer.moduleId);
  const session = useLessonStore((state) => state.session);
  const draftNode = useLessonStore((state) => state.draftNode);
  // Una sesión (o un chat en blanco) cuyo nodo ya no está en el grafo sigue abriéndose con sus datos guardados.
  const orphan: SessionNode | null = !codeModule && drawerModuleId !== null ? orphanNode(session, draftNode, drawerModuleId) : null;
  const node = orphan ?? sessionNodeFor(codeModule, projectName);
  return (
    <LessonPanel
      key={node.nodeId ?? "project"}
      node={node}
      defaultGoal={
        codeModule
          ? `Explícame paso a paso cómo funciona «${codeModule.label}» y con qué piezas se conecta`
          : PROJECT_GOAL
      }
    />
  );
}

function orphanNode(session: LessonSession | null, draftNode: SessionNode | null, drawerModuleId: string): SessionNode | null {
  if (session?.nodeId === drawerModuleId) return sessionNodeFrom(session);
  if (draftNode?.nodeId === drawerModuleId) return draftNode;
  return null;
}
