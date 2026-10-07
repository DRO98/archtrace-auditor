"use client";

import { sendTeacherMessage, useTeacherStatus } from "@/hooks/useTeacherSocket";
import { buildNavigate } from "@/lib/protocol";
import { useCanvasStore } from "../store";
import { buildEditorDeepLink, readEditorScheme, type CodeTarget } from "./editorLink";
import { readIdeSetup } from "./ideSetup";
import { useIdeSetup } from "./useIdeSetup";

const ENV_ROOT = process.env.NEXT_PUBLIC_PROJECT_ROOT;
const ENV_SCHEME = readEditorScheme(process.env.NEXT_PUBLIC_EDITOR_SCHEME);

export type SyncChannel = "ide" | "deeplink" | "none";

/**
 * Lleva el editor a `target`. Con la extensión conectada usa el WebSocket
 * (NAVIGATE_TO_CODE); si no, cae al deep link `vscode://file/...`, que solo se
 * abre por gesto explícito (`allowDeepLink`) para no lanzar apps sin permiso.
 */
export function syncEditorTo(target: CodeTarget, opts: { allowDeepLink: boolean }): SyncChannel {
  const { focusEditor, setCodeTarget } = useCanvasStore.getState();
  setCodeTarget(target);
  const sent = sendTeacherMessage(
    buildNavigate(target.filePath, target.line, target.endLine ?? target.line, { focusEditor }),
  );
  if (sent) return "ide";
  if (!opts.allowDeepLink) return "none";
  const href = editorDeepLink(target);
  if (!href) return "none";
  window.location.href = href;
  return "deeplink";
}

export function editorDeepLink(target: CodeTarget): string | null {
  const saved = readIdeSetup();
  if (saved) return buildEditorDeepLink(saved.projectRoot, target, saved.ide);
  return buildEditorDeepLink(ENV_ROOT, target, ENV_SCHEME);
}

export function useEditorSync(): {
  online: boolean;
  canDeepLink: boolean;
  openInEditor: (target: CodeTarget) => SyncChannel;
} {
  const online = useTeacherStatus() === "open";
  const saved = useIdeSetup();
  const canDeepLink = saved.setup !== null || Boolean(ENV_ROOT);
  return {
    online,
    canDeepLink,
    openInEditor: (target) => syncEditorTo(target, { allowDeepLink: true }),
  };
}
