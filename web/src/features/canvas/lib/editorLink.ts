export type EditorScheme = "vscode" | "cursor" | "windsurf" | "jetbrains";

export interface CodeTarget {
  filePath: string;
  line: number;
  endLine?: number;
}

/**
 * `vscode://file/{root}/{filePath}:{line}`. Devuelve null si falta la raíz o si
 * `filePath` intenta salir de ella (absoluto o con `..`).
 */
export function buildEditorDeepLink(
  projectRoot: string | undefined,
  target: CodeTarget,
  scheme: EditorScheme = "vscode",
): string | null {
  const root = projectRoot?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return null;
  const relative = target.filePath.replace(/\\/g, "/");
  if (relative.startsWith("/") || /^[A-Za-z]:/.test(relative)) return null;
  if (relative.split("/").some((segment) => segment === "..")) return null;
  const line = Number.isInteger(target.line) && target.line > 0 ? target.line : 1;
  const joined = `${root}/${relative}`;
  if (scheme === "jetbrains") {
    return `idea://open?file=${encodeURIComponent(joined)}&line=${line}`;
  }
  const absolute = joined.replace(/^\/+/, "");
  return `${scheme}://file/${encodeURI(absolute)}:${line}`;
}

export function readEditorScheme(value: string | undefined): EditorScheme {
  if (value === "cursor" || value === "windsurf" || value === "jetbrains") return value;
  return "vscode";
}
