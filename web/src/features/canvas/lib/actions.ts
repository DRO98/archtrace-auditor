import { sendTeacherMessage } from "@/hooks/useTeacherSocket";
import { buildClear } from "@/lib/protocol";
import { useCanvasStore } from "../store";
import { moduleRange } from "./graph";
import { syncEditorTo } from "./useEditorSync";

/** Quita el resaltado en el IDE y la selección en el canvas. */
export function clearHighlights(): void {
  sendTeacherMessage(buildClear());
  useCanvasStore.getState().clearSelection();
}

/**
 * "Explorar código": abre la pestaña Código del nodo y lleva el editor a su
 * definición (por la extensión si está conectada; si no, con vscode://).
 */
export function exploreCode(moduleId: string): void {
  const state = useCanvasStore.getState();
  state.openDrawer(moduleId, "code");
  const codeModule = state.indexes?.modulesById.get(moduleId);
  if (!codeModule) return;
  const range = moduleRange(codeModule);
  syncEditorTo(
    { filePath: codeModule.filePath, line: range?.startLine ?? 1, endLine: range?.endLine },
    { allowDeepLink: true },
  );
}

/**
 * Lienzo → IDE al pulsar un nodo: lleva el editor al archivo y línea del módulo por el puente WebSocket
 * (NAVIGATE_TO_CODE). Sin extensión conectada no hace nada: un clic simple nunca lanza el deep link.
 */
export function revealInEditor(moduleId: string): void {
  const codeModule = useCanvasStore.getState().indexes?.modulesById.get(moduleId);
  if (!codeModule) return;
  const range = moduleRange(codeModule);
  syncEditorTo(
    { filePath: codeModule.filePath, line: range?.startLine ?? 1, endLine: range?.endLine },
    { allowDeepLink: false },
  );
}
